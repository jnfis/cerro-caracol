# Cerro Caracol en Familia

Guía de bolsillo para subir el Parque Metropolitano Cerro Caracol (Concepción, Chile) con niños:
modelo 3D del sendero al Mirador Alemán, perfil de altura interactivo, hitos, fichas de fauna,
flora e insectos con foto, línea de tiempo histórica y guía práctica.

**Sitio:** https://jnfis.github.io/cerro-caracol/

## Estructura

- `src/page.html`: la página (una sola, sin dependencias salvo Three.js y Google Fonts).
- `scripts/species.json`: especies y sus títulos en Wikipedia, para buscar la foto.
- `scripts/fetch-images.mjs`: descarga una foto libre por especie desde Wikimedia Commons a `img/` y escribe `img/credits.json` (autor y licencia).
- `scripts/build.mjs`: arma `_site/` para GitHub Pages.
- `.github/workflows/site.yml`: en cada push a `main` descarga las fotos que falten, las guarda en el repo y publica el sitio.

## Desarrollo local

```sh
node scripts/fetch-images.mjs   # necesita internet
node scripts/build.mjs
npx serve _site                 # o cualquier servidor estático
```

## Fotos

Las fotos de especies vienen de Wikipedia y Wikimedia Commons con licencias libres (CC BY, CC BY-SA, dominio público).
Cada tarjeta muestra el autor y la licencia; el detalle está en `img/credits.json`.
