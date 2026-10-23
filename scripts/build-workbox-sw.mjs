// Post-build del SW Workbox:  node ../scripts/build-workbox-sw.mjs .
//  1. Empaqueta shared/workbox/sw.ts con esbuild (ya viene con el CLI de Angular)
//  2. Inyecta el manifiesto de precache de dist/<app>/browser (workbox-build injectManifest)
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const app = path.resolve(process.argv[2] ?? '.');
const req = createRequire(path.join(app, 'package.json'));
const esbuild = req('esbuild');
const { injectManifest } = req('workbox-build');

const name = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).name;
const browser = path.join(app, 'dist', name, 'browser');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(app, 'dist', 'sw.src.js');

await esbuild.build({
  entryPoints: [path.resolve(here, '../shared/workbox/sw.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  outfile: tmp,
  nodePaths: [path.join(app, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
});

const { count, size, warnings } = await injectManifest({
  swSrc: tmp,
  swDest: path.join(browser, 'sw.js'),
  globDirectory: browser,
  // Igual que el grupo "app" de NGSW: shell, JS (incluidos chunks lazy) y CSS. Las imágenes van aparte.
  globPatterns: ['index.csr.html', '*.{js,css,ico,webmanifest}'],
  globIgnores: ['sw.js', 'ngsw-worker.js', 'safety-worker.js', 'worker-basic.min.js'],
  // Los nombres con hash de Angular ya versionan el fichero: no hace falta revision
  dontCacheBustURLsMatching: /-[A-Za-z0-9_-]{8}\.(js|css)$/,
});
warnings.forEach((w) => console.warn('[workbox]', w));
console.log(`[workbox] sw.js generado: ${count} ficheros en precache (${(size / 1024).toFixed(0)} KB)`);
