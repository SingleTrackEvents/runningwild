#!/usr/bin/env node
// Tests the Worker's line to the phones against the local stand-in (worker-local.mjs on 8787, feeds.js on 8766):
// notices, help requests, field phones, fault reports, alerts and the lighter positions file, with good and bad input.
//   RC_PASSWORD='the same password the local Worker was started with' node tools/crashtest/worker-test.mjs
const W = process.env.WORKER || 'http://127.0.0.1:8787', PW = process.env.RC_PASSWORD || 'local-test', ORIGIN = 'http://127.0.0.1:8765';
let bad = 0, n = 0;
const ok = (what, cond, got) => { n++; if (!cond) { bad++; console.log('  FAIL', what, got === undefined ? '' : JSON.stringify(got).slice(0, 300)); } };
const call = async (path, body, o = {}) => {
  const r = await fetch(W + path, { method: body ? 'POST' : 'GET', headers: Object.assign({ Origin: o.origin || ORIGIN }, body ? { 'Content-Type': 'application/json' } : {}, o.pw === false ? {} : o.rc ? { 'X-RC-Password': o.pw || PW } : {}), body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
  let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch (e) { j = { text: t }; }
  return { s: r.status, j, h: r.headers };
};
const rc = (path, body) => call(path, body, { rc: true });
const id = () => 'T' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);

// A clean start: the stand-in empties its database (the real Worker has no such address).
await fetch(W + '/__wipe').catch(() => { });

// ---- Race Control needs the password
ok('state without a password is refused', (await call('/rc/state?since=0')).s === 401);
ok('state with a wrong password is refused', (await call('/rc/state?since=0', null, { rc: true, pw: 'nope' })).s === 401);
let st = await rc('/rc/state?since=0');
ok('state with the password', st.s === 200 && st.j.live && Array.isArray(st.j.live.notices), st.j);

// ---- help requests: closed until Race Control switches them on
await rc('/rc/settings', { patch: { help_on: false }, who: 'test' });
let live = (await call('/live')).j;
ok('help closed when switched off', live.help.open === false, live);
const h1 = id();
let r = await call('/help', { id: h1, app: 'runner', bib: '1047', km: 52.3, lat: -37.14, lon: 142.52, what: 'Rolled my ankle, can walk slowly' });
ok('a help request is refused while closed', r.s === 409 && r.j.closed === true, r);
await rc('/rc/settings', { patch: { help_on: true }, who: 'test' });
await rc('/rc/state?since=0');
live = (await call('/live')).j;
ok('help open once switched on and a board is open', live.help.open === true, live);
r = await call('/help', { id: h1, app: 'runner', bib: '1047', name: 'Jane <b>Smith</b>', race: 'GPT100 Miler', course: '100', km: 52.31, lat: -37.14, lon: 142.52, acc: 12, w3w: 'word.word.word', what: 'Rolled my ankle, can walk slowly', t: Date.now() });
ok('a help request is taken', r.s === 200 && r.j.ok && r.j.num > 0, r);
const num1 = r.j.num;
r = await call('/help', { id: h1, app: 'runner', bib: '1047', what: 'again' });
ok('the same request again changes nothing', r.s === 200 && r.j.again === true && r.j.num === num1, r);
st = await rc('/rc/state?since=0');
const inc = st.j.incidents.find(i => i.id === 'h-' + h1);
ok('it is on the board as an incident', inc && inc.source === 'runner' && inc.needsAck === true && inc.bib === '1047' && inc.km === 52.3 && inc.severity === 'priority' && inc.status === 'open', inc);
ok('and in the radio log', st.j.log.some(l => /Help request from the runner app, bib 1047, km 52.3/.test(l.text)), st.j.log[0]);
r = await call('/help?id=' + h1);
ok('the phone sees it is not answered yet', r.j.found && r.j.ack == null, r.j);
await rc('/rc/incident', { id: 'h-' + h1, patch: { ackAt: Date.now(), ackBy: 'test', needsAck: false }, who: 'test' });
r = await call('/help?id=' + h1);
ok('the phone sees the answer', r.j.found && r.j.ack > 0, r.j);
ok('an unknown request is not found', (await call('/help?id=' + id())).j.found === false);
for (const [what, body] of [['no id', { app: 'runner', what: 'x' }], ['a short id', { id: 'abc', what: 'x' }], ['nothing to send', { id: id() }], ['not JSON', '{nope'], ['an array', '[1,2]'], ['too big', { id: id(), what: 'x'.repeat(7000) }]]) {
  r = await call('/help', body); ok('help refuses ' + what, r.s === 400 || r.s === 413, r);
}
r = await call('/help', { id: id(), app: 'field', from: 'Sweep 2', urgent: true, lat: 51.5, lon: 0, km: 'abc', what: '<img src=x onerror=alert(1)>' });
ok('a field request far from the course keeps no position', r.s === 200, r);
st = await rc('/rc/state?since=0');
const inc2 = st.j.incidents.find(i => i.num === r.j.num);
ok('urgent from the field app, position dropped, text kept as text', inc2 && inc2.severity === 'urgent' && inc2.lat === undefined && inc2.km === undefined && inc2.reporter === 'Field app: Sweep 2' && inc2.desc.includes('<img'), inc2);
ok('help from another site is refused', (await call('/help', { id: id(), what: 'x' }, { origin: 'https://evil.example' })).s === 403);
let limited = false; for (let i = 0; i < 12; i++) { r = await call('/help', { id: id(), what: 'flood ' + i }); if (r.s === 429) limited = true; }
ok('a flood of help requests is limited', limited, r);

// ---- notices
r = await rc('/rc/notice', { text: 'Course change at Mt William: follow the pink tape.', level: 'alert', aud: 'all', mins: 60, who: 'test' });
ok('a notice is posted', r.s === 200 && r.j.notice && r.j.notice.id, r);
const nid = r.j.notice.id;
r = await rc('/rc/notice', { text: 'Sweeps: check in at Halls Gap.', aud: 'field', who: 'test' });
live = (await call('/live')).j;
ok('the phones see both notices', live.notices.length === 2 && live.notices.some(x => x.level === 'alert' && x.aud === 'all' && x.until > Date.now()) && live.notices.some(x => x.aud === 'field'), live);
ok('an empty notice is refused', (await rc('/rc/notice', { text: '   ', who: 'test' })).s === 400);
ok('a notice needs the password', (await call('/rc/notice', { text: 'x' })).s === 401);
await rc('/rc/notice', { id: nid, clear: true, who: 'test' });
live = (await call('/live')).j;
ok('a notice taken down is gone', live.notices.length === 1, live);

// ---- field phones
await rc('/rc/settings', { patch: { field_code: '' }, who: 'test' });
const dev = id();
ok('positions are refused until a team code is set', (await call('/field/pos', { code: 'x', id: dev, name: 'Sweep 2', lat: -37.14, lon: 142.52 })).s === 409);
ok('a bad team code is refused by the board', (await rc('/rc/settings', { patch: { field_code: 'a b' }, who: 'test' })).s === 400);
await rc('/rc/settings', { patch: { field_code: 'Peaks26' }, who: 'test' });
ok('a wrong code is refused', (await call('/field/check', { code: 'nope' })).s === 401);
ok('the right code is taken, any case', (await call('/field/check', { code: 'peaks26' })).j.ok === true);
r = await call('/field/pos', { code: 'Peaks26', id: dev, name: 'Sweep 2 <i>', lat: -37.14067, lon: 142.51921, acc: 8, km: 49.5, course: '100', t: Date.now() });
ok('a position is taken', r.s === 200 && r.j.ok, r);
ok('a position without the code is refused', (await call('/field/pos', { code: 'wrong', id: dev, name: 'x', lat: -37.1, lon: 142.5 })).s === 401);
ok('a position off the map is refused', (await call('/field/pos', { code: 'Peaks26', id: dev, name: 'x', lat: 10, lon: 10 })).s === 400);
st = await rc('/rc/state?since=0');
const fp = st.j.live.field.filter(f => f.id === dev);
ok('the board sees the field phone', fp.length === 1 && fp[0].name === 'Sweep 2 <i>' && fp[0].km === 49.5 && st.j.live.field_code === 'Peaks26', st.j.live);

// ---- fault reports
r = await call('/fault', { app: 'runner', build: '104', msg: 'TypeError: En.nearW3w is not a function', src: 'https://x.example/js/runner.js?v=104', line: 182, col: 171, stack: 'at place (https://x.example/js/runner.js?v=104:182:171)', ua: 'test', page: 'runner.html?bib=1047#x' });
await call('/fault', { app: 'runner', build: '104', msg: 'TypeError: En.nearW3w is not a function', src: 'js/runner.js', line: 182 });
await call('/fault', { app: 'field', build: '104', msg: 'Another', src: 'js/field.js', line: 5 });
ok('a fault needs a message', (await call('/fault', { app: 'runner' })).s === 400);
r = await rc('/rc/faults');
const f = r.j.faults.find(x => x.line === 182);
ok('faults are counted by kind, without the page link', r.j.faults.length === 2 && f && f.n === 2 && f.src === 'runner.js' && f.page === 'runner.html' && !/x\.example/.test(f.stack), r.j.faults);
ok('the fault list needs the password', (await call('/rc/faults')).s === 401);
await rc('/rc/faults', { clear: true, who: 'test' });
ok('faults can be cleared', (await rc('/rc/faults')).j.faults.length === 0);

// ---- alerts
ok('a push address that is not a push service is refused', (await call('/push/sub', { endpoint: 'https://evil.example/steal', bibs: ['1000'] })).s === 400);
ok('nor one on this network', (await call('/push/sub', { endpoint: 'http://169.254.169.254/latest', bibs: ['1000'] })).s === 400);
const ep = W + '/__pushsvc/phone-' + id(), ep2 = W + '/__pushsvc/gone-' + id();
r = await call('/push/sub', { endpoint: ep, app: 'runner', bibs: ['1000', '1001', 'bad bib!', '1000'], notices: true });
ok('a phone subscribes with its runners', r.s === 200 && r.j.id && r.j.bibs.join() === '1000,1001', r);
const sub = r.j.id;
await call('/push/sub', { endpoint: ep2, app: 'field', bibs: [], notices: true });
await fetch(W + '/__cron');   // the first look at the timing list: what's already there is not news
ok('nothing is sent for reads that were already there', (await call('/push/news?ep=' + sub)).j.items.length === 0);
const before = (await (await fetch(W + '/__pushlog')).json()).length;
await rc('/rc/notice', { text: 'Storm cell near Mt William: shelter at the car park.', level: 'alert', aud: 'all', mins: 30, who: 'test' });
await new Promise(r => setTimeout(r, 400));
const log = await (await fetch(W + '/__pushlog')).json();
ok('a notice wakes the phones with alerts on', log.length >= before + 2, log.length - before);
const mine = log.filter(x => ep.endsWith(x.to)).pop();
ok('the push is signed and carries no message', mine && /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{80,}$/.test(mine.auth) && mine.ttl === '3600', mine);
if (mine) {
  // The signature really is this Worker's key: check it the way a push service would.
  const [, jwt, k] = mine.auth.match(/^vapid t=(\S+), k=(\S+)$/), [hh, pp, ss] = jwt.split('.'), d = s => Uint8Array.from(Buffer.from(s, 'base64url'));
  const key = await crypto.subtle.importKey('raw', d(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, d(ss), new TextEncoder().encode(hh + '.' + pp)), claims = JSON.parse(Buffer.from(pp, 'base64url'));
  ok('the signature checks out against the key the phones are given', good && k === (await call('/live')).j.push.key && claims.aud === W && claims.exp > Date.now() / 1000 && /^https:|^mailto:/.test(claims.sub), claims);
}
r = await call('/push/news?ep=' + sub);
ok('the phone then fetches the notice', r.j.items.length === 1 && /Storm cell/.test(r.j.items[0].text) && /important/.test(r.j.items[0].title), r.j);
ok('and only once', (await call('/push/news?ep=' + sub)).j.items.length === 0);
ok('a phone that has gone is dropped', (await rc('/rc/state?since=0')).j.live.alerts === 1);
ok('news for an unknown phone', (await call('/push/news?ep=' + 'f'.repeat(32))).j.gone === true);
// The race moves on (the stand-in timing list, feeds.js /__step): only the runners a phone follows are news to it.
const FEEDS = process.env.FEEDS || 'http://127.0.0.1:8766', stepTo = async n => { await fetch(FEEDS + '/__step?n=' + n); await fetch(W + '/__cron'); await new Promise(r => setTimeout(r, 300)); };
const news = async () => (await call('/push/news?ep=' + sub)).j.items || [];
await call('/push/sub', { endpoint: ep, app: 'runner', bibs: ['1000', '1002'], notices: true });
await stepTo(2);
let got = await news();
ok('a followed runner reaching a checkpoint is an alert', got.length === 1 && got[0].bib === '1000' && /Test0 Runner \(bib 1000\)/.test(got[0].title) && /Halls Gap/.test(got[0].text) && /14:32/.test(got[0].text), got);
await stepTo(2);
ok('the same read is not sent twice', (await news()).length === 0);
await stepTo(3);
got = await news();
ok('a followed runner withdrawing is an alert', got.length === 1 && got[0].bib === '1002' && /DNF|withdrawn/i.test(got[0].text), got);
await stepTo(4);
got = await news();
ok('and so is their finish', got.length === 1 && got[0].bib === '1000' && /Finish/i.test(got[0].text) && /16:05/.test(got[0].text), got);
const woke = (await (await fetch(W + '/__pushlog')).json()).filter(x => ep.endsWith(x.to)).length;
ok('each one woke the phone', woke >= 4, woke);
await fetch(FEEDS + '/__step?n=0');
await call('/push/unsub', { endpoint: ep });
ok('a phone can turn alerts off', (await call('/push/news?ep=' + sub)).j.gone === true);

// ---- the lighter positions file
const full = await fetch(W + '/gps/mid/data.lst', { headers: { Origin: ORIGIN } }), fullBuf = Buffer.from(await full.arrayBuffer());
const tail = await fetch(W + '/gps/mid/data.lst?tail=20000', { headers: { Origin: ORIGIN } }), tailBuf = Buffer.from(await tail.arrayBuffer());
ok('the tail is the end of the file, from the start of a line', tailBuf.length <= 20000 && tailBuf.length > 15000 && fullBuf.subarray(fullBuf.length - tailBuf.length).equals(tailBuf) && fullBuf[fullBuf.length - tailBuf.length - 1] === 10, [fullBuf.length, tailBuf.length]);
ok('and still reports the whole file\'s size', tail.headers.get('X-GPS-Server-Filesize') === String(fullBuf.length) && tail.headers.get('X-GPS-Tail') === tailBuf.length + '/' + fullBuf.length, [tail.headers.get('X-GPS-Server-Filesize'), tail.headers.get('X-GPS-Tail')]);
const small = await fetch(W + '/gps/ok/data.lst?tail=5000000', { headers: { Origin: ORIGIN } });
ok('a tail bigger than the file is the whole file', (await small.arrayBuffer()).byteLength === +small.headers.get('X-GPS-Server-Filesize'));

console.log(`${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
