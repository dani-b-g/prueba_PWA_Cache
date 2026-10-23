import { Component, computed, inject, input } from '@angular/core';
import { ApiCacheEngine } from './api-cache.interceptor';

/**
 * Indicador para las pantallas: de dónde vienen los datos que ve el usuario.
 *   <arq-data-freshness url="/api/catalog" />
 */
@Component({
  selector: 'arq-data-freshness',
  template: `
    @if (ev(); as e) {
      <span class="arq-fresh" [class]="'arq-fresh ' + kind()" [attr.data-outcome]="e.outcome">{{ label() }}</span>
    }
  `,
  styles: `
    .arq-fresh { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #e3f4ea; color: #1f8a4c; }
    .arq-fresh.stale { background: #fff4d6; color: #8a5a00; }
    .arq-fresh.error { background: #fbe5e2; color: #c0392b; }
  `,
})
export class DataFreshnessComponent {
  readonly url = input.required<string>();
  private readonly engine = inject(ApiCacheEngine);

  readonly ev = computed(() => this.engine.lastByUrl()[this.url()]);
  readonly kind = computed(() => {
    const o = this.ev()?.outcome;
    return o === 'network' || o === 'bypass' ? 'live' : o === 'miss-error' ? 'error' : 'stale';
  });
  readonly label = computed(() => {
    const e = this.ev();
    if (!e) return '';
    const age = humanAge(e.ageMs ?? 0);
    switch (e.outcome) {
      case 'network':
        return 'Datos actualizados';
      case 'cache-hit':
        return `Datos guardados hace ${age}`;
      case 'fallback-offline':
        return `Sin conexión · datos guardados hace ${age} (solo lectura)`;
      case 'fallback-5xx':
        return `Servicio no disponible · datos guardados hace ${age} (solo lectura)`;
      case 'fallback-timeout':
        return `Red lenta · datos guardados hace ${age}`;
      case 'miss-error':
        return 'Sin conexión y sin datos guardados';
      default:
        return '';
    }
  });
}

export function humanAge(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}
