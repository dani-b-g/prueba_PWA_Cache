import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpInterceptorFn } from '@angular/common/http';

/** Usuario simulado (en una app real vendría del servicio de autenticación). */
@Injectable({ providedIn: 'root' })
export class DemoUserService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly current = signal(this.read());

  set(user: string) {
    this.current.set(user);
    if (this.isBrowser) {
      try {
        localStorage.setItem('demo-user', user);
      } catch {}
    }
  }

  private read() {
    if (!this.isBrowser) return 'anon';
    try {
      return localStorage.getItem('demo-user') ?? 'ana';
    } catch {
      return 'ana';
    }
  }
}

/** Envía el usuario al backend simulado (equivale al token de autenticación). */
export const demoUserInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.url.includes('/api/') ? req.clone({ setHeaders: { 'x-user': inject(DemoUserService).current() } }) : req);
