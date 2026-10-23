// Batería E2E de @angular/service-worker (Playwright + Chrome/Edge instalados).
//
// Uso:  node e2e/sw-e2e.mjs ng19-sw|ng21-sw [--skip-build] [--headed]
//
// 1. Compila la app dos veces (v1 y v2) y guarda copias en e2e/.work/
// 2. Sirve v1 con el servidor estático, registra el SW y ejecuta las pruebas
// 3. "Despliega" v2 en el mismo puerto para probar la gestión de actualizaciones
// 4. Arranca el servidor SSR (Node) para comprobar la convivencia SW + SSR
// Resultado: e2e/results/<app>.json + resumen en consola.

import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = process.argv[2];
if (!['ng19-sw', 'ng21-sw', 'ng22-sw'].includes(app)) {
  console.error('Uso: node e2e/sw-e2e.mjs ng19-sw|ng21-sw|ng22-sw [--skip-build] [--headed]');
  process.exit(1);
}
const skipBuild = process.argv.includes('--skip-build');
const headed = process.argv.includes('--headed');
const port = { 'ng19-sw': 9019, 'ng21-sw': 9021, 'ng22-sw': 9022 }[app];
const ssrPort = port + 100;
const base = `http://localhost:${port}`;
const work = path.join(root, 'e2e/.work');
const appDir = path.join(root, app);
const dist = path.join(appDir, 'dist', app);

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function record(area, name, pass, detail = '') {
  results.push({ area, name, pass, detail });
  // LIMIT = comportamiento confirmado que constituye una limitación de @angular/service-worker
  const tag = pass === true ? 'PASS ' : pass === false ? 'FAIL ' : pass === 'LIMIT' ? 'LIMIT' : 'INFO ';
  console.log(`  ${tag} [${area}] ${name}${detail ? ' -> ' + detail : ''}`);
}

// ---------------------------------------------------------------- builds
function buildCopy(label) {
  console.log(`\n> build ${label} de ${app}...`);
  execSync('npm run build', { cwd: appDir, stdio: 'ignore' });
  const target = path.join(work, `${app}-${label}`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(dist, target, { recursive: true });
  return target;
}

let v1 = path.join(work, `${app}-v1`);
let v2 = path.join(work, `${app}-v2`);
if (!skipBuild || !fs.existsSync(v1) || !fs.existsSync(v2)) {
  v1 = buildCopy('v1');
  await sleep(1100); // build-id con resolución de segundos
  v2 = buildCopy('v2');
}
const buildId = (dir) =>
  fs
    .readdirSync(path.join(dir, 'browser'))
    .filter((f) => f.startsWith('main-'))
    .map((f) => fs.readFileSync(path.join(dir, 'browser', f), 'utf8').match(/ng\d\d-sw-\d{8}T\d{6}/)?.[0])[0];
const v1Id = buildId(v1);
const v2Id = buildId(v2);

// ---------------------------------------------------------------- servers
let server;
async function startStatic(dir) {
  await stopServer();
  server = spawn(process.execPath, [path.join(root, 'server/static-server.mjs'), path.join(dir, 'browser'), String(port)], {
    stdio: 'ignore',
  });
  await waitHttp(`${base}/admin/state`);
}
async function stopServer() {
  if (!server) return;
  const s = server;
  server = undefined;
  s.kill();
  await new Promise((r) => s.once('exit', r));
}
async function waitHttp(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`no responde ${url}`);
}

// ---------------------------------------------------------------- browser helpers
const browser = await chromium.launch({ channel: 'chrome', headless: !headed }).catch(() =>
  chromium.launch({ channel: 'msedge', headless: !headed }),
);

async function newPage(context) {
  const page = await context.newPage();
  page.consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && page.consoleErrors.push(m.text()));
  page.on('pageerror', (e) => page.consoleErrors.push(String(e)));
  return page;
}

/** Espera a que el SW controle la página y haya terminado de precachear. */
async function waitForSw(page, origin) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 45000 }).catch(() => {});
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 45000 });
  }
  // La instalación (prefetch) termina cuando la caché del grupo "app" tiene todos los ficheros
  const manifest = await (await fetch(`${origin}/ngsw.json?ngsw-cache-bust=${Date.now()}`)).json();
  const expected = manifest.assetGroups.find((g) => g.name === 'app').urls;
  for (let i = 0; i < 100; i++) {
    const cached = await cachedUrls(page);
    if (expected.every((u) => cached.includes(u))) return { manifest, cached };
    await sleep(200);
  }
  return { manifest, cached: await cachedUrls(page) };
}

const cachedUrls = (page) =>
  page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys()) {
      for (const r of await (await caches.open(name)).keys()) out.push(new URL(r.url).pathname);
    }
    return out;
  });

/** fetch() desde la página: pasa por el Service Worker igual que HttpClient(withFetch). */
const pageFetch = (page, url, init = {}) =>
  page.evaluate(
    async ([url, init]) => {
      const t0 = performance.now();
      try {
        const res = await fetch(url, init);
        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {}
        return { status: res.status, ms: Math.round(performance.now() - t0), json, text: text.slice(0, 200) };
      } catch (e) {
        return { status: 'network-error', ms: Math.round(performance.now() - t0), error: String(e) };
      }
    },
    [url, init],
  );

const swLog = (page) => page.evaluate(() => (globalThis.__swLabLog ?? []).map((e) => e.type));
const text = (page, sel) => page.locator(sel).first().textContent({ timeout: 10000 }).catch(() => null);

// =================================================================== PRUEBAS
console.log(`\n=== ${app}  (v1=${v1Id}  v2=${v2Id})`);
await startStatic(v1);
const context = await browser.newContext();
const page = await newPage(context);

// ---------------------------------------------------------------- 1. Registro
await page.goto(base + '/');
const tReg = Date.now();
const { manifest, cached } = await waitForSw(page, base);
record('registro', 'SwUpdate.isEnabled', (await text(page, '[data-test=sw-enabled]')) === 'true');
record('registro', 'SW controla la página', await page.evaluate(() => !!navigator.serviceWorker.controller), `${Date.now() - tReg} ms tras carga`);
record('registro', 'index del manifiesto', null, manifest.index);
record('registro', 'build-id v1 visible', (await text(page, '[data-test=build-id]')) === v1Id, v1Id);

// ---------------------------------------------------------------- 2. Caché de recursos
const appUrls = manifest.assetGroups.find((g) => g.name === 'app').urls;
const missing = appUrls.filter((u) => !cached.includes(u));
record('recursos', `grupo "app" (prefetch) precacheado: ${appUrls.length - missing.length}/${appUrls.length}`, missing.length === 0, missing.join(', '));
const lazyChunks = appUrls.filter((u) => /chunk-.*\.js$/.test(u));
record('lazy', `chunks lazy incluidos en precache: ${lazyChunks.length}`, lazyChunks.every((u) => cached.includes(u)));
record('recursos', 'asset lazy (svg) NO precacheado antes de usarse', !cached.includes('/img/lazy-asset.svg'));
const prerenderedLazy = cached.includes('/lazy/index.html');
record('prerender', 'HTML prerenderizado de /lazy en caché', null, prerenderedLazy ? 'sí' : 'no (solo /index.html y /index.csr.html)');

// ---------------------------------------------------------------- 3. Caché de APIs (online)
let r1 = await pageFetch(page, '/api/time');
let r2 = await pageFetch(page, '/api/time');
record('api', 'freshness online: siempre red', r1.json?.counter + 1 === r2.json?.counter, `counter ${r1.json?.counter} -> ${r2.json?.counter}`);
let c1 = await pageFetch(page, '/api/catalog');
await sleep(1200);
let c2 = await pageFetch(page, '/api/catalog');
record('api', 'performance: 2ª llamada desde caché', c1.json?.servedAt === c2.json?.servedAt, `${c2.ms} ms`);
await pageFetch(page, '/api/private');
await pageFetch(page, '/config.json');

// timeout de freshness (2 s) con respuesta lenta. La caché se indexa por URL completa (query incluida).
const s0 = await pageFetch(page, '/api/slow?ms=4000');
const s1 = await pageFetch(page, '/api/slow?ms=4000');
record('api', 'freshness sin copia previa espera a la red aunque supere el timeout', s0.ms >= 3900, `${s0.ms} ms`);
record('api', 'freshness timeout 2 s: respuesta lenta => copia cacheada', s1.ms < 3000 && s1.json?.servedAt === s0.json?.servedAt, `${s1.ms} ms`);
await sleep(2500); // la respuesta tardía actualiza la caché en segundo plano
const s2 = await pageFetch(page, '/api/slow?ms=4000');
record('api', 'freshness timeout: la caché se actualiza en segundo plano', s2.json?.servedAt !== s0.json?.servedAt, `${s2.ms} ms`);

// API degradada (HTTP 503) con caché disponible
await fetch(`${base}/admin/fail?on=1`);
const f1 = await pageFetch(page, '/api/time');
record('api', 'freshness con HTTP 503 y copia en caché => devuelve el 503', f1.status === 503 ? 'LIMIT' : false, `status ${f1.status}: solo cae a caché ante error de RED o timeout, no ante 5xx`);
await fetch(`${base}/admin/fail?on=0`);

// ngsw-bypass
r1 = await pageFetch(page, '/api/catalog', { headers: { 'ngsw-bypass': 'true' } });
record('api', 'ngsw-bypass evita la caché performance', r1.json?.servedAt !== c2.json?.servedAt);

// ---------------------------------------------------------------- 4. Config en tiempo de ejecución
const cfgFile = path.join(v1, 'browser/config.json');
const cfgOrig = fs.readFileSync(cfgFile, 'utf8');
fs.writeFileSync(cfgFile, cfgOrig.replace('"revision": 1', '"revision": 2'));
await page.goto(base + '/config');
await page.waitForSelector('[data-test=config]');
record('config', 'cambio de config.json sin recompilar visible al recargar', (await text(page, '[data-test=config]')).includes('"revision": 2'));
fs.writeFileSync(cfgFile, cfgOrig);
await page.goto(base + '/config');
await page.waitForSelector('[data-test=config]');

// ---------------------------------------------------------------- 5. Offline real (servidor parado => error de red)
await stopServer();
await page.goto(base + '/');
record('offline', 'recarga sin servidor: la app arranca', (await text(page, 'header h1'))?.includes('SW Lab') ?? false);
await page.goto(base + '/cache');
record('offline', 'deep-link a ruta lazy /cache sin servidor', (await text(page, 'h2'))?.includes('Cache Storage') ?? false);
await page.goto(base + '/lazy');
const lazyOk = await page.waitForSelector('[data-test=lazy-ok]', { timeout: 15000 }).then(() => true, () => false);
record('offline', 'ruta lazy nunca visitada funciona offline', lazyOk, lazyOk ? '' : (await page.locator('body').innerText()).slice(0, 200).replace(/\s+/g, ' '));
const imgOk = await page.locator('img').first().evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false);
record('offline', 'asset (installMode lazy) nunca cargado NO está offline', imgOk ? false : 'LIMIT', 'solo se cachea al usarse con red');
await page.goto(base + '/config');
record('offline', 'config runtime offline: última copia cacheada', (await text(page, '[data-test=config-source]'))?.includes('HTTP 200') ?? false);
r1 = await pageFetch(page, '/api/time');
record('offline', 'API freshness offline => caché', r1.status === 200, `status ${r1.status}`);
r1 = await pageFetch(page, '/api/catalog');
record('offline', 'API performance offline => caché', r1.status === 200, `status ${r1.status}`);
r1 = await pageFetch(page, '/api/private');
record('offline', 'API fuera de dataGroups offline => falla', r1.status !== 200, `status ${r1.status}`);
r1 = await pageFetch(page, '/api/echo', { method: 'POST', body: '{}' });
record('offline', 'POST offline => falla (no hay cola/background sync)', r1.status !== 200, `status ${r1.status}`);
r1 = await pageFetch(page, '/api/time', { headers: { 'ngsw-bypass': 'true' } });
record('offline', 'ngsw-bypass offline => falla (no usa caché)', r1.status !== 200, `status ${r1.status}`);

// ---------------------------------------------------------------- 6. Servidor "caído" respondiendo 503 (proxy/balanceador)
await startStatic(v1);
await fetch(`${base}/admin/down?on=1`);
await page.goto(base + '/');
record('offline', 'navegación con servidor devolviendo 503: shell desde caché', (await text(page, 'header h1'))?.includes('SW Lab') ?? false);
r1 = await pageFetch(page, '/api/time');
record('offline', 'API freshness con servidor 503 => devuelve el 503, no la caché', r1.status === 503 ? 'LIMIT' : false, `status ${r1.status}`);
await fetch(`${base}/admin/down?on=0`);

// ---------------------------------------------------------------- 7. Actualizaciones
await page.goto(base + '/');
await waitForSw(page, base);
await startStatic(v2); // "deploy" de la versión 2 en el mismo origen
await page.click('[data-test=check-update]');
await page.waitForFunction(() => (globalThis.__swLabLog ?? []).some((e) => e.type === 'VERSION_READY'), null, { timeout: 30000 }).catch(() => {});
const logTypes = await swLog(page);
record('update', 'VERSION_DETECTED + VERSION_READY tras checkForUpdate()', logTypes.includes('VERSION_DETECTED') && logTypes.includes('VERSION_READY'));
record('update', 'banner de actualización visible', await page.locator('[data-test=update-banner]').isVisible());
record('update', 'la pestaña sigue en v1 hasta activar', (await text(page, '[data-test=build-id]')) === v1Id);

// Segunda pestaña abierta en v1 => al recargar una, ¿qué versión recibe?
const page2 = await newPage(context);
await page2.goto(base + '/');
record('update', 'pestaña nueva tras VERSION_READY recibe', null, (await text(page2, '[data-test=build-id]')) === v2Id ? 'v2' : 'v1');
await page2.close();

await page.locator('[data-test=update-banner] button').click();
await page.waitForLoadState('load');
await page.waitForSelector('[data-test=build-id]');
record('update', 'activateUpdate() + reload => v2', (await text(page, '[data-test=build-id]')) === v2Id, await text(page, '[data-test=build-id]'));

// ---------------------------------------------------------------- 8. Estado irrecuperable
// Cliente en v1 con un chunk lazy que el navegador ha desalojado de la caché y que el
// servidor ya no tiene (deploy que borra ficheros antiguos sin dejar convivir versiones)
const apiChunk = fs
  .readdirSync(path.join(v1, 'browser'))
  .find((f) => f.startsWith('chunk-') && fs.readFileSync(path.join(v1, 'browser', f), 'utf8').includes('time-bypass'));
const broken = path.join(work, `${app}-v1-broken`);
fs.rmSync(broken, { recursive: true, force: true });
fs.cpSync(v1, broken, { recursive: true });
fs.rmSync(path.join(broken, 'browser', apiChunk));
await startStatic(v1);
const ctx3 = await browser.newContext();
const p3 = await newPage(ctx3);
await p3.goto(base + '/');
await waitForSw(p3, base);
await startStatic(broken);
const evict = () =>
  p3.evaluate(async (u) => {
    let n = 0;
    for (const name of await caches.keys()) if (await (await caches.open(name)).delete(u)) n++;
    return n;
  }, '/' + apiChunk);
await evict();
// El SW recupera el chunk de la caché HTTP del navegador (Cache-Control immutable) y lo vuelve a cachear
const httpCached = (await pageFetch(p3, '/' + apiChunk)).status;
const removed = await evict();
await (await ctx3.newCDPSession(p3)).send('Network.clearBrowserCache');
await p3.click('a[href="/api"]');
await sleep(3000);
const l3 = await swLog(p3);
record('update', 'chunk borrado de Cache Storage pero en caché HTTP => se recupera', httpCached === 200 ? 'LIMIT' : false, `status ${httpCached}: el SW no salta la caché HTTP salvo si el hash no coincide`);
record('update', 'chunk perdido (Cache Storage + HTTP + servidor) => UNRECOVERABLE_STATE', l3.includes('UNRECOVERABLE_STATE'), `${apiChunk} borrado de ${removed} caché(s); eventos: ${l3.join(',')}`);
record('update', 'banner de estado irrecuperable visible', await p3.locator('.banner.error').isVisible());
await ctx3.close();

// ---------------------------------------------------------------- 9. SSR + SW
await stopServer();
const ssr = spawn(process.execPath, [path.join(v2, 'server/server.mjs')], { env: { ...process.env, PORT: String(ssrPort) }, stdio: 'ignore' });
const ssrBase = `http://localhost:${ssrPort}`;
await waitHttp(`${ssrBase}/admin/state`);
const ctx4 = await browser.newContext();
const p4 = await newPage(ctx4);
await p4.goto(ssrBase + '/ssr');
record('ssr', '1ª visita a /ssr: HTML generado por SSR', (await p4.getAttribute('.render-info', 'data-render')) === 'server', await text(p4, '.render-info'));
await waitForSw(p4, ssrBase);
await p4.reload();
await p4.waitForSelector('.render-info');
const after = await p4.getAttribute('.render-info', 'data-render');
record('ssr', 'recarga de /ssr con SW activo NO llega al servidor SSR', after === 'server' ? false : 'LIMIT', after === 'server' ? 'SSR' : 'el SW sirve index.csr.html (CSR)');
await p4.goto(ssrBase + '/lazy');
await p4.waitForSelector('.render-info');
record('prerender', 'ruta prerenderizada /lazy con SW activo', null, (await p4.getAttribute('.render-info', 'data-render')) === 'server' ? 'HTML prerender' : 'CSR (index.csr.html)');
const hydrationErrors = [...page.consoleErrors, ...p4.consoleErrors].filter((e) => /NG0\d{3}/.test(e));
record('ssr', 'sin errores de hidratación (NG05xx) en consola', hydrationErrors.length === 0, hydrationErrors.slice(0, 2).join(' | '));
ssr.kill();
await ctx4.close();

// ---------------------------------------------------------------- fin
await context.close();
await browser.close();
await stopServer();

const passed = results.filter((r) => r.pass === true).length;
const failed = results.filter((r) => r.pass === false).length;
const limits = results.filter((r) => r.pass === 'LIMIT').length;
console.log(`\n${app}: ${passed} PASS · ${failed} FAIL · ${limits} LIMIT · ${results.length - passed - failed - limits} INFO`);
fs.mkdirSync(path.join(root, 'e2e/results'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'e2e/results', `${app}.json`),
  JSON.stringify({ app, date: new Date().toISOString(), v1Id, v2Id, results }, null, 2),
);
