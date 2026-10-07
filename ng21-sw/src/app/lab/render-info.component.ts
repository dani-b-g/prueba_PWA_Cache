import { Component, PLATFORM_ID, TransferState, inject, input, makeStateKey, OnInit, signal } from '@angular/core';
import { isPlatformServer } from '@angular/common';

interface RenderStamp {
  renderedAt: string;
  route: string;
}

/**
 * Muestra DÓNDE se generó el HTML de la página actual:
 *  - prerender (fecha = momento del build)
 *  - SSR (fecha = momento de la petición)
 *  - solo cliente (no hay estado transferido para esta ruta)
 * Permite detectar el caso en que el SW sirve el index cacheado de OTRA ruta.
 */
@Component({
  selector: 'app-render-info',
  template: `
    <div class="render-info" [class.server]="stamp()" [attr.data-render]="stamp() ? 'server' : 'client'">
      @if (stamp(); as s) {
        HTML generado en servidor para <code>{{ s.route }}</code> a las {{ s.renderedAt }}
        @if (s.route !== route()) {
          <strong class="warn"> ⚠ el HTML recibido corresponde a otra ruta</strong>
        }
      } @else {
        Renderizado solo en cliente (CSR) para <code>{{ route() }}</code>
      }
    </div>
  `,
})
export class RenderInfoComponent implements OnInit {
  readonly route = input.required<string>();
  private readonly ts = inject(TransferState);
  private readonly isServer = isPlatformServer(inject(PLATFORM_ID));
  readonly stamp = signal<RenderStamp | null>(null);

  ngOnInit() {
    const key = makeStateKey<RenderStamp>('render-stamp');
    if (this.isServer) {
      const s = { renderedAt: new Date().toISOString(), route: this.route() };
      this.ts.set(key, s);
      this.stamp.set(s);
    } else {
      // Solo se consume una vez: las navegaciones posteriores son CSR
      this.stamp.set(this.ts.get(key, null));
      this.ts.remove(key);
    }
  }
}
