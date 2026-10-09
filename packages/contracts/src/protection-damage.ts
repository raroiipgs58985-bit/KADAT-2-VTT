import type {
  ActorReference,
  CanonicalReference,
  Provenance,
  SourceReference,
} from './identity.js';
import type { CharacteristicState, CharacteristicResolution } from './characteristics.js';
import type { DamageRoll } from './dice.js';
import type { CalledLocation } from './ranged.js';
import type { ResolutionContext, ResolutionTrace } from './resolution.js';
import type { DamageProfileReference, PenetrationReference } from './weapons.js';
import type { CombatLogEntry, StateMutation } from './log.js';

export interface DamageTransformation {
  readonly id: string;
  readonly type: 'remove-die' | 'add' | 'multiply';
  readonly value: number;
  readonly rounding?: 'ceil';
  readonly provenance: Provenance;
}
export interface DamageInput {
  readonly hitId: string;
  readonly attackId: string;
  readonly attacker: ActorReference;
  readonly target: ActorReference;
  readonly location: CalledLocation;
  readonly weapon?: { readonly instanceId: string; readonly source: SourceReference };
  readonly profile: DamageProfileReference;
  readonly penetration: PenetrationReference;
  readonly transformations: readonly DamageTransformation[];
  readonly tags: readonly string[];
  readonly context: ResolutionContext;
  readonly provenance: readonly Provenance[];
}
export type ProtectionZone = CalledLocation | 'Arms' | 'Legs';
export type PenetrationMode = 'WEAPON_BB' | 'IGNORE_WEAPON_BB';
export type ProtectionKind =
  'worn-armor' | 'armor-layer' | 'augmetic' | 'temporary' | 'cover' | 'field' | 'context';
export type SpecialProtectionAdjustment =
  | { readonly type: 'EXPLICIT_OB'; readonly ob: number; readonly provenance: Provenance }
  | { readonly type: 'UNRESOLVED'; readonly rule: SourceReference; readonly reason: string };
export interface ProtectionDefinition {
  readonly id: string;
  readonly canonical?: CanonicalReference;
  readonly source: SourceReference;
  readonly provenance: Provenance;
  readonly kind: ProtectionKind;
  readonly ob: number;
  readonly zones: readonly ProtectionZone[];
  readonly tags: readonly string[];
  readonly penetrationMode: PenetrationMode;
  /** Mutual explicit template references; names/families never imply compatibility. */
  readonly compatibleWithTemplateIds: readonly string[];
  readonly specialLocations?: Readonly<
    Partial<Record<'Eyes' | 'Armor Joints', SpecialProtectionAdjustment>>
  >;
}
export interface ProtectionInstance {
  readonly id: string;
  readonly definition: ProtectionDefinition;
  readonly owner?: ActorReference;
  readonly active: boolean;
}
export interface CoverDefinition extends ProtectionDefinition {
  readonly kind: 'cover';
  readonly material: SourceReference;
  readonly degradation:
    | { readonly type: 'UNRESOLVED'; readonly reason: string }
    | {
        readonly type: 'EXPLICIT_OB_LOSS';
        readonly value: number;
        readonly provenance: Provenance;
      };
}
export interface CoverInstance {
  readonly id: string;
  readonly definition: CoverDefinition;
  readonly active: boolean;
  readonly currentOB: number;
  readonly coveredZones: readonly ProtectionZone[];
}
export type FieldResponse =
  | { readonly type: 'PASS_THROUGH' }
  | { readonly type: 'CANCEL_HIT' }
  | { readonly type: 'REDUCE_DAMAGE'; readonly reduction: number }
  | { readonly type: 'ARMOR_LIKE_PROTECTION'; readonly protection: ProtectionDefinition }
  | {
      readonly type: 'REDIRECT_OR_RELOCATE';
      readonly intent: {
        readonly kind: string;
        readonly source: SourceReference;
        readonly provenance: Provenance;
      };
    }
  | {
      readonly type: 'CUSTOM';
      readonly effect: {
        readonly kind: string;
        readonly payload: Readonly<Record<string, string | number | boolean>>;
        readonly provenance: Provenance;
      };
      readonly continuation: 'PASS_THROUGH' | 'UNRESOLVED';
    };
export interface FieldDefinition {
  readonly id: string;
  readonly canonical?: CanonicalReference;
  readonly source: SourceReference;
  readonly provenance: Provenance;
  readonly zones: readonly ProtectionZone[];
  readonly tags: readonly string[];
  readonly response: FieldResponse;
  /** Explicit input data only; no inferred recharge/overload behavior. */
  readonly useCost: number;
}
export interface FieldInstance {
  readonly id: string;
  readonly owner: ActorReference;
  readonly definition: FieldDefinition;
  readonly active: boolean;
  readonly remainingUses: number;
}
export interface ProtectionRuntimeState {
  readonly sources: Readonly<Record<string, ProtectionInstance>>;
  readonly covers: Readonly<Record<string, CoverInstance>>;
  /** List order is supplied by the caller; no catalog priority is inferred. */
  readonly fields: readonly FieldInstance[];
  readonly resolvedHitIds: readonly string[];
}
export interface ProtectionCandidate {
  readonly instanceId: string;
  readonly definition: ProtectionDefinition;
  readonly baseOB: number;
  readonly zones: readonly ProtectionZone[];
  readonly applicable: boolean;
  readonly applicabilityReason: 'applicable' | 'disabled' | 'owner' | 'location';
  readonly specialAdjustment: SpecialProtectionAdjustment | null;
}
export interface ProtectionContribution {
  readonly candidate: ProtectionCandidate;
  readonly trace: ResolutionTrace;
  readonly ob: number;
  readonly included: boolean;
  readonly reason: 'selected' | 'disabled' | 'owner' | 'location' | 'override' | 'pending';
}
export interface ProtectionBundle {
  readonly effectTraces: readonly ResolutionTrace[];
  readonly contributions: readonly ProtectionContribution[];
  readonly selectedIds: readonly string[];
  readonly armorOB: number;
  readonly penetrableOB: number;
  readonly bbImmuneOB: number;
  readonly incompatiblePairs: readonly (readonly [string, string])[];
  readonly unresolvedAdjustments: readonly {
    readonly sourceId: string;
    readonly adjustment: SpecialProtectionAdjustment;
  }[];
}
export interface FieldStageEntry {
  readonly instance: FieldInstance;
  readonly activation: ResolutionTrace;
  readonly response: FieldResponse | null;
  readonly numericTrace?: ResolutionTrace;
  readonly damageBefore: number;
  readonly damageAfter: number;
}
export interface FieldStageResult {
  readonly entries: readonly FieldStageEntry[];
  readonly fieldAdjustedDamage: number;
  readonly cancelled: boolean;
  readonly requiresExternalResolution: boolean;
  readonly armorSources: readonly ProtectionInstance[];
  readonly proposedFields: readonly FieldInstance[];
}
export interface CoverDegradationIntent {
  readonly type: 'CoverDegradationIntent';
  readonly sourceId: string;
  readonly material: SourceReference;
  readonly hitId: string;
  readonly location: CalledLocation;
  readonly damageTags: readonly string[];
  readonly incomingDamage: number;
  readonly reason: string;
  readonly provenance: Provenance;
}
export interface CriticalConsequenceMarker {
  readonly unresolved: true;
  readonly diceCount: 0 | 1;
  readonly maximumDiceIndices: readonly number[];
  readonly provenance: readonly Provenance[];
}
export interface DamageResolutionRequest {
  readonly input: DamageInput;
  readonly state: ProtectionRuntimeState;
  /** Required only when the pipeline reaches bVN; cancellation/pending does not resolve it. */
  readonly endurance?: CharacteristicState;
  readonly context?: ResolutionContext;
  /** Reuse the exact validated roll when resuming a pending GM decision. */
  readonly preRolled?: DamageRoll;
  readonly combatSessionId?: string;
}
export interface DamageResolutionResult {
  readonly status: 'RESOLVED' | 'CANCELLED' | 'PENDING_PROTECTION' | 'PENDING_FIELD';
  readonly input: DamageInput;
  readonly damageRoll: DamageRoll;
  readonly canonicalExpression: DamageProfileReference;
  readonly transformations: readonly {
    readonly transformation: DamageTransformation;
    readonly before: number;
    readonly after: number;
  }[];
  readonly rawDamage: number;
  readonly critical: boolean;
  readonly criticalConsequenceDiceCount: 0 | 1;
  readonly criticalConsequence: CriticalConsequenceMarker;
  readonly field: FieldStageResult;
  readonly protection: ProtectionBundle | null;
  readonly weaponBB: number;
  readonly effectiveArmor: number | null;
  readonly endurance: CharacteristicResolution | null;
  readonly bVN: number | null;
  readonly calculatedDamage: number | null;
  readonly finalDamage: number | null;
  readonly noDamage: boolean | null;
  readonly coverIntents: readonly CoverDegradationIntent[];
  readonly context: ResolutionContext;
  readonly mutations: readonly StateMutation[];
}
export interface DamageResolution {
  readonly result: DamageResolutionResult;
  readonly state: ProtectionRuntimeState;
  readonly logs: readonly CombatLogEntry[];
}
