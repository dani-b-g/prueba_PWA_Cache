/**
 * Modelo declarativo de caché de APIs para la arquitectura.
 *
 * Los equipos NO programan la caché: declaran reglas (en código o en JSON) y la
 * arquitectura decide cómo aplicarlas. La misma regla se puede ejecutar con
 * distintos motores (interceptor + Cache Storage, Workbox, @angular/service-worker).
 */

export type CacheStrategy =
  /** Red primero; si falla (red, 5xx o timeout) usa la caché. Datos "vivos" que se quieren ver offline. */
  | 'network-first'
  /** Caché primero mientras no caduque (ttl); luego red. Catálogos, datos de referencia. */
  | 'cache-first'
  /** Devuelve la caché al instante y la refresca en segundo plano. */
  | 'stale-while-revalidate'
  /** Nunca cachea (útil para excluir explícitamente una URL dentro de un patrón más amplio). */
  | 'network-only';

export interface ApiCacheRule {
  /** Identificador estable de la regla (aparece en el panel y en las métricas). */
  id: string;
  /** Patrón de URL: glob sobre pathname+query ('/api/catalog/**', '/api/expedientes/*') o RegExp. */
  match: string | RegExp;
  /** Métodos cacheables. Por defecto ['GET']. Nunca se cachean mutaciones. */
  methods?: string[];
  strategy: CacheStrategy;
  /** Validez de la copia para servirla SIN ir a la red (cache-first): '30s', '10m', '12h', '7d' o ms. Por defecto '1d'. */
  ttl?: string | number;
  /** Edad máxima de una copia para usarla como RESPALDO cuando falla la red o el servidor. Por defecto '30d'. */
  maxStale?: string | number;
  /** Solo network-first: tiempo máximo de espera de la red antes de usar la caché. */
  timeout?: string | number;
  /** Máximo de entradas para esta regla; al superarlo se eliminan las guardadas hace más tiempo. Por defecto 50. */
  maxEntries?: number;
  /** Usar la caché si el servidor responde 5xx (no lo hace @angular/service-worker). Por defecto true. */
  fallbackOn5xx?: boolean;
  /** Separar la caché por usuario (clave = usuario + URL). Por defecto true. */
  perUser?: boolean;
  /** Ignorar la query string al buscar en caché. Por defecto false. */
  ignoreSearch?: boolean;
  /** Texto libre para el panel. */
  description?: string;
  /** Quién registró la regla (lo rellena la arquitectura: 'código:<feature>' | 'json'). */
  source?: string;
}

/** Cómo se resolvió una petición. Se expone al componente y al panel. */
export type CacheOutcome =
  | 'network' // respuesta de red (y guardada si procede)
  | 'cache-hit' // servida de caché sin ir a la red (cache-first / swr)
  | 'fallback-offline' // red caída => caché
  | 'fallback-5xx' // servidor 5xx => caché
  | 'fallback-timeout' // red lenta => caché
  | 'miss-error' // sin red y sin caché
  | 'bypass'; // sin regla o network-only

export interface CacheMeta {
  outcome: CacheOutcome;
  ruleId?: string;
  /** Momento en que se obtuvo de la red la copia servida (ISO). */
  storedAt?: string;
  /** Edad de la copia en ms. */
  ageMs?: number;
}

export interface ApiCacheEvent extends CacheMeta {
  at: string;
  method: string;
  url: string;
  status: number | string;
  ms: number;
}

export function toMs(v: string | number | undefined, def: number): number {
  if (v === undefined) return def;
  if (typeof v === 'number') return v;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/.exec(v.trim());
  if (!m) throw new Error(`Duración no válida: ${v}`);
  const n = Number(m[1]);
  return n * { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] as 'ms' | 's' | 'm' | 'h' | 'd'];
}

/** Glob sencillo: '**' = cualquier cosa, '*' = un segmento, '?' literal en la query. */
export function globToRegExp(glob: string): RegExp {
  const re = glob
    .replace(/[.+^${}()|[\]\\?]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/?]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${re}$`);
}

export function ruleMatches(rule: ApiCacheRule, method: string, pathWithQuery: string): boolean {
  const methods = rule.methods ?? ['GET'];
  if (!methods.includes(method.toUpperCase())) return false;
  const re = typeof rule.match === 'string' ? globToRegExp(rule.match) : rule.match;
  const path = pathWithQuery.split('?')[0];
  // Un patrón sin query se compara contra el pathname; uno con '?' contra pathname+query
  return re.test(typeof rule.match === 'string' && rule.match.includes('?') ? pathWithQuery : path);
}
