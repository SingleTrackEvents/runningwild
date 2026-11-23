#!/usr/bin/env node
// Drive times between the crew points of every race, for the runner app's Crew tab ("leave by").
//   node tools/crew_drives.mjs            writes data/crew-drives.js
// It reads the crew points from data/races.js (crew: "yes"), places them with
// the app's own code, and asks Valhalla (valhalla1.openstreetmap.de, OpenStreetMap roads, the same service as
// tools/drive_routes.py) for the drive between each pair. Only the points' positions are sent. Shuttle-only points
// and points with no crew access are left out: nobody drives to them. The road map's times are then met in the middle with the event's own published
// times from Halls Gap (PUBLISHED below). Run it again when an aid station moves, a crew point is added or the
// published times change. It takes about three minutes (it asks for each drive in turn, politely).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VALHALLA = 'https://valhalla1.openstreetmap.de';
// The event's own crew drive times from Halls Gap, in minutes, as published at gpt100.com.au/aid-stations (read
// November 2026). Keep these in step with that page: the table meets them in the middle (see further down).
const PUBLISHED = { from: 'Halls Gap', min: { 'GAR Trailhead': 34, 'Rosea car park': 12, 'Borough Huts camp': 10, 'Mt William car park': 25, 'Jimmy Creek Camp': 28, 'Dunkeld': 46 } };
// The road the road map is slow on, from which point south, and the published drive that shows it.
const SLOW_ROAD = { ref: 'C216', southOf: 'Jimmy Creek Camp', anchor: 'Dunkeld' };
const ctx = { console }; ctx.window = ctx; ctx.location = { search: '', hash: '' }; ctx.navigator = {}; ctx.document = { getElementById: () => null, querySelector: () => null, addEventListener() { } };
vm.createContext(ctx);
for (const f of ['data/config.js', 'data/course.js', 'data/courses.js', 'data/course-w3w.js', 'data/access-edits.js', 'js/engine.js', 'data/pacing.js', 'data/races.js', 'data/splits.js', 'data/runner-courses.js', 'js/races.js'])
  vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
const R = ctx.GPT_RACES, RX = ctx.GPTRaces;

// Every point a crew can drive to, once (the same place serves several races).
const pts = [];
for (const race of R.races) for (const id of race.stages) {
  const S = RX.prepare(R.stages[id], race.course);
  S.points.forEach(p => {
    if (p.crew !== 'yes' || p.lat == null) return;
    const had = pts.find(q => Math.abs(q.lat - p.lat) < 0.002 && Math.abs(q.lon - p.lon) < 0.002);
    if (had) { if (!had.names.includes(p.name)) had.names.push(p.name); } else pts.push({ names: [p.name], lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5) });
  });
}
console.log(pts.length + ' crew points:'); pts.forEach(p => console.log('  ' + p.names.join(' / ').padEnd(44), p.lat, p.lon));

const locs = pts.map(p => ({ lat: p.lat, lon: p.lon, radius: 400 }));
// The free server takes 100 pairs at a time: a few starting points per request, with a pause between.
const M = [], STEP = Math.max(1, Math.floor(100 / locs.length));
for (let i = 0; i < locs.length; i += STEP) {
  const res = await fetch(VALHALLA + '/sources_to_targets', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'GPT100 crew drives' },
    body: JSON.stringify({ sources: locs.slice(i, i + STEP), targets: locs, costing: 'auto', units: 'kilometers' }) });
  if (!res.ok) { console.error('Valhalla said ' + res.status + ': ' + (await res.text()).slice(0, 300)); process.exit(1); }
  M.push(...(await res.json()).sources_to_targets);
  await new Promise(r => setTimeout(r, 1200));
}
const roadMin = M.map(row => row.map(c => c.time == null ? null : Math.round(c.time / 60))), km = M.map(row => row.map(c => c.distance == null ? null : Math.round(c.distance * 10) / 10));
const holes = roadMin.flat().filter(x => x == null).length;
if (holes) console.log('WARNING: ' + holes + ' pair(s) have no route. The app shows no drive time for those.');

// ---------- meeting the event's published times in the middle ----------
// The event publishes its own crew drive times from Halls Gap (PUBLISHED, above). Where the road map and a published
// time differ, the table sits halfway between them. In November 2026 five of the six were within 2 minutes; Halls Gap
// to Dunkeld was 62 minutes by the road map and 46 published. The road map is slow on the Grampians Rd (C216) south of
// Jimmy Creek (it agrees with the published time as far as Jimmy Creek), so every drive that uses that stretch comes
// down by the same share of its time there: enough to put Halls Gap to Dunkeld on the halfway mark.
const at = n => pts.findIndex(p => p.names.includes(n)), HG = at(PUBLISHED.from), mid = (a, b) => Math.round((a + b) / 2);
const decode = str => { const out = []; let i = 0, lat = 0, lon = 0; while (i < str.length) { for (const k of [0, 1]) { let sh = 0, r = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); const d = r & 1 ? ~(r >> 1) : r >> 1; if (k) lon += d; else lat += d; } out.push([lat / 1e6, lon / 1e6]); } return out; };
const metres = (a, b) => { const r = Math.PI / 180, x = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(x)); };
// Minutes of one drive spent on the slow stretch: its part of the road with that number, south of the named point.
async function onStretch(a, b, southOf) {
  const res = await fetch(VALHALLA + '/route', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'GPT100 crew drives' },
    body: JSON.stringify({ locations: [{ lat: a.lat, lon: a.lon, radius: 400 }, { lat: b.lat, lon: b.lon, radius: 400 }], costing: 'auto', units: 'kilometers' }) });
  if (!res.ok) return 0;
  const leg = (await res.json()).trip.legs[0], sh = decode(leg.shape);
  let secs = 0;
  for (const m of leg.maneuvers) {
    if (!(m.street_names || []).includes(SLOW_ROAD.ref)) continue;
    let all = 0, south = 0;
    for (let k = m.begin_shape_index; k < m.end_shape_index; k++) { const d = metres(sh[k], sh[k + 1]); all += d; if ((sh[k][0] + sh[k + 1][0]) / 2 < southOf) south += d; }
    if (all) secs += m.time * south / all;
  }
  return secs / 60;
}
const min = roadMin.map(r => r.slice());
if (HG >= 0 && at(SLOW_ROAD.southOf) >= 0 && at(SLOW_ROAD.anchor) >= 0) {
  const southOf = pts[at(SLOW_ROAD.southOf)].lat, AN = at(SLOW_ROAD.anchor), pub = PUBLISHED.min[SLOW_ROAD.anchor];
  const stretch = pts.map(() => pts.map(() => 0));
  for (let i = 0; i < pts.length; i++) for (let k = 0; k < pts.length; k++) if (i !== k && roadMin[i][k] != null) { stretch[i][k] = await onStretch(pts[i], pts[k], southOf); await new Promise(r => setTimeout(r, 1100)); }
  // The share to take off the stretch so the anchor drive lands halfway between the road map and the published time.
  const want = (roadMin[HG][AN] + pub) / 2, share = stretch[HG][AN] > 1 ? Math.max(0, Math.min(0.5, (roadMin[HG][AN] - want) / stretch[HG][AN])) : 0;
  console.log(`\n${SLOW_ROAD.ref} south of ${SLOW_ROAD.southOf}: ${PUBLISHED.from} to ${SLOW_ROAD.anchor} is ${roadMin[HG][AN]} min by the road map (${stretch[HG][AN].toFixed(0)} of them on that stretch), ${pub} published. Halfway is ${want}: ${(share * 100).toFixed(0)}% comes off every drive's time on the stretch.`);
  for (let i = 0; i < pts.length; i++) for (let k = 0; k < pts.length; k++) if (i !== k && roadMin[i][k] != null) min[i][k] = Math.round(roadMin[i][k] - share * stretch[i][k]);
  // The published legs themselves, both ways: halfway between the road map and the published time.
  for (const [name, p] of Object.entries(PUBLISHED.min)) { const x = at(name); if (x < 0) continue; for (const [i, k] of [[HG, x], [x, HG]]) if (roadMin[i][k] != null) min[i][k] = name === SLOW_ROAD.anchor ? mid(roadMin[i][k], p) : mid(min[i][k], p); }
  console.log('\nAgainst the published times from ' + PUBLISHED.from + ' (published, road map, table):');
  for (const [name, p] of Object.entries(PUBLISHED.min)) { const x = at(name); if (x >= 0) console.log('  ' + name.padEnd(22) + String(p).padStart(4) + String(roadMin[HG][x]).padStart(5) + String(min[HG][x]).padStart(5)); }
} else console.log('WARNING: the published times were not applied (a named point is missing).');

const out = `// Drive times between the crew points (minutes and km by road), for "leave by" on the runner app's Crew tab.
// Made by tools/crew_drives.mjs on ${new Date().toISOString().slice(0, 10)} from OpenStreetMap roads (Valhalla), met in the middle with the event's
// published times from Halls Gap (gpt100.com.au/aid-stations). min is what the app shows; roadMin is the road map alone.
// Do not edit by hand: run the tool again. A guide only: it knows nothing of race-day traffic, road closures or the
// walk in from the car park, and it has not been checked against Google Maps.
window.GPT_CREW_DRIVES = ${JSON.stringify({ made: new Date().toISOString().slice(0, 10), published: PUBLISHED, pts: pts.map(p => ({ names: p.names, lat: p.lat, lon: p.lon })), min, km, roadMin })};
`;
writeFileSync(join(ROOT, 'data/crew-drives.js'), out);
console.log('wrote data/crew-drives.js');
pts.forEach((p, i) => console.log(p.names[0].padEnd(26) + min[i].map(x => String(x == null ? '-' : x).padStart(4)).join('')));
