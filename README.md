# prueba_PWA_Cache · laboratorio de `@angular/service-worker`

Laboratorio para evaluar `@angular/service-worker` (NGSW) como solución de caché y
funcionamiento offline en **Angular 19.2** y **Angular 21.2**. Las conclusiones están en
[`INFORME.md`](./INFORME.md).

```
prueba_PWA_Cache/
├─ shared/                 Código COMÚN a las dos apps (fuente única)
│  ├─ lab/                 Componentes, servicios, rutas de prueba
│  ├─ ngsw-config.json     Configuración del SW (assetGroups + dataGroups)
│  ├─ public/              config.json (config runtime) + asset lazy
│  └─ styles.css
├─ ng19-sw/                Angular 19.2 (CLI 19, builder application/esbuild, zone.js)
├─ ng21-sw/                Angular 21.2 (CLI 21, zoneless por defecto)
├─ server/
│  ├─ mock-api.mjs         API simulada + simulador de caídas (/admin/*)
│  └─ static-server.mjs    Servidor estático sin dependencias (CSR + prerender)
├─ scripts/sync-shared.mjs Copia shared/ a cada app y genera un build-id nuevo
└─ e2e/sw-e2e.mjs          Batería automatizada (Playwright + Chrome/Edge local)
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

Cada comprobación sale como `PASS`, `FAIL`, `LIMIT` (comportamiento confirmado que es una
limitación del SW) o `INFO` (dato observado). Resultados en `e2e/results/<app>.json` y `.log`.
