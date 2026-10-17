// Descarga una foto por especie desde Wikipedia / Wikimedia Commons (licencias libres)
// y guarda img/<id>.<ext> más img/credits.json con autor y licencia.
// Uso: node scripts/fetch-images.mjs [--force]
import fs from 'node:fs/promises';
import path from 'node:path';

const UA = 'cerro-caracol-guia/1.0 (https://github.com/jnfis/cerro-caracol; guía familiar sin fines de lucro)';
const WIDTH = 560;
const FORCE = process.argv.includes('--force');
const species = JSON.parse(await fs.readFile('scripts/species.json', 'utf8'));
await fs.mkdir('img', { recursive: true });
let credits = {};
try { credits = JSON.parse(await fs.readFile('img/credits.json', 'utf8')); } catch {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, redirect: 'follow' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
// Títulos de archivo que suelen ser dibujos, mapas, especímenes o fotos poco útiles para identificar.
const BAD = /drawing|dibujo|illustration|ilustraci|sketch|köhler|kohler|smit|keulemans|gould|plate|lámina|map|mapa|distribution|range|skull|cráneo|specimen|museum|herbarium|\b1[0-8]\d\d\b|\b19[0-4]\d\b/i;

async function summary(lang, title) {
  const s = await getJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  return s && s.type !== 'disambiguation' ? s : null;
}
// Imagen representativa en Wikidata (P18) a partir del artículo.
async function wikidataImage(qid) {
  const c = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P18&format=json`);
  return c?.claims?.P18?.[0]?.mainsnak?.datavalue?.value || null;
}
// Metadatos y miniatura de un archivo, en Commons o en la wiki local.
async function fileInfo(file, lang) {
  for (const host of ['commons.wikimedia.org', `${lang || 'en'}.wikipedia.org`]) {
    const q = await getJSON(`https://${host}/w/api.php?action=query&titles=${encodeURIComponent('File:' + file)}&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=${WIDTH}&format=json`);
    const page = q && q.query && Object.values(q.query.pages)[0];
    const ii = page && page.imageinfo && page.imageinfo[0];
    if (ii && ii.thumburl) return { ...ii, host };
  }
  return null;
}
// Búsqueda en Commons, ordenada por relevancia.
async function commonsSearch(term) {
  const q = await getJSON(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(term + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=20&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=${WIDTH}&format=json`);
  const pages = q && q.query ? Object.values(q.query.pages) : [];
  return pages.filter((p) => p.imageinfo && p.imageinfo[0]).sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((p) => ({ file: p.title.replace(/^File:/, ''), info: { ...p.imageinfo[0], host: 'commons.wikimedia.org' } }));
}
async function download(url, dest) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
}

// Candidatos en orden de preferencia. Con `search` manda la búsqueda; si no, Wikidata y el artículo.
async function candidates(sp) {
  const titles = [sp.title, ...(sp.alt || [])];
  const fromSearch = [], fromWiki = [];
  if (sp.search) fromSearch.push(...await commonsSearch(sp.search));
  for (const t of titles) {
    for (const lang of ['en', 'es']) {
      const s = await summary(lang, t);
      if (!s) continue;
      if (s.wikibase_item) { const f = await wikidataImage(s.wikibase_item); if (f) fromWiki.push({ file: f, lang }); }
      if (s.originalimage) fromWiki.push({ file: decodeURIComponent(s.originalimage.source.split('/').pop()), lang });
    }
    if (fromWiki.length) break;
  }
  if (!sp.search) for (const t of titles) { const r = await commonsSearch(t); if (r.length) { fromSearch.push(...r); break; } }
  const all = sp.search ? [...fromSearch, ...fromWiki] : [...fromWiki, ...fromSearch];
  const seen = new Set();
  return all.filter((c) => { const k = c.file.replace(/_/g, ' '); if (seen.has(k)) return false; seen.add(k); return true; });
}

let ok = 0, fail = 0;
for (const sp of species) {
  const existing = credits[sp.id];
  const via = 'v2:' + (sp.search || '') + '|' + (sp.exclude || '');
  if (existing && !FORCE && existing.via === via) {
    try { await fs.access(path.join('img', existing.file)); ok++; continue; } catch {}
  }
  const exclude = sp.exclude ? new RegExp(sp.exclude, 'i') : null;
  let picked = null;
  try {
    for (const c of await candidates(sp)) {
      if (BAD.test(c.file) || (exclude && exclude.test(c.file))) continue;
      const info = c.info || await fileInfo(c.file, c.lang);
      if (!info || info.mime !== 'image/jpeg') continue;
      const desc = strip(info.extmetadata?.ImageDescription?.value || '');
      if (exclude && exclude.test(desc)) continue;
      picked = { file: c.file, info };
      break;
    }
    if (!picked) { console.log('SIN FOTO', sp.id); fail++; continue; }
    const dest = `${sp.id}.jpg`;
    await download(picked.info.thumburl, path.join('img', dest));
    if (existing && existing.file !== dest) { try { await fs.unlink(path.join('img', existing.file)); } catch {} }
    const md = picked.info.extmetadata || {};
    credits[sp.id] = {
      file: dest,
      via,
      source: picked.file,
      url: `https://${picked.info.host}/wiki/File:${encodeURIComponent(picked.file)}`,
      author: strip(md.Artist?.value) || strip(md.Credit?.value) || 'Autor no indicado',
      license: strip(md.LicenseShortName?.value) || 'ver fuente',
      licenseUrl: strip(md.LicenseUrl?.value) || ''
    };
    console.log('OK', sp.id, '<-', picked.file, '·', credits[sp.id].license);
    ok++;
  } catch (e) {
    console.log('ERROR', sp.id, e.message); fail++;
  }
  await sleep(200);
}
await fs.writeFile('img/credits.json', JSON.stringify(credits, null, 1));
console.log(`\n${ok} con foto, ${fail} sin foto`);
