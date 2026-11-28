// Author rulings of 22.11.2026 applied in step 1 (see ВОПРОСЫ-ПО-ПРАВИЛАМ.md).
// Each test names the canonical cell and the ruling number.
import { describe, expect, test } from 'vitest';
import type { CombatActionState, EffectInstance } from '@kadat/contracts';
import {
  changeMeleeStanceGrip,
  createSequenceDice,
  effectiveMovement,
  opposedMeleeCheck,
  resolveCheck,
  resolveCombatAction,
} from '../src/index.js';
import { action, b1State, dice } from './b1-fixtures.js';
import { meleeState } from './b2-fixtures.js';
import { context, provenance } from './fixtures.js';
import { woundEffect } from '../src/wound-state.js';

const ctx = (actorId: string) => context({ actor: { actorId } });
const withActor = (
  state: CombatActionState,
  id: string,
  patch: Partial<CombatActionState['actors'][string]>,
): CombatActionState => ({
  ...state,
  actors: { ...state.actors, [id]: { ...state.actors[id]!, ...patch } },
});
const movementEffect = (value: number, actorId = 'A'): EffectInstance =>
  woundEffect(`wound:${value}`, { actorId }, 'movement', value, provenance);

describe('Super-characteristic — «Общая механика» C5, ruling 18', () => {
  test('+1 degree only for each full 2: Super 1 → 0, Super 3 → +1', () => {
    const roll = (finalSuper: number) =>
      resolveCheck(
        { baseValue: 50, finalSuper, context: context() },
        dice({ sides: 100, value: 45 }),
      ).result.superDegrees;
    expect(roll(1)).toBe(0);
    expect(roll(2)).toBe(1);
    expect(roll(3)).toBe(1);
    expect(roll(4)).toBe(2);
  });
});

describe('Opposed test — «Общая механика» C5, ruling 22', () => {
  const opposed = (state: CombatActionState, a: number, b: number) =>
    opposedMeleeCheck(
      state,
      { actorId: 'A' },
      { actorId: 'B' },
      'НР',
      ctx('A'),
      ctx('B'),
      createSequenceDice([a, b].map((value) => ({ sides: 100, value }))),
    ).result;

  test('equal degrees: the higher characteristic bonus wins', () => {
    let state = meleeState(50);
    state = withActor(state, 'B', {
      characteristics: { ...state.actors.B!.characteristics, НР: { baseValue: 59, baseSuper: 0 } },
    });
    // A: 50 vs 41 → 1 degree; B: 59 vs 50 → 1 degree. Bonus 5 vs 5 → tie, nobody.
    expect(opposed(state, 41, 50).winner).toBeNull();
    state = withActor(state, 'B', {
      characteristics: { ...state.actors.B!.characteristics, НР: { baseValue: 60, baseSuper: 0 } },
    });
    // B: 60 vs 51 → 1 degree, bonus 6 > 5.
    const r = opposed(state, 41, 51);
    expect(r.winner?.actorId).toBe('B');
    expect(r.decidedBy).toBe('characteristic-bonus');
  });

  test('both failed: nobody wins', () => {
    const r = opposed(meleeState(50), 90, 91);
    expect(r.winner).toBeNull();
    expect(r.decidedBy).toBe('none');
  });

  test('a Super loser against a non-Super winner: higher threshold wins with 1 degree', () => {
    let state = meleeState(30);
    state = withActor(state, 'A', {
      characteristics: { ...state.actors.A!.characteristics, НР: { baseValue: 60, baseSuper: 2 } },
    });
    // A: 60 vs 55 → 1 + Super 1 = 2 degrees; B: 30 vs 1 → 3 degrees. B wins on degrees,
    // but A (Super) lost to B (no Super): degrees equal, A's threshold 60 > 30 → A wins with 1.
    const r = opposed(state, 55, 1);
    expect(r.winner?.actorId).toBe('A');
    expect(r.decidedBy).toBe('super-threshold');
    expect(r.winnerDegrees).toBe(1);
  });
});

describe('Single Free Action per turn — «Бой» A5 «2 ОД + СД», ruling 24', () => {
  test('Free Movement then lying down in the same turn is refused', () => {
    const moved = resolveCombatAction(b1State(), action('fm', 'free-move'), dice()).state;
    expect(() => resolveCombatAction(moved, action('down', 'prone'), dice())).toThrow(
      /Free Action already used/,
    );
  });
  test('a generic free action (a door) also takes the turn’s Free Action', () => {
    const door = resolveCombatAction(b1State(), action('door', 'free-action'), dice()).state;
    expect(() => resolveCombatAction(door, action('fm', 'free-move'), dice())).toThrow(
      /Free Action already used/,
    );
  });
  test('changing stance or grip uses the Free Action too', () => {
    const moved = resolveCombatAction(meleeState(), action('fm', 'free-move'), dice()).state;
    expect(() =>
      changeMeleeStanceGrip(moved, {
        ...action('stance', 'change-stance-grip'),
        type: 'change-stance-grip',
        stance: 'defensive',
      }),
    ).toThrow(/Free Action already used/);
  });
  test('OD actions do not use the Free Action', () => {
    const half = resolveCombatAction(b1State(), action('h', 'half-move'), dice()).state;
    expect(() => resolveCombatAction(half, action('fm', 'free-move'), dice())).not.toThrow();
  });
});

describe('Movement with wounds and crawling — «Раны и лечение» A9, A14; rulings 4, 15, 25', () => {
  test('a wound penalty is subtracted from СКР before the multiplier', () => {
    const state = withActor(b1State(), 'A', { movement: 5, effects: [movementEffect(-1)] });
    expect(resolveCombatAction(state, action('f', 'full-move'), dice()).result).toMatchObject({
      distance: 8,
    });
  });
  test('prone: the same actions from СКР / 2; no Run or Sprint', () => {
    const state = withActor(b1State(), 'A', { movement: 5, posture: 'prone' });
    expect(effectiveMovement(state.actors.A!)).toMatchObject({ value: 2.5, crawling: true });
    expect(resolveCombatAction(state, action('h', 'half-move'), dice()).result).toMatchObject({
      distance: 2.5,
    });
    expect(() => resolveCombatAction(state, action('r', 'run'), dice())).toThrow(/crawling/);
  });
  test('penalty first, then halving once: СКР 5, −1 → 2 m', () => {
    const state = withActor(b1State(), 'A', {
      movement: 5,
      posture: 'prone',
      effects: [movementEffect(-1)],
    });
    expect(effectiveMovement(state.actors.A!).value).toBe(2);
  });
  test('СКР 0 or less counts as 0.5 m («Общая механика» A25)', () => {
    const state = withActor(b1State(), 'A', { movement: 1, effects: [movementEffect(-3)] });
    expect(effectiveMovement(state.actors.A!).value).toBe(0.5);
  });
  test('Free Movement rounds up: СКР 5 → 3 m, at most 5 m', () => {
    const five = withActor(b1State(), 'A', { movement: 5 });
    expect(resolveCombatAction(five, action('f', 'free-move'), dice()).result).toMatchObject({
      distance: 3,
    });
    const twelve = withActor(b1State(), 'A', { movement: 12 });
    expect(resolveCombatAction(twelve, action('f', 'free-move'), dice()).result).toMatchObject({
      distance: 5,
    });
  });
});

describe('Sprint fatigue — «Бой» A46, talent «Спринт», ruling 26', () => {
  test('2 Fatigue without the talent, 1 with it', () => {
    expect(resolveCombatAction(b1State(), action('s', 'sprint'), dice()).result).toMatchObject({
      fatigueAdded: 2,
    });
    const talented = withActor(b1State(), 'A', { talents: ['Спринт'] });
    expect(resolveCombatAction(talented, action('s', 'sprint'), dice()).result).toMatchObject({
      fatigueAdded: 1,
    });
  });
});
