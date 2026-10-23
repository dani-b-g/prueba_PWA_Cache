import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';

export interface LogEntry {
  at: string;
  type: string;
  detail?: string;
}

export interface RegistrationInfo {
  supported: boolean;
  scope?: string;
  active?: string;
  waiting?: string;
  installing?: string;
  controlled: boolean;
  controllerUrl?: string;
}

/**
 * Envoltorio sobre SwUpdate + APIs nativas para observar el ciclo de vida
 * del Service Worker de Angular (registro, versiones, estado irrecuperable).
 */
@Injectable({ providedIn: 'root' })
export class SwLabService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly enabled = this.swUpdate.isEnabled;
  readonly online = signal(true);
  readonly log = signal<LogEntry[]>([]);
  readonly updateReady = signal<VersionReadyEvent | null>(null);
  readonly unrecoverable = signal<string | null>(null);
  readonly registration = signal<RegistrationInfo>({ supported: false, controlled: false });

  constructor() {
    if (!this.isBrowser) return;

    this.online.set(navigator.onLine);
    window.addEventListener('online', () => {
      this.online.set(true);
      this.push('online');
    });
    window.addEventListener('offline', () => {
      this.online.set(false);
      this.push('offline');
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        this.push('controllerchange', navigator.serviceWorker.controller?.scriptURL);
        this.refreshRegistration();
      });
      // Se publica cuando el SW toma control (registerWhenStable puede tardar hasta 30 s)
      navigator.serviceWorker.ready.then(() => {
        this.push('navigator.serviceWorker.ready');
        this.refreshRegistration();
      });
    }

    if (!this.swUpdate.isEnabled) {
      this.push('SwUpdate.isEnabled = false', 'SW deshabilitado (ng serve / isDevMode / navegador sin soporte)');
      this.refreshRegistration();
      return;
    }

    this.swUpdate.versionUpdates.subscribe((evt) => {
      switch (evt.type) {
        case 'VERSION_DETECTED':
          this.push(evt.type, `descargando ${evt.version.hash.slice(0, 8)}`);
          break;
        case 'VERSION_READY':
          this.push(evt.type, `${evt.currentVersion.hash.slice(0, 8)} -> ${evt.latestVersion.hash.slice(0, 8)}`);
          this.updateReady.set(evt);
          break;
        case 'VERSION_INSTALLATION_FAILED':
          this.push(evt.type, evt.error);
          break;
        case 'NO_NEW_VERSION_DETECTED':
          this.push(evt.type, evt.version.hash.slice(0, 8));
          break;
      }
    });

    this.swUpdate.unrecoverable.subscribe((evt) => {
      this.push('UNRECOVERABLE_STATE', evt.reason);
      this.unrecoverable.set(evt.reason);
    });

    this.refreshRegistration();
  }

  push(type: string, detail?: string) {
    const entry = { at: new Date().toLocaleTimeString(), type, detail };
    this.log.update((l) => [entry, ...l].slice(0, 100));
    // Exponer en window para las pruebas E2E automatizadas
    (globalThis as any).__swLabLog = [...((globalThis as any).__swLabLog ?? []), entry];
  }

  async refreshRegistration() {
    if (!this.isBrowser || !('serviceWorker' in navigator)) {
      this.registration.set({ supported: false, controlled: false });
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    const ctrl = navigator.serviceWorker.controller;
    this.registration.set({
      supported: true,
      scope: reg?.scope,
      active: reg?.active?.state,
      waiting: reg?.waiting?.state,
      installing: reg?.installing?.state,
      controlled: !!ctrl,
      controllerUrl: ctrl?.scriptURL,
    });
  }

  async checkForUpdate() {
    if (!this.swUpdate.isEnabled) return this.push('checkForUpdate', 'SW deshabilitado');
    try {
      const found = await this.swUpdate.checkForUpdate();
      this.push('checkForUpdate()', found ? 'nueva versión disponible' : 'sin cambios');
    } catch (e) {
      this.push('checkForUpdate() error', String(e));
    }
  }

  async activateAndReload() {
    if (!this.swUpdate.isEnabled) return;
    await this.swUpdate.activateUpdate();
    document.location.reload();
  }

  async unregisterAndClear() {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    this.push('unregister + caches.delete', `${regs.length} registros, ${keys.length} cachés`);
    await this.refreshRegistration();
  }
}
