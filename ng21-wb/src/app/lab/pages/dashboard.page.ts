import { Component, VERSION, inject } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { SwLabService } from '../sw-lab.service';
import { RenderInfoComponent } from '../render-info.component';
import { BUILD_INFO } from '../build-info';

/** Ruta eager '' : registro del SW y gestión de actualizaciones. */
@Component({
  selector: 'app-dashboard-page',
  imports: [JsonPipe, RenderInfoComponent],
  template: `
    <app-render-info route="/" />
    <h2>Registro y actualizaciones</h2>

    <table class="kv"><tbody>
      <tr><th>Angular</th><td>{{ ngVersion }}</td></tr>
      <tr><th>Build</th><td data-test="build-id">{{ build.id }}</td></tr>
      <tr><th>SwUpdate.isEnabled</th><td data-test="sw-enabled">{{ sw.enabled }}</td></tr>
      <tr><th>Online (navigator.onLine)</th><td>{{ sw.online() }}</td></tr>
      <tr><th>Registro</th><td><pre>{{ sw.registration() | json }}</pre></td></tr>
    </tbody></table>

    <div class="actions">
      <button (click)="sw.refreshRegistration()">Refrescar estado</button>
      <button (click)="sw.checkForUpdate()" data-test="check-update">checkForUpdate()</button>
      <button (click)="sw.activateAndReload()" [disabled]="!sw.updateReady()">activateUpdate() + reload</button>
      <button class="danger" (click)="sw.unregisterAndClear()">Desregistrar SW y borrar cachés</button>
    </div>

    <h3>Cómo probar una actualización</h3>
    <ol>
      <li>Con el servidor estático arrancado, ejecuta <code>npm run build</code> en la app (genera un build-id nuevo).</li>
      <li>Pulsa <em>checkForUpdate()</em> (o recarga): aparecen <code>VERSION_DETECTED</code> y <code>VERSION_READY</code>.</li>
      <li>Pulsa <em>activateUpdate() + reload</em>: el build-id cambia.</li>
    </ol>

    <h3>Eventos</h3>
    <ul class="log" data-test="log">
      @for (e of sw.log(); track $index) {
        <li><span class="t">{{ e.at }}</span> <b>{{ e.type }}</b> {{ e.detail }}</li>
      } @empty {
        <li>Sin eventos todavía (registerWhenStable puede tardar hasta 30 s)</li>
      }
    </ul>
  `,
})
export class DashboardPage {
  readonly sw = inject(SwLabService);
  readonly ngVersion = VERSION.full;
  readonly build = BUILD_INFO;
}
