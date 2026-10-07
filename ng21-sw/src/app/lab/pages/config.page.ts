import { Component, inject } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { RuntimeConfigService } from '../runtime-config';
import { RenderInfoComponent } from '../render-info.component';

/** Ruta lazy 'config' : configuración en tiempo de ejecución. */
@Component({
  selector: 'app-config-page',
  imports: [JsonPipe, RenderInfoComponent],
  template: `
    <app-render-info route="/config" />
    <h2>Configuración en tiempo de ejecución</h2>
    <p>Origen: <b data-test="config-source">{{ cfg.source() }}</b> (cargada a las {{ cfg.loadedAt() }})</p>
    <pre data-test="config">{{ cfg.config() | json }}</pre>
    <p>
      Edita <code>dist/&lt;app&gt;/browser/config.json</code> (sube <code>revision</code>) SIN recompilar y recarga:
      el valor nuevo se ve porque <code>/config.json</code> está en un dataGroup <em>freshness</em>.
      Offline se usa la última copia cacheada.
    </p>
  `,
})
export class ConfigPage {
  readonly cfg = inject(RuntimeConfigService);
}
