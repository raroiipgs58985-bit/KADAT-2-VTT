import { describe, expect, it } from 'vitest';
import type { DiceSource } from '@kadat/contracts';
import { battleWeapons, createBattle, type Battle } from './model';
import {
  activeSmokes,
  attack,
  entanglement,
  resumeAttack,
  startCombat,
  turnInfo,
  type AttackCommand,
} from './engine';
import { fixedDice } from './dice';
import { emptyCharacter } from './character';
import { ammoOptions, arsenal, matchWeaponByName } from './arsenal';
import { weaponProblem } from './combatants';

function run(b: Battle, cmd: AttackCommand, rng: DiceSource) {
  let r = attack(b, cmd, rng);
  for (let i = 0; i < 30 && r.status !== 'RESOLVED'; i++) {
    const q = turnInfo(b).pending?.question;
    if (!q) break;
    r = resumeAttack(b, rng, { [q.key]: q.options?.[0]?.value ?? 0 });
  }
  return r;
}
const byName = (n: string) => arsenal.weapons.find((w) => w.name.trim() === n)!;
const scene = (weapon: string, ammo?: string, start = true) => {
  const w = byName(weapon);
  const base = emptyCharacter('x').characteristics;
  const b = createBattle([
    {
      character: {
        ...emptyCharacter('s', 'Гренадёр'),
        characteristics: { ...base, НС: { value: 60, super: 0 } },
        talents: ['Владение оружием (Пусковое)', 'Бугрящиеся бицепсы'],
        weapons: [{ name: w.name, ref: w.id, ...(ammo ? { ammo } : {}) }],
      },
      side: 'a',
      at: { x: 3.5, y: 10.5 },
      id: 's',
    },
    {
      character: { ...emptyCharacter('t', 'Цель'), wounds: 200 },
      side: 'b',
      at: { x: 12.5, y: 10.5 },
      id: 't',
    },
  ]);
  if (start) startCombat(b, fixedDice('10:9,10:2'));
  return b;
};
const cmd = (patch: Partial<AttackCommand> = {}): AttackCommand => ({
  id: 'a',
  actor: 's',
  target: 't',
  weapon: 's:0',
  targetActivity: 'REST',
  defense: 'DECLINE',
  mode: 'single',
  ...patch,
});
const dice = (first = 5) => {
  let n = 0;
  return { roll: (s: number) => (s === 100 ? (n++ === 0 ? first : 99) : Math.min(3, s)) };
};

describe('Launcher ammunition (ruling 167)', () => {
  it('40 mm launchers fire the hand grenades, 90 mm launchers the 90 mm rockets', () => {
    const ugl = byName('Подствольный гранатомёт (40 мм)');
    expect(ammoOptions(ugl).map((x) => x.name)).toContain('Фраг');
    const rpg = byName('Ручной реактивный гранатомёт (90 мм)');
    expect(ammoOptions(rpg).map((x) => x.name)).toEqual(
      expect.arrayContaining(['Фраг (90 мм)', 'Крак (90 мм)', 'Плазменная (90 мм)']),
    );
    expect(weaponProblem(ugl)).toMatch(/выберите боеприпас/);
  });
  it('a loaded launcher: range and magazine of the launcher, damage and blast of the grenade', () => {
    const frag = ammoOptions(byName('Ручной гранатомёт (40 мм)')).find((x) => x.name === 'Фраг')!;
    const b = scene('Ручной гранатомёт (40 мм)', frag.id);
    const w = battleWeapons(b)[0]!;
    expect(weaponProblem(w.arsenal)).toBeNull();
    expect(w.name).toBe('Ручной гранатомёт (40 мм) (Фраг)');
    expect(w.arsenal!.damageText).toBe('3к10 В');
    expect(w.arsenal!.magazine).toBe(6);
    const r = run(b, cmd(), dice());
    expect((r as { result: { blasts: unknown[] } }).result.blasts.length).toBeGreaterThan(0);
  });
  it('a smoke grenade from a launcher leaves a cloud', () => {
    const smoke = ammoOptions(byName('Ручной гранатомёт (40 мм)')).find((x) => x.name === 'Дым')!;
    const b = scene('Ручной гранатомёт (40 мм)', smoke.id);
    run(b, cmd(), dice());
    expect(activeSmokes(b)).toHaveLength(1);
  });
});

describe('Net guns (rulings 155, 167)', () => {
  it('no damage: a hit entangles («Путы»)', () => {
    expect(weaponProblem(matchWeaponByName('Пистолет-сетемёт'))).toBeNull();
    const b = scene('Пистолет-сетемёт');
    run(b, cmd(), dice());
    expect(entanglement(b, 't')).not.toBeNull();
  });
});

describe('Indirect fire and mortars (ruling 171)', () => {
  it('«Навесное» shoots over walls; infantry mortars fire the mines of their calibre', async () => {
    const { attackLineProblem, applyMap } = await import('./engine');
    const frag = ammoOptions(byName('Ручной гранатомёт (40 мм)')).find((x) => x.name === 'Фраг')!;
    const b = scene('Ручной гранатомёт (40 мм)', frag.id, false);
    applyMap(b, {
      map: {
        ...b.map,
        walls: [
          {
            id: 'w',
            points: [
              { x: 8, y: 5 },
              { x: 8, y: 16 },
            ],
          },
        ],
      },
      positions: { s: { x: 3.5, y: 10.5 }, t: { x: 12.5, y: 10.5 } },
    });
    expect(attackLineProblem(b, 's', 't')).not.toBeNull();
    expect(attackLineProblem(b, 's', 't', 's:0')).toBeNull();
    const mortar = byName('82 мм пехотный миномёт');
    const mines = ammoOptions(mortar).map((x) => x.name.trim());
    expect(mines).toEqual(expect.arrayContaining(['Фраг (82 мм)', 'Дымовая (82 мм)']));
  });
});

describe('Hallucinogen (ruling 170)', () => {
  it('a ВН test −10 × Х; a failure — effect к10 for the GM and 1 + failures rounds', () => {
    const gas = ammoOptions(byName('Ручной гранатомёт (40 мм)')).find(
      (x) => x.name === 'Галюциноген',
    )!;
    const b = scene('Ручной гранатомёт (40 мм)', gas.id);
    const r = run(b, cmd(), dice());
    const blasts = (
      r as unknown as {
        result: {
          blasts: {
            targets: {
              actor: string;
              effects?: { property: string; passed: boolean; state?: string }[];
            }[];
          }[];
        };
      }
    ).result.blasts;
    const t = blasts[0]!.targets.find((x) => x.actor === 't')!;
    const fx = t.effects!.find((e) => e.property === 'Галлюциногенное')!;
    expect(fx.passed).toBe(false);
    expect(fx.state).toMatch(/эффект \d+ по таблице ведущего/);
  });
});
