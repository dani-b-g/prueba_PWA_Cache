import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideServiceWorker } from '@angular/service-worker';
import { labProviders } from './lab/lab.providers';
import { ARQ_API_CACHE_ENABLED, provideApiCacheRulesToServiceWorker } from './arq-offline';
import { provideWorkboxServiceWorker } from './workbox-register';

/**
 * Variante Workbox: el SW lo genera scripts/build-workbox-sw.mjs (postbuild) y aplica
 * las reglas de /api-cache-rules.json. El motor de la página (interceptor) se desactiva
 * para no cachear dos veces; el panel sigue mostrando las cachés del navegador.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideClientHydration(withEventReplay()),
    // Solo para que SwUpdate siga siendo inyectable en el dashboard (isEnabled = false)
    provideServiceWorker('ngsw-worker.js', { enabled: false }),
    provideWorkboxServiceWorker(),
    ...labProviders,
    { provide: ARQ_API_CACHE_ENABLED, useValue: false },
    // Las reglas declaradas en código (p. ej. en rutas lazy) también llegan al SW
    provideApiCacheRulesToServiceWorker(),
  ],
};
