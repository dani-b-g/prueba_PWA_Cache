import { Component } from '@angular/core';
import { RenderInfoComponent } from '../render-info.component';

/**
 * Ruta 'ssr' con RenderMode.Server. Con el servidor Node (npm run serve:ssr)
 * cada petición genera HTML nuevo; con el servidor estático no existe HTML
 * para esta ruta y cae al index.csr.html (CSR).
 *
 * Con el SW activo, las navegaciones NO llegan al servidor SSR: el SW responde
 * con el "index" configurado en ngsw-config.json (navigationRequestStrategy
 * "performance"), así que el SSR solo se ejecuta en la primera visita.
 */
@Component({
  selector: 'app-ssr-page',
  imports: [RenderInfoComponent],
  template: `
    <app-render-info route="/ssr" />
    <h2>SSR vs Service Worker</h2>
    <p>Recarga esta página (F5) con el SW activo y comprueba si el HTML viene del servidor o no.</p>
    <ul>
      <li>Sin SW o primera visita: «HTML generado en servidor para /ssr».</li>
      <li>Con SW controlando: el SW devuelve el index cacheado.</li>
    </ul>
  `,
})
export class SsrPage {}
