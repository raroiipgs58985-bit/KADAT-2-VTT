import type { DiceExpression } from './dice.js';
import type {
  ActorReference,
  CanonicalReference,
  Provenance,
  SourceReference,
} from './identity.js';
import type { EffectDefinition, EffectInstance } from './resolution.js';

export type FireMode = 'single' | 'short-burst' | 'full-auto';

export interface DamageProfileReference {
  readonly source: SourceReference;
  readonly expression: DiceExpression;
}

export interface PenetrationReference {
  readonly source: SourceReference;
  readonly value: number;
}

export interface RangedWeaponProfile {
  readonly weaponClass: string;
  readonly optimalRange: number;
  readonly classification: 'kinetic' | 'energy-beam';
  readonly modes: readonly { readonly mode: FireMode; readonly maxShots: number }[];
  readonly damage: DamageProfileReference;
  readonly penetration: PenetrationReference;
  readonly compatibleAmmoTypes: readonly string[];
  readonly compatibleContainerTypes: readonly string[];
  readonly capacityReference: SourceReference;
  readonly reload: { readonly odCost: number; readonly source: SourceReference };
  readonly malfunction: 'generic-jam' | 'external-property';
}

export interface WeaponPropertyReference {
  readonly kind: 'reliable' | 'unreliable' | 'overheat' | 'other';
  readonly source: SourceReference;
}

export interface WeaponProfileContribution {
  readonly source: SourceReference;
  readonly provenance: Provenance;
  /** Authored replacements only; this is not a guessed combination algorithm. */
  readonly profile: Partial<RangedWeaponProfile>;
  readonly effects: readonly EffectDefinition[];
}

export interface WeaponTemplate {
  readonly id: string;
  readonly canonical: CanonicalReference;
  readonly profile: RangedWeaponProfile;
  readonly properties: readonly WeaponPropertyReference[];
  readonly effects: readonly EffectDefinition[];
  readonly provenance: Provenance;
}

export interface WeaponInstance {
  readonly id: string;
  readonly owner: ActorReference;
  readonly readied: boolean;
  readonly template: WeaponTemplate;
  readonly pattern?: WeaponProfileContribution;
  readonly modifications: readonly WeaponProfileContribution[];
  readonly loadedContainerId: string | null;
  readonly jammed: boolean;
  readonly thermal?: { readonly state: 'overheated' | 'cooling'; readonly source: SourceReference };
}

export interface AmmoReference {
  readonly source: SourceReference;
  readonly type: string;
  readonly contribution?: WeaponProfileContribution;
  readonly effects: readonly EffectDefinition[];
}

export interface AmmoContainerInstance {
  readonly id: string;
  readonly type: string;
  readonly compatibleWeaponTemplateIds: readonly string[];
  readonly capacity: number;
  readonly currentRounds: number;
  readonly ammo: AmmoReference;
  readonly state: 'ready' | 'unavailable';
  readonly provenance: Provenance;
}

export interface EffectiveRangedProfile {
  readonly profile: RangedWeaponProfile;
  readonly effects: readonly EffectInstance[];
  readonly provenance: readonly Provenance[];
}
