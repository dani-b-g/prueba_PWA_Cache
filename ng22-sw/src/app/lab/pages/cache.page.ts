import { Component, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RenderInfoComponent } from '../render-info.component';

interface CacheView {
  name: string;
  urls: string[];
}

/** Ruta lazy 'cache' : contenido real de Cache Storage y /ngsw/state. */
@Component({
  selector: 'app-cache-page',
  imports: [RenderInfoComponent],
  template: `
    <app-render-info route="/cache" />
    <h2>Inspector de Cache Storage</h2>
    <div class="actions">
      <button (click)="refresh()">Refrescar</button>
      <button (click)="loadState()">Ver /ngsw/state</button>
    </div>

    <p>{{ caches().length }} cachés</p>
    @for (c of caches(); track c.name) {
      <details>
        <summary><code>{{ c.name }}</code> ({{ c.urls.length }} entradas)</summary>
        <ul>
          @for (u of c.urls; track u) { <li><code>{{ u }}</code></li> }
        </ul>
      </details>
    }

    @if (ngswState()) {
      <h3>/ngsw/state</h3>
      <pre class="state">{{ ngswState() }}</pre>
    }
  `,
})
export class CachePage implements OnInit {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly caches = signal<CacheView[]>([]);
  readonly ngswState = signal('');

  ngOnInit() {
    if (this.isBrowser) this.refresh();
  }

  async refresh() {
    if (!('caches' in globalThis)) return;
    const names = await globalThis.caches.keys();
    const views: CacheView[] = [];
    for (const name of names) {
      const cache = await globalThis.caches.open(name);
      const reqs = await cache.keys();
      views.push({ name, urls: reqs.map((r) => new URL(r.url).pathname + new URL(r.url).search) });
    }
    this.caches.set(views);
  }

  async loadState() {
    // Página de depuración que sirve el propio ngsw-worker.js
    const res = await fetch('/ngsw/state');
    this.ngswState.set(await res.text());
  }
}
