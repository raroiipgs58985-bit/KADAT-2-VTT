import type {
  PostDamageResolutionResult,
  BleedingPulseResult,
  FatigueGainResult,
  StabilizationRequest,
  WoundFacts,
  WoundIntent,
  WoundCheckProjection,
} from './wounds.js';
import type { DamageRoll, DiceRoll } from './dice.js';
import type { ActorReference } from './identity.js';
import type { ResolutionOverride, ResolutionTrace } from './resolution.js';
import type { ActionExecution } from './actions.js';
import type { RangedAttackResult } from './ranged.js';
import type { OverwatchOrderingDecision, OverwatchSkippedAttack } from './overwatch.js';
import type {
  MeleeAttackResult,
  GrappleActionResult,
  OpposedResult,
  MeleeEffectIntent,
} from './melee.js';
import type { ResolutionContext } from './resolution.js';
import type { DamageResolutionResult } from './protection-damage.js';

export interface StateMutation {
  readonly type: string;
  readonly actor?: ActorReference;
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface CombatLogEntry {
  readonly equipment?: {
    readonly traces: readonly import('./suppression-equipment.js').EquipmentTrace[];
    readonly pending: readonly import('./suppression-equipment.js').EquipmentPending[];
  };
  readonly suppression?: {
    readonly event: import('./suppression-equipment.js').SuppressionEvent;
    readonly target: import('./suppression-equipment.js').SuppressionTargetResult;
  };
  readonly suppressionLifecycle?: {
    readonly actor: ActorReference;
    readonly conditionId: string;
    readonly pending?: import('./suppression-equipment.js').SuppressionImmunityRemovalPending;
    readonly operation: 'FIRST_TURN' | 'REMOVAL_CHECK' | 'EXPIRED' | 'PENDING';
    readonly check: import('./checks.js').CheckResult | null;
  };
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
  readonly damageResolution?: DamageResolutionResult;
  readonly woundCheck?: WoundCheckProjection;
  readonly woundTurnStart?: {
    readonly actor: ActorReference;
    readonly status: 'RESOLVED' | 'CONTEXT_REQUIRED';
    readonly pendingIntents: readonly WoundIntent[];
    readonly facts?: WoundFacts;
  };
  readonly postDamage?: PostDamageResolutionResult;
  readonly bleedingPulse?: BleedingPulseResult;
  readonly fatigueGain?: FatigueGainResult;
  readonly stabilization?: {
    readonly request: StabilizationRequest;
    readonly check: import('./checks.js').CheckResult;
    readonly durationHours: number | null;
  };
  readonly combatSessionId?: string;
  readonly action?: ActionExecution;
  readonly ranged?: RangedAttackResult;
  readonly beforeActionId?: string;
  readonly overwatchOrdering?: OverwatchOrderingDecision;
  readonly overwatchSkipped?: OverwatchSkippedAttack;
  readonly melee?: MeleeAttackResult;
  readonly grapple?: GrappleActionResult;
  readonly opposed?: OpposedResult;
  readonly meleeIntents?: readonly MeleeEffectIntent[];
  readonly meleeMovement?: {
    readonly actorIds: readonly string[];
    readonly distance: number;
    readonly stoppedBefore?: string | null;
    readonly pathSource?: import('./identity.js').SourceReference;
  };
  readonly palisadeSkipped?: {
    readonly actionId: string;
    readonly actor: ActorReference;
    readonly reason: string;
  };
  readonly opponentContext?: ResolutionContext;
}

export interface LoggedResult<T> {
  readonly result: T;
  readonly log: CombatLogEntry;
}
