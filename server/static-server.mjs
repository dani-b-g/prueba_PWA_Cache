// Servidor estático mínimo (sin dependencias) para probar el build de producción
// en modo CSR/prerender + la API simulada en el MISMO origen.
//
// Uso:  node server/static-server.mjs <carpeta-browser> <puerto>
// Ej.:  node server/static-server.mjs ng19-sw/dist/ng19-sw/browser 8019
//
// El Service Worker solo funciona en localhost o HTTPS y NUNCA con `ng serve`.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { mockApi, isDown } from './mock-api.mjs';

const root = path.resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 8080);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// Index para el fallback SPA: con SSR/prerender el CLI genera index.csr.html
const indexFile = ['index.html', 'index.csr.html']
  .map((f) => path.join(root, f))
  .find((f) => fs.existsSync(f));

function serveFile(res, file) {
  const ext = path.extname(file);
  const headers = { 'Content-Type': types[ext] ?? 'application/octet-stream' };
  // ngsw.json y ngsw-worker.js no deben cachearse por HTTP o las actualizaciones se retrasan
  const base = path.basename(file);
  headers['Cache-Control'] =
    base.startsWith('ngsw') || ext === '.html' || base === 'config.json'
      ? 'no-cache'
      : 'public, max-age=31536000, immutable';
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (isDown() && !url.pathname.startsWith('/admin/')) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      return res.end('Servidor caído (simulado)');
    }

    if (mockApi(req, res, () => false) !== false) return;

    const safe = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let file = path.join(root, safe);
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end();
    }
    // Página prerenderizada: /ruta -> /ruta/index.html
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

    if (fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file);

    // Recursos con extensión inexistentes -> 404; navegaciones -> fallback SPA
    if (path.extname(safe)) {
      res.writeHead(404);
      return res.end('not found');
    }
    return indexFile ? serveFile(res, indexFile) : (res.writeHead(404), res.end('no index'));
  })
  .listen(port, () => {
    console.log(`Sirviendo ${root}`);
    console.log(`  -> http://localhost:${port}  (index fallback: ${indexFile && path.basename(indexFile)})`);
  });
