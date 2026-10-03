import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { sfx } from './audio/sfx.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

sfx.start();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
