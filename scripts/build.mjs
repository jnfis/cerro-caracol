// Genera _site/ para GitHub Pages: envuelve src/page.html en un documento completo y copia img/.
import fs from 'node:fs/promises';

const src = await fs.readFile('src/page.html', 'utf8');
const title = (src.match(/<title>(.*?)<\/title>/) || [, 'Cerro Caracol en Familia'])[1];
let body = src
  .replace(/<title>.*?<\/title>\s*/, '')
  .replace(/<meta name="claude:viewport-fit-sides"[^>]*>\s*/, '');
// En Pages servimos Three.js desde el propio sitio, sin depender de un CDN.
{
  const a = body.indexOf('<script src="https://cdnjs');
  const marker = "');}</script>";
  const b = body.indexOf(marker, a);
  if (a >= 0 && b > a) body = body.slice(0, a) + '<script src="vendor/three.min.js"></script>' + body.slice(b + marker.length);
}

const icon = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2f6b3a"/><path d="M6 50l15-24 10 14 7-9 20 19z" fill="#eef2ea"/><circle cx="46" cy="18" r="6" fill="#e0a83f"/></svg>');

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="Guía de bolsillo para subir el Cerro Caracol (Concepción) en familia: ruta 3D al Mirador Alemán, perfil de altura, hitos, fauna, flora e historia.">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#eef2ea">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0f1712">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Cerro Caracol">
<link rel="icon" href="data:image/svg+xml,${icon}">
<link rel="apple-touch-icon" href="data:image/svg+xml,${icon}">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font-family:system-ui,sans-serif;font-size:14px}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${body}
</body>
</html>
`;

await fs.rm('_site', { recursive: true, force: true });
await fs.mkdir('_site', { recursive: true });
await fs.writeFile('_site/index.html', html);
await fs.writeFile('_site/.nojekyll', '');
try { await fs.cp('img', '_site/img', { recursive: true }); } catch { console.log('sin carpeta img todavía'); }
await fs.mkdir('_site/data', { recursive: true });
try { await fs.cp('vendor', '_site/vendor', { recursive: true }); } catch { console.log('falta vendor/'); }
for (const f of ['terrain.json', 'route.json']) { try { await fs.copyFile('data/' + f, '_site/data/' + f); } catch { console.log('falta data/' + f); } }
console.log('_site listo');
