import { render } from 'preact';
import { App } from './app.tsx';
import { startServiceWorker } from './pwa.ts';
import { start } from './ui/flow.ts';
import './ui/styles.css';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Terrain: the #app element is missing from index.html.');
}

render(<App />, root);
startServiceWorker();
void start();
