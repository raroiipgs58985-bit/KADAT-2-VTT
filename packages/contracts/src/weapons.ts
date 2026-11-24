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
  /**
   * Fire-mode modifiers of the weapon family from its Arsenal sheet header (e.g. «Лаз» A1:
   * single +10, short burst +5, long +0). They replace the general ones of «Бой» A58–A60
   * (author ruling 52). Absent — the general modifiers apply.
   */
  readonly modeModifiers?: Readonly<Partial<Record<FireMode, number>>>;
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

/** A weapon property of the Arsenal by its canonical name and rating «(Х)» (author ruling 50). */
export interface WeaponTraitReference {
  readonly name: string;
  readonly value?: number;
  /** A rating given as dice, e.g. «Огненное (2к10)». */
  readonly dice?: { readonly count: number; readonly sides: number };
  /** The second rating «Х/Y»: duration in rounds («Огненное (2к10/3)»). */
  readonly duration?: number;
}

export interface WeaponTemplate {
  readonly id: string;
  readonly canonical: CanonicalReference;
  readonly profile: RangedWeaponProfile;
  readonly properties: readonly WeaponPropertyReference[];
  /** Arsenal properties applied by the rules engine («Свойства оружия»). */
  readonly traits?: readonly WeaponTraitReference[];
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
  /** Dropped on the floor (ruling 81); picked up for СД or 1 ОД (ruling 82). */
  readonly dropped?: boolean;
  /** Hangs on a sling or chain after being let go (ruling 81). */
  readonly hanging?: boolean;
  /** Heavy weapon set on a support («Бой» A55); any movement of the owner removes it (ruling 41). */
  readonly braced?: boolean;
  /** Reload longer than the OD left this turn continues next turn. */
  readonly reloadProgress?: { readonly containerId: string; readonly odSpent: number };
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
