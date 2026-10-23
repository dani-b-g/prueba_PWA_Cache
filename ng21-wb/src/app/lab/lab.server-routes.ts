import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Mezcla deliberada de modos de render para evaluar su convivencia con el SW:
 *  - ''  y 'lazy' : prerender en build (HTML estático en dist/browser)
 *  - 'ssr'        : SSR por petición (solo con el servidor Node)
 *  - resto        : solo cliente (sirve index.csr.html)
 */
export const labServerRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'lazy', renderMode: RenderMode.Prerender },
  { path: 'ssr', renderMode: RenderMode.Server },
  { path: '**', renderMode: RenderMode.Client },
];
