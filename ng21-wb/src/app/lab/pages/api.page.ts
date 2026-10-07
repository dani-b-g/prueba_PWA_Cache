import { Component, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { RenderInfoComponent } from '../render-info.component';

interface ApiResult {
  label: string;
  status: string;
  ms: number;
  ageMs?: number;
  verdict: string;
  body: string;
}

interface ApiCase {
  label: string;
  method: 'GET' | 'POST';
  url: string;
  bypass?: boolean;
  note: string;
}

/** Ruta lazy 'api' : estrategias de caché de dataGroups. */
@Component({
  selector: 'app-api-page',
  imports: [RenderInfoComponent],
  template: `
    <app-render-info route="/api" />
    <h2>Caché de APIs (dataGroups)</h2>
    <p>
      Una respuesta con <em>edad</em> &gt; 1 s significa que NO viene del servidor en ese momento
      (la ha servido el SW desde caché). Usa los botones de simulación o DevTools &gt; Network &gt; Offline.
    </p>

    <div class="actions">
      <button (click)="admin('fail', true)">Simular API 503</button>
      <button (click)="admin('down', true)">Simular servidor caído</button>
      <button (click)="admin('fail', false); admin('down', false)">Restaurar servidor</button>
      <span>{{ adminState() }}</span>
    </div>

    <table class="grid">
      <thead><tr><th>Caso</th><th>Estrategia esperada</th><th></th></tr></thead>
      <tbody>
        @for (c of cases; track c.label) {
          <tr>
            <td><code>{{ c.method }} {{ c.url }}</code>@if (c.bypass) { <small> + ngsw-bypass</small> }</td>
            <td>{{ c.note }}</td>
            <td><button (click)="run(c)" [attr.data-test]="'run-' + $index">Ejecutar</button></td>
          </tr>
        }
      </tbody>
    </table>

    <h3>Resultados</h3>
    <table class="grid" data-test="results">
      <thead><tr><th>Caso</th><th>Estado</th><th>ms</th><th>Edad</th><th>Origen probable</th><th>Cuerpo</th></tr></thead>
      <tbody>
        @for (r of results(); track $index) {
          <tr>
            <td>{{ r.label }}</td><td>{{ r.status }}</td><td>{{ r.ms }}</td>
            <td>{{ r.ageMs ?? '-' }}</td><td>{{ r.verdict }}</td><td><code>{{ r.body }}</code></td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class ApiPage {
  private readonly http = inject(HttpClient);
  readonly results = signal<ApiResult[]>([]);
  readonly adminState = signal('');

  readonly cases: ApiCase[] = [
    { label: 'time', method: 'GET', url: '/api/time', note: 'freshness: red primero, caché si falla o tarda > 2 s' },
    { label: 'slow', method: 'GET', url: '/api/slow?ms=4000', note: 'freshness + timeout 2 s: devuelve caché si existe y luego actualiza' },
    { label: 'catalog', method: 'GET', url: '/api/catalog', note: 'performance: caché primero (maxAge 1 min)' },
    { label: 'private', method: 'GET', url: '/api/private', note: 'no está en dataGroups: siempre red, falla offline' },
    { label: 'time-bypass', method: 'GET', url: '/api/time', bypass: true, note: 'cabecera ngsw-bypass: el SW no intercepta' },
    { label: 'echo', method: 'POST', url: '/api/echo', note: 'las mutaciones nunca se cachean' },
  ];

  async run(c: ApiCase) {
    const t0 = performance.now();
    const headers = c.bypass ? new HttpHeaders({ 'ngsw-bypass': 'true' }) : undefined;
    try {
      const body: any = await firstValueFrom(
        c.method === 'GET'
          ? this.http.get(c.url, { headers })
          : this.http.post(c.url, { hello: 'world', at: Date.now() }, { headers }),
      );
      const ms = Math.round(performance.now() - t0);
      const ageMs = body?.servedAt ? Date.now() - Date.parse(body.servedAt) - ms : undefined;
      const fromCache = ageMs !== undefined && ageMs > 1000;
      this.add({
        label: c.label,
        status: '200',
        ms,
        ageMs,
        verdict: fromCache ? 'CACHÉ del SW' : 'red',
        body: JSON.stringify(body).slice(0, 120),
      });
    } catch (e: any) {
      this.add({
        label: c.label,
        status: String(e?.status ?? 'error'),
        ms: Math.round(performance.now() - t0),
        verdict: e?.status === 504 ? 'SW sin red y sin caché (504)' : 'error',
        body: String(e?.message ?? e).slice(0, 120),
      });
    }
  }

  async admin(kind: 'fail' | 'down', on: boolean) {
    try {
      const s = await firstValueFrom(this.http.get(`/admin/${kind}?on=${on ? 1 : 0}`));
      this.adminState.set(JSON.stringify(s));
    } catch (e) {
      this.adminState.set(String(e));
    }
  }

  private add(r: ApiResult) {
    this.results.update((l) => [r, ...l]);
  }
}
