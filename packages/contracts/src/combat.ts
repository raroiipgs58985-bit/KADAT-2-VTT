import type { DiceRoll } from './dice.js';
import type { ActorReference, Provenance, SourceReference } from './identity.js';
import type { EffectInstance, RoundDuration } from './resolution.js';

export interface ReactionPool {
  readonly capacity: number;
  readonly remaining: number;
}

export interface CombatParticipant {
  readonly actor: ActorReference;
  readonly agilityBonus: number;
  /** Supplied by the caller; refresh/spending rules belong to the later Action Engine. */
  readonly reactions: ReactionPool;
}

export interface InitiativeEntry extends CombatParticipant {
  readonly roll: DiceRoll;
  readonly initiative: number;
}

export interface TurnState {
  readonly actor: ActorReference;
  readonly turnNumber: number;
  readonly od: number;
  readonly reactions: ReactionPool;
  readonly flags: readonly string[];
}

export interface ConditionInstance extends RoundDuration {
  readonly id: string;
  readonly type: string;
  readonly actor: ActorReference;
  readonly sources: readonly SourceReference[];
  readonly provenance: readonly Provenance[];
  readonly stackingRule: 'ADD_DURATION' | 'REPLACE' | 'REJECT';
  readonly effects: readonly EffectInstance[];
}

export interface Stunned extends ConditionInstance {
  readonly type: 'Stunned';
  readonly stackingRule: 'ADD_DURATION';
}

export interface CombatSession {
  readonly id: string;
  readonly canonicalReleaseId: string;
  readonly roundNumber: number;
  readonly phase: 'ready' | 'turn-active' | 'between-turns' | 'round-ended';
  readonly initiativeOrder: readonly InitiativeEntry[];
  readonly cursor: number;
  readonly activeActor: ActorReference | null;
  readonly turn: TurnState | null;
  readonly turnsStarted: number;
  readonly conditions: readonly ConditionInstance[];
}
