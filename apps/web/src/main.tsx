import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import 'react-grid-layout/css/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

// Static-demo builds (GitHub Pages) answer /api/* from an in-browser engine —
// the condition is a compile-time constant, so normal builds contain none of
// the demo code.
async function boot(): Promise<void> {
  if (import.meta.env.VITE_MIDAS_STATIC_DEMO === 'true') {
    const { installDemoShim } = await import('./demo/shim');
    installDemoShim();
  }
  ReactDOM.createRoot(root!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
