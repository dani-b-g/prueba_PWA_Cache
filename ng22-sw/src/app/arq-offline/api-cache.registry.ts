import {
  EnvironmentProviders,
  Injectable,
  InjectionToken,
  PLATFORM_ID,
  computed,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ApiCacheRule, ruleMatches, toMs } from './api-cache.model';

/** Formato del fichero JSON de reglas (lo puede editar operaciones sin recompilar). */
export interface ApiCacheRulesFile {
  version?: number;
  rules: (Omit<ApiCacheRule, 'match'> & { match: string })[];
}

/** Identidad del usuario actual para separar la caché por usuario. */
export const API_CACHE_USER = new InjectionToken<() => string>('API_CACHE_USER', {
  providedIn: 'root',
  factory: () => () => 'anon',
});

/**
 * Registro central de reglas. Orden de resolución:
 *  1. Reglas del JSON en tiempo de ejecución (sobrescriben por id a las de código)
 *  2. Reglas de código, en orden de registro
 * Gana la primera regla que encaje. Una regla 'network-only' excluye la URL.
 */
@Injectable({ providedIn: 'root' })
export class ApiCacheRegistry {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly codeRules = signal<ApiCacheRule[]>([]);
  private readonly jsonRules = signal<ApiCacheRule[]>([]);
  readonly jsonSource = signal<string>('no cargado');
  readonly errors = signal<string[]>([]);

  readonly rules = computed(() => {
    const json = this.jsonRules();
    const overridden = new Set(json.map((r) => r.id));
    return [...json, ...this.codeRules().filter((r) => !overridden.has(r.id))];
  });

  register(rules: ApiCacheRule[], source: string) {
    const valid = rules.filter((r) => this.validate(r, source)).map((r) => ({ ...r, source }));
    this.codeRules.update((list) => [...list.filter((r) => !valid.some((v) => v.id === r.id)), ...valid]);
  }

  async loadFromUrl(url: string) {
    if (!this.isBrowser) return;
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file = (await res.json()) as ApiCacheRulesFile;
      const rules = file.rules
        .map((r) => ({ ...r, match: r.match.startsWith('re:') ? new RegExp(r.match.slice(3)) : r.match, source: `json:${url}` }))
        .filter((r) => this.validate(r, url));
      this.jsonRules.set(rules);
      this.jsonSource.set(`${url} (v${file.version ?? '?'}, ${rules.length} reglas)`);
    } catch (e) {
      this.jsonSource.set(`${url}: ERROR ${e}`);
    }
  }

  find(method: string, pathWithQuery: string): ApiCacheRule | undefined {
    return this.rules().find((r) => ruleMatches(r, method, pathWithQuery));
  }

  private validate(r: ApiCacheRule, source: string): boolean {
    const problems: string[] = [];
    if (!r.id) problems.push('sin id');
    if (!r.match) problems.push('sin match');
    if ((r.methods ?? ['GET']).some((m) => !['GET', 'HEAD'].includes(m.toUpperCase())))
      problems.push('solo se admiten GET/HEAD (las mutaciones no se cachean)');
    try {
      toMs(r.ttl, 0);
      toMs(r.timeout, 0);
      toMs(r.maxStale, 0);
    } catch (e) {
      problems.push(String(e));
    }
    if (problems.length) this.errors.update((l) => [...l, `[${source}] regla "${r.id}": ${problems.join(', ')}`]);
    return problems.length === 0;
  }
}

/**
 * API pública para los equipos: declaran las llamadas a cachear de su feature.
 * Se puede usar en `app.config.ts` o en los `providers` de una ruta lazy:
 *
 *   { path: 'expedientes', providers: [provideApiCacheRules('expedientes', [...])], loadComponent: ... }
 */
export function provideApiCacheRules(feature: string, rules: ApiCacheRule[]): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => inject(ApiCacheRegistry).register(rules, `código:${feature}`)),
  ]);
}
