import { Component, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { DatePipe, JsonPipe, isPlatformBrowser } from '@angular/common';
import { ApiCacheRegistry, API_CACHE_USER } from './api-cache.registry';
import { ApiCacheEngine } from './api-cache.interceptor';
import { ApiCacheStore, ARQ_CACHE_NAME, StoredEntry } from './api-cache.store';
import { humanAge } from './data-freshness.component';

interface CacheSummary {
  name: string;
  kind: string;
  entries: number;
}

/**
 * Panel de visualización de la caché (assets + APIs).
 * Pensado para que los equipos comprueben qué reglas están activas, qué se ha
 * guardado y cómo se ha resuelto cada petición.  <arq-cache-panel />
 */
@Component({
  selector: 'arq-cache-panel',
  imports: [JsonPipe, DatePipe],
  template: `
    <div class="actions">
      <button (click)="refresh()" data-test="panel-refresh">Refrescar</button>
      <button (click)="clear({ user: user() })">Borrar datos del usuario «{{ user() }}» (logout)</button>
      <button class="danger" (click)="clear({})">Borrar toda la caché de APIs</button>
      <span>Totales: {{ engine.totals() | json }}</span>
    </div>

    <h3>1 · Assets y cachés del navegador</h3>
    <p>
      Service worker: <b>{{ swInfo() }}</b>
    </p>
    <table class="grid" data-test="panel-caches">
      <thead><tr><th>Caché</th><th>Tipo</th><th>Entradas</th></tr></thead>
      <tbody>
        @for (c of cachesInfo(); track c.name) {
          <tr><td><code>{{ c.name }}</code></td><td>{{ c.kind }}</td><td>{{ c.entries }}</td></tr>
        } @empty {
          <tr><td colspan="3">Sin cachés</td></tr>
        }
      </tbody>
    </table>

    <h3>2 · Reglas de API registradas</h3>
    <p>JSON en tiempo de ejecución: <code>{{ registry.jsonSource() }}</code></p>
    @for (err of registry.errors(); track $index) {
      <p class="err">⚠ {{ err }}</p>
    }
    <table class="grid" data-test="panel-rules">
      <thead>
        <tr>
          <th>id</th><th>patrón</th><th>estrategia</th><th>ttl / maxStale / timeout</th>
          <th>por usuario</th><th>5xx→caché</th><th>origen</th><th>entradas</th><th>red / hit / respaldo / fallo</th>
        </tr>
      </thead>
      <tbody>
        @for (r of registry.rules(); track r.id) {
          @let s = engine.stats()[r.id];
          <tr [attr.data-rule]="r.id">
            <td><b>{{ r.id }}</b><br /><small>{{ r.description }}</small></td>
            <td><code>{{ r.match.toString() }}</code></td>
            <td>{{ r.strategy }}</td>
            <td>{{ r.ttl ?? '1d' }} / {{ r.maxStale ?? '30d' }} / {{ r.timeout ?? '-' }}</td>
            <td>{{ r.perUser === false ? 'no' : 'sí' }}</td>
            <td>{{ r.fallbackOn5xx === false ? 'no' : 'sí' }}</td>
            <td><small>{{ r.source }}</small></td>
            <td>{{ countByRule()[r.id] ?? 0 }}</td>
            <td>{{ s?.network ?? 0 }} / {{ s?.hit ?? 0 }} / {{ s?.fallback ?? 0 }} / {{ s?.miss ?? 0 }}</td>
          </tr>
        }
      </tbody>
    </table>

    <h3>3 · Datos guardados ({{ entries().length }})</h3>
    <table class="grid" data-test="panel-entries">
      <thead><tr><th>regla</th><th>usuario</th><th>URL</th><th>guardado</th><th>edad</th><th>bytes</th><th></th></tr></thead>
      <tbody>
        @for (e of entries(); track e.key) {
          <tr>
            <td>{{ e.ruleId }}</td><td>{{ e.user }}</td><td><code>{{ e.url }}</code></td>
            <td>{{ e.storedAt | date: 'HH:mm:ss' }}</td><td>{{ age(e) }}</td><td>{{ e.bytes }}</td>
            <td><button (click)="preview.set(preview() === e.key ? null : e.key)">ver</button></td>
          </tr>
          @if (preview() === e.key) {
            <tr><td colspan="7"><pre>{{ e.body | json }}</pre></td></tr>
          }
        }
      </tbody>
    </table>

    <h3>4 · Últimas peticiones</h3>
    <table class="grid" data-test="panel-events">
      <thead><tr><th>hora</th><th>petición</th><th>regla</th><th>resultado</th><th>estado</th><th>ms</th><th>edad datos</th></tr></thead>
      <tbody>
        @for (ev of engine.events(); track $index) {
          <tr [class]="'o-' + ev.outcome">
            <td>{{ ev.at | date: 'HH:mm:ss' }}</td><td><code>{{ ev.method }} {{ ev.url }}</code></td>
            <td>{{ ev.ruleId }}</td><td><b>{{ ev.outcome }}</b></td><td>{{ ev.status }}</td><td>{{ ev.ms }}</td>
            <td>{{ ev.ageMs ? humanAge(ev.ageMs) : '-' }}</td>
          </tr>
        }
      </tbody>
    </table>
  `,
  styles: `
    .err { color: #c0392b; }
    tr.o-fallback-offline td, tr.o-fallback-5xx td, tr.o-fallback-timeout td { background: #fff8e6; }
    tr.o-cache-hit td { background: #eef4ff; }
    tr.o-miss-error td { background: #fdecea; }
  `,
})
export class CachePanelComponent implements OnInit {
  readonly registry = inject(ApiCacheRegistry);
  readonly engine = inject(ApiCacheEngine);
  private readonly store = inject(ApiCacheStore);
  private readonly currentUser = inject(API_CACHE_USER);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly entries = signal<StoredEntry[]>([]);
  readonly cachesInfo = signal<CacheSummary[]>([]);
  readonly swInfo = signal('—');
  readonly preview = signal<string | null>(null);
  readonly user = signal('anon');
  readonly countByRule = computed(() => {
    const out: Record<string, number | undefined> = {};
    for (const e of this.entries()) out[e.ruleId] = (out[e.ruleId] ?? 0) + 1;
    return out;
  });
  readonly humanAge = humanAge;

  ngOnInit() {
    if (this.isBrowser) this.refresh();
  }

  age(e: StoredEntry) {
    return humanAge(Date.now() - Date.parse(e.storedAt));
  }

  async refresh() {
    if (!this.isBrowser) return;
    this.user.set(this.currentUser());
    this.entries.set(await this.store.list());
    const ctrl = navigator.serviceWorker?.controller;
    this.swInfo.set(ctrl ? `activo (${new URL(ctrl.scriptURL).pathname})` : 'no controla esta página');
    const out: CacheSummary[] = [];
    if (typeof caches !== 'undefined') {
      for (const name of await caches.keys()) {
        out.push({ name, kind: classify(name), entries: (await (await caches.open(name)).keys()).length });
      }
    }
    this.cachesInfo.set(out);
  }

  async clear(filter: { user?: string }) {
    await this.store.clear(filter);
    await this.refresh();
  }
}

function classify(name: string) {
  if (name === ARQ_CACHE_NAME) return 'APIs (arq-offline)';
  if (/^ngsw:.*:assets:/.test(name)) return 'assets (@angular/service-worker)';
  if (/^ngsw:.*:data:/.test(name)) return 'APIs (dataGroups NGSW)';
  if (name.startsWith('ngsw:')) return 'control NGSW';
  if (name.startsWith('workbox-precache')) return 'assets (Workbox precache)';
  if (name.startsWith('arq-')) return 'APIs (Workbox runtime)';
  return 'otra';
}
