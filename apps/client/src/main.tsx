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

// Number fields on phones: a tap selects the old value (typing replaces it instead of giving
// «040»), and leading zeros are dropped when the field is left.
const isNumberInput = (t: EventTarget | null): t is HTMLInputElement =>
  t instanceof HTMLInputElement && t.type === 'number';
document.addEventListener('focusin', (e) => {
  if (isNumberInput(e.target)) {
    const input = e.target;
    setTimeout(() => input.select(), 0);
  }
});
document.addEventListener('focusout', (e) => {
  if (isNumberInput(e.target) && /^-?0\d/.test(e.target.value))
    e.target.value = String(Number(e.target.value));
});

const root = document.getElementById('root');

if (!root) {
  throw new Error('Client root element is missing');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
