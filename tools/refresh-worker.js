// GPT100 Safety Worker (Cloudflare): the weather refresh relay and the Race Control incident log.
// It holds the GitHub key as a secret, so the key is never in the app or on anyone's device.
// Setup steps: tools/REFRESH_WORKER.md (weather) and tools/RACE_CONTROL.md (race control).
//
//   POST /refresh            start a quick refresh (warnings, observations, fires, CFA, air quality)
//   POST /refresh?models=1   start a full refresh, including fresh forecast models
//   GET  /status             the latest weather watch run (for the app's progress message)
//   Cron trigger             starts the watch every 15 minutes (GitHub's own timer misses most runs). With a trigger
//                            every minute as well (for the alerts), the 15 minute jobs still run once every 15 minutes
//
// Race Control (needs the D1 database bound as DB, and the RC_PASSWORD secret; every call sends the password):
//   GET  /rc/state?since=ms  incidents, units and log entries changed since then
//   POST /rc/incident        create or update an incident: { id?, patch, note?, who }
//   POST /rc/unit            update a unit's status: { id, patch, note?, who }
//   POST /rc/log             add a radio log entry: { text, incident?, who }
//   GET  /rc/ra?since=ms     risk assessments changed since then (the Risk tab)
//   POST /rc/ra              create or update a risk assessment: { id, patch, note?, who }. Once it's signed off,
//                            only its actions and reviews can change (409 for anything else)
//
// Live GPS tracking relay (the tracking provider's files, with CORS headers the app can use; no key needed):
//   GET  /gps/<event>/init.txt            the event setup and competitors
//   GET  /gps/<event>/data.lst            every position so far
//   GET  /gps/<event>/data.php?offset=…   the new positions since a byte offset (live events)
//   GET  /gps/time.php                    the provider's clock
//
// Timing chip relay (the timing team's RaceResult Simple API list, tools/TIMING.md; the link lives here as a secret):
//   GET  /timing/                         the latest list as JSON, cached 20 seconds on the edge
//
// Race archive (needs the DB database and the RC_PASSWORD secret; every call sends the password, from anywhere):
//   Cron trigger             during the race window, keeps a copy of the timing list (every 15 minutes) and of each
//                            GPS event's init.txt and data.lst (every hour) in the database, for next year's predictions
//   GET  /archive/list       every copy kept: when, what, size
//   GET  /archive/part?snap=…&part=n   one piece of a copy (gzip)
//   POST /archive/now        take a copy of everything now, inside the window or not (the final copy after the race)
//   Feed health (same timer, during the race window): a GPS event with no new positions for 20 minutes while the race
//                            is on, the timing list unchanged for an hour while trackers still send, or a timing column
//                            with no reads while columns further on have them. Each new problem goes to the phone (ntfy,
//                            the NTFY_TOPIC secret), and again when it clears.
//   Download them all with tools/archive_race.mjs. Setup and use: tools/ARCHIVE.md.
//
// The line to the phones (needs the DB database; no password for the phones' side, tools/LIVE.md):
//   GET  /live               what every runner and field phone reads once a minute: notices from Race Control, whether
//                            Race Control is taking help requests, and the key for alerts
//   POST /help               a help request from the runner or field app: lands on the board as an incident. Only
//                            taken while Race Control has it switched on and a board has been open in the last 3 minutes
//   GET  /help?id=…          for the phone that sent it: whether Race Control has answered
//   POST /field/pos          a field phone's position, with the team code set on the board
//   POST /fault              an error a phone hit (app, build, file and line: no names, bibs or positions)
//   POST /push/sub, /push/unsub, GET /push/news    alerts for followed runners and notices (Web Push)
//   POST /rc/notice, /rc/settings, GET /rc/faults   Race Control's side of the above (password)
//   GET  /gps/<event>/data.lst?tail=n     only the last n bytes of the positions, for a first look on a weak signal
//   Cron trigger, every minute           new chip reads for followed runners become alerts (only in the race window)
//
// Secret:    GITHUB_TOKEN   fine-grained key, this repository only, Actions read and write
// Secret:    TIMING_URL     the RaceResult Simple API link for the timing list (optional, turns on /timing/)
// Optional:  REPO, WORKFLOW, BRANCH, ALLOWED_ORIGIN (defaults below; several origins separated by commas)
// Optional:  ARCHIVE_GPS (GPS event ids, separated by commas), ARCHIVE_FROM and ARCHIVE_TO (the race window, as
//            ISO times with the offset), defaults below. Change them for next year's race. The archive also follows every
//            GPS event in the app's published config (SITE_CONFIG, tracking.gps), so an event added on the day is kept.
// Secret:    NTFY_TOPIC     the ntfy topic for feed health alerts on the phone (optional; the weather watch's topic works)

const DEFAULTS = {
  REPO: 'SingleTrackEvents/runningwild',
  WORKFLOW: 'weather.yml',
  BRANCH: 'main',
  // https://localhost is the Android app (Capacitor serves the app from there inside the phone).
  ALLOWED_ORIGIN: 'https://singletrackevents.github.io,https://localhost',
  ARCHIVE_GPS: '',
  ARCHIVE_FROM: '2026-12-06T05:00:00+11:00',
  ARCHIVE_TO: '2026-12-06T20:00:00+11:00',
  SITE_CONFIG: 'https://singletrackevents.github.io/runningwild/data/config.js'
};
const GPS_HOST = 'https://tulospalvelu.fi/gps/';  // the GPS tracking provider (GPS-seuranta)
const gpsHost = env => (env && env.GPS_HOST) || GPS_HOST;  // (a rehearsal on a computer can point this at its own files)
const COOLDOWN_MIN = 10;        // no new run within 10 minutes of the last one
const MODELS_COOLDOWN_MIN = 30; // a full refresh at most every 30 minutes

function cfg(env) { return Object.assign({}, DEFAULTS, Object.fromEntries(Object.keys(DEFAULTS).filter(k => env[k]).map(k => [k, env[k]]))); }

async function gh(env, path, init) {
  const c = cfg(env);
  const res = await fetch(`https://api.github.com/repos/${c.REPO}${path}`, Object.assign({}, init, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'gpt100-refresh-worker',
      'Content-Type': 'application/json'
    }
  }));
  return res;
}

async function latestRun(env) {
  const c = cfg(env);
  const res = await gh(env, `/actions/workflows/${c.WORKFLOW}/runs?per_page=1`);
  if (!res.ok) throw new Error('GitHub said ' + res.status);
  const r = (await res.json()).workflow_runs[0];
  return r ? { id: r.id, status: r.status, conclusion: r.conclusion, event: r.event, created: r.created_at, updated: r.updated_at } : null;
}

// Start the watch unless one is running or started recently.
async function maybeStart(env, models) {
  const c = cfg(env);
  const last = await latestRun(env);
  const ageMin = last ? (Date.now() - Date.parse(last.created)) / 60000 : 1e9;
  if (last && last.status !== 'completed') return { started: false, reason: 'running', last };
  if (ageMin < COOLDOWN_MIN) return { started: false, reason: 'recent', last, waitMin: Math.ceil(COOLDOWN_MIN - ageMin) };
  const full = !!models && ageMin >= MODELS_COOLDOWN_MIN;
  const res = await gh(env, `/actions/workflows/${c.WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: c.BRANCH, inputs: full ? { force_models: true } : {} })
  });
  if (res.status !== 204) throw new Error('GitHub said ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return { started: true, full, last };
}

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const c = cfg(env);
  const allowed = c.ALLOWED_ORIGIN.split(',').map(s => s.trim());
  const ok = allowed.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': ok ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-RC-Password',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json'
    }
  };
}

// ---------- Race Control incident log (D1 database) ----------
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, num INTEGER, data TEXT NOT NULL, updated INTEGER NOT NULL, version INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS units (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, incident TEXT, kind TEXT, text TEXT, who TEXT, updated INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS incidents_updated ON incidents (updated)',
  'CREATE INDEX IF NOT EXISTS units_updated ON units (updated)',
  'CREATE INDEX IF NOT EXISTS log_updated ON log (updated)',
  'CREATE TABLE IF NOT EXISTS ra (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL, version INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS ra_updated ON ra (updated)'
];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map(q => db.prepare(q)));
  schemaReady = true;
}
function sameText(a, b) { // compare without leaking the length of the match
  a = String(a || ''); b = String(b || '');
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
const clip = (v, n) => v == null ? v : typeof v === 'string' ? v.slice(0, n || 2000) : v;
function cleanPatch(p) {
  const out = {};
  for (const [k, v] of Object.entries(p || {})) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = cleanPatch(v);
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = clip(v);
  }
  return out;
}
function merge(a, b) {
  const out = Object.assign({}, a);
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
  return out;
}
async function raceControl(req, env, url, c, ctx) {
  const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: c.headers });
  if (!c.ok) return json({ error: 'Not allowed from this site' }, 403);
  if (!env.DB || !env.RC_PASSWORD) return json({ error: 'Race Control isn\'t set up on the Worker yet (needs the DB database and the RC_PASSWORD secret)' }, 503);
  if (!sameText(req.headers.get('X-RC-Password'), env.RC_PASSWORD)) return json({ error: 'Wrong password' }, 401);
  const db = env.DB;
  await ensureSchema(db);
  const now = Date.now();
  if (url.pathname === '/rc/state' && req.method === 'GET') {
    const since = Math.max(0, +url.searchParams.get('since') || 0);
    await ensureLive(db);
    const ops = [
      db.prepare('SELECT id, num, data, updated, version FROM incidents WHERE updated > ?1 ORDER BY updated').bind(since),
      db.prepare('SELECT id, data, updated FROM units WHERE updated > ?1').bind(since),
      db.prepare('SELECT id, t, incident, kind, text, who FROM log WHERE updated > ?1 ORDER BY id DESC LIMIT 500').bind(since),
      // The line to the phones, whole each time (it's small): the switches, the notices showing, the field phones
      // heard from in the last 6 hours, and how many kinds of fault the phones have reported.
      db.prepare("SELECT k, v FROM settings WHERE k IN ('help_on', 'field_code')"),
      db.prepare('SELECT id, data, created, until FROM notices WHERE cleared IS NULL AND (until IS NULL OR until > ?1) ORDER BY created DESC LIMIT 20').bind(now),
      db.prepare('SELECT id, name, data, t FROM field_pos WHERE t > ?1 ORDER BY name LIMIT 200').bind(now - 6 * 3600e3),
      db.prepare('SELECT COUNT(*) AS n, MAX(last) AS last, SUM(n) AS hits FROM faults'),
      db.prepare('SELECT COUNT(*) AS n FROM push_subs')
    ];
    // A board that's open is a board that's watched: help requests from the phones are only taken while one is.
    if (now - rcBeat > 45e3) { rcBeat = now; ops.push(setSetting(db, 'rc_seen', now, now)); }
    const [inc, units, log, st, nt, fp, fa, ps] = await db.batch(ops);
    const S = Object.fromEntries(st.results.map(r => [r.k, r.v]));
    return json({
      now,
      incidents: inc.results.map(r => Object.assign(JSON.parse(r.data), { id: r.id, num: r.num, updated: r.updated, version: r.version })),
      units: units.results.map(r => Object.assign(JSON.parse(r.data), { id: r.id, updated: r.updated })),
      log: log.results,
      live: {
        help_on: S.help_on === '1', field_code: S.field_code || '',
        notices: nt.results.map(r => Object.assign(JSON.parse(r.data), { id: r.id, t: r.created, until: r.until })),
        field: fp.results.map(r => Object.assign(JSON.parse(r.data), { id: r.id, name: r.name, t: r.t })),
        faults: fa.results[0] || { n: 0 }, alerts: (ps.results[0] || {}).n || 0
      }
    });
  }
  // The tracking test: every fix from the field phones, as a spreadsheet (CSV). ?hours=24 by default.
  if (url.pathname === '/rc/track' && req.method === 'GET') {
    await ensureLive(db);
    const hours = Math.min(24 * 14, Math.max(1, +url.searchParams.get('hours') || 24));
    const rows = (await db.prepare('SELECT id, name, t, recv, lat, lon, acc, km, course, off_m, bat, charging, spd, src, bg FROM field_track WHERE t > ?1 ORDER BY name, t LIMIT 100000').bind(now - hours * 3600e3).all()).results;
    const cell = v => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    const iso = ms => new Date(ms).toISOString();
    const head = ['phone', 'call_sign', 'fix_time_utc', 'received_utc', 'delay_s', 'lat', 'lon', 'accuracy_m', 'km', 'course', 'off_course_m', 'battery_pct', 'charging', 'speed_ms', 'app', 'background'];
    const lines = rows.map(r => [r.id.slice(0, 8), r.name, iso(r.t), iso(r.recv), Math.round((r.recv - r.t) / 1000), r.lat, r.lon, r.acc, r.km, r.course, r.off_m,
      r.bat == null ? '' : Math.round(r.bat * 100), r.charging == null ? '' : r.charging ? 'yes' : 'no', r.spd, r.src, r.bg ? 'yes' : 'no'].map(cell).join(','));
    return new Response([head.join(',')].concat(lines).join('\n') + '\n', { headers: Object.assign({}, c.headers, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="field-tracks.csv"' }) });
  }
  if (url.pathname === '/rc/faults' && req.method === 'GET') {
    await ensureLive(db);
    const r = await db.prepare('SELECT sig, data, n, first, last FROM faults ORDER BY last DESC LIMIT 60').all();
    return json({ now, faults: r.results.map(x => Object.assign(JSON.parse(x.data), { sig: x.sig, n: x.n, first: x.first, last: x.last })) });
  }
  if (url.pathname === '/rc/ra' && req.method === 'GET') {
    const since = Math.max(0, +url.searchParams.get('since') || 0);
    const r = await db.prepare('SELECT id, data, updated, version FROM ra WHERE updated > ?1 ORDER BY updated').bind(since).all();
    return json({ now, ra: r.results.map(x => Object.assign(JSON.parse(x.data), { id: x.id, updated: x.updated, version: x.version })) });
  }
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
  const text = await req.text();
  if (text.length > 32000) return json({ error: 'Too big' }, 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ error: 'Bad request' }, 400); }
  const who = clip(String(body.who || ''), 60);
  const addLog = (incident, kind, t) => db.prepare('INSERT INTO log (t, incident, kind, text, who, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(now, incident, kind, clip(String(t), 1000), who, now);
  if (url.pathname === '/rc/incident') {
    const patch = cleanPatch(body.patch);
    let id = typeof body.id === 'string' && /^[A-Za-z0-9-]{4,40}$/.test(body.id) ? body.id : null;
    const old = id ? await db.prepare('SELECT num, data, version FROM incidents WHERE id = ?1').bind(id).first() : null;
    let num, data, version;
    if (old) { num = old.num; data = merge(JSON.parse(old.data), patch); version = old.version + 1; }
    else {
      id = id || 'i' + now.toString(36) + Math.random().toString(36).slice(2, 6);
      num = ((await db.prepare('SELECT MAX(num) AS n FROM incidents').first()) || {}).n + 1 || 1;
      data = Object.assign({ created: now, status: 'open' }, patch); version = 1;
    }
    const ops = [db.prepare('INSERT INTO incidents (id, num, data, updated, version) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET data = ?3, updated = ?4, version = ?5').bind(id, num, JSON.stringify(data), now, version)];
    if (body.note) ops.push(addLog(id, 'incident', '#' + num + ' ' + body.note));
    await db.batch(ops);
    return json({ ok: true, incident: Object.assign(data, { id, num, updated: now, version }) });
  }
  if (url.pathname === '/rc/unit') {
    if (typeof body.id !== 'string' || !/^[A-Za-z0-9 _.:-]{1,60}$/.test(body.id)) return json({ error: 'Bad unit' }, 400);
    const old = await db.prepare('SELECT data FROM units WHERE id = ?1').bind(body.id).first();
    const data = merge(old ? JSON.parse(old.data) : {}, cleanPatch(body.patch));
    const ops = [db.prepare('INSERT INTO units (id, data, updated) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET data = ?2, updated = ?3').bind(body.id, JSON.stringify(data), now)];
    if (body.note) ops.push(addLog(data.incident || null, 'unit', body.note));
    await db.batch(ops);
    return json({ ok: true, unit: Object.assign(data, { id: body.id, updated: now }) });
  }
  // Risk assessments (the race-morning dynamic risk assessment, RMP Appendix A). Signed off means locked:
  // after that only the actions (ticked off as they're done) and reviews can change.
  if (url.pathname === '/rc/ra') {
    if (typeof body.id !== 'string' || !/^[A-Za-z0-9-]{4,40}$/.test(body.id)) return json({ error: 'Bad assessment' }, 400);
    const patch = cleanPatch(body.patch);
    const old = await db.prepare('SELECT data, version FROM ra WHERE id = ?1').bind(body.id).first();
    const cur = old ? JSON.parse(old.data) : null;
    if (cur && cur.signed && cur.signed.at && Object.keys(patch).some(k => k !== 'actions' && k !== 'reviews')) return json({ error: 'That assessment is signed off', ra: Object.assign(cur, { id: body.id, version: old.version }) }, 409);
    const data = cur ? merge(cur, patch) : Object.assign({ created: now }, patch), version = old ? old.version + 1 : 1;
    const ops = [db.prepare('INSERT INTO ra (id, data, updated, version) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET data = ?2, updated = ?3, version = ?4').bind(body.id, JSON.stringify(data), now, version)];
    if (body.note) ops.push(addLog(null, 'risk', body.note));
    await db.batch(ops);
    return json({ ok: true, ra: Object.assign(data, { id: body.id, updated: now, version }) });
  }
  // A notice to the phones: a banner in the runner app, the field app or both, and an alert to everyone who has
  // alerts on. { text, level: 'info' | 'alert', aud: 'all' | 'runner' | 'field', mins } or { id, clear: true }.
  if (url.pathname === '/rc/notice') {
    await ensureLive(db);
    liveMemo.t = 0;
    if (body.clear) {
      const id = String(body.id || '').slice(0, 40), old = await db.prepare('SELECT data FROM notices WHERE id = ?1').bind(id).first();
      if (!old) return json({ error: 'No such notice' }, 404);
      await db.batch([db.prepare('UPDATE notices SET cleared = ?2, updated = ?2 WHERE id = ?1').bind(id, now), addLog(null, 'notice', 'Notice taken down: ' + (JSON.parse(old.data).text || ''))]);
      return json({ ok: true });
    }
    const text = clip(String(body.text || '').trim(), 400);
    if (!text) return json({ error: 'Empty' }, 400);
    const level = body.level === 'alert' ? 'alert' : 'info', aud = ['runner', 'field'].includes(body.aud) ? body.aud : 'all';
    const mins = Math.min(7 * 1440, Math.max(0, +body.mins || 0)), until = mins ? now + mins * 60e3 : null;
    const id = 'n' + now.toString(36) + Math.random().toString(36).slice(2, 6), data = { text, level, aud, by: who };
    const to = aud === 'all' ? 'every phone' : aud === 'runner' ? 'runners and crews' : 'the field app';
    await db.batch([
      db.prepare('INSERT INTO notices (id, data, created, until, cleared, updated) VALUES (?1, ?2, ?3, ?4, NULL, ?3)').bind(id, JSON.stringify(data), now, until),
      db.prepare('INSERT INTO push_msgs (bib, t, title, text, url) VALUES (?1, ?2, ?3, ?4, ?5)').bind(aud === 'all' ? '*' : aud + '*', now, level === 'alert' ? 'GPT100: important' : 'GPT100 Race Control', text, ''),
      addLog(null, 'notice', `Notice to ${to}${level === 'alert' ? ' (important)' : ''}: ${text}`)
    ]);
    // Straight to the phones with alerts on, without waiting for the next timer.
    if (ctx) ctx.waitUntil(pushTickle(env, db, now).catch(() => { }));
    return json({ ok: true, notice: Object.assign(data, { id, t: now, until }) });
  }
  // The board's switches for the phones: whether help requests are taken, and the team code for field phones.
  if (url.pathname === '/rc/settings') {
    await ensureLive(db);
    liveMemo.t = 0;
    const p = body.patch || {}, ops = [];
    if (typeof p.help_on === 'boolean') { ops.push(setSetting(db, 'help_on', p.help_on ? '1' : '0', now), addLog(null, 'settings', p.help_on ? 'Help requests from the apps: on' : 'Help requests from the apps: off')); }
    if (typeof p.field_code === 'string') {
      const code = p.field_code.trim().slice(0, 20);
      if (code && !/^[A-Za-z0-9-]{4,20}$/.test(code)) return json({ error: 'A team code is 4 to 20 letters or numbers' }, 400);
      ops.push(setSetting(db, 'field_code', code, now), addLog(null, 'settings', code ? 'Field phones can share their position (team code set)' : 'Field position sharing: off'));
    }
    if (ops.length) await db.batch(ops);
    return json({ ok: true });
  }
  if (url.pathname === '/rc/faults') {
    await ensureLive(db);
    if (body.clear) await db.batch([db.prepare('DELETE FROM faults'), addLog(null, 'settings', 'App fault reports cleared')]);
    return json({ ok: true });
  }
  if (url.pathname === '/rc/log') {
    if (!body.text) return json({ error: 'Empty' }, 400);
    await addLog(typeof body.incident === 'string' ? body.incident.slice(0, 40) : null, 'note', body.text).run();
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}

// ---------- Race archive (D1 database) ----------
// Copies of the timing list and the GPS files, kept so next year's predictions can be fitted to how this year's field
// ran. The feeds only hold the latest state (and the providers may take an event down after the race), so the Worker
// keeps its own copies. A copy the same as the last one isn't kept again. Each copy is stored gzipped, in pieces small
// enough for a D1 row. Names and GPS tracks stay here, behind the password, never in the public repository.
const ARCHIVE_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS archive (id INTEGER PRIMARY KEY AUTOINCREMENT, snap TEXT NOT NULL, t INTEGER NOT NULL, kind TEXT NOT NULL, event TEXT NOT NULL, part INTEGER NOT NULL, parts INTEGER NOT NULL, size INTEGER NOT NULL, sha TEXT NOT NULL, enc TEXT NOT NULL, body BLOB NOT NULL)',
  'CREATE INDEX IF NOT EXISTS archive_kind ON archive (kind, event, t)',
  'CREATE INDEX IF NOT EXISTS archive_snap ON archive (snap, part)'
];
const ARCHIVE_PART = 1500000;   // bytes per piece (D1 rows hold up to 2 MB)
const ARCHIVE_GPS_MIN = 60;     // minutes between copies of each GPS event's data.lst (it holds every fix so far)
// Each data.lst copy holds every fix before it, so older copies are thinned out to keep the database small (D1's free
// plan allows 500 MB a database, shared with Race Control): the 2 latest are kept, and the last one of every 12 hours.
const ARCHIVE_GPS_KEEP = 2, ARCHIVE_GPS_BLOCK = 12 * 3600e3;
let archiveReady = false;
async function ensureArchive(db) {
  if (archiveReady) return;
  await db.batch(ARCHIVE_SCHEMA.map(q => db.prepare(q)));
  archiveReady = true;
}
async function gzip(buf) {
  return new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
async function sha256(buf) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Keep one copy (unless it's the same as the last one of its kind).
async function keepCopy(db, kind, event, buf, t) {
  const sha = await sha256(buf);
  const last = await db.prepare('SELECT sha FROM archive WHERE kind = ?1 AND event = ?2 AND part = 0 ORDER BY t DESC LIMIT 1').bind(kind, event).first();
  if (last && last.sha === sha) return { kind, event, same: true, size: buf.byteLength };
  const z = await gzip(buf), parts = Math.max(1, Math.ceil(z.length / ARCHIVE_PART)), snap = `${kind}:${event}:${t}`;
  const ops = [];
  for (let i = 0; i < parts; i++) {
    ops.push(db.prepare('INSERT INTO archive (snap, t, kind, event, part, parts, size, sha, enc, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)')
      .bind(snap, t, kind, event, i, parts, buf.byteLength, sha, 'gzip', z.slice(i * ARCHIVE_PART, (i + 1) * ARCHIVE_PART).buffer));
  }
  await db.batch(ops);
  return { kind, event, kept: snap, size: buf.byteLength, gz: z.length, parts };
}
// One round of copies: the timing list, then each GPS event's competitors and (once an hour) its positions.
// Outside the race window it does nothing, unless forced (POST /archive/now).
async function archiveRun(env, force) {
  if (!env.DB) return { error: 'The archive needs the DB database bound to the Worker' };
  const c = cfg(env), now = Date.now();
  const from = Date.parse(c.ARCHIVE_FROM), to = Date.parse(c.ARCHIVE_TO);
  if (!force && !(now >= from && now <= to)) return { skipped: 'outside the race window', from: c.ARCHIVE_FROM, to: c.ARCHIVE_TO };
  const db = env.DB;
  await ensureArchive(db);
  const out = [];
  let timingBuf = null;
  const grab = async (kind, event, url, ttl) => {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'GPT100 archive' }, cf: { cacheTtl: ttl, cacheEverything: true } });
      // An event set up but not started has no data.lst yet (403 or 404): nothing to keep.
      if (!res.ok) { out.push({ kind, event, status: res.status }); return; }
      const buf = await res.arrayBuffer();
      if (kind === 'timing') timingBuf = buf;
      out.push(await keepCopy(db, kind, event, buf, now));
    } catch (e) { out.push({ kind, event, error: e.message }); }
  };
  if (env.TIMING_URL) await grab('timing', '', env.TIMING_URL, 20);
  else out.push({ kind: 'timing', error: 'no TIMING_URL secret' });
  const events = await archiveEvents(c);
  for (const ev of events) {
    await grab('gps-init', ev, gpsHost(env) + ev + '/init.txt', 60);
    const last = await db.prepare('SELECT MAX(t) AS t FROM archive WHERE kind = ?1 AND event = ?2').bind('gps-data', ev).first();
    // A couple of minutes' grace, so a cron run a little early still takes the hourly copy.
    if (force || !last || !last.t || now - last.t >= (ARCHIVE_GPS_MIN - 3) * 60e3) await grab('gps-data', ev, gpsHost(env) + ev + '/data.lst', 15);
    await db.prepare(`DELETE FROM archive WHERE kind = 'gps-data' AND event = ?1
      AND t NOT IN (SELECT t FROM archive WHERE kind = 'gps-data' AND event = ?1 AND part = 0 ORDER BY t DESC LIMIT ?2)
      AND t NOT IN (SELECT MAX(t) FROM archive WHERE kind = 'gps-data' AND event = ?1 GROUP BY CAST(t / ?3 AS INTEGER))`).bind(ev, ARCHIVE_GPS_KEEP, ARCHIVE_GPS_BLOCK).run();
  }
  let health = [];
  try { health = await feedHealth(env, db, now, events, timingBuf); await alertHealth(env, db, health); } catch (e) { health = [{ key: 'error', level: 'warn', text: 'Feed health check failed: ' + e.message }]; }
  return { at: new Date(now).toISOString(), events, copies: out, health };
}
// The GPS events to keep: ARCHIVE_GPS, plus every event in the app's published config (tracking.gps).
async function archiveEvents(c) {
  const ids = new Set(String(c.ARCHIVE_GPS || '').split(',').map(x => x.trim()));
  try {
    const res = await fetch(c.SITE_CONFIG, { headers: { 'User-Agent': 'GPT100 archive' }, cf: { cacheTtl: 300, cacheEverything: true } });
    const m = res.ok && (await res.text()).match(/\bgps:\s*\[([^\]]*)\]/);
    if (m) for (const q of m[1].match(/['"][A-Za-z0-9_-]{1,80}['"]/g) || []) ids.add(q.slice(1, -1));
  } catch (e) { }
  return [...ids].filter(x => /^[A-Za-z0-9_-]{1,80}$/.test(x));
}

// ---------- Feed health (during the race window, on the archive's timer) ----------
// The problems GPT100 2026 had, found by people late or not at all: a GPS event that stopped sending part way through
// (81 min), a timing reader that never read anyone (Copper Mine Track, the whole race), and so on. The app's own Feed
// health panel checks more (chip times ahead of the clock, a race with no chip times); this one reaches the phone.
const TIMING_META = /^(place|rank|pos|position|overall|status|state|bib|bibno|no|number|startno|startnumber|name|fullname|firstname|lastname|surname|contest|contestname|race|racename|event|eventname|distance|category|course|gender|sex|age|agegroup|agegrp|agecategory|agecat|ageclass|ag|division|div|yob|yearofbirth|birthyear|club|team|nation|country|time|nettime|chiptime|guntime|racetime|elapsed|diff|difference|gap|behind|id|pid)$/;
function timingRows(j) {
  let rows = Array.isArray(j) ? j : [], labels = null;
  if (!Array.isArray(j) && j && typeof j === 'object') {
    const d = j.data != null ? j.data : j.rows != null ? j.rows : Array.isArray(j.list) ? j.list : null;
    if (Array.isArray(d)) rows = d; else if (d && typeof d === 'object') for (const v of Object.values(d)) if (Array.isArray(v)) rows = rows.concat(v);
    const F = j.list && Array.isArray(j.list.Fields) ? j.list.Fields : null;
    if (F) labels = F.map(f => typeof f === 'string' ? f : (f.Label || f.Expression || ''));
  }
  if (rows.length && Array.isArray(rows[0]) && labels) rows = rows.map(r => Object.fromEntries(labels.map((l, i) => [l, r[i]])));
  return rows.filter(r => r && typeof r === 'object' && !Array.isArray(r));
}
async function feedHealth(env, db, now, events, timingBuf) {
  const issues = [], mins = ms => Math.round(ms / 60e3);
  const lastTiming = ((await db.prepare("SELECT MAX(t) AS t FROM archive WHERE kind = 'timing'").first()) || {}).t || 0;
  const raceOn = lastTiming && now - lastTiming < 60 * 60e3;  // the timing list changed in the last hour
  const gpsAge = {};
  for (const ev of events) {
    try {
      const res = await fetch(gpsHost(env) + ev + '/data.lst', { method: 'HEAD', headers: { 'User-Agent': 'GPT100 health' } });
      const lm = res.ok ? Date.parse(res.headers.get('Last-Modified') || '') : NaN;
      if (lm) gpsAge[ev] = now - lm;
    } catch (e) { }
  }
  if (raceOn) for (const [ev, age] of Object.entries(gpsAge)) if (age > 20 * 60e3 && age < 12 * 3600e3)
    issues.push({ key: 'gps-quiet:' + ev, level: 'bad', text: `GPS event ${ev}: no new positions for ${mins(age)} min while the race is on. It may have stopped: check the provider for another event the trackers send to, and add it to tracking.gps.` });
  if (env.TIMING_URL && lastTiming && !raceOn && now - lastTiming < 12 * 3600e3 && Object.values(gpsAge).some(a => a < 10 * 60e3))
    issues.push({ key: 'timing-still', level: 'warn', text: `Timing list: no change for ${mins(now - lastTiming)} min while trackers are still sending. Is the timing feed stuck?` });
  if (timingBuf) {
    try {
      const rows = timingRows(JSON.parse(new TextDecoder().decode(timingBuf))), cols = [], n = {};
      for (const r of rows) for (const [k, v] of Object.entries(r)) {
        if (!(k in n)) { n[k] = 0; cols.push(k); }
        const sv = String(v == null ? '' : v).trim();
        if (/\d:\d\d/.test(sv) && !/^[0:.]+$/.test(sv)) n[k]++;
      }
      const pts = cols.filter(k => !TIMING_META.test(k.toLowerCase().replace(/[^a-z]/g, '')));
      pts.forEach((k, i) => {
        const further = Math.max(0, ...pts.slice(i + 1).map(x => n[x]));
        if (!n[k] && further >= 10) issues.push({ key: 'no-reads:' + k, level: 'warn', text: `Timing list: no reads at ${k}, though ${further} runners have been read further on. Is that reader up?` });
      });
    } catch (e) { }
  }
  return issues;
}
async function alertHealth(env, db, issues) {
  await db.prepare('CREATE TABLE IF NOT EXISTS health (key TEXT PRIMARY KEY, level TEXT NOT NULL, text TEXT NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL)').run();
  const now = Date.now(), prev = (await db.prepare('SELECT key, text FROM health').all()).results;
  const fresh = issues.filter(i => !prev.some(p => p.key === i.key)), gone = prev.filter(p => !issues.some(i => i.key === p.key));
  const ops = issues.map(i => db.prepare('INSERT INTO health (key, level, text, first, last) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT(key) DO UPDATE SET level = ?2, text = ?3, last = ?4').bind(i.key, i.level, i.text, now));
  for (const g of gone) ops.push(db.prepare('DELETE FROM health WHERE key = ?1').bind(g.key));
  if (ops.length) await db.batch(ops);
  if (!env.NTFY_TOPIC) return;
  const send = (title, body, priority, tags) => fetch('https://ntfy.sh/' + encodeURIComponent(env.NTFY_TOPIC), { method: 'POST', body,
    headers: { Title: title, Priority: String(priority), Tags: tags, Click: 'https://singletrackevents.github.io/runningwild/' } }).catch(() => { });
  for (const i of fresh) await send(i.level === 'bad' ? 'GPT100 feed problem' : 'GPT100 feed warning', i.text, i.level === 'bad' ? 4 : 3, 'satellite');
  for (const g of gone) await send('GPT100 feed problem cleared', 'Cleared: ' + g.text, 2, 'white_check_mark');
}
// The archive endpoints. They're behind the medical password (RC_PASSWORD) but, unlike Race Control, don't need the
// app's site: tools/archive_race.mjs calls them from a computer.
async function archiveApi(req, env, url, c) {
  const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: c.headers });
  if (!env.DB || !env.RC_PASSWORD) return json({ error: 'The archive isn\'t set up on the Worker yet (needs the DB database and the RC_PASSWORD secret)' }, 503);
  if (!sameText(req.headers.get('X-RC-Password'), env.RC_PASSWORD)) return json({ error: 'Wrong password' }, 401);
  const db = env.DB;
  await ensureArchive(db);
  if (url.pathname === '/archive/list' && req.method === 'GET') {
    const r = await db.prepare('SELECT snap, t, kind, event, parts, size, sha FROM archive WHERE part = 0 ORDER BY t, kind, event').all();
    const tot = await db.prepare('SELECT COUNT(*) AS n, SUM(LENGTH(body)) AS bytes FROM archive').first();
    const c2 = cfg(env);
    return json({ now: Date.now(), window: { from: c2.ARCHIVE_FROM, to: c2.ARCHIVE_TO }, gps: (await archiveEvents(c2)).join(','), stored: tot, copies: r.results });
  }
  if (url.pathname === '/archive/part' && req.method === 'GET') {
    const row = await db.prepare('SELECT body FROM archive WHERE snap = ?1 AND part = ?2').bind(String(url.searchParams.get('snap') || ''), +url.searchParams.get('part') || 0).first();
    if (!row) return json({ error: 'No such copy' }, 404);
    return new Response(new Uint8Array(row.body), { headers: Object.assign({}, c.headers, { 'Content-Type': 'application/gzip' }) });
  }
  if (url.pathname === '/archive/now' && req.method === 'POST') return json(await archiveRun(env, true));
  return json({ error: 'Not found' }, 404);
}

// Relay the tracking provider's plain text files. The provider only lets its own viewer read them from a browser,
// so the app reads them through here. Cached briefly on the edge so a room full of phones is one request upstream.
async function gpsRelay(req, env, url, c) {
  const m = url.pathname.match(/^\/gps\/(?:([A-Za-z0-9_-]{1,80})\/)?(init\.txt|data\.lst|data\.php|time\.php)$/);
  if (!m || (!m[1] && m[2] !== 'time.php')) return new Response('Not found', { status: 404, headers: c.headers });
  if (!c.ok) return new Response('Not allowed from this site', { status: 403, headers: c.headers });
  const qs = new URLSearchParams();
  for (const k of ['offset', 'reset', 'data', 'a']) if (url.searchParams.has(k)) qs.set(k, url.searchParams.get(k).slice(0, 80));
  const upstream = gpsHost(env) + (m[1] ? m[1] + '/' : '') + m[2] + (qs.toString() ? '?' + qs : '');
  const ttl = m[2] === 'init.txt' ? 60 : m[2] === 'data.lst' ? 15 : 5;
  const res = await fetch(upstream, { headers: { 'User-Agent': 'GPT100 relay' }, cf: { cacheTtl: ttl, cacheEverything: true } });
  const headers = Object.assign({}, c.headers, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=' + ttl,
    'Access-Control-Expose-Headers': 'X-GPS-Server-Filesize, X-GPS-Server-Reset'
  });
  for (const h of ['X-GPS-Server-Filesize', 'X-GPS-Server-Reset']) if (res.headers.get(h)) headers[h] = res.headers.get(h);
  // ?tail=n on the positions file: only the last n bytes, from the start of a line. Late in the race the whole file
  // is several MB, too much for a first look on one bar; its end holds every tracker's latest fixes. The size it
  // reports is still the whole file's, so the phone carries on from there with data.php as usual.
  const tail = m[2] === 'data.lst' ? Math.min(3e6, Math.max(0, Math.floor(+url.searchParams.get('tail') || 0))) : 0;
  if (tail && res.ok) {
    const buf = new Uint8Array(await res.arrayBuffer());
    let i = Math.max(0, buf.length - tail);
    while (i > 0 && i < buf.length && buf[i - 1] !== 10) i++;
    headers['X-GPS-Server-Filesize'] = headers['X-GPS-Server-Filesize'] || String(buf.length);
    headers['X-GPS-Tail'] = String(buf.length - i) + '/' + buf.length;
    headers['Access-Control-Expose-Headers'] += ', X-GPS-Tail';
    return new Response(buf.subarray(i), { status: 200, headers });
  }
  return new Response(res.body, { status: res.status, headers });
}

// Relay the timing team's RaceResult list. The Simple API link is a secret here, so it's never in the app or on a
// phone, and the edge cache keeps a room full of phones to one request upstream every 20 seconds
// (RaceResult allows one call a second per link and caches its answer for 10 to 30 seconds anyway).
async function timingRelay(req, env, url, c) {
  const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: c.headers });
  if (!c.ok) return json({ error: 'Not allowed from this site' }, 403);
  if (!env.TIMING_URL) return json({ error: 'Timing isn\'t set up on the Worker yet (needs the TIMING_URL secret)' }, 503);
  const res = await fetch(env.TIMING_URL, { headers: { 'User-Agent': 'GPT100 relay' }, cf: { cacheTtl: 20, cacheEverything: true } });
  if (!res.ok) return json({ error: 'The timing feed said ' + res.status }, 502);
  return new Response(res.body, { status: 200, headers: Object.assign({}, c.headers, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=20' }) });
}

// ---------- The line to the phones: notices, help requests, field phones, fault reports and alerts ----------
// The runner and field apps read /live once a minute, and can send a help request, their position (field app, with
// the team code), a fault report and an alert subscription, all without the password. Race Control's side is behind
// it (/rc/notice, /rc/settings, /rc/faults and /rc/state above). Everything a phone sends is size-limited, checked
// and rate-limited, and none of it needs a new secret: the alert keys are made here and kept in the database.
// Setup and what each part does: tools/LIVE.md.
const LIVE_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY, data TEXT NOT NULL, created INTEGER NOT NULL, until INTEGER, cleared INTEGER, updated INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS field_pos (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, t INTEGER NOT NULL, updated INTEGER NOT NULL)',
  // Every fix a field phone sends, kept for the tracking test (field_pos only keeps the latest, for the board's map).
  // src: 'web' (the field app in a browser) or 'apk' (the Android app, which also sends while the screen is off).
  'CREATE TABLE IF NOT EXISTS field_track (n INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, name TEXT NOT NULL, t INTEGER NOT NULL, recv INTEGER NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, acc REAL, km REAL, course TEXT, off_m REAL, bat REAL, charging INTEGER, spd REAL, src TEXT, bg INTEGER)',
  'CREATE INDEX IF NOT EXISTS field_track_id ON field_track (id, t)',
  'CREATE TABLE IF NOT EXISTS faults (sig TEXT PRIMARY KEY, data TEXT NOT NULL, n INTEGER NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS rate (k TEXT PRIMARY KEY, n INTEGER NOT NULL, t INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS push_subs (id TEXT PRIMARY KEY, endpoint TEXT NOT NULL, app TEXT NOT NULL, bibs TEXT NOT NULL, notices INTEGER NOT NULL, seen INTEGER NOT NULL, tickle INTEGER NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS push_msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, bib TEXT NOT NULL, t INTEGER NOT NULL, title TEXT, text TEXT NOT NULL, url TEXT)',
  'CREATE INDEX IF NOT EXISTS push_msgs_bib ON push_msgs (bib, id)'
];
// Where a phone's position is believed: Victoria and southern NSW, for every Running Wild event (the GPT100's own
// Worker took the Grampians only, which turned away every fix from Mt Buller, the Prom, Baw Baw and the Alps).
const AREA = { lat: [-39.6, -33.5], lon: [140.5, 150.5] };
const HELP_WATCH_MS = 3 * 60e3;   // help requests are taken while a board has been open this recently
let liveReady = false, rcBeat = 0, liveMemo = { t: 0, v: null };
async function ensureLive(db) {
  if (liveReady) return;
  await db.batch(SCHEMA.concat(LIVE_SCHEMA).map(q => db.prepare(q)));
  liveReady = true; schemaReady = true;
}
const setSetting = (db, k, v, now) => db.prepare('INSERT INTO settings (k, v, updated) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, updated = ?3').bind(k, String(v), now);
const getSetting = async (db, k) => ((await db.prepare('SELECT v FROM settings WHERE k = ?1').bind(k).first()) || {}).v;
// One 15 minute slot: true for the first caller in it (two timers can both fire on the quarter hour).
async function claimQuarter(db, now) {
  await ensureLive(db);
  const r = await db.prepare("INSERT INTO settings (k, v, updated) VALUES ('job15', ?1, ?1) ON CONFLICT(k) DO UPDATE SET v = ?1, updated = ?1 WHERE settings.updated <= ?2").bind(now, now - 14 * 60e3).run();
  return !!(r.meta && r.meta.changes);
}
// Who's asking, for the rate limits: the address, hashed with the day, so no address is kept.
async function caller(req) {
  return (await sha256(new TextEncoder().encode('gpt100|' + (req.headers.get('CF-Connecting-IP') || '') + '|' + new Date().toISOString().slice(0, 10)))).slice(0, 16);
}
// At most max calls per key in the window.
async function allow(db, key, max, ms) {
  const now = Date.now(), row = await db.prepare('SELECT n, t FROM rate WHERE k = ?1').bind(key).first();
  if (row && now - row.t < ms) {
    if (row.n >= max) return false;
    await db.prepare('UPDATE rate SET n = n + 1 WHERE k = ?1').bind(key).run();
    return true;
  }
  await db.prepare('INSERT INTO rate (k, n, t) VALUES (?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET n = 1, t = ?2').bind(key, now).run();
  return true;
}
const num = (v, lo, hi) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? +v : NaN; return isFinite(n) && n >= lo && n <= hi ? n : null; };
const txt = (v, n) => typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n) : '';

// What every phone reads: the notices showing, whether help requests are being taken, and the alert key.
async function liveState(env) {
  const now = Date.now();
  if (liveMemo.v && now - liveMemo.t < 10e3) return Object.assign({ now }, liveMemo.v);
  const db = env.DB;
  await ensureLive(db);
  const [st, nt] = await db.batch([
    db.prepare("SELECT k, v FROM settings WHERE k IN ('help_on', 'rc_seen', 'field_code', 'vapid_pub')"),
    db.prepare('SELECT id, data, created, until FROM notices WHERE cleared IS NULL AND (until IS NULL OR until > ?1) ORDER BY created DESC LIMIT 10').bind(now)
  ]);
  const S = Object.fromEntries(st.results.map(r => [r.k, r.v]));
  const v = {
    notices: nt.results.map(r => { const d = JSON.parse(r.data); return { id: r.id, text: d.text, level: d.level, aud: d.aud, t: r.created, until: r.until }; }),
    help: { open: S.help_on === '1' && now - (+S.rc_seen || 0) < HELP_WATCH_MS },
    field: { on: !!S.field_code },
    push: { key: S.vapid_pub || (await vapid(db)).pub }
  };
  liveMemo = { t: now, v };
  return Object.assign({ now }, v);
}

async function liveApi(req, env, url, c, ctx) {
  const json = (o, status, extra) => new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({}, c.headers, extra) });
  if (!env.DB) return json({ error: 'The line to the phones isn\'t set up on the Worker yet (it needs the DB database)' }, 503);
  const db = env.DB, now = Date.now(), path = url.pathname;
  if (path === '/live' && req.method === 'GET') return json(await liveState(env), 200, { 'Cache-Control': 'public, max-age=15' });
  if (!c.ok) return json({ error: 'Not allowed from this site' }, 403);
  await ensureLive(db);

  // For the phone that sent a help request: whether Race Control has answered. Its id is the key (made on the phone, long and random).
  if (path === '/help' && req.method === 'GET') {
    const id = String(url.searchParams.get('id') || '');
    if (!/^[A-Za-z0-9-]{12,36}$/.test(id)) return json({ error: 'Bad request' }, 400);
    const row = await db.prepare('SELECT num, data FROM incidents WHERE id = ?1').bind('h-' + id).first();
    if (!row) return json({ found: false });
    const d = JSON.parse(row.data), t = d.times || {};
    return json({ found: true, num: row.num, ack: d.ackAt || null, sent: t.dispatched || null, onScene: t.onScene || null, closed: d.status === 'closed' });
  }
  if (path === '/push/news' && req.method === 'GET') return json(await pushNews(db, String(url.searchParams.get('ep') || ''), now));
  if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
  const raw = await req.text();
  if (raw.length > 6000) return json({ error: 'Too big' }, 413);
  let b;
  try { b = JSON.parse(raw); } catch (e) { return json({ error: 'Bad request' }, 400); }
  if (!b || typeof b !== 'object') return json({ error: 'Bad request' }, 400);
  const ip = await caller(req);

  // A help request from a phone. Call 000 comes first in the apps; this puts the runner on the board as an incident,
  // with their position, for whoever is at the board. Sending it again (a retry on a weak signal) changes nothing.
  if (path === '/help') {
    const id = txt(b.id, 40);
    if (!/^[A-Za-z0-9-]{12,36}$/.test(id)) return json({ error: 'Bad request' }, 400);
    const old = await db.prepare('SELECT num FROM incidents WHERE id = ?1').bind('h-' + id).first();
    if (old) return json({ ok: true, num: old.num, again: true });
    const S = await liveState(env);
    if (!S.help.open) return json({ closed: true, error: 'Race Control isn\'t taking messages from the app right now' }, 409);
    if (!(await allow(db, 'help:' + ip, 10, 10 * 60e3)) || !(await allow(db, 'help:all', 60, 10 * 60e3))) return json({ error: 'Too many messages. Call race medical or 000.' }, 429);
    const app = b.app === 'field' ? 'field' : 'runner', urgent = b.urgent === true;
    const lat = num(b.lat, AREA.lat[0], AREA.lat[1]), lon = num(b.lon, AREA.lon[0], AREA.lon[1]), km = num(b.km, 0, 300), bib = txt(b.bib, 8).replace(/[^0-9A-Za-z]/g, '');
    const what = txt(b.what, 400), name = txt(b.name, 60), from = txt(b.from, 40);
    if (lat == null && km == null && !what) return json({ error: 'Nothing to send' }, 400);
    const data = {
      created: now, status: 'open', severity: urgent ? 'urgent' : 'priority', source: app, needsAck: true, times: { call: now },
      course: txt(b.course, 12) || undefined, km: km != null ? Math.round(km * 10) / 10 : undefined, lat: lat != null ? lat : undefined, lon: lon != null ? lon : undefined,
      acc: num(b.acc, 0, 100000) || undefined, fixT: num(b.t, 0, 1e14) || undefined, w3w: txt(b.w3w, 60).replace(/[^\p{L}.]/gu, '') || undefined,
      bib: bib || undefined, name: name || undefined, race: txt(b.race, 40) || undefined,
      reporter: app === 'field' ? 'Field app' + (from ? ': ' + from : '') : 'Runner app (their own phone)',
      desc: what || (app === 'field' ? 'Help wanted here (field app).' : 'Asked for help from the runner app.')
    };
    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
    await ensureSchema(db);
    const n = ((await db.prepare('SELECT MAX(num) AS n FROM incidents').first()) || {}).n + 1 || 1;
    await db.batch([
      db.prepare('INSERT INTO incidents (id, num, data, updated, version) VALUES (?1, ?2, ?3, ?4, 1) ON CONFLICT(id) DO NOTHING').bind('h-' + id, n, JSON.stringify(data), now),
      db.prepare('INSERT INTO log (t, incident, kind, text, who, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?1)').bind(now, 'h-' + id, 'incident',
        `#${n} Help request from the ${app} app${bib ? ', bib ' + bib : ''}${km != null ? ', km ' + data.km : ''}: ${data.desc}`.slice(0, 1000), app === 'field' ? from || 'Field app' : 'Runner app')
    ]);
    return json({ ok: true, num: n });
  }

  // An error a phone hit. Counted by kind (app, message, file and line), so one fault on 300 phones is one row.
  if (path === '/fault') {
    if (!(await allow(db, 'fault:' + ip, 30, 3600e3))) return json({ ok: true, limited: true });
    const d = { app: txt(b.app, 12), build: txt(b.build, 8), msg: txt(b.msg, 300), src: txt(b.src, 80).replace(/^.*\//, '').replace(/[?#].*$/, ''), line: num(b.line, 0, 1e7) || 0, col: num(b.col, 0, 1e7) || 0,
      stack: txt(String(b.stack || '').replace(/https?:\/\/[^\s)]*\//g, '').replace(/\?v=\d+/g, ''), 900), ua: txt(b.ua, 160), page: txt(b.page, 40).replace(/[?#].*$/, '') };
    if (!d.msg) return json({ error: 'Bad request' }, 400);
    const sig = (await sha256(new TextEncoder().encode([d.app, d.msg, d.src, d.line].join('|')))).slice(0, 24);
    const had = await db.prepare('SELECT n FROM faults WHERE sig = ?1').bind(sig).first();
    await db.prepare('INSERT INTO faults (sig, data, n, first, last) VALUES (?1, ?2, 1, ?3, ?3) ON CONFLICT(sig) DO UPDATE SET n = n + 1, last = ?3').bind(sig, JSON.stringify(d), now).run();
    if (!had) {
      await db.prepare('DELETE FROM faults WHERE sig NOT IN (SELECT sig FROM faults ORDER BY last DESC LIMIT 300)').run();
      if (env.NTFY_TOPIC && ctx) ctx.waitUntil(fetch('https://ntfy.sh/' + encodeURIComponent(env.NTFY_TOPIC), { method: 'POST', body: `${d.app || 'app'} build ${d.build || '?'}: ${d.msg} (${d.src}:${d.line})`,
        headers: { Title: 'Running Wild app fault (new)', Priority: '3', Tags: 'bug', Click: 'https://singletrackevents.github.io/runningwild/' } }).catch(() => { }));
    }
    return json({ ok: true });
  }

  // A field phone's position, for the board's map. The team code is set on the board and given out at the briefing.
  if (path === '/field/check' || path === '/field/pos') {
    const code = await getSetting(db, 'field_code');
    if (!code) return json({ off: true, error: 'Race Control hasn\'t turned on position sharing' }, 409);
    if (path === '/field/check' && !(await allow(db, 'code:' + ip, 12, 10 * 60e3))) return json({ error: 'Too many tries. Wait 10 minutes.' }, 429);
    if (!sameText(txt(b.code, 20).toLowerCase(), code.toLowerCase())) return json({ error: 'That team code isn\'t right' }, 401);
    if (path === '/field/check') return json({ ok: true });
    const id = txt(b.id, 40), name = txt(b.name, 40);
    if (!/^[A-Za-z0-9-]{8,40}$/.test(id) || !name) return json({ error: 'Bad request' }, 400);
    // One fix, or a batch (fixes kept on the phone with no signal, or sent in the background by the Android app).
    const list = (Array.isArray(b.fixes) ? b.fixes.slice(0, 120) : [b]).map(f => {
      const lat = num(f.lat, AREA.lat[0], AREA.lat[1]), lon = num(f.lon, AREA.lon[0], AREA.lon[1]);
      if (lat == null || lon == null) return null;
      return { lat, lon, t: Math.min(now, num(f.t, 0, 1e14) || now), acc: num(f.acc, 0, 100000) || 0, km: num(f.km, 0, 300), course: txt(f.course, 12),
        offM: num(f.offM, 0, 1e6) || 0, bat: num(f.bat, 0, 1), charging: f.charging === true ? 1 : f.charging === false ? 0 : null,
        spd: num(f.spd, 0, 100), bg: f.bg ? 1 : 0 };
    }).filter(Boolean).sort((x, y) => x.t - y.t);
    if (!list.length) return json({ error: 'Bad request' }, 400);
    if (!(await allow(db, 'pos:' + id, 240, 60 * 60e3))) return json({ error: 'Too many positions. Wait a while.' }, 429);
    const src = b.src === 'apk' ? 'apk' : 'web', last = list[list.length - 1];
    const data = { lat: last.lat, lon: last.lon, acc: last.acc, km: last.km, course: last.course, offM: last.offM, bat: last.bat, src };
    const ops = list.map(f => db.prepare('INSERT INTO field_track (id, name, t, recv, lat, lon, acc, km, course, off_m, bat, charging, spd, src, bg) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)')
      .bind(id, name, f.t, now, f.lat, f.lon, f.acc, f.km, f.course || null, f.offM, f.bat, f.charging, f.spd, src, f.bg));
    // (The board's map: at most one write every 20 seconds from a phone, and never an older fix over a newer one.)
    ops.push(db.prepare('INSERT INTO field_pos (id, name, data, t, updated) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET name = ?2, data = ?3, t = ?4, updated = ?5 WHERE ?5 - field_pos.updated >= 20000 AND ?4 >= field_pos.t').bind(id, name, JSON.stringify(data), last.t, now));
    await db.batch(ops);
    return json({ ok: true, n: list.length });
  }

  // Alerts (Web Push). A phone subscribes with the runners it follows; the timer turns their new chip reads into
  // alerts, and a notice from Race Control goes to every phone with alerts on.
  if (path === '/push/sub') {
    const ep = typeof b.endpoint === 'string' ? b.endpoint.slice(0, 1000) : '';
    if (!pushHostOk(ep, env)) return json({ error: 'That isn\'t a push address this Worker sends to' }, 400);
    if (!(await allow(db, 'sub:' + ip, 40, 3600e3))) return json({ error: 'Too many changes. Try again later.' }, 429);
    const id = (await sha256(new TextEncoder().encode(ep))).slice(0, 32), app = b.app === 'field' ? 'field' : 'runner';
    const bibs = [...new Set((Array.isArray(b.bibs) ? b.bibs : []).map(x => txt(x, 8)).filter(x => /^[0-9A-Za-z]{1,8}$/.test(x)))].slice(0, 30);
    const top = ((await db.prepare('SELECT MAX(id) AS m FROM push_msgs').first()) || {}).m || 0;
    await db.prepare('INSERT INTO push_subs (id, endpoint, app, bibs, notices, seen, tickle, created, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?7) ON CONFLICT(id) DO UPDATE SET app = ?3, bibs = ?4, notices = ?5, updated = ?7')
      .bind(id, ep, app, bibs.join(','), b.notices === false ? 0 : 1, top, now).run();
    return json({ ok: true, id, bibs });
  }
  if (path === '/push/unsub') {
    const ep = typeof b.endpoint === 'string' ? b.endpoint.slice(0, 1000) : '';
    await db.prepare('DELETE FROM push_subs WHERE id = ?1').bind((await sha256(new TextEncoder().encode(ep))).slice(0, 32)).run();
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}

// ---------- Alerts: Web Push without a message body ----------
// The push itself carries nothing (so nothing has to be encrypted here): it wakes the app's service worker, which
// asks /push/news for what's new for this phone and shows it. Sending needs only a signed key (VAPID), made here
// the first time and kept in the database. Only the browsers' own push services are ever sent to.
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.microsoft\.com)$/;
function pushHostOk(ep, env) {
  try { const u = new URL(ep); return (u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname)) || !!(env && env.PUSH_TEST_HOST && u.host === env.PUSH_TEST_HOST); } catch (e) { return false; }
}
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let vapidMemo = null;
async function vapid(db) {
  if (vapidMemo) return vapidMemo;
  await ensureLive(db);
  let jwk = await getSetting(db, 'vapid_jwk'), pub = await getSetting(db, 'vapid_pub');
  if (!jwk || !pub) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    jwk = JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey));
    pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
    const now = Date.now();
    // (Kept only if no other request made one first.)
    await db.batch([db.prepare("INSERT INTO settings (k, v, updated) VALUES ('vapid_jwk', ?1, ?2) ON CONFLICT(k) DO NOTHING").bind(jwk, now), db.prepare("INSERT INTO settings (k, v, updated) VALUES ('vapid_pub', ?1, ?2) ON CONFLICT(k) DO NOTHING").bind(pub, now)]);
    jwk = await getSetting(db, 'vapid_jwk'); pub = await getSetting(db, 'vapid_pub');
  }
  const key = await crypto.subtle.importKey('jwk', JSON.parse(jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return vapidMemo = { key, pub, jwt: new Map() };
}
// The signed pass for one push service, good for 12 hours (made once per service, then reused).
async function vapidAuth(V, env, endpoint) {
  const aud = new URL(endpoint).origin, now = Math.floor(Date.now() / 1000), had = V.jwt.get(aud);
  if (had && had.exp - now > 3600) return had.h;
  const enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const exp = now + 12 * 3600, head = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp, sub: env.PUSH_CONTACT || 'https://www.gpt100.com.au/contact' });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, V.key, new TextEncoder().encode(head));
  const h = `vapid t=${head}.${b64u(sig)}, k=${V.pub}`;
  V.jwt.set(aud, { exp, h });
  return h;
}
// What's new for one phone since it last asked: its runners' reads, and notices if it takes them.
async function pushNews(db, id, now) {
  if (!/^[a-f0-9]{32}$/.test(id)) return { items: [] };
  await ensureLive(db);
  const sub = await db.prepare('SELECT app, bibs, notices, seen FROM push_subs WHERE id = ?1').bind(id).first();
  if (!sub) return { items: [], gone: true };
  const keys = sub.bibs.split(',').filter(Boolean).concat(sub.notices ? ['*', sub.app + '*'] : []);
  if (!keys.length) return { items: [] };
  const r = await db.prepare(`SELECT id, bib, t, title, text, url FROM push_msgs WHERE id > ?1 AND t > ?2 AND bib IN (${keys.map((k, i) => '?' + (i + 3)).join(',')}) ORDER BY id LIMIT 12`).bind(sub.seen, now - 6 * 3600e3, ...keys).all();
  const items = r.results;
  if (items.length) await db.prepare('UPDATE push_subs SET seen = ?2 WHERE id = ?1').bind(id, items[items.length - 1].id).run();
  return { items: items.map(m => ({ id: m.id, bib: m.bib, t: m.t, title: m.title, text: m.text, url: m.url })) };
}
// Wake every phone that has something new and hasn't been woken for it yet (up to PER_RUN a go; the rest next time).
const PUSH_PER_RUN = 300;
async function pushTickle(env, db, now) {
  const top = await db.prepare('SELECT bib, MAX(id) AS m FROM push_msgs WHERE t > ?1 GROUP BY bib').bind(now - 6 * 3600e3).all();
  if (!top.results.length) return { sent: 0 };
  const newest = new Map(top.results.map(r => [r.bib, r.m]));
  const subs = (await db.prepare('SELECT id, endpoint, app, bibs, notices, tickle FROM push_subs LIMIT 20000').all()).results;
  const due = [];
  for (const s of subs) {
    let m = 0;
    for (const k of s.bibs.split(',').filter(Boolean).concat(s.notices ? ['*', s.app + '*'] : [])) m = Math.max(m, newest.get(k) || 0);
    if (m > s.tickle) due.push({ s, m });
  }
  if (!due.length) return { sent: 0 };
  const V = await vapid(db), batch = due.slice(0, PUSH_PER_RUN), gone = [], ok = [];
  await Promise.all(batch.map(async ({ s, m }) => {
    try {
      if (!pushHostOk(s.endpoint, env)) { gone.push(s.id); return; }
      const res = await fetch(s.endpoint, { method: 'POST', headers: { Authorization: await vapidAuth(V, env, s.endpoint), TTL: '3600', Urgency: 'high', 'Content-Length': '0' } });
      if (res.status === 404 || res.status === 410) gone.push(s.id); else if (res.ok) ok.push([s.id, m]);
    } catch (e) { }
  }));
  const ops = [];
  for (let i = 0; i < ok.length; i += 40) { const part = ok.slice(i, i + 40); ops.push(db.prepare(`UPDATE push_subs SET tickle = ?1 WHERE id IN (${part.map((x, k) => '?' + (k + 2)).join(',')})`).bind(Math.max(...part.map(x => x[1])), ...part.map(x => x[0]))); }
  for (let i = 0; i < gone.length; i += 40) { const part = gone.slice(i, i + 40); ops.push(db.prepare(`DELETE FROM push_subs WHERE id IN (${part.map((x, k) => '?' + (k + 1)).join(',')})`).bind(...part)); }
  if (ops.length) await db.batch(ops);
  return { sent: ok.length, gone: gone.length, waiting: due.length - batch.length };
}
// "HallsGapIn" as people say it: "Halls Gap, arrived"; "GAROUT": "GAR, left"; "Finish": "Finished".
function readText(col, v) {
  const m = String(col).match(/^(.*?)(?:CP)?(IN|In|OUT|Out)$/), dir = m ? m[2].toLowerCase() : '';
  const place = (m ? m[1] : String(col)).replace(/CP$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/\bMT\b/g, 'Mt').trim();
  const t = (String(v).match(/(\d{1,2}):(\d\d)(?::\d\d)?(?:[.,]\d+)?$/) || []).slice(1, 3), at = t.length ? t[0].padStart(2, '0') + ':' + t[1] : '';
  if (/^start/i.test(place)) return 'Started' + (at ? ' ' + at : '');
  if (/^finish/i.test(place)) return 'Finished' + (at ? ' ' + at : '');
  return place + (dir === 'in' ? ', arrived' : dir === 'out' ? ', left' : '') + (at ? ' ' + at : '');
}
// Once a minute in the race window: new chip reads for followed runners become alerts.
async function pushRun(env, now, force) {
  const db = env.DB;
  await ensureLive(db);
  const c = cfg(env), inWindow = now >= Date.parse(c.ARCHIVE_FROM) && now <= Date.parse(c.ARCHIVE_TO);
  const subs = (await db.prepare("SELECT bibs FROM push_subs").all()).results;
  if (!subs.length) return { subs: 0 };
  let news = 0;
  if (env.TIMING_URL && (inWindow || force)) {
    const followed = new Set(subs.flatMap(s => s.bibs.split(',').filter(Boolean)));
    const res = await fetch(env.TIMING_URL, { headers: { 'User-Agent': 'GPT100 alerts' }, cf: { cacheTtl: 20, cacheEverything: true } });
    if (res.ok) {
      const rows = timingRows(await res.json().catch(() => null));
      const key = k => k.toLowerCase().replace(/[^a-z]/g, '');
      const st = JSON.parse((await getSetting(db, 'push_state')) || '{}'), first = !st.seen, seen = st.seen || {}, next = {}, msgs = [];
      for (const r of rows) {
        const e = Object.entries(r), bib = txt((e.find(([k]) => /^(bib|bibno|startno|startnumber|number|no)$/.test(key(k))) || [])[1], 8);
        if (!bib) continue;
        let name = txt((e.find(([k]) => /^(name|fullname)$/.test(key(k))) || [])[1], 60);
        const lf = name.match(/^([^,]+),\s*(.+)$/); if (lf) name = lf[2] + ' ' + lf[1];
        const status = txt((e.find(([k]) => /^(status|state)$/.test(key(k))) || [])[1], 12).toUpperCase();
        const had = new Set((seen[bib] || '').split('|').filter(Boolean)), now_ = [];
        for (const [k, v] of e) {
          if (TIMING_META.test(key(k))) continue;
          const sv = String(v == null ? '' : v).trim();
          if (!/\d:\d\d/.test(sv) || /^[0:.]+$/.test(sv)) continue;
          now_.push(k);
          if (!first && !had.has(k) && followed.has(bib)) msgs.push([bib, name ? `${name} (bib ${bib})` : `Bib ${bib}`, readText(k, sv)]);
        }
        if (/^(DNF|DSQ|OTL)$/.test(status)) { now_.push('=' + status); if (!first && !had.has('=' + status) && followed.has(bib)) msgs.push([bib, name ? `${name} (bib ${bib})` : `Bib ${bib}`, status === 'DNF' ? 'Has withdrawn (DNF)' : status === 'OTL' ? 'Missed a cut-off' : 'Disqualified']); }
        next[bib] = now_.join('|');
      }
      // (Only when the list has rows: an empty or broken answer doesn't wipe what's been seen.)
      if (rows.length) {
        const ops = [setSetting(db, 'push_state', JSON.stringify({ seen: next }), now)];
        for (let i = 0; i < msgs.length; i += 20) { const part = msgs.slice(i, i + 20); ops.push(db.prepare(`INSERT INTO push_msgs (bib, t, title, text, url) VALUES ${part.map((x, k) => `(?${k * 3 + 2}, ?1, ?${k * 3 + 3}, ?${k * 3 + 4}, '')`).join(',')}`).bind(now, ...part.flat())); }
        await db.batch(ops);
        news = msgs.length;
      }
    }
  }
  const out = await pushTickle(env, db, now);
  // Old messages and rate counts go.
  if (new Date(now).getUTCMinutes() === 7) await db.batch([db.prepare('DELETE FROM push_msgs WHERE t < ?1').bind(now - 2 * 86400e3), db.prepare('DELETE FROM rate WHERE t < ?1').bind(now - 86400e3)]);
  return Object.assign({ subs: subs.length, news }, out);
}


export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), c = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.headers });
    if (url.pathname.startsWith('/gps/') && req.method === 'GET') {
      try { return await gpsRelay(req, env, url, c); } catch (e) { return new Response('Tracking provider unreachable: ' + e.message, { status: 502, headers: c.headers }); }
    }
    if ((url.pathname === '/timing/' || url.pathname === '/timing') && req.method === 'GET') {
      try { return await timingRelay(req, env, url, c); } catch (e) { return new Response(JSON.stringify({ error: 'Timing feed unreachable: ' + e.message }), { status: 502, headers: c.headers }); }
    }
    if (/^\/(live|help|fault|field\/|push\/)/.test(url.pathname)) {
      try { return await liveApi(req, env, url, c, ctx); } catch (e) { return new Response(JSON.stringify({ error: 'Live: ' + e.message }), { status: 502, headers: c.headers }); }
    }
    if (url.pathname.startsWith('/archive/')) {
      try { return await archiveApi(req, env, url, c); } catch (e) { return new Response(JSON.stringify({ error: 'Archive: ' + e.message }), { status: 502, headers: c.headers }); }
    }
    if (!env.GITHUB_TOKEN) return new Response(JSON.stringify({ error: 'The GITHUB_TOKEN secret is not set' }), { status: 500, headers: c.headers });
    try {
      if (url.pathname.startsWith('/rc/')) return await raceControl(req, env, url, c, ctx);
      if (url.pathname === '/status' && req.method === 'GET') {
        return new Response(JSON.stringify({ last: await latestRun(env) }), { headers: c.headers });
      }
      if (url.pathname === '/refresh' && req.method === 'POST') {
        // Only the GPT100 Safety site (or local testing) may ask for a refresh.
        if (!c.ok) return new Response(JSON.stringify({ error: 'Not allowed from this site' }), { status: 403, headers: c.headers });
        return new Response(JSON.stringify(await maybeStart(env, url.searchParams.get('models') === '1')), { headers: c.headers });
      }
      return new Response(JSON.stringify({ ok: true, about: 'GPT100 weather refresh relay' }), { headers: c.headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: c.headers });
    }
  },
  // Cron triggers. Every 15 minutes: keep the weather fresh even when nobody presses the button, and during the race
  // keep copies of the timing and GPS feeds (the race archive). Every minute (a second trigger, tools/LIVE.md): turn
  // new chip reads into alerts for the phones following those runners. With both triggers set, or only the
  // every-minute one, the 15 minute jobs still run once every 15 minutes (the database keeps count).
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const now = Date.now();
      let quarter = new Date(event.scheduledTime || now).getUTCMinutes() % 15 === 0;
      if (env.DB) { try { quarter = await claimQuarter(env.DB, now); } catch (e) { } }
      if (quarter) {
        await Promise.allSettled([
          maybeStart(env, false).catch(e => console.log('refresh failed: ' + e.message)),
          archiveRun(env, false).then(r => console.log('archive: ' + JSON.stringify(r))).catch(e => console.log('archive failed: ' + e.message))
        ]);
      }
      if (env.DB) await pushRun(env, now).then(r => { if (r && (r.news || r.sent)) console.log('alerts: ' + JSON.stringify(r)); }).catch(e => console.log('alerts failed: ' + e.message));
    })());
  }
};
