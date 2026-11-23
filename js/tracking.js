// Live runner positions, shared by the staff and field apps, from two sources that cover for each other:
//   GPS trackers (the GPS-seuranta feed, tulospalvelu.fi): init.txt (competitors) and data.lst (positions), followed live.
//   Timing chips (the RaceResult feed, js/timing.js): the time each runner crossed each timing point.
// For every runner the newest hard fix wins, whichever source it came from. A fix older than a few minutes gets a
// projected "likely km now" at the runner's own pace (capped at the next timing point, which they'd have been read at),
// so the apps always hold the most up to date position, and say how it was worked out. A runner late at the next
// timing point is flagged. Without either source (config.tracking.gps / chip, or ?gps=… / ?chip=…) it does nothing.
(function () {
  const C = window.GPT100_CONFIG || {}, T = C.tracking || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const one = n => (Math.round(n * 10) / 10).toFixed(1);
  const dist = m => m >= 950 ? one(m / 1000) + ' km' : Math.round(m / 10) * 10 + ' m';
  const ago = ms => ms < 90e3 ? 'just now' : ms < 3600e3 ? Math.round(ms / 60e3) + ' min ago' : (ms / 3600e3).toFixed(1) + ' h ago';
  const mins = ms => { const m = Math.round(ms / 60e3), h = Math.floor(m / 60); return h ? `${h} h ${m % 60} min` : `${m} min`; };
  const hm = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const CHIP = () => window.GPTTiming && window.GPTTiming.on() ? window.GPTTiming : null;

  // Where the GPS feed comes from: ?gps=… overrides the config (an event id goes through the Worker relay, a full address is read as is).
  // There can be more than one event (the GPT100 and the GPT50 and stage race are separate events at the provider):
  // a list in the config, or ids separated by commas. Every event is followed side by side and its runners merged.
  let src = null;
  try { const q = new URLSearchParams(location.search).get('gps'); if (q) src = q; } catch (e) { }
  src = src || T.gps || '';
  const SRCS = (Array.isArray(src) ? src : String(src).split(',')).map(x => String(x).trim()).filter(Boolean);
  if (!SRCS.length && !window.GPTTiming) { window.GPTTracking = null; return; }
  const GPS = SRCS.length > 0;
  const isUrl = x => /^https?:\/\//.test(x);
  // The Worker that relays the feed. A rehearsal can point at a local one: ?api=http://127.0.0.1:8787 (js/live.js).
  let WORKER = ((C.weather && C.weather.refreshUrl) || '').replace(/\/$/, '');
  try { if (window.GPTLive && new URLSearchParams(location.search).get('api') && GPTLive.base()) WORKER = GPTLive.base(); } catch (e) { }
  const FEEDS = SRCS.map((x, i) => ({
    id: x, key: SRCS.length > 1 ? i + ':' : '',   // runner ids are per event, so keep them apart when there's more than one
    base: isUrl(x) ? x.replace(/\/?$/, '/') : WORKER + '/gps/' + x + '/',
    relay: !isUrl(x), ready: false, live: false, name: '', interval: 15, bytes: -1, reset: -1, lastLine: 'undef', error: null, timer: null
  }));
  const BASE = GPS ? FEEDS[0].base : '';
  const RELAY = GPS && FEEDS.every(f => f.relay);

  const EPOCH = Date.UTC(2006, 0, 1) / 1000;  // the GPS feed counts seconds from 1 January 2006 UTC
  const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const STALE_MIN = 15, STOPPED_MIN = 20, STOPPED_M = 60, KEEP = 240;  // last fixes kept per runner (about 3 hours)
  const EST_MIN = 3;        // a hard fix older than this gets a projected km
  const EST_GRACE_MIN = 30; // the projected km is kept this long past the time cut-off pace would reach the next timing point
  const AWAY_KM = 1;        // a tracker this far before its runner's start, or past their finish, isn't on their race
  const LATE_MIN = 20;      // late at the next timing point: this long (or a quarter of the leg) past their expected time
  // At an aid station: within AID_M of one. Not moving or a quiet tracker there is a runner at the aid station (a tent or a
  // roof blocks the signal), shown on its own, until they've been there longer than 9 in 10 runners stayed in 2026
  // (tracking.aidStayMin, minutes, by aid station name; AID_STAY_DEFAULT otherwise). In the 2026 Miler, 97% of "not
  // moving" flags and 84% of "tracker gone quiet" flags were runners at aid stations.
  const AID_M = 300, AID_STAY_DEFAULT = 30;
  const AID_STAY = Object.assign({ 'GAR Trailhead': 15, 'Halls Gap': 40, 'Mt Rosea Carpark': 20, 'Borough Huts Camp': 35, 'Mt William Carpark': 50,
    'Jimmy Creek Camp': 45, 'Griffin Fireline': 45, 'Cassidys Gap Rd': 20, 'Bainggug Carpark': 35 }, T.aidStayMin || {});
  const QUIET_ESC_MIN = 30;  // a tracker quiet this long away from an aid station heads the Runner watch
  // Off the course: at least OFF_FIXES fixes in a row more than 150 m from it, over at least OFF_MIN minutes. In 2026 half
  // the single-fix flags were GPS wobble; every one that lasted was away from the aid stations.
  const OFF_FIXES = 2, OFF_MIN = 3;

  // tracking.gpsJoinedOnly: GPS events that carry more than runners (every tracker: vehicles, sweeps, other races).
  // A tracker in one of them is shown only when it's joined to a chip runner in the event's races (gpsRaces).
  const JOINED = new Set(T.gpsJoinedOnly || []);
  // tracking.gpsBibs: a tracker's bib in the GPS to the runner's bib in the timing list, where the providers number
  // a runner differently (relay teams, say). Kept by timing list bib, for the join below.
  const GPS_BIB = new Map(Object.entries(T.gpsBibs || {}).map(([g, c]) => [String(c), String(g)]));
  const S = { ready: false, live: false, name: '', interval: 15, runners: new Map(), byBib: new Map(), allBib: new Map(), rawIds: new Map(), bytes: -1, reset: -1, lastLine: 'undef', updated: 0, error: null, listeners: [], gps: GPS, partial: false };

  // ---------- the GPS feed ----------
  function parseInit(F, txt) {
    for (const raw of txt.split('\n')) {
      const line = raw.replace(/\r$/, ''), i = line.indexOf(':');
      if (i < 0) continue;
      const k = line.slice(0, i), v = line.slice(i + 1);
      if (k === 'RACENAME') F.name = v.trim();
      else if (k === 'LIVE') F.live = v.trim() === '1';
      // The provider's own cadence. A feed read straight from an address of our own (the demo, a rehearsal folder)
      // can be read more often: tracking.gpsEvery seconds. The relay keeps the provider's cadence.
      else if (k === 'GRABINTERVAL') F.interval = !F.relay && T.gpsEvery ? Math.max(2, +T.gpsEvery) : Math.max(10, +v || 15);
      else if (k === 'COMPETITOR') {
        // id|date|start|"1047 Jane Smith"|short name|...
        // Relay teams come as id|date|start|618|The Dawgs|...: the bib alone, then the team's name.
        const f = v.split('|'), id = f[0] && F.key + f[0], b = (f[3] || '').trim(), full = /^\d+$/.test(b) && (f[4] || '').trim() ? b + ' ' + f[4].trim() : b, m = full.match(/^(\d+)\s*(.*)$/);
        if (!id) continue;
        const r = S.runners.get(id) || { id, pts: [] };
        r.bib = m ? m[1] : ''; r.name = m ? m[2] : full; r.label = full; r.feed = F.id; r.raw = f[0];
        (S.rawIds.get(f[0]) || S.rawIds.set(f[0], new Set()).get(f[0])).add(F.id);
        S.runners.set(id, r);
        if (r.bib) { if (!JOINED.has(F.id) || !S.byBib.has(r.bib)) S.byBib.set(r.bib, r); const A = S.allBib.get(r.bib) || []; if (!A.includes(r)) A.push(r); S.allBib.set(r.bib, A); }
      }
    }
  }

  // One line of data.lst: "<id>.<t>_<lon*5e4>_<lat*1e5>_B<batt>_S<speed>.<dt>_<dlon>_<dlat>.<3 chars: dt dlon dlat, each minus 31>…"
  function parseLine(F, line) {
    const c = line.split('.');
    if (c.length < 2 || c[1].indexOf('*') >= 0) return;
    const r = S.runners.get(F.key + c[0]);
    if (!r) return;
    const u = c[1].split('_');
    let t = +u[0], lon = +u[1], lat = +u[2];
    if (!isFinite(t) || !isFinite(lon) || !isFinite(lat)) return;
    const add = () => { if (lat && lon) r.pts.push([t, lat / 1e5, lon / 5e4]); };
    add();
    for (let k = 2; k < c.length; k++) {
      const tok = c[k];
      if (tok.length < 3) continue;
      const v = tok.split('_');
      if (v.length >= 3) { t += +v[0] || 0; lon += +v[1] || 0; lat += +v[2] || 0; }
      else { t += ALPHA.indexOf(tok[0]) - 31; lon += ALPHA.indexOf(tok[1]) - 31; lat += ALPHA.indexOf(tok[2]) - 31; }
      add();
    }
  }
  function handleData(F, txt) {
    const lines = txt.split('\n');
    for (const l of lines) if (l.length > 10) { parseLine(F, l); F.lastLine = l.slice(0, 29); }
    // The newest fix in this event, for the feed health check (an event that stops sending while its runners are out).
    for (const r of S.runners.values()) if (r.feed === F.id && r.pts.length) F.newest = Math.max(F.newest || 0, (r.pts[r.pts.length - 1][0] + EPOCH) * 1000);
    // Keep each runner's fixes in time order, drop duplicates and the oldest beyond KEEP.
    for (const r of S.runners.values()) {
      if (!r.pts.length) continue;
      r.pts.sort((a, b) => a[0] - b[0]);
      const out = [];
      for (const p of r.pts) if (!out.length || p[0] > out[out.length - 1][0]) out.push(p);
      r.pts = out.slice(-KEEP);
    }
    S.updated = Date.now();
    recompute();
  }

  // ---------- pace model: how long the fastest and the slowest take between two course km ----------
  // The GPT100 uses the pacing table (fastest runner and cut-offs, data/pacing.js), so the terrain is in it.
  // Other courses use flat speeds. A runner's pace is where they sit between the two, from their chip reads.
  const modelCache = new Map();
  function model(E) {
    if (modelCache.has(E.id)) return modelCache.get(E.id);
    const P = window.GPT100_PACING;
    let m;
    if (E.main && P && P.miler) {
      const pts = P.miler.points.map(p => ({ km: p.km, f: Date.parse(p.fast + ':00+11:00'), s: Date.parse(p.slow + ':00+11:00') })).sort((a, b) => a.km - b.km);
      const at = (km, k) => { if (km <= pts[0].km) return pts[0][k] - (pts[0].km - km) * 3600e3 / 8; for (let i = 1; i < pts.length; i++) if (km <= pts[i].km) { const a = pts[i - 1], b = pts[i]; return a[k] + (b[k] - a[k]) * (km - a.km) / ((b.km - a.km) || 1); } const z = pts[pts.length - 1]; return z[k] + (km - z.km) * 3600e3 / 4; };
      m = { fast: (a, b) => at(b, 'f') - at(a, 'f'), slow: (a, b) => at(b, 's') - at(a, 's'), cutAt: km => at(km, 's') };
    } else m = { fast: (a, b) => (b - a) * 3600e3 / 10, slow: (a, b) => (b - a) * 3600e3 / 4 };
    modelCache.set(E.id, m);
    return m;
  }
  // Time to go from km a to km b for a runner at pace fraction f (0 = the fastest, 1 = the cut-offs).
  const legMs = (E, a, b, f) => { const M = model(E), x = M.fast(a, b); return Math.max(0, x + f * (M.slow(a, b) - x)); };
  // A runner's pace fraction, from their last two chip reads (or their start), else mid-pack.
  function fracOf(chip) {
    if (!chip || chip.reads.length < 2) return 0.5;
    const R = chip.reads, b = R[R.length - 1];
    let a = null;
    for (let i = R.length - 2; i >= 0; i--) if (b.km - R[i].km >= 2) { a = R[i]; break; }
    if (!a) a = R[0];
    if (b.km - a.km < 0.5) return 0.5;
    const M = model(chip.course), fast = M.fast(a.km, b.km), slow = M.slow(a.km, b.km);
    if (slow <= fast) return 0.5;
    return Math.min(1.5, Math.max(0, ((b.t - a.t) - fast) / (slow - fast)));
  }
  // The km a runner at pace f reaches `ms` after being at km a, no further than cap.
  function kmAfter(E, a, f, ms, cap) {
    let lo = a, hi = Math.min(cap, E.totalKm);
    if (legMs(E, a, hi, f) <= ms) return hi;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (legMs(E, a, mid, f) <= ms) lo = mid; else hi = mid; }
    return lo;
  }

  // ---------- when a runner is due at the next timing point: the splits fitted to how the 2026 field ran ----------
  // data/splits.js gives each race the share of a runner's finish time used at each point (a + b × finish hours), with
  // the point's course km (gk). A runner's finish time comes from their arrival read at their last timing point, so time
  // spent at that aid station is part of the fit, not counted against the next leg. Tested on the 2026 Miler, arrivals
  // later than due + grace fell from 21% of legs (the pacing table blend) to 3%. Races without a fit, and runners
  // without a start read, keep the pacing table blend.
  const SPLIT_KEY = { miler: 'miler', '50k': 's1', s1: 's1', s2: 's2', s3: 's3', s4: 's4', '33k': 's4' };
  const curves = new Map();
  function curveFor(c) {
    const k = c && SPLIT_KEY[c.raceKey], F = k && window.GPT_SPLITS && window.GPT_SPLITS[k];
    if (!F || !c.course || !c.course.main) return null;
    const id = k + '|' + c.startKm + '|' + c.finishKm;
    if (!curves.has(id)) {
      const P = Object.values(F.points).filter(p => p.gk != null && p.gk > c.startKm + 0.1 && p.gk < c.finishKm - 0.1)
        .map(p => ({ km: p.gk, a: p.a, b: p.b })).sort((x, y) => x.km - y.km);
      curves.set(id, P.length ? [{ km: c.startKm, a: 0, b: 0 }, ...P, { km: c.finishKm, a: 1, b: 0 }] : null);
    }
    return curves.get(id);
  }
  function fitElapsed(C, km, h) {
    let a = 1, b = 0;
    for (let i = 1; i < C.length; i++) if (km <= C[i].km) { const x = C[i - 1], y = C[i], f = (km - x.km) / ((y.km - x.km) || 1); a = x.a + (y.a - x.a) * f; b = x.b + (y.b - x.b) * f; break; }
    return (a + b * h) * h * 3600e3;
  }
  function fitDue(c, km) {
    const C = curveFor(c);
    if (!C || !c.reads.length) return null;
    const st = c.reads.find(x => Math.abs(x.km - c.startKm) < 0.3), last = c.reads[c.reads.length - 1];
    const arr = c.reads.find(x => Math.abs(x.km - last.km) < 0.05);  // the first read there: the In read
    if (!st || !arr || arr === st || arr.t <= st.t) return null;
    let lo = 0.3, hi = 80;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (fitElapsed(C, arr.km, m) < arr.t - st.t) lo = m; else hi = m; }
    return { due: st.t + fitElapsed(C, km, (lo + hi) / 2), from: arr.t };
  }
  // The next timing point that's reading runners. A point that hasn't read anyone while a point further on has read
  // several (Copper Mine Track in 2026) is skipped, or every runner would be late there. Other races' starts and
  // finishes (the 50k's finish at Halls Gap, Stage 3's start at Mt William) aren't this runner's checkpoints.
  const own = (p, c) => p.name !== 'Start' && (p.name !== 'Finish' || !c || Math.abs(p.km - c.finishKm) < 0.3);
  function nextPoint(TC, E, km, c) {
    const all = TC.points().filter(p => p.course === E && p.name !== 'Start' && p.name !== 'Finish');
    return TC.pointsAfter(E, km).find(p => own(p, c) && (p.n > 0 || !all.some(q => q.km > p.km && q.n >= 5))) || null;
  }
  // At an aid station: the stop within AID_M of this fix, since when they've been there (the first of the fixes in a
  // row near it, or their chip read there if earlier), and how long most runners stay.
  function aidAt(r, E, p) {
    let best = null, bd = AID_M;
    for (const a of E.AID || []) { const d = window.GPT.metres([p[1], p[2]], [a.lat, a.lon]); if (d <= bd) { bd = d; best = a; } }
    if (!best) return null;
    let since = p[0];
    for (let i = r.pts.length - 1; i >= 0; i--) { const q = r.pts[i]; if (q[0] > p[0]) continue; if (window.GPT.metres([q[1], q[2]], [best.lat, best.lon]) > AID_M) break; since = q[0]; }
    since = (since + EPOCH) * 1000;
    if (r.chip) for (const rd of r.chip.reads) if (Math.abs(rd.km - best.trail_km) < 0.3 && rd.t < since && since - rd.t < 3 * 3600e3 && !/\(out\)$/.test(rd.name)) since = rd.t;
    return { name: best.name, km: best.trail_km, since, limitMin: AID_STAY[best.name] != null ? AID_STAY[best.name] : AID_STAY_DEFAULT };
  }

  // ---------- merge the two sources and work out every runner's position ----------
  let courses = null;
  function recompute() {
    const G = window.GPT; if (!G) return;
    courses = courses || G.courses.filter(c => !c.alt);  // the contingency isn't tracked: runners stay on the GPT100
    const now = Date.now(), TC = CHIP();
    // Runners the chips know that the GPS feed doesn't get an entry of their own. So does a chip runner whose bib a
    // tracker in another race's GPS event has (the providers number some relay teams the same): two people, kept apart.
    for (const r of S.runners.values()) r.chip = null;
    if (TC) for (const c of TC.runners()) {
      const A = (S.allBib.get(c.bib) || []).concat(S.allBib.get(GPS_BIB.get(c.bib)) || []);  // its own bib, or its paired GPS bib
      let r = A.find(x => fits(x, c)) || (A.length ? S.runners.get('chip:' + c.bib) : S.byBib.get(c.bib)) || null;
      if (!r) { r = { id: 'chip:' + c.bib, bib: c.bib, name: c.name, label: c.bib + ' ' + c.name, pts: [] }; S.runners.set(r.id, r); if (!S.byBib.has(c.bib)) S.byBib.set(c.bib, r); }
      else if (A.length > 1 && r.pts !== undefined && !r.id.startsWith('chip:')) S.byBib.set(c.bib, r);  // two trackers with this bib: the one in the chip runner's race answers to it
      if (r.bib !== c.bib && !r.id.startsWith('chip:')) S.byBib.set(c.bib, r);  // paired bibs: either one finds them
      r.chip = c;
      if (!r.name && c.name) { r.name = c.name; r.label = c.bib + ' ' + c.name; }
    }
    for (const r of S.runners.values()) position(r, now, TC);
    S.listeners.forEach(fn => { try { fn(); } catch (e) { } });
  }
  // tracking.gpsRaces: the races each GPS event carries ({ '20261106gpt100': ['miler'], ... }; 'stage' is every stage).
  // A tracker joins a chip runner of the same bib only in one of its event's races. An event not listed takes any.
  function fits(r, c) {
    // A tracker the provider also has in another event we read (same tracker id) is followed there, not here.
    if (JOINED.has(r.feed) && [...(S.rawIds.get(r.raw) || [])].some(f => f !== r.feed && !JOINED.has(f))) return false;
    const L = r.feed && T.gpsRaces && T.gpsRaces[r.feed];
    return !Array.isArray(L) || !c.raceKey || L.includes(c.raceKey) || (/^s[1-4]$/.test(c.raceKey) && L.includes('stage'));
  }
  function position(r, now, TC) {
    if (r.feed && JOINED.has(r.feed) && !r.chip) { r.pos = null; return; }
    // A fix from before the runner's race day doesn't place them today: a stage race tracker's last fix from yesterday's
    // finish, or one switched on for a test, would otherwise be walked along today's course at their pace.
    const day = r.chip && r.chip.day != null && !T.chipDay ? r.chip.day : null;
    let p = r.pts[r.pts.length - 1];
    if (p && day != null && (p[0] + EPOCH) * 1000 < day) p = null;
    let gps = null;
    if (p) {
      // The same fix as last time (positions are worked out again every minute, and whenever either feed updates):
      // its place on the course is kept, not searched for again along every course point.
      const t = (p[0] + EPOCH) * 1000, same = r.lastSnap && r.lastSnap.t === t ? r.lastSnap : null;
      let best = same ? { E: same.E, ic: same.ic, offM: same.offM } : null;
      if (!best) for (const E of courses) {
        const s = E.snap(p[1], p[2]);
        if (!best || s.offM < best.offM) best = { E, ic: s.ic, offM: s.offM };
        if (best.offM < 60) break;
      }
      // Where the course passes close to itself (Halls Gap, the out and back to Jimmy Creek), a wobbly fix can snap
      // to the wrong pass and the km flicks back. Runners don't run backwards: if the nearest point is behind where
      // this runner was a moment ago and another pass nearby keeps them going forward, take that one.
      const E = best.E, LS = r.lastSnap && r.lastSnap.E === E ? r.lastSnap : null;
      if (LS && LS.t === t) { best.ic = LS.ic; best.offM = LS.offM; }  // the same fix again (positions are recomputed every minute): keep the pick
      else {
        const prev = LS && LS.t < t && t - LS.t < 30 * 60e3 ? LS.km : null;
        if (prev != null && E.route[best.ic][2] < prev - 0.05) {
          const alt = E.revisits(best.ic, Math.max(80, best.offM + 40)).map(i => E.route[i]).filter(q => q[2] >= prev - 0.05).sort((a, b) => a[2] - b[2])[0];
          if (alt) { best.ic = E.idxAtKm(alt[2]); best.offM = Math.round(window.GPT.metres([p[1], p[2]], [alt[0], alt[1]])); }
        }
        if (!LS || LS.t < t) r.lastSnap = { E, ic: best.ic, km: E.route[best.ic][2], offM: best.offM, t };
      }
      // Moving: more than STOPPED_M from where they were STOPPED_MIN ago.
      const old = r.pts.find(q => (p[0] - q[0]) * 1000 <= STOPPED_MIN * 60e3) || r.pts[0];
      const moved = window.GPT.metres([old[1], old[2]], [p[1], p[2]]);
      const spanMin = (p[0] - old[0]) / 60;
      gps = { lat: p[1], lon: p[2], t, course: best.E, km: best.E.route[best.ic][2], ic: best.ic, offM: best.offM,
        stale: now - t > STALE_MIN * 60e3, stopped: spanMin >= STOPPED_MIN - 2 && moved < STOPPED_M && now - t <= STALE_MIN * 60e3,
        aid: aidAt(r, best.E, p), offFixes: 0, offMin: 0 };
      // Off the course for a while: fixes in a row more than 150 m from it, and over how long.
      if (best.offM > 150) {
        let n = 0, t0 = p[0];
        if (same && same.off) { n = same.off.n; t0 = same.off.t0; }
        else {
          for (let i = r.pts.length - 1; i >= 0 && n < 60; i--) { const q = r.pts[i]; if (q[0] > p[0]) continue; if (best.E.snap(q[1], q[2]).offM <= 150) break; n++; t0 = q[0]; }
          if (r.lastSnap && r.lastSnap.t === t) r.lastSnap.off = { n, t0 };
        }
        gps.offFixes = n; gps.offMin = (p[0] - t0) / 60;
      }
    }
    const c = r.chip, read = c && c.last;
    let chip = null;
    if (read) {
      const q = c.course.route[c.course.idxAtKm(read.km)];
      chip = { lat: q[0], lon: q[1], t: read.t, course: c.course, km: read.km, ic: c.course.idxAtKm(read.km), offM: 0, at: read.name };
    }
    if (!gps && !chip) { r.pos = null; return; }
    // Finished or out of the race: keep the last place, off the course lists.
    if (c && c.status) {
      const h = chip && (!gps || chip.t >= gps.t) ? chip : gps;
      r.pos = Object.assign({}, h, { src: h === chip ? 'chip' : 'gps', ageMs: now - h.t, onCourse: false, stale: false, quiet: false, stopped: false, done: c.status, chipAt: read || null, gpsT: gps ? gps.t : 0, est: null, next: null });
      return;
    }
    const hard = chip && (!gps || chip.t > gps.t) ? chip : gps, src = hard === chip ? 'chip' : 'gps';
    // A tracker that isn't on its runner's own race: more than AWAY_KM before their start or past their finish along
    // the course (a stage runner's tracker back at Halls Gap after the stage, or riding the shuttle). It's shown where
    // it is, but the runner isn't counted as on course there: no estimate, not late, not on the watch lists.
    const away = c && src === 'gps' && c.finishKm > c.startKm ? (hard.km < c.startKm - AWAY_KM ? 'before' : hard.km > c.finishKm + AWAY_KM ? 'after' : '') : '';
    const pos = Object.assign({}, hard, {
      src, ageMs: now - hard.t, onCourse: hard.offM <= 150 && !away, away, done: '',
      stale: src === 'gps' && gps.stale,                       // the tracker has gone quiet and nothing newer from the chips
      quiet: !!(gps && gps.stale),                             // the tracker itself has gone quiet (the chips may still place them)
      stopped: src === 'gps' && gps.stopped,
      chipAt: read || null, gpsT: gps ? gps.t : 0, est: null, next: null,
      offFixes: src === 'gps' ? gps.offFixes : 0, offMin: src === 'gps' ? gps.offMin : 0
    });
    // At an aid station: their newest position is there (a GPS fix, or a chip read there that isn't the Out read).
    if (!away && gps && gps.aid && (src === 'gps' || (Math.abs(hard.km - gps.aid.km) < 0.3 && !/\(out\)$/.test(read.name)))) {
      const stayMs = now - gps.aid.since;
      pos.atAid = Object.assign({}, gps.aid, { stayMs, over: stayMs > gps.aid.limitMin * 60e3 });
    }
    // Where they probably are now, and when they're due at the next timing point.
    const E = pos.course, f = fracOf(c);
    const nextPt = TC ? nextPoint(TC, E, pos.km, c) : null;
    const finKm = c ? c.finishKm : E.totalKm;
    const cap = nextPt ? Math.min(nextPt.km, finKm) : finKm;
    // At their pace they'd have reached the next timing point by now, but there's no read there: they're somewhere
    // on that leg, so the estimate sits in the middle of it and says so.
    // Only while they could still be on that leg: once even cut-off pace would have brought them to the timing point
    // (and EST_GRACE_MIN more), there's no telling where they are, and they stay at their last known position. Without
    // this, trackers handed back at Halls Gap after the 2026 race were marched up the Pinnacle track for days.
    if (pos.onCourse && !pos.stopped && pos.ageMs > EST_MIN * 60e3 && pos.km < cap - 0.05 && now <= hard.t + legMs(E, pos.km, cap, 1) + EST_GRACE_MIN * 60e3) {
      let km = kmAfter(E, pos.km, f, pos.ageMs, cap);
      const capped = km >= cap - 1e-6;
      // Spread across the middle of the leg by bib, so two runners on the same leg don't sit on one spot.
      if (capped) km = pos.km + (cap - pos.km) * (0.38 + 0.24 * ((+r.bib || 0) % 7) / 6);
      const q = E.route[E.idxAtKm(km)];
      pos.est = { km, lat: q[0], lon: q[1], capped, frac: f, from: src === 'chip' ? read.name : 'GPS', fromKm: pos.km, toKm: cap, to: nextPt ? nextPt.name : 'the finish' };
    }
    // Due at the next timing point, counted from their last chip read (what the timing system knows), else the GPS fix.
    // Late only counts when nothing says they're still moving: no fresh GPS fix, or one that isn't moving.
    if (nextPt && pos.onCourse) {
      const a = chip && chip.km <= pos.km + 0.05 ? chip : hard;
      const fit = chip && chip.km <= pos.km + 0.05 ? fitDue(c, nextPt.km) : null, from = fit ? fit.from : a.t;
      const due = fit ? fit.due : a.t + legMs(E, a.km, nextPt.km, f);
      // Overdue: past the cut-off there (the Miler, from the pacing table's cut-offs), else past cut-off pace from the last read.
      const cut = c && c.raceKey === 'miler' && model(E).cutAt ? model(E).cutAt(nextPt.km) : null;
      const latest = cut || a.t + legMs(E, a.km, nextPt.km, 1);
      const grace = Math.max(LATE_MIN * 60e3, (due - from) / 4), moving = !!(gps && !gps.stale && !gps.stopped);
      pos.next = { name: nextPt.name, km: nextPt.km, due, latest, late: now > due + grace && !moving, overdue: now > latest && !moving, lateMs: now - due, fitted: !!fit };
    }
    r.pos = pos;
  }

  // ---------- reading the GPS feed (each event on its own) ----------
  // The state shows all the events together: ready once any is, live if any is, the names joined, any error.
  function sum() {
    S.ready = FEEDS.some(F => F.ready);
    S.live = FEEDS.some(F => F.live);
    S.name = FEEDS.map(F => F.name).filter(Boolean).join(', ');
    S.interval = Math.min(...FEEDS.map(F => F.interval));
    const bad = FEEDS.filter(F => F.error);
    S.error = bad.length ? bad.map(F => (FEEDS.length > 1 ? (F.name || 'event') + ': ' : '') + F.error).join('; ') : null;
  }
  async function get(F, path, extra) {
    const res = await fetch(F.base + path + (extra || ''), { cache: 'no-store' });
    if (!res.ok) throw new Error(path + ' ' + res.status);
    return res;
  }
  // With the app off screen (the phone in a pocket, another tab in front) new positions are fetched once a minute
  // instead of every 15 seconds, which saves battery and data over a 40 hour race. Back on screen it catches up at once.
  const HIDDEN_S = 60;
  const wait = F => (document.hidden ? Math.max(HIDDEN_S, F.interval) : F.interval) * 1000;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    FEEDS.forEach(F => { if (F.timer && Date.now() - (F.polled || 0) > F.interval * 1000) { clearTimeout(F.timer); F.timer = null; poll(F); } });
  });
  async function poll(F) {
    F.polled = Date.now();
    try {
      const q = F.bytes >= 0 ? `?offset=${F.bytes}&reset=${F.reset}` : `?data=${encodeURIComponent(F.lastLine)}`;
      const res = await get(F, 'data.php', q);
      const txt = await res.text();
      if (txt.slice(0, 6) !== '<HTML>' && txt.indexOf('DOCTYPE') < 0) {
        const fs = res.headers.get('X-GPS-Server-Filesize'), rs = res.headers.get('X-GPS-Server-Reset');
        if (fs) F.bytes = +fs; if (rs) F.reset = +rs;
        F.error = null; sum();
        if (txt.trim()) handleData(F, txt);
      } else { F.error = null; sum(); }
    } catch (e) { F.error = e.message; sum(); }
    F.timer = setTimeout(() => poll(F), wait(F));
  }
  // The phone apps, through the Worker's relay, take the end of the positions file first (the last few fixes of
  // everyone who is moving), so the map fills in seconds on a weak signal; the whole file follows in the background
  // for the history (trails, who has stopped, trackers that went quiet earlier). S.partial says it's still to come.
  const TAIL = 150000, PHONE = !!(window.GPTLive && /^(runner|field)$/.test(GPTLive.app));
  async function rest(F, tries) {
    try {
      const res = await fetch(F.base + 'data.lst', { cache: 'no-store' });
      if (!res.ok) throw new Error('data.lst ' + res.status);
      const fs = res.headers.get('X-GPS-Server-Filesize'), txt = await res.text();
      if (fs) F.bytes = Math.max(F.bytes, +fs);
      F.partial = false; S.partial = FEEDS.some(x => x.partial);
      const last = F.lastLine;
      handleData(F, txt);
      F.lastLine = last === 'undef' ? F.lastLine : last;   // the newest line stays the one the follow-up fetches count from
    } catch (e) { if (tries < 8) setTimeout(() => rest(F, tries + 1), 60e3); }
  }
  async function start(F) {
    try {
      parseInit(F, await (await get(F, 'init.txt')).text());
      // An event set up ahead of race day has no positions file until the first tracker sends: the provider answers
      // 403 or 404. That's not an error, just nothing yet.
      const res = await fetch(F.base + 'data.lst' + (F.relay && PHONE ? '?tail=' + TAIL : ''), { cache: 'no-store' });
      if (!res.ok && res.status !== 403 && res.status !== 404) throw new Error('data.lst ' + res.status);
      const fs = res.ok && res.headers.get('X-GPS-Server-Filesize'); if (fs) F.bytes = +fs;
      // "X-GPS-Tail: sent/whole" when the relay sent only the end of the file (an older Worker sends it all).
      const tl = res.ok && /^(\d+)\/(\d+)$/.exec(res.headers.get('X-GPS-Tail') || '');
      const txt = res.ok ? await res.text() : '';
      F.partial = !!tl && +tl[1] < +tl[2]; S.partial = FEEDS.some(x => x.partial);
      F.ready = true; F.error = null; sum();
      handleData(F, txt);
      if (F.partial) setTimeout(() => rest(F, 0), 2500);
      // Followed for new positions while live, and also once it has any: the provider can mark an event not live while
      // its trackers still send (the 50k and stage race event on the Friday).
      if ((F.live || F.lastLine !== 'undef') && !F.timer) F.timer = setTimeout(() => poll(F), wait(F));
      // An event that isn't live yet (set up ahead of race day) is checked again every few minutes, so it's picked up
      // when the provider switches it on, with its competitors, without reloading the app.
      else if (!F.live) setTimeout(() => start(F), 5 * 60e3);
    } catch (e) {
      F.error = e.message; sum(); recompute();
      setTimeout(() => start(F), 60e3);
    }
  }
  function boot() {
    if (GPS) FEEDS.forEach(start);
    if (window.GPTTiming) GPTTiming.onUpdate(recompute);
    // Positions age even when nothing new arrives: refresh the estimates every minute.
    setInterval(() => { if (ready()) recompute(); }, 60e3);
  }
  if (window.GPT) boot(); else addEventListener('load', boot);

  // ---------- answers ----------
  const ready = () => S.ready || !!(CHIP() && CHIP().ready());
  const list = () => [...S.runners.values()].filter(r => r.pos && !r.pos.done);
  const cur = r => r.pos.est ? r.pos.est.km : r.pos.km;  // the km they're most likely at now
  // Runners on a course, nearest first to a km (along the course), within maxKm.
  function near(E, km, maxKm, n) {
    return list().filter(r => r.pos.course === E && r.pos.onCourse && Math.abs(cur(r) - km) <= (maxKm || 5))
      .sort((a, b) => Math.abs(cur(a) - km) - Math.abs(cur(b) - km)).slice(0, n || 6);
  }
  const byBib = bib => S.byBib.get(String(bib).replace(/^#|^bib\s*/i, '').trim()) || null;
  // Runners on course between two km, by course.
  function between(E, k0, k1) { return list().filter(r => r.pos.course === E && r.pos.onCourse && !r.pos.stale && cur(r) >= Math.min(k0, k1) && cur(r) < Math.max(k0, k1)); }
  // The runners to keep an eye on: not moving, off the course, late at the next timing point, or a tracker gone quiet
  // with nothing from the chips since. A runner not moving, or with a quiet tracker, at an aid station is in `aid` (with
  // how long they've been there) until they've stayed longer than most runners do there; then they're flagged as usual.
  function watch() {
    const atAid = r => r.pos.atAid && !r.pos.atAid.over;
    const on = list().filter(r => r.pos.onCourse || r.pos.atAid);
    const recent = on.filter(r => !r.pos.stale).length;
    const quietOn = recent >= 3 || CHIP();
    // Quiet away from an aid station (or longer than most stay there) heads the list once it's been QUIET_ESC_MIN.
    const quietRank = r => (r.pos.ageMs >= QUIET_ESC_MIN * 60e3 ? 1 : 0);
    return {
      stopped: on.filter(r => r.pos.stopped && !atAid(r)).sort((a, b) => b.pos.km - a.pos.km),
      // Recent GPS fixes more than 150 m from any course, OFF_FIXES in a row over OFF_MIN minutes (a single wobbly fix
      // isn't flagged), not at an aid station. Longest off first.
      off: list().filter(r => !r.pos.onCourse && r.pos.src === 'gps' && !r.pos.stale && !atAid(r) && r.pos.offFixes >= OFF_FIXES && r.pos.offMin >= OFF_MIN)
        .sort((a, b) => b.pos.offMin - a.pos.offMin || b.pos.offM - a.pos.offM),
      late: on.filter(r => r.pos.next && r.pos.next.late && !atAid(r)).sort((a, b) => b.pos.next.lateMs - a.pos.next.lateMs),
      quiet: quietOn ? on.filter(r => r.pos.stale && r.pos.ageMs < 6 * 3600e3 && !atAid(r)).sort((a, b) => quietRank(b) - quietRank(a) || b.pos.ageMs - a.pos.ageMs) : [],
      aid: on.filter(r => atAid(r) && (r.pos.stopped || r.pos.stale)).sort((a, b) => b.pos.atAid.stayMs - a.pos.atAid.stayMs)
    };
  }
  // How a runner at an aid station reads: "Jimmy Creek Camp, 25 min (most leave by 45)".
  const aidLine = r => r.pos.atAid ? `${r.pos.atAid.name.replace(/\s*\((water point|emergency aid)\)$/i, '')}, ${Math.round(r.pos.atAid.stayMs / 60e3)} min` +
    (r.pos.atAid.over ? ` (longer than most stay, ${r.pos.atAid.limitMin})` : ` (most leave by ${r.pos.atAid.limitMin})`) : '';
  const leaders = E => list().filter(r => r.pos.course === E && r.pos.onCourse && !r.pos.stale).sort((a, b) => cur(b) - cur(a));

  function status() {
    const TC = CHIP(), chipLine = TC ? TC.status() : '';
    if (GPS) {
      if (S.error && !S.ready) return `GPS tracking: can't reach the feed (${S.error}).` + (chipLine ? ' ' + chipLine : '');
      if (!S.ready) return 'GPS tracking: loading…' + (chipLine ? ' ' + chipLine : '');
    }
    const on = list().filter(r => r.pos.onCourse && !r.pos.stale), byChip = on.filter(r => r.pos.src === 'chip').length;
    const waiting = GPS && !S.live && FEEDS.every(F => F.lastLine === 'undef');  // set up at the provider, nothing sent yet
    let s = `${!GPS ? 'Timing chips only' : S.live ? 'Live tracking' : waiting ? 'GPS tracking (not started yet)' : 'Tracking (replay)'}: ${on.length} runner${on.length === 1 ? '' : 's'} on course`;
    if (GPS && TC) s += ` (${on.length - byChip} placed by GPS, ${byChip} by the chips)`;
    if (GPS) s += `, GPS updated ${ago(Date.now() - S.updated)}${S.error ? ' (last fetch failed)' : ''}${S.partial ? ' (latest positions first: the earlier ones are still loading)' : ''}`;
    return s + '.' + (chipLine ? ' ' + chipLine : '') + (T.credit && T.credit.name ? ` Timing and tracking by ${T.credit.name}.` : '');
  }
  // The timing team's own pages, as small buttons beside the tracking status: their live tracking (or event) page and
  // the official results (config tracking.url and tracking.results). Blank when neither is set.
  function links() {
    const a = (u, t) => `<a class="btn small" href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`;
    const h = (T.url ? a(T.url, T.label || 'Live tracking') : '') + (T.results ? ' ' + a(T.results, 'Official results') : '');
    return h ? `<p class="trk-links">${h}</p>` : '';
  }
  // Who a runner is: bib, name, and their age category when the timing list has one (js/timing.js), with their gender
  // letter in front ("M 60 to 69"). Other runners rarely note a bib number, so "the bloke in his sixties" is how a
  // Safety Officer gets pointed to the right runner.
  const ageOf = r => { const c = r && r.chip; return c && c.age ? (c.gender === 'M' || c.gender === 'F' ? c.gender + ' ' : '') + c.age : ''; };
  const ageTag = r => { const a = ageOf(r); return a ? ` <span class="trk-age">${esc(a)}</span>` : ''; };
  const who = r => `<b>Bib ${esc(r.bib || '?')}</b> ${esc(r.name)}${ageTag(r)}`;

  // ---------- you: how far a runner is from the person holding the phone ----------
  // The apps that know where you are (the field app's Where am I?, the runner app's ◎) say so with setMe({ lat, lon, t }),
  // and with { course, km, offM } too when they've already placed you on a course, so the popups agree with the km on screen.
  // Then a tap on any runner says how far they are from you along the course, with the climb between you, and when
  // they'd reach you at their pace. Feedback from the 2026 Safety Officers: to tell a supporter how far out their
  // runner was, you had to tap the course beside the runner instead of the runner.
  const ME_ON_M = 500, ME_OLD_MIN = 10, ME_MAX_H = 6;
  let ME = null;
  function setMe(m) {
    const ok = m && isFinite(m.lat) && isFinite(m.lon) && m.lat !== null && m.lon !== null;
    const same = ok && ME && ME.lat === +m.lat && ME.lon === +m.lon && ME.km === m.km && ME.course === m.course;
    if (same) ME.t = m.t || ME.t;
    else ME = ok ? { lat: +m.lat, lon: +m.lon, t: m.t || Date.now(), course: m.course, km: m.km, offM: m.offM, on: new Map() } : null;
    // The maps redraw once the caller has finished what it was doing.
    setTimeout(() => S.listeners.forEach(fn => { try { fn(); } catch (e) { } }), 0);
  }
  const me = () => ME && Date.now() - ME.t < ME_MAX_H * 3600e3 ? ME : null;
  // A runner's pace fraction: from their chip reads, else from their own GPS fixes over the last while, else mid-pack.
  function paceOf(r) {
    if (r.chip && r.chip.reads.length >= 2) return fracOf(r.chip);
    const P = r.pts, z = P && P[P.length - 1], E = r.pos && r.pos.course;
    if (!z || !E) return 0.5;
    if (r.gpsPace && r.gpsPace.t === z[0] && r.gpsPace.E === E) return r.gpsPace.f;
    let f = 0.5;
    const a = P.find(q => z[0] - q[0] <= 2 * 3600) || P[0];
    if (z[0] - a[0] >= 20 * 60) {
      const ka = E.route[E.snap(a[1], a[2]).ic][2], kb = r.pos.src === 'gps' ? r.pos.km : E.route[E.snap(z[1], z[2]).ic][2], M = model(E);
      if (kb - ka >= 0.5) { const fast = M.fast(ka, kb), slow = M.slow(ka, kb); if (slow > fast) f = Math.min(1.5, Math.max(0, ((z[0] - a[0]) * 1000 - fast) / (slow - fast))); }
    }
    r.gpsPace = { t: z[0], E, f };
    return f;
  }
  // Where a runner is from you: { straight (m) } always; on their course as well { alongKm, dir ('coming', 'past' or
  // 'here'), up and down (m, in the direction of travel between the two of you), walkMin (you to them on foot, at
  // responder pace), eta (when they reach you at their pace, ms; null when there's nothing to go by), myKm, ageMs }.
  function fromMe(r) {
    const M = me(), p = r && r.pos;
    if (!M || !p || !window.GPT) return null;
    const E = p.course, km = cur(r), at = p.est ? [p.est.lat, p.est.lon] : [p.lat, p.lon];
    const out = { straight: window.GPT.metres([M.lat, M.lon], at), ageMs: Date.now() - M.t, t: M.t };
    let on = M.on.get(E.id);
    if (on === undefined) {
      // Where the app put you on this course, else the nearest point of it.
      const s = M.course === E.id && M.km != null ? { ic: E.idxAtKm(M.km), offM: M.offM || 0 } : E.snap(M.lat, M.lon);
      // Every time the course passes you (an out and back passes twice), as course km.
      on = s.offM <= ME_ON_M ? [E.route[s.ic][2]].concat(E.revisits ? E.revisits(s.ic, 60).map(i => E.route[i][2]) : []).sort((a, b) => a - b) : null;
      M.on.set(E.id, on);
    }
    if (!on || p.done) return out;
    // The pass they come to next; past them all, the last one.
    const near = on.find(k => k >= km - 0.02), myKm = near != null ? near : on[on.length - 1], d = km - myKm;
    const i0 = E.idxAtKm(myKm), i1 = E.idxAtKm(km), lo = Math.min(i0, i1), hi = Math.max(i0, i1);
    const night = E.isNight && C.nightFactor > 1 && E.isNight(E.now ? E.now() : Date.now()) ? C.nightFactor : 1;
    Object.assign(out, { myKm, alongKm: Math.abs(d), dir: Math.abs(d) < 0.05 ? 'here' : d < 0 ? 'coming' : 'past', up: E.climb(lo, hi), down: E.climb(hi, lo),
      walkMin: E.walkMin ? (E.walkMin(myKm, km) + E.climb(i0, i1) * (C.climbPenalty || 0)) * night : null, night: night > 1, eta: null });
    if (out.dir === 'coming' && !p.stopped && !p.stale && p.onCourse) out.eta = Date.now() + legMs(E, km, myKm, paceOf(r));
    return out;
  }
  const dayF = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short' });
  // A time of day, with the day when it isn't today.
  const clockAt = t => (dayF.format(t) === dayF.format(Date.now()) ? '' : dayF.format(t) + ' ') + hm.format(t);
  // The line a tap on a runner shows. o.walk: add the time on foot from you to them (the staff and field apps);
  // o.eta: the app's own expected time at you (the runner app, from its splits); o.hint: what to say before the app
  // knows where you are.
  function meLine(r, o) {
    o = o || {};
    const m = fromMe(r);
    if (!m) return o.hint && r.pos && !r.pos.done ? `<span class="trk-me trk-me-hint">${o.hint}</span>` : '';
    const old = m.ageMs > ME_OLD_MIN * 60e3 ? `From where you were at ${clockAt(m.t)}: ` : '';
    if (m.alongKm == null) return `<span class="trk-me">${old}<b>${dist(m.straight)} from you</b> in a straight line.</span>`;
    const climb = `+${Math.round(m.up)} m / −${Math.round(m.down)} m`;
    const eta = m.dir === 'coming' ? (o.eta !== undefined ? o.eta : m.eta) : null;
    let h = m.dir === 'here' ? '<b>Right where you are</b> on the course.'
      : m.dir === 'coming' ? `<b>${dist(m.alongKm * 1000)} from you</b>, coming your way (${climb} to reach you).`
      : `<b>${dist(m.alongKm * 1000)} past you</b> on the course (${climb} from you).`;
    if (eta && eta > Date.now()) h += ` At their pace they reach you about <b>${clockAt(eta)}</b>.`;
    if (o.walk && m.walkMin != null && m.dir !== 'here') h += ` About ${r.pos.course.fmt(m.walkMin)} on foot from you${m.night ? ' (night)' : ''}.`;
    return `<span class="trk-me">${old}${h}</span>`;
  }
  // The next stop ahead of a runner on their course (no further than their own finish), and how far: "Next: Halls Gap in 4.2 km".
  function nextStop(r) {
    const p = r.pos; if (!p || p.done || !p.onCourse) return null;
    const E = p.course, km = cur(r), fin = r.chip ? r.chip.finishKm : E.totalKm;
    const a = (E.AID || []).find(a => a.trail_km > km + 0.05 && a.trail_km <= fin + 0.05);
    return a ? { name: a.name.replace(/\s*\((start|finish|water point|emergency aid)\)$/i, ''), km: a.trail_km, toGo: a.trail_km - km } : null;
  }
  // What a tap on a runner shows, the same on every staff and field map: who they are (with their age category), their
  // km, how far they are from you, the next stop, and how the position was worked out. opts.find adds a Find button,
  // opts.extra(r) HTML of its own, opts.meHint the line before the app knows where you are; others: runners on the same spot.
  function popup(r, opts, others) {
    opts = opts || {};
    if (!r.pos) return who(r);  // (their position went between the map being drawn and the tap)
    const p = r.pos, km = cur(r), nx = nextStop(r), ml = meLine(r, { walk: true, hint: opts.meHint });
    return `${who(r)}<br>km ${one(km)}${p.est ? ' (estimated)' : ''}${p.offM > 60 ? ', ' + dist(p.offM) + ' off the course' : ''}` +
      (nx ? ` · next <b>${esc(nx.name)}</b> in ${one(nx.toGo)} km` : '') + (ml ? '<br>' + ml : '') + `<br>${where(r)}` +
      (others && others.length ? `<br><span class="muted">Same spot: ${others.map(x => 'bib ' + esc(x.bib)).join(', ')}</span>` : '') +
      (opts.extra ? opts.extra(r) : '') + (opts.find ? `<br><button class="btn small trk-go" type="button" data-bib="${esc(r.bib)}">Find</button>` : '');
  }
  // How the position was worked out, in a few words: "GPS fix 2 min ago", "chip read at Halls Gap 12:40, likely km 52.3 now".
  function where(r) {
    const p = r.pos;
    if (p.done) {
      const w = { finished: 'finished', dnf: 'withdrew', dns: 'did not start', dsq: 'disqualified' }[p.done] || p.done;
      return p.done === 'dns' ? w : `${w}${p.chipAt ? ` (${p.chipAt.name} ${hm.format(p.chipAt.t)})` : ''}`;
    }
    let s = p.src === 'chip' ? `chip read at ${p.chipAt.name} ${hm.format(p.chipAt.t)} (${ago(p.ageMs)})` : `GPS fix ${ago(p.ageMs)}`;
    if (p.away) s += p.away === 'before' ? ', not on their race\'s part of the course (before their start)' : ', not on their race\'s part of the course (past their finish)';
    if (p.est) s += p.est.capped ? `, somewhere between km ${one(p.est.fromKm)} and ${esc(p.est.to)} (km ${one(p.est.toKm)}): due there by now at their pace, no read yet` : `, likely about km ${one(p.est.km)} now`;
    if (p.stopped) s += ', not moving';
    if (p.quiet && p.src === 'chip') s += `. Tracker quiet since ${hm.format(p.gpsT)}`;
    else if (p.stale) s += '. The tracker has gone quiet and the chips have nothing newer, so they may have moved on';
    if (p.next && p.next.late) s += `. <b>${p.next.overdue ? 'Overdue' : 'Late'} at ${esc(p.next.name)}</b>: expected ${hm.format(p.next.due)}, ${mins(p.next.lateMs)} ago`;
    return s;
  }
  const seen = r => r.pos.stale ? `<span class="trk-stale">${where(r)}</span>` : where(r);
  const lateTag = r => r.pos.next && r.pos.next.late ? `, <b>${r.pos.next.overdue ? 'overdue' : 'late'} at ${esc(r.pos.next.name)}</b>` : '';

  // Find: the runners near a spot on the course, either side.
  function nearHTML(E, km, lat, lon) {
    if (!ready()) return '';
    const rs = near(E, km, 5, 8);
    if (!rs.length) return `<div class="card trk"><h3>Runners near this spot</h3><p class="muted">No tracked runners within 5 km along the course. ${esc(status())}</p></div>`;
    return `<div class="card trk"><h3>Runners near this spot</h3>` + rs.map(r => {
      const d = (cur(r) - km) * 1000;
      return `<div class="row"><span>${who(r)}<span class="sub">km ${one(cur(r))}${r.pos.est ? ' (estimated)' : ''}, ${Math.abs(d) < 60 ? 'right here' : dist(Math.abs(d)) + (d < 0 ? ' back' : ' ahead')}${r.pos.offM > 60 ? ', ' + dist(r.pos.offM) + ' off the course' : ''}${r.pos.stopped ? ', <b>not moving</b>' : ''}${lateTag(r)}. ${seen(r)}</span></span><button class="btn small trk-go" type="button" data-bib="${esc(r.bib)}">Find</button></div>`;
    }).join('') + `<p class="trk-src">${esc(status())}</p></div>`;
  }
  // One line for messages: the nearest runners' bibs.
  function nearLine(E, km) {
    if (!ready()) return '';
    const rs = near(E, km, 3, 4);
    return rs.length ? 'Tracked runners nearby: ' + rs.map(r => `bib ${r.bib} (km ${one(cur(r))}${r.pos.est ? ' est.' : ''})`).join(', ') + '.' : '';
  }

  // ---------- the runner sheet (phones) ----------
  // On a phone the map is small: a popup on it sits under the map's buttons and covers the runner it's about. There,
  // a tap on a runner opens a sheet at the foot of the map card instead (over the elevation profile), with room for
  // the lot, and the runner's marker is ringed. sheet(host, map) → { narrow(), open(id, html), refresh(), close(), id() }.
  // html() is run again on every update while the sheet is open; a tap on the map or × closes it.
  function sheet(host, map) {
    let el = null, on = null;
    const narrow = () => innerWidth < 700 || innerHeight <= 500;  // a phone, upright or on its side
    const redraw = () => setTimeout(() => S.listeners.forEach(fn => { try { fn(); } catch (e) { } }), 0);
    function refresh() {
      if (!on) return;
      let h = ''; try { h = on.html() || ''; } catch (e) { }
      if (!h) { close(); return; }
      if (h !== on.shown) { on.shown = h; el.querySelector('.trk-sheet-body').innerHTML = h; }
    }
    function close() { if (!on) return; on = null; el.hidden = true; host.classList.remove('trk-sheet-on'); redraw(); }
    function open(id, html) {
      if (!el) {
        el = document.createElement('div'); el.className = 'trk-sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Runner');
        el.innerHTML = '<button type="button" class="trk-sheet-x" aria-label="Close">×</button><div class="trk-sheet-body" aria-live="polite"></div>';
        el.querySelector('.trk-sheet-x').onclick = close;
        host.appendChild(el);
        if (map) map.on('click', close);
        S.listeners.push(refresh);
      }
      on = { id: String(id), html, shown: null };
      el.hidden = false; el.scrollTop = 0; host.classList.add('trk-sheet-on');
      refresh();
      if (on) redraw();  // ring their marker
    }
    return { narrow, open, refresh, close, id: () => on ? on.id : null };
  }

  // Map markers for the runners on this course, within a km window (or all). Solid: a fix in the last few minutes.
  // Dashed: estimated from an older fix or chip read. Grey: tracker quiet. Amber: late at the next timing point. Red: not moving.
  // Runners on the same spot (within 40 m: an aid station, or two estimated on the same leg) are stacked in a
  // column below it, so every bib stays in view and can be tapped. opts.find adds a Find button to each popup;
  // opts.extra(r) adds HTML of its own; opts.sheet (from sheet() above) takes the tap on a phone instead of a popup.
  function draw(layer, E, k0, k1, opts) {
    if (!window.L || !ready()) return;
    opts = opts || {};
    // Whether a tap opens the sheet is asked once, before any marker goes on the map: the screen's size is a layout
    // question, and asking it between adding markers made the browser lay the page out again for every runner.
    const SH = opts.sheet && opts.sheet.narrow() ? opts.sheet : null, picked = SH ? SH.id() : null;
    // Grouped through a grid of about 50 m squares, so a big field isn't compared runner against runner.
    const groups = [], cells = new Map(), CELL = 0.0005;
    for (const r of list()) {
      const p = r.pos, km = cur(r);
      if (p.course !== E || (k0 != null && (km < k0 - 1 || km > k1 + 1))) continue;
      const at = p.est ? [p.est.lat, p.est.lon] : [p.lat, p.lon], cx = Math.floor(at[0] / CELL), cy = Math.floor(at[1] / CELL);
      let g = null;
      for (let dx = -1; dx <= 1 && !g; dx++) for (let dy = -1; dy <= 1 && !g; dy++) { const L = cells.get((cx + dx) + ',' + (cy + dy)); if (L) g = L.find(g => window.GPT.metres(g.at, at) < 40) || null; }
      if (g) g.rs.push(r);
      else { g = { at, rs: [r] }; groups.push(g); const key = cx + ',' + cy; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(g); }
    }
    for (const g of groups) {
      g.rs.sort((a, b) => (+a.bib || 0) - (+b.bib || 0));
      g.rs.forEach((r, k) => {
        const p = r.pos, km = cur(r);
        const cls = 'trk-mk' + (p.est ? ' est' : '') + (p.stale ? ' stale' : '') + (p.next && p.next.late ? (p.next.overdue ? ' overdue' : ' late') : '') + (p.stopped ? ' stopped' : '') + (!p.onCourse && p.src === 'gps' && !p.stale ? ' off' : '') + (picked != null && picked === String(r.bib) ? ' sel' : '');
        const icon = L.divIcon({ className: '', html: `<div class="${cls}">${esc(r.bib || '?')}</div>`, iconSize: [30, 18], iconAnchor: [15, 9 - 20 * k], popupAnchor: [0, -20 * k - 6] });
        const at = p.est ? [p.est.lat, p.est.lon] : [p.lat, p.lon];
        const others = g.rs.filter(x => x !== r);
        // The popup is built when it's opened, not for every runner on every update. On a phone it's the sheet.
        const mk = L.marker(at, { icon, zIndexOffset: 400 + k + (cls.endsWith(' sel') ? 600 : 0) });
        if (SH) mk.on('click', () => SH.open(r.bib, () => r.pos ? popup(r, opts, others) : ''));
        else mk.bindPopup(() => popup(r, opts, others), { maxWidth: 290 });
        mk.options.bib = r.bib;
        mk.addTo(layer);
      });
    }
  }

  function onUpdate(fn) { S.listeners.push(fn); if (ready()) fn(); }
  // ---------- feed health: the data problems GPT100 2026 had, caught as they happen ----------
  // Each was found late, or not at all, by a person: the Miler's chip times read as the next day (1 h 44 min), the 50k and
  // stage race GPS event stopping (81 min), Copper Mine Track never reading anyone (the whole race), and no chip times
  // for Stages 2 to 4. Every one shows here within a few minutes. Also a pre-race check: each feed, and what it holds.
  function health(now) {
    now = now || Date.now();
    const issues = [], feeds = [], TC = CHIP();
    const mins = ms => Math.round(ms / 60e3);
    for (const F of FEEDS) {
      const nm = F.name || F.id, mine = [...S.runners.values()].filter(r => r.feed === F.id);
      const out = mine.filter(r => r.pos && !r.pos.done && (!TC || (r.chip && !r.chip.status)));
      feeds.push(`GPS ${nm}: ${F.error ? 'error, ' + F.error : !F.ready ? 'loading' : F.live ? 'live' : F.lastLine === 'undef' ? 'not started yet' : 'not marked live'}, ${mine.filter(r => r.pts.length).length} of ${mine.length} trackers with positions` + (F.newest ? `, newest ${ago(now - F.newest)}` : ''));
      if (F.error && F.ready) issues.push({ level: 'bad', text: `GPS ${nm}: can't read the feed (${F.error}).` });
      const age = F.newest ? now - F.newest : 0;
      if (F.newest && age > 20 * 60e3 && age < 12 * 3600e3 && out.length >= 3)
        issues.push({ level: 'bad', text: `GPS ${nm}: no new positions for ${mins(age)} min, with ${out.length} of its runners still out. The event may have stopped: check the provider for another event their trackers send to, and add it to tracking.gps.` });
    }
    if (TC) {
      const st = TC.state, pts = TC.points();
      feeds.push(`Timing list: ${st.error && !st.ready ? 'error, ' + st.error : !st.ready ? 'loading' : `${st.rows} rows, ${pts.filter(p => p.n).length} of ${pts.length} timing points with reads, read ${ago(now - st.updated)}`}`);
      if (st.ready && st.error) issues.push({ level: 'bad', text: `Timing list: the last read failed (${st.error}).` });
      if (st.ready && now - st.updated > 5 * 60e3) issues.push({ level: 'warn', text: `Timing list: last read ${mins(now - st.updated)} min ago.` });
      // A timing point no one has been read at, while a point further on the same course has read several. Starts and
      // finishes belong to each race's own day, so they're left out. (In 2026 this caught Copper Mine Track all race,
      // and Yarram Gap from late Friday, whose first reads reached the list up to 5 hours late.)
      const mid = pts.filter(p => p.name !== 'Start' && p.name !== 'Finish');
      for (const p of mid) {
        const further = mid.filter(q => q.course === p.course && q.km > p.km + 0.2 && q.n >= 5).reduce((m, q) => Math.max(m, q.n), 0);
        if (!p.n && further) issues.push({ level: 'warn', text: `${p.name}: no chip reads, though ${further} runners have been read further on. The reader is down or its column isn't in the timing list. The app skips it for "late".` });
      }
      if (st.future && st.future.length) issues.push({ level: 'bad', text: `Timing list: ${st.future.length} chip time${st.future.length === 1 ? ' is' : 's are'} ahead of the clock and ignored. The list's days may be read wrong (D:HH:MM:SS counts from the event's first day); check tracking.chipDay.` });
      if (st.badContests && st.badContests.length) issues.push({ level: 'warn', text: `Timing list: contest not recognised, runners not placed: ${st.badContests.map(([n, k]) => `"${n}" (${k})`).join(', ')}. Name them in tracking.chipContests.` });
      // A race under way with its runners well into the course on GPS and no chip times today.
      const noChip = new Map();
      for (const r of S.runners.values()) {
        const c = r.chip;
        if (!c || c.status || c.reads.length || !r.pos || r.pos.src !== 'gps' || r.pos.done) continue;
        if (r.pos.km - c.startKm > 3 && now - r.pos.t < 30 * 60e3) noChip.set(c.raceLabel, (noChip.get(c.raceLabel) || 0) + 1);
      }
      for (const [race, n] of noChip) if (n >= 5) issues.push({ level: 'bad', text: `${race}: ${n} runners are well into the course on GPS with no chip times today. The timing list may not carry this race; ask the timing team.` });
    }
    return { issues, feeds };
  }
  function healthHTML(opts) {
    const H = health(), o = opts || {};
    if (!H.issues.length && !o.always) return '';
    return `<div class="trk-health"><h4>Feed health</h4>` + (H.issues.length ? H.issues.map(i => `<p class="trk-health-${i.level}">${esc(i.text)}</p>`).join('') : '<p class="muted">No problems found in the feeds.</p>') +
      (o.feeds ? `<details><summary>Each feed</summary>${H.feeds.map(f => `<p class="muted">${esc(f)}</p>`).join('')}</details>` : '') + '</div>';
  }
  // How each Runner watch line reads, the same on every screen.
  const lines = {
    aid: r => aidLine(r),
    off: r => `${dist(r.pos.offM)} off the course for ${Math.max(1, Math.round(r.pos.offMin))} min`,
    quiet: r => `No fix for ${Math.round(r.pos.ageMs / 60e3)} min` + (r.pos.atAid ? ` (at ${r.pos.atAid.name}, longer than most stay)` : r.pos.ageMs >= QUIET_ESC_MIN * 60e3 ? ', away from any aid station' : ''),
    stopped: r => r.pos.atAid ? `Not moving at ${r.pos.atAid.name} for ${Math.round(r.pos.atAid.stayMs / 60e3)} min, longer than most stay (${r.pos.atAid.limitMin})` : 'Not moving for 20 min, away from any aid station'
  };

  window.GPTTracking = { state: S, ready, byBib, near, between, watch, leaders, list, cur, status, links, where, nearHTML, nearLine, draw, onUpdate, ago, dist, who, seen, hm, health, healthHTML, lines,
    setMe, fromMe, meLine, nextStop, popup, sheet, ageOf, clockAt, base: BASE, relay: RELAY, gps: GPS, chip: () => !!CHIP() };
})();
