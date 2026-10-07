// Batería E2E de la arquitectura de caché declarativa (arq-offline).
//
// Uso: node e2e/arq-e2e.mjs ng21-sw|ng22-sw|ng21-wb [--skip-build] [--headed]
//
//  ng21-sw / ng22-sw : assets con @angular/service-worker + APIs con arq-offline (interceptor)
//  ng21-wb           : assets y APIs con un SW propio Workbox que lee las mismas reglas JSON
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = process.argv[2];
const ports = { 'ng21-sw': 9221, 'ng22-sw': 9222, 'ng21-wb': 9223 };
if (!ports[app]) {
  console.error('Uso: node e2e/arq-e2e.mjs ng21-sw|ng22-sw|ng21-wb [--skip-build] [--headed]');
  process.exit(1);
}
const workbox = app === 'ng21-wb';
const port = ports[app];
const base = `http://localhost:${port}`;
const appDir = path.join(root, app);
const work = path.join(root, 'e2e/.work');
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function record(area, name, pass, detail = '') {
  results.push({ area, name, pass, detail });
  const tag = pass === true ? 'PASS ' : pass === false ? 'FAIL ' : pass === 'LIMIT' ? 'LIMIT' : 'INFO ';
  console.log(`  ${tag} [${area}] ${name}${detail ? ' -> ' + detail : ''}`);
}

// ---------------------------------------------------------------- builds (v1 y v2 para probar updates)
function buildCopy(label) {
  console.log(`> build ${label} de ${app}...`);
  execSync('npm run build', { cwd: appDir, stdio: 'ignore' });
  const target = path.join(work, `arq-${app}-${label}`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(path.join(appDir, 'dist', app, 'browser'), target, { recursive: true });
  return target;
}
let v1 = path.join(work, `arq-${app}-v1`);
let v2 = path.join(work, `arq-${app}-v2`);
if (!process.argv.includes('--skip-build') || !fs.existsSync(v1) || !fs.existsSync(v2)) {
  v1 = buildCopy('v1');
  await sleep(1100);
  v2 = buildCopy('v2');
}
const buildId = (dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8').match(/ng\d\d-(sw|wb)-\d{8}T\d{6}/)?.[0])
    .find(Boolean);

// ---------------------------------------------------------------- servidor
let server;
async function start(dir) {
  await stop();
  server = spawn(process.execPath, [path.join(root, 'server/static-server.mjs'), dir, String(port)], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/admin/state`)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('el servidor no arranca');
}
async function stop() {
  if (!server) return;
  const s = server;
  server = undefined;
  s.kill();
  await new Promise((r) => s.once('exit', r));
}
const admin = (q) => fetch(`${base}/admin/${q}`);

// ---------------------------------------------------------------- navegador
const browser = await chromium
  .launch({ channel: 'chrome', headless: !process.argv.includes('--headed') })
  .catch(() => chromium.launch({ channel: 'msedge', headless: !process.argv.includes('--headed') }));
const context = await browser.newContext();
const page = await context.newPage();

async function waitControlled() {
  for (let i = 0; i < 2; i++) {
    const ok = await page
      .waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 40000 })
      .then(() => true, () => false);
    if (ok) break;
    await page.reload();
  }
  await sleep(1500); // fin del precache
}

const cacheSummary = () =>
  page.evaluate(async () => {
    const out = {};
    for (const n of await caches.keys()) out[n] = (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search);
    return out;
  });

/** Pulsa un botón de /arq y devuelve { outcome, status, body } de la respuesta mostrada. */
async function arqCall(rule) {
  const before = await page.locator('[data-test=arq-last-body]').textContent().catch(() => null);
  await page.click(`[data-test=arq-${rule}]`);
  await page.waitForFunction((b) => document.querySelector('[data-test=arq-last-body]')?.textContent !== b, before, { timeout: 15000 }).catch(() => {});
  const p = page.locator('[data-test=arq-last-outcome]');
  return {
    outcome: await p.getAttribute('data-outcome'),
    text: (await p.textContent())?.trim(),
    body: await page.locator('[data-test=arq-last-body]').textContent(),
  };
}

/** fetch() desde la página con usuario: pasa por el SW (variante Workbox). */
const swFetch = (url, user = 'ana') =>
  page.evaluate(
    async ([url, user]) => {
      try {
        const r = await fetch(url, { headers: { 'x-user': user } });
        return { status: r.status, json: await r.json().catch(() => null) };
      } catch (e) {
        return { status: 'network-error' };
      }
    },
    [url, user],
  );

async function setUser(u) {
  await page.evaluate((u) => localStorage.setItem('demo-user', u), u);
}

// ================================================================= PRUEBAS
console.log(`\n=== arq-offline · ${app} (${workbox ? 'SW Workbox' : 'interceptor + NGSW para assets'})`);
await start(v1);
await page.goto(base + '/');
await setUser('ana');
await waitControlled();
const ctrl = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
record('assets', 'SW controla la página', !!ctrl, ctrl ?? '');

// ---------------------------------------------------------------- assets
const caches1 = await cacheSummary();
const jsFiles = fs.readdirSync(v1).filter((f) => /\.(js|css)$/.test(f) && !/^(sw|ngsw-worker|safety-worker|worker-basic\.min)\.js$/.test(f));
const cachedAssets = Object.entries(caches1)
  .filter(([n]) => /assets:app|workbox-precache/.test(n))
  .flatMap(([, urls]) => urls.map((u) => u.split('?')[0]));
const missingAssets = jsFiles.filter((f) => !cachedAssets.includes('/' + f));
record('assets', `JS/CSS precacheados (chunks lazy incluidos): ${jsFiles.length - missingAssets.length}/${jsFiles.length}`, missingAssets.length === 0, missingAssets.join(','));
record('assets', 'cachés del navegador', null, Object.keys(caches1).join(' | '));

if (!workbox) {
  // ============================================================ variante interceptor
  await page.goto(base + '/arq-panel');
  await page.waitForSelector('[data-rule=catalogo]');
  const srcCat = await page.locator('[data-rule=catalogo] td').nth(6).textContent();
  record('reglas', 'regla JSON sobrescribe a la de código (catalogo)', srcCat.includes('json'), srcCat);
  record('reglas', 'reglas de la feature lazy NO visibles antes de visitarla', (await page.locator('[data-rule=expedientes-mios]').count()) === 0 ? 'LIMIT' : true, 'se registran al activar la ruta');

  await page.goto(base + '/arq');
  await page.waitForSelector('[data-test=arq-expedientes-mios]');
  let r = await arqCall('expedientes-mios');
  record('api', 'network-first online => red', r.outcome === 'network', r.text);
  record('api', 'datos del usuario ana', r.body.includes('Expediente 1 de ana'));
  r = await arqCall('catalogo');
  const r2 = await arqCall('catalogo');
  record('api', 'cache-first: 2ª llamada sin red', r.outcome === 'network' && r2.outcome === 'cache-hit', `${r.outcome} -> ${r2.outcome}`);
  await arqCall('privado');
  await arqCall('tiempo');

  // 5xx => caché (lo que NGSW no hace)
  await admin('fail?on=1');
  r = await arqCall('expedientes-mios');
  const badge = await page.locator('tr:has([data-test=arq-expedientes-mios]) arq-data-freshness').textContent();
  record('api', 'API 503 => datos guardados (fallback-5xx)', r.outcome === 'fallback-5xx', badge.trim());
  r = await arqCall('privado');
  record('api', 'network-only con 503 => error (no se guarda)', r.outcome === null && r.text.includes('503'), r.text);
  await admin('fail?on=0');

  // Búsqueda: máximo 3 entradas (se eliminan las más antiguas)
  for (const q of ['a', 'b', 'c', 'd']) {
    await page.fill('input', q);
    await page.click('button:has-text("Buscar")');
    await sleep(300);
  }
  let entries = (await cacheSummary())['arq-api-cache:v1'] ?? [];
  const busq = entries.filter((u) => u.includes('/busqueda'));
  record('api', 'maxEntries=3 en búsqueda (4 consultas)', busq.length === 3, `${busq.length} entradas`);
  record('api', 'network-only nunca se guarda', !entries.some((u) => u.includes('private')));

  // Offline real
  await stop();
  await page.goto(base + '/arq');
  await page.waitForSelector('[data-test=arq-expedientes-mios]', { timeout: 15000 });
  r = await arqCall('expedientes-mios');
  record('offline', 'sin servidor: shell (NGSW) + datos de ana (arq-offline)', r.outcome === 'fallback-offline' && r.body.includes('de ana'), r.text);
  const badgeOff = await page.locator('tr:has([data-test=arq-expedientes-mios]) arq-data-freshness').textContent();
  record('offline', 'indicador de solo lectura', badgeOff.includes('Sin conexión'), badgeOff.trim());
  r = await arqCall('catalogo');
  record('offline', 'catálogo offline', ['cache-hit', 'fallback-offline'].includes(r.outcome), r.outcome);
  await page.click('[data-test=user-luis]');
  r = await arqCall('expedientes-mios');
  record('usuarios', 'otro usuario offline NO ve los datos de ana', !r.body.includes('de ana'), r.text);

  // Panel
  await page.goto(base + '/arq-panel');
  await page.waitForSelector('[data-rule=expedientes-mios]').catch(() => {});
  record('panel', 'panel offline lista reglas', (await page.locator('[data-test=panel-rules] tbody tr').count()) >= 3);
  const nEntries = await page.locator('[data-test=panel-entries] tbody tr').count();
  record('panel', 'panel muestra los datos guardados', nEntries > 0, `${nEntries} entradas`);

  // Logout: borrar datos de un usuario
  await start(v1);
  await setUser('ana');
  await page.goto(base + '/arq-panel');
  await page.waitForSelector('[data-test=panel-entries]');
  await page.click('button:has-text("(logout)")');
  await sleep(500);
  entries = (await cacheSummary())['arq-api-cache:v1'] ?? [];
  record('usuarios', 'logout borra solo los datos del usuario', !entries.some((u) => u.includes('/ana/')), `${entries.length} entradas restantes`);

  // Reglas en tiempo de ejecución: cambiar el JSON sin recompilar
  const rulesFile = path.join(v1, 'api-cache-rules.json');
  const orig = fs.readFileSync(rulesFile, 'utf8');
  fs.writeFileSync(rulesFile, orig.replace('"strategy": "cache-first",\n      "ttl": "30s"', '"strategy": "network-first",\n      "ttl": "30s"'));
  await page.goto(base + '/arq');
  await page.waitForSelector('[data-test=arq-catalogo]');
  await arqCall('catalogo');
  r = await arqCall('catalogo');
  record('reglas', 'cambio de estrategia en el JSON sin recompilar', r.outcome === 'network', r.outcome);
  fs.writeFileSync(rulesFile, orig);
} else {
  // ============================================================ variante Workbox
  // Al visitar /arq la feature registra sus reglas en código y la página se las envía al SW
  await page.click('a[href="/arq"]');
  await page.waitForSelector('[data-test=arq-expedientes-mios]');
  await sleep(500);
  let r = await swFetch('/api/arq/me/expedientes');
  const first = r.json?.servedAt;
  record('api', 'network-first online (Workbox)', r.status === 200);
  await swFetch('/api/arq/catalog');
  const c2 = await swFetch('/api/arq/catalog');
  await sleep(1100);
  const c3 = await swFetch('/api/arq/catalog');
  record('api', 'cache-first (Workbox)', c2.json?.servedAt === c3.json?.servedAt);
  await admin('fail?on=1');
  r = await swFetch('/api/arq/me/expedientes');
  record('api', 'API 503 => caché (plugin fetchDidSucceed)', r.status === 200 && r.json?.servedAt === first, `status ${r.status}`);
  await admin('fail?on=0');
  await swFetch('/api/arq/private');
  const names = Object.keys(await cacheSummary());
  record('api', 'network-only nunca se guarda', !names.includes('arq-privado'));
  record('api', 'una caché por regla', null, names.filter((n) => n.startsWith('arq-')).join(', '));

  await stop();
  await page.goto(base + '/lazy');
  record('offline', 'sin servidor: deep-link a ruta lazy', !!(await page.waitForSelector('[data-test=lazy-ok]', { timeout: 15000 }).catch(() => null)));
  r = await swFetch('/api/arq/me/expedientes');
  record('offline', 'datos de ana offline', r.status === 200 && JSON.stringify(r.json).includes('de ana'));
  r = await swFetch('/api/arq/me/expedientes', 'luis');
  record('usuarios', 'otro usuario offline NO ve los datos de ana', r.status !== 200 || !JSON.stringify(r.json).includes('de ana'), `status ${r.status}`);
  r = await swFetch('/api/arq/private');
  record('offline', 'network-only offline falla', r.status !== 200, `status ${r.status}`);
  await page.goto(base + '/arq-panel');
  await page.waitForSelector('[data-test=panel-caches] tbody tr');
  record('panel', 'el panel muestra las cachés de Workbox', (await page.locator('[data-test=panel-caches]').textContent()).includes('Workbox'));

  // Reglas en tiempo de ejecución: el SW las lee al instalarse / arrancar
  record('reglas', 'reglas de código de una feature lazy aplicadas por el SW (postMessage)', names.includes('arq-expedientes-mios'));
  record('reglas', 'cambios en el JSON', 'LIMIT', 'el SW recompila al arrancar o cuando la página le reenvía las reglas, no en cada petición');

  // Actualización
  await start(v1);
  await page.goto(base + '/');
  await waitControlled();
  await start(v2);
  await page.evaluate(() => globalThis.__wb.check());
  const waiting = await page
    .waitForFunction(() => globalThis.__wb?.waiting(), null, { timeout: 20000 })
    .then(() => true, () => false);
  record('update', 'reg.update() detecta la nueva versión (worker en espera)', waiting);
  await page.evaluate(() => {
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
    globalThis.__wb.activate();
  });
  await page.waitForTimeout(3000);
  await page.waitForSelector('[data-test=build-id]');
  const id = await page.locator('[data-test=build-id]').textContent();
  record('update', 'SKIP_WAITING + reload => v2', id === buildId(v2), id);
  record('update', 'sin equivalente a VERSION_READY ni UNRECOVERABLE_STATE', 'LIMIT', 'eventos y recuperación hay que programarlos (o usar workbox-window)');
}

await browser.close();
await stop();
const passed = results.filter((r) => r.pass === true).length;
const failed = results.filter((r) => r.pass === false).length;
const limits = results.filter((r) => r.pass === 'LIMIT').length;
console.log(`\narq ${app}: ${passed} PASS · ${failed} FAIL · ${limits} LIMIT · ${results.length - passed - failed - limits} INFO`);
fs.mkdirSync(path.join(root, 'e2e/results'), { recursive: true });
fs.writeFileSync(path.join(root, 'e2e/results', `arq-${app}.json`), JSON.stringify({ app, date: new Date().toISOString(), results }, null, 2));
