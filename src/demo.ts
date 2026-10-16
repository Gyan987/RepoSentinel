import readme from '../fixtures/demo/README.md?raw';
import manifest from '../fixtures/demo/package.json?raw';
import service from '../fixtures/demo/src/service.js?raw';
import store from '../fixtures/demo/src/store.js?raw';
import environment from '../fixtures/demo/environment.example.txt?raw';
import type { RepositoryFile } from './core/types';

export const demoFiles: RepositoryFile[] = [
  { path: 'README.md', content: readme },
  { path: 'package.json', content: manifest },
  { path: 'src/service.js', content: service },
  { path: 'src/store.js', content: store },
  { path: '.env.example', content: environment },
];
