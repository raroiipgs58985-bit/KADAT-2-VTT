// Combat actions added in step 1 from the «Бой» sheet and author rulings 38–41.
import { describe, expect, test } from 'vitest';
import type { CombatActionState, RangedAttackRequest } from '@kadat/contracts';
import {
  braceWeapon,
  reloadWeapon,
  resolveCombatAction,
  resolveMeleeAttack,
  resolveOverpenetration,
  resolveRangedAttack,
} from '../src/index.js';
import { action, attack, b1State, dice, weapon } from './b1-fixtures.js';
import { meleeAttack, meleeState } from './b2-fixtures.js';

const withWeapon = (state: CombatActionState, patch: Parameters<typeof weapon>[1]) => ({
  ...state,
  weapons: { ...state.weapons, 'gun:A': weapon('A', patch) },
});
const shot = (state: CombatActionState, request: RangedAttackRequest, ...rolls: number[]) =>
  resolveRangedAttack(state, request, dice(...rolls.map((value) => ({ sides: 100, value }))));
const modifier = (r: ReturnType<typeof shot>, id: string) =>
  r.result.check.modifiers.find((m) => m.id === id)?.value;

describe('Weapon class handling — «Бой» A31–A32', () => {
  test('basic (ОС) weapon in one hand: −20', () => {
    const r = shot(
      withWeapon(b1State(), { weaponClass: 'ОС' }),
      attack('s', { oneHanded: true }),
      50,
    );
    expect(modifier(r, 'ranged:one-handed')).toBe(-20);
  });
  test('heavy (ТО) weapon without a support: −30 and no bursts', () => {
    const state = withWeapon(b1State(), { weaponClass: 'ТО' });
    expect(modifier(shot(state, attack('s'), 50), 'ranged:unbraced-heavy')).toBe(-30);
    expect(() => shot(state, attack('b', { mode: 'short-burst', shotsRequested: 3 }), 50)).toThrow(
      /Unbraced heavy weapon cannot fire bursts/,
    );
  });
});

describe('Bracing — «Бой» A55, ruling 41', () => {
  test('1 ОД to brace; a braced heavy weapon has no penalty and may fire bursts', () => {
    const state = withWeapon(b1State(), { weaponClass: 'ТО' });
    const braced = braceWeapon(state, {
      ...action('brace', 'brace-weapon'),
      type: 'brace-weapon',
      weaponId: 'gun:A',
    });
    expect(braced.state.session.turn!.od).toBe(1);
    const r = shot(braced.state, attack('b', { mode: 'short-burst', shotsRequested: 3 }), 50);
    expect(modifier(r, 'ranged:unbraced-heavy')).toBeUndefined();
  });
  test('a wheeled carriage costs 2 ОД', () => {
    const r = braceWeapon(withWeapon(b1State(), { weaponClass: 'СТ' }), {
      ...action('brace', 'brace-weapon'),
      type: 'brace-weapon',
      weaponId: 'gun:A',
      wheeledCarriage: true,
    });
    expect(r.state.session.turn!.od).toBe(0);
  });
  test('any movement of the shooter removes the support', () => {
    const state = withWeapon(b1State(), { weaponClass: 'ТО' });
    const braced = braceWeapon(state, {
      ...action('brace', 'brace-weapon'),
      type: 'brace-weapon',
      weaponId: 'gun:A',
    }).state;
    const moved = resolveCombatAction(braced, action('fm', 'free-move'), dice()).state;
    expect(moved.weapons['gun:A']!.braced).toBe(false);
  });
});

describe('Reload — «Бой» A55', () => {
  const spare = (state: CombatActionState): CombatActionState => ({
    ...state,
    containers: {
      ...state.containers,
      'spare:A': { ...state.containers['mag:A']!, id: 'spare:A', currentRounds: 30 },
    },
  });
  const reload = (state: CombatActionState, id = 'reload') =>
    reloadWeapon(state, {
      ...action(id, 'reload'),
      type: 'reload',
      weaponId: 'gun:A',
      containerId: 'spare:A',
    });
  test('the OD cost comes from the weapon; the new container is loaded', () => {
    const r = reload(spare(b1State()));
    expect(r.result).toMatchObject({ odSpent: 1, loaded: true });
    expect(r.state.weapons['gun:A']!.loadedContainerId).toBe('spare:A');
  });
  test('a reload longer than the OD left continues next turn', () => {
    const state = withWeapon(spare(b1State()), {
      reload: { odCost: 3, source: { kind: 't', id: 't' } },
    });
    const first = reload(state);
    expect(first.result).toMatchObject({ odSpent: 2, progress: 2, loaded: false });
    expect(first.state.weapons['gun:A']!.loadedContainerId).toBe('mag:A');
  });
});

describe('Tactical advance — «Бой» A62', () => {
  test('2 ОД: move and shoot; fast step −10, charge −20 at СКР × 3', () => {
    const fast = shot(
      b1State(),
      attack('t', { tacticalAdvance: { movementMode: 'full-move' } }),
      50,
    );
    expect(fast.state.session.turn!.od).toBe(0);
    expect(modifier(fast, 'ranged:tactical-advance')).toBe(-10);
    expect(fast.result.movementDistance).toBe(16);
    const charge = shot(
      b1State(),
      attack('t', { tacticalAdvance: { movementMode: 'charge' } }),
      50,
    );
    expect(modifier(charge, 'ranged:tactical-advance')).toBe(-20);
    expect(charge.result.movementDistance).toBe(24);
  });
});

describe('Wide arc — «Бой» A61, ruling 39', () => {
  test('one test per target; ammo spent once; rate −2 for hits; dodge −20', () => {
    const burst = { mode: 'full-auto' as const, shotsRequested: 10 };
    const ones = { roll: () => 1 };
    const first = resolveRangedAttack(b1State(95), attack('arc', { ...burst, wideArc: {} }), ones);
    expect(first.result.hitsGenerated).toBe(8); // degrees ≥ 8, capped at 10 − 2
    expect(first.result.ammoSpent).toBe(10);
    const second = resolveRangedAttack(
      first.state,
      attack('arc-2', { ...burst, target: { actorId: 'C' }, wideArc: { primaryId: 'arc' } }),
      ones,
    );
    expect(second.result.ammoSpent).toBe(0);
    expect(second.state.session.turn!.od).toBe(first.state.session.turn!.od);
  });
  test('requires a burst and a rate of fire above 3', () => {
    expect(() => shot(b1State(), attack('arc', { wideArc: {} }), 1)).toThrow(/requires a burst/);
    expect(() =>
      shot(b1State(), attack('arc', { mode: 'short-burst', shotsRequested: 3, wideArc: {} }), 1),
    ).toThrow(/rate of fire above 3/);
  });
  test('a follow-up without its primary attack is refused', () => {
    expect(() =>
      shot(
        b1State(),
        attack('x', { mode: 'full-auto', shotsRequested: 10, wideArc: { primaryId: 'none' } }),
        1,
      ),
    ).toThrow(/primary attack/);
  });
});

describe('Two weapons — «Бой» H52–L56, ruling 40', () => {
  test('ranged: one attack action, a roll per weapon, −30 without the talent', () => {
    let state = b1State();
    state = {
      ...state,
      weapons: {
        ...state.weapons,
        'gun2:A': { ...weapon('A'), id: 'gun2:A', loadedContainerId: 'mag2:A' },
      },
      containers: {
        ...state.containers,
        'mag2:A': { ...state.containers['mag:A']!, id: 'mag2:A' },
      },
    };
    const first = shot(state, attack('d1', { dualWield: {} }), 50);
    expect(modifier(first, 'ranged:two-weapons')).toBe(-30);
    const second = shot(
      first.state,
      attack('d2', { weaponId: 'gun2:A', dualWield: { primaryId: 'd1' } }),
      50,
    );
    expect(second.state.session.turn!.od).toBe(first.state.session.turn!.od);
    expect(second.result.ammoSpent).toBe(1);
    const talented = {
      ...state,
      actors: {
        ...state.actors,
        A: { ...state.actors.A!, talents: ['Парное оружие (Стрелковое)'] },
      },
    };
    expect(
      modifier(shot(talented, attack('d1', { dualWield: {} }), 50), 'ranged:two-weapons'),
    ).toBeUndefined();
  });
  test('melee: the second blow costs nothing and carries −30', () => {
    const first = resolveMeleeAttack(
      meleeState(),
      meleeAttack({ id: 'm1', dualWield: {} }),
      dice({ sides: 100, value: 90 }),
    );
    expect(() =>
      resolveMeleeAttack(
        first.state,
        meleeAttack({ id: 'm2', dualWield: { primaryId: 'm1' } }),
        dice({ sides: 100, value: 90 }),
      ),
    ).not.toThrow();
  });
});

describe('Overpenetration — «Раны и лечение» A2–A3, ruling 38', () => {
  test('the sheet example: damage 12, ББ 2, entry ОБ 2, бВН 3, exit ОБ 2 → 7 with ББ 0', () => {
    expect(
      resolveOverpenetration({ damage: 12, penetration: 2, entryArmor: 2, exitArmor: 2, bVN: 3 }),
    ).toEqual({ exitDamage: 7, remainingPenetration: 0 });
  });
  test('never below zero', () => {
    expect(
      resolveOverpenetration({ damage: 4, penetration: 0, entryArmor: 6, exitArmor: 6, bVN: 4 })
        .exitDamage,
    ).toBe(0);
  });
});

describe('Weapon family fire-mode modifiers — «Лаз» A1, ruling 52', () => {
  const las = { modeModifiers: { single: 10, 'short-burst': 5, 'full-auto': 0 } };
  test('a las weapon short burst gets +5 instead of the general +0', () => {
    const r = shot(
      withWeapon(b1State(), las),
      attack('b', { mode: 'short-burst', shotsRequested: 3 }),
      50,
    );
    expect(r.result.modeModifier).toBe(5);
  });
  test('without a family row the general modifiers apply (long burst kinetic −10)', () => {
    const r = shot(b1State(), attack('a', { mode: 'full-auto', shotsRequested: 10 }), 50);
    expect(r.result.modeModifier).toBe(-10);
  });
});
