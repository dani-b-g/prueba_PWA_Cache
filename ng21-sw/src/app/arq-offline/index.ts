// API pública de la pieza de arquitectura "arq-offline"
import { EnvironmentProviders, inject, makeEnvironmentProviders, provideAppInitializer } from '@angular/core';
import { withInterceptors } from '@angular/common/http';
import { ApiCacheRule } from './api-cache.model';
import { API_CACHE_USER, ApiCacheRegistry } from './api-cache.registry';
import { apiCacheInterceptor } from './api-cache.interceptor';

export * from './api-cache.model';
export { ApiCacheRegistry, provideApiCacheRules, API_CACHE_USER } from './api-cache.registry';
export type { ApiCacheRulesFile } from './api-cache.registry';
export { ApiCacheEngine, ARQ_API_CACHE_ENABLED, SKIP_API_CACHE, cacheMetaOf, apiCacheInterceptor } from './api-cache.interceptor';
export { ApiCacheStore, ARQ_CACHE_NAME } from './api-cache.store';
export { provideApiCacheRulesToServiceWorker } from './sw-rules-sync';
export { CachePanelComponent } from './cache-panel.component';
export { DataFreshnessComponent } from './data-freshness.component';

export interface ArqOfflineOptions {
  /** Fichero JSON de reglas en tiempo de ejecución (opcional). */
  rulesUrl?: string;
  /** Reglas globales de la arquitectura. */
  rules?: ApiCacheRule[];
  /** Función que devuelve el usuario actual (separa la caché por usuario). */
  user?: () => string;
}

/**
 * Uso en app.config.ts:
 *   provideHttpClient(withFetch(), withArqApiCache()),
 *   provideArqOffline({ rulesUrl: '/api-cache-rules.json', user: () => auth.userId() }),
 */
export function provideArqOffline(opts: ArqOfflineOptions = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    opts.user ? { provide: API_CACHE_USER, useValue: opts.user } : [],
    provideAppInitializer(async () => {
      const registry = inject(ApiCacheRegistry);
      if (opts.rules) registry.register(opts.rules, 'código:arquitectura');
      if (opts.rulesUrl) await registry.loadFromUrl(opts.rulesUrl);
    }),
  ]);
}

/** Feature de HttpClient que activa el motor de caché. */
export const withArqApiCache = () => withInterceptors([apiCacheInterceptor]);
