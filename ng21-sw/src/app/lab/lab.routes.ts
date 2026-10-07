import { Routes } from '@angular/router';
import { DashboardPage } from './pages/dashboard.page';

export const labRoutes: Routes = [
  { path: '', component: DashboardPage, title: 'Registro' },
  // Rutas lazy: cada una genera un chunk JS independiente
  { path: 'api', loadComponent: () => import('./pages/api.page').then((m) => m.ApiPage) },
  { path: 'cache', loadComponent: () => import('./pages/cache.page').then((m) => m.CachePage) },
  { path: 'lazy', loadComponent: () => import('./pages/lazy.page').then((m) => m.LazyPage) },
  { path: 'ssr', loadComponent: () => import('./pages/ssr.page').then((m) => m.SsrPage) },
  { path: 'config', loadComponent: () => import('./pages/config.page').then((m) => m.ConfigPage) },
  { path: '**', redirectTo: '' },
];
