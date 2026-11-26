import { useSyncExternalStore } from 'react';
import { createBattle, type Battle } from '../game/model';
import { demoOutpost } from '../game/scenarios';

/** The demo build (VITE_KADAT_DEMO=1) or `#demo` in the address opens the demo outpost. */
const initialBattle = (): Battle => {
  const hash = typeof location === 'undefined' ? '' : location.hash;
  return import.meta.env.VITE_KADAT_DEMO === '1' || hash === '#demo'
    ? demoOutpost()
    : createBattle();
};

/**
 * Framework-free game state lives in `src/game`; this store only publishes a new snapshot
 * after every command so React re-renders. Commands themselves stay atomic in the adapter.
 */
export interface CombatSnapshot {
  readonly battle: Battle;
  readonly version: number;
}
type Listener = () => void;

export class CombatStore {
  #snapshot: CombatSnapshot = { battle: initialBattle(), version: 0 };
  readonly #listeners = new Set<Listener>();

  subscribe = (listener: Listener) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  getSnapshot = () => this.#snapshot;

  /** Runs a command against the current battle and always publishes the result or the log. */
  run<T>(command: (battle: Battle) => T): T {
    try {
      return command(this.#snapshot.battle);
    } finally {
      this.#publish(this.#snapshot.battle);
    }
  }
  replace(battle: Battle) {
    this.#publish(battle);
  }
  #publish(battle: Battle) {
    this.#snapshot = { battle, version: this.#snapshot.version + 1 };
    for (const listener of this.#listeners) listener();
  }
}

export const combatStore = new CombatStore();
export const useCombat = () => useSyncExternalStore(combatStore.subscribe, combatStore.getSnapshot);
