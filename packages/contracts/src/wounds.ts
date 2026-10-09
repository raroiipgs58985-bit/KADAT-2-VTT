import type { ActorReference, Provenance, SourceReference } from './identity.js';
import type { CharacteristicId, CharacteristicState } from './characteristics.js';
import type { CombatActionState } from './actions.js';
import type { ConditionInstance } from './combat.js';
import type { CheckResult } from './checks.js';
import type { DiceRoll } from './dice.js';
import type { DamageResolutionResult } from './protection-damage.js';
import type { CalledLocation } from './ranged.js';
import type { EffectInstance, ResolutionContext } from './resolution.js';
import type { CombatLogEntry, StateMutation } from './log.js';

export type ConsequenceZone = 'HEAD' | 'ARM' | 'TORSO' | 'LEG';
export type BleedingSeverity = 'LIGHT' | 'MEDIUM' | 'HEAVY';
export type BleedingActivity = 'REST' | 'PHYSICAL_ACTION' | 'HOLDING_WOUND';
export interface CanonicalDuration {
  readonly unit: 'round' | 'minute' | 'hour' | 'day';
  readonly amount: number;
}
export type ConsequenceOperation =
  | {
      readonly kind: 'condition';
      readonly condition: string;
      readonly duration?: CanonicalDuration;
    }
  | {
      readonly kind: 'bleeding';
      readonly severity: BleedingSeverity;
      readonly normalization?: Provenance;
    }
  | { readonly kind: 'injury'; readonly feature: string; readonly severity?: 'minor' | 'serious' }
  | {
      readonly kind: 'modifier';
      readonly key: string;
      readonly value: number;
      readonly duration?: CanonicalDuration;
    }
  | {
      readonly kind: 'check';
      readonly modifier: 0 | -10;
      readonly onFailure: readonly ConsequenceOperation[];
      readonly onSuccess?: readonly ConsequenceOperation[];
    }
  | {
      readonly kind: 'roll';
      readonly sides: 5 | 10 | 2;
      readonly modifier: number;
      readonly purpose:
        'teeth' | 'fingers' | 'finger' | 'fatigue' | 'persistent-fatigue-days' | 'clavicle-side';
    }
  | { readonly kind: 'drop' }
  | {
      readonly kind: 'trigger';
      readonly trigger: 'same-limb-damage' | 'repeated-deafness' | 'turn-start-VN';
    }
  | { readonly kind: 'death'; readonly destroyed: 'HEAD' | 'TORSO' | null }
  | { readonly kind: 'eye-check' }
  | { readonly kind: 'pending'; readonly intent: string; readonly reason: string };
export interface ConsequenceRow {
  readonly id: string;
  readonly zone: ConsequenceZone;
  readonly minimum: number;
  readonly maximum: number | null;
  readonly range: string;
  readonly title: string;
  readonly text: string;
  readonly provenance: Provenance;
  readonly operations: readonly ConsequenceOperation[];
}
export interface WoundIntent {
  readonly id: string;
  readonly type:
    | 'TimedConditionIntent'
    | 'DropHeldItemIntent'
    | 'CanonicalEffectIntent'
    | 'BleedingActivityContextRequired'
    | 'BodyZoneMappingRequired'
    | 'FeatureContextRequired'
    | 'TimedDeathIntent'
    | 'StabilizedFollowupIntent'
    | 'FatigueRecoveryIntent'
    | 'DelayedInjuryIntent'
    | 'DurationInterpretationRequired';
  readonly actor: ActorReference;
  readonly source: SourceReference;
  readonly provenance: Provenance;
  readonly reason: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
  readonly duration?: CanonicalDuration;
  readonly location?: CalledLocation;
  readonly injuryId?: string;
  readonly bleedingId?: string;
  readonly effects?: readonly EffectInstance[];
}
export interface InjuryTrigger {
  readonly kind: 'same-limb-damage' | 'repeated-deafness' | 'turn-start-VN';
  readonly location: CalledLocation;
  readonly consumed: boolean;
  readonly provenance: Provenance;
}
export interface InjuryRecord {
  readonly id: string;
  readonly actor: ActorReference;
  readonly sourceAttackId: string;
  readonly sourceHitId: string;
  readonly consequence: ConsequenceRow;
  readonly location: CalledLocation;
  readonly side: 'Left' | 'Right' | null;
  readonly finalDamage: number;
  readonly severity: number;
  readonly title: string;
  readonly createdRound: number;
  readonly createdTurn: number;
  readonly features: readonly {
    readonly type: string;
    readonly severity?: 'minor' | 'serious';
    readonly count?: number;
    readonly side?: 'Left' | 'Right';
  }[];
  readonly bleedingSourceIds: readonly string[];
  readonly persistentEffects: readonly EffectInstance[];
  readonly triggers: readonly InjuryTrigger[];
  readonly canonicalText: string;
  readonly provenance: readonly Provenance[];
}
export interface BleedingSource {
  readonly normalization?: Provenance;
  readonly id: string;
  readonly injuryId: string;
  readonly consequence: ConsequenceRow;
  readonly severity: BleedingSeverity;
  readonly location: CalledLocation;
  readonly active: boolean;
  readonly appliedRound: number;
  readonly appliedTurn: number;
  readonly provenance: Provenance;
}
export interface BloodState {
  readonly maxBlood: number;
  readonly reserveBonus: number;
  readonly bloodLost: number;
  readonly currentBlood: number;
}
export interface BloodThresholds {
  readonly quarter: boolean;
  readonly half: boolean;
  readonly threeQuarters: boolean;
}
export interface WoundCondition extends Pick<
  ConditionInstance,
  'id' | 'type' | 'actor' | 'sources' | 'provenance' | 'effects'
> {
  readonly duration: CanonicalDuration | null;
  readonly appliedRound: number;
  readonly appliedTurn: number;
  readonly removal: 'source-resolved' | 'blood-replacement';
  readonly expires?: 'next-own-turn';
}
export type LifeState =
  | { readonly status: 'ALIVE' }
  | {
      readonly status: 'AGONY';
      readonly source: SourceReference;
      readonly provenance: Provenance;
      readonly startedRound: number;
      readonly durationRounds: number;
      readonly expiresAfterRound: number;
    }
  | {
      readonly status: 'STABILIZED';
      readonly source: SourceReference;
      readonly provenance: Provenance;
      readonly durationHours: number;
      readonly priorAgony: Extract<LifeState, { status: 'AGONY' }>;
    }
  | {
      readonly status: 'DEAD';
      readonly source: SourceReference;
      readonly provenance: Provenance;
      readonly round: number;
      readonly reason: string;
    };
export interface WoundActorState {
  readonly actor: ActorReference;
  readonly maxWounds: number;
  readonly damageTaken: number;
  readonly blood: BloodState;
  readonly injuries: readonly InjuryRecord[];
  readonly bleeding: readonly BleedingSource[];
  readonly conditions: readonly WoundCondition[];
  readonly intents: readonly WoundIntent[];
  readonly life: LifeState;
}
export interface WoundRuntimeState {
  readonly combat: CombatActionState;
  readonly actors: Readonly<Record<string, WoundActorState>>;
  readonly processedHitIds: readonly string[];
  readonly processedPulseIds: readonly string[];
}
export interface WoundFacts {
  readonly provenance: Provenance;
  readonly activityBySource?: Readonly<Record<string, BleedingActivity>>;
  readonly activity?: BleedingActivity;
  readonly eyeCountBefore?: number;
  readonly consequenceZone?: ConsequenceZone;
}
export interface BleedingPulseEntry {
  readonly source: BleedingSource;
  readonly activity: BleedingActivity;
  readonly check: CheckResult | null;
  readonly projection: WoundCheckProjection | null;
  readonly extraDie: DiceRoll | null;
  readonly bloodLoss: number;
}
export interface FatigueGainResult {
  readonly provenance: Provenance;
  readonly roll: DiceRoll;
  readonly bVN: number;
  readonly rawFatigueGain: number;
  readonly appliedFatigueGain: number;
  readonly fatigueBefore: number;
  readonly fatigueAfter: number;
}
export interface PostDamageRequest {
  readonly damage: DamageResolutionResult;
  readonly state: WoundRuntimeState;
  readonly context: ResolutionContext;
  readonly facts?: WoundFacts;
  readonly resumeDice?: readonly DiceRoll[];
}
export interface PostDamageResolutionResult {
  readonly damage: DamageResolutionResult;
  readonly status: 'RESOLVED' | 'CONTEXT_REQUIRED';
  readonly attackId: string;
  readonly hitId: string;
  readonly attacker: ActorReference;
  readonly target: ActorReference;
  readonly location: CalledLocation;
  readonly finalDamageOfThisHit: number;
  readonly damageTakenBefore: number;
  readonly damageTakenAfter: number;
  readonly maxWounds: number;
  readonly woundStateBefore: 'Within Wounds' | 'Critical Wounded';
  readonly woundStateAfter: 'Within Wounds' | 'Critical Wounded';
  readonly critical: boolean;
  readonly criticalConsequenceDie: DiceRoll | null;
  readonly consequenceSeverity: number;
  readonly consequence: ConsequenceRow | null;
  readonly escalatedBy: readonly string[];
  readonly injuriesCreated: readonly InjuryRecord[];
  readonly conditionsCreatedOrUpdated: readonly (WoundCondition | ConditionInstance)[];
  readonly effectsCreated: readonly EffectInstance[];
  readonly secondaryChecks: readonly CheckResult[];
  readonly secondaryCheckProjections: readonly WoundCheckProjection[];
  readonly nestedDice: readonly DiceRoll[];
  readonly pendingIntents: readonly WoundIntent[];
  readonly fatigue: readonly FatigueGainResult[];
  readonly bleedingSourcesCreated: readonly BleedingSource[];
  readonly immediateBloodResolution: readonly BleedingPulseEntry[];
  readonly bloodBefore: BloodState;
  readonly bloodAfter: BloodState;
  readonly bloodThresholdsCrossed: readonly (keyof BloodThresholds)[];
  readonly lifeBefore: LifeState;
  readonly lifeAfter: LifeState;
  readonly mutations: readonly StateMutation[];
  readonly context: ResolutionContext;
  readonly facts?: WoundFacts;
}
export interface PostDamageResolution {
  readonly result: PostDamageResolutionResult;
  readonly state: WoundRuntimeState;
  readonly logs: readonly CombatLogEntry[];
}
export interface BleedingPulseRequest {
  readonly id: string;
  readonly actor: ActorReference;
  readonly state: WoundRuntimeState;
  readonly context: ResolutionContext;
  readonly facts?: WoundFacts;
  readonly resumeDice?: readonly DiceRoll[];
}
export interface BleedingPulseResult {
  readonly status: 'RESOLVED' | 'CONTEXT_REQUIRED';
  readonly pulseId: string;
  readonly actor: ActorReference;
  readonly entries: readonly BleedingPulseEntry[];
  readonly bloodBefore: BloodState;
  readonly bloodAfter: BloodState;
  readonly thresholdsCrossed: readonly (keyof BloodThresholds)[];
  readonly pendingIntents: readonly WoundIntent[];
  readonly nestedDice: readonly DiceRoll[];
  readonly mutations: readonly StateMutation[];
  readonly context: ResolutionContext;
  readonly facts?: WoundFacts;
}
export interface StabilizationRequest {
  readonly id: string;
  readonly actor: ActorReference;
  readonly target: ActorReference;
  readonly medKit: SourceReference | null;
  readonly medica: {
    readonly baseValue: number;
    readonly finalSuper: number;
    readonly provenance: Provenance;
  };
  readonly context: ResolutionContext;
}
export interface WoundCheckProjection {
  readonly characteristic: CharacteristicId;
  readonly authoritative: CharacteristicState;
  readonly resolvedValue: number;
  readonly checkValue: number;
  readonly halvingSources: readonly Provenance[];
  readonly context: ResolutionContext;
}
