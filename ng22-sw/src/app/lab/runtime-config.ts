import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface RuntimeConfig {
  environment: string;
  apiBaseUrl: string;
  featureFlags: Record<string, boolean>;
  revision: number;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  environment: 'default (no cargada)',
  apiBaseUrl: '',
  featureFlags: {},
  revision: 0,
};

/**
 * Configuración en tiempo de ejecución leída de /config.json ANTES del arranque
 * (provideAppInitializer). Esta petición pasa por el SW: en ngsw-config.json
 * está en un dataGroup "freshness" para que un cambio en el servidor se vea en
 * la siguiente carga y, sin red, se use la última copia conocida.
 * Si se metiera en un assetGroup quedaría congelada hasta el siguiente deploy.
 */
@Injectable({ providedIn: 'root' })
export class RuntimeConfigService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly config = signal<RuntimeConfig>(DEFAULT_CONFIG);
  readonly source = signal<string>('no cargada');
  readonly loadedAt = signal<string>('');

  async load(): Promise<void> {
    // En SSR/prerender no hay SW ni origen HTTP: se usan los valores por defecto
    if (!this.isBrowser) {
      this.source.set('servidor (valores por defecto)');
      return;
    }
    try {
      const res = await fetch('/config.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.config.set(await res.json());
      this.source.set(`/config.json (HTTP ${res.status})`);
    } catch (e) {
      this.source.set(`ERROR: ${e} -> valores por defecto`);
    }
    this.loadedAt.set(new Date().toLocaleTimeString());
  }
}
