import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { combatStore } from './ui/store';

// Development-only test hook (absent from production builds): lets the browser check simulate
// a scene change made elsewhere while a gesture is in progress.
if (import.meta.env.DEV)
  (window as unknown as { __kadatTest: object }).__kadatTest = {
    bumpSceneRevision: () =>
      combatStore.run((b) => {
        b.sceneRevision += 1;
      }),
  };

const root = document.getElementById('root');

if (!root) {
  throw new Error('Client root element is missing');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
