import { describe, expect, it } from 'vitest';
import { createBattle } from './model';
import { matchWeaponByName, weaponTraits } from './arsenal';
import {
  activeEmis,
  emiSensitive,
  emiStage,
  getEngine,
  nextTurn,
  previewAttack,
  startCombat,
  turnInfo,
  type AttackCommand,
} from './engine';
import { fixedDice } from './dice';

// Ruling 186: «ЭМИ (Х)» — a field of radius Х; к10 for the stage; one stage less every round;
// technological ranged weapons inside: weak −10, serious −20, dead zone — no shot.
const shot: AttackCommand = {
  id: 'shot',
  actor: 'kelus-drakar',
  target: 'pak',
  weapon: 'kelus-drakar:0',
  targetActivity: 'REST',
  defense: 'DECLINE',
};
const withField = (roll: number) => {
  const b = createBattle();
  startCombat(b, fixedDice('10:9,10:2'));
  const round = getEngine(b).wounds.combat.session.roundNumber;
  getEngine(b).emis = [{ id: 'f', x: 5.5, y: 10.5, r: 2, roll, fromRound: round }];
  return b;
};
const emiMod = (b: ReturnType<typeof createBattle>) => {
  const p = previewAttack(b, shot);
  return p.status === 'ready'
    ? p.modifiers.find((m) => m.label.startsWith('ЭМИ'))?.value
    : p.reason;
};

describe('EMI', () => {
  it('stages by the к10', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(emiStage)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it('mechanical and primitive weapons are not disturbed; las is', () => {
    const las = matchWeaponByName('Хот-шот лазган')!;
    const stub = matchWeaponByName('Стаб-пистолет')!;
    expect(emiSensitive(las, weaponTraits(las).traits)).toBe(true);
    expect(emiSensitive(stub, weaponTraits(stub).traits)).toBe(false);
  });
  it('weak −10, serious −20, dead zone — no shot', () => {
    expect(emiMod(withField(3))).toBe(-10);
    expect(emiMod(withField(5))).toBe(-20);
    expect(emiMod(withField(7))).toMatch(/Мёртвая зона ЭМИ/);
  });
  it('the field weakens by one stage each round and ends', () => {
    const b = withField(5);
    expect(activeEmis(b)[0]!.stage).toBe(2);
    for (let i = 0; i < 2; i++) nextTurn(b, fixedDice(''));
    expect(turnInfo(b).round).toBe(2);
    expect(activeEmis(b)[0]!.stage).toBe(1);
    for (let i = 0; i < 2; i++) nextTurn(b, fixedDice(''));
    expect(activeEmis(b)).toEqual([]);
  });
});
