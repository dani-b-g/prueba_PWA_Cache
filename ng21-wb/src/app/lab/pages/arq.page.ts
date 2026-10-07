import { Component, inject, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { HttpClient, HttpContext, HttpResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DataFreshnessComponent, SKIP_API_CACHE, cacheMetaOf, CacheMeta } from '../../arq-offline';
import { DemoUserService } from '../demo-user';
import { RenderInfoComponent } from '../render-info.component';

interface Call {
  label: string;
  url: string;
  rule: string;
}

/**
 * Feature de ejemplo "Expedientes" tal como la escribiría un equipo consumidor:
 * solo llama a HttpClient; qué se cachea lo decide la regla declarada en la ruta
 * (lab.routes.ts -> provideApiCacheRules) o en /api-cache-rules.json.
 */
@Component({
  selector: 'app-arq-page',
  imports: [JsonPipe, DataFreshnessComponent, RenderInfoComponent],
  template: `
    <app-render-info route="/arq" />
    <h2>arq-offline · caché declarativa de APIs</h2>

    <div class="actions">
      Usuario:
      @for (u of ['ana', 'luis']; track u) {
        <button (click)="user.set(u)" [disabled]="user.current() === u" [attr.data-test]="'user-' + u">{{ u }}</button>
      }
      <span>actual: <b data-test="current-user">{{ user.current() }}</b></span>
    </div>
    <div class="actions">
      <button (click)="admin('fail', true)">Simular API 503</button>
      <button (click)="admin('fail', false)">Restaurar API</button>
      <input #q value="madrid" size="10" /> <button (click)="call({ label: 'búsqueda', url: '/api/arq/search?q=' + q.value, rule: 'busqueda' })">Buscar</button>
    </div>

    <table class="grid">
      <thead><tr><th>Llamada</th><th>Regla</th><th></th><th>Estado de los datos</th></tr></thead>
      <tbody>
        @for (c of calls; track c.url) {
          <tr>
            <td><code>GET {{ c.url }}</code></td><td>{{ c.rule }}</td>
            <td><button (click)="call(c)" [attr.data-test]="'arq-' + c.rule">Llamar</button></td>
            <td><arq-data-freshness [url]="c.url" /></td>
          </tr>
        }
      </tbody>
    </table>

    <h3>Respuesta</h3>
    @if (last(); as l) {
      <p data-test="arq-last-outcome" [attr.data-outcome]="l.meta?.outcome">
        {{ l.label }} → <b>{{ l.status }}</b> · {{ l.meta?.outcome ?? 'sin regla' }}
      </p>
      <pre data-test="arq-last-body">{{ l.body | json }}</pre>
    }
    <p><small>Ver el detalle en <a href="/arq-panel">Panel de caché</a>.</small></p>
  `,
})
export class ArqPage {
  private readonly http = inject(HttpClient);
  readonly user = inject(DemoUserService);
  readonly last = signal<{ label: string; status: number | string; meta: CacheMeta | null; body: unknown } | null>(null);

  readonly calls: Call[] = [
    { label: 'mis expedientes', url: '/api/arq/me/expedientes', rule: 'expedientes-mios' },
    { label: 'catálogo', url: '/api/arq/catalog', rule: 'catalogo' },
    { label: 'tiempo', url: '/api/arq/time', rule: 'tiempo' },
    { label: 'privado', url: '/api/arq/private', rule: 'privado' },
  ];

  async call(c: Call, skipCache = false) {
    try {
      const res: HttpResponse<unknown> = await firstValueFrom(
        this.http.get(c.url, { observe: 'response', context: new HttpContext().set(SKIP_API_CACHE, skipCache) }),
      );
      this.last.set({ label: c.label, status: res.status, meta: cacheMetaOf(res), body: res.body });
    } catch (e: any) {
      this.last.set({ label: c.label, status: e?.status ?? 'error', meta: null, body: e?.message });
    }
  }

  async admin(kind: 'fail', on: boolean) {
    await fetch(`/admin/${kind}?on=${on ? 1 : 0}`);
  }
}
