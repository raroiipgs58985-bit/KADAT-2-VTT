import type { ActionRequest } from './actions.js';
import type { CheckResult } from './checks.js';
import type { CharacteristicState } from './characteristics.js';
import type {
  ActorReference,
  CanonicalReference,
  Provenance,
  SourceReference,
} from './identity.js';
import type { EffectDefinition, ResolutionContext } from './resolution.js';
import type { CalledLocation, DodgeResult } from './ranged.js';
import type {
  DamageProfileReference,
  PenetrationReference,
  WeaponTraitReference,
} from './weapons.js';

export type MeleeBase = 'simple' | 'cautious' | 'reckless' | 'charge' | 'free' | 'called';
export type MeleeTechnique = 'normal' | 'wide-sweep' | 'stun' | 'knockdown' | 'grapple' | 'lunge';
export type MeleeStance = 'standard' | 'defensive' | 'palisade';
export type MeleeGrip = 'one-handed' | 'two-handed' | 'close' | 'fist' | 'mordhau';
export type MeleeOrigin =
  'NORMAL' | 'REACTION' | 'COUNTERATTACK' | 'OPPORTUNITY' | 'PALISADE_TRIGGER' | 'GRAPPLE_FOLLOWUP';
export type AvoidancePool = 'normal' | 'melee-only';

export interface MeleeProfile {
  readonly source: SourceReference;
  readonly family: string;
  readonly handedness: 'one-handed' | 'two-handed';
  readonly validGrips: readonly MeleeGrip[];
  readonly reach: number;
  readonly damage: DamageProfileReference;
  readonly penetration: PenetrationReference;
  readonly parryEligible: boolean;
  readonly properties: readonly SourceReference[];
}

export interface MeleeContribution {
  readonly source: SourceReference;
  readonly profile: Partial<MeleeProfile>;
  readonly effects: readonly EffectDefinition[];
  readonly provenance: Provenance;
}

export interface MeleeWeaponTemplate {
  readonly id: string;
  readonly canonical: CanonicalReference;
  readonly profile: MeleeProfile;
  readonly effects: readonly EffectDefinition[];
  readonly provenance: Provenance;
  /** Arsenal properties applied by the rules engine («Свойства оружия»). */
  readonly traits?: readonly WeaponTraitReference[];
}

export interface MeleeWeaponInstance {
  readonly id: string;
  readonly owner: ActorReference;
  readonly template: MeleeWeaponTemplate;
  readonly held: boolean;
  readonly readied: boolean;
  readonly dropped: boolean;
  /** Hangs on a sling or chain after being let go (ruling 81). */
  readonly hanging?: boolean;
  readonly pattern?: MeleeContribution;
  readonly modifications: readonly MeleeContribution[];
  /** Explicit canonical substitute, not a guessed mace catalog entry. */
  readonly mordhauProfile?: MeleeProfile;
}

export interface MeleeActorState {
  readonly weaponId: string;
  readonly stance: MeleeStance;
  readonly grip: MeleeGrip;
  readonly sizeCategory: number;
  readonly skills: { readonly athletics: SkillCheckValue; readonly acrobatics: SkillCheckValue };
  readonly meleeOnlyReactionRemaining: number;
  readonly palisadeSpent: boolean;
}

export interface SkillCheckValue {
  readonly baseValue: number;
  readonly finalSuper: number;
  readonly provenance: Provenance;
}

export interface CounterattackOpportunity {
  readonly id: string;
  readonly actor: ActorReference;
  readonly target: ActorReference;
  /** Identity of the individual Parry resolution that grants the opportunity. */
  readonly triggeringResolutionId: string;
  readonly modifier: number;
  readonly calledAllowed: boolean;
  readonly spent: boolean;
  readonly provenance: readonly Provenance[];
}

export interface GrappleRelation {
  readonly id: string;
  readonly controller: ActorReference;
  readonly victim: ActorReference;
  readonly thrownAdvantage: boolean;
  readonly preparedItem?: { readonly source: SourceReference; readonly owner: ActorReference };
  readonly provenance: Provenance;
}

export interface MeleeRuntimeState {
  readonly actors: Readonly<Record<string, MeleeActorState>>;
  readonly weapons: Readonly<Record<string, MeleeWeaponInstance>>;
  readonly grapples: readonly GrappleRelation[];
  readonly counterattacks: readonly CounterattackOpportunity[];
  readonly feints: readonly {
    readonly id: string;
    readonly attacker: ActorReference;
    readonly target: ActorReference;
    readonly provenance: Provenance;
  }[];
  readonly temporary: readonly {
    readonly actor: ActorReference;
    readonly effectIds: readonly string[];
    readonly expires: 'next-own-turn';
  }[];
  readonly followups: readonly {
    readonly id: string;
    readonly actor: ActorReference;
    readonly relationId: string;
    readonly spent: boolean;
    readonly provenance: Provenance;
  }[];
}

export interface MeleeEffectIntent {
  readonly type: 'StunDurationIntent' | 'PrimitiveDamageIntent' | 'PreparedItemUseIntent';
  readonly actor: ActorReference;
  readonly target: ActorReference;
  readonly source: SourceReference;
  readonly provenance: readonly Provenance[];
  readonly damage?: DamageProfileReference;
  readonly damageTransforms?: EffectiveMeleeProfile['damageTransforms'];
  readonly location?: CalledLocation;
  readonly durationTransform?: { readonly multiplier: 0.5; readonly rounding: 'ceil' };
  readonly item?: SourceReference;
  readonly context?: ResolutionContext;
}

export interface EffectiveMeleeProfile {
  readonly profile: MeleeProfile;
  readonly nrModifier: number;
  readonly grip: MeleeGrip;
  readonly technique: MeleeTechnique;
  readonly damageTransforms: readonly {
    readonly type: 'remove-die' | 'add' | 'multiply';
    readonly value: number;
    readonly rounding?: 'ceil';
    readonly provenance: Provenance;
  }[];
  readonly provenance: readonly Provenance[];
}

export interface MeleeAvoidanceRequest {
  readonly id: string;
  readonly type: 'dodge' | 'parry';
  readonly context: ResolutionContext;
  readonly weaponId?: string;
  readonly pool: AvoidancePool;
}

export interface MeleeTargetIntent {
  readonly actor: ActorReference;
  readonly distance: number;
  readonly context?: ResolutionContext;
  readonly avoidance?: MeleeAvoidanceRequest;
}

export interface MeleeTrigger {
  readonly id: string;
  readonly type: 'leaves-melee' | 'palisade';
  readonly attacker: ActorReference;
  readonly target: ActorReference;
  readonly engaged?: boolean;
  readonly allyInBaseContact?: boolean;
  readonly incomingReach?: number;
}

export interface MeleeAttackRequest extends ActionRequest {
  readonly type: 'melee-attack';
  readonly origin: MeleeOrigin;
  readonly base: MeleeBase;
  readonly technique: MeleeTechnique;
  readonly weaponId: string;
  readonly targets: readonly MeleeTargetIntent[];
  readonly movementDistance?: number;
  readonly calledLocation?: CalledLocation;
  readonly trigger?: MeleeTrigger;
  readonly opportunityId?: string;
  /**
   * Two weapons («Бой» H52–L56): one attack action, one roll per weapon (ruling 40); −30 without
   * the talent «Парное оружие (Рукопашное)». The second weapon's blow names `primaryId`.
   */
  readonly dualWield?: { readonly primaryId?: string };
}

export interface ParryRequest extends ActionRequest {
  readonly type: 'parry';
  readonly weaponId?: string;
  readonly pool: AvoidancePool;
  readonly incomingOrigin: MeleeOrigin;
  /** Identity of the individual Parry resolution that grants the opportunity. */
  readonly triggeringResolutionId: string;
}

export interface ParryResult {
  readonly check: CheckResult;
  readonly cancelledHits: number;
  readonly survivingHits: number;
  readonly counterattack: CounterattackOpportunity | null;
}

export interface MeleeHitRecord {
  readonly id: string;
  readonly attackId: string;
  readonly attacker: ActorReference;
  readonly target: ActorReference;
  readonly weaponId: string;
  readonly profile: SourceReference;
  readonly origin: MeleeOrigin;
  readonly base: MeleeBase;
  readonly technique: MeleeTechnique;
  readonly stance: MeleeStance;
  readonly grip: MeleeGrip;
  readonly rawAttackRoll: number;
  readonly check: CheckResult;
  readonly called: boolean;
  readonly location: CalledLocation;
  readonly reach: number;
  readonly distance: number;
  readonly unresolvedDamage: DamageProfileReference;
  readonly penetration: PenetrationReference;
  readonly damageTransforms: EffectiveMeleeProfile['damageTransforms'];
  readonly effectIntents: readonly MeleeEffectIntent[];
  readonly context: ResolutionContext;
  readonly provenance: readonly Provenance[];
}

export interface MeleeAttackResult {
  readonly sharedRawRoll: number;
  readonly composition: EffectiveMeleeProfile;
  readonly origin: MeleeOrigin;
  readonly base: MeleeBase;
  readonly stance: MeleeStance;
  readonly dropped: boolean;
  readonly request: MeleeAttackRequest;
  readonly targets: readonly {
    readonly actor: ActorReference;
    readonly check: CheckResult;
    readonly chosenAvoidance: 'parry' | 'dodge' | null;
    readonly avoidance: ParryResult | DodgeResult | null;
    readonly hit: MeleeHitRecord | null;
    readonly intents: readonly MeleeEffectIntent[];
  }[];
}

export interface OpposedResult {
  readonly actor: ActorReference;
  readonly opponent: ActorReference;
  readonly attackerCheck: CheckResult;
  readonly defenderCheck: CheckResult;
  readonly sizeDegrees: { readonly attacker: number; readonly defender: number };
  readonly winner: ActorReference | null;
  /** How the winner was decided («Общая механика» C5). */
  readonly decidedBy: 'degrees' | 'characteristic-bonus' | 'super-threshold' | 'none';
  /** Winner's effective degrees (1 when decided by the Super threshold rule); null without a winner. */
  readonly winnerDegrees: number | null;
}

export type GrappleAction =
  | 'grapple-continue'
  | 'grapple-damage'
  | 'grapple-throw'
  | 'grapple-push'
  | 'grapple-prepare'
  | 'grapple-stand'
  | 'grapple-use'
  | 'grapple-escape'
  | 'grapple-slip'
  | 'grapple-reverse'
  | 'grapple-release';

export interface GrappleActionRequest extends ActionRequest {
  readonly type: GrappleAction;
  readonly relationId: string;
  readonly opponentContext: ResolutionContext;
  readonly maintain?: boolean;
  readonly direction?: string;
  readonly item?: { readonly source: SourceReference; readonly owner: ActorReference };
  readonly followupId?: string;
}

export interface GrappleActionResult {
  readonly relation: GrappleRelation | null;
  readonly opposed: OpposedResult | null;
  readonly intents: readonly MeleeEffectIntent[];
  readonly distance: number;
  readonly followupId: string | null;
  readonly skillCheck?: {
    readonly check: CheckResult;
    readonly sizeDegrees: number;
    readonly totalDegrees: number;
  };
  readonly movement?: {
    readonly actors: readonly ActorReference[];
    readonly distance: number;
    readonly direction?: string;
  };
}

/** Existing Actor characteristics remain authoritative; optional fields keep B-1 profiles valid. */
export type MeleeCharacteristics = {
  readonly НР?: CharacteristicState;
  readonly СЛ?: CharacteristicState;
};
