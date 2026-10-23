import { inject, provideAppInitializer } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { RuntimeConfigService } from './runtime-config';
import { API_CACHE_USER, apiCacheInterceptor, provideArqOffline } from '../arq-offline';
import { DemoUserService, demoUserInterceptor } from './demo-user';

export const labProviders = [
  // demoUserInterceptor añade la identidad; apiCacheInterceptor aplica las reglas de caché
  provideHttpClient(withFetch(), withInterceptors([demoUserInterceptor, apiCacheInterceptor])),
  // La configuración se lee antes del primer render
  provideAppInitializer(() => inject(RuntimeConfigService).load()),
  // Pieza de arquitectura: reglas globales + JSON en tiempo de ejecución
  provideArqOffline({
    rulesUrl: '/api-cache-rules.json',
    rules: [
      {
        id: 'catalogo',
        description: 'Regla global de arquitectura (el JSON la sobrescribe)',
        match: '/api/arq/catalog',
        strategy: 'cache-first',
        ttl: '1h',
        perUser: false,
      },
    ],
  }),
  {
    provide: API_CACHE_USER,
    useFactory: () => {
      const user = inject(DemoUserService);
      return () => user.current();
    },
  },
];
