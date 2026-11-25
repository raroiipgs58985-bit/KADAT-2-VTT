import { describe, expect, it } from 'vitest';
import type { DiceSource } from '@kadat/contracts';
import { createBattle, type Battle } from './model';
import {
  attack,
  reloadCost,
  resumeAttack,
  startCombat,
  turnAction,
  turnInfo,
  weaponState,
  type AttackCommand,
} from './engine';
import { fixedDice } from './dice';
import { emptyCharacter } from './character';
import { matchWeaponByName } from './arsenal';
import { engineWeapons, weaponProblem } from './combatants';

function run(b: Battle, cmd: AttackCommand, rng: DiceSource) {
  let r = attack(b, cmd, rng);
  for (let i = 0; i < 30 && r.status !== 'RESOLVED'; i++) {
    const q = turnInfo(b).pending?.question;
    if (!q) break;
    r = resumeAttack(b, rng, { [q.key]: q.options?.[0]?.value ?? 0 });
  }
  return r;
}
const scene = (weapon: string, sl = 40, at = 8.5) => {
  const w = matchWeaponByName(weapon)!;
  const base = emptyCharacter('x').characteristics;
  const b = createBattle([
    {
      character: {
        ...emptyCharacter('s', 'Стрелок'),
        characteristics: {
          ...base,
          НС: { value: 60, super: 0 },
          НР: { value: 60, super: 0 },
          СЛ: { value: sl, super: 0 },
        },
        talents: ['Владение оружием (Примитив)'],
        weapons: [{ name: w.name, ref: w.id }],
      },
      side: 'a',
      at: { x: 3.5, y: 10.5 },
      id: 's',
    },
    {
      character: { ...emptyCharacter('t', 'Цель'), wounds: 200 },
      side: 'b',
      at: { x: at, y: 10.5 },
      id: 't',
    },
  ]);
  startCombat(b, fixedDice('10:9,10:2'));
  return b;
};
const cmd = (patch: Partial<AttackCommand> = {}): AttackCommand => ({
  id: 'a',
  actor: 's',
  target: 't',
  weapon: 's:0',
  targetActivity: 'REST',
  defense: 'DECLINE',
  ...patch,
});
type Hit = {
  result: { hits: { notes: string[]; penetration: number; effects: { property: string }[] }[] };
};

describe('Bows and crossbows (ruling 164)', () => {
  it('every bow and crossbow can be used', () => {
    for (const n of [
      'Лук',
      'Длинный лук',
      'Блочный лук',
      'Ручной арбалет',
      'Арбалет',
      'Блочный арбалет',
    ])
      expect(weaponProblem(matchWeaponByName(n)), n).toBeNull();
  });
  it('a bow: range БС × 10, damage + бСЛ, one arrow, reload for the Free Action', () => {
    const b = scene('Лук');
    expect(engineWeapons(b).ranged['s:0']!.template.profile.optimalRange).toBe(40);
    const r = run(b, cmd({ mode: 'single' }), {
      roll: (s: number) => (s === 100 ? 5 : Math.min(3, s)),
    });
    expect((r as Hit).result.hits[0]!.notes).toContain('Лук: +4 (бСЛ)');
    expect(weaponState(b, 's:0').rounds).toBe(0);
    expect(reloadCost(b, 's', 's:0')).toBe('СД');
    const od = turnInfo(b).od;
    turnAction(b, { id: 'r', actor: 's', type: 'reload', weapon: 's:0' });
    expect(weaponState(b, 's:0').rounds).toBe(1);
    expect(turnInfo(b).od).toBe(od);
  });
  it('«БС (Х)»: with бСЛ below Х the bow cannot be drawn', () => {
    const b = scene('Лук', 20);
    expect(() => run(b, cmd({ mode: 'single' }), fixedDice('100:5'))).toThrow(/нужен бСЛ 3/);
  });
  it('a crossbow: damage by the sheet, reload 1 ОД', () => {
    const b = scene('Арбалет');
    const r = run(b, cmd({ mode: 'single' }), {
      roll: (s: number) => (s === 100 ? 5 : Math.min(3, s)),
    });
    expect((r as Hit).result.hits[0]!.notes.some((n) => n.startsWith('Лук'))).toBe(false);
    expect(reloadCost(b, 's', 's:0')).toBe('1 ОД');
  });
});

describe('War hammers (ruling 166)', () => {
  it('the blunt side: the first ББ and «Оглушающее»; the spike: ББ in brackets and «Калечащее (2)»', () => {
    expect(weaponProblem(matchWeaponByName('Боевой молот'))).toBeNull();
    const dice = { roll: (s: number) => (s === 100 ? 5 : Math.min(3, s)) };
    const blunt = scene('Боевой молот', 40, 4.5);
    const a = (run(blunt, cmd(), dice) as Hit).result.hits[0]!;
    expect(a.penetration).toBe(1);
    expect(a.effects.some((e) => e.property === 'Оглушающее')).toBe(true);
    const spike = scene('Боевой молот', 40, 4.5);
    const c = (run(spike, cmd({ spike: true }), dice) as Hit).result.hits[0]!;
    expect(c.penetration).toBe(3);
    expect(c.effects.some((e) => e.property === 'Оглушающее')).toBe(false);
  });
});

describe('Heavy laser drill (ruling 168)', () => {
  it('takes the magazine and reload of the lascannon', () => {
    const drill = matchWeaponByName('Тяжёлый лазерный бур')!;
    expect(drill.magazine).toBe(5);
    expect(drill.reload?.od).toBe(2);
    expect(weaponProblem(drill)).toBeNull();
  });
});
