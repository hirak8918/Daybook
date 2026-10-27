import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

/**
 * Renderer entry point.
 *
 * There is exactly one root and no routing library: sections are state, the
 * overlays are portals-in-place, and every pixel is drawn from the same store.
 * React StrictMode is on in development — the store is written to survive the
 * double-mount it performs.
 */
const container = document.getElementById('root');
if (!container) {
  throw new Error('Daybook: #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
