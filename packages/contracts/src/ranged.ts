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
}
