# Índice de la investigación · caché y offline en Angular

> Última actualización: 2026-10-07 · Cubre las dos fases de la investigación y el plan de
> implantación. Los identificadores (H-, L-, D-, F-, P-) son estables: úsalos para citar
> desde issues, PR o actas.

## 1. Documentos

| Documento | Para qué sirve | Fase |
|---|---|---|
| [`../INFORME.md`](../INFORME.md) | Capacidades, limitaciones y estado de `@angular/service-worker` en Angular 19 y 21 | 1 |
| [`../INFORME-continuidad-y-alternativas.md`](../INFORME-continuidad-y-alternativas.md) | Continuidad en Angular 21+, arquitectura `arq-offline` y comparativa de alternativas | 2 |
| [`plan-opcion-B-ngsw-assets-arq-offline.md`](./plan-opcion-B-ngsw-assets-arq-offline.md) | **Plan de implantación** de la opción B: NGSW para assets + `arq-offline` para APIs | 3 |
| [`../README.md`](../README.md) | Cómo arrancar el laboratorio y lanzar las baterías | — |
| `../e2e/results/*.log` y `*.json` | Salida de cada ejecución de las baterías (evidencia) | 1–2 |

## 2. Trazabilidad con los criterios de aceptación

| Criterio | Dónde está la evidencia |
|---|---|
| Revisadas capacidades, limitaciones y estado de mantenimiento | INFORME §2, §4, §6 · continuidad §2 · H-01…H-06, L-01…L-12 |
| Pruebas mínimas en ambas versiones (y en 22) | `ng19-sw/`, `ng21-sw/`, `ng22-sw/` · `e2e/sw-e2e.mjs` · P-01…P-03 |
| Registro, caché de recursos, caché de APIs, offline y actualizaciones | INFORME §3–§4 · P-01…P-03 |
| Routing, lazy loading, SSR, prerender y config en tiempo de ejecución | INFORME §5 · H-07…H-11 |
| Riesgos de mantenimiento y dependencia | INFORME §7 · continuidad §2 y §6 · H-01…H-06 |
| Continuidad en 21+ | continuidad §1–§2 · H-01…H-06 |
| Caché de assets y APIs declarable por los equipos y visualizable | continuidad §3–§4 · `shared/arq-offline/` · P-04, P-05 · D-02…D-04 |
| Otras opciones, PWA o no | continuidad §5 · P-06 |

## 3. Hallazgos (H)

| ID | Tema | Hallazgo | Evidencia | Doc |
|---|---|---|---|---|
| H-01 | Mantenimiento | NGSW en **modo solo mantenimiento** desde 2025-08: sin funcionalidades nuevas salvo correcciones de seguridad | F-01, F-02 | continuidad §2 |
| H-02 | Mantenimiento | En 2026 solo correcciones (seguridad en redirecciones, referrer, credentials, TS 6). Última funcionalidad: opción `type` (2025-08); se revirtió *notify clients about version failures* (2025-11) | F-02 | continuidad §2 |
| H-03 | Continuidad | 21 → 22: API `.d.ts`, `schema.json` y comportamiento **idénticos** | P-03, comparación de `node_modules` | continuidad §2, §4.1 |
| H-04 | Continuidad | No hay anuncio de deprecación ni nada en el roadmap. Si se depreca, la política mantiene ≥ 1 versión mayor (≥ 12 meses) | F-03, F-04 | continuidad §1 |
| H-05 | Soporte | 19 sin soporte · 21 LTS hasta 2027-06 · 22 hasta 2028-06 · una versión mayor al año desde la v22 | F-04 | INFORME §2.2 |
| H-06 | Entorno | Angular 22 exige Node `^22.22.3 \|\| ^24.15.0 \|\| >=26`; con 24.14 `ng build` falla | prueba real | continuidad §2 |
| H-07 | SSR | Con SSR el CLI cambia el `index` del SW a `/index.csr.html` | P-01…P-03 | INFORME §5 |
| H-08 | SSR / prerender | Una vez instalado el SW, las navegaciones ya no llegan al SSR ni usan el HTML prerenderizado (CSR) | P-01…P-03 | INFORME §5 |
| H-09 | SSR | En 21+, si el host no está en `security.allowedHosts`, el SSR cae a CSR con error | prueba real | INFORME §5 |
| H-10 | Lazy | Los chunks lazy se precachean (grupo `app`, `/*.js`): las rutas no visitadas funcionan offline | P-01…P-03 | INFORME §5 |
| H-11 | Config runtime | `config.json` en un `dataGroup` freshness se puede cambiar sin recompilar; en un `assetGroup` rompería el hash | P-01…P-03 | INFORME §4.2, §5 |
| H-12 | Offline | **Con NGSW, la falta de red llega a la app como un `504` que fabrica el SW**, no como status 0 | P-04 | continuidad §4.3 |
| H-13 | Actualizaciones | `UNRECOVERABLE_STATE` es muy raro: el SW recupera los chunks de la caché HTTP del navegador | P-01…P-03 | INFORME §4.5 |
| H-14 | Actualizaciones | Una pestaña nueva abierta durante la actualización puede recibir la versión antigua o la nueva (observado en 21) | P-02 | INFORME §4.5 |
| H-15 | arq-offline | Las reglas declaradas en una ruta lazy solo existen tras activar la ruta: el panel no las ve antes | P-04, P-05 | continuidad §4.3 |
| H-16 | Workbox | El SW no ejecuta el código de las features: hay que enviarle las reglas por `postMessage` y **fusionarlas por id** | P-06 | continuidad §4.3 |
| H-17 | Workbox | `workbox-build@7.4.1` depende de `glob@11` (obsoleto). La propiedad pasó al equipo Aurora de Chrome | F-06 | continuidad §4.3 |
| H-18 | Build | Angular 22 genera nombres de chunk con mayúsculas y minúsculas: los patrones de hash deben aceptar las dos | prueba real | continuidad §4.3 |
| H-19 | Hidratación | HTML inválido (`<table>` sin `<tbody>`) rompe la hidratación de páginas prerenderizadas. Es del SSR, no del SW | prueba real | INFORME §5 |

## 4. Limitaciones de NGSW (L)

| ID | Limitación | ¿La cubre arq-offline? |
|---|---|---|
| L-01 | No usa la caché ante 5xx; solo ante error de red o timeout | ✅ `fallbackOn5xx` |
| L-02 | Sin cola offline ni Background Sync para POST/PUT/DELETE | ❌ (fuera de alcance; cola propia futura) |
| L-03 | Reglas solo por patrón de URL; ignora `Cache-Control` | ✅ reglas con `network-only`, validación |
| L-04 | No separa por usuario; los datos sobreviven al logout | ✅ `perUser` + borrado por usuario |
| L-05 | Configuración solo en build (`ngsw.json`) | ✅ JSON en tiempo de ejecución |
| L-06 | No se puede ampliar con lógica propia en el fetch | ✅ (la lógica vive en la página) |
| L-07 | Anula SSR y prerender en las visitas siguientes | ❌ (propio de servir la shell desde caché) |
| L-08 | No funciona con `ng serve` | ⚠️ arq-offline sí funciona en `ng serve`; NGSW no |
| L-09 | Frágil si se modifica cualquier fichero después del build | ❌ (procedimiento de despliegue) |
| L-10 | La caché se indexa por URL completa (query incluida) | ✅ `ignoreSearch`, `maxEntries` |
| L-11 | Assets `installMode: lazy` no disponibles offline si no se han usado | ❌ (diseño del grupo de assets) |
| L-12 | Sin panel ni métricas (solo `/ngsw/state`) | ✅ `<arq-cache-panel>` + `<arq-data-freshness>` |

## 5. Decisiones (D)

| ID | Decisión | Motivo | Estado |
|---|---|---|---|
| D-01 | NGSW se usa **solo para assets** (`assetGroups`, sin `dataGroups`) | Funciona y es estable en 19/21/22 (P-01…P-03); minimiza la dependencia de un paquete congelado (H-01) | Propuesta |
| D-02 | Las APIs se cachean con **`arq-offline`** (motor en la página) | Cubre L-01, L-03, L-04, L-05 y L-12; no depende de NGSW | Propuesta |
| D-03 | Contrato único `ApiCacheRule`, declarable en código (global o por feature) y en JSON | Los equipos deciden qué guardar; operaciones ajusta sin recompilar | Propuesta |
| D-04 | Workbox (o Serwist) como **contingencia** si NGSW se depreca | El contrato funciona igual con Workbox (P-06) | Propuesta |
| D-05 | Versión mínima **Angular 21** (19 sin soporte) | H-05 | Propuesta |
| D-06 | 504 tratado como «sin conexión» | H-12 | Implementada en el prototipo |

## 6. Pruebas y resultados (P)

| ID | Batería | App | Resultado | Fichero |
|---|---|---|---|---|
| P-01 | `e2e/sw-e2e.mjs` (NGSW) | Angular 19.2 | 31 PASS · 0 FAIL · 5 LIMIT · 4 INFO | `e2e/results/ng19-sw.*` |
| P-02 | `e2e/sw-e2e.mjs` (NGSW) | Angular 21.2 | 31 · 0 · 5 · 4 | `e2e/results/ng21-sw.*` |
| P-03 | `e2e/sw-e2e.mjs` (NGSW) | Angular 22.2 | 31 · 0 · 5 · 4 | `e2e/results/ng22-sw.*` |
| P-04 | `e2e/arq-e2e.mjs` (interceptor + NGSW) | Angular 21.2 | 18 PASS · 0 FAIL · 1 LIMIT · 1 INFO | `e2e/results/arq-ng21-sw.*` |
| P-05 | `e2e/arq-e2e.mjs` (interceptor + NGSW) | Angular 22.2 | 18 · 0 · 1 · 1 | `e2e/results/arq-ng22-sw.*` |
| P-06 | `e2e/arq-e2e.mjs` (SW Workbox) | Angular 21.2 | 14 PASS · 0 FAIL · 2 LIMIT · 2 INFO | `e2e/results/arq-ng21-wb.*` |
| P-07 | `scripts/rules-to-ngsw.mjs` | — | Genera `dataGroups` y lista lo que se pierde | continuidad §5.2 |

Navegador: Chrome estable (Playwright, Windows 11). **No se ha probado** en Firefox, Safari
ni iOS (ver el plan, fase 5).

## 7. Fuentes externas (F)

| ID | Fuente | Qué aporta | Consultada |
|---|---|---|---|
| F-01 | https://angular.dev/ecosystem/service-workers | Aviso de modo mantenimiento | 2026-10-05 |
| F-02 | https://github.com/angular/angular/commits/main/packages/service-worker | Historial de commits de NGSW | 2026-10-05 |
| F-03 | https://angular.dev/roadmap | Sin menciones a SW, PWA u offline | 2026-10-07 |
| F-04 | https://angular.dev/reference/releases | Soporte por versión y política de deprecación | 2026-10-05 / 07 |
| F-05 | https://github.com/angular/angular-cli/commits/main/packages/angular/pwa | Actividad del esquema `ng add @angular/pwa` | 2026-10-07 |
| F-06 | https://github.com/GoogleChrome/workbox (README y releases) | Cambio de propietario y v7.4.1 | 2026-10-07 |
| F-07 | https://caniuse.com/background-sync | Background Sync solo en Chromium | 2026-10-07 |
| F-08 | https://tanstack.com/query/latest/docs/framework/angular/overview | Adaptador de Angular aún experimental | 2026-10-07 |
| F-09 | npm registry (`npm view`) | Versiones y fechas de workbox, serwist, tanstack, dexie, idb-keyval, localforage, ngrx-toolkit | 2026-10-07 |

**Sin verificar:** licencia y empaquetado de Serwist; persistencia IndexedDB de
ngrx-toolkit.

## 8. Mapa del código

| Pieza | Ruta | Notas |
|---|---|---|
| Librería de arquitectura (prototipo) | `shared/arq-offline/` | Modelo, registro, interceptor, almacén, panel, indicador, envío de reglas al SW |
| Reglas en tiempo de ejecución | `shared/public/api-cache-rules.json` | Sobrescriben por `id` |
| Ejemplo de feature que declara reglas | `shared/lab/lab.routes.ts` (ruta `arq`) | `provideApiCacheRules('expedientes', …)` |
| Integración en la app | `shared/lab/lab.providers.ts` | Interceptor + `provideArqOffline` + `API_CACHE_USER` |
| Configuración de NGSW | `shared/ngsw-config.json` | En la opción B se queda solo con `assetGroups` |
| SW alternativo Workbox | `shared/workbox/sw.ts` + `scripts/build-workbox-sw.mjs` | App `ng21-wb/` |
| Traductor de reglas a NGSW | `scripts/rules-to-ngsw.mjs` | — |
| API simulada | `server/mock-api.mjs` | `/api/arq/*`, `/admin/fail`, `/admin/down` |

> El código de `shared/` se copia a cada app en `npm run build` (`scripts/sync-shared.mjs`).
> No se edita dentro de `ng*/src/app/lab` ni `ng*/src/app/arq-offline`.

## 9. Glosario

- **NGSW**: `@angular/service-worker` (`ngsw-worker.js` + `ngsw.json`).
- **assetGroup / dataGroup**: grupos de recursos estáticos / de peticiones de API en `ngsw-config.json`.
- **arq-offline**: pieza de arquitectura de este laboratorio para caché declarativa de APIs.
- **Regla (`ApiCacheRule`)**: declaración de qué URL se guarda, con qué estrategia y durante cuánto tiempo.
- **Respaldo (fallback)**: servir la copia guardada cuando falla la red o el servidor.
- **LIMIT**: resultado de batería que confirma un comportamiento limitante (no es un fallo del test).
