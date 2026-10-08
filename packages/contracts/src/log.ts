import type { DamageRoll, DiceRoll } from './dice.js';
import type { ActorReference } from './identity.js';
import type { ResolutionOverride, ResolutionTrace } from './resolution.js';
import type { ActionExecution } from './actions.js';
import type { RangedAttackResult } from './ranged.js';

export interface StateMutation {
  readonly type: string;
  readonly actor?: ActorReference;
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface CombatLogEntry {
  readonly resolver: string;
  readonly actors: readonly ActorReference[];
  readonly canonicalReleaseId?: string;
  readonly roundNumber?: number;
  readonly turnNumber?: number;
  readonly dice: readonly DiceRoll[];
  readonly baseValues: Readonly<Record<string, number>>;
  readonly modifiers: readonly ResolutionTrace[];
  readonly overrides: readonly ResolutionOverride[];
  readonly target?: number;
  readonly degrees?: {
    readonly base: number;
    readonly super: number;
    readonly total: number;
    readonly failure?: number;
  };
  readonly mutations: readonly StateMutation[];
  readonly damage?: DamageRoll;
  readonly combatSessionId?: string;
  readonly action?: ActionExecution;
  readonly ranged?: RangedAttackResult;
  readonly beforeActionId?: string;
}

export interface LoggedResult<T> {
  readonly result: T;
  readonly log: CombatLogEntry;
}
