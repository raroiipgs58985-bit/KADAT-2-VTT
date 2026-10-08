import type { CharacteristicId } from './characteristics.js';
import type { ActorReference, Provenance, SourceReference } from './identity.js';

export type EffectStage = 'permanent' | 'implant' | 'equipment' | 'temporary';

export type EffectTarget =
  | {
      readonly kind: 'characteristic';
      readonly characteristic: CharacteristicId;
      readonly field: 'value' | 'super';
    }
  | { readonly kind: 'check' }
  | { readonly kind: 'permission'; readonly permission: 'action' | 'reaction' | 'dodge' | 'attack' }
  | { readonly kind: 'combat-modifier'; readonly key: string };

export interface EffectCondition {
  readonly requiresTags: readonly string[];
}

export interface RoundDuration {
  readonly unit: 'round';
  readonly appliedRound: number;
  readonly durationRounds: number;
  readonly expiresAfterRound: number;
}

/** Immutable definition, not an Actor flag or a live reference to Excel. */
export interface EffectDefinition {
  readonly id: string;
  readonly target: EffectTarget;
  readonly operation: 'add' | 'set' | 'restrict' | 'grant';
  readonly value: number;
  readonly stage: EffectStage;
  readonly condition?: EffectCondition;
  readonly stackingGroup: string;
  readonly stackingRule: 'largest' | 'sum' | 'independent';
  readonly tags: readonly string[];
  readonly provenance: Provenance;
}

export interface EffectInstance {
  readonly id: string;
  readonly definition: EffectDefinition;
  readonly source: SourceReference;
  readonly targetActor: ActorReference;
  readonly duration?: RoundDuration;
  readonly provenance: Provenance;
}

export interface ResolutionModifier {
  readonly id: string;
  readonly value: number;
  readonly source: SourceReference;
  readonly provenance: Provenance;
  readonly condition?: EffectCondition;
  readonly tags?: readonly string[];
}

export type ResolutionOverride = {
  readonly subject: 'effect' | 'modifier';
  readonly id: string;
  readonly reason: string;
  readonly origin?: 'gm' | 'canonical';
} & (
  | { readonly operation: 'INCLUDE' | 'EXCLUDE' }
  | { readonly operation: 'MODIFY'; readonly value: number }
);

export interface ResolutionContext {
  readonly actor: ActorReference;
  readonly targetActor?: ActorReference;
  readonly canonicalReleaseId?: string;
  readonly roundNumber?: number;
  readonly turnNumber?: number;
  readonly tags: readonly string[];
  readonly effects: readonly EffectInstance[];
  readonly modifiers: readonly ResolutionModifier[];
  readonly overrides: readonly ResolutionOverride[];
}

export interface ResolutionTrace {
  readonly subject: 'effect' | 'modifier';
  readonly id: string;
  readonly source: SourceReference;
  readonly provenance: Provenance;
  readonly originalValue: number;
  readonly value: number;
  readonly included: boolean;
  readonly reason: 'applicable' | 'context' | 'duration' | 'override' | 'stacking';
  readonly override?: ResolutionOverride;
}
