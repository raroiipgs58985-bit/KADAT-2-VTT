import { describe, expect, it } from 'vitest';
import type { DiceSource } from '@kadat/contracts';
import { createBattle, type Battle } from './model';
import {
  actorStatus,
  attack,
  fireChargeDestination,
  furiousOpen,
  getEngine,
  incapacity,
  nextTurn,
  resumeAttack,
  stabilizeTargets,
  startCombat,
  turnAction,
  turnInfo,
  type AttackCommand,
} from './engine';
import { fixedDice } from './dice';
import { emptyCharacter } from './character';
import { matchWeaponByName } from './arsenal';

/** Attack, answering every GM question with its first option (0). */
function run(b: Battle, cmd: AttackCommand, rng: DiceSource) {
  let r = attack(b, cmd, rng);
  for (let i = 0; i < 30 && r.status !== 'RESOLVED'; i++) {
    const q = turnInfo(b).pending?.question;
    if (!q) break;
    r = resumeAttack(b, rng, { [q.key]: q.options?.[0]?.value ?? 0 });
  }
  return r;
}
const chars = (patch: Partial<Record<'НС' | 'НР' | 'СЛ' | 'ЛВ' | 'ИН', number>>) => {
  const base = emptyCharacter('x').characteristics;
  const out = { ...base } as Record<string, { value: number; super: number }>;
  for (const [k, v] of Object.entries(patch)) out[k] = { value: v, super: 0 };
  return out as typeof base;
};
const soft = (id: string, wounds = 300) => ({
  ...emptyCharacter(id, id),
  wounds,
  armour: { head: 90, torso: 90, arms: 90, legs: 90 },
});
const cmd = (patch: Partial<AttackCommand>): AttackCommand => ({
  id: 'a1',
  actor: 'r',
  target: 't',
  weapon: 'r:0',
  targetActivity: 'REST',
  defense: 'DECLINE',
  ...patch,
});

describe('«Неистовый натиск» (ruling 157)', () => {
  const scene = (talents: string[]) => {
    const sword = matchWeaponByName('Цепной меч')!;
    const b = createBattle([
      {
        character: {
          ...emptyCharacter('r', 'Боец'),
          characteristics: chars({ НР: 50 }),
          talents: ['Владение оружием (Цепное)', ...talents],
          weapons: [{ name: sword.name, ref: sword.id }],
        },
        side: 'a',
        at: { x: 5.5, y: 10.5 },
        id: 'r',
      },
      { character: soft('t'), side: 'b', at: { x: 6.5, y: 10.5 }, id: 't' },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    return b;
  };
  it('a successful reckless attack opens one more for the reaction', () => {
    const b = scene(['Неистовый натиск']);
    const dice = { roll: (s: number) => (s === 100 ? 20 : 3) };
    run(b, cmd({ meleeBase: 'reckless' }), dice);
    const open = furiousOpen(b, 'r');
    expect(open?.id).toBe('a1');
    const od = turnInfo(b).od;
    const r = run(b, cmd({ id: 'a2', meleeBase: 'reckless', furious: 'a1' }), dice);
    expect(r.status).toBe('RESOLVED');
    expect(turnInfo(b).od).toBe(od);
    expect(furiousOpen(b, 'r')).toBeNull(); // the reaction is spent
    expect(() => run(b, cmd({ id: 'a3', meleeBase: 'reckless', furious: 'a1' }), dice)).toThrow();
  });
  it('without the talent there is no extra attack', () => {
    const b = scene([]);
    run(b, cmd({ meleeBase: 'reckless' }), { roll: (s: number) => (s === 100 ? 20 : 3) });
    expect(furiousOpen(b, 'r')).toBeNull();
  });
});

describe('«Ураганный натиск» (ruling 158)', () => {
  const scene = () => {
    const sword = matchWeaponByName('Цепной меч')!;
    const b = createBattle([
      {
        character: {
          ...emptyCharacter('r', 'Боец'),
          characteristics: chars({ НР: 50, СЛ: 60 }),
          movement: { options: [{ label: 'бЛВ', skr: 4 }], current: 0 },
          talents: ['Владение оружием (Цепное)', 'Ураганный натиск'],
          weapons: [{ name: sword.name, ref: sword.id }],
        },
        side: 'a',
        at: { x: 3.5, y: 10.5 },
        id: 'r',
      },
      { character: soft('m'), side: 'b', at: { x: 6.5, y: 10.5 }, id: 'm' },
      { character: soft('t'), side: 'b', at: { x: 10.5, y: 10.5 }, id: 't' },
    ]);
    startCombat(b, fixedDice('10:9,10:2,10:1'));
    return b;
  };
  type Storm = { result: { hurricane: { path: { actor: string; won: boolean }[] } } };
  it('a character on the way who loses the opposed СЛ is knocked down', () => {
    const b = scene();
    // Charger rolls 5 (wins), the one on the way 99 (fails); the blow hits with 5.
    const r = run(b, cmd({ charge: { x: 9.5, y: 10.5 } }), {
      roll: ((n) => (s: number) => (s === 100 ? (n++ % 2 === 0 ? 5 : 99) : Math.min(3, s)))(0),
    });
    expect((r as Storm).result.hurricane.path).toEqual([
      expect.objectContaining({ actor: 'm', won: true }),
    ]);
    expect(getEngine(b).wounds.combat.actors.m!.posture).toBe('prone');
    expect(b.positions.r).toEqual({ x: 9.5, y: 10.5 });
  });
  it('when the charger loses, the charge ends at that character', () => {
    const b = scene();
    const r = run(b, cmd({ charge: { x: 9.5, y: 10.5 } }), {
      roll: ((n) => (s: number) => (s === 100 ? (n++ % 2 === 0 ? 99 : 5) : Math.min(3, s)))(0),
    });
    expect((r as Storm).result.hurricane.path[0]).toMatchObject({ actor: 'm', won: false });
    expect(b.positions.r).toEqual({ x: 5.5, y: 10.5 });
  });
});

describe('«Огненный натиск» (ruling 159)', () => {
  it('a run and a long burst with НС+0 when the target is out of reach', () => {
    const gun = matchWeaponByName('Автоган')!;
    const b = createBattle([
      {
        character: {
          ...emptyCharacter('r', 'Боец'),
          characteristics: chars({ НС: 50, СЛ: 45 }),
          talents: ['Владение оружием (Стаб)', 'Огненный натиск', 'Бугрящиеся бицепсы'],
          weapons: [{ name: gun.name, ref: gun.id }],
        },
        side: 'a',
        at: { x: 2.5, y: 10.5 },
        id: 'r',
      },
      { character: soft('t'), side: 'b', at: { x: 20.5, y: 10.5 }, id: 't' },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    const at = fireChargeDestination(b, 'r', 't', 'r:0')!;
    expect(at).toEqual({ x: 11.5, y: 10.5 });
    const r = run(b, cmd({ charge: at }), {
      roll: (s: number) => (s === 100 ? 20 : Math.min(3, s)),
    });
    expect(r.status).toBe('RESOLVED');
    const res = (
      r as {
        result: {
          fireCharge: boolean;
          attack: { mode: string; check: { modifiers: { id: string; value: number }[] } };
        };
      }
    ).result;
    expect(res.fireCharge).toBe(true);
    expect(res.attack.mode).toBe('full-auto');
    const mods = res.attack.check.modifiers;
    const sum = (id: string) =>
      mods.filter((m) => m.id.endsWith(id)).reduce((a, m) => a + m.value, 0);
    expect(sum('ranged:mode') + sum(':fire-charge')).toBe(0);
    expect(b.positions.r).toEqual(at);
    expect(turnInfo(b).od).toBe(0);
  });
});

describe('Stabilizing a dying ally (ruling 160)', () => {
  it('an ally next to the dying, 2 ОД, Медика −30 with a medical kit', () => {
    const gun = matchWeaponByName('Лазган')!;
    const medic = {
      ...emptyCharacter('m', 'Медик'),
      characteristics: chars({ ИН: 60 }),
      skills: [{ name: 'Медика', bonus: 10 }],
    };
    const b = createBattle([
      {
        character: {
          ...emptyCharacter('s', 'Стрелок'),
          characteristics: chars({ НС: 60 }),
          weapons: [{ name: gun.name, ref: gun.id }],
        },
        side: 'b',
        at: { x: 2.5, y: 10.5 },
        id: 's',
      },
      {
        character: { ...emptyCharacter('d', 'Раненый'), wounds: 1 },
        side: 'a',
        at: { x: 8.5, y: 10.5 },
        id: 'd',
      },
      { character: medic, side: 'a', at: { x: 9.5, y: 10.5 }, id: 'm' },
    ]);
    startCombat(b, fixedDice('10:9,10:2,10:1'));
    run(b, cmd({ actor: 's', target: 'd', weapon: 's:0', mode: 'single' }), {
      roll: (s: number) => (s === 100 ? 20 : 1),
    });
    expect(actorStatus(b, 'd').life).toBe('AGONY');
    // Next turns: d (agony, skipped by the GM) and m.
    for (let i = 0; i < 5 && turnInfo(b).active !== 'm'; i++) nextTurn(b, fixedDice(''));
    expect(stabilizeTargets(b, 'm')).toEqual(['d']);
    expect(() => turnAction(b, { id: 'st0', actor: 'm', type: 'stabilize', target: 'd' })).toThrow(
      /медицинского набора/,
    );
    turnAction(
      b,
      { id: 'st', actor: 'm', type: 'stabilize', target: 'd', medKit: true },
      fixedDice('100:5'),
    );
    expect(actorStatus(b, 'd').life).toBe('STABILIZED');
    // Ruling 172: the stabilized character is unconscious and cannot act; a new wound — agony.
    expect(incapacity(b, 'd')).toMatch(/без сознания/);
    for (let i = 0; i < 5 && turnInfo(b).active !== 's'; i++) nextTurn(b, fixedDice(''));
    run(b, cmd({ id: 'again', actor: 's', target: 'd', weapon: 's:0', mode: 'single' }), {
      roll: (s: number) => (s === 100 ? 20 : 1),
    });
    expect(actorStatus(b, 'd').life).toBe('AGONY');
  });
});
