import type { ActorReference, Provenance, SourceReference } from './identity.js';
import type { CharacteristicId } from './characteristics.js';
import type { CombatActionState } from './actions.js';
import type { ConditionInstance } from './combat.js';
import type { CheckResult } from './checks.js';
import type { EffectInstance, ResolutionContext } from './resolution.js';
import type { FieldInstance, SpecialProtectionAdjustment } from './protection-damage.js';
import type { CombatLogEntry } from './log.js';
import type { RangedAttackResult } from './ranged.js';

export type EquipmentPowerState =
  'POWERED' | 'UNPOWERED' | 'DISABLED' | 'EMP_DISABLED' | 'SYSTEM_DISABLED';
export type EquipmentPayload =
  | {
      readonly kind: 'CHARACTERISTIC_ADD' | 'CHARACTERISTIC_CAP';
      readonly characteristic: CharacteristicId;
      readonly value: number;
    }
  | {
      readonly kind: 'CHECK_MODIFIER' | 'SENSORY_CHECK_MODIFIER';
      readonly scope: string;
      readonly value: number;
    }
  | { readonly kind: 'CHECK_IMMUNITY'; readonly scope: string }
  | { readonly kind: 'SUPPRESSION_IMMUNITY' }
  | { readonly kind: 'ACTION_PERMISSION' | 'ACTION_RESTRICTION'; readonly action: string }
  | {
      readonly kind: 'MOVEMENT_MODIFIER';
      readonly field: 'speed' | 'od';
      readonly value: number;
      readonly action?: string;
    }
  | { readonly kind: 'SIZE_MODIFIER'; readonly value: number }
  | {
      readonly kind: 'SENSORY_MODE';
      readonly mode: 'NIGHT_VISION' | 'THERMAL_VISION' | 'AUSPEX' | 'LOUD_SOUND_PROTECTION';
    }
  | { readonly kind: 'CONDITION_IMMUNITY'; readonly condition: string }
  | {
      readonly kind: 'CONDITION_REMOVAL_TRIGGER';
      readonly timing: 'END_OWN_TURN';
      readonly condition: 'Stunned';
    }
  | {
      readonly kind: 'RECOIL_OR_STABILIZATION_EFFECT';
      readonly capability: 'HEAVY_ONE_HANDED' | 'AUTO_STABILIZATION';
    }
  | {
      readonly kind: 'PROTECTION_ADJUSTMENT_INTENT';
      readonly adjustment: SpecialProtectionAdjustment;
    }
  | { readonly kind: 'FIELD_SOURCE'; readonly field: FieldInstance };

export interface EquipmentCombatEffect {
  readonly id: string;
  readonly sourceItemId: string;
  readonly sourceSystemId?: string;
  readonly active: boolean;
  readonly requiresPower: boolean | 'UNKNOWN';
  readonly requiredTags: readonly string[];
  readonly targetScope: 'wearer';
  readonly payload: EquipmentPayload;
  readonly stacking?: { readonly group: string; readonly rule: 'SUM' | 'LARGEST' | 'INDEPENDENT' };
  readonly provenance: Provenance;
}
export interface EquipmentInstance {
  readonly id: string;
  readonly wearer: ActorReference;
  readonly equipped: boolean;
  readonly powerState: EquipmentPowerState;
  readonly disabledSystemIds: readonly string[];
  readonly effects: readonly EquipmentCombatEffect[];
  readonly provenance: Provenance;
}
export type EquipmentPending = {
  readonly type:
    'EquipmentStackingPending' | 'PowerDependencyMappingPending' | 'ProtectionOrderingPending';
  readonly effectIds: readonly string[];
  readonly provenance: readonly Provenance[];
};
export interface EquipmentTrace {
  readonly effect: EquipmentCombatEffect;
  readonly powerState: EquipmentPowerState;
  readonly included: boolean;
  readonly reason:
    'active' | 'inactive' | 'power' | 'system' | 'tags' | 'pending' | 'override' | 'stacking';
  readonly contribution: EquipmentPayload | null;
}
export interface EquipmentCollection {
  readonly status: 'RESOLVED' | 'PENDING';
  readonly context: ResolutionContext;
  readonly effects: readonly EffectInstance[];
  readonly capabilities: readonly EquipmentTrace[];
  readonly fields: readonly FieldInstance[];
  readonly protectionIntents: readonly EquipmentTrace[];
  readonly traces: readonly EquipmentTrace[];
  readonly pending: readonly EquipmentPending[];
  readonly log: CombatLogEntry;
}

export type SuppressionWeaponClass = 'PISTOL' | 'BASIC' | 'HEAVY';
export type SuppressionEvent = {
  readonly attackId: string;
  readonly sourceActor: ActorReference;
  readonly primaryTarget: ActorReference;
  readonly weapon: SourceReference;
  readonly provenance: Provenance;
} & (
  | { readonly kind: 'SINGLE'; readonly successful: boolean; readonly successDegrees: number }
  | {
      readonly kind: 'BURST';
      readonly shotsForSuppression: number;
      readonly quantitySource: 'RESOLVED_SHOTS';
      readonly weaponClass: SuppressionWeaponClass;
    }
  | {
      readonly kind: 'AREA';
      readonly radii: readonly {
        readonly property: 'EXPLOSION' | 'MV' | 'LV';
        readonly meters: number;
        readonly provenance: Provenance;
      }[];
    }
);
export interface SuppressionCandidate {
  readonly actor: ActorReference;
  readonly distanceFromPrimaryTarget: number;
  readonly nearestCoverWithinSpeed: 'YES' | 'NO' | 'UNKNOWN';
  readonly context: ResolutionContext;
  readonly provenance: Provenance;
}
export type SuppressionPending = {
  readonly type:
    | 'SuppressionModifierRoundingPending'
    | 'CoverAvailabilityContextRequired'
    | 'SuppressionStackingPending'
    | 'SuppressionDurationPending';
  readonly actor: ActorReference;
  readonly source: SuppressionEvent;
  readonly provenance: Provenance;
};
export type SuppressionResponse =
  | {
      readonly type: 'SeekNearestCoverIntent';
      readonly actor: ActorReference;
      readonly maxDistance: number;
      readonly provenance: Provenance;
    }
  | {
      readonly type: 'DropProneIntent';
      readonly actor: ActorReference;
      readonly provenance: Provenance;
    };
export interface Suppressed extends ConditionInstance {
  readonly type: 'Suppressed';
  readonly stackingRule: 'REJECT';
  readonly attackId: string;
  readonly originalFailureDegrees: number;
  readonly firstAffectedTurn: number | null;
  readonly lastRemovalTurn: number | null;
}
export interface SuppressionEquipmentState {
  readonly combat: CombatActionState;
  readonly equipment: readonly EquipmentInstance[];
  readonly suppressed: readonly Suppressed[];
  readonly processedEventIds: readonly string[];
}
export interface SuppressionTargetResult {
  readonly actor: ActorReference;
  readonly status: 'NOT_AFFECTED' | 'IMMUNE' | 'PASSED' | 'SUPPRESSED' | 'PENDING';
  readonly penaltyBasis: number | null;
  readonly modifier: number | null;
  readonly check: CheckResult | null;
  readonly condition: Suppressed | null;
  readonly response: SuppressionResponse | null;
  readonly equipment: readonly EquipmentTrace[];
  readonly pending: readonly (SuppressionPending | EquipmentPending)[];
}
export interface SuppressionResolution {
  readonly state: SuppressionEquipmentState;
  readonly status: 'RESOLVED' | 'PENDING';
  readonly event: SuppressionEvent;
  readonly targets: readonly SuppressionTargetResult[];
  readonly logs: readonly CombatLogEntry[];
}
/** Adapts accepted ranged output; never changes ammunition or attack state. */
export interface SuppressionAttackSource {
  readonly attackId: string;
  readonly sourceActor: ActorReference;
  readonly primaryTarget: ActorReference;
  readonly weapon: SourceReference;
  readonly weaponClass: SuppressionWeaponClass;
  readonly result: RangedAttackResult;
  readonly provenance: Provenance;
}

export interface SuppressionImmunityRemovalPending {
  readonly type: 'SuppressionImmunityRemovalPending';
  readonly actor: ActorReference;
  readonly conditionId: string;
  readonly effectIds: readonly string[];
  readonly provenance: readonly Provenance[];
}
