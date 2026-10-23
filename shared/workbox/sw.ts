/// <reference lib="webworker" />
// Service worker propio con Workbox (alternativa a @angular/service-worker).
//  - Assets: precache con el manifiesto que inyecta workbox-build (injectManifest) tras `ng build`.
//  - Navegación: index.csr.html desde precache (app shell).
//  - APIs: las MISMAS reglas declarativas de /api-cache-rules.json que usa arq-offline,
//    leídas en tiempo de ejecución (sin recompilar el SW).
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, NetworkOnly, StaleWhileRevalidate, Strategy } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import type { WorkboxPlugin } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

interface Rule {
  id: string;
  match: string;
  strategy: 'network-first' | 'cache-first' | 'stale-while-revalidate' | 'network-only';
  ttl?: string | number;
  maxStale?: string | number;
  timeout?: string | number;
  maxEntries?: number;
  fallbackOn5xx?: boolean;
  perUser?: boolean;
}

const RULES_URL = '/api-cache-rules.json';
const RULES_CACHE = 'arq-rules';

// ------------------------------------------------------------------ assets
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.csr.html'), {
    denylist: [/^\/api\//, /^\/admin\//, /\/[^/?]+\.[^/]+$/],
  }),
);

// Imágenes y fuentes bajo demanda (equivale al assetGroup "assets" con installMode lazy)
registerRoute(
  ({ request }) => request.destination === 'image' || request.destination === 'font',
  new CacheFirst({ cacheName: 'arq-assets-lazy', plugins: [new ExpirationPlugin({ maxEntries: 100 })] }),
);

// Actualización controlada: la página decide cuándo activar (equivale a SwUpdate.activateUpdate)
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// ------------------------------------------------------------------ reglas de API
const toMs = (v: string | number | undefined, def: number) => {
  if (v === undefined) return def;
  if (typeof v === 'number') return v;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/.exec(v.trim());
  return m ? Number(m[1]) * { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as 'ms'] : def;
};
const globToRegExp = (glob: string) =>
  new RegExp('^' + glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/?]*').replace(/\0/g, '.*') + '$');

/** Red primero, pero un 5xx se trata como fallo de red => se usa la caché. */
const fallbackOn5xx: WorkboxPlugin = {
  fetchDidSucceed: async ({ response }) => {
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
    return response;
  },
};
/** Separa la caché por usuario (cabecera x-user que añade la app). */
const perUserKey: WorkboxPlugin = {
  cacheKeyWillBeUsed: async ({ request }) => {
    const url = new URL(request.url);
    url.searchParams.set('__arq_user', request.headers.get('x-user') ?? 'anon');
    return url.href;
  },
};

let compiled: Promise<Array<{ rule: Rule; re: RegExp; handler: Strategy }>> | null = null;

const PAGE_RULES_KEY = '/__arq-page-rules__';

async function loadRules(): Promise<Rule[]> {
  const cache = await caches.open(RULES_CACHE);
  let json: Rule[] = [];
  try {
    const res = await fetch(RULES_URL, { cache: 'no-cache' });
    if (res.ok) {
      await cache.put(RULES_URL, res.clone());
      json = (await res.json()).rules;
    }
  } catch {
    const cached = await cache.match(RULES_URL); // offline: última copia conocida
    json = cached ? (await cached.json()).rules : [];
  }
  // Reglas que envió la página (código + JSON ya combinados) en una sesión anterior
  const page = await cache.match(PAGE_RULES_KEY);
  const pageRules: Rule[] = page ? await page.json() : [];
  return [...pageRules, ...json.filter((j) => !pageRules.some((p) => p.id === j.id))];
}

// La página envía las reglas registradas (incluidas las declaradas en código por las features).
// Se FUSIONAN por id: una página que aún no ha cargado una feature lazy no borra sus reglas.
let merging = Promise.resolve();
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'ARQ_RULES') return;
  const incoming: Rule[] = e.data.rules;
  merging = merging.then(async () => {
    const cache = await caches.open(RULES_CACHE);
    const prev = await cache.match(PAGE_RULES_KEY);
    const known: Rule[] = prev ? await prev.json() : [];
    const merged = [...incoming, ...known.filter((k) => !incoming.some((i) => i.id === k.id))];
    await cache.put(PAGE_RULES_KEY, new Response(JSON.stringify(merged)));
    compiled = Promise.resolve(compile(merged));
  });
  e.waitUntil(merging);
});

function compile(rules: Rule[]) {
  return rules.map((rule) => {
    const cacheName = `arq-${rule.id}`;
    const plugins: WorkboxPlugin[] = [
      new ExpirationPlugin({ maxEntries: rule.maxEntries ?? 50, maxAgeSeconds: toMs(rule.maxStale, 30 * 864e5) / 1000 }),
    ];
    if (rule.perUser !== false) plugins.push(perUserKey);
    let handler: Strategy;
    switch (rule.strategy) {
      case 'network-first':
        if (rule.fallbackOn5xx !== false) plugins.push(fallbackOn5xx);
        handler = new NetworkFirst({
          cacheName,
          plugins,
          networkTimeoutSeconds: rule.timeout ? toMs(rule.timeout, 0) / 1000 : undefined,
        });
        break;
      case 'cache-first':
        // ttl de cache-first = maxAge de la expiración
        plugins[0] = new ExpirationPlugin({ maxEntries: rule.maxEntries ?? 50, maxAgeSeconds: toMs(rule.ttl, 864e5) / 1000 });
        handler = new CacheFirst({ cacheName, plugins });
        break;
      case 'stale-while-revalidate':
        handler = new StaleWhileRevalidate({ cacheName, plugins });
        break;
      default:
        handler = new NetworkOnly();
    }
    const re = rule.match.startsWith('re:') ? new RegExp(rule.match.slice(3)) : globToRegExp(rule.match);
    return { rule, re, handler };
  });
}

const getRules = () => (compiled ??= loadRules().then(compile));

self.addEventListener('install', (e) => e.waitUntil(getRules()));

// Una sola ruta para /api/**: la regla concreta se resuelve de forma asíncrona
registerRoute(
  ({ url, request }) => url.origin === self.location.origin && url.pathname.startsWith('/api/') && request.method === 'GET',
  async (options) => {
    const { url, request } = options;
    const match = (await getRules()).find((r) => r.re.test(url.pathname));
    if (!match) return fetch(request);
    return match.handler.handle(options as any);
  },
);
