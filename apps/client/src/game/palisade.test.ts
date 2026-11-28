import { describe, expect, it } from 'vitest';
import { createBattle } from './model';
import { emptyCharacter } from './character';
import { matchWeaponByName } from './arsenal';
import {
  attack,
  changeStanceGrip,
  getEngine,
  meleeStanceWeapon,
  nextTurn,
  skipOverwatch,
  startCombat,
  takeWeapon,
  turnInfo,
  type AttackCommand,
} from './engine';
import { fixedDice } from './dice';

// «Частокол» (Core palisade trigger, ruling 177): a spear in the palisade stance strikes a
// charging enemy first, when its reach is longer than the charger's.
const battle = () => {
  const spear = matchWeaponByName('Копье')!;
  const sword = matchWeaponByName('Цепной меч')!;
  const b = createBattle([
    {
      character: {
        ...emptyCharacter('c', 'Атакующий'),
        weapons: [{ name: sword.name, ref: sword.id }],
      },
      side: 'a',
      at: { x: 4.5, y: 10.5 },
      id: 'c',
    },
    {
      character: {
        ...emptyCharacter('s', 'Копейщик'),
        weapons: [{ name: spear.name, ref: spear.id }],
      },
      side: 'b',
      at: { x: 10.5, y: 10.5 },
      id: 's',
    },
  ]);
  takeWeapon(b, { id: 'tc', actor: 'c', weapon: 'c:0' });
  takeWeapon(b, { id: 'ts', actor: 's', weapon: 's:0' });
  startCombat(b, fixedDice('10:2,10:9'));
  expect(turnInfo(b).active).toBe('s');
  changeStanceGrip(b, { id: 'pal', actor: 's', weapon: 's:0', stance: 'palisade' });
  nextTurn(b, fixedDice(''));
  expect(turnInfo(b).active).toBe('c');
  return b;
};
const charge: AttackCommand = {
  id: 'charge',
  actor: 'c',
  target: 's',
  weapon: 'c:0',
  targetActivity: 'REST',
  defense: 'DECLINE',
  charge: { x: 9.5, y: 10.5 },
};

describe('palisade', () => {
  it('a charge at the spear stops for the free blow; passing lets the charge go on', () => {
    const b = battle();
    expect(attack(b, charge, fixedDice(''))).toMatchObject({ status: 'WATCHED', watcher: 's' });
    expect(getEngine(b).pendingWatch).toMatchObject({ kind: 'palisade', actor: 'c', fired: false });
    expect(b.positions.c).toEqual({ x: 9.5, y: 10.5 });
    skipOverwatch(b, { watcher: 's' });
    const r = attack(b, charge, { roll: (sides: number) => (sides === 100 ? 99 : 3) });
    expect(r.status).not.toBe('WATCHED');
    expect(getEngine(b).pendingWatch).toBeUndefined();
    expect(b.positions.c).toEqual({ x: 9.5, y: 10.5 });
  });

  it('the free blow is struck with the spear before the charge', () => {
    const b = battle();
    attack(b, charge, fixedDice(''));
    attack(
      b,
      {
        id: 'blow',
        actor: 's',
        target: 'c',
        weapon: meleeStanceWeapon(b, 's'),
        palisade: true,
        targetActivity: 'PHYSICAL_ACTION',
        defense: 'DECLINE',
      },
      { roll: (sides: number) => (sides === 100 ? 99 : 3) },
    );
    expect(getEngine(b).pendingWatch!.fired).toBe(true);
    expect(getEngine(b).wounds.combat.melee!.actors.s!.palisadeSpent).toBe(true);
  });

  it('a standard stance strikes nothing', () => {
    const b = battle();
    nextTurn(b, fixedDice(''));
    changeStanceGrip(b, { id: 'std', actor: 's', weapon: 's:0', stance: 'standard' });
    nextTurn(b, fixedDice(''));
    expect(
      attack(b, { ...charge, id: 'c2' }, { roll: (s: number) => (s === 100 ? 99 : 3) }).status,
    ).not.toBe('WATCHED');
  });
});
