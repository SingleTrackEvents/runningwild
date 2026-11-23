"""Shared helpers for building an event's course data from GPX files (Running Wild events)."""
import math, xml.etree.ElementTree as ET

def metres(a, b):
    R = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

def read_gpx(path):
    """Track points as [lat, lon, km, ele] (km from the start along the track) and waypoints as (name, lat, lon)."""
    root = ET.parse(path).getroot()
    ns = {'g': root.tag.split('}')[0].strip('{')} if root.tag.startswith('{') else {'g': ''}
    q = (lambda t: 'g:' + t) if ns['g'] else (lambda t: t)
    pts, route, km = [], [], 0.0
    for tp in root.iter('{%s}trkpt' % ns['g'] if ns['g'] else 'trkpt'):
        e = tp.find(q('ele'), ns) if ns['g'] else tp.find('ele')
        pts.append((float(tp.get('lat')), float(tp.get('lon')), float(e.text) if e is not None else None))
    for i, p in enumerate(pts):
        if i: km += metres(pts[i - 1], p) / 1000
        route.append([round(p[0], 6), round(p[1], 6), round(km, 3), None if p[2] is None else round(p[2], 1)])
    wpts = []
    for w in root.iter('{%s}wpt' % ns['g'] if ns['g'] else 'wpt'):
        n = w.find(q('name'), ns) if ns['g'] else w.find('name')
        wpts.append(((n.text or '').strip() if n is not None else '', float(w.get('lat')), float(w.get('lon'))))
    return route, wpts

def smooth_ascent(route, window=5):
    """Climb in metres from heights lightly smoothed (a GPS track's noise adds false climb)."""
    h = [p[3] for p in route]
    sm = []
    for i in range(len(h)):
        lo, hi = max(0, i - window // 2), min(len(h), i + window // 2 + 1)
        sm.append(sum(h[lo:hi]) / (hi - lo))
    up = sum(max(0, sm[i] - sm[i - 1]) for i in range(1, len(sm)))
    down = sum(max(0, sm[i - 1] - sm[i]) for i in range(1, len(sm)))
    return round(up), round(down)

def passes(route, lat, lon, max_m=80, gap_km=0.5):
    """Every time the route passes within max_m of a point: [(index, metres)], one per pass."""
    out, group = [], None
    for i, p in enumerate(route):
        d = metres((lat, lon), (p[0], p[1]))
        if d > max_m: continue
        if group and route[i][2] - route[group[0]][2] < gap_km:
            if d < group[1]: group[0], group[1] = i, d
        else:
            group = [i, d]; out.append(group)
    return [(g[0], g[1]) for g in out]

def climb_between(route, i0, i1):
    up = down = 0.0
    for i in range(i0 + 1, i1 + 1):
        d = route[i][3] - route[i - 1][3]
        if d > 0: up += d
        else: down -= d
    return round(up), round(down)
