import { Component } from '@angular/core';
import { CachePanelComponent } from '../../arq-offline';

@Component({
  selector: 'app-arq-panel-page',
  imports: [CachePanelComponent],
  template: `
    <h2>Panel de caché</h2>
    <p>Qué reglas hay activas, qué se ha guardado y cómo se ha resuelto cada petición.</p>
    <arq-cache-panel />
  `,
})
export class ArqPanelPage {}
