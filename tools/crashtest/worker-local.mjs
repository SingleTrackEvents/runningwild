#!/usr/bin/env node
// The Worker (tools/refresh-worker.js) on this computer, for rehearsals and the crash tests: the same code Cloudflare
// runs, with a local database standing in for D1. Nothing here reaches GitHub, the phone alert service or the real feeds.
//   RC_PASSWORD='the medical password' node tools/crashtest/worker-local.mjs      (listens on http://127.0.0.1:8787)
// Then open the staff app with ?rcapi=http://127.0.0.1:8787 (Control), or any app with ?api=http://127.0.0.1:8787.
//   GET  /__cron        run the Worker's timer once (new chip reads become alerts)
//   GET  /__reset       forget the flood limits (a test sends more help requests than one phone may)
//   GET  /__wipe        empty the local database (worker-test.mjs starts with this)
//   POST /__pushsvc/x   a stand-in push service: what the Worker sends it is kept, GET /__pushlog shows it
// The timing list and GPS files come from tools/crashtest/feeds.js (port 8766) unless TIMING_URL / GPS_HOST say otherwise.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url)), PORT = +(process.env.PORT || 8787);
const WORKER = pathToFileURL(join(HERE, '../refresh-worker.js')).href;
let worker = (await import(WORKER)).default;

// ---------- D1, near enough: prepare / bind / first / all / run / batch over SQLite ----------
const sql = new DatabaseSync(process.env.DB_FILE || ':memory:');
const val = v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v instanceof ArrayBuffer ? new Uint8Array(v) : v;
function stmt(q, args) {
  const exec = () => {
    const st = sql.prepare(q), a = (args || []).map(val);
    if (/^\s*(select|with|pragma)/i.test(q)) return { results: st.all(...a), meta: { changes: 0 } };
    const r = st.run(...a);
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  return { bind: (...a) => stmt(q, a), first: async () => exec().results[0] || null, all: async () => exec(), run: async () => exec(), _exec: exec };
}
const DB = { prepare: q => stmt(q, []), batch: async list => { sql.exec('BEGIN'); try { const out = list.map(s => s._exec()); sql.exec('COMMIT'); return out; } catch (e) { sql.exec('ROLLBACK'); throw e; } } };

// ---------- nothing leaves this computer ----------
const realFetch = globalThis.fetch;
globalThis.fetch = (u, init) => {
  const host = new URL(typeof u === 'string' ? u : u.url).hostname;
  if (!/^(127\.0\.0\.1|localhost)$/.test(host)) return Promise.resolve(new Response(JSON.stringify({ blocked: host, workflow_runs: [] }), { status: 503 }));
  const o = Object.assign({}, init); delete o.cf;
  return realFetch(u, o);
};
const FEEDS = process.env.FEEDS || 'http://127.0.0.1:8766/';
const env = {
  DB, GITHUB_TOKEN: process.env.GITHUB_TOKEN === undefined ? 'local' : process.env.GITHUB_TOKEN, RC_PASSWORD: process.env.RC_PASSWORD || 'local-test',
  TIMING_URL: process.env.TIMING_URL || FEEDS + 'live/timing.json', GPS_HOST: process.env.GPS_HOST || FEEDS,
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || 'http://127.0.0.1:8765,http://localhost:8765',
  ARCHIVE_FROM: '2020-01-01T00:00:00+11:00', ARCHIVE_TO: '2100-01-01T00:00:00+11:00', ARCHIVE_GPS: '', SITE_CONFIG: 'http://127.0.0.1:1/none',
  PUSH_TEST_HOST: '127.0.0.1:' + PORT
};
const pushed = [];
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks), url = 'http://127.0.0.1:' + PORT + req.url, waits = [], ctx = { waitUntil: p => waits.push(Promise.resolve(p).catch(() => { })) };
  const send = (status, headers, buf) => { res.writeHead(status, headers); res.end(buf); };
  try {
    if (req.url.startsWith('/__pushsvc/')) { pushed.push({ t: Date.now(), to: req.url.slice(11), auth: req.headers.authorization || '', ttl: req.headers.ttl || '' }); return send(req.url.includes('gone') ? 410 : 201, {}, ''); }
    if (req.url === '/__reset') { try { sql.exec('DELETE FROM rate'); } catch (e) { } return send(200, { 'Access-Control-Allow-Origin': '*' }, 'limits cleared'); }
    if (req.url === '/__wipe') {
      for (const t of sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) { try { sql.exec('DELETE FROM "' + t.name + '"'); } catch (e) { } }
      worker = (await import(WORKER + '?fresh=' + Date.now())).default; // and what the Worker keeps in memory between requests
      return send(200, { 'Access-Control-Allow-Origin': '*' }, 'database emptied');
    }
    if (req.url === '/__pushlog') return send(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, JSON.stringify(pushed));
    if (req.url === '/__cron') { await worker.scheduled({ scheduledTime: Date.now(), cron: '* * * * *' }, env, ctx); await Promise.all(waits); return send(200, { 'Access-Control-Allow-Origin': '*' }, 'ran'); }
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    headers.set('CF-Connecting-IP', req.socket.remoteAddress || '127.0.0.1');
    const r = await worker.fetch(new Request(url, { method: req.method, headers, body: /^(GET|HEAD|OPTIONS)$/.test(req.method) ? undefined : body }), env, ctx);
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    send(r.status, h, Buffer.from(await r.arrayBuffer()));
    await Promise.all(waits);
  } catch (e) { send(500, { 'Content-Type': 'text/plain' }, 'local worker: ' + (e && e.stack || e)); }
}).listen(PORT, '127.0.0.1', () => console.log('worker on ' + PORT));
