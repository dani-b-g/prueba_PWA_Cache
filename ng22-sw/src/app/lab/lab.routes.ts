import { Routes } from '@angular/router';
import { DashboardPage } from './pages/dashboard.page';
import { provideApiCacheRules } from '../arq-offline';

export const labRoutes: Routes = [
  { path: '', component: DashboardPage, title: 'Registro' },
  // Rutas lazy: cada una genera un chunk JS independiente
  { path: 'api', loadComponent: () => import('./pages/api.page').then((m) => m.ApiPage) },
  { path: 'cache', loadComponent: () => import('./pages/cache.page').then((m) => m.CachePage) },
  { path: 'lazy', loadComponent: () => import('./pages/lazy.page').then((m) => m.LazyPage) },
  { path: 'ssr', loadComponent: () => import('./pages/ssr.page').then((m) => m.SsrPage) },
  { path: 'config', loadComponent: () => import('./pages/config.page').then((m) => m.ConfigPage) },
  {
    path: 'arq',
    // El equipo de la feature declara aquí qué llamadas de su dominio se guardan
    providers: [
      provideApiCacheRules('expedientes', [
        {
          id: 'expedientes-mios',
          description: 'Datos del usuario: visibles offline en modo lectura',
          match: '/api/arq/me/expedientes',
          strategy: 'network-first',
          timeout: '3s',
          maxStale: '7d',
        },
        {
          id: 'busqueda',
          description: 'Una entrada por query; se guardan las 3 últimas',
          match: '/api/arq/search',
          strategy: 'network-first',
          maxEntries: 3,
        },
      ]),
    ],
    loadComponent: () => import('./pages/arq.page').then((m) => m.ArqPage),
  },
  { path: 'arq-panel', loadComponent: () => import('./pages/arq-panel.page').then((m) => m.ArqPanelPage) },
  { path: '**', redirectTo: '' },
];
