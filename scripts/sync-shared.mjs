// Copia el código común (shared/) a una app y genera un build-id nuevo.
// Se ejecuta automáticamente en "prebuild" de cada app:  node ../scripts/sync-shared.mjs .
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shared = path.resolve(here, '../shared');
const app = path.resolve(process.argv[2] ?? '.');

const copy = (from, to) => fs.cpSync(path.join(shared, from), path.join(app, to), { recursive: true });

fs.rmSync(path.join(app, 'src/app/lab'), { recursive: true, force: true });
copy('lab', 'src/app/lab');
copy('styles.css', 'src/styles.css');
copy('public', 'public');
copy('ngsw-config.json', 'ngsw-config.json');

const id = `${path.basename(app)}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
fs.writeFileSync(
  path.join(app, 'src/app/lab/build-info.ts'),
  `// Generado por scripts/sync-shared.mjs: cambia en cada build => nuevo hash => nueva versión del SW\n` +
    `export const BUILD_INFO = { id: '${id}' };\n`,
);
console.log(`[sync-shared] ${path.basename(app)} <- shared/  (build ${id})`);
