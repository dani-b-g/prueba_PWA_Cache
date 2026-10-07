import { Component, VERSION, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SwLabService } from './sw-lab.service';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header>
      <h1>SW Lab · Angular {{ major }}</h1>
      <span class="pill" [class.off]="!sw.online()">{{ sw.online() ? 'online' : 'OFFLINE' }}</span>
      <span class="pill" [class.off]="!sw.registration().controlled">
        {{ sw.registration().controlled ? 'controlado por SW' : 'sin SW' }}
      </span>
    </header>

    @if (sw.updateReady()) {
      <div class="banner" data-test="update-banner">
        Nueva versión lista.
        <button (click)="sw.activateAndReload()">Actualizar ahora</button>
      </div>
    }
    @if (sw.unrecoverable()) {
      <div class="banner error">
        Estado irrecuperable: {{ sw.unrecoverable() }}
        <button (click)="reload()">Recargar</button>
      </div>
    }

    <nav>
      <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Registro / Updates</a>
      <a routerLink="/api" routerLinkActive="active">Caché APIs</a>
      <a routerLink="/cache" routerLinkActive="active">Cache Storage</a>
      <a routerLink="/lazy" routerLinkActive="active">Lazy</a>
      <a routerLink="/ssr" routerLinkActive="active">SSR</a>
      <a routerLink="/config" routerLinkActive="active">Config runtime</a>
    </nav>

    <main><router-outlet /></main>
  `,
})
export class ShellComponent {
  readonly sw = inject(SwLabService);
  readonly major = VERSION.major;

  reload() {
    document.location.reload();
  }
}
