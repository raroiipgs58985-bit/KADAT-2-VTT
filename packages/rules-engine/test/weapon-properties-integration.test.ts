import { expect, test } from 'vitest';
import type { CombatActionState, DiceSource, WeaponTraitReference } from '@kadat/contracts';
import { resolveCombatAction, resolveRangedAttack } from '../src/index.js';
import { action, attack, b1State } from './b1-fixtures.js';

/** d100 from the list, every other die 1 (hit sides are not under test here). */
const d100 = (...values: number[]): DiceSource => {
  const queue = [...values];
  return { roll: (sides) => (sides === 100 ? queue.shift()! : 1) };
};
function withTraits(traits: WeaponTraitReference[], ns = 40): CombatActionState {
  const state = b1State(ns);
  const gun = state.weapons['gun:A']!;
  return {
    ...state,
    weapons: { ...state.weapons, 'gun:A': { ...gun, template: { ...gun.template, traits } } },
  };
}

test('Шторм (2): long burst, 3 degrees → 3 + 2×3 = 9 hits, ammo ×2 (rulings 66, 70)', () => {
  // НС 40, full auto −10 → target 30; roll 1 → 3 degrees.
  const r = resolveRangedAttack(
    withTraits([{ name: 'Шторм', value: 2 }]),
    attack('storm', { mode: 'full-auto', shotsRequested: 10 }),
    d100(1),
  );
  expect(r.result.check.totalDegrees).toBe(3);
  expect(r.result.hitsGenerated).toBe(9);
  expect(r.result.ammoSpent).toBe(20);
  expect(r.state.containers['mag:A']?.currentRounds).toBe(10);
});

test('Шторм never gives more hits than the declared rate', () => {
  const r = resolveRangedAttack(
    withTraits([{ name: 'Шторм', value: 2 }], 60),
    attack('storm', { mode: 'full-auto', shotsRequested: 6 }),
    d100(1),
  );
  expect(r.result.hitsGenerated).toBe(6);
});

test('Шторм needs the multiplied ammunition in the magazine', () => {
  expect(() =>
    resolveRangedAttack(
      withTraits([{ name: 'Шторм', value: 3 }]),
      attack('storm', { mode: 'full-auto', shotsRequested: 12 }),
      d100(1),
    ),
  ).toThrow(/Insufficient ammunition/);
});

test('Надежное jams only on 100, Ненадежное from 81 (ruling 69)', () => {
  const shoot = (traits: WeaponTraitReference[], roll: number) =>
    resolveRangedAttack(withTraits(traits, 90), attack(), d100(roll)).result.malfunction;
  expect(shoot([], 96)).toBe(true);
  expect(shoot([{ name: 'Надежное' }], 99)).toBe(false);
  expect(shoot([{ name: 'Надежное' }], 100)).toBe(true);
  expect(shoot([{ name: 'Ненадежное' }], 81)).toBe(true);
  expect(shoot([{ name: 'Ненадежное' }], 80)).toBe(false);
});

test('Меткое adds +10 to an aimed single shot; Неточное removes the aim bonus', () => {
  const aimedTarget = (traits: WeaponTraitReference[]) => {
    const aimed = resolveCombatAction(withTraits(traits), action('aim', 'quick-aim'), d100()).state;
    return resolveRangedAttack(aimed, attack(), d100(50)).result.check.target;
  };
  // НС 40 + single +10 + quick aim +10 = 60.
  expect(aimedTarget([])).toBe(60);
  expect(aimedTarget([{ name: 'Меткое' }])).toBe(70);
  expect(aimedTarget([{ name: 'Неточное' }])).toBe(50);
});

test('«Бугрящиеся бицепсы»: a heavy weapon fires bursts from the hands without −30', () => {
  const base = b1State(40);
  const gun = base.weapons['gun:A']!;
  const heavy = {
    ...base,
    weapons: {
      ...base.weapons,
      'gun:A': {
        ...gun,
        template: { ...gun.template, profile: { ...gun.template.profile, weaponClass: 'ТО' } },
      },
    },
  };
  const burst = attack('heavy', { mode: 'short-burst', shotsRequested: 3 });
  expect(() => resolveRangedAttack(heavy, burst, d100(50))).toThrow(/Unbraced/);
  const single = resolveRangedAttack(heavy, attack('one'), d100(50));
  expect(single.result.check.modifiers.some((m) => m.id === 'ranged:unbraced-heavy')).toBe(true);
  const strong = {
    ...heavy,
    actors: {
      ...heavy.actors,
      A: { ...heavy.actors.A!, talents: ['Бугрящиеся бицепсы'] },
    },
  };
  const r = resolveRangedAttack(strong, burst, d100(50));
  expect(r.result.shotsFired).toBe(3);
  expect(r.result.check.modifiers.some((m) => m.id === 'ranged:unbraced-heavy')).toBe(false);
});
