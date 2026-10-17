#!/usr/bin/env python3
"""Construye data/route.json a partir de data/osm-raw.json y data/terrain.json.

Calcula la ruta a pie desde el portón del Parque Ecuador (Dr. Wilhelm) hasta el
Mirador Alemán y la cumbre por las vías de OpenStreetMap, la muestrea cada 10 m
con la cota del modelo de elevación, y recorta calles, senderos y agua para
dibujarlos sobre el relieve.  Uso: python3 scripts/build-route.py
"""
import base64, heapq, json, math, struct

T = json.load(open('data/terrain.json'))
Z = struct.unpack('<%dH' % (T['cols'] * T['rows']), base64.b64decode(T['z']))
OSM = json.load(open('data/osm-raw.json'))['elements']
NODES = {e['id']: e for e in OSM if e['type'] == 'node'}
WAYS = [e for e in OSM if e['type'] == 'way']

# Origen local = portón (se fija más abajo); x al este, z al sur, metros.
LAT_C = -36.838
MX = 111320 * math.cos(math.radians(LAT_C))
MY = 110574


def ele(lat, lon):
    """Cota bilineal del modelo de elevación (m)."""
    fi = (lon - T['lon0']) / (T['lon1'] - T['lon0']) * (T['cols'] - 1)
    fj = (T['lat1'] - lat) / (T['lat1'] - T['lat0']) * (T['rows'] - 1)
    fi = min(max(fi, 0), T['cols'] - 1.001); fj = min(max(fj, 0), T['rows'] - 1.001)
    i, j = int(fi), int(fj); a, b = fi - i, fj - j
    g = lambda ii, jj: Z[jj * T['cols'] + ii] / 10
    return (g(i, j) * (1 - a) + g(i + 1, j) * a) * (1 - b) + (g(i, j + 1) * (1 - a) + g(i + 1, j + 1) * a) * b


def dist(a, b):
    return math.hypot((a['lon'] - b['lon']) * MX, (a['lat'] - b['lat']) * MY)


WALK = {'path': 1.0, 'footway': 1.0, 'track': 1.0, 'steps': 1.2, 'service': 1.0, 'pedestrian': 1.0, 'cycleway': 1.1,
        'living_street': 1.4, 'residential': 1.5, 'unclassified': 1.4, 'tertiary': 1.8, 'secondary': 2.0, 'primary': 2.2}
adj = {}
for w in WAYS:
    hw = w.get('tags', {}).get('highway')
    if hw not in WALK or w['tags'].get('indoor') == 'yes':
        continue
    pen = WALK[hw]
    ns = [n for n in w['nodes'] if n in NODES]
    for a, b in zip(ns, ns[1:]):
        d = dist(NODES[a], NODES[b]) * pen
        adj.setdefault(a, []).append((b, d)); adj.setdefault(b, []).append((a, d))


def nearest(lat, lon, ids=None):
    best, bd = None, 1e18
    for n in (ids or adj):
        d = math.hypot((NODES[n]['lon'] - lon) * MX, (NODES[n]['lat'] - lat) * MY)
        if d < bd: best, bd = n, d
    return best, bd


def dijkstra(src, dst):
    pq = [(0, src)]; prev = {src: None}; cost = {src: 0}
    while pq:
        c, u = heapq.heappop(pq)
        if u == dst: break
        if c > cost[u]: continue
        for v, d in adj.get(u, []):
            nc = c + d
            if nc < cost.get(v, 1e18):
                cost[v] = nc; prev[v] = u; heapq.heappush(pq, (nc, v))
    if dst not in prev: raise SystemExit('sin ruta')
    path = []; u = dst
    while u is not None: path.append(u); u = prev[u]
    return path[::-1]


# Portón: extremo de "Subida Cerro Caracol desde Concepción" más cercano a calle Doctor Wilhelm.
subida = [w for w in WAYS if w.get('tags', {}).get('name', '').startswith('Subida Cerro Caracol desde Concepci')]
wilhelm = [w for w in WAYS if w.get('tags', {}).get('name') == 'Doctor Wilhelm']
wil_nodes = {n for w in wilhelm for n in w['nodes']}
cands = [n for w in subida for n in w['nodes'] if n in adj]
start = min(cands, key=lambda n: min(dist(NODES[n], NODES[m]) for m in wil_nodes))
START = NODES[start]
print('portón', round(START['lat'], 5), round(START['lon'], 5), 'cota', round(ele(START['lat'], START['lon']), 1))

POI = {
    'mirador_aleman': (-36.84345, -73.03842),
    'cumbre': (-36.84219, -73.03813),
    'torre_entel': (-36.83506, -73.04433),
    'mirador_cerro_caracol': (-36.8341, -73.04524),
    'mirador_castillo': (-36.83312, -73.04546),
    'mirador_banos': (-36.8337, -73.0473),
    'bosque_nativo': (-36.8413, -73.04185),
    'aguita': (-36.83514, -73.03866),
    'cerro_la_cruz': (-36.83793, -73.04892),
}
for k, (la, lo) in POI.items():
    print(f'  {k:24s} cota {ele(la, lo):6.1f}')

m_node, md = nearest(*POI['mirador_aleman'])
c_node, cd = nearest(*POI['cumbre'])
print('nodo mirador a', round(md), 'm; nodo cumbre a', round(cd), 'm')
full = dijkstra(start, m_node)


def to_xy(n):
    p = NODES[n] if isinstance(n, int) else n
    return ((p['lon'] - START['lon']) * MX, -(p['lat'] - START['lat']) * MY)


def to_ll(x, z):
    return (START['lat'] - z / MY, START['lon'] + x / MX)


# Muestreo cada 10 m con cota del DEM suavizada (ventana de 5 muestras).
pts = [to_xy(n) for n in full]
samples = []; d = 0.0
for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
    L = math.hypot(x1 - x0, z1 - z0)
    k = max(1, round(L / 10))
    for s in range(k):
        t = s / k
        x, z = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
        samples.append([x, z, d + L * t])
    d += L
samples.append([pts[-1][0], pts[-1][1], d])
raw = [ele(*to_ll(x, z)) for x, z, _ in samples]
sm = [sum(raw[max(0, i - 2):i + 3]) / len(raw[max(0, i - 2):i + 3]) for i in range(len(raw))]
points = [[round(x, 1), round(z, 1), round(e, 1), round(dd, 1)] for (x, z, dd), e in zip(samples, sm)]
mir_d = next(p[3] for p in points if math.hypot(p[0] - to_xy(m_node)[0], p[1] - to_xy(m_node)[1]) < 1)
gain = sum(max(0, b[2] - a[2]) for a, b in zip(points, points[1:]) if b[3] <= mir_d)
print(f'ruta: {mir_d:.0f} m al mirador, {d:.0f} m a la cumbre, +{gain:.0f} m hasta el mirador, '
      f'cota inicio {points[0][2]}, mirador {next(p[2] for p in points if p[3] >= mir_d)}, cumbre {points[-1][2]}')


def route_d(lat, lon):
    x, z = to_xy({'lat': lat, 'lon': lon})
    best = min(points, key=lambda p: math.hypot(p[0] - x, p[1] - z))
    return best[3], math.hypot(best[0] - x, best[1] - z)


for k, (la, lo) in POI.items():
    rd, off = route_d(la, lo)
    print(f'  {k:24s} km {rd/1000:4.2f} a {off:4.0f} m de la ruta')

# Líneas para dibujar: calles, senderos del cerro y agua, en coordenadas locales enteras.
PARK_HW = {'path', 'footway', 'track', 'steps', 'service'}
STREET_HW = {'residential', 'living_street', 'unclassified', 'tertiary', 'secondary', 'primary', 'pedestrian', 'trunk', 'primary_link', 'secondary_link', 'tertiary_link'}
LIM = 3200


def simplify(line, tol):
    if len(line) < 3: return line
    def dp(seg):
        (x0, y0), (x1, y1) = seg[0], seg[-1]
        L = math.hypot(x1 - x0, y1 - y0) or 1e-9
        worst, wi = 0, 0
        for i, (x, y) in enumerate(seg[1:-1], 1):
            dd = abs((x1 - x0) * (y0 - y) - (x0 - x) * (y1 - y0)) / L
            if dd > worst: worst, wi = dd, i
        if worst > tol: return dp(seg[:wi + 1])[:-1] + dp(seg[wi:])
        return [seg[0], seg[-1]]
    return dp(line)


lines = []
for w in WAYS:
    tg = w.get('tags', {})
    hw = tg.get('highway')
    kind = None
    if hw in PARK_HW and tg.get('indoor') != 'yes': kind = 'path'
    elif hw in STREET_HW: kind = 'street'
    elif tg.get('natural') == 'water' or tg.get('waterway') in ('river', 'stream', 'canal'): kind = 'water'
    if not kind: continue
    ns = [n for n in w['nodes'] if n in NODES]
    xy = [to_xy(n) for n in ns]
    xy = [(x, z) for x, z in xy if abs(x) < LIM and abs(z) < LIM]
    if len(xy) < 2: continue
    xy = simplify(xy, 6 if kind == 'street' else 3)
    lines.append({'k': kind, 'p': [[round(x), round(z)] for x, z in xy]})
print('líneas', len(lines), 'calles', sum(l['k'] == 'street' for l in lines), 'senderos', sum(l['k'] == 'path' for l in lines), 'agua', sum(l['k'] == 'water' for l in lines))

# Hitos sobre la ruta (km desde el portón) a partir de los lugares de OSM.
hitos = {
    'porton': 0,
    'mirador_castillo': route_d(*POI['mirador_castillo'])[0],
    'mirador_cerro_caracol': route_d(*POI['mirador_cerro_caracol'])[0],
    'torre_entel': route_d(*POI['torre_entel'])[0],
    'bosque_nativo': route_d(*POI['bosque_nativo'])[0],
    'cumbre': route_d(*POI['cumbre'])[0],
    'mirador_aleman': mir_d,
}
labels = [
    {'t': 'Centro de Concepción', 'll': (-36.8270, -73.0503)},
    {'t': 'Parque Ecuador', 'll': (-36.8330, -73.0480)},
    {'t': 'Universidad de Concepción', 'll': (-36.8305, -73.0360)},
    {'t': 'Río Biobío', 'll': (-36.8380, -73.0760)},
    {'t': 'Agüita de la Perdiz', 'll': (-36.8351, -73.0387)},
    {'t': 'Hacia Nonguén', 'll': (-36.8590, -73.0150)},
    {'t': 'Pedro de Valdivia', 'll': (-36.8470, -73.0510)},
]
for l in labels:
    x, z = to_xy({'lat': l['ll'][0], 'lon': l['ll'][1]}); l['x'] = round(x); l['z'] = round(z); l['e'] = round(ele(*l['ll']), 1); del l['ll']

out = {
    'origin': {'lat': START['lat'], 'lon': START['lon']}, 'mx': round(MX, 2), 'my': MY,
    'total': round(d, 1), 'mirador': round(mir_d, 1),
    'points': points, 'hitos': {k: round(v, 1) for k, v in hitos.items()}, 'lines': lines, 'labels': labels,
    'source': 'Ruta por vías de OpenStreetMap (ODbL); cotas SRTM/Terrarium',
}
json.dump(out, open('data/route.json', 'w'), separators=(',', ':'))
import os
print('route.json', os.path.getsize('data/route.json') // 1024, 'KB', len(points), 'puntos')
