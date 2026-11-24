"""Mt Buller SkyRun 2026: build the app's course data from Joe's GPX files (the tracking test, 6 December 2026).

    python3 tools/events/buller/build.py path/to/gpx-folder

The folder holds 45km.gpx, 36km.gpx, 22km.gpx, 5km.gpx and 2km.gpx (Drive: "Mt Buller Sky Run - GPX Files").
Writes data/course.js (the 45km, the main course), data/courses.js (36km and 22km), data/runner-courses.js
(5km and 2km), data/races.js (races and cut-offs), data/safety-officers.js (posts) and empties the GPT100-only
data files (track grades, helipads, pacing, splits, contingency, demo runners, stored what3words).

Cut-offs and start times are from "Mt Buller SkyRun - Event Operations Schedule 2026 - v 1-0". First-runner times
are estimates: the schedule's first finisher time spread evenly along the course. Climb is measured from the GPX
heights, lightly smoothed, not the official race figures. Posts are from the Day 1 crew table (19 November 2026).
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from gpx_lib import read_gpx, smooth_ascent, passes

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
DATA = os.path.join(ROOT, 'data')
DAY = '2026-12-06'
VILLAGE = 'Mt Buller Village'

def js(name, var, value, header):
    with open(os.path.join(DATA, name), 'w') as f:
        f.write(header.rstrip() + '\n')
        f.write('window.%s = %s;\n' % (var, json.dumps(value, separators=(',', ':'))))

def cum_climb(route, window=5):
    """Cumulative climb and descent at each route point, from lightly smoothed heights."""
    h = [p[3] for p in route]
    sm = []
    for i in range(len(h)):
        lo, hi = max(0, i - window // 2), min(len(h), i + window // 2 + 1)
        sm.append(sum(h[lo:hi]) / (hi - lo))
    up, down, U, D = 0.0, 0.0, [0], [0]
    for i in range(1, len(sm)):
        d = sm[i] - sm[i - 1]
        if d > 0: up += d
        else: down -= d
        U.append(round(up)); D.append(round(down))
    return U, D

def idx_at(route, km):
    return min(range(len(route)), key=lambda i: abs(route[i][2] - km))

def at(route, name_or_ll, wpts, n=0):
    """Route index of the nth pass of a waypoint (found by name) or of a (lat, lon)."""
    if isinstance(name_or_ll, str):
        w = [x for x in wpts if x[0] == name_or_ll]
        if not w: raise SystemExit('No waypoint named %r' % name_or_ll)
        lat, lon = w[0][1], w[0][2]
    else:
        lat, lon = name_or_ll
    p = passes(route, lat, lon, 80)
    if len(p) <= n: raise SystemExit('Pass %d of %r not found' % (n + 1, name_or_ll))
    return p[n][0]

def hm(t):
    return '%sT%s' % (DAY, t)

def add_minutes(t, m):
    h, mi = map(int, t.split(':'))
    tot = h * 60 + mi + int(round(m))
    return '%02d:%02d' % (tot // 60, tot % 60)

def race(route, start, winner_min, pts):
    """Race points: (name, kind, route index, cut-off 'HH:MM' or None, crew)."""
    U, D = cum_climb(route)
    total = route[-1][2]
    out = []
    for name, kind, i, cut, crew in pts:
        km = route[i][2]
        # gk: the point's km on its own course line (exact, from the GPX), so the apps don't place it by name.
        out.append({'name': name, 'kind': kind, 'km': round(km, 2), 'gk': round(km, 3), 'up': U[i], 'down': D[i],
                    'first': hm(add_minutes(start, winner_min * km / total)),
                    'cutoff': hm(cut) if cut else None, 'drop': False, 'crew': crew})
    return out

def main(folder):
    G = {c: read_gpx(os.path.join(folder, c + '.gpx')) for c in ['45km', '36km', '22km', '5km', '2km']}
    r45, w45 = G['45km']
    r36, w36 = G['36km']
    r22, w22 = G['22km']
    r5, w5 = G['5km']
    r2, w2 = G['2km']
    start = (r45[0][0], r45[0][1])

    # ---------- the 45km, the main course ----------
    i_stir1, i_stir2 = at(r45, 'Aid Station - Mt Stirling', w45, 0), at(r45, 'Aid Station - Mt Stirling', w45, 1)
    i_mir = at(r45, 'Aid Station - Mirimbah Park', w45)
    i_gate = at(r45, "Craig's Hut - Turn around at the gate", w45)
    i_nse, i_sum = at(r45, 'Northside Express', w45), at(r45, 'Summit - Mt Buller', w45)
    up, _ = smooth_ascent(r45)
    def access(name, i, aid=True, note=''):
        p = r45[i]
        a = {'name': name, 'lat': p[0], 'lon': p[1], 'trail_km': p[2], 'off_m': 0, 'aid': aid, 'conn_m': 0, 'conn_geom': None, 'reliable': False}
        if note: a['note'] = note
        return a
    # Vehicle access: the start and finish in the village, and the two aid stations crews drive to. No drive times yet
    # (Find isn't part of the tracking test), so the apps give the walk to each but no drive.
    acc = [
        access(VILLAGE + ' (Start)', 0),
        access('Mt Stirling aid station', i_stir1),
        access('Mt Stirling aid station (second pass)', i_stir2),
        access('Mirimbah Park aid station', i_mir),
        access(VILLAGE + ' (Finish)', len(r45) - 1),
    ]
    course = {'name': 'Mt Buller SkyRun 45km', 'label': '45km', 'total_km': round(r45[-1][2], 1), 'total_ascent_m': up,
              'bases': {'mb': [start[1], start[0]]}, 'route': r45, 'access': acc, 'crossings': [], 'bases_w3w': {}}
    js('course.js', 'GPT100_DATA', course, """// Mt Buller SkyRun 2026, the 45km (the main course): route [lat, lon, km, height m], the response base (the village),
// vehicle access and aid stations. Made by tools/events/buller/build.py from Joe's GPX (Drive: Mt Buller Sky Run - GPX
// Files, 18 November 2026). Climb is measured from the GPX heights, lightly smoothed. No drive times yet.""")

    # ---------- 36km and 22km: courses of their own ----------
    # Stop names match the race points' names in data/races.js (the apps place each race on its line by name: a plain
    # "Start" let the 22km's start match "Mt Buller summit" and the line came out as its last 3 km).
    def stops(route, wpts, rows):
        out = []
        for name, kind, i in rows:
            p = route[i]
            out.append({'name': name, 'lat': p[0], 'lon': p[1], 'km': p[2], 'kind': kind})
        return out
    i36 = {k: at(r36, k, w36) for k in ['Aid Station - Mt Stirling', 'Aid Station - Mirimbah Park', 'Northside Express', 'Summit - Mount Buller']}
    i22 = {'stir': at(r22, 'Aid Station - Mt Stirling', w22), 'hq1': at(r22, 'Howqua Gap Hut', w22, 0), 'hq2': at(r22, 'Howqua Gap Hut', w22, 1), 'sum': at(r22, 'Summit - Mt Buller', w22)}
    courses = [
        {'id': '36k', 'name': 'Mt Buller SkyRun 36km', 'label': '36km', 'note': '', 'total_km': round(r36[-1][2], 1), 'total_ascent_m': smooth_ascent(r36)[0],
         'stops': stops(r36, w36, [('Start, ' + VILLAGE, 'start', 0), ('Mt Stirling aid station', 'aid', i36['Aid Station - Mt Stirling']),
                                   ('Mirimbah Park aid station', 'aid', i36['Aid Station - Mirimbah Park']),
                                   ('Northside Express (checkpoint)', 'checkpoint', i36['Northside Express']),
                                   ('Mt Buller summit', 'checkpoint', i36['Summit - Mount Buller']), ('Finish, ' + VILLAGE, 'finish', len(r36) - 1)]),
         'joins': {}, 'route': r36},
        {'id': '22k', 'name': 'Mt Buller SkyRun 22km', 'label': '22km', 'note': '', 'total_km': round(r22[-1][2], 1), 'total_ascent_m': smooth_ascent(r22)[0],
         'stops': stops(r22, w22, [('Start, ' + VILLAGE, 'start', 0), ('Howqua Gap Hut', 'checkpoint', i22['hq1']), ('Mt Stirling aid station', 'aid', i22['stir']),
                                   ('Howqua Gap Hut (way back)', 'checkpoint', i22['hq2']), ('Mt Buller summit', 'checkpoint', i22['sum']),
                                   ('Finish, ' + VILLAGE, 'finish', len(r22) - 1)]),
         'joins': {}, 'route': r22},
    ]
    js('courses.js', 'GPT100_COURSES', courses, """// Mt Buller SkyRun 2026: the 36km and the 22km, alongside the 45km in data/course.js (tools/events/buller/build.py).
// Access points are shared with the 45km and join these courses where they're within 60 m of them.""")

    # ---------- 5km and 2km: the runner and field apps' maps only ----------
    def small(cid, name, route, rows):
        return {'id': cid, 'name': name, 'total_km': round(route[-1][2], 3),
                'stops': [{'name': n, 'kind': k, 'km': route[i][2], 'lat': route[i][0], 'lon': route[i][1]} for n, k, i in rows], 'route': route}
    rc = {'5k': small('5k', 'Mt Buller SkyRun 5km', r5, [('Start, ' + VILLAGE, 'start', 0), ('Mt Buller summit', 'checkpoint', at(r5, 'Summit - Mt Buller', w5)), ('Finish, ' + VILLAGE, 'finish', len(r5) - 1)]),
          '2k': small('2k', 'Mt Buller SkyRun 2km Kids Trail', r2, [('Start, ' + VILLAGE, 'start', 0), ('Finish, ' + VILLAGE, 'finish', len(r2) - 1)])}
    js('runner-courses.js', 'GPT_RUNNER_COURSES', rc, """// Mt Buller SkyRun 2026: the 5km and the 2km Kids Trail, for the runner and field apps' maps (tools/events/buller/build.py).""")

    # ---------- races and cut-offs ----------
    stages = {
        '45k': {'id': '45k', 'label': '45km', 'points': race(r45, '08:00', 260, [
            ('Start, ' + VILLAGE, 'start', 0, '08:00', 'yes'), ('Mt Stirling aid station', 'aid', i_stir1, '10:00', 'no'),
            ("Craig's Hut gate (turnaround)", 'checkpoint', i_gate, None, 'no'), ('Mt Stirling aid station (second pass)', 'aid', i_stir2, '12:00', 'no'),
            ('Mirimbah Park aid station', 'aid', i_mir, '14:00', 'no'), ('Northside Express', 'checkpoint', i_nse, '16:00', 'no'),
            ('Mt Buller summit', 'checkpoint', i_sum, None, 'no'), ('Finish, ' + VILLAGE, 'finish', len(r45) - 1, '17:00', 'yes')])},
        '36k': {'id': '36k', 'label': '36km', 'points': race(r36, '08:00', 210, [
            ('Start, ' + VILLAGE, 'start', 0, '08:00', 'yes'), ('Mt Stirling aid station', 'aid', i36['Aid Station - Mt Stirling'], '10:00', 'no'),
            ('Mirimbah Park aid station', 'aid', i36['Aid Station - Mirimbah Park'], '14:00', 'no'), ('Northside Express', 'checkpoint', i36['Northside Express'], '16:00', 'no'),
            ('Mt Buller summit', 'checkpoint', i36['Summit - Mount Buller'], None, 'no'), ('Finish, ' + VILLAGE, 'finish', len(r36) - 1, '17:00', 'yes')])},
        '22k': {'id': '22k', 'label': '22km', 'points': race(r22, '09:00', 110, [
            ('Start, ' + VILLAGE, 'start', 0, '09:00', 'yes'), ('Howqua Gap Hut', 'checkpoint', i22['hq1'], None, 'no'),
            ('Mt Stirling aid station', 'aid', i22['stir'], None, 'no'), ('Howqua Gap Hut (way back)', 'checkpoint', i22['hq2'], None, 'no'),
            ('Mt Buller summit', 'checkpoint', i22['sum'], None, 'no'), ('Finish, ' + VILLAGE, 'finish', len(r22) - 1, '14:00', 'yes')])},
        '5k': {'id': '5k', 'label': '5km', 'points': race(r5, '10:00', 25, [
            ('Start, ' + VILLAGE, 'start', 0, '10:00', 'yes'), ('Mt Buller summit', 'checkpoint', at(r5, 'Summit - Mt Buller', w5), None, 'no'),
            ('Finish, ' + VILLAGE, 'finish', len(r5) - 1, '13:00', 'yes')])},
        '2k': {'id': '2k', 'label': '2km Kids Trail', 'points': race(r2, '11:00', 12, [
            ('Start, ' + VILLAGE, 'start', 0, '11:00', 'yes'), ('Finish, ' + VILLAGE, 'finish', len(r2) - 1, None, 'yes')])},
    }
    races = {'stages': stages, 'races': [
        {'id': '45k', 'label': 'Mt Buller SkyRun 45km', 'short': '45km', 'course': '100', 'stages': ['45k']},
        {'id': '36k', 'label': 'Mt Buller SkyRun 36km', 'short': '36km', 'course': '36k', 'stages': ['36k']},
        {'id': '22k', 'label': 'Mt Buller SkyRun 22km', 'short': '22km', 'course': '22k', 'stages': ['22k']},
        {'id': '5k', 'label': 'Mt Buller SkyRun 5km', 'short': '5km', 'course': '5k', 'stages': ['5k']},
        {'id': '2k', 'label': '2km Kids Trail', 'short': '2km', 'course': '2k', 'stages': ['2k']}]}
    js('races.js', 'GPT_RACES', races, """// Mt Buller SkyRun 2026 races, Melbourne local time (tools/events/buller/build.py). Start times and cut-offs from the
// Event Operations Schedule 2026 v1.0. "first" is an estimate (the schedule's first finisher time spread evenly along
// the course). km is measured on the GPX; up and down from its heights, lightly smoothed. The Northside Express cut-off
// (16:00) sends runners to the finish without the summit climb.""")

    # ---------- pacing for the weather (the 45km, the longest day out) ----------
    # fast: the first runner (estimated); slow: the cut-offs, with points that have none placed in proportion by km
    # between the cut-offs either side. The weather watch and Weather tab put both runners against the forecast.
    pts = stages['45k']['points']
    def mins(t): return int(t[11:13]) * 60 + int(t[14:16])
    cut = [(p['km'], mins(p['cutoff'])) for p in pts if p['cutoff']]
    def slow_at(km):
        for (k0, m0), (k1, m1) in zip(cut, cut[1:]):
            if k0 <= km <= k1: return m0 + (m1 - m0) * (km - k0) / (k1 - k0 or 1)
        return cut[-1][1]
    pacing = {'miler': {'label': 'Mt Buller SkyRun 45km', 'points': [
        {'km': p['km'], 'name': p['name'], 'fast': p['first'], 'slow': hm(add_minutes('00:00', round(slow_at(p['km']))))} for p in pts]}}
    js('pacing.js', 'GPT100_PACING', pacing, """// Runner pacing for the weather (watch, timeline and simulator): the 45km's first runner (estimated) and the
// cut-offs, with points that have no cut-off placed in proportion (tools/events/buller/build.py). Key 'miler' is the
// app's name for the main race.""")

    # ---------- posts on the map (no names) ----------
    # t0 07:00; a and z are hours after it. Mirimbah: the Safety Officer (Day 1 crew table). Marshals: Craig's Hut and the
    # summit (from 10:00). The Cornhill Road crossing and the gate-touch point aren't placed yet: their positions
    # aren't in the GPX.
    so = {'t0': DAY + 'T07:00:00', 'n': 4 * 11,
          'stations': [{'name': 'Mirimbah Park', 'lat': r45[i_mir][0], 'lon': r45[i_mir][1]},
                       {'name': "Craig's Hut", 'lat': r45[i_gate][0], 'lon': r45[i_gate][1]},
                       {'name': 'Mt Buller summit', 'lat': r45[i_sum][0], 'lon': r45[i_sum][1]}],
          'posts': [{'station': 'Mirimbah Park', 'a': 1.5, 'z': 8, 'label': 'Safety Officer'},
                    {'station': "Craig's Hut", 'a': 1, 'z': 6, 'label': 'Marshal'},
                    {'station': 'Mt Buller summit', 'a': 3, 'z': 10, 'label': 'Marshal'}]}
    js('safety-officers.js', 'GPT100_SO', so, """// Mt Buller SkyRun 2026 posts for the maps (no names): the Safety Officer at Mirimbah Park and the marshals at Craig's
// Hut and the summit (from 10:00), from the Day 1 crew table. Shift times are a guess to confirm. tools/events/buller/build.py.""")

    # ---------- GPT100-only data, emptied ----------
    for name, var, note in [('track-grades.js', 'GPT100_TRACK', 'No track grades for Mt Buller yet (the GPT100 used the Parks Victoria grades).'),
                            ('helipads.js', 'GPT100_HELIPADS', 'No helicopter landing sites for Mt Buller yet.'),
                            ('splits.js', 'GPT_SPLITS', 'No fitted splits: no timing history for Mt Buller in the app yet.'),
                            ('contingency.js', 'GPT100_CONTINGENCY', 'No contingency course.'),
                            ('demo-runners.js', 'GPT100_DEMO', 'No demo runners for Mt Buller yet.')]:
        js(name, var, None, '// ' + note + ' (tools/events/buller/build.py)')
    js('course-w3w.js', 'GPT100_COURSE_W3W', {}, '// No stored what3words along the Buller courses yet: with no signal the apps give the position as numbers.')
    js('access-edits.js', 'GPT100_EDITS', {'custom': [], 'hidden': []}, '// Published access point edits (none for Mt Buller).')

    print('45km %.2f km, +%d m; access %d; Mt Stirling at %.2f and %.2f; Mirimbah %.2f; gate %.2f' % (r45[-1][2], up, len(acc), r45[i_stir1][2], r45[i_stir2][2], r45[i_mir][2], r45[i_gate][2]))
    print('36km %.2f km, 22km %.2f km, 5km %.2f km, 2km %.2f km' % (r36[-1][2], r22[-1][2], r5[-1][2], r2[-1][2]))

if __name__ == '__main__':
    if len(sys.argv) != 2: raise SystemExit(__doc__)
    main(sys.argv[1])
