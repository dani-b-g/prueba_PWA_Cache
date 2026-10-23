import { Component } from '@angular/core';
import { RenderInfoComponent } from '../render-info.component';
import { HEAVY_TABLE } from './lazy-data';

/**
 * Ruta lazy 'lazy' (chunk propio). Con installMode "prefetch" en el grupo "app"
 * el chunk se descarga al instalar el SW, por lo que esta ruta funciona offline
 * aunque nunca se haya visitado. La imagen está en el grupo "assets" (lazy):
 * solo funciona offline si se ha cargado antes con red.
 */
@Component({
  selector: 'app-lazy-page',
  imports: [RenderInfoComponent],
  template: `
    <app-render-info route="/lazy" />
    <h2>Módulo lazy</h2>
    <p data-test="lazy-ok">Chunk lazy cargado correctamente ({{ rows.length }} filas embebidas en el chunk).</p>
    <img src="/img/lazy-asset.svg" width="160" height="160" alt="asset lazy" />
    <p><small>La imagen pertenece al assetGroup "assets" con installMode lazy.</small></p>
  `,
})
export class LazyPage {
  readonly rows = HEAVY_TABLE;
}
