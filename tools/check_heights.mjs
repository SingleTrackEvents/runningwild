// Looks for stepped or missing heights on the course lines: lists each stretch of the GPT100 between aid stations
// (data/course.js), then the other courses whole (data/contingency.js, data/courses.js, data/runner-courses.js), with
// how many height steps are flat, the longest flat run, the biggest single step and the climb.
// Good heights have few flat steps (about 6% on the GPT100) and no jumps. A GPX with heights at only some of its points
// comes out as a staircase (most steps flat, then jumps of tens of metres), which under-counts the climb.
// Usage: node tools/check_heights.mjs               every stretch
//        node tools/check_heights.mjs 86.4 108.1    one stretch of the GPT100, by km
// A stretch of the GPT100 marked STEPPED can be fixed with python3 tools/resample_heights.py <from km> <to km>.
import fs from 'fs';

globalThis.window = globalThis;
for (const f of ['course', 'contingency', 'courses', 'runner-courses']) {
  try { (0, eval)(fs.readFileSync(new URL(`../data/${f}.js`, import.meta.url), 'utf8')); } catch (e) { if (f === 'course') throw e; }
}
const D = globalThis.GPT100_DATA;

function stats(p) {
  if (p.length < 2) return null;
  let flat = 0, run = 0, longest = 0, big = 0, up = 0, down = 0;
  for (let i = 1; i < p.length; i++) {
    const d = p[i][3] - p[i - 1][3];
    if (d === 0) { flat++; run++; longest = Math.max(longest, run); } else run = 0;
    big = Math.max(big, Math.abs(d));
    if (d > 0) up += d; else down -= d;
  }
  const km = p[p.length - 1][2] - p[0][2], flatPct = 100 * flat / (p.length - 1);
  return { points: p.length, km, gap: 1000 * km / (p.length - 1), flatPct, longest, big, up, down, stepped: flatPct >= 30 || big >= 40 };
}
const between = (a, b) => D.route.filter(q => q[2] >= a - 1e-6 && q[2] <= b + 1e-6);

const [from, to] = process.argv.slice(2).map(Number);
let rows;
if (process.argv.length > 2) {
  if (!(to > from)) { console.error('Usage: node tools/check_heights.mjs [<from km> <to km>]'); process.exit(1); }
  rows = [[between(from, to), `GPT100 km ${from} to ${to}`]];
} else {
  const aid = D.access.filter(a => a.aid && !a.courses).sort((x, y) => x.trail_km - y.trail_km);
  rows = aid.slice(1).map((a, i) => [between(aid[i].trail_km, a.trail_km), `GPT100 km ${aid[i].trail_km.toFixed(1)} to ${a.trail_km.toFixed(1)}, ${aid[i].name} to ${a.name}`]);
  const X = globalThis.GPT100_CONTINGENCY;
  if (X && X.route) rows.push([X.route, `${X.name || 'Contingency'} (data/contingency.js)`]);
  for (const c of globalThis.GPT100_COURSES || []) rows.push([c.route, `${c.name || c.id} (data/courses.js)`]);
  for (const c of Object.values(globalThis.GPT_RUNNER_COURSES || {})) rows.push([c.route, `${c.name || c.id} (data/runner-courses.js)`]);
}
const cell = (v, w) => String(v).padStart(w);
console.log('points  apart  flat steps  longest flat run  biggest step      up    down');
let found = 0;
for (const [pts, name] of rows) {
  const s = stats(pts || []);
  if (!s) continue;
  if (s.stepped) found++;
  console.log(cell(s.points, 6) + cell(Math.round(s.gap) + ' m', 7) + cell(Math.round(s.flatPct) + '%', 12) + cell(s.longest, 18) + cell(s.big.toFixed(1) + ' m', 14) +
    cell(Math.round(s.up) + ' m', 8) + cell(Math.round(s.down) + ' m', 8) + '  ' + (s.stepped ? 'STEPPED  ' : '') + name);
}
console.log(found ? `${found} stretch${found > 1 ? 'es look' : ' looks'} stepped (30% or more of the steps flat, or a single step of 40 m or more).` : 'No stepped heights found.');
