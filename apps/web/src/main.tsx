import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { sfx } from './audio/sfx.js';
// Loaded before the first render, so the browser's install offer is never missed.
import './ui/install.js';
import { startOffline } from './ui/appUpdate.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

sfx.start();
startOffline();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
