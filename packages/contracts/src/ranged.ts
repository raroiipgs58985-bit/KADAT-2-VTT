import type { ActionRequest, AimState } from './actions.js';
import type { CheckResult } from './checks.js';
import type { DiceRoll } from './dice.js';
import type { ActorReference, Provenance, SourceReference } from './identity.js';
import type { ResolutionContext } from './resolution.js';
import type { DamageProfileReference, FireMode, PenetrationReference } from './weapons.js';

export type BodyLocation =
  'Eyes' | 'Head' | 'Right Arm' | 'Left Arm' | 'Torso' | 'Right Leg' | 'Left Leg';
export type CalledLocation = BodyLocation | 'Armor Joints';
export type HitGroup = 'Head' | 'Arm' | 'Torso' | 'Leg';
export type RangeBand = 'point-blank' | 'short' | 'optimal' | 'long' | 'extreme';

export interface RangeResult {
  readonly distance: number;
  readonly optimal: number;
  readonly band: RangeBand;
  readonly modifier: number;
}

export interface RangedAttackRequest extends ActionRequest {
  readonly type: 'ranged-attack' | 'called-attack';
  readonly target: ActorReference;
  readonly weaponId: string;
  readonly mode: FireMode;
  readonly shotsRequested: number;
  readonly distance: number;
  readonly calledLocation?: CalledLocation;
  readonly dodgeable: boolean;
  readonly dodge?: { readonly id: string; readonly context: ResolutionContext };
  /** Basic (ОС) weapon held in one hand: −20 («Бой» A31). */
  readonly oneHanded?: boolean;
  /** Extra degrees of success for burst hits (talent «Шквал лазогня»). */
  readonly bonusDegrees?: number;
  /**
   * Tactical advance («Бой» A62): 2 ОД, movement in a mode other than Run/Sprint plus the shot;
   * НС +0 step (Полудвижение), −10 fast step (Полное), −20 charge (Натиск, СКР × 3).
   */
  readonly tacticalAdvance?: { readonly movementMode: 'half-move' | 'full-move' | 'charge' };
  /**
   * Wide arc («Бой» A61): burst with rate −2 (ammo unchanged), dodge −20, 45° sector. One test
   * per target (ruling 39): the first target pays OD and ammo; each next one names `primaryId`.
   */
  readonly wideArc?: { readonly primaryId?: string };
  /**
   * Two weapons («Бой» H52–L56): one attack action, one roll per weapon (ruling 40); −30 without
   * the talent «Парное оружие (Стрелковое)». The second weapon's shot names `primaryId`.
   */
  readonly dualWield?: { readonly primaryId?: string };
}

export interface HitLocationResult {
  readonly ordinal: number;
  readonly location: CalledLocation;
  readonly sequenceGroup?: HitGroup;
  readonly secondarySide?: { readonly roll: DiceRoll; readonly side: 'Left' | 'Right' };
}

export interface HitRecord extends HitLocationResult {
  readonly id: string;
  readonly attackId: string;
  readonly attacker: ActorReference;
  readonly target: ActorReference;
  readonly weaponInstanceId: string;
  readonly weaponTemplate: SourceReference;
  readonly ammo: SourceReference;
  readonly sourceAttackRoll: number;
  readonly degrees: Pick<CheckResult, 'baseDegrees' | 'superDegrees' | 'totalDegrees'>;
  readonly mode: FireMode;
  readonly called: boolean;
  readonly unresolvedDamage: DamageProfileReference;
  readonly unresolvedPenetration: PenetrationReference;
  readonly context: ResolutionContext;
  readonly provenance: readonly Provenance[];
}

export interface DodgeResult {
  readonly check: CheckResult;
  readonly generatedHits: number;
  readonly dodgeDegrees: number;
  readonly cancelledHits: number;
  readonly survivingHits: number;
}

export interface RangedAttackResult {
  readonly weaponInstanceId: string;
  readonly ammoContainerId: string;
  readonly ammo: SourceReference;
  readonly check: CheckResult;
  readonly range: RangeResult;
  readonly mode: FireMode;
  readonly modeModifier: number;
  readonly aim: AimState | null;
  readonly shotsRequested: number;
  readonly shotsFired: number;
  readonly ammoSpent: number;
  readonly malfunction: boolean;
  readonly jammed: boolean;
  readonly hitsGenerated: number;
  readonly dodge: DodgeResult | null;
  readonly cancelledHits: number;
  readonly survivingHits: number;
  readonly firstLocation: CalledLocation | null;
  readonly reversedRoll: number | null;
  readonly hits: readonly HitRecord[];
  /** Metres moved by a tactical advance before the shot. */
  readonly movementDistance?: number;
}
