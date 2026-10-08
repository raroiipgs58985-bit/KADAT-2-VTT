import type {
  BodyLocation,
  CalledLocation,
  DiceSource,
  HitGroup,
  HitLocationResult,
} from '@kadat/contracts';
import { rollDie } from './dice.js';
import { integer } from './validation.js';

const sequences: Readonly<Record<HitGroup, readonly HitGroup[]>> = {
  Head: ['Head', 'Arm', 'Torso', 'Arm', 'Torso'],
  Arm: ['Arm', 'Torso', 'Head', 'Torso', 'Arm'],
  Torso: ['Torso', 'Arm', 'Head', 'Arm', 'Torso'],
  Leg: ['Leg', 'Torso', 'Arm', 'Head', 'Torso'],
};

export const calledModifiers: Readonly<Record<CalledLocation, number>> = Object.freeze({
  Eyes: -50,
  Head: -20,
  'Right Arm': -20,
  'Left Arm': -20,
  Torso: -10,
  'Right Leg': -15,
  'Left Leg': -15,
  'Armor Joints': -40,
});

export function reverseAttackRoll(rawRoll: number): number {
  integer(rawRoll, 'raw attack roll', 1);
  // 100 is always critical failure and cannot produce an ordinary first hit.
  if (rawRoll >= 100)
    throw new Error('No ordinary first-hit location for critical-failure roll 100');
  return (rawRoll % 10) * 10 + Math.floor(rawRoll / 10);
}

export function firstHitLocation(rawRoll: number): BodyLocation {
  const roll = reverseAttackRoll(rawRoll);
  return roll <= 3
    ? 'Eyes'
    : roll <= 10
      ? 'Head'
      : roll <= 20
        ? 'Right Arm'
        : roll <= 30
          ? 'Left Arm'
          : roll <= 70
            ? 'Torso'
            : roll <= 85
              ? 'Right Leg'
              : 'Left Leg';
}

function coarse(location: BodyLocation): HitGroup {
  return location === 'Eyes' || location === 'Head'
    ? 'Head'
    : location.includes('Arm')
      ? 'Arm'
      : location.includes('Leg')
        ? 'Leg'
        : 'Torso';
}

export function resolveHitLocations(
  rawRoll: number,
  hits: number,
  source: DiceSource,
  called?: CalledLocation,
): readonly HitLocationResult[] {
  integer(hits, 'surviving hits', 0);
  if (hits === 0) return [];
  if (called) {
    if (!(called in calledModifiers) || hits !== 1)
      throw new Error('Called attack requires one selected hit');
    return [{ ordinal: 1, location: called }];
  }
  const first = firstHitLocation(rawRoll);
  const group = coarse(first);
  return Array.from({ length: hits }, (_, index): HitLocationResult => {
    if (index === 0) return { ordinal: 1, location: first };
    const secondary = sequences[group][(index - 1) % 5];
    if (!secondary) throw new Error('Missing canonical sequence entry');
    if (secondary === 'Arm' || secondary === 'Leg') {
      const roll = rollDie(2, source);
      const side = roll.value === 1 ? 'Left' : 'Right';
      const location: BodyLocation =
        secondary === 'Arm'
          ? side === 'Left'
            ? 'Left Arm'
            : 'Right Arm'
          : side === 'Left'
            ? 'Left Leg'
            : 'Right Leg';
      return {
        ordinal: index + 1,
        location,
        sequenceGroup: secondary,
        secondarySide: { roll, side },
      };
    }
    return { ordinal: index + 1, location: secondary, sequenceGroup: secondary };
  });
}
