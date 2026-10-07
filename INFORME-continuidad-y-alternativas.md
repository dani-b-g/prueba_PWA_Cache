# Continuidad de las PWA en Angular 21+ y estrategia de caché de assets y APIs

> Fecha: 2026-10-07 · Complementa a [`INFORME.md`](./INFORME.md) · Laboratorio: `prueba_PWA_Cache/`
> Probado en Angular **19.2**, **21.2** y **22.2** con Chrome (Playwright). Variante Workbox
> probada en Angular 21.

## 1. Resumen para decidir

**Continuidad.** `@angular/service-worker` (NGSW) sigue publicándose y funciona igual en
Angular 21 y 22. La API pública, el formato de `ngsw-config.json` y el comportamiento son
idénticos: la batería da 31 PASS · 0 FAIL en 19, 21 y 22. Pero está **congelado**: desde
agosto de 2025 Angular lo declara en modo solo mantenimiento («no se aceptarán nuevas
funcionalidades salvo correcciones de seguridad»). No hay anuncio de deprecación ni nada en
el roadmap, ni para mejorarlo ni para retirarlo.

Si algún día se depreca, la política de Angular lo mantendría como mínimo una versión mayor
más (≥ 12 meses), así que no hay riesgo de que desaparezca de golpe. El riesgo real es que
**no va a crecer**.

Además, **«PWA» no es «Angular»**. Service workers, Cache Storage, el manifiesto e IndexedDB
son estándares del navegador. La capacidad offline no depende de Angular; lo que depende de
Angular es la herramienta que la genera.

**Propuesta de arquitectura (probada):**

| Pieza | Responsable | Solución recomendada | Plan B |
|---|---|---|---|
| **Assets** (shell, JS/CSS, chunks lazy, imágenes) | Arquitectura | `@angular/service-worker` solo con `assetGroups` | SW propio con Workbox (probado) |
| **APIs** (qué llamadas se guardan y cómo) | **Los equipos**, declarando reglas | **`arq-offline`**: contrato de reglas + motor en la página + panel | Las mismas reglas aplicadas por el SW Workbox (probado) o traducidas a `dataGroups` de NGSW |

Así se usa NGSW solo para lo que hace bien y sin riesgo (assets). La lógica de APIs, que es
donde NGSW se queda corto (5xx, usuarios, reglas en tiempo de ejecución, visualización),
queda en **código propio que no depende de NGSW**. Si NGSW se depreca, solo se cambia la
pieza de assets y las reglas de los equipos no se tocan.

---

## 2. Continuidad: datos verificados

| Tema | Dato | Fuente |
|---|---|---|
| Estado de NGSW | «maintenance-only… We will not be accepting any new features other than security fixes. For more advanced caching and offline capabilities, we recommend exploring native browser APIs directly.» | angular.dev/ecosystem/service-workers |
| Origen del aviso | Commit *docs: add important service worker note (#63364)*, 2025-08-25; *clarify maintenance mode note*, 2026-09-24 | github.com/angular/angular (packages/service-worker) |
| Actividad 2026 | Solo correcciones: *strips sensitive headers on cross-origin redirects* (2026-06), *preserve referrer/credentials/cache mode* (2026-05/06), compatibilidad con TS 6 | ídem |
| Última funcionalidad | Opción `type` en `provideServiceWorker` (2025-08). Se **revirtió** *notify clients about version failures* (2025-11) | ídem |
| Roadmap de Angular | No menciona service worker, PWA, offline ni caché | angular.dev/roadmap |
| Esquema `ng add @angular/pwa` | Funciona en CLI 22.2 (probado). Desde mayo de 2025 solo recibe cambios de build y dependencias | github.com/angular/angular-cli (packages/angular/pwa) |
| 21 → 22 | API `.d.ts` idéntica, `schema.json` idéntico, worker con cambios cosméticos (`Object.hasOwn`) | comparación de `node_modules` (este laboratorio) |
| Soporte de versiones | 21 en LTS hasta 2027-06 · 22 activa hasta 2027-06 y en LTS hasta 2028-06 · 19 sin soporte · desde la v22, una versión mayor al año | angular.dev/reference/releases |
| Política de deprecación | Lo deprecado sigue «at least the next major release (period of at least 12 months)» y solo se elimina en una versión mayor | angular.dev/reference/releases |
| Requisitos de Node | CLI 22 exige Node `^22.22.3 \|\| ^24.15.0 \|\| >=26`; con 24.14 `ng build` falla | `engines` de `@angular/service-worker@22.2.1` y prueba real |
| Workbox | v7.4.1 (2026-05-04). En el README, «Maintenance update»: la propiedad pasa del equipo de DevRel de Chrome a «Chrome's Aurora team» | github.com/GoogleChrome/workbox, npm |
| Serwist | Fork de Workbox con desarrollo activo: 9.5.13 (2026-10-04). Licencia y empaquetado no verificados en esta revisión | npm |
| Background Sync (envío diferido) | Solo en Chromium (Chrome y Edge). **No** en Firefox ni Safari, ni de escritorio ni de iOS | caniuse.com/background-sync |

**Lectura:** NGSW es seguro para el ciclo de vida de 21 y 22 (hasta 2028), pero no va a
recibir lo que le falta. Cualquier requisito nuevo (reglas por usuario, 5xx, visualización,
envío diferido) hay que construirlo fuera de NGSW.

---

## 3. Requisito: que los equipos declaren qué APIs se guardan y se pueda visualizar

### 3.1 El contrato: una regla declarativa

```ts
// shared/arq-offline/api-cache.model.ts
interface ApiCacheRule {
  id: string;                       // aparece en el panel y en las métricas
  match: string | RegExp;           // '/api/expedientes/**'
  strategy: 'network-first' | 'cache-first' | 'stale-while-revalidate' | 'network-only';
  ttl?: '30s' | '10m' | '1d' | number;      // validez para servir SIN red (cache-first)
  maxStale?: string | number;       // edad máxima para usarla de RESPALDO sin red / con 5xx (por defecto 30d)
  timeout?: string | number;        // network-first: espera máxima a la red
  maxEntries?: number;              // máx. entradas por regla; se eliminan las guardadas hace más tiempo (por defecto 50)
  perUser?: boolean;                // separar por usuario (por defecto sí)
  fallbackOn5xx?: boolean;          // usar caché ante 500/502/503 (por defecto sí)
  ignoreSearch?: boolean;
  description?: string;
}
```

Las reglas se pueden declarar en **tres sitios**. Gana la primera que encaje, y una regla
`network-only` excluye la URL:

| Dónde | Quién | Ejemplo | Cambia sin recompilar |
|---|---|---|---|
| `provideArqOffline({ rules })` en `app.config.ts` | Arquitectura (reglas globales) | `shared/lab/lab.providers.ts` | No |
| `provideApiCacheRules('feature', [...])` en los `providers` de la ruta | **Cada equipo, en su feature** | `shared/lab/lab.routes.ts` (`/arq`) | No |
| `/api-cache-rules.json` (sobrescribe por `id`) | Operaciones / despliegue | `shared/public/api-cache-rules.json` | **Sí** |

Lo que escribe un equipo:

```ts
{
  path: 'expedientes',
  providers: [
    provideApiCacheRules('expedientes', [
      { id: 'expedientes-mios', match: '/api/me/expedientes', strategy: 'network-first', timeout: '3s', maxStale: '7d' },
      { id: 'busqueda', match: '/api/search', strategy: 'network-first', maxEntries: 3 },
    ]),
  ],
  loadComponent: () => import('./expedientes.page'),
}
```

El componente sigue usando `HttpClient` con normalidad. No sabe nada de la caché.

### 3.2 Visualización

- **Para el usuario final:** `<arq-data-freshness url="/api/me/expedientes" />` muestra
  «Datos actualizados», «Sin conexión · datos guardados hace 5 min (solo lectura)» o
  «Servicio no disponible · datos guardados hace 2 h». Con `observe: 'response'`,
  `cacheMetaOf(res)` da `{ outcome, ruleId, storedAt, ageMs }` para mostrar los datos en
  modo lectura.
- **Para los equipos y para soporte:** `<arq-cache-panel />` (ruta `/arq-panel` del
  laboratorio) tiene cuatro secciones:
  1. **Assets y cachés del navegador:** qué SW controla la página y cuántas entradas hay en
     cada caché (NGSW, Workbox o arq).
  2. **Reglas registradas:** origen (código de qué feature o JSON), estrategia, ttl,
     entradas y contadores red / hit / respaldo / fallo.
  3. **Datos guardados:** por regla, usuario, URL y edad, con vista previa del JSON.
  4. **Últimas peticiones:** cómo se resolvió cada una (`network`, `cache-hit`,
     `fallback-offline`, `fallback-5xx`, `fallback-timeout`, `miss-error`).
  - También tiene botones para **borrar los datos del usuario (logout)** o toda la caché.

### 3.3 Motores que aplican el mismo contrato

| Motor | Cómo | Estado |
|---|---|---|
| **Interceptor en la página** (`apiCacheInterceptor` + Cache Storage `arq-api-cache:v1`) | Sin SW para las APIs. NGSW (o Workbox) sirve los assets y la shell offline | ✅ Probado en 21 y 22; compila en 19 |
| **SW Workbox** (`shared/workbox/sw.ts`) | Lee `/api-cache-rules.json` y además recibe por `postMessage` las reglas de código (`provideApiCacheRulesToServiceWorker`) | ✅ Probado en 21 |
| **`dataGroups` de NGSW** | `node scripts/rules-to-ngsw.mjs reglas.json ngsw-config.json --write` (en build) | ✅ Generador probado. Avisa de lo que se pierde (ver 5.2) |

---

## 4. Resultados de las pruebas

Comandos: `node e2e/sw-e2e.mjs <app>` (service worker de Angular) y
`node e2e/arq-e2e.mjs <app>` (arquitectura de caché).

### 4.1 `@angular/service-worker` en las tres versiones

| | 19.2 | 21.2 | 22.2 |
|---|---|---|---|
| PASS / FAIL / LIMIT / INFO | 31 / 0 / 5 / 4 | 31 / 0 / 5 / 4 | 31 / 0 / 5 / 4 |

Las 5 limitaciones son las mismas en las tres versiones (detalle en `INFORME.md`): 5xx sin
respaldo de caché (dos casos), asset lazy no disponible offline, SSR anulado tras la primera
visita y chunk recuperado de la caché HTTP.

### 4.2 Arquitectura `arq-offline`

| Comprobación | Interceptor 21 | Interceptor 22 | Workbox 21 |
|---|---|---|---|
| SW controla la página; JS/CSS y chunks lazy precacheados (15/15) | ✅ | ✅ | ✅ |
| La regla del JSON sobrescribe a la de código | ✅ | ✅ | — |
| network-first online → red; cache-first → 2ª llamada sin red | ✅ | ✅ | ✅ |
| **API 503 → datos guardados** (NGSW no lo hace) | ✅ | ✅ | ✅ (plugin) |
| `network-only` nunca se guarda | ✅ | ✅ | ✅ |
| `maxEntries=3` con 4 búsquedas → 3 entradas (se elimina la más antigua) | ✅ | ✅ | — |
| **Sin servidor:** shell + datos del usuario + indicador de solo lectura | ✅ | ✅ | ✅ |
| **Otro usuario offline no ve los datos del primero** | ✅ | ✅ | ✅ |
| Panel offline: reglas y datos guardados | ✅ | ✅ | ✅ (cachés) |
| Logout borra solo los datos de ese usuario | ✅ | ✅ | — |
| Cambiar la estrategia en el JSON sin recompilar | ✅ | ✅ | ⚠️ al reiniciar el SW |
| Reglas de código de una feature lazy | ⚠️ visibles al visitar la feature | ⚠️ ídem | ✅ vía `postMessage` |
| Actualización de versión | (NGSW) | (NGSW) | ✅ `reg.update()` + `SKIP_WAITING` |
| **Total** | **18 PASS · 0 FAIL** | **18 PASS · 0 FAIL** | **14 PASS · 0 FAIL** |

### 4.3 Hallazgos técnicos de esta fase

1. **Con NGSW instalado, «sin red» no llega como error de red (status 0) sino como un
   `504 Gateway Timeout` que fabrica el propio SW.** Cualquier lógica que distinga offline
   de error del servidor debe tratar el 504 como «sin conexión». `arq-offline` ya lo hace.
2. Las reglas declaradas en una **ruta lazy** solo existen cuando la ruta se ha activado.
   No afecta a la caché, porque las llamadas de la feature solo ocurren dentro de ella. Sí
   afecta al panel: no muestra esas reglas antes de visitar la feature. Si se quieren ver
   todas desde el inicio, hay que declararlas en `app.config.ts` o en el JSON.
3. Con Workbox, el SW no puede ejecutar el código de las features. Hay que **enviarle las
   reglas** y fusionarlas por `id`; si se reemplazan, una página que no ha cargado la
   feature borra sus reglas (fallo detectado y corregido en las pruebas).
4. Workbox no ofrece de serie el equivalente a `VERSION_READY` o `UNRECOVERABLE_STATE`. Hay
   que programarlo (aquí `reg.update()`, worker en espera y `SKIP_WAITING`), o usar
   `workbox-window`.
5. `workbox-build@7.4.1` arrastra `glob@11`, marcado como obsoleto por vulnerabilidades. Es
   una señal del ritmo de mantenimiento de Workbox.
6. Angular 22 usa nombres de chunk en mayúsculas y minúsculas (`chunk-WroePqm3.js`). Los
   scripts que reconocen ficheros con hash deben aceptar las dos.

---

## 5. Opciones evaluadas

### 5.1 Matriz comparativa

| Opción | Assets offline | APIs offline | Reglas por equipos | En tiempo de ejecución | 5xx → caché | Por usuario | Visualización | Dependencia / mantenimiento | Esfuerzo |
|---|---|---|---|---|---|---|---|---|---|
| **A. Solo NGSW** (`assetGroups` + `dataGroups`) | ✅ | ✅ básico | ⚠️ un `ngsw-config.json` central | ❌ (en build) | ❌ | ❌ | ⚠️ `/ngsw/state` | Angular, **congelado** | Muy bajo |
| **B. NGSW (assets) + `arq-offline`** ⭐ | ✅ | ✅ | ✅ código + JSON | ✅ | ✅ | ✅ | ✅ panel + indicador | NGSW solo para assets; resto propio (~780 líneas TS) | Bajo |
| **C. SW Workbox + reglas** | ✅ | ✅ | ✅ (JSON + `postMessage`) | ⚠️ al reiniciar el SW | ✅ (plugin) | ✅ (cabecera) | ✅ panel (cachés) | Workbox (Chrome Aurora), sin Angular | Medio |
| **D. Serwist** (fork de Workbox) | ✅ | ✅ | igual que C | igual que C | ✅ | ✅ | igual que C | Proyecto comunitario activo | Medio (no probado) |
| **E. SW nativo a mano** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Ninguna (mantenimiento propio) | Alto |
| **F. Sin SW: interceptor + IndexedDB/Cache API** | ❌ la app no arranca sin red | ✅ si la app ya está abierta | ✅ | ✅ | ✅ | ✅ | ✅ | Ninguna | Bajo |
| **G. TanStack Query Angular + persister** | ❌ | ✅ (caché de datos) | ⚠️ por consulta, en código | ❌ | ✅ (reintentos) | ⚠️ manual | ✅ devtools | `@tanstack/angular-query-experimental` 5.104: **experimental**, rupturas en versiones menores | Medio |
| **H. NgRx SignalStore + `withStorageSync`** (ngrx-toolkit 22) | ❌ | ⚠️ estado, no peticiones | ⚠️ por store | ❌ | n/a | manual | devtools | Comunitario, alineado con Angular 22 | Medio |
| **I. Caché HTTP (`Cache-Control`)** | ❌ (no es offline) | ❌ | ❌ (lo decide el backend) | ✅ | ❌ | ✅ (`private`) | ❌ | Estándar | Muy bajo |

Notas:
- **F, G y H no sustituyen al SW para los assets:** sin service worker la aplicación no
  arranca sin red. Sirven para la parte de datos y se combinan con A o C para la shell.
- La opción **B** es en la práctica **F + A**: el motor de datos es independiente y se
  puede llevar a C o E sin tocar las reglas de los equipos.
- Para almacenamiento: **Dexie 4.4** (IndexedDB con consultas) o **idb-keyval 6.3**
  (clave-valor mínimo) tienen mantenimiento activo. **localForage** no publica desde 2022:
  evitarlo.
- **Envío diferido de formularios** (cola offline): no lo resuelve ninguna opción de serie
  en todos los navegadores. Background Sync solo existe en Chromium, así que hay que hacer
  una cola propia en IndexedDB con reintento al recuperar la conexión (evento `online`).
  Queda fuera del alcance probado.

### 5.2 Qué se pierde si las reglas se aplican con NGSW (`scripts/rules-to-ngsw.mjs`)

| Capacidad de la regla | En NGSW |
|---|---|
| `perUser` | ❌ La caché se comparte entre todos los usuarios del navegador |
| `fallbackOn5xx` | ❌ Solo hay respaldo ante error de red o timeout |
| `stale-while-revalidate` | ⚠️ Se convierte en `performance`, sin refresco en segundo plano |
| `network-only` (exclusión) | ❌ No se puede excluir una URL que cubra un patrón más amplio |
| RegExp | ❌ Solo globs |
| Cambiar en tiempo de ejecución | ❌ Hay que recompilar o regenerar `ngsw.json` |
| Panel y métricas | ❌ Solo `/ngsw/state` |

---

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| NGSW deprecado en el futuro | Usarlo **solo para assets** (B). Migrar a Workbox o Serwist (C/D) afecta a una sola pieza, y la prueba C demuestra que el contrato de reglas se mantiene |
| Workbox con poco mantenimiento (cambio de equipo, dependencias obsoletas) | No es la primera opción. Si se elige, valorar Serwist o fijar versiones y auditar dependencias |
| Datos sensibles persistidos en el navegador | `perUser` por defecto, `network-only` para excluir, borrado en logout (`ApiCacheStore.clear({ user })`) y `maxStale` acotado |
| Reglas mal declaradas por los equipos | El registro valida (solo GET/HEAD, duraciones válidas) y muestra los errores en el panel. Conviene una revisión de arquitectura de cada regla nueva |
| Requisitos del entorno al subir de versión (Node ≥ 24.15 en Angular 22) | Actualizar las imágenes de CI y de los puestos antes de migrar |
| Cuota y desalojo del almacenamiento del navegador | `maxEntries` por regla. Valorar `navigator.storage.persist()` en apps instaladas |
| Safari / iOS | No hay Background Sync. Validar en dispositivos reales antes de comprometer requisitos offline en iOS |

## 7. Plan de adopción propuesto

1. **Sacar `arq-offline` como librería de arquitectura**: modelo, registro, interceptor,
   almacén, indicador y panel (hoy en `shared/arq-offline`).
2. En las apps, **NGSW solo con `assetGroups`** (quitar los `dataGroups`), con cabeceras
   `no-cache` para `ngsw*` e `index*.html`.
3. Publicar la **guía para equipos**: el contrato `ApiCacheRule`, dónde declararlo y el
   checklist de datos sensibles.
4. Activar el **panel** en entornos de pruebas y soporte (por ejemplo, detrás de un flag).
5. Revisar cada año el estado de NGSW. Si se depreca, aplicar el plan B (Workbox o Serwist
   con el mismo contrato).

## 8. Cómo reproducirlo

```bash
npm run build:21 && npm run serve:21        # http://localhost:8021/arq y /arq-panel
node e2e/arq-e2e.mjs ng21-sw                # interceptor + NGSW
node e2e/arq-e2e.mjs ng21-wb                # Workbox
node scripts/rules-to-ngsw.mjs shared/public/api-cache-rules.json   # traducción a NGSW
```

Angular 22 necesita Node ≥ 24.15. En este equipo se usó un Node portable
(`npx -p node@24`) sin tocar la instalación del sistema.
