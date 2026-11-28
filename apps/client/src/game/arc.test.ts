import { describe, expect, it } from 'vitest';
import { createBattle } from './model';
import { emptyCharacter } from './character';
import { matchWeaponByName, weaponTraits } from './arsenal';
import { activeEmis, attack, getEngine, resumeAttack, startCombat, turnInfo } from './engine';
import { fixedDice } from './dice';

// Ruling 182: «Дуга (Х/Y)» — a damage die of Х or more sends a 45° arc from the target onwards,
// Y m long: 3к10 Э into the joints, «Шоковое», «ЭМИ (1)»; dodge is allowed.
const dice = { roll: (sides: number) => (sides === 100 ? 10 : 9) };
const battle = (behindAt: { x: number; y: number }) => {
  const hammer = matchWeaponByName('Громовой молот')!;
  const strong = {
    ...emptyCharacter('a', 'Молотобоец'),
    characteristics: { ...emptyCharacter('x').characteristics, СЛ: { value: 70, super: 0 } },
    weapons: [{ name: hammer.name, ref: hammer.id }],
  };
  const b = createBattle([
    { character: strong, side: 'a', at: { x: 5.5, y: 10.5 }, id: 'a' },
    {
      character: { ...emptyCharacter('t', 'Цель'), wounds: 60 },
      side: 'b',
      at: { x: 6.5, y: 10.5 },
      id: 't',
    },
    {
      character: { ...emptyCharacter('u', 'Сзади'), wounds: 60 },
      side: 'b',
      at: behindAt,
      id: 'u',
    },
  ]);
  startCombat(b, fixedDice('10:9,10:2,10:1'));
  expect(turnInfo(b).active).toBe('a');
  return b;
};
/** Runs the blow, answering the GM: nobody leaves the zone, joints ОБ 0. */
function strike(b: ReturnType<typeof createBattle>) {
  attack(
    b,
    {
      id: 'blow',
      actor: 'a',
      target: 't',
      weapon: 'a:0',
      targetActivity: 'REST',
      defense: 'DECLINE',
    },
    dice,
  );
  for (let i = 0; i < 8; i++) {
    const q = turnInfo(b).pending?.question;
    if (!q) break;
    resumeAttack(b, dice, { [q.key]: q.options ? q.options.at(-1)!.value : 0 });
  }
}
const wounds = (b: ReturnType<typeof createBattle>, id: string) =>
  getEngine(b).wounds.actors[id]!.damageTaken;

describe('«Дуга (Х/Y)»', () => {
  it('is read: die value 8, arc 5 m', () => {
    const t = weaponTraits(matchWeaponByName('Громовой молот')!).traits.find(
      (x) => x.name === 'Дуга',
    );
    expect(t).toMatchObject({ value: 8, text: '5' });
  });
  it('the one behind the target within 5 m is struck in the joints; an EMI field appears', () => {
    const b = battle({ x: 8.5, y: 10.5 });
    strike(b);
    expect(turnInfo(b).pending ?? null).toBeNull();
    expect(wounds(b, 'u')).toBeGreaterThan(0);
    expect(activeEmis(b).length).toBeGreaterThan(0);
  });
  it('someone outside the 45° arc is not struck', () => {
    const b = battle({ x: 6.5, y: 13.5 });
    strike(b);
    expect(wounds(b, 'u')).toBe(0);
  });
});
