// Descarga el modelo de elevación (tiles Terrarium de AWS Open Data, base SRTM) y los
// senderos / lugares de OpenStreetMap (Overpass) alrededor del Cerro Caracol.
// Escribe data/terrain.json y data/osm-raw.json. Uso: node scripts/fetch-terrain.mjs
import fs from 'node:fs/promises';
import { PNG } from 'pngjs';

const UA = 'cerro-caracol-guia/1.0 (https://github.com/jnfis/cerro-caracol)';
// Zona del modelo: ~7 km x 6 km centrados en el cerro, con río Biobío al oeste y Nonguén al sureste.
const BOX = { lat0: -36.868, lat1: -36.814, lon0: -73.082, lon1: -73.000 };
const COLS = 288, ROWS = 240, Z = 14;
await fs.mkdir('data', { recursive: true });

// ---------- Terreno ----------
const n = 2 ** Z;
const tx = (lon) => (lon + 180) / 360 * n;
const ty = (lat) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n; };
const x0 = Math.floor(tx(BOX.lon0)), x1 = Math.floor(tx(BOX.lon1));
const y0 = Math.floor(ty(BOX.lat1)), y1 = Math.floor(ty(BOX.lat0));
const tiles = new Map();
for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('tile ' + url + ' HTTP ' + r.status);
  const png = PNG.sync.read(Buffer.from(await r.arrayBuffer()));
  tiles.set(x + '/' + y, png);
  console.log('tile', x, y, png.width + 'x' + png.height);
}
function elevAt(lat, lon) {
  const fx = tx(lon), fy = ty(lat);
  const sample = (px, py) => {
    const X = Math.floor(px / 256), Y = Math.floor(py / 256);
    const t = tiles.get(X + '/' + Y); if (!t) return NaN;
    const i = ((py - Y * 256) * 256 + (px - X * 256)) * 4;
    return (t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256) - 32768;
  };
  const px = fx * 256 - 0.5, py = fy * 256 - 0.5;
  const ix = Math.floor(px), iy = Math.floor(py), ax = px - ix, ay = py - iy;
  const a = sample(ix, iy), b = sample(ix + 1, iy), c = sample(ix, iy + 1), d = sample(ix + 1, iy + 1);
  return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
}
const z = new Uint16Array(COLS * ROWS);
let mn = Infinity, mx = -Infinity;
for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
  const lat = BOX.lat1 - (BOX.lat1 - BOX.lat0) * j / (ROWS - 1);   // fila 0 = norte
  const lon = BOX.lon0 + (BOX.lon1 - BOX.lon0) * i / (COLS - 1);   // col 0 = oeste
  let e = elevAt(lat, lon); if (!Number.isFinite(e)) e = 0; e = Math.max(0, e);
  mn = Math.min(mn, e); mx = Math.max(mx, e);
  z[j * COLS + i] = Math.round(e * 10);
}
await fs.writeFile('data/terrain.json', JSON.stringify({
  ...BOX, cols: COLS, rows: ROWS, unit: 'dm', source: 'Terrarium (AWS Open Data, SRTM) z' + Z,
  z: Buffer.from(z.buffer).toString('base64')
}));
console.log('terreno', COLS + 'x' + ROWS, 'min', mn.toFixed(1), 'max', mx.toFixed(1));

// ---------- OpenStreetMap ----------
const bbox = '-36.858,-73.062,-36.822,-73.012';
const query = `[out:json][timeout:120];(
  way["highway"](${bbox});
  way["leisure"~"park|nature_reserve"](${bbox});
  way["natural"="water"](${bbox});
  way["waterway"](${bbox});
  way["landuse"="forest"](${bbox});
  way["natural"="wood"](${bbox});
  node["natural"="peak"](${bbox});
  node["tourism"](${bbox});
  node["historic"](${bbox});
  node["man_made"](${bbox});
  node["amenity"~"shelter|drinking_water|toilets|bench|ranger_station|parking"](${bbox});
  node["barrier"~"gate|entrance|bollard"](${bbox});
  node["entrance"](${bbox});
  node["name"](${bbox});
);out body;>;out skel qt;`;
let osm = null;
for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
  try {
    const r = await fetch(ep, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
    if (!r.ok) { console.log('overpass', ep, 'HTTP', r.status); continue; }
    osm = await r.json(); console.log('overpass', ep, osm.elements.length, 'elementos'); break;
  } catch (e) { console.log('overpass', ep, e.message); }
}
if (!osm) throw new Error('Overpass no respondió');
await fs.writeFile('data/osm-raw.json', JSON.stringify(osm));
const named = osm.elements.filter((e) => e.tags && e.tags.name).map((e) => `${e.type} ${e.id} ${e.tags.name} [${e.tags.highway || e.tags.tourism || e.tags.natural || e.tags.historic || e.tags.man_made || e.tags.leisure || ''}]`);
console.log('con nombre:\n' + named.join('\n'));
