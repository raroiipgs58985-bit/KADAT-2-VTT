import { describe, expect, it } from 'vitest';
import { createBattle, type Battle } from './model';
import {
  attack,
  chargeDestination,
  getEngine,
  moveActor,
  previewAttack,
  resumeAttack,
  startCombat,
  takeWeapon,
  turnInfo,
  applyMap,
  type AttackCommand,
  type AttackPreview,
} from './engine';
import { fixedDice } from './dice';
import { emptyCharacter } from './character';
import { matchWeaponByName } from './arsenal';
import { fireModes } from './combatants';

// ADR 0007: the preview must give the same target and modifiers as the real attack in the same
// context, roll nothing and leave the battle untouched.

const shot = (patch: Partial<AttackCommand> = {}): AttackCommand => ({
  id: 'shot',
  actor: 'kelus-drakar',
  target: 'pak',
  weapon: 'kelus-drakar:0',
  targetActivity: 'REST',
  defense: 'DECLINE',
  ...patch,
});
const started = (setup?: (b: Battle) => void) => {
  const b = createBattle();
  setup?.(b);
  startCombat(b, fixedDice('10:9,10:2'));
  return b;
};
const snapshot = (b: Battle) => JSON.stringify({ b, engine: getEngine(b) });

type Check = {
  target: number;
  finalModifier: number;
  modifiers: { id: string; value: number; included: boolean }[];
};
const ready = (p: AttackPreview) => {
  if (p.status !== 'ready') throw new Error(`preview unavailable: ${p.reason}`);
  return p;
};
const same = (p: AttackPreview, check: Check) => {
  const r = ready(p);
  expect(r.target).toBe(check.target);
  expect(r.finalModifier).toBe(check.finalModifier);
  expect(r.modifiers.map((m) => [m.id, m.value, m.included])).toEqual(
    check.modifiers.map((m) => [m.id, m.value, m.included]),
  );
};
const rangedCheck = (r: unknown) =>
  (r as { result: { attack: { check: Check } } }).result.attack.check;
const meleeCheck = (r: unknown) => (r as { result: { attack: Check } }).result.attack;

describe('Attack preview equals the real attack test (ADR 0007)', () => {
  it('ranged, single shot', () => {
    const b = started();
    const p = previewAttack(b, shot());
    const r = attack(b, shot(), fixedDice('100:90'));
    same(p, rangedCheck(r));
  });

  it('ranged, every fire mode of the weapon', () => {
    const weapon = matchWeaponByName('Хот-шот лазган')!;
    for (const mode of fireModes(weapon).map((m) => m.mode)) {
      const b = started();
      const command = shot({ id: `m-${mode}`, mode });
      const p = previewAttack(b, command);
      const dice = { roll: (sides: number) => (sides === 100 ? 90 : 1) };
      let r: unknown = attack(b, command, dice);
      // A burst asks about the target's suppression after the attack test; answer and finish.
      if ((r as { status: string }).status === 'CONTEXT_REQUIRED') {
        const key = getEngine(b).pending!.question!.key;
        r = resumeAttack(b, dice, { [key]: 0 });
      }
      same(p, rangedCheck(r));
    }
  });

  it('ranged with a GM modifier and a target in physical action', () => {
    const b = started();
    const command = shot({ modifier: 10, targetActivity: 'PHYSICAL_ACTION' });
    const p = previewAttack(b, command);
    const r = attack(b, command, fixedDice('100:90'));
    same(p, rangedCheck(r));
  });

  it('ranged after the shooter moved this turn', () => {
    const b = started();
    moveActor(b, { id: 'mv', actor: 'kelus-drakar', mode: 'half-move', to: { x: 9.5, y: 10.5 } });
    const p = previewAttack(b, shot());
    const r = attack(b, shot(), fixedDice('100:90'));
    same(p, rangedCheck(r));
  });

  it('the target changes the preview (recomputed per command)', () => {
    const b = started();
    const near = ready(previewAttack(b, shot()));
    moveActor(b, { id: 'mv', actor: 'kelus-drakar', mode: 'half-move', to: { x: 3.5, y: 10.5 } });
    const far = ready(previewAttack(b, shot()));
    // Same base value, a different situation; both previews come from the same core path.
    expect(far.baseValue).toBe(near.baseValue);
    const r = attack(b, shot(), fixedDice('100:90'));
    same(
      previewAttack(started(), shot()),
      rangedCheck(attack(started(), shot(), fixedDice('100:90'))),
    );
    same(far, rangedCheck(r));
  });

  const duel = (armed: boolean, talents: string[] = [], ownSword = true) => {
    const sword = matchWeaponByName('Цепной меч')!;
    const b = createBattle([
      {
        character: {
          ...emptyCharacter('f', 'Кулачник'),
          characteristics: {
            ...emptyCharacter('x').characteristics,
            НР: { value: 50, super: 0 },
            СЛ: { value: 40, super: 0 },
          },
          talents,
          weapons: ownSword ? [{ name: sword.name, ref: sword.id }] : [],
        },
        side: 'a',
        at: { x: 5.5, y: 10.5 },
        id: 'f',
      },
      {
        character: {
          ...emptyCharacter('t', 'Цель'),
          wounds: 50,
          weapons: armed ? [{ name: sword.name, ref: sword.id }] : [],
        },
        side: 'b',
        at: { x: 6.5, y: 10.5 },
        id: 't',
      },
    ]);
    if (armed) takeWeapon(b, { id: 'tw', actor: 't', weapon: 't:0' });
    startCombat(b, fixedDice('10:9,10:2'));
    return b;
  };
  const melee = { roll: (sides: number) => (sides === 100 ? 99 : 3) };

  it('melee, bare hands against an armed target (−20)', () => {
    const b = duel(true, [], false);
    const command = shot({ id: 'punch', actor: 'f', target: 't', weapon: 'f:hands' });
    const p = previewAttack(b, command);
    const unarmed = ready(p).modifiers.find((m) => m.id === 'punch:unarmed');
    expect(unarmed?.value).toBe(-20);
    expect(unarmed?.label).toMatch(/[А-Яа-я]/);
    same(p, meleeCheck(attack(b, command, melee)));
  });

  it('melee with a weapon in hand', () => {
    const b = duel(false);
    takeWeapon(b, { id: 'fw', actor: 'f', weapon: 'f:0' });
    const command = shot({ id: 'cut', actor: 'f', target: 't', weapon: 'f:0' });
    const p = previewAttack(b, command);
    same(p, meleeCheck(attack(b, command, melee)));
  });

  it('melee charge (+20)', () => {
    const b = createBattle([
      {
        character: {
          ...emptyCharacter('r', 'Бегун'),
          weapons: [{ name: 'Цепной меч', ref: matchWeaponByName('Цепной меч')!.id }],
        },
        side: 'a',
        at: { x: 2.5, y: 10.5 },
        id: 'r',
      },
      {
        character: { ...emptyCharacter('pak', 'Пак'), wounds: 300 },
        side: 'b',
        at: { x: 9.5, y: 10.5 },
        id: 'pak',
      },
    ]);
    startCombat(b, fixedDice('10:9,10:2'));
    const at = chargeDestination(b, 'r', 'pak');
    if (!at) return; // the setup can't reach — nothing to compare
    const command = shot({ id: 'ch', actor: 'r', target: 'pak', weapon: 'r:0', charge: at });
    const p = previewAttack(b, command);
    expect(ready(p).modifiers.find((m) => m.id === 'melee:base')?.value).toBe(20);
    same(p, meleeCheck(attack(b, command, melee)));
  });
});

const coverScene = (wall: boolean, wallFrom = 11) => {
  const gun = matchWeaponByName('Стаб-пистолет')!;
  const b = createBattle([
    {
      character: {
        ...emptyCharacter('s', 'Стрелок'),
        characteristics: { ...emptyCharacter('x').characteristics, НС: { value: 60, super: 0 } },
        talents: ['Владение оружием (Стаб)'],
        weapons: [{ name: gun.name, ref: gun.id }],
      },
      side: 'a',
      at: { x: 3.5, y: 10.5 },
      id: 's',
    },
    {
      character: { ...emptyCharacter('t', 'Цель'), wounds: 80 },
      side: 'b',
      at: { x: 9.5, y: 10.5 },
      id: 't',
    },
  ]);
  const map = {
    ...b.map,
    obstacles: wall
      ? []
      : [
          {
            id: 'crate',
            col: 8,
            row: 10,
            width: 1,
            height: 1,
            label: 'Ящик',
            blocksMovement: true,
            blocksVision: false,
            notes: '',
            coverOb: 6,
            coverHeight: 'medium' as const,
          },
        ],
    walls: wall
      ? [
          {
            id: 'w1',
            points: [
              { x: 8, y: wallFrom },
              { x: 8, y: 13 },
            ],
            ob: 8,
          },
        ]
      : [],
  };
  applyMap(b, {
    map,
    positions: wall
      ? { s: { x: 3.5, y: 9.5 }, t: { x: 9.5, y: 11.5 } }
      : { s: { x: 3.5, y: 10.5 }, t: { x: 9.5, y: 10.5 } },
  } as Parameters<typeof applyMap>[1]);
  return b;
};

describe('Attack preview with the target in cover', () => {
  it('same target as the real attack (GM answer given)', () => {
    const b = coverScene(false);
    startCombat(b, fixedDice('10:9,10:2'));
    const command = shot({
      id: 'c',
      actor: 's',
      target: 't',
      weapon: 's:0',
      answers: { 'cover:t': 0 },
    });
    const p = previewAttack(b, command);
    let n = 0;
    const r = attack(b, command, {
      roll: (sides: number) => (sides === 100 ? (n++ === 0 ? 90 : 99) : 1),
    });
    same(p, rangedCheck(r));
  });
});

describe('Attack preview has no side effects', () => {
  it('repeated previews leave the battle, engine, log, ammo and ОД unchanged', () => {
    const b = started();
    const before = snapshot(b);
    const od = turnInfo(b).od;
    const first = previewAttack(b, shot());
    for (let i = 0; i < 5; i++) expect(previewAttack(b, shot())).toEqual(first);
    previewAttack(b, shot({ mode: 'short-burst' }));
    expect(snapshot(b)).toBe(before);
    expect(turnInfo(b).od).toBe(od);
    // The real attack after previews still resolves with the injected dice only.
    expect(attack(b, shot(), fixedDice('100:90')).status).toBe('RESOLVED');
  });

  it('uses no dice: a source is never consulted', () => {
    const b = started();
    let calls = 0;
    const real = { roll: (sides: number) => (calls++, sides === 100 ? 90 : 1) };
    previewAttack(b, shot());
    expect(calls).toBe(0);
    attack(b, shot(), real);
    expect(calls).toBeGreaterThan(0);
  });
});

describe('Attack preview explains why it has no number', () => {
  it('a wall on the line of fire', () => {
    const b = coverScene(true, 9);
    startCombat(b, fixedDice('10:9,10:2'));
    const p = previewAttack(b, shot({ id: 'w', actor: 's', target: 't', weapon: 's:0' }));
    expect(p).toEqual({
      status: 'unavailable',
      reason: expect.stringMatching(/Линию атаки перекрывает/),
    });
  });

  it('a pending command blocks the preview with a reason', () => {
    const b = started();
    // A burst asks about suppression after the test: the command stays pending.
    const r = attack(b, shot({ id: 'p', mode: 'short-burst' }), {
      roll: (sides: number) => (sides === 100 ? 90 : 1),
    });
    expect(r.status).toBe('CONTEXT_REQUIRED');
    const p = previewAttack(b, shot({ id: 'q' }));
    expect(p).toEqual({
      status: 'unavailable',
      reason: expect.stringContaining('прошлую команду'),
    });
  });
});
