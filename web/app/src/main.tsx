import * as THREE from 'three';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startAppAutosave } from './autosave/appAutosave';
import './styles.css';

// Design_Space and Bed_Space are Z-up (mm). Set before any Canvas or camera is created.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

// IndexedDB autosave and the startup restore offer (Requirements 17.1, 17.2).
startAppAutosave();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing from index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
