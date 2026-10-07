import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import {
  HttpContextToken,
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { Observable, filter, firstValueFrom, from } from 'rxjs';
import { ApiCacheEvent, ApiCacheRule, CacheMeta, CacheOutcome, toMs } from './api-cache.model';
import { API_CACHE_USER, ApiCacheRegistry } from './api-cache.registry';
import { ApiCacheStore, StoredEntry } from './api-cache.store';

/** Desactiva la caché para una petición concreta: http.get(url, { context: skipApiCache() }) */
export const SKIP_API_CACHE = new HttpContextToken<boolean>(() => false);

/**
 * Permite desactivar el motor en la página (p. ej. cuando las reglas las aplica un
 * service worker Workbox) sin quitar el interceptor ni el panel.
 */
export const ARQ_API_CACHE_ENABLED = new InjectionToken<boolean>('ARQ_API_CACHE_ENABLED', {
  providedIn: 'root',
  factory: () => true,
});

/** Cabecera que se añade a la respuesta para que el componente sepa de dónde vienen los datos. */
export const CACHE_META_HEADER = 'X-Arq-Cache';

export function cacheMetaOf(res: HttpResponse<unknown>): CacheMeta | null {
  const raw = res.headers.get(CACHE_META_HEADER);
  return raw ? (JSON.parse(raw) as CacheMeta) : null;
}

interface RuleStats {
  network: number;
  hit: number;
  fallback: number;
  miss: number;
}

/**
 * Motor de caché de APIs en la página (sin service worker).
 * Aplica las reglas del ApiCacheRegistry a todas las peticiones de HttpClient.
 */
@Injectable({ providedIn: 'root' })
export class ApiCacheEngine {
  private readonly registry = inject(ApiCacheRegistry);
  private readonly store = inject(ApiCacheStore);
  private readonly currentUser = inject(API_CACHE_USER);
  readonly enabled = inject(ARQ_API_CACHE_ENABLED);

  readonly events = signal<ApiCacheEvent[]>([]);
  /** Último resultado por URL: alimenta los indicadores de frescura de los componentes. */
  readonly lastByUrl = signal<Record<string, ApiCacheEvent>>({});
  readonly stats = signal<Record<string, RuleStats>>({});
  readonly totals = computed(() => {
    const t = { network: 0, hit: 0, fallback: 0, miss: 0 };
    for (const s of Object.values(this.stats())) {
      t.network += s.network;
      t.hit += s.hit;
      t.fallback += s.fallback;
      t.miss += s.miss;
    }
    return t;
  });

  handle(req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> {
    // En SSR/prerender (o sin Cache Storage) la petición pasa tal cual
    if (!this.enabled || !this.store.available || req.context.get(SKIP_API_CACHE)) return next(req);
    const target = this.targetOf(req.urlWithParams);
    const rule = this.registry.find(req.method, target);
    if (!rule || rule.strategy === 'network-only') {
      // Sin regla: no se toca la petición (ni siquiera se convierte a promesa)
      return next(req);
    }
    if (req.responseType !== 'json' && req.responseType !== 'text') return next(req);
    return from(this.run(req, next, rule, target));
  }

  private async run(req: HttpRequest<unknown>, next: HttpHandlerFn, rule: ApiCacheRule, target: string): Promise<HttpResponse<unknown>> {
    const t0 = performance.now();
    const user = rule.perUser === false ? '*' : this.currentUser();
    const ttl = toMs(rule.ttl, 864e5);
    const ignoreSearch = rule.ignoreSearch ?? false;
    const found = await this.store.get(user, rule.id, target, ignoreSearch);
    const age = found ? Date.now() - Date.parse(found.storedAt) : Infinity;
    const fresh = age < ttl;
    // Copia utilizable como respaldo si falla la red (aunque haya caducado su ttl)
    const cached = age < toMs(rule.maxStale, 30 * 864e5) ? found : null;

    const network = () => firstValueFrom(next(req).pipe(filter((e): e is HttpResponse<unknown> => e instanceof HttpResponse)));
    const save = async (res: HttpResponse<unknown>) => {
      if (res.ok) await this.store.put(user, rule.id, target, res.status, res.body, rule.maxEntries ?? 50, ignoreSearch);
      return res;
    };
    const done = (res: HttpResponse<unknown>, outcome: CacheOutcome, entry?: StoredEntry | null) =>
      this.finish(req, rule, res, outcome, entry ?? undefined, t0);
    const fromCache = (entry: StoredEntry, outcome: CacheOutcome) =>
      done(new HttpResponse({ body: entry.body, status: entry.status, url: req.urlWithParams }), outcome, entry);

    if ((rule.strategy === 'cache-first' && fresh) || (rule.strategy === 'stale-while-revalidate' && cached)) {
      if (rule.strategy === 'stale-while-revalidate') network().then(save).catch(() => {});
      return fromCache(cached!, 'cache-hit');
    }

    // network-first, o cache-first/swr sin copia válida
    const timeoutMs = rule.strategy === 'network-first' && rule.timeout !== undefined ? toMs(rule.timeout, 0) : 0;
    const call = network().then(save);
    try {
      const res = timeoutMs && cached ? await this.withTimeout(call, timeoutMs) : await call;
      return done(res, 'network');
    } catch (err) {
      const outcome = this.fallbackOutcome(err, rule);
      if (outcome && cached) {
        if (outcome === 'fallback-timeout') call.catch(() => {}); // la respuesta tardía actualiza la caché
        return fromCache(cached, outcome);
      }
      this.track(req, rule, 'miss-error', err instanceof HttpErrorResponse ? err.status : 'error', t0);
      throw err;
    }
  }

  private fallbackOutcome(err: unknown, rule: ApiCacheRule): CacheOutcome | null {
    if (err === TIMEOUT) return 'fallback-timeout';
    if (err instanceof HttpErrorResponse) {
      // 0 = error de red. 504 = lo que devuelve @angular/service-worker (o un proxy) cuando no llega al servidor
      if (err.status === 0 || err.status === 504) return 'fallback-offline';
      if (err.status >= 500 && rule.fallbackOn5xx !== false) return 'fallback-5xx';
    }
    return null;
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(TIMEOUT), ms))]);
  }

  private finish(req: HttpRequest<unknown>, rule: ApiCacheRule, res: HttpResponse<unknown>, outcome: CacheOutcome, entry: StoredEntry | undefined, t0: number) {
    const meta: CacheMeta = {
      outcome,
      ruleId: rule.id,
      storedAt: entry?.storedAt ?? new Date().toISOString(),
      ageMs: entry ? Date.now() - Date.parse(entry.storedAt) : 0,
    };
    this.track(req, rule, outcome, res.status, t0, meta);
    return res.clone({ headers: res.headers.set(CACHE_META_HEADER, JSON.stringify(meta)) });
  }

  private track(req: HttpRequest<unknown>, rule: ApiCacheRule, outcome: CacheOutcome, status: number | string, t0: number, meta?: CacheMeta) {
    const ev: ApiCacheEvent = {
      at: new Date().toISOString(),
      method: req.method,
      url: req.urlWithParams,
      status,
      ms: Math.round(performance.now() - t0),
      ruleId: rule.id,
      ...meta,
      outcome,
    };
    this.events.update((l) => [ev, ...l].slice(0, 200));
    this.lastByUrl.update((m) => ({ ...m, [req.urlWithParams]: ev }));
    const key = outcome === 'network' ? 'network' : outcome === 'cache-hit' ? 'hit' : outcome === 'miss-error' ? 'miss' : 'fallback';
    this.stats.update((s) => {
      const cur = s[rule.id] ?? { network: 0, hit: 0, fallback: 0, miss: 0 };
      return { ...s, [rule.id]: { ...cur, [key]: cur[key] + 1 } };
    });
  }

  private targetOf(url: string) {
    const u = new URL(url, location.origin);
    return u.origin === location.origin ? u.pathname + u.search : u.href;
  }
}

const TIMEOUT = Symbol('timeout');

export const apiCacheInterceptor: HttpInterceptorFn = (req, next) => inject(ApiCacheEngine).handle(req, next);
