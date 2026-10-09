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
