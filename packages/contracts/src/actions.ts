import type { Characteristics } from './characteristics.js';
import type { CombatSession } from './combat.js';
import type { ActorReference, Provenance, SourceReference } from './identity.js';
import type { CombatLogEntry, StateMutation } from './log.js';
import type { EffectInstance, ResolutionContext } from './resolution.js';
import type { AmmoContainerInstance, FireMode, WeaponInstance } from './weapons.js';

export type CombatActionType =
  | 'free-move'
  | 'half-move'
  | 'full-move'
  | 'run'
  | 'sprint'
  | 'prone'
  | 'kneel'
  | 'stand'
  | 'quick-aim'
  | 'careful-aim'
  | 'wait'
  | 'overwatch'
  | 'ranged-attack'
  | 'called-attack'
  | 'clear-malfunction'
  | 'dodge';

export interface ActionDefinition {
  readonly type: CombatActionType;
  readonly odCost: number;
  readonly reactionCost: number;
  readonly free: boolean;
  readonly attack: boolean;
  readonly prerequisites: readonly string[];
  readonly restrictions: readonly string[];
  readonly source: SourceReference;
  readonly provenance: Provenance;
}

export interface ActionRequest {
  readonly id: string;
  readonly type: CombatActionType;
  readonly actor: ActorReference;
  readonly target?: ActorReference;
  readonly context: ResolutionContext;
}

export interface AimState {
  readonly type: 'quick' | 'careful';
  readonly modifier: 10 | 20;
  readonly characteristics: readonly ['НС', 'НР'];
  readonly source: SourceReference;
  readonly provenance: Provenance;
  readonly activatedRound: number;
  readonly activatedTurn: number;
}

export interface WaitState {
  readonly retainedOd: number;
  readonly mayAttack: boolean;
  readonly activatedRound: number;
  readonly activatedTurn: number;
  readonly source: SourceReference;
}

export interface OverwatchState {
  readonly actionId: string;
  readonly sector: {
    readonly id: string;
    readonly headingDegrees: number;
    readonly widthDegrees: 90;
  };
  readonly trigger: { readonly id: string; readonly requiresTags: readonly string[] };
  readonly weaponId: string;
  readonly mode: FireMode;
  readonly shotsRequested: number;
  readonly activatedRound: number;
  readonly activatedTurn: number;
  readonly expires: 'fired-or-next-own-turn';
  readonly reactionCost: 1;
  readonly provenance: Provenance;
}

/** Combat subset, not a replacement for a full Actor profile. */
export interface CombatActorRuntime {
  readonly actor: ActorReference;
  readonly characteristics: Pick<Characteristics, 'НС' | 'ЛВ'>;
  readonly movement: number;
  readonly fatigue: number;
  readonly posture: 'standing' | 'prone' | 'kneeling';
  readonly effects: readonly EffectInstance[];
  readonly aim?: AimState;
  readonly wait?: WaitState;
  readonly overwatch?: OverwatchState;
}

/** Owns only B-1 resources; the accepted CombatSession remains unchanged. */
export interface CombatActionState {
  readonly session: CombatSession;
  readonly actors: Readonly<Record<string, CombatActorRuntime>>;
  readonly weapons: Readonly<Record<string, WeaponInstance>>;
  readonly containers: Readonly<Record<string, AmmoContainerInstance>>;
  readonly completedActionIds: readonly string[];
}

export interface ActionExecution {
  readonly id: string;
  readonly definition: ActionDefinition;
  readonly actor: ActorReference;
  readonly target?: ActorReference;
  readonly context: ResolutionContext;
  readonly odBefore: number;
  readonly odAfter: number;
  readonly reactionBefore: number;
  readonly reactionAfter: number;
  readonly mutations: readonly StateMutation[];
  readonly selectedWeaponId?: string;
  readonly selectedFireMode?: FireMode;
}

export interface ActionResolution<T> {
  readonly state: CombatActionState;
  readonly execution: ActionExecution;
  readonly result: T;
  readonly logs: readonly CombatLogEntry[];
}

export interface MovementResult {
  readonly distance: number;
  readonly fatigueAdded: number;
  readonly posture: CombatActorRuntime['posture'];
}
