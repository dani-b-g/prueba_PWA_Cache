import { EnvironmentProviders, PLATFORM_ID, effect, inject, makeEnvironmentProviders, provideEnvironmentInitializer } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ApiCacheRegistry } from './api-cache.registry';

/**
 * Envía las reglas registradas en la página (código + JSON) al service worker propio
 * (variante Workbox), para que las reglas declaradas por las features en código
 * también se apliquen en el SW. El SW las persiste para usarlas offline tras reiniciar.
 */
export function provideApiCacheRulesToServiceWorker(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      if (!isPlatformBrowser(inject(PLATFORM_ID)) || !('serviceWorker' in navigator)) return;
      const registry = inject(ApiCacheRegistry);
      const post = () => {
        const rules = registry.rules().map((r) => ({ ...r, match: r.match instanceof RegExp ? `re:${r.match.source}` : r.match }));
        navigator.serviceWorker.controller?.postMessage({ type: 'ARQ_RULES', rules });
      };
      effect(post);
      navigator.serviceWorker.addEventListener('controllerchange', post);
    }),
  ]);
}
