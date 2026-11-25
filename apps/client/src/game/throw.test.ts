import { describe, expect, it } from 'vitest';
import { createBattle, type Battle } from './model';
import {
  activeSmokes,
  applyMap,
  attack,
  attackLineProblem,
  coverFor,
  moveActor,
  nextTurn,
  resumeAttack,
  startCombat,
  turnInfo,
  weaponState,
  type AttackCommand,
} from './engine';
import type { DiceSource } from '@kadat/contracts';
import { fixedDice } from './dice';
import { emptyCharacter } from './character';
import { arsenal, matchWeaponByName, weaponTraits } from './arsenal';
import { throwRange } from './combatants';

const chars = (patch: Partial<Record<'НС' | 'СЛ', number>>) => {
  const base = emptyCharacter('x').characteristics;
  return {
    ...base,
    НС: { value: patch.НС ?? 40, super: 0 },
    СЛ: { value: patch.СЛ ?? 40, super: 0 },
  };
};
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
const thrower = (name: string, count = 2) => {
  const w = arsenal.weapons.find((x) => x.name === name && x.weaponClass === 'Метательное')!;
  return {
    ...emptyCharacter('g', 'Гренадёр'),
    characteristics: chars({ НС: 60, СЛ: 40 }),
    weapons: [{ name: w.name, ref: w.id, count }],
  };
};
const scene = (name: string, count = 2) => {
  const b = createBattle([
    { character: thrower(name, count), side: 'a', at: { x: 3.5, y: 10.5 }, id: 'g' },
    {
      character: { ...emptyCharacter('t', 'Цель'), wounds: 200 },
      side: 'b',
      at: { x: 9.5, y: 10.5 },
      id: 't',
    },
  ]);
  startCombat(b, fixedDice('10:9,10:2'));
  return b;
};
const cmd = (patch: Partial<AttackCommand>): AttackCommand => ({
  id: 'th',
  actor: 'g',
  target: 't',
  weapon: 'g:0',
  targetActivity: 'REST',
  defense: 'DECLINE',
  ...patch,
});
type Thrown = {
  result: {
    thrown: {
      hit: boolean;
      landed: { x: number; y: number } | null;
      blasts?: { scatter: unknown; targets: { actor: string; avoided: boolean }[] }[];
      smoke?: { at: unknown; radius: number; rounds: number };
    };
  };
};

describe('Fractional «Взрыв (0.5)» (ruling 151)', () => {
  it('is read as half a metre', () => {
    const pistol = matchWeaponByName('Плазменный пистолет')!;
    expect(weaponTraits(pistol).traits).toContainEqual({ name: 'Взрыв', value: 0.5 });
    const bolter = matchWeaponByName('Болтер')!;
    expect(weaponTraits(bolter).traits).toContainEqual({ name: 'Взрыв', value: 0.5 });
  });
});

describe('Thrown weapons (ruling 154)', () => {
  it('range is 10 × бСЛ; farther throws are refused', () => {
    const b = scene('Фраг');
    expect(throwRange(b, 'g:0')).toBe(40);
    expect(() => run(b, cmd({ at: { x: 50.5, y: 10.5 } }), fixedDice('100:5'))).toThrow(
      /Не добросить/,
    );
  });
  it('a Фраг thrown at a character blasts around it and one item is spent', () => {
    const b = scene('Фраг');
    expect(weaponState(b, 'g:0').rounds).toBe(2);
    const r = run(b, cmd({}), { roll: (s: number) => (s === 100 ? 5 : 5) });
    expect(r.status).toBe('RESOLVED');
    const t = (r as Thrown).result.thrown;
    expect(t.hit).toBe(true);
    expect(t.landed).toEqual({ x: 9.5, y: 10.5 });
    expect(t.blasts?.[0]?.targets.some((x) => x.actor === 't')).toBe(true);
    expect(weaponState(b, 'g:0').rounds).toBe(1);
  });
  it('a Фраг thrown at a cell lands there on a hit', () => {
    const b = scene('Фраг');
    const r = run(b, cmd({ target: 'g', at: { x: 9.5, y: 12.5 } }), {
      roll: (s: number) => (s === 100 ? 5 : 5),
    });
    const t = (r as Thrown).result.thrown;
    expect(t.landed).toEqual({ x: 9.5, y: 12.5 });
  });
  it('a miss scatters the throw', () => {
    const b = scene('Фраг');
    const r = run(b, cmd({ target: 'g', at: { x: 9.5, y: 12.5 } }), {
      roll: (s: number) => (s === 100 ? 99 : 2),
    });
    const t = (r as Thrown).result.thrown;
    expect(t.hit).toBe(false);
    expect(t.landed).not.toEqual({ x: 9.5, y: 12.5 });
  });
  it('a smoke grenade leaves a cloud; shots in, from or through it get −20', () => {
    const b = scene('Дым', 1);
    const r = run(b, cmd({ target: 'g', at: { x: 6.5, y: 10.5 } }), {
      roll: (s: number) => (s === 100 ? 5 : 3),
    });
    const t = (r as Thrown).result.thrown;
    expect(t.smoke).toMatchObject({ radius: 5, rounds: 13 });
    expect(activeSmokes(b)).toHaveLength(1);
    expect(weaponState(b, 'g:0').rounds).toBe(0);
    expect(() => run(b, cmd({ id: 'th2' }), fixedDice('100:5'))).toThrow();
  });
  it('a throw through the smoke gets −20', () => {
    const b = scene('Дым', 2);
    const dice = { roll: (s: number) => (s === 100 ? 5 : 3) };
    run(b, cmd({ target: 'g', at: { x: 6.5, y: 10.5 } }), dice);
    nextTurn(b, dice);
    nextTurn(b, dice);
    const r = run(b, cmd({ id: 'th2', at: { x: 9.5, y: 12.5 }, target: 'g' }), dice);
    expect(JSON.stringify(r)).toContain('th2:smoke');
  });
});

describe('Windows (ruling 153)', () => {
  const scene = (coverOb?: number) => {
    const gun = matchWeaponByName('Лазган')!;
    const b = createBattle([
      {
        character: {
          ...emptyCharacter('s', 'Стрелок'),
          characteristics: chars({ НС: 60 }),
          weapons: [{ name: gun.name, ref: gun.id }],
        },
        side: 'a',
        at: { x: 3.5, y: 10.5 },
        id: 's',
      },
      {
        character: { ...emptyCharacter('t', 'Цель'), wounds: 80 },
        side: 'b',
        at: { x: 8.5, y: 10.5 },
        id: 't',
      },
    ]);
    applyMap(b, {
      map: {
        ...b.map,
        walls: [
          {
            id: 'w',
            points: [
              { x: 8, y: 7 },
              { x: 8, y: 14 },
            ],
          },
        ],
        doors: [
          {
            id: 'win',
            wallId: 'w',
            from: { x: 8, y: 10 },
            to: { x: 8, y: 11 },
            open: false,
            blocksMovement: true,
            blocksVision: false,
            locked: false,
            lockModifier: 0,
            lockOd: 1,
            ...(coverOb ? { coverOb, coverHeight: 'medium' as const } : {}),
          },
        ],
      },
      positions: { s: { x: 3.5, y: 10.5 }, t: { x: 8.5, y: 10.5 } },
    });
    return b;
  };
  it('a window lets shots through without ОБ by default', () => {
    const b = scene();
    expect(attackLineProblem(b, 's', 't')).toBeNull();
    expect(coverFor(b, 's', 't')).toBeNull();
  });
  it('a window with cover ОБ covers the target behind it', () => {
    const b = scene(4);
    expect(coverFor(b, 's', 't')).toMatchObject({ id: 'win', ob: 4, zones: ['legs', 'torso'] });
  });
});

describe('«След» on the way (ruling 152)', () => {
  it('walking through a burning zone burns', () => {
    const flamer = matchWeaponByName('Огнемёт')!;
    const b = createBattle([
      {
        character: {
          ...emptyCharacter('f', 'Огнемётчик'),
          talents: ['Владение оружием (Огнемёт)'],
          weapons: [{ name: flamer.name, ref: flamer.id }],
        },
        side: 'a',
        at: { x: 3.5, y: 10.5 },
        id: 'f',
      },
      {
        character: { ...emptyCharacter('a', 'a'), wounds: 200 },
        side: 'b',
        at: { x: 9.5, y: 13.5 },
        id: 'a',
      },
      {
        character: { ...emptyCharacter('m', 'Мишень'), wounds: 200 },
        side: 'b',
        at: { x: 6.5, y: 10.5 },
        id: 'm',
      },
    ]);
    startCombat(b, fixedDice('10:9,10:3,10:2'));
    run(b, cmd({ id: 'sp', actor: 'f', target: 'm', weapon: 'f:0' }), {
      roll: (s: number) => (s === 100 ? 1 : 5),
    });
    const dice = { roll: (s: number) => (s === 100 ? 99 : 5) };
    nextTurn(b, dice); // a, round 1 — trails act from the next round
    nextTurn(b, dice); // m
    nextTurn(b, dice); // f, round 2
    nextTurn(b, dice); // a, round 2 — outside the zone, walks through it
    const before = b.hp.a!;
    moveActor(b, { id: 'mv', actor: 'a', mode: 'full-move', to: { x: 9.5, y: 8.5 } }, dice);
    expect(b.hp.a!).toBeLessThan(before);
  });
});
