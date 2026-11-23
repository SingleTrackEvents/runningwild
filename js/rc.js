// Race HQ (the Control tab): where everyone is, what's happening now, and one quick log, for a small Running Wild
// crew at the finish. Shared between HQ devices through the Running Wild Worker's database (tools/RUNNING_WILD_WORKER.md),
// unlocked with the staff password. Rebuilt from the GPT100's Race Control board (24 November 2026): no dispatch steps,
// units or severities; an entry is open until someone marks it Sorted. Changes wait on the device with no signal.
(function () {
  let runnerLayer = null;
  const G = window.GPT, C = window.GPT100_CONFIG, W = C.weather || {};
  const $ = id => document.getElementById(id);
  if (!$('rcBody')) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // The Worker, or ?rcapi=, or the demo's own board (js/demo.js), which also opens without the password.
  // A test link (?rcapi= or ?wxrefresh=) may only point at this computer, so a link can't send the password elsewhere.
  const DEMO = !!(window.GPTDemo && window.GPTDemo.rcBase), Q = new URLSearchParams(location.search);
  const local = u => { try { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(u).hostname); } catch (e) { return false; } };
  const linked = u => (u === Q.get('rcapi') || u === Q.get('wxrefresh')) && !local(u);
  const BASE = ([Q.get('rcapi'), DEMO ? window.GPTDemo.rcBase : '', W.refreshUrl].find(u => u && !linked(u)) || '').replace(/\/$/, '');
  const unlocked = () => DEMO || !!(window.MedPlan && window.MedPlan.unlocked());
  const LSQ = 'rw_rc_queue', LSN = 'rw_rc_name';
  // What an entry is. Help requests come from the runner and field apps (the Worker makes them).
  const KINDS = {
    injury: { label: 'Injury or sick', short: 'Injury', col: '#c62828', ask: 'What happened? e.g. rolled ankle, walking slowly' },
    lost: { label: 'Lost or overdue', short: 'Lost', col: '#e8710a', ask: 'Who, last seen where and when' },
    help: { label: 'Help request', short: 'Help', col: '#c62828' },
    other: { label: 'Entry', short: 'Entry', col: '#555' }
  };
  const kindOf = i => i.source === 'runner' || i.source === 'field' ? 'help' : KINDS[i.kind] ? i.kind : i.severity === 'urgent' ? 'injury' : 'other';
  const QUIET_MIN = { phone: 20, garmin: 30 };  // a crew member not heard from for this long is flagged

  // ---------- state ----------
  const incidents = new Map();
  let log = [], since = 0, lastOk = 0, lastErr = '', built = false, shown = false, timer = null, map = null, layer = null;
  let form = null;            // the quick log form open: { kind, bib, where, km, lat, lon, desc }
  let settingsOpen = false, sortedOpen = false, picking = false;
  // The line to the phones (tools/LIVE.md): notices, help requests, the team code, the field phones and inReach units.
  let live = null, liveKey = '', faults = null, heard = new Set(), noticeDraft = { text: '', aud: 'all', level: 'info', mins: '180' };
  // The queue is shared by every tab on the device, so it's read fresh from storage before each change. Bad or blocked storage falls back to memory.
  let mem = [], memOnly = false;
  const readQ = () => {
    if (memOnly) return mem;
    try { const v = JSON.parse(localStorage.getItem(LSQ) || '[]'); mem = Array.isArray(v) ? v.filter(x => x && x.path) : []; } catch (e) { return mem; }
    if (mem.some(x => !x.qid)) { mem.forEach(x => { x.qid = x.qid || newId(); }); saveQ(mem); }
    return mem;
  };
  const saveQ = q => { mem = q; try { localStorage.setItem(LSQ, JSON.stringify(q)); memOnly = false; } catch (e) { memOnly = true; } const w = $('rcStoreWarn'); if (w) w.hidden = !memOnly; };
  const who = () => { try { return localStorage.getItem(LSN) || ''; } catch (e) { return ''; } };
  const now = () => Date.now();

  // ---------- time helpers (Melbourne) ----------
  const tf = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const df = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dayf = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short' });
  const hm = t => t ? tf.format(new Date(t)) : '';
  const dhm = t => t ? df.format(new Date(t)) : '';
  const mins = (a, b) => Math.max(0, Math.round(((b || now()) - a) / 60000));
  const dur = m => m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
  const ageOf = t => { const m = mins(t, live && live.now ? live.now : now()); return m < 1 ? 'just now' : dur(m) + ' ago'; };
  // Race times in data/races.js are Melbourne wall clock. Running Wild runs December to May: daylight saving (+11) until
  // the first Sunday in April, then +10.
  const melb = s => { if (!s) return null; const d = new Date(s + ':00+11:00'); const y = d.getUTCFullYear(), apr = new Date(Date.UTC(y, 3, 1)); const firstSun = 1 + (7 - apr.getUTCDay()) % 7; return d.getUTCMonth() > 3 && d.getUTCMonth() < 9 || (d.getUTCMonth() === 3 && d.getUTCDate() >= firstSun) ? new Date(s + ':00+10:00').getTime() : d.getTime(); };

  // ---------- server ----------
  async function api(path, body) {
    const r = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: Object.assign({ 'X-RC-Password': (!DEMO && window.MedPlan && window.MedPlan.pw()) || '' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'HTTP ' + r.status); e.status = r.status; throw e; }
    return j;
  }
  // Changes go in a queue (kept on the device), so nothing is lost without signal; they send in order.
  function send(path, body) { saveQ(readQ().concat({ qid: newId(), path, body: Object.assign({ who: who() }, body) })); flush(); }
  const drop = x => saveQ(readQ().filter(y => y.qid !== x.qid));
  // One tab sends at a time (Web Locks where the browser has them), so two tabs don't send the same change twice.
  let flushing = false;
  async function flush() {
    if (flushing || !readQ().length || !ready()) return;
    flushing = true;
    const run = async () => {
      let x;
      try {
        while ((x = readQ()[0])) {
          const j = await api(x.path, x.body);
          if (j.incident) incidents.set(j.incident.id, j.incident);
          drop(x);
        }
        lastErr = '';
      } catch (e) { lastErr = e.message; if (e.status === 400 || e.status === 413) drop(x); }
    };
    try { await (navigator.locks ? navigator.locks.request('rw_rc_send', run) : run()); } catch (e) { lastErr = e.message; }
    flushing = false;
    status();
  }
  async function sync() {
    if (!ready()) return;
    try {
      await flush();
      const j = await api('/rc/state?since=' + since);
      if (!Array.isArray(j.incidents)) throw new Error('Race HQ isn\'t set up on the Worker yet (paste the latest Worker code into Cloudflare)');
      j.incidents.forEach(i => { const cur = incidents.get(i.id); if (!cur || (cur.version || 0) <= i.version) incidents.set(i.id, i); });
      if (j.log.length) { const ids = new Set(log.map(l => l.id)); log = j.log.filter(l => !ids.has(l.id)).concat(log).sort((a, b) => b.id - a.id).slice(0, 500); }
      if (!readQ().length) log = log.filter(l => !l.pending);
      since = j.now - 3000; lastOk = now(); lastErr = '';
      if (j.live) { live = j.live; live.now = j.now; }
      if (j.incidents.length || j.log.length) render(); else { tick(); status(); renderCrew(); renderSettings(); renderMap(); }
      alarm();
    } catch (e) { lastErr = e.message; status(); if (e.status === 401 || e.status === 503) render(); }
  }
  const ready = () => BASE && (DEMO || (window.MedPlan && window.MedPlan.unlocked() && window.MedPlan.pw()));

  // ---------- local changes ----------
  function newId() { return 'i' + now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function patchIncident(id, patch, note) {
    const cur = incidents.get(id) || { id, created: now(), status: 'open', version: 0, local: true };
    incidents.set(id, Object.assign({}, cur, patch, { times: Object.assign({}, cur.times, patch.times) }));
    if (note) log.unshift({ id: 1e15 + now(), t: now(), incident: id, text: note, who: who(), pending: true });
    send('/rc/incident', { id, patch, note });
    render();
  }
  function addNote(text, incident) {
    log.unshift({ id: 1e15 + now(), t: now(), incident: incident || null, text, who: who(), kind: 'note', pending: true });
    send('/rc/log', Object.assign({ text }, incident ? { incident } : {}));
    render();
  }

  // ---------- places ----------
  // Every named place on the courses (aid stations, checkpoints, posts), for the Where box and the map pins.
  function places() {
    const out = [], seen = new Set();
    const add = (name, lat, lon, km) => { const n = String(name || '').replace(/\s*\((Start|Finish|second pass|checkpoint)\)\s*$/i, '').replace(/^(Start|Finish), /, '').trim(); if (!n || seen.has(n.toLowerCase())) return; seen.add(n.toLowerCase()); out.push({ name: n, lat, lon, km }); };
    (G.AID || []).forEach(a => add(a.name, a.lat, a.lon, a.trail_km));
    (G.courses || []).forEach(E => (E.AID || []).forEach(a => add(a.name, a.lat, a.lon, E === G ? a.trail_km : null)));
    const SO = window.GPT100_SO; if (SO) SO.stations.forEach(s => add(s.name, s.lat, s.lon, null));
    return out;
  }
  // Named points along the main course, for "at" and "between": the aid stations, plus the main race's checkpoints
  // (Craig's Hut gate, Northside Express, the summit at Buller), so an out-and-back isn't "between X and X".
  let along = null;
  function alongPts() {
    if (along) return along;
    const pts = (G.AID || []).map(a => ({ km: a.trail_km, name: a.name.replace(/\s*\((Start|Finish)\)\s*$/, '') }));
    const R = window.GPT_RACES, main = R && R.races.find(r => r.course === '100'), st = main && R.stages[main.stages[0]];
    if (st) st.points.forEach(p => { if (p.km != null && !pts.some(x => Math.abs(x.km - p.km) < 0.3)) pts.push({ km: p.km, name: p.name.replace(/^(Start|Finish), /, '') }); });
    return (along = pts.sort((x, y) => x.km - y.km));
  }
  function placeAt(km) {
    const A = alongPts(); let a = A[0], b = A[A.length - 1];
    for (let i = 1; i < A.length; i++) if (A[i].km >= km) { a = A[i - 1]; b = A[i]; break; }
    if (Math.abs(a.km - km) < 0.3) return 'at ' + a.name;
    if (Math.abs(b.km - km) < 0.3) return 'at ' + b.name;
    return 'between ' + a.name + ' and ' + b.name;
  }
  // Where an entry is on the map: its own position, else its km on the main course, else a named place.
  function where(i) {
    if (i.lat != null && i.lon != null) return [+i.lat, +i.lon];
    if (i.km != null && !isNaN(i.km)) { try { const E = G.course ? G.course(i.course || G.id) : G; const p = E.route[E.idxAtKm(+i.km)]; return [p[0], p[1]]; } catch (e) { } }
    const p = i.where && places().find(x => x.name.toLowerCase() === String(i.where).toLowerCase());
    return p ? [p.lat, p.lon] : null;
  }
  // Course km of a crew position with none sent (the inReach units), when it's within 500 m of the course.
  function fieldKm(f) { if (f.km != null) return +f.km; try { const sn = G.snap(f.lat, f.lon); return sn && sn.offM <= 500 ? G.route[sn.ic][2] : null; } catch (e) { return null; } }
  // The nearest crew member (field phone or inReach) to an entry, along the course where both are on it.
  function nearCrew(i) {
    if (!live || !live.field || !live.field.length || i.status === 'closed') return '';
    const at = where(i); if (!at) return '';
    const best = live.field.filter(f => (live.now || now()) - f.t < 30 * 60000).map(f => ({ f, m: G.metres(at, [f.lat, f.lon]) })).sort((a, b) => a.m - b.m)[0];
    if (!best) return '';
    const d = best.m, far = d >= 950 ? (d / 1000).toFixed(1) + ' km' : Math.round(d / 10) * 10 + ' m';
    return `<p class="hq-near">Nearest crew: <b>${esc(best.f.name)}</b>, ${far} away (${ageOf(best.f.t)}).</p>`;
  }

  // ---------- layout ----------
  function build() {
    if (map) { map.remove(); map = null; layer = null; }
    $('rcBody').innerHTML = `<div class="hq">
      <div class="hq-top">
        <div class="hq-clock"><b id="rcClock"></b><span id="rcOpenN"></span></div>
        <div id="hqNext" class="hq-next"></div>
        <div id="rcWx" class="rc-wx"></div>
        <div class="hq-tools"><span id="rcSync" class="rc-sync"></span>
          <label class="rc-who">You <input id="rcWho" type="text" maxlength="40" placeholder="Your name" value="${esc(who())}"></label>
          <button id="hqSetBtn" class="btn small" type="button" aria-expanded="false">Settings</button>
          <button id="rcLock" class="btn small" type="button" title="Forget the password on this device">Lock</button></div>
      </div>
      <div id="hqSettings" class="hq-settings" hidden></div>
      <div class="hq-main">
        <div class="hq-mapcol"><div class="hq-mapbox"><div id="rcMap"></div><p id="hqPickMsg" class="hq-pickmsg" hidden>Tap the map where it is. <button type="button" class="btn small" id="hqPickCancel">Cancel</button></p></div></div>
        <div class="hq-side">
          <p id="rcStoreWarn" class="notice warn"${memOnly ? '' : ' hidden'}>This device won't save HQ entries, so the ones waiting to send are only kept in this tab. Keep this tab open until they've sent.</p>
          <div class="hq-quick" role="group" aria-label="Log something">
            <button type="button" class="hq-qb" data-kind="injury" style="--k:${KINDS.injury.col}">Injury or sick</button>
            <button type="button" class="hq-qb" data-kind="lost" style="--k:${KINDS.lost.col}">Lost or overdue</button>
            <button type="button" class="hq-qb" data-kind="note" style="--k:#1d4f91">Note</button>
          </div>
          <div id="hqForm"></div>
          <h3 class="hq-h">Open <span id="hqOpenCount"></span></h3>
          <div id="hqOpen"></div>
          <details id="hqSorted" class="hq-sorted"><summary></summary><div id="hqSortedList"></div></details>
          <h3 class="hq-h">Crew</h3>
          <div id="hqCrew"></div>
          <div id="rcWatch" class="rc-watch"></div>
          <h3 class="hq-h">Log</h3>
          <ul id="rcLog" class="hq-log"></ul>
        </div>
      </div>
    </div>`;
    $('rcWho').addEventListener('change', e => { try { localStorage.setItem(LSN, e.target.value.trim()); } catch (x) { } });
    $('rcLock').addEventListener('click', () => { if (confirm('Lock Race HQ on this device? You\'ll need the password again.') && window.MedPlan) window.MedPlan.lock(); });
    $('hqSetBtn').addEventListener('click', () => { settingsOpen = !settingsOpen; $('hqSettings').hidden = !settingsOpen; $('hqSetBtn').setAttribute('aria-expanded', settingsOpen); liveKey = ''; renderSettings(); });
    $('rcBody').querySelectorAll('.hq-qb').forEach(b => b.addEventListener('click', () => openForm({ kind: b.dataset.kind })));
    $('hqSorted').addEventListener('toggle', () => { sortedOpen = $('hqSorted').open; });
    $('hqPickCancel').addEventListener('click', () => { picking = false; $('hqPickMsg').hidden = true; });
    if (window.L) {
      map = L.map('rcMap', { zoomControl: true });
      GPTBaseMap(map);
      if (window.GPTFullscreen) GPTFullscreen(map, $('rcMap').parentNode);
      (G.courses || [G]).forEach((E, n) => L.polyline(E.route.map(p => [p[0], p[1]]), { color: n ? '#1d4f91' : '#d9531e', weight: n ? 2 : 3, opacity: n ? .45 : .75 }).addTo(map));
      // Aid stations and checkpoints, named on hover.
      places().forEach(p => L.circleMarker([p.lat, p.lon], { radius: 4, color: '#222', weight: 1.5, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(esc(p.name)).addTo(map));
      if (window.GPTHelipads) GPTHelipads.overlay(map, true);
      layer = L.layerGroup().addTo(map);
      runnerLayer = L.layerGroup().addTo(map);
      map.fitBounds(L.latLngBounds(G.route.map(p => [p[0], p[1]])).pad(0.04));
      // Pick a spot for the entry being written.
      map.on('click', e => {
        if (!picking || !form) return;
        picking = false; $('hqPickMsg').hidden = true;
        form.lat = +e.latlng.lat.toFixed(5); form.lon = +e.latlng.lng.toFixed(5);
        try { const sn = G.snap(form.lat, form.lon); form.km = sn.offM <= 300 ? Math.round(G.route[sn.ic][2] * 10) / 10 : null; } catch (x) { form.km = null; }
        if (!form.where) form.where = form.km != null ? 'km ' + form.km.toFixed(1) + ' ' + placeAt(form.km) : 'Spot on the map';
        renderForm(true);
      });
    }
    built = true;
    renderWatch();
  }
  // Runner tracking (only at events with GPS trackers or chip timing): runners on the map, and a short watch list.
  function renderWatch() {
    const TR = window.GPTTracking, el = $('rcWatch');
    if (!TR || !el) return;
    if (runnerLayer) { runnerLayer.clearLayers(); G.courses.forEach(E => TR.draw(runnerLayer, E, null, null, { find: true })); }
    if (!TR.ready()) { el.innerHTML = ''; return; }
    const w = TR.watch(), n = w.quiet.length + w.stopped.length + w.off.length + w.late.length;
    const row = (r, why) => `<div class="row"><span>${TR.who(r)}<span class="sub">${why}, km ${TR.cur(r).toFixed(1)}. ${TR.where(r)}</span></span></div>`;
    el.innerHTML = `<details class="hq-sorted"${n ? ' open' : ''}><summary>Runner watch: ${n ? n + ' to check' : 'everyone moving'}</summary><p class="rc-live">${esc(TR.status())}</p>` +
      w.quiet.slice(0, 8).map(r => row(r, TR.lines.quiet(r))).join('') + w.stopped.slice(0, 8).map(r => row(r, TR.lines.stopped(r))).join('') +
      w.off.slice(0, 8).map(r => row(r, TR.lines.off(r))).join('') + w.late.slice(0, 8).map(r => row(r, (r.pos.next.overdue ? 'Overdue' : 'Late') + ' at ' + esc(r.pos.next.name))).join('') + '</details>';
  }
  if (window.GPTTracking) GPTTracking.onUpdate(() => { if (built) { renderWatch(); renderMap(); } });
  // Flash a missing field red (and focus the first one).
  function flash(...els) {
    els = els.filter(Boolean);
    els.forEach(el => { el.classList.remove('rc-flash'); void el.offsetWidth; el.classList.add('rc-flash'); el.addEventListener('input', () => el.classList.remove('rc-flash'), { once: true }); });
    if (els[0]) els[0].focus();
    return false;
  }
  function needName() {
    if (who()) return true;
    const el = $('rcWho');
    el.placeholder = 'Your name first';
    return flash(el);
  }

  // ---------- rendering ----------
  function render() {
    if (!shown) return;
    if (!BASE) { $('rcBody').innerHTML = '<div class="rc-msg"><h2>Race HQ</h2><p>Race HQ needs the Running Wild Worker. See tools/RUNNING_WILD_WORKER.md.</p></div>'; built = false; return; }
    if (!unlocked()) {
      built = false; if (map) { map.remove(); map = null; layer = null; }
      // The staff password, checked with the Worker (js/medplan.js). The device remembers it until Lock.
      $('rcBody').innerHTML = `<div class="rc-msg"><h2>Race HQ</h2><p>Enter the staff password from the Race Director. This device remembers it until you lock it.</p>
        <form id="rcUnlock" class="search-row" autocomplete="off"><input id="rcPw" type="password" placeholder="Password" autocomplete="current-password"><button class="btn primary" type="submit">Unlock</button></form>
        <p class="msg" id="rcPwMsg" role="status"></p></div>`;
      $('rcUnlock').addEventListener('submit', async e => {
        e.preventDefault(); const pw = $('rcPw').value; if (!pw || !window.MedPlan) return;
        $('rcPwMsg').textContent = 'Checking...';
        try { await window.MedPlan.unlock(pw); }
        catch (err) { $('rcPwMsg').textContent = /wrong password/i.test(err.message) ? 'That password didn\'t work.' : 'Couldn\'t check the password: no signal, or the Worker isn\'t set up yet.'; }
      });
      return;
    }
    if (lastErr && /set up/.test(lastErr) && !incidents.size) {
      built = false; if (map) { map.remove(); map = null; layer = null; }
      $('rcBody').innerHTML = `<div class="rc-msg"><h2>Race HQ</h2><p>${esc(lastErr)}.</p><p>Setup steps are in tools/RUNNING_WILD_WORKER.md.</p></div>`;
      return;
    }
    if (!built) build();
    renderEntries(); renderCrew(); renderLog(); renderMap(); renderForm(); renderSettings(); tick(); status(); renderNext();
  }

  // ---------- entries ----------
  function renderEntries() {
    const box = $('hqOpen'); if (!box) return;
    const a = document.activeElement;
    if (a && box.contains(a) && a.tagName === 'INPUT' && a.value) return;  // someone's typing an update
    const all = [...incidents.values()];
    const open = all.filter(i => i.status !== 'closed').sort((x, y) => (y.needsAck ? 1 : 0) - (x.needsAck ? 1 : 0) || x.created - y.created);
    const done = all.filter(i => i.status === 'closed').sort((x, y) => ((y.times || {}).closed || 0) - ((x.times || {}).closed || 0));
    box.innerHTML = open.length ? open.map(card).join('') : '<p class="rc-empty">Nothing open. Use the buttons above when something happens.</p>';
    $('hqOpenCount').textContent = open.length ? '(' + open.length + ')' : '';
    $('hqSorted').hidden = !done.length;
    $('hqSorted').open = sortedOpen;
    $('hqSorted').querySelector('summary').textContent = `Sorted (${done.length})`;
    $('hqSortedList').innerHTML = done.map(card).join('');
    bindCards(box); bindCards($('hqSortedList'));
  }
  function card(i) {
    const k = KINDS[kindOf(i)], closed = i.status === 'closed', t = i.times || {};
    const loc = [i.where, i.km != null ? 'km ' + (+i.km).toFixed(1) + (i.where ? '' : ' ' + placeAt(+i.km)) : ''].filter(Boolean).join(' · ') ||
      (i.lat != null ? `<a href="https://maps.google.com/?q=${(+i.lat).toFixed(5)},${(+i.lon).toFixed(5)}" target="_blank" rel="noopener">${(+i.lat).toFixed(4)}, ${(+i.lon).toFixed(4)}</a>` : '');
    const from = kindOf(i) === 'help' ? `<p class="hq-from">${i.needsAck && !closed ? '<b>New help request</b> from' : 'Help request from'} the ${i.source} app${i.reporter && /: /.test(i.reporter) ? ' (' + esc(i.reporter.split(': ').slice(1).join(': ')) + ')' : ''}.</p>` : '';
    const ups = log.filter(l => l.incident === i.id && l.kind === 'note').slice(0, 6).reverse();
    return `<div class="hq-card${closed ? ' closed' : ''}${i.needsAck && !closed ? ' rc-needsack' : ''}" data-id="${i.id}" style="--k:${k.col}">
      <div class="hq-card-top"><span class="hq-kind">${esc(k.short)}</span><b>${i.bib ? 'Bib ' + esc(i.bib) : '#' + (i.num || '…')}</b><span class="hq-loc">${loc}</span>
        <span class="hq-age" data-t0="${t.call || i.created}">${closed ? 'Sorted ' + hm(t.closed) : ''}</span></div>
      ${i.desc ? `<p class="hq-what">${esc(i.desc)}</p>` : ''}${from}
      ${ups.length ? `<ul class="hq-ups">${ups.map(l => `<li><time>${hm(l.t)}</time> ${esc(l.text)}${l.who ? ` <span>${esc(l.who)}</span>` : ''}</li>`).join('')}</ul>` : ''}
      ${closed ? '' : nearCrew(i)}
      <p class="hq-meta">#${i.num || '…'} logged ${hm(t.call || i.created)}${i.by ? ' by ' + esc(i.by) : ''}${i.ackBy ? ' · acknowledged by ' + esc(i.ackBy) : ''}${i.sortedBy ? ' · sorted by ' + esc(i.sortedBy) : ''}</p>
      ${closed ? '<div class="hq-actions"><button class="btn small" data-act="reopen" type="button">Reopen</button></div>' : `<div class="hq-actions">
        ${i.needsAck ? '<button class="btn small primary" data-act="ack" type="button">Acknowledge</button>' : ''}
        <form class="hq-upd" data-act="upd"><input type="text" maxlength="300" placeholder="Add an update"><button class="btn small" type="submit">Add</button></form>
        ${where(i) ? '<button class="btn small" data-act="show" type="button">Map</button>' : ''}
        <button class="btn small hq-sort" data-act="sort" type="button">Sorted</button></div>`}
    </div>`;
  }
  function bindCards(root) {
    root.querySelectorAll('.hq-card').forEach(el => {
      const id = el.dataset.id;
      el.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', () => {
        const a = b.dataset.act, i = incidents.get(id);
        if (!i || !needName()) return;
        // The sender's phone shows "Race HQ has your message" from this.
        if (a === 'ack') patchIncident(id, { needsAck: false, ackAt: now(), ackBy: who() }, 'Acknowledged (the phone that sent it is told)');
        if (a === 'sort') patchIncident(id, { status: 'closed', needsAck: false, sortedBy: who(), times: { closed: now() } }, 'Sorted');
        if (a === 'reopen') patchIncident(id, { status: 'open', sortedBy: null, times: { closed: null } }, 'Reopened');
        if (a === 'show' && map) { const p = where(i); if (p) { map.setView(p, Math.max(map.getZoom(), 14)); $('rcMap').scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
      }));
      const f = el.querySelector('form.hq-upd');
      if (f) f.addEventListener('submit', e => {
        e.preventDefault(); const inp = f.querySelector('input'), t = inp.value.trim();
        if (!t) return flash(inp);
        if (!needName()) return;
        inp.value = ''; addNote(t, id);
      });
    });
  }

  // ---------- quick log form ----------
  function openForm(f) {
    if (f.kind === 'note') form = { kind: 'note', desc: '' };
    else form = Object.assign({ bib: '', where: '', desc: '' }, f);
    renderForm(true);
  }
  function renderForm(focus) {
    const box = $('hqForm'); if (!box) return;
    if (!form) { box.innerHTML = ''; return; }
    if (box.querySelector('form') && !focus) return;  // don't wipe a form being typed in
    const note = form.kind === 'note', k = KINDS[form.kind];
    box.innerHTML = `<form class="hq-form" autocomplete="off" style="--k:${note ? '#1d4f91' : k.col}"><h4>${note ? 'Note' : esc(k.label)}</h4>
      ${note ? '' : `<div class="hq-grid">
        <label>Bib <input name="bib" inputmode="numeric" value="${esc(form.bib)}" placeholder="If known"></label>
        <label>Where <input name="where" list="hqPlaces" value="${esc(form.where)}" placeholder="Aid station, post or km"></label>
        <button type="button" class="btn small" data-pick>Pick on map</button>
      </div><datalist id="hqPlaces">${places().map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>`}
      <label class="hq-full">${note ? '' : 'What '}<textarea name="desc" rows="2" placeholder="${note ? 'e.g. Sweep 45 left the village. Mt Stirling aid station open.' : esc(k.ask)}">${esc(form.desc)}</textarea></label>
      <div class="hq-actions"><button class="btn small primary" type="submit">${note ? 'Add to log' : 'Log it'}</button><button class="btn small" type="button" data-cancel>Cancel</button></div></form>`;
    const f = box.querySelector('form');
    const keep = () => { form.desc = f.desc.value; if (!note) { form.bib = f.bib.value; if (f.where.value !== form.where) { form.where = f.where.value; form.lat = form.lon = form.km = null; } } };
    f.addEventListener('input', keep);
    f.querySelector('[data-cancel]').addEventListener('click', () => { form = null; picking = false; if ($('hqPickMsg')) $('hqPickMsg').hidden = true; renderForm(); });
    const pk = f.querySelector('[data-pick]');
    if (pk) pk.addEventListener('click', () => { keep(); picking = true; $('hqPickMsg').hidden = false; $('rcMap').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    f.addEventListener('submit', e => { e.preventDefault(); keep(); save(f); });
    if (focus) (note ? f.desc : f.bib).focus();
  }
  function save(f) {
    if (!needName()) return;
    if (form.kind === 'note') {
      const t = form.desc.trim(); if (!t) return flash(f.desc);
      addNote(t); form = null; renderForm(); return;
    }
    if (!form.desc.trim() && !form.bib.trim()) return flash(f.bib, f.desc);
    // "km 12.3" (or just 12.3) in Where is a km on the main course.
    const m = /^(?:km\s*)?(\d+(?:[.,]\d+)?)(?:\s*km)?$/i.exec(form.where.trim());
    let km = form.km;
    if (m) { const v = +m[1].replace(',', '.'); if (v >= 0 && v <= G.route[G.route.length - 1][2] + 0.5) km = Math.round(Math.min(v, G.route[G.route.length - 1][2]) * 10) / 10; }
    const pl = places().find(x => x.name.toLowerCase() === form.where.trim().toLowerCase());
    if (km == null && pl && pl.km != null) km = Math.round(pl.km * 10) / 10;
    const p = { kind: form.kind, bib: form.bib.trim(), where: m ? '' : form.where.trim(), desc: form.desc.trim(), by: who(), times: { call: now() } };
    if (km != null) p.km = km;
    if (form.lat != null) { p.lat = form.lat; p.lon = form.lon; }
    const id = newId();
    patchIncident(id, p, `${KINDS[form.kind].label}${p.bib ? ', bib ' + p.bib : ''}${p.where ? ', ' + p.where : km != null ? ', km ' + km : ''}${p.desc ? ': ' + p.desc.slice(0, 80) : ''}`);
    form = null; renderForm();
  }

  // ---------- crew ----------
  function renderCrew() {
    const el = $('hqCrew'); if (!el) return;
    const F = ((live && live.field) || []).slice(), t = live && live.now || now();
    const quiet = f => (t - f.t) / 60000 > QUIET_MIN[f.src === 'garmin' ? 'garmin' : 'phone'];
    F.sort((a, b) => (b.sos ? 1 : 0) - (a.sos ? 1 : 0) || (quiet(b) ? 1 : 0) - (quiet(a) ? 1 : 0) || a.name.localeCompare(b.name));
    if (!F.length) {
      el.innerHTML = `<p class="rc-empty">${live && live.field_code ? 'No crew sharing yet. Field phones show here once they turn on Show me on the Control map with the team code.' : 'Set a team code in Settings so crew can share their position from the field app.'}${live && live.garmin && live.garmin.on ? ' The sweeps\' inReach units show once their tracking is on.' : ''}</p>`;
      return;
    }
    el.innerHTML = F.map(f => {
      const km = fieldKm(f), q = quiet(f);
      return `<div class="hq-crew${f.sos ? ' sos' : q ? ' quiet' : ''}" data-crew="${esc(f.id)}"><span class="hq-dot ${f.src === 'garmin' ? 'garmin' : 'phone'}"></span>
        <span class="hq-crew-name"><b>${f.sos ? 'SOS: ' : ''}${esc(f.name)}</b><small>${km != null ? 'km ' + km.toFixed(1) + ' ' + esc(placeAt(km)) : 'off the course'}</small></span>
        <span class="hq-crew-st">${q ? '<b>Quiet</b> ' : ''}${ageOf(f.t)}<small>${f.src === 'garmin' ? 'inReach' : f.src === 'apk' ? 'Android app' : 'phone'}${f.bat != null ? ' · ' + Math.round(f.bat * 100) + '%' : ''}</small></span></div>`;
    }).join('') + `<p class="hq-note">Blue: field phones. Purple: inReach. Quiet: not heard from in ${QUIET_MIN.phone} min (phones) or ${QUIET_MIN.garmin} min (inReach).</p>`;
    el.querySelectorAll('[data-crew]').forEach(r => r.addEventListener('click', () => {
      const f = F.find(x => x.id === r.dataset.crew); if (f && map) { map.setView([f.lat, f.lon], Math.max(map.getZoom(), 14)); $('rcMap').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }));
  }

  // ---------- log ----------
  function renderLog() {
    if (!$('rcLog')) return;
    $('rcLog').innerHTML = log.slice(0, 200).map(l => {
      const inc = l.incident && incidents.get(l.incident);
      const tag = inc ? `<b>${inc.bib ? 'Bib ' + esc(inc.bib) : '#' + (inc.num || '…')}</b> ` : '';
      return `<li class="${l.pending ? 'pending' : ''}${l.kind === 'settings' ? ' sys' : ''}"><time>${hm(l.t)}</time> ${tag}${esc(String(l.text).replace(/^#\d+\s*/, ''))}${l.who ? ` <span>${esc(l.who)}</span>` : ''}</li>`;
    }).join('') || '<li class="rc-empty">Nothing logged yet.</li>';
  }

  // ---------- map ----------
  function renderMap() {
    if (!layer) return;
    layer.clearLayers();
    incidents.forEach(i => {
      if (i.status === 'closed') return;
      const ll = where(i); if (!ll) return;
      const k = KINDS[kindOf(i)];
      L.marker(ll, { zIndexOffset: 800, icon: L.divIcon({ className: '', html: `<div class="rc-pin" style="background:${k.col}">${i.num || '…'}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) })
        .bindTooltip(`${esc(k.short)}${i.bib ? ', bib ' + esc(i.bib) : ''}: ${esc(i.desc || '')}`).on('click', () => { const el = document.querySelector(`.hq-card[data-id="${i.id}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }).addTo(layer);
    });
    // Field phones (blue tags; pale once over 15 minutes old) and the sweeps' inReach units (purple; red and flashing in SOS).
    ((live && live.field) || []).forEach(f => {
      const old = (live.now || now()) - f.t > 15 * 60000, gk = fieldKm(f);
      L.marker([f.lat, f.lon], { zIndexOffset: f.sos ? 900 : 300, icon: L.divIcon({ className: '', html: `<div class="rc-phone${old ? ' old' : ''}${f.src === 'garmin' ? ' garmin' : ''}${f.sos ? ' sos' : ''}">${f.sos ? 'SOS ' : ''}${esc(f.name)}</div>`, iconSize: [0, 0], iconAnchor: [0, 9] }) })
        .bindPopup(`<b>${esc(f.name)}</b> · ${f.src === 'garmin' ? 'Garmin inReach' : 'field phone'}${f.sos ? '<br><b style="color:#c62828">In SOS (emergency declared on the device)</b>' : ''}<br>${gk != null ? 'km ' + gk.toFixed(1) + '<br>' : ''}Position ${ageOf(f.t)}${f.acc ? ', GPS ±' + Math.round(f.acc) + ' m' : ''}${f.bat != null ? '<br>Battery ' + Math.round(f.bat * 100) + '%' : ''}${f.ev ? '<br>' + esc(f.ev) : ''}`).addTo(layer);
    });
  }

  // ---------- top strip ----------
  function tick() {
    if (!$('rcClock')) return;
    $('rcClock').textContent = tf.format(new Date());
    const open = [...incidents.values()].filter(i => i.status !== 'closed'), help = open.filter(i => i.needsAck).length;
    $('rcOpenN').innerHTML = help ? `<span class="rc-count" style="background:#c62828">${help} new help request${help > 1 ? 's' : ''}</span>`
      : open.length ? `<span class="rc-count" style="background:#e8710a">${open.length} open</span>` : '<span class="rc-count ok">Nothing open</span>';
    document.querySelectorAll('#rcBody .hq-age[data-t0]').forEach(el => { if (el.closest('.hq-card').classList.contains('closed')) return; { const m = mins(+el.dataset.t0); el.textContent = m < 1 ? 'just now' : dur(m) + ' ago'; } });
  }
  // The next cut-offs across every race, from data/races.js; before race day, when the first start is.
  function renderNext() {
    const el = $('hqNext'); if (!el) return;
    const R = window.GPT_RACES; if (!R) { el.innerHTML = ''; return; }
    const t = now(), pts = [];
    Object.values(R.stages).forEach(s => s.points.forEach(p => { if (p.cutoff && p.kind !== 'start') pts.push({ t: melb(p.cutoff), name: p.name.replace(/^(Finish|Start), /, ''), race: s.label, fin: p.kind === 'finish' }); }));
    const starts = Object.values(R.stages).map(s => melb(s.points[0].cutoff || s.points[0].first)).filter(Boolean).sort((a, b) => a - b);
    if (starts.length && t < starts[0] - 12 * 3600e3) { el.innerHTML = `<span class="rc-wx-h">Race day</span> ${dayf.format(starts[0])}, first start ${hm(starts[0])}`; return; }
    const next = pts.filter(p => p.t > t).sort((a, b) => a.t - b.t);
    const seen = new Set(), show = next.filter(p => { const k = p.name + p.t; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 2);
    el.innerHTML = show.length ? '<span class="rc-wx-h">Next cut-off</span> ' + show.map(p => `<span class="hq-cut"><b>${esc(p.name)}</b> ${hm(p.t)} <small>(${p.race}, in ${dur(mins(t, p.t))})</small></span>`).join(' ') : '<span class="rc-wx-h">Cut-offs</span> all passed';
  }
  function status() {
    const el = $('rcSync'); if (!el) return;
    const age = lastOk ? Math.round((now() - lastOk) / 1000) : null;
    el.className = 'rc-sync ' + (lastErr ? 'bad' : age != null && age < 20 ? 'ok' : 'warn');
    el.textContent = (lastErr ? 'Not syncing: ' + lastErr : age == null ? 'Connecting…' : 'Live') + (readQ().length ? ` · ${readQ().length} waiting to send` : '');
  }
  async function renderWx() {
    const box = $('rcWx'); if (!box || !window.WeatherTab || !window.WeatherTab.peek) return;
    const L2 = await window.WeatherTab.peek().catch(() => null);
    if (!L2 || !L2.triggers) return;
    const t = L2.triggers.next48.triggers;
    const hot = Object.values(t).filter(r => r.status === 'met' || r.status === 'close');
    box.innerHTML = '<span class="rc-wx-h">Weather 48 h</span> ' + (hot.length ? hot.map(r => `<span class="wx-pill st-${r.status}">${esc(r.label)}</span>`).join(' ') : '<span class="wx-pill st-ok">All clear</span>');
  }

  // ---------- settings (the line to the phones, set once at the briefing) ----------
  // A help request from the runner or field app arrives as an entry marked needsAck: its card flashes and HQ sounds
  // until someone presses Acknowledge, which the sender's phone then shows. The Worker only takes them while this
  // switch is on and HQ has been open in the last 3 minutes, so they never go to an empty room.
  const postLive = (path, body, done) => api(path, Object.assign({ who: who() }, body)).then(() => { lastErr = ''; if (done) done(); return sync(); }).catch(e => { lastErr = e.message; status(); renderSettings(); });
  function renderSettings() {
    const el = $('hqSettings'); if (!el || !live || !settingsOpen) return;
    const a = document.activeElement;
    if (a && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;  // someone's typing in it
    const key = JSON.stringify([live.help_on, live.field_code, live.notices, live.garmin, live.faults, live.alerts, faults && faults.map(f => [f.sig, f.n]), noticeDraft]);
    if (key === liveKey) return;
    liveKey = key;
    const N = live.notices || [], fa = live.faults || { n: 0 };
    el.innerHTML = `<div class="hq-set-grid">
      <section><h4>Notice to the phones</h4>
        <form id="rcNotice" class="rc-notice"><textarea id="rcNoticeText" rows="2" maxlength="280" placeholder="e.g. Course change at Craig's Hut: follow the pink tape.">${esc(noticeDraft.text)}</textarea>
        <div class="rc-notice-row"><select id="rcNoticeAud"><option value="all"${noticeDraft.aud === 'all' ? ' selected' : ''}>Every phone</option><option value="runner"${noticeDraft.aud === 'runner' ? ' selected' : ''}>Runners and crews</option><option value="field"${noticeDraft.aud === 'field' ? ' selected' : ''}>The field app</option></select>
        <select id="rcNoticeMins">${[['60', 'for 1 hour'], ['180', 'for 3 hours'], ['720', 'for 12 hours'], ['0', 'until taken down']].map(([v, l]) => `<option value="${v}"${noticeDraft.mins === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <label class="rc-check"><input id="rcNoticeAlert" type="checkbox"${noticeDraft.level === 'alert' ? ' checked' : ''}> Important (red)</label>
        <button class="btn small primary" type="submit">Send notice</button></form>
        ${N.length ? N.map(n => `<div class="rc-switch"><span>${n.level === 'alert' ? '<b>Important:</b> ' : ''}${esc(n.text)} <small>(${n.aud === 'runner' ? 'runners and crews' : n.aud === 'field' ? 'field app' : 'every phone'}, ${hm(n.t)}${n.until ? ' to ' + hm(n.until) : ''})</small></span><button class="btn small" type="button" data-clear="${esc(n.id)}">Take down</button></div>`).join('') : '<p class="rc-small">No notice showing on the phones.</p>'}
      </section>
      <section><h4>Help requests from the apps</h4>
        <div class="rc-switch"><span>${live.help_on ? '<b>On.</b> The runner and field apps can send a help request to HQ.' : '<b>Off.</b> The apps only offer Call 000 and Call race medical.'}</span><button class="btn small${live.help_on ? '' : ' primary'}" id="rcHelpOn" type="button">${live.help_on ? 'Turn off' : 'Turn on'}</button></div>
        <h4>Team code for the field phones</h4>
        <form id="rcCode" class="rc-logform"><input id="rcCodeText" type="text" maxlength="20" autocomplete="off" value="${esc(live.field_code || '')}" placeholder="e.g. BULLER26"><button class="btn small" type="submit">${live.field_code ? 'Change' : 'Set'}</button></form>
        <p class="rc-small">${live.field_code ? 'Give this out at the briefing. Field phones with it show under Crew and on the map.' : 'Set a team code so crew can share their position from the field app. Clear it to stop.'}</p>
        ${garminHTML()}
      </section>
      <section><h4>Downloads</h4>
        <div class="rc-switch"><span>Every position from the field phones and inReach units, as a spreadsheet.</span><button class="btn small" type="button" id="rcTracks">Tracks</button></div>
        <div class="rc-switch"><span>Every entry and the whole log, for the incident report.</span><button class="btn small" type="button" id="rcExport">Log</button></div>
        <h4>App faults</h4>
        ${fa.n ? `<div class="rc-switch"><span>${fa.n} kind${fa.n === 1 ? '' : 's'} of fault reported by phones (${fa.hits} in all), the last ${ageOf(fa.last)}.</span><button class="btn small" type="button" id="rcFaults">${faults ? 'Hide' : 'Show'}</button></div>` : '<p class="rc-small">No faults reported by the phones.</p>'}
        ${faults && fa.n ? faults.map(f => `<div class="rc-fault"><b>${esc(f.app)} app, build ${esc(f.build)}: ${esc(f.msg)}</b><span>${esc(f.src)}:${f.line} · ${f.n} time${f.n === 1 ? '' : 's'}, last ${dhm(f.last)}</span></div>`).join('') + '<button class="btn small" type="button" id="rcFaultsClear">Clear the list</button>' : ''}
      </section></div>`;
    const keepN = () => { noticeDraft = { text: $('rcNoticeText').value, aud: $('rcNoticeAud').value, mins: $('rcNoticeMins').value, level: $('rcNoticeAlert').checked ? 'alert' : 'info' }; };
    ['rcNoticeText', 'rcNoticeAud', 'rcNoticeMins', 'rcNoticeAlert'].forEach(k => $(k).addEventListener('input', keepN));
    $('rcNotice').addEventListener('submit', e => {
      e.preventDefault(); keepN();
      if (!noticeDraft.text.trim()) return flash($('rcNoticeText'));
      if (!needName()) return;
      const d = noticeDraft; noticeDraft = Object.assign({}, d, { text: '' }); document.activeElement && document.activeElement.blur();
      postLive('/rc/notice', { text: d.text.trim(), aud: d.aud, level: d.level, mins: +d.mins });
    });
    el.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => { if (needName()) postLive('/rc/notice', { id: b.dataset.clear, clear: true }); }));
    $('rcHelpOn').addEventListener('click', () => { if (needName()) postLive('/rc/settings', { patch: { help_on: !live.help_on } }); });
    $('rcCode').addEventListener('submit', e => {
      e.preventDefault();
      const v = $('rcCodeText').value.trim();
      if (v && !/^[A-Za-z0-9-]{4,20}$/.test(v)) { $('rcCodeText').value = ''; $('rcCodeText').placeholder = '4 to 20 letters or numbers'; return flash($('rcCodeText')); }
      if (!needName()) return;
      document.activeElement && document.activeElement.blur();
      postLive('/rc/settings', { patch: { field_code: v } });
    });
    $('rcTracks').addEventListener('click', downloadTracks);
    $('rcExport').addEventListener('click', exportCSV);
    if ($('rcFaults')) $('rcFaults').addEventListener('click', () => { if (faults) { faults = null; liveKey = ''; renderSettings(); } else api('/rc/faults').then(j => { faults = j.faults || []; liveKey = ''; renderSettings(); }).catch(e => { lastErr = e.message; status(); }); });
    if ($('rcFaultsClear')) $('rcFaultsClear').addEventListener('click', () => { if (needName()) postLive('/rc/faults', { clear: true }, () => { faults = null; }); });
  }
  // The sweeps' Garmin inReach units: whether the Worker is reading their MapShare, and the MapShare page itself.
  function garminHTML() {
    const g = (live && live.garmin) || {}, M = C.tracking && C.tracking.mapshare;
    const state = !g.on ? 'Not set up on the Worker yet (the GARMIN_PASSWORD secret, tools/RUNNING_WILD_WORKER.md).'
      : g.err ? 'The Worker can\'t read MapShare: ' + esc(g.err) + '.'
      : !g.last ? 'The Worker is reading MapShare; no points in the last 24 hours.'
      : now() - g.last < 6 * 3600e3 ? 'On the map in purple. Last inReach point ' + ageOf(g.last) + '.'
      : 'Last inReach point ' + new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(g.last) + ': older than 6 hours, so not on the map. They show once tracking is on.';
    return `<h4>Sweeps' Garmin inReach</h4><div class="rc-switch"><span class="rc-small">${state}</span>${M ? `<a class="btn small" href="${esc(M)}" target="_blank" rel="noopener">MapShare</a>` : ''}</div>`;
  }
  // A new help request sounds HQ (three short tones), once for each.
  function alarm() {
    const fresh = [...incidents.values()].filter(i => i.needsAck && i.status !== 'closed' && !heard.has(i.id));
    if (!fresh.length) return;
    fresh.forEach(i => heard.add(i.id));
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ac = new AC();
      [0, 0.28, 0.56].forEach(t => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ac.destination); g.gain.setValueAtTime(0.25, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.22); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.24); });
      setTimeout(() => ac.close().catch(() => { }), 1500);
    } catch (e) { }
  }

  // ---------- downloads ----------
  // The tracking test: every fix the field phones and inReach units sent in the last 3 days, from the Worker, as a CSV file.
  async function downloadTracks() {
    const btn = $('rcTracks'); if (btn) { btn.disabled = true; btn.textContent = 'Downloading...'; }
    try {
      const r = await fetch(BASE + '/rc/track?hours=72', { headers: { 'X-RC-Password': (window.MedPlan && window.MedPlan.pw()) || '' }, cache: 'no-store' });
      if (!r.ok) throw new Error(r.status === 404 ? 'The Worker needs the latest code for this' : 'Couldn\'t download (' + r.status + ')');
      const url = URL.createObjectURL(await r.blob()), a = document.createElement('a');
      a.href = url; a.download = 'field-tracks-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.csv';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { lastErr = e.message; status(); }
    if (btn) { btn.disabled = false; btn.textContent = 'Tracks'; }
  }
  function exportCSV() {
    // A leading = + - @ tab or return is a formula to a spreadsheet, so those cells get a ' first.
    const q = v => '"' + String(v == null ? '' : v).replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""') + '"';
    const rows = [['Number', 'What', 'Status', 'Bib', 'Where', 'Km', 'Details', 'Logged', 'By', 'Sorted', 'Sorted by']];
    [...incidents.values()].sort((a, b) => (a.num || 0) - (b.num || 0)).forEach(i => {
      const t = i.times || {};
      rows.push([i.num, KINDS[kindOf(i)].label, i.status === 'closed' ? 'Sorted' : 'Open', i.bib, i.where || (i.km != null ? placeAt(+i.km) : ''), i.km, i.desc, dhm(t.call || i.created), i.by || i.reporter, dhm(t.closed), i.sortedBy]);
    });
    rows.push([], ['Log'], ['Time', 'Entry', 'Text', 'By']);
    log.slice().reverse().forEach(l => { const i = l.incident && incidents.get(l.incident); rows.push([dhm(l.t), i ? '#' + i.num + (i.bib ? ' bib ' + i.bib : '') : '', l.text, l.who]); });
    const blob = new Blob([rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'RunningWild-HQ-log-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- start ----------
  let clock = null;
  function onShow() {
    shown = true;
    render();
    if (map) setTimeout(() => { if (map) map.invalidateSize(); }, 0);
    sync(); renderWx();
    clearInterval(timer); timer = setInterval(sync, 5000);
    clearInterval(clock); clock = setInterval(() => { tick(); if (Date.now() % 60000 < 1000) renderNext(); }, 1000);
  }
  function onHide() {
    shown = false;
    clearInterval(clock);
    clearInterval(timer); timer = setInterval(sync, 30000); // keep up to date in the background, more slowly
  }
  // From Find: an Injury entry at the spot, with its km and position.
  function newFromFind(r) {
    form = { kind: 'injury', bib: '', where: r.casW3w ? '///' + r.casW3w : '', desc: '', km: Math.round(r.km * 10) / 10, lat: r.q && r.q.lat != null ? r.q.lat : r.lat, lon: r.q && r.q.lat != null ? r.q.lon : r.lon };
    if (!form.where) form.where = 'km ' + form.km.toFixed(1);
    if (shown) renderForm(true);
  }
  // Rebuild only when the device locks or unlocks.
  let authState = null;
  function onAuth() {
    const st = unlocked();
    if (st === authState) return;
    authState = st;
    if (shown) { built = false; render(); sync(); }
  }
  addEventListener('online', flush);
  window.RaceControl = { onShow, onHide, onAuth, newFromFind, available: () => !!BASE };
})();
