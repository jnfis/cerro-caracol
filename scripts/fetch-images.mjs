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
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, redirect: 'follow' });
  if (!r.ok) return null;
  return r.json();
}
const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// 1) Imagen principal del artículo de Wikipedia (en, luego es).
async function leadImage(title) {
  for (const lang of ['en', 'es']) {
    const s = await getJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    if (s && s.type !== 'disambiguation' && s.originalimage && s.originalimage.source) {
      const file = decodeURIComponent(s.originalimage.source.split('/').pop());
      return { file, lang, page: s.content_urls?.desktop?.page };
    }
  }
  return null;
}

// 2) Metadatos y miniatura de un archivo, en Commons o en la wiki local.
async function fileInfo(file, lang) {
  for (const host of ['commons.wikimedia.org', `${lang}.wikipedia.org`]) {
    const q = await getJSON(`https://${host}/w/api.php?action=query&titles=${encodeURIComponent('File:' + file)}&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=${WIDTH}&format=json`);
    const page = q && q.query && Object.values(q.query.pages)[0];
    const ii = page && page.imageinfo && page.imageinfo[0];
    if (ii && ii.thumburl) return { ...ii, host };
  }
  return null;
}

// 3) Búsqueda en Commons si el artículo no tiene imagen.
async function commonsSearch(term) {
  const q = await getJSON(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(term + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=${WIDTH}&format=json`);
  const pages = q && q.query ? Object.values(q.query.pages) : [];
  const hit = pages.find((p) => p.imageinfo && p.imageinfo[0] && /^image\/(jpeg|png)$/.test(p.imageinfo[0].mime));
  if (!hit) return null;
  return { file: hit.title.replace(/^File:/, ''), info: { ...hit.imageinfo[0], host: 'commons.wikimedia.org' } };
}

async function download(url, dest) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
}

let ok = 0, fail = 0;
for (const sp of species) {
  const existing = credits[sp.id];
  if (existing && !FORCE) {
    try { await fs.access(path.join('img', existing.file)); ok++; continue; } catch {}
  }
  const titles = [sp.title, ...(sp.alt || [])];
  let picked = null;
  try {
    for (const t of titles) {
      const lead = await leadImage(t);
      if (lead) {
        const info = await fileInfo(lead.file, lead.lang);
        if (info && /^image\/(jpeg|png)$/.test(info.mime)) { picked = { file: lead.file, info, from: lead.page || t }; break; }
      }
      await sleep(150);
    }
    if (!picked) {
      for (const t of titles) {
        const s = await commonsSearch(t);
        if (s) { picked = { file: s.file, info: s.info, from: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(s.file) }; break; }
      }
    }
    if (!picked) { console.log('SIN FOTO', sp.id); fail++; continue; }
    const ext = picked.info.mime === 'image/png' ? 'png' : 'jpg';
    const dest = `${sp.id}.${ext}`;
    await download(picked.info.thumburl, path.join('img', dest));
    const md = picked.info.extmetadata || {};
    credits[sp.id] = {
      file: dest,
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
  await sleep(250);
}
await fs.writeFile('img/credits.json', JSON.stringify(credits, null, 1));
console.log(`\n${ok} con foto, ${fail} sin foto`);
