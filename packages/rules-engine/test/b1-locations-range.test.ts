import { expect, test } from 'vitest';
import {
  firstHitLocation,
  resolveHitLocations,
  resolveRange,
  reverseAttackRoll,
  resolveCheck,
} from '../src/index.js';
import { context, modifier } from './fixtures.js';
import { dice } from './b1-fixtures.js';

test.each([
  [3, 'point-blank', 30],
  [3.01, 'short', 10],
  [50, 'short', 10],
  [50.01, 'optimal', 0],
  [200, 'optimal', 0],
  [200.01, 'long', -10],
  [400, 'long', -10],
  [400.01, 'extreme', -30],
])('range distance %s uses %s (%s)', (distance, band, value) => {
  expect(resolveRange(distance as number, 100)).toMatchObject({ band, modifier: value });
});

test.each([
  [-1, 100],
  [0.49, 100],
  [NaN, 100],
  [Infinity, 100],
  [10, 0],
  [10, -1],
  [10, NaN],
])('invalid range %s/%s', (distance, optimal) => {
  expect(() => resolveRange(distance, optimal)).toThrow('Invalid range');
});

test.each([
  [57, 75, 'Right Leg'],
  [28, 82, 'Right Leg'],
  [3, 30, 'Left Arm'],
  [41, 14, 'Right Arm'],
  [10, 1, 'Eyes'],
  [80, 8, 'Head'],
  [92, 29, 'Left Arm'],
  [14, 41, 'Torso'],
  [29, 92, 'Left Leg'],
])('raw %s reversal %s location %s', (raw, reversed, location) => {
  expect(reverseAttackRoll(raw as number)).toBe(reversed);
  expect(firstHitLocation(raw as number)).toBe(location);
});

test.each([
  [80, ['Head', 'Head', 'Left Arm', 'Torso', 'Left Arm', 'Torso']],
  [41, ['Right Arm', 'Left Arm', 'Torso', 'Head', 'Torso', 'Left Arm']],
  [14, ['Torso', 'Torso', 'Left Arm', 'Head', 'Left Arm', 'Torso']],
  [28, ['Right Leg', 'Left Leg', 'Torso', 'Left Arm', 'Head', 'Torso']],
  [10, ['Eyes', 'Head', 'Left Arm', 'Torso', 'Left Arm', 'Torso']],
])('sequence for raw %s including Eyes-as-Head', (raw, expected) => {
  const source = dice(...Array.from({ length: 2 }, () => ({ sides: 2, value: 1 })));
  expect(resolveHitLocations(raw as number, 6, source).map((hit) => hit.location)).toEqual(
    expected,
  );
});

test('secondary sequence cycles through hits 7–12 without new location d100s', () => {
  const hits = resolveHitLocations(
    14,
    12,
    dice(...Array.from({ length: 4 }, () => ({ sides: 2, value: 1 }))),
  );
  for (let ordinal = 7; ordinal <= 11; ordinal += 1) {
    expect(hits[ordinal - 1]?.location).toBe(hits[ordinal - 6]?.location);
  }
  expect(hits[11]?.location).toBe(hits[1]?.location);
});

test.each([
  [41, 1, 'Left Arm'],
  [41, 2, 'Right Arm'],
  [28, 1, 'Left Leg'],
  [28, 2, 'Right Leg'],
])('secondary side raw=%s injected d2=%s → %s', (raw, value, location) => {
  const hits = resolveHitLocations(raw as number, 2, dice({ sides: 2, value: value as number }));
  expect(hits[1]).toMatchObject({ location, secondarySide: { roll: { sides: 2, value } } });
});

test.each([
  [-20, 3, 4],
  [0, 5, 4],
  [2, 3, 4],
  [4, 5, 0],
])('critical rescue target %s roll %s ignores Super %s', (target, roll, finalSuper) => {
  const { result } = resolveCheck(
    {
      baseValue: 20,
      finalSuper,
      context: context({ modifiers: [modifier('delta', target - 20)] }),
    },
    dice({ sides: 100, value: roll }),
  );
  expect(result).toMatchObject({
    target,
    criticalBand: 'success',
    outcome: 'success',
    baseDegrees: 1,
    superDegrees: 0,
    totalDegrees: 1,
  });
});

test('critical success satisfying the ordinary target retains ordinary/Super degrees', () => {
  const { result } = resolveCheck(
    { baseValue: 50, finalSuper: 4, context: context() },
    dice({ sides: 100, value: 3 }),
  );
  expect(result).toMatchObject({ baseDegrees: 5, superDegrees: 2, totalDegrees: 7 });
});
