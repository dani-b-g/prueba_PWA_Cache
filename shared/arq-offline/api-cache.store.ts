import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export const ARQ_CACHE_NAME = 'arq-api-cache:v1';

export interface StoredEntry {
  key: string;
  user: string;
  ruleId: string;
  url: string;
  status: number;
  storedAt: string;
  bytes: number;
  body: unknown;
}

/**
 * Persistencia en Cache Storage desde la página (no requiere service worker).
 * Visible en DevTools > Application > Cache Storage > arq-api-cache:v1.
 * La clave incluye usuario y regla para poder borrar por usuario (logout) o por regla.
 */
@Injectable({ providedIn: 'root' })
export class ApiCacheStore {
  readonly available = isPlatformBrowser(inject(PLATFORM_ID)) && typeof caches !== 'undefined';

  private keyFor(user: string, ruleId: string, url: string) {
    return `${location.origin}/__arq-cache__/${encodeURIComponent(user)}/${encodeURIComponent(ruleId)}?u=${encodeURIComponent(url)}`;
  }

  private normalize(url: string, ignoreSearch: boolean) {
    return ignoreSearch ? url.split('?')[0] : url;
  }

  async get(user: string, ruleId: string, url: string, ignoreSearch = false): Promise<StoredEntry | null> {
    if (!this.available) return null;
    const cache = await caches.open(ARQ_CACHE_NAME);
    const key = this.keyFor(user, ruleId, this.normalize(url, ignoreSearch));
    const res = await cache.match(key);
    return res ? this.toEntry(key, res) : null;
  }

  async put(user: string, ruleId: string, url: string, status: number, body: unknown, maxEntries: number, ignoreSearch = false) {
    if (!this.available) return;
    const cache = await caches.open(ARQ_CACHE_NAME);
    const nurl = this.normalize(url, ignoreSearch);
    const payload = JSON.stringify(body);
    await cache.put(
      this.keyFor(user, ruleId, nurl),
      new Response(payload, {
        headers: {
          'content-type': 'application/json',
          'x-arq-user': user,
          'x-arq-rule': ruleId,
          'x-arq-url': nurl,
          'x-arq-status': String(status),
          'x-arq-stored-at': new Date().toISOString(),
        },
      }),
    );
    await this.trim(user, ruleId, maxEntries);
  }

  /** Recorte por (usuario, regla): elimina las entradas guardadas hace más tiempo (no es un LRU por acceso). */
  private async trim(user: string, ruleId: string, maxEntries: number) {
    const entries = (await this.list()).filter((e) => e.user === user && e.ruleId === ruleId);
    if (entries.length <= maxEntries) return;
    const cache = await caches.open(ARQ_CACHE_NAME);
    entries.sort((a, b) => a.storedAt.localeCompare(b.storedAt));
    for (const e of entries.slice(0, entries.length - maxEntries)) await cache.delete(e.key);
  }

  async list(): Promise<StoredEntry[]> {
    if (!this.available) return [];
    const cache = await caches.open(ARQ_CACHE_NAME);
    const out: StoredEntry[] = [];
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (res) out.push(await this.toEntry(req.url, res));
    }
    return out;
  }

  async clear(filter: { user?: string; ruleId?: string } = {}) {
    if (!this.available) return 0;
    const cache = await caches.open(ARQ_CACHE_NAME);
    let n = 0;
    for (const e of await this.list()) {
      if ((filter.user === undefined || e.user === filter.user) && (filter.ruleId === undefined || e.ruleId === filter.ruleId)) {
        await cache.delete(e.key);
        n++;
      }
    }
    return n;
  }

  private async toEntry(key: string, res: Response): Promise<StoredEntry> {
    const text = await res.clone().text();
    return {
      key,
      user: res.headers.get('x-arq-user') ?? '',
      ruleId: res.headers.get('x-arq-rule') ?? '',
      url: res.headers.get('x-arq-url') ?? '',
      status: Number(res.headers.get('x-arq-status') ?? 200),
      storedAt: res.headers.get('x-arq-stored-at') ?? '',
      bytes: text.length,
      body: JSON.parse(text),
    };
  }
}
