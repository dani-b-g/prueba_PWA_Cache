# Evaluación de `@angular/service-worker` en Angular 19 y Angular 21

> Fecha: 2026-10-05 · Laboratorio: `prueba_PWA_Cache/` (ver [README](./README.md))
> Versiones probadas: `@angular/service-worker` **19.2.25** (CLI 19.2.27) y **21.2.25** (CLI 21.2.25) ·
> Node 24.14 · Chrome estable (Playwright) · Windows 11

## 1. Conclusión

**Viable, con alcance acotado.** `@angular/service-worker` (NGSW) resuelve bien y sin
código propio el *app shell offline*, el precache de chunks (incluidas las rutas lazy), la
caché de peticiones GET y el ciclo de actualización de versiones. Se comporta **igual en
Angular 19 y 21**: 31 comprobaciones superadas, 0 fallos y 5 limitaciones confirmadas en
cada versión.

**No es apto** como base de una estrategia *offline-first* completa: no encola
mutaciones, no recurre a la caché ante errores 5xx, anula el SSR/prerender para los
usuarios que vuelven, y la documentación oficial lo declara **en modo solo
mantenimiento** («no se aceptarán nuevas funcionalidades salvo correcciones de seguridad»).

| Caso de uso | ¿NGSW sirve? |
|---|---|
| Arrancar la app sin red (shell + chunks + estilos) | ✅ Sí |
| Rutas lazy offline aunque no se hayan visitado | ✅ Sí (con `installMode: prefetch`) |
| Caché de lecturas GET (catálogos, datos de referencia) | ✅ Sí (`dataGroups`) |
| Avisar de una versión nueva y actualizar de forma controlada | ✅ Sí (`SwUpdate`) |
| Config en tiempo de ejecución que se cambia sin recompilar | ✅ Sí, si va en un `dataGroup` *freshness* |
| Usar la caché cuando el backend responde 502/503/504 | ❌ No |
| Guardar formularios offline y enviarlos al volver la red | ❌ No (sin cola ni Background Sync) |
| Mantener SSR/prerender en las visitas siguientes | ❌ No (el SW sirve `index.csr.html`) |
| Reglas por cabecera, por usuario o con lógica propia | ❌ No (solo patrones de URL) |
| Funcionalidades nuevas en el futuro | ❌ No (modo mantenimiento) |

**Recomendación:** úsalo en aplicaciones cuyo requisito offline sea «la app abre y muestra
los últimos datos consultados». Para requisitos mayores (envío diferido, reglas a medida,
fallback ante 5xx), o si se quiere evitar una dependencia sin evolución, conviene un SW
propio sobre las APIs nativas o una librería mantenida (sección 8). Los usos de NGSW deben
pasar por una **fachada propia** para poder sustituirlo más adelante.

---

## 2. Estado de mantenimiento y soporte

### 2.1 Estado oficial del paquete

La página oficial (<https://angular.dev/ecosystem/service-workers>) abre con este aviso:

> «The Angular Service Worker is a basic caching utility for simple offline support with a
> limited featureset. We will not be accepting any new features other than security fixes.
> For more advanced caching and offline capabilities, we recommend exploring native browser
> APIs directly.»

En el repositorio (`packages/service-worker`) hay actividad, pero solo de mantenimiento:

| Fecha | Commit |
|---|---|
| 2026-09-29 | docs: *note that registerWhenStable requires a timeout* |
| 2026-09-24 | docs: *clarify maintenance mode note* |
| 2026-06-24 | fix: *preserve referrer / referrer policy in asset requests* |
| 2026-06-08 | fix: *strips sensitive headers on cross-origin redirects* (seguridad) |
| 2026-05-27 | fix: *preserves HTTP cache mode / `credentials: omit` in asset requests* |
| 2026-03-18 | fix: *preserve redirect policy on reconstructed asset requests* |
| 2025-11-11 | **Revert** de *feat: notify clients about version failures* |
| 2025-08-06 | feat: opción `type` en `provideServiceWorker` (última funcionalidad nueva) |

### 2.2 Soporte de las versiones de Angular (angular.dev/reference/releases)

| Versión | Estado a 2026-10-05 | Fin de LTS |
|---|---|---|
| **19** | ❌ **Sin soporte** (v2–v19 fuera de soporte) | finalizado |
| 20 | LTS | 2026-11-28 |
| **21** | LTS (solo correcciones críticas y de seguridad) | **2027-06** |
| 22 (actual: 22.2.1) | Activa | 2028-06 |

Desde la v22 sale una versión mayor cada 12 meses (antes cada 6).
**Angular 19 ya no recibe parches de seguridad**, tampoco del service worker.

### 2.3 Diferencias de API entre 19 y 21 (comparando los `.d.ts`)

| Elemento | 19.2 | 21.2 |
|---|---|---|
| `ngsw-config.json` (schema) | — | **idéntico** |
| `SwRegistrationOptions.updateViaCache` | ✗ | ✓ (usado en `ng21-sw`) |
| `SwRegistrationOptions.type` (`'classic'`/`'module'`) | ✗ | ✓ |
| `SwPush.notificationCloses`, `SwPush.pushSubscriptionChanges` | ✗ | ✓ |
| `SwUpdate` (`versionUpdates`, `unrecoverable`, `checkForUpdate`, `activateUpdate`) | ✓ | ✓ sin cambios |
| `ngsw-worker.js` | 71 KB | 85 KB (correcciones de seguridad, `messageerror`, rechazos no gestionados) |

Migrar de 19 a 21 no exige cambios en la configuración ni en el código que usa `SwUpdate`.

---

## 3. Qué se ha probado

Hay dos apps generadas con `ng new --ssr` y `ng add @angular/pwa`, que comparten el mismo
código de laboratorio (`shared/lab`):

- **Rutas:** `/` eager y prerenderizada; `/api`, `/cache` y `/config` lazy y solo cliente;
  `/lazy` lazy y prerenderizada; `/ssr` lazy con `RenderMode.Server`.
- **`ngsw-config.json`:** grupo `app` (prefetch), grupo `assets` (lazy) y tres `dataGroups`:
  `api-freshness` (timeout 2 s), `api-performance` (maxAge 1 min) y `runtime-config`
  (`/config.json`, freshness).
- **API simulada y simulador de averías:** API devolviendo 503, servidor entero devolviendo
  503, y servidor parado (error de red real).
- **Batería E2E** (`e2e/sw-e2e.mjs`): compila dos versiones (v1 y v2), despliega v1, recorre
  todos los casos, «despliega» v2 en el mismo origen y por último arranca el servidor SSR.

### Resultados (iguales en las dos versiones)

`PASS` = funciona como se espera · `LIMIT` = comportamiento confirmado que supone una
limitación · `INFO` = dato observado.

| Área | Comprobación | 19 | 21 |
|---|---|---|---|
| Registro | `SwUpdate.isEnabled` y SW controlando la página (≈0,3–0,7 s tras la carga) | PASS | PASS |
| Registro | `index` del manifiesto generado | `/index.csr.html` | `/index.csr.html` |
| Recursos | Grupo `app` precacheado completo | 15/15 | 14/14 |
| Lazy | Los 8 chunks lazy se precachean al instalar | PASS | PASS |
| Recursos | Un asset con `installMode: lazy` no se cachea hasta que se usa | PASS | PASS |
| APIs | *freshness* con red: siempre va al servidor | PASS | PASS |
| APIs | *performance*: la segunda llamada sale de caché (2–4 ms) | PASS | PASS |
| APIs | *freshness* sin copia previa: espera a la red aunque supere el timeout | PASS | PASS |
| APIs | *freshness* con respuesta lenta: devuelve la caché a los 2 s y la actualiza en segundo plano | PASS | PASS |
| APIs | **API devuelve 503 con copia en caché → la app recibe el 503** | LIMIT | LIMIT |
| APIs | La cabecera `ngsw-bypass` salta el SW | PASS | PASS |
| Config | Cambiar `config.json` en el servidor, sin recompilar, se ve al recargar | PASS | PASS |
| Offline | Recarga sin servidor: la app arranca | PASS | PASS |
| Offline | Deep-link a una ruta lazy, y a una ruta lazy nunca visitada | PASS | PASS |
| Offline | **Asset lazy nunca cargado: no disponible** | LIMIT | LIMIT |
| Offline | Config runtime y APIs de `dataGroups`: se sirve la última copia | PASS | PASS |
| Offline | API fuera de `dataGroups`, POST y peticiones con `ngsw-bypass` fallan (504 / error de red) | PASS | PASS |
| Offline | Servidor devolviendo 503 en todo: la shell carga desde caché | PASS | PASS |
| Offline | **Servidor devolviendo 503: las APIs devuelven el 503, no la caché** | LIMIT | LIMIT |
| Updates | `VERSION_DETECTED` y `VERSION_READY` tras `checkForUpdate()`; la pestaña sigue en v1 | PASS | PASS |
| Updates | Pestaña nueva abierta tras `VERSION_READY` | v2 (2 de 2 ejecuciones) | v1 o v2 según la ejecución |
| Updates | `activateUpdate()` + `reload()` pasa a v2 | PASS | PASS |
| Updates | **Chunk borrado de Cache Storage: se recupera de la caché HTTP del navegador** | LIMIT | LIMIT |
| Updates | Chunk perdido en todas partes: `UNRECOVERABLE_STATE` y aviso en la UI | PASS | PASS |
| SSR | La primera visita a `/ssr` se renderiza en servidor | PASS | PASS |
| SSR | **Con el SW activo, recargar `/ssr` no llega al servidor (CSR)** | LIMIT | LIMIT |
| Prerender | Con el SW activo, `/lazy` prerenderizada se sirve como CSR | INFO | INFO |
| SSR | Sin errores de hidratación | PASS | PASS |

Las salidas completas están en `e2e/results/ng19-sw.log|json` y `ng21-sw.log|json`.

---

## 4. Capacidades evaluadas

### 4.1 Registro
- `provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy })`.
  Por defecto usa `registerWhenStable:30000`: registra cuando la app está estable o, como
  mucho, a los 30 s. **En apps zoneless, o con *polling* o websockets, la app puede no
  estabilizarse nunca**, así que el timeout es imprescindible (Angular lo documentó en
  septiembre de 2026).
- Solo funciona en HTTPS o `localhost`, y **nunca con `ng serve`**: hay que probar sobre el
  build de producción, lo que ralentiza el ciclo de desarrollo.
- `SwUpdate.isEnabled` vale `false` en el servidor y en navegadores sin soporte. El código
  tiene que funcionar también sin SW.

### 4.2 Caché de recursos (`assetGroups`)
- Cachea por hash SHA-1 publicado en `ngsw.json`. `prefetch` descarga todo al instalar y
  `lazy` lo descarga cuando se usa.
- La actualización es atómica: o se instala la versión entera o no se instala.
- **Riesgo:** si un fichero del `assetGroup` se modifica en el servidor después del build
  (inyectar variables en `index.html` o `main.js` al desplegar, CDN que reescribe…), el hash
  no coincide. El worker lanza `SwCriticalError` y pasa a estado degradado
  (`EXISTING_CLIENTS_ONLY`). Si se hace eso, hay que regenerar `ngsw.json` con
  `npx ngsw-config`.

### 4.3 Caché de APIs (`dataGroups`)
- Hay dos estrategias: `performance` (caché primero, con `maxAge`) y `freshness` (red
  primero, con `timeout` opcional), además de `maxSize` con desalojo LRU y
  `cacheQueryOptions`.
- Comportamientos confirmados que hay que tener en cuenta:
  - **Solo vuelve a la caché ante un error de red o un timeout.** Un 5xx del servidor o de un
    proxy se entrega tal cual (código: `handleFetchWithFreshness`).
  - **La caché se indexa por URL completa**, query incluida: `?ms=100` y `?ms=4000` son
    entradas distintas. Las APIs paginadas o con filtros generan muchas entradas.
  - Sin copia previa, `freshness` espera a la red aunque supere el timeout.
  - `maxAge` limita también la disponibilidad offline: una copia caducada no se sirve.
  - **No consulta `Cache-Control`** (`no-store`, `private`): lo que cuadra con el patrón
    de URL se cachea, aunque sea un dato sensible.
  - **No distingue usuarios**: la caché vive en el navegador y sobrevive al logout. Al
    cerrar sesión hay que borrar las cachés `ngsw:*:data:*` a mano.
  - Los métodos distintos de GET y HEAD nunca se cachean, y no existe cola de reintentos.

### 4.4 Funcionamiento offline
- Con el servidor parado funcionan la shell, la navegación a cualquier ruta (incluidas las
  lazy no visitadas), la config runtime y las APIs de `dataGroups`.
- No funcionan los assets lazy no visitados, las APIs fuera de `dataGroups` y cualquier POST.
- Si el servidor está vivo pero devuelve 503 (un balanceador sin backend, por ejemplo), la
  shell carga pero **las APIs fallan**. Este es el escenario offline más habitual en una
  intranet.

### 4.5 Gestión de actualizaciones
- `checkForUpdate()` emite `VERSION_DETECTED` y luego `VERSION_READY`;
  `activateUpdate()` seguido de `reload()` aplica la nueva versión. Las pestañas abiertas
  siguen en la versión antigua hasta que se activa.
- En 21, una pestaña nueva abierta justo después de `VERSION_READY` recibió unas veces v1 y
  otras v2: **no es determinista** (en 19 recibió v2 las dos veces que se probó).
- `UNRECOVERABLE_STATE` solo aparece si un fichero de la versión activa ya no está en Cache
  Storage, ni en la caché HTTP, ni en el servidor (404). El SW no salta la caché HTTP salvo
  que el hash no coincida, y eso lo hace bastante resistente. Aun así, **hay que mantener
  publicados los ficheros con hash de al menos la versión anterior**.
- Hay que servir `ngsw.json`, `ngsw-worker.js` e `index*.html` con `Cache-Control: no-cache`.
  En v20+ conviene `updateViaCache: 'none'`.
- Existe un *kill switch*: `safety-worker.js`, que viene en el build, se publica como
  `ngsw-worker.js` para desinstalar el SW.

---

## 5. Compatibilidad

| Aspecto | Resultado |
|---|---|
| **Routing** | ✅ Las navegaciones (`navigationUrls`) se responden con el `index`. Deep-links offline OK. Las rutas de servidor (`/api/**`, `/admin/**`) se excluyen a mano en `navigationUrls`. |
| **Lazy loading** | ✅ Los chunks entran en el patrón `/*.js` del grupo `app` y se precachean. Si el grupo fuera `lazy`, las rutas no visitadas no funcionarían offline. |
| **SSR** | ⚠️ El CLI cambia automáticamente el `index` a `/index.csr.html`. **Una vez instalado el SW, las navegaciones no llegan al servidor SSR**: solo la primera visita y los bots (SEO) reciben SSR. Para recuperar el SSR habría que usar `navigationRequestStrategy: "freshness"` (no probado: pierde la ventaja de arrancar desde caché). En v21, si `security.allowedHosts` no incluye el host, el SSR cae a CSR con un error en consola. |
| **Prerender** | ⚠️ Pasa lo mismo: el HTML prerenderizado (`/lazy/index.html`) no se cachea ni se usa tras la primera visita. Sin errores de hidratación, porque el `index.csr.html` no hidrata. El HTML prerenderizado ha de ser válido (un `<table>` sin `<tbody>` rompió la hidratación durante las pruebas; es un problema del SSR, no del SW). |
| **Config en tiempo de ejecución** | ✅ `config.json` en un `dataGroup` *freshness* cargado con `provideAppInitializer`: se cambia en caliente y offline usa la última copia. ❌ No debe ir en un `assetGroup`: quedaría congelado o rompería el hash. |
| **Zone / zoneless** | ✅ Mismo comportamiento con zone.js (19) y zoneless (21). |

---

## 6. Limitaciones (resumen)

1. Modo solo mantenimiento: no habrá funcionalidades nuevas.
2. No vuelve a la caché ante 5xx; solo ante error de red o timeout.
3. Sin cola offline ni Background Sync para POST/PUT/DELETE.
4. Las reglas son solo patrones de URL: no se puede filtrar por cabecera, usuario ni contenido, y se ignora `Cache-Control`.
5. No se puede ampliar con lógica propia en el fetch: el `ngsw-worker.js` es cerrado. Se puede importar desde un worker propio, pero sin integrarse en su pipeline.
6. Anula el SSR y el prerender en las visitas siguientes.
7. No funciona con `ng serve`: se prueba siempre sobre el build de producción.
8. Las cachés de datos no distinguen usuarios y persisten tras el logout.
9. Es frágil ante cualquier modificación de ficheros después del build.
10. Las pestañas nuevas durante una actualización pueden recibir una versión u otra.

## 7. Riesgos de mantenimiento y dependencia tecnológica

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Sin evolución funcional (modo mantenimiento) | Alta (confirmado) | Medio | Limitar su uso a lo que ya cubre; fachada propia (como `SwLabService`) en lugar de usar `SwUpdate` por toda la app. |
| Retirada o *deprecación* futura del paquete | Media | Alto | Mantener el `ngsw-config.json` simple y documentado para poder migrarlo; tener ensayado el `safety-worker.js`. |
| Seguir en Angular 19 (sin soporte) | Alta si no se migra | Alto | Migrar al menos a 21 (LTS hasta 2027-06) o a 22. Config y API compatibles. |
| Acoplamiento al build del CLI (`ngsw.json` lo genera el builder) | Media | Medio | No modificar ficheros tras el build, o regenerar con `ngsw-config`. |
| Datos sensibles persistidos en el navegador | Media | Alto | Excluir de `dataGroups` las APIs con datos personales; borrar las cachés al hacer logout. |
| Versiones viejas atascadas en clientes | Baja | Alto | Cabeceras `no-cache` en `ngsw*`, `updateViaCache: 'none'`, conservar los ficheros de la versión anterior y gestionar `unrecoverable`. |
| Interferencia con SSR o SEO | Media | Medio | Aceptar CSR para usuarios recurrentes o evaluar `navigationRequestStrategy: freshness`. |

## 8. Alternativas a considerar (no probadas en este laboratorio)

- **Service worker propio** sobre las APIs nativas (Cache Storage, `fetch`, Background
  Sync): es la opción que recomienda Angular. Da control total a cambio de mantener código y
  pruebas propias.
- **Workbox** (Google) o **Serwist** (fork de Workbox con desarrollo activo): estrategias,
  *precache manifest*, Background Sync y *routing* por función. No dependen de Angular, pero
  hay que integrarlos en el build (generar el manifiesto de precache sobre `dist/browser`).
  Conviene verificar su estado de mantenimiento antes de elegir.

## 9. Configuración recomendada si se adopta NGSW

```jsonc
// ngsw-config.json (resumen; ver shared/ngsw-config.json)
{
  "index": "/index.html",               // el CLI lo cambia a /index.csr.html con SSR
  "navigationUrls": ["/**", "!/**/*.*", "!/**/*__*", "!/**/*__*/**", "!/api/**"],
  "assetGroups": [{ "name": "app", "installMode": "prefetch", ... }],   // chunks lazy incluidos
  "dataGroups": [
    { "name": "config",   "urls": ["/config.json"],   "cacheConfig": { "strategy": "freshness", "timeout": "3s", "maxAge": "7d", "maxSize": 1 } },
    { "name": "catalogo", "urls": ["/api/catalog/**"], "cacheConfig": { "strategy": "performance", "maxAge": "1h", "maxSize": 50 } }
  ]
}
```

- `provideServiceWorker(..., { registrationStrategy: 'registerWhenStable:30000', updateViaCache: 'none' })` (este último en v20+).
- Servidor: `no-cache` para `ngsw.json`, `ngsw-worker.js`, `index*.html` y `config.json`; `immutable` para los ficheros con hash.
- Mantener los ficheros con hash de la versión anterior durante al menos un despliegue.
- Gestionar `versionUpdates` (aviso de nueva versión) y `unrecoverable` (forzar recarga) en un único servicio.
- Borrar las cachés `ngsw:*:data:*` al cerrar sesión.
