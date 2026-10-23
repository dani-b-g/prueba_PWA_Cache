// Traduce las reglas declarativas (api-cache-rules.json) a dataGroups de @angular/service-worker.
// Sirve para usar el MISMO contrato de reglas con NGSW, y para ver qué se pierde en la traducción.
//
// Uso: node scripts/rules-to-ngsw.mjs shared/public/api-cache-rules.json [ngsw-config.json --write]
import fs from 'node:fs';

const [rulesFile, ngswFile, flag] = process.argv.slice(2);
const { rules } = JSON.parse(fs.readFileSync(rulesFile ?? 'shared/public/api-cache-rules.json', 'utf8'));

const dataGroups = [];
const warnings = [];

for (const r of rules) {
  const w = (msg) => warnings.push(`[${r.id}] ${msg}`);
  if (r.match.startsWith('re:')) {
    w('NGSW solo admite globs: regla omitida');
    continue;
  }
  if (r.strategy === 'network-only') {
    w('NGSW no tiene "network-only": basta con no declararla (y, si un patrón más amplio la cubre, no hay forma de excluirla)');
    continue;
  }
  const strategy = r.strategy === 'network-first' ? 'freshness' : 'performance';
  if (r.strategy === 'stale-while-revalidate') w('NGSW no tiene stale-while-revalidate: se usa "performance" (caché primero, sin refresco en segundo plano)');
  if (r.perUser !== false) w('NGSW no separa por usuario: la caché es compartida en el navegador');
  if (r.strategy === 'network-first' && r.fallbackOn5xx !== false) w('NGSW no usa la caché ante 5xx (solo ante error de red o timeout)');
  if (r.strategy === 'network-first' && r.maxStale) w('maxStale se traduce a maxAge (también limita la caché en modo freshness)');

  const maxAge = r.strategy === 'network-first' ? (r.maxStale ?? '30d') : (r.ttl ?? '1d');
  dataGroups.push({
    name: r.id,
    urls: [r.match],
    cacheConfig: {
      strategy,
      maxSize: r.maxEntries ?? 50,
      maxAge: typeof maxAge === 'number' ? `${maxAge}u` : maxAge,
      ...(r.timeout && strategy === 'freshness' ? { timeout: r.timeout } : {}),
    },
    ...(r.ignoreSearch ? { cacheQueryOptions: { ignoreSearch: true } } : {}),
  });
}

console.log(JSON.stringify({ dataGroups }, null, 2));
if (warnings.length) console.error('\nPérdidas en la traducción a NGSW:\n - ' + warnings.join('\n - '));

if (ngswFile && flag === '--write') {
  const cfg = JSON.parse(fs.readFileSync(ngswFile, 'utf8'));
  const names = new Set(dataGroups.map((d) => d.name));
  cfg.dataGroups = [...(cfg.dataGroups ?? []).filter((d) => !names.has(d.name)), ...dataGroups];
  fs.writeFileSync(ngswFile, JSON.stringify(cfg, null, 2) + '\n');
  console.error(`\n${ngswFile} actualizado (${dataGroups.length} dataGroups).`);
}
