import { describe, expect, it } from 'vitest';
import { createBattle } from './model';
import { meleeFamily, meleeGrips } from './combatants';
import {
  changeStanceGrip,
  meleeStance,
  nextTurn,
  placeActor,
  previewAttack,
  startCombat,
  takeWeapon,
  turnInfo,
  weaponInHand,
  type AttackCommand,
} from './engine';
import { fixedDice } from './dice';

// Ruling 177: grips and stances by the Core, for the Free Action (ruling 21).
describe('melee families and grips', () => {
  it('families by the Arsenal name', () => {
    expect(meleeFamily('Силовой топор')).toBe('axe');
    expect(meleeFamily('Цепной меч')).toBe('sword');
    expect(meleeFamily('Копье')).toBe('spear');
    expect(meleeFamily('Силовая коса')).toBe('glaive');
    expect(meleeFamily('Кирка')).toBe('hook');
    expect(meleeFamily('Громовой молот')).toBe('hammer');
    expect(meleeFamily('Абордажный щит')).toBe('shield');
    expect(meleeFamily('Нож')).toBe('arsenal');
  });
  it('grips: natural first, then the other hand count and close; fist for axe/hook/hammer', () => {
    expect(meleeGrips('sword', false)).toEqual(['one-handed', 'two-handed', 'close']);
    expect(meleeGrips('axe', true)).toEqual(['two-handed', 'one-handed', 'close', 'fist']);
  });
});

const sword = 'kelus-drakar:1';
const blow = (patch: Partial<AttackCommand> = {}): AttackCommand => ({
  id: 'blow',
  actor: 'kelus-drakar',
  target: 'pak',
  weapon: sword,
  targetActivity: 'REST',
  defense: 'DECLINE',
  ...patch,
});
const kelusNextToPak = () => {
  const b = createBattle();
  placeActor(b, 'kelus-drakar', 14.5, 10.5);
  // Before the fight a weapon is taken in hand for free.
  if (!weaponInHand(b, sword)) takeWeapon(b, { id: 'take', actor: 'kelus-drakar', weapon: sword });
  startCombat(b, fixedDice('10:9,10:2'));
  expect(turnInfo(b).active).toBe('kelus-drakar');
  expect(weaponInHand(b, sword)).toBe(true);
  return b;
};
const mod = (b: ReturnType<typeof createBattle>, cmd: AttackCommand, label: string) => {
  const p = previewAttack(b, cmd);
  if (p.status !== 'ready') throw new Error(p.reason);
  return p.modifiers.find((m) => m.label === label)?.value;
};

describe('changeStanceGrip', () => {
  it('a one-handed sword in two hands: +5 НР, the Free Action is spent', () => {
    const b = kelusNextToPak();
    const od = turnInfo(b).od;
    changeStanceGrip(b, { id: 'g', actor: 'kelus-drakar', weapon: sword, grip: 'two-handed' });
    expect(meleeStance(b, 'kelus-drakar', sword).grip).toBe('two-handed');
    expect(turnInfo(b).od).toBe(od);
    expect(mod(b, blow(), 'Хват')).toBe(5);
    expect(() =>
      changeStanceGrip(b, { id: 'g2', actor: 'kelus-drakar', weapon: sword, grip: 'close' }),
    ).toThrow();
  });

  it('a grip the weapon does not have is refused', () => {
    const b = kelusNextToPak();
    expect(() =>
      changeStanceGrip(b, { id: 'g', actor: 'kelus-drakar', weapon: sword, grip: 'fist' }),
    ).toThrow();
    expect(() =>
      changeStanceGrip(b, { id: 's', actor: 'kelus-drakar', weapon: sword, stance: 'palisade' }),
    ).toThrow();
  });

  it('defensive stance: attackers get −20, the stance holder strikes only with a shield', () => {
    const b = kelusNextToPak();
    changeStanceGrip(b, { id: 's', actor: 'kelus-drakar', weapon: sword, stance: 'defensive' });
    expect(meleeStance(b, 'kelus-drakar').stance).toBe('defensive');
    expect(previewAttack(b, blow()).status).toBe('unavailable');
    nextTurn(b, fixedDice(''));
    expect(turnInfo(b).active).toBe('pak');
    expect(
      mod(
        b,
        blow({ id: 'p', actor: 'pak', target: 'kelus-drakar', weapon: 'pak:hands' }),
        'Цель в защитной стойке',
      ),
    ).toBe(-20);
  });
});
