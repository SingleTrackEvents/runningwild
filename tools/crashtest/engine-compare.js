// After a change to js/engine.js that shouldn't change any answer (a speed-up, a tidy): the engine in another checkout
// and this one must agree on every join, the fastest team and times at every course point, the repeat passes, and
// the full answer at a sample of points by day and by night.
//   git worktree add /tmp/gpt-main origin/main
//   node tools/crashtest/engine-compare.js /tmp/gpt-main
const fs = require('fs'), vm = require('vm'), path = require('path');
const OTHER = process.argv[2];
if (!OTHER) { console.log('Give the path of the checkout to compare with (see the top of this file).'); process.exit(2); }
function load(root) {
  const store = {}, win = { localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } }, addEventListener() { }, location: { search: '', hash: '' }, document: { addEventListener() { }, querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ style: {}, classList: { add() { }, toggle() { } }, appendChild() { }, addEventListener() { }, setAttribute() { } }) } };
  win.window = win; win.console = console; win.Intl = Intl; win.Date = Date; win.Math = Math;
  const ctx = vm.createContext(win);
  for (const f of ['data/config.js', 'data/course.js', 'data/courses.js', 'data/course-w3w.js', 'data/access-edits.js', 'data/contingency.js', 'data/track-grades.js', 'js/engine.js'])
    vm.runInContext(fs.readFileSync(root + '/' + f, 'utf8'), ctx, { filename: f });
  return win.GPT;
}
const A = load(OTHER), B = load(path.join(__dirname, '../..'));
let bad = 0, checks = 0;
const eq = (what, x, y) => { checks++; const sx = JSON.stringify(x), sy = JSON.stringify(y); if (sx !== sy) { if (bad++ < 12) console.log('DIFF', what, '\n   theirs', (sx || '').slice(0, 300), '\n   ours', (sy || '').slice(0, 300)); } };
const pick = r => r && { key: r.key, a: r.a && r.a.name, idx: r.idx, joinKm: r.joinKm, drive: r.drive, walk: r.walk, total: r.total, walkKm: r.walkKm, climb: r.climb, connM: r.connM, connBack: r.connBack, carry: r.carry, geom: r.connGeom && r.connGeom.length };
console.log('courses', A.courses.map(c => c.id + ':' + c.route.length).join(' '), '|', B.courses.map(c => c.id + ':' + c.route.length).join(' '));
A.courses.forEach((EA, ci) => {
  const EB = B.courses[ci], N = EA.route.length;
  eq(EA.id + ' access joins', EA.ACCESS.map(a => [a.name, a.idx, a.trail_km, a.joins.map(j => [j.idx, j.conn_m, j.conn_ascent, j.conn_back])]), EB.ACCESS.map(a => [a.name, a.idx, a.trail_km, a.joins.map(j => [j.idx, j.conn_m, j.conn_ascent, j.conn_back])]));
  eq(EA.id + ' stops', EA.AID.map(a => [a.name, a.idx, a.trail_km]), EB.AID.map(a => [a.name, a.idx, a.trail_km]));
  let t = Date.now(); const allA = EA.bestAtAll(); const tA = Date.now() - t; t = Date.now(); const allB = EB.bestAtAll(); const tB = Date.now() - t;
  console.log(`  ${EA.id}: fastest team at all ${N} points: theirs ${tA} ms, ours ${tB} ms`);
  for (let i = 0; i < N; i++) { const x = pick(allA[i]), y = pick(allB[i]); if (y) y.carry = x && x.carry; eq(`${EA.id} bestAtAll[${i}]`, x, y); }
  const day = Date.parse('2026-11-06T13:00:00+11:00'), night = Date.parse('2026-11-07T02:00:00+11:00');
  for (let i = 0; i < N; i += 7) {
    eq(`${EA.id} revisits ${i}`, EA.revisits(i), EB.revisits(i));
    eq(`${EA.id} revisits60 ${i}`, EA.revisits(i, 60), EB.revisits(i, 60));
    for (const tt of [day, night, undefined]) {
      const ra = EA.assess(i, tt), rb = EB.assess(i, tt);
      const P = r => ({ km: r.km, also: r.alsoKm, best: pick(r.best), backup: pick(r.backup), results: r.results.map(pick), aid: r.aid && [r.aid.prev && [r.aid.prev.a.name, r.aid.prev.walk, r.aid.prev.carry], r.aid.next && [r.aid.next.a.name, r.aid.next.walk, r.aid.next.carry]], exit: r.exit && [r.exit.a.name, r.exit.idx, r.exit.carry], rating: r.rating, night: r.night });
      eq(`${EA.id} assess ${i} ${tt}`, P(ra), P(rb));
    }
  }
  if (EA.sections) { const S = E => E.sections().map(s => [s.n, s.startKm, s.endKm, s.climb, s.rating, s.worst && [s.worst.km, pick(s.worst.r)], s.rows.map(r => [r.ic, pick(r.r)])]); eq(EA.id + ' sections', S(EA), S(EB)); }
  for (let k = 0; k < 400; k++) { const p = EA.route[(k * 37) % N], la = p[0] + (k % 9 - 4) * 0.0004, lo = p[1] + (k % 7 - 3) * 0.0005; eq(`${EA.id} snap ${k}`, EA.snap(la, lo), EB.snap(la, lo)); eq(`${EA.id} nearW3w ${k}`, EA.nearW3w(la, lo), EB.nearW3w(la, lo)); }
});
console.log(`${checks} checks, ${bad} difference(s)`);
process.exit(bad ? 1 : 0);
