# prueba_PWA_Cache · laboratorio de `@angular/service-worker`

Laboratorio para evaluar `@angular/service-worker` (NGSW) y otras alternativas de caché
de assets y APIs en **Angular 19.2, 21.2 y 22.2**. Conclusiones:

- [`INFORME.md`](./INFORME.md): capacidades y limitaciones de NGSW (19 vs 21)
- [`INFORME-continuidad-y-alternativas.md`](./INFORME-continuidad-y-alternativas.md):
  continuidad en 21+, arquitectura de caché declarativa (`arq-offline`) y comparativa de opciones
- [`docs/README.md`](./docs/README.md): **índice** de hallazgos, limitaciones, decisiones,
  pruebas y fuentes
- [`docs/plan-opcion-B-ngsw-assets-arq-offline.md`](./docs/plan-opcion-B-ngsw-assets-arq-offline.md):
  **plan de implantación** de NGSW (assets) + `arq-offline` (APIs)

```
prueba_PWA_Cache/
├─ shared/                 Código COMÚN a todas las apps (fuente única)
│  ├─ lab/                 Componentes, servicios, rutas de prueba
│  ├─ arq-offline/         ★ Pieza de arquitectura: reglas declarativas de caché de APIs,
│  │                         interceptor, almacén, panel e indicador de frescura
│  ├─ workbox/sw.ts        SW propio con Workbox que aplica las mismas reglas
│  ├─ ngsw-config.json     Configuración de NGSW (assetGroups + dataGroups)
│  ├─ public/              config.json, api-cache-rules.json (reglas runtime), asset lazy
│  └─ styles.css
├─ ng19-sw/                Angular 19.2 + NGSW (zone.js)
├─ ng21-sw/                Angular 21.2 + NGSW (zoneless)
├─ ng22-sw/                Angular 22.2 + NGSW (requiere Node ≥ 24.15)
├─ ng21-wb/                Angular 21.2 + SW Workbox (sin NGSW)
├─ server/
│  ├─ mock-api.mjs         API simulada + simulador de caídas (/admin/*)
│  └─ static-server.mjs    Servidor estático sin dependencias (CSR + prerender)
├─ scripts/
│  ├─ sync-shared.mjs      Copia shared/ a cada app y genera un build-id nuevo
│  ├─ build-workbox-sw.mjs Post-build de ng21-wb: esbuild + workbox injectManifest
│  └─ rules-to-ngsw.mjs    Traduce las reglas declarativas a dataGroups de NGSW
└─ e2e/
   ├─ sw-e2e.mjs           Batería de NGSW (Playwright + Chrome/Edge local)
   └─ arq-e2e.mjs          Batería de la arquitectura de caché (interceptor y Workbox)
```

Ambas apps se generaron con `ng new --ssr` + `ng add @angular/pwa` y solo se ha tocado lo
mínimo: `app.config.ts`, rutas, `server.ts` (monta la API simulada) y `angular.json`
(`allowedHosts`). El código de `src/app/lab` **no se edita en las apps**: se copia desde
`shared/` en cada `npm run build` (script `prebuild`).

## Requisitos

- Node 20.19+/22.12+/24 (probado con Node 24.14; Angular 19 no declara soporte oficial para Node 24, pero compila y funciona)
- Chrome o Edge instalado (para la batería E2E)

```bash
npm install                 # raíz: playwright-core
npm --prefix ng19-sw install
npm --prefix ng21-sw install
npm --prefix ng22-sw install
npm --prefix ng21-wb install   # incluye workbox-* como devDependencies
```

## Uso manual

El SW **no funciona con `ng serve`** (`isDevMode()` lo desactiva). Hay que compilar en
producción y servir el resultado:

```bash
npm run build:21            # o build:19
npm run serve:21            # http://localhost:8021  (servidor estático, CSR + prerender)
npm run serve:ssr:21        # http://localhost:4021  (servidor Node SSR de Angular)
```

| Puerto | App | Servidor |
|---|---|---|
| 8019 / 8021 | Angular 19 / 21 | estático (`server/static-server.mjs`) |
| 4019 / 4021 | Angular 19 / 21 | SSR (`dist/<app>/server/server.mjs`) |

Pantallas de la app:

| Ruta | Render | Qué prueba |
|---|---|---|
| `/` | prerender | Registro, `SwUpdate`, `checkForUpdate`, `activateUpdate`, log de eventos |
| `/api` | lazy · CSR | Estrategias `freshness`/`performance`, timeout, `ngsw-bypass`, POST, simulación de 503 y caída |
| `/cache` | lazy · CSR | Contenido real de Cache Storage y página de depuración `/ngsw/state` |
| `/lazy` | lazy · prerender | Chunk lazy + asset con `installMode: lazy` |
| `/ssr` | lazy · SSR | Si el HTML viene del servidor SSR o del SW |
| `/config` | lazy · CSR | `config.json` leído en `provideAppInitializer` |
| `/arq` | lazy · CSR | Feature de ejemplo que declara sus reglas en la ruta; cambio de usuario, simulación de 503, indicador de frescura |
| `/arq-panel` | lazy · CSR | Panel: cachés del navegador, reglas registradas, datos guardados, últimas peticiones, logout |

| Puerto | App |
|---|---|
| 8022 / 4022 | Angular 22 (estático / SSR) |
| 8121 / 4121 | Angular 21 + Workbox (estático / SSR) |

Para probar una actualización: con `serve:21` arrancado, ejecuta otra vez `npm run build:21`
y pulsa **checkForUpdate()** en `/`.

Para simular el modo offline: DevTools ▸ Application ▸ Service Workers ▸ *Offline*, parar el
servidor, o los botones de `/api` (`/admin/fail?on=1` = API 503, `/admin/down?on=1` = todo 503).

## Batería automatizada

```bash
npm run e2e:19              # compila v1 y v2, ejecuta ~40 comprobaciones
npm run e2e:21
node e2e/sw-e2e.mjs ng21-sw --skip-build --headed   # reutiliza builds y muestra el navegador
```

```bash
npm run e2e:22              # Angular 22 (con Node >= 24.15 en el PATH)
node e2e/arq-e2e.mjs ng21-sw   # arquitectura de caché: interceptor + NGSW (también ng22-sw)
node e2e/arq-e2e.mjs ng21-wb   # arquitectura de caché: SW Workbox
```

Cada comprobación sale como `PASS`, `FAIL`, `LIMIT` (comportamiento confirmado que es una
limitación del SW) o `INFO` (dato observado). Resultados en `e2e/results/<app>.json` y `.log`.
