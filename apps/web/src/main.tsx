import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { installButtonSounds } from './ui/sound.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

installButtonSounds();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
