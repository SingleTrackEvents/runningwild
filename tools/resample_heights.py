#!/usr/bin/env python3
"""Re-sample the heights of a stretch of the GPT100 course from a terrain model, for a stretch whose heights came in
stepped or missing (node tools/check_heights.mjs lists them).

Usage: python3 tools/resample_heights.py <from km> <to km> [--dry]
e.g.   python3 tools/resample_heights.py 86.4 108.08    (Mt William Carpark to Jimmy Creek Camp, 10 November 2026)

In data/course.js only the height (the fourth value) of the route points in that km range changes. The course line,
the km, the access points and everything else stay exactly as they are, and the tool checks that before it writes.
The points either side of the range keep their heights, so nothing outside it changes: end the range just short of an
aid station's km (108.08 for Jimmy Creek Camp at 108.085) to leave the aid station's own point as it is.
--dry shows the before and after without writing. Running it again on the same stretch gives the same heights.

How the heights are made:
- The ground height at each point from OpenTopoData's SRTM 30 m (whole metres), the helipad tool's second source. On
  the rest of the course the heights already in data/course.js sit within about 2 m of it on average. Open-Meteo's
  elevation API, the helipad tool's first source, isn't used here: it answers with the nearest cell of a 90 m model,
  which is fine for one helipad but blocky along a track (on Mt William to Jimmy Creek it counted 823 m of climb
  where SRTM 30 m counts 501 m).
- A light smoothing along the course (a Gaussian, SIGMA_M = 15 m either side, about one cell of the model). It takes
  out the 1 to 2 m flicker between points that sit closer together than the model's grid, and leaves real rises alone.
  With it the climb counts much as it does on the rest of the course: tried on km 72 to 86, km 108.5 to 125 and the
  old plateau route, where the heights are good, it counts 3% less climb in all than the heights already there
  (from 9% less to 5% more on each). With no smoothing it counts 7% more, with 30 m 9% less.
- The first and last TAPER_M (300 m) are eased onto the heights either side of the stretch, so the join shows no false
  step (the model reads about 10 m higher than the course data at Mt William Carpark).

Then it brings the figures worked out from the heights up to date: total_ascent_m in data/course.js, and
main_ascent_m in data/contingency.js when the stretch lies between its two aid stations. The race sheet's official
climb in data/races.js is not touched: when the stretch's climb moves by more than a few metres, update the up and
down of every point after it by hand, for each race that runs the stretch (done on 11 November 2026 for the Miler
and Stage 3 from Jimmy Creek on). Run node tools/bump_version.mjs afterwards.
"""
import json, math, os, re, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
COURSE = os.path.join(HERE, '..', 'data', 'course.js')
ALT = os.path.join(HERE, '..', 'data', 'contingency.js')
DEM = 'OpenTopoData SRTM 30 m'
DEM_URL = 'https://api.opentopodata.org/v1/srtm30m?locations='
SIGMA_M = 15     # smoothing along the course
TAPER_M = 300    # eased onto the heights either side over this distance
PAD_M = 100      # terrain heights are also read this far beyond each end, so the smoothing has both sides
GRID_M = 5


def dem_heights(pts):
    """Ground heights (m) for [(lat, lon)]: 100 positions a request, one request a second (the service's limits)."""
    out = {}
    need = list(dict.fromkeys(pts))
    for i in range(0, len(need), 100):
        batch = need[i:i + 100]
        url = DEM_URL + '|'.join(f'{p[0]},{p[1]}' for p in batch)
        for attempt in range(4):
            try:
                with urllib.request.urlopen(url, timeout=60) as r:
                    h = [x['elevation'] for x in json.load(r)['results']]
                if len(h) != len(batch) or any(x is None for x in h):
                    raise ValueError('incomplete answer')
                break
            except Exception as e:
                print(f'{DEM}: {e}', file=sys.stderr)
                time.sleep(2 * (attempt + 1))
        else:
            sys.exit(f'No terrain heights from {DEM}: nothing changed. Try again later.')
        out.update(zip(batch, h))
        time.sleep(1.1)
    return [out[p] for p in pts]


def smooth(km, h, sigma_m):
    """Heights h at km, smoothed along the course: put on a 5 m grid, a Gaussian of sigma_m, then read back at km."""
    step = GRID_M / 1000
    n = int(round((km[-1] - km[0]) / step)) + 1
    grid, j = [], 0
    for i in range(n):
        x = km[0] + i * step
        while j < len(km) - 2 and km[j + 1] < x:
            j += 1
        span = km[j + 1] - km[j]
        f = min(1.0, max(0.0, (x - km[j]) / span)) if span > 0 else 0.0
        grid.append(h[j] + f * (h[j + 1] - h[j]))
    r = math.ceil(3 * sigma_m / GRID_M)
    w = [math.exp(-0.5 * (d * GRID_M / sigma_m) ** 2) for d in range(-r, r + 1)]
    total = sum(w)
    sm = [sum(w[d + r] * grid[min(n - 1, max(0, i + d))] for d in range(-r, r + 1)) / total for i in range(n)]
    out = []
    for x in km:
        f = (x - km[0]) / step
        i = min(n - 2, int(f))
        out.append(sm[i] + (f - i) * (sm[i + 1] - sm[i]))
    return out


def up_down(h):
    up = sum(max(0.0, b - a) for a, b in zip(h, h[1:]))
    down = sum(max(0.0, a - b) for a, b in zip(h, h[1:]))
    return up, down


def shape(h):
    steps = [b - a for a, b in zip(h, h[1:])]
    flat = sum(1 for d in steps if d == 0)
    up, down = up_down(h)
    return f'{round(up)} m up, {round(down)} m down, {round(100 * flat / len(steps))}% of steps flat, biggest step {max(abs(d) for d in steps):.1f} m'


def num(x):
    """A height as the data files write it: one decimal, whole numbers without one."""
    x = round(x, 1)
    return str(int(x)) if x == int(x) else repr(x)


def main():
    args = [a for a in sys.argv[1:] if a != '--dry']
    dry = '--dry' in sys.argv[1:]
    try:
        k0, k1 = float(args[0]), float(args[1])
        assert len(args) == 2 and k1 > k0
    except (IndexError, ValueError, AssertionError):
        sys.exit('Usage: python3 tools/resample_heights.py <from km> <to km> [--dry]')

    src = open(COURSE, encoding='utf-8').read()
    m = re.search(r'"route":\[\[(.*?)\]\]', src, re.S)
    if not m:
        sys.exit('No route found in data/course.js')
    texts = m.group(1).split('],[')                    # each point as written: lat,lon,km,height
    route = [[float(v) for v in t.split(',')] for t in texts]
    if any(len(p) != 4 for p in route):
        sys.exit('A route point in data/course.js is not [lat, lon, km, height]')
    N = len(route)
    inside = [i for i, p in enumerate(route) if k0 - 1e-6 <= p[2] <= k1 + 1e-6]
    if len(inside) < 2:
        sys.exit(f'No course points between km {k0} and {k1}')
    i0, i1 = inside[0], inside[-1]

    # The stretch, with the points just beyond each end for the smoothing.
    a = i0
    while a > 0 and route[i0][2] - route[a][2] < PAD_M / 1000:
        a -= 1
    b = i1
    while b < N - 1 and route[b][2] - route[i1][2] < PAD_M / 1000:
        b += 1
    km = [p[2] for p in route[a:b + 1]]
    raw = dem_heights([(p[0], p[1]) for p in route[a:b + 1]])
    sm = smooth(km, raw, SIGMA_M)

    # Ease each end onto the height of the unchanged point beside it.
    def offset(anchor):
        return route[anchor][3] - sm[anchor - a] if 0 <= anchor < N and a <= anchor <= b else 0.0
    off0, off1 = (offset(i0 - 1) if i0 > 0 else 0.0), (offset(i1 + 1) if i1 < N - 1 else 0.0)
    new = {}
    for i in range(i0, i1 + 1):
        h = sm[i - a]
        if i0 > 0:
            h += off0 * max(0.0, 1 - (route[i][2] - route[i0 - 1][2]) * 1000 / TAPER_M)
        if i1 < N - 1:
            h += off1 * max(0.0, 1 - (route[i1 + 1][2] - route[i][2]) * 1000 / TAPER_M)
        new[i] = round(h, 1)

    old_h = [p[3] for p in route]
    new_h = [new.get(i, p[3]) for i, p in enumerate(route)]
    lo, hi = max(0, i0 - 1), min(N - 1, i1 + 1)    # with the point either side, so the joins are counted
    print(f'Km {route[i0][2]} to {route[i1][2]}: {i1 - i0 + 1} points, heights from {DEM}, smoothed {SIGMA_M} m.')
    print('  before: ' + shape(old_h[lo:hi + 1]))
    print('  after:  ' + shape(new_h[lo:hi + 1]))
    print(f'  eased onto the course heights at the ends by {off0:+.1f} m and {off1:+.1f} m; '
          f'biggest change at one point {max(abs(new[i] - old_h[i]) for i in new):.1f} m.')

    # Only the heights: the text of every point's lat, lon and km is kept as it is.
    for i, h in new.items():
        texts[i] = texts[i].rsplit(',', 1)[0] + ',' + num(h)
    out = src[:m.start(1)] + '],['.join(texts) + src[m.end(1):]
    asc_old = re.search(r'"total_ascent_m":(\d+)', out)
    asc_new = round(up_down(new_h)[0])
    if asc_old:
        out = out[:asc_old.start(1)] + str(asc_new) + out[asc_old.end(1):]
        print(f'Course climb (total_ascent_m): {asc_old.group(1)} m, now {asc_new} m.')

    # Check: the same file but for those heights and the total climb.
    get = lambda s: json.loads(re.search(r'window\.GPT100_DATA = (\{.*\});', s, re.S).group(1))
    was, now = get(src), get(out)
    for i, p in enumerate(now['route']):
        q = was['route'][i]
        if p[:3] != q[:3] or (p[3] != q[3] and not i0 <= i <= i1):
            sys.exit(f'Check failed at route point {i}: nothing written.')
    was['route'] = now['route'] = None
    was['total_ascent_m'] = now['total_ascent_m'] = None
    if was != now or len(get(out)['route']) != N:
        sys.exit('Check failed: something other than the heights changed. Nothing written.')

    # The other way's stored climb of this stretch of the course (data/contingency.js).
    alt_out = None
    if os.path.exists(ALT):
        alt = open(ALT, encoding='utf-8').read()
        leave = re.search(r'"leave":\{[^}]*"km":([\d.]+)', alt)
        rejoin = re.search(r'"rejoin":\{[^}]*"km":([\d.]+)', alt)
        stored = re.search(r'"main_ascent_m":(\d+)', alt)
        if leave and rejoin and stored and route[i0][2] < float(rejoin.group(1)) and route[i1][2] > float(leave.group(1)):
            ka, kb = float(leave.group(1)), float(rejoin.group(1))
            up = round(sum(max(0.0, new_h[i] - new_h[i - 1]) for i in range(1, N) if ka < route[i][2] <= kb))
            print(f'Climb from km {ka} to {kb} (main_ascent_m in data/contingency.js): {stored.group(1)} m, now {up} m.')
            alt_out = alt[:stored.start(1)] + str(up) + alt[stored.end(1):]

    if dry:
        print('Dry run: nothing written.')
        return
    open(COURSE, 'w', encoding='utf-8').write(out)
    if alt_out:
        open(ALT, 'w', encoding='utf-8').write(alt_out)
    print('Written. Now run node tools/check_heights.mjs, then node tools/bump_version.mjs.')


if __name__ == '__main__':
    main()
