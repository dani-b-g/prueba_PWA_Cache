import { inject, provideAppInitializer } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { RuntimeConfigService } from './runtime-config';

export const labProviders = [
  provideHttpClient(withFetch()),
  // La configuración se lee antes del primer render
  provideAppInitializer(() => inject(RuntimeConfigService).load()),
];
