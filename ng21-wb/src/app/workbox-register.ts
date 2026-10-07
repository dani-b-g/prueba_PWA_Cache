import { PLATFORM_ID, inject, provideAppInitializer } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { SwLabService } from './lab/sw-lab.service';

/**
 * Registro manual del SW Workbox (/sw.js). Sustituye a provideServiceWorker().
 * Se registra tras el evento load para no competir con la carga inicial.
 * Expone en window.__wb las acciones de actualización para la batería E2E.
 */
export function provideWorkboxServiceWorker() {
  return provideAppInitializer(() => {
    if (!isPlatformBrowser(inject(PLATFORM_ID)) || !('serviceWorker' in navigator)) return;
    const lab = inject(SwLabService);

    const register = async () => {
      const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      lab.push('workbox: registrado', reg.scope);
      const watch = (w: ServiceWorker | null) =>
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) lab.push('workbox: nueva versión en espera');
        });
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      (globalThis as any).__wb = {
        check: () => reg.update(),
        waiting: () => !!reg.waiting,
        activate: () => reg.waiting?.postMessage({ type: 'SKIP_WAITING' }),
      };
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  });
}
