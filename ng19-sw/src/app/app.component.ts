import { Component } from '@angular/core';
import { ShellComponent } from './lab/shell.component';

@Component({
  selector: 'app-root',
  imports: [ShellComponent],
  template: '<app-shell />',
})
export class AppComponent {}
