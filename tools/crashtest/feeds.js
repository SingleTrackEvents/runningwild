// A stand-in for the GPS and timing providers, serving good, broken and hostile feeds for the crash tests
// (run.js starts it). Open any app with ?gps=http://127.0.0.1:8766/<case>/ to see one: ok, garbage, empty, html,
// err500, err404, weird, shapes, nolabels, errorobj, mid (400 runners), huge (1500 runners), slow, ghost (trackers
// last heard days ago).
// http://127.0.0.1:8766/<case>/init.txt | data.lst | data.php | timing.json
// The case `live` is the good feed with a race that moves on when told to: GET /__step?n=2 gives the first two
// runners a read at Halls Gap, n=3 also withdraws bib 1002, n=4 also finishes bib 1000 (for the alerts test).
const http = require('http'), fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../data/course.js'), 'utf8'), ctx);
const R = ctx.window.GPT100_DATA.route;  // [lat, lon, km, ele]
const EPOCH = Date.UTC(2006, 0, 1) / 1000, now = () => Math.floor(Date.now() / 1000) - EPOCH;
const at = km => R.reduce((a, b) => Math.abs(b[2] - km) < Math.abs(a[2] - km) ? b : a);
const line = (id, t, lat, lon, more) => `${id}.${t}_${Math.round(lon * 5e4)}_${Math.round(lat * 1e5)}_B90_S5${more || ''}`;
// n runners spread along the course, each with a few fixes over the last half hour.
function good(n, pts) {
  let init = 'RACENAME:Crash test\nLIVE:1\nGRABINTERVAL:15\n';
  const rows = [];
  for (let i = 0; i < n; i++) {
    const id = 1000 + i, km = 5 + (150 * i / n), t = now();
    init += `COMPETITOR:${id}|20261106|080000|${id} Runner ${i}|R${i}|\n`;
    for (let k = pts; k >= 0; k--) { const p = at(km - k * 0.15); rows.push([t - k * 120, line(id, t - k * 120, p[0], p[1])]); }
  }
  // As the provider writes it: one line per fix as it arrives, oldest first (so the end of the file is the latest of everyone).
  rows.sort((a, b) => a[0] - b[0]);
  return { init, data: rows.map(r => r[1]).join('\n') + '\n' };
}
const hhmm = d => { const m = new Date(Date.now() + 11 * 3600e3 - d * 60e3); return String(m.getUTCHours()).padStart(2, '0') + ':' + String(m.getUTCMinutes()).padStart(2, '0') + ':00'; };
const CASES = {
  ok: () => { const g = good(40, 6); return { init: g.init, data: g.data, timing: JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ Place: '', Status: '', Bib: 1000 + i, Name: `Runner, Test${i}`, Contest: 'GPT100 Solo/Pairs', Gender: i % 2 ? 'M' : 'F', AgeGroup: ['Masters', 'M40-49', '70+', 'Open', 'U24', 'Solo', '', null, 55, 'F 50 to 59'][i % 10], Start: hhmm(600), CopperMineTrack: hhmm(540) }))) }; },
  garbage: () => ({ init: '\x00\x01\x02 not a feed ￿\n::::\nCOMPETITOR:\nCOMPETITOR:|||||\nCOMPETITOR:x|y|z\nLIVE:banana\nGRABINTERVAL:-5\n', data: 'hello\n....\n1000.abc_def_ghi\n1000.1_2\n' + 'z'.repeat(5000) + '\n1000.' + '9'.repeat(400) + '_1_1\n.._._\n*.*.*\n', timing: 'this is not json <html>' }),
  empty: () => ({ init: '', data: '', timing: '[]' }),
  html: () => ({ init: '<!DOCTYPE html><html><body>502 Bad Gateway</body></html>', data: '<HTML><body>error</body></HTML>', timing: '<!DOCTYPE html><html>nope</html>' }),
  err500: () => ({ status: 500 }),
  err404: () => ({ status: 404 }),
  weird: () => {
    const g = good(12, 3), t = now();
    let init = g.init + 'COMPETITOR:2000|x|y|2000 <img src=x onerror=alert(1)>|<b>x</b>|\nCOMPETITOR:2001|x|y|2001|Team "Quote" & Co|\nCOMPETITOR:2002|x|y|No Bib Person|nb|\nCOMPETITOR:2003|x|y|1000 Duplicate Bib|d|\nCOMPETITOR:2004|x|y|99999999999999999999 Huge Bib|h|\nCOMPETITOR:2005|x|y||e|\nCOMPETITOR:2006|x|y|2006 ' + 'L'.repeat(400) + '|l|\nCOMPETITOR:2007|x|y|2007 Far Away|f|\nCOMPETITOR:2008|x|y|2008 Future|f|\nCOMPETITOR:2009|x|y|2009 Null Island|n|\n';
    const p = at(60);
    let data = g.data + line(2000, t, p[0], p[1]) + '\n' + line(2001, t, p[0], p[1]) + '\n' + line(2002, t, p[0] + 0.01, p[1]) + '\n' + line(2003, t, p[0], p[1] + 0.02) + '\n' + line(2004, t, p[0], p[1]) + '\n' +
      line(2006, t, p[0], p[1]) + '\n' + line(2007, t, -33.86, 151.21) + '\n' + line(2008, t + 86400 * 30, p[0], p[1]) + '\n' + line(2009, t, 0, 0) + '\n' + `2005.${t}_NaN_NaN_B_S\n` + `2000.${t - 50}_${Math.round(p[1] * 5e4)}_${Math.round(p[0] * 1e5)}_B1_S1.1_1_1.abc.ZZZ.000.!!!\n` + line(9999, t, p[0], p[1]) + '\n' + line(2001, -5, p[0], p[1]) + '\n' + line(2001, 1e15, 91, 181) + '\n';
    const rows = [
      { Bib: 1000, Name: 'Runner, Zero', Contest: 'GPT100 Solo/Pairs', Status: '', Start: hhmm(600), HallsGapIn: hhmm(60), AgeGroup: '<img src=x onerror=alert(1)>' },
      { Bib: 1001, Name: '<script>alert(1)</script>', Contest: 'GPT100 Solo/Pairs', Status: 'weird status', Start: 'garbage', HallsGapIn: '99:99:99', AgeGroup: 'M40-49' },
      { Bib: 'abc', Name: 'No number', Contest: 'GPT100 Solo/Pairs' },
      { Name: 'No bib at all', Contest: 'GPT100 Solo/Pairs' },
      { Bib: 1002, Name: null, Contest: null, Start: null },
      { Bib: 1003, Name: 'Unknown, Contest', Contest: 'Mystery Race', Start: hhmm(600) },
      { Bib: 1004, Name: 'Future, Time', Contest: 'GPT100 Solo/Pairs', Start: hhmm(-600), HallsGapIn: hhmm(-900) },
      { Bib: 1005, Name: 'Back, Wards', Contest: 'GPT100 Solo/Pairs', Start: hhmm(100), HallsGapIn: hhmm(500), Finish: hhmm(700) },
      { Bib: 1006, Name: 'Obj, Ect', Contest: { a: 1 }, Start: { b: 2 }, HallsGapIn: [1, 2], Status: 5 },
      { Bib: 1007, Name: 'D N F', Contest: 'GPT100 Solo/Pairs', Status: 'DNF', Start: hhmm(600) },
      { Bib: 1008, Name: 'Neg, Ative', Contest: 'GPT100 Solo/Pairs', Start: '-1:00:00', HallsGapIn: '25:61:61', UnknownColumnXYZ: hhmm(30), Age: 'old', YOB: '3000' },
      { Bib: 1009, Name: 'Stage, Two', Contest: 'GPT100 Stage Race Solo', Start: hhmm(300), RoseaCP: hhmm(120), Age: 67 },
      { Bib: 1010, Name: 'Fun, Run', Contest: 'GPT2K Kids', Start: hhmm(30) },
      { Bib: 1011, Name: 'Fourteen, K', Contest: 'GPT14K', Start: hhmm(90), Finish: hhmm(10), DOB: '1960-01-01' },
      null, 5, 'string', [], [1, 2, 3]
    ];
    return { init, data, timing: JSON.stringify(rows) };
  },
  shapes: () => { const g = good(6, 2); return { init: g.init, data: g.data, timing: JSON.stringify({ list: { Fields: [{ Label: 'Bib' }, { Label: 'Name' }, { Expression: 'Contest' }, { Label: 'Start' }, { Label: 'HallsGapIn' }, { Label: 'AgeGroup1.NameShort' }] }, data: { '#1_GPT100': [[1000, 'A, B', 'GPT100 Solo/Pairs', hhmm(500), hhmm(20), 'M60-69'], [1001, 'C, D', 'GPT100 Solo/Pairs', hhmm(500), '', 'F40-49']], '#2_x': [['x'], []] } }) }; },
  nolabels: () => { const g = good(3, 2); return { init: g.init, data: g.data, timing: JSON.stringify([[1000, 'A', 'x'], [1001, 'B', 'y']]) }; },
  errorobj: () => { const g = good(3, 2); return { init: g.init, data: g.data, timing: JSON.stringify({ error: 'The timing feed said 403' }) }; },
  huge: () => { const g = good(1500, 40); return { init: g.init, data: g.data, timing: JSON.stringify(Array.from({ length: 1500 }, (_, i) => ({ Bib: 1000 + i, Name: `Runner, Big${i}`, Contest: 'GPT100 Solo/Pairs', Gender: 'M', AgeGroup: '40-49', Start: hhmm(600), CopperMineTrack: hhmm(520), GARIN: hhmm(400) }))) }; },
  mid: () => { const g = good(400, 60); return { init: g.init, data: g.data, timing: JSON.stringify(Array.from({ length: 400 }, (_, i) => ({ Bib: 1000 + i, Name: `Runner, Mid${i}`, Contest: 'GPT100 Solo/Pairs', Gender: i % 2 ? 'M' : 'F', AgeGroup: '40-49', Start: hhmm(600), CopperMineTrack: hhmm(520), GARIN: hhmm(400) }))) }; },
  // After the race: two trackers last heard at Halls Gap 52 hours ago (handed back there still switched on), one a stage
  // race runner whose stage runs nowhere near Halls Gap, one a Miler runner, and one runner still out with a fresh fix.
  // The timing list has no reads and no results for them, as it was days after the 2026 race. None of the old ones
  // may be drawn as racing (the 2026 app marched them up the course "at their pace").
  ghost: () => {
    const hg = at(49.2), out = at(80), t = now(), old = t - 52 * 3600;
    let data = '';
    for (let k = 6; k >= 0; k--) data += line(2001, old - k * 25, hg[0], hg[1]) + '\n' + line(2002, old - k * 25, hg[0] + 0.0002, hg[1]) + '\n';
    for (let k = 20; k >= 0; k--) { const p = at(80 - k * 0.15); data += line(2003, t - k * 120, p[0], p[1]) + '\n'; }
    return { init: 'RACENAME:After the race\nLIVE:1\nGRABINTERVAL:15\n' + [2001, 2002, 2003].map(b => `COMPETITOR:${b}|20261106|080000|${b} Runner ${b}|R${b}|\n`).join(''), data,
      timing: JSON.stringify([{ Bib: 2001, Name: 'Stage, Sam', Contest: 'GPT100 Stage Race Solo', Gender: 'F', Start: '', Finish: '' }, { Bib: 2002, Name: 'Miler, Mel', Contest: 'GPT100 Solo/Pairs', Gender: 'M', Start: '', Finish: '' },
        { Bib: 2003, Name: 'Out, Olly', Contest: 'GPT100 Solo/Pairs', Gender: 'M', Start: '', Finish: '' }]) };
  },
  slow: () => ({ slow: 25000, init: 'RACENAME:slow\nLIVE:1\n', data: '', timing: '[]' })
};
const cache = {};
let step = 0;
const liveTiming = () => JSON.stringify(Array.from({ length: 40 }, (_, i) => Object.assign({ Place: '', Status: step >= 3 && i === 2 ? 'DNF' : '', Bib: 1000 + i, Name: `Runner, Test${i}`, Contest: 'GPT100 Solo/Pairs', Gender: i % 2 ? 'M' : 'F', AgeGroup: 'M40-49', Start: '06:00:00', CopperMineTrack: '07:10:00' },
  i < Math.min(step, 2) ? { HallsGapIn: '14:32:00' } : {}, step >= 4 && i === 0 ? { Finish: '16:05:00' } : {})));
http.createServer((req, res) => {
  const sm = /^\/__step\?n=(\d+)/.exec(req.url || '');
  if (sm) { step = +sm[1]; res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('step ' + step); return; }
  const m = /^\/([a-z0-9]+)\/([a-z.]+)/.exec(req.url || ''), H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-GPS-Server-Filesize, X-GPS-Server-Reset', 'Cache-Control': 'no-store' };
  if (m && m[1] === 'live') cache.live = Object.assign(cache.live || CASES.ok(), { timing: liveTiming() });
  if (!m || !(CASES[m[1]] || m[1] === 'live')) { res.writeHead(404, H); res.end('no such case'); return; }
  const c = cache[m[1]] = cache[m[1]] || CASES[m[1]](), f = m[2];
  const send = () => {
    if (c.status) { res.writeHead(c.status, H); res.end('error ' + c.status); return; }
    if (f === 'init.txt') { res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain' }, H)); res.end(c.init); }
    else if (f === 'data.lst') { res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain', 'X-GPS-Server-Filesize': String(Buffer.byteLength(c.data)), 'X-GPS-Server-Reset': '1' }, H)); res.end(c.data); }
    else if (f === 'data.php') { res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain', 'X-GPS-Server-Filesize': String(Buffer.byteLength(c.data)), 'X-GPS-Server-Reset': '1' }, H)); res.end(m[1] === 'garbage' ? c.data : ''); }
    else if (f === 'timing.json') { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, H)); res.end(c.timing); }
    else { res.writeHead(404, H); res.end('nope'); }
  };
  if (c.slow) setTimeout(send, c.slow); else send();
}).listen(8766, '127.0.0.1', () => console.log('feeds on 8766'));
