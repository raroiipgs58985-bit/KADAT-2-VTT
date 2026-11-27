import { describe, expect, it } from 'vitest';
import { combatant, createBattle } from './model';
import {
  addCombatant,
  changePosture,
  getEngine,
  moveActor,
  nextTurn,
  placeActor,
  previewAttack,
  setDoorOpen,
  startCombat,
  turnInfo,
  type AttackCommand,
} from './engine';
import { fixedDice } from './dice';
import { stage3Stand } from './scenarios';

// Author rulings 174–176: ranged attacks on a target that runs, lies or is in close combat with
// others get −20 each; they add up.
const shot = (patch: Partial<AttackCommand> = {}): AttackCommand => ({
  id: 'shot',
  actor: 'kelus-drakar',
  target: 'pak',
  weapon: 'kelus-drakar:0',
  targetActivity: 'REST',
  defense: 'DECLINE',
  ...patch,
});
const labels = (b: ReturnType<typeof createBattle>) => {
  const p = previewAttack(b, shot());
  if (p.status !== 'ready') throw new Error(p.reason);
  return p.modifiers.filter((m) => m.value === -20).map((m) => m.label);
};
const pakFirst = () => {
  const b = createBattle();
  startCombat(b, fixedDice('10:2,10:9'));
  expect(turnInfo(b).active).toBe('pak');
  return b;
};
const toKelus = (b: ReturnType<typeof createBattle>) => {
  for (let i = 0; i < 4 && turnInfo(b).active !== 'kelus-drakar'; i++) nextTurn(b, fixedDice(''));
};

describe('ranged target penalties (rulings 174–176)', () => {
  it('a target standing alone and still gets none', () => {
    const b = pakFirst();
    toKelus(b);
    expect(labels(b)).toEqual([]);
  });

  it('«Лечь» is the Free Action and the lying target gives −20', () => {
    const b = pakFirst();
    const od = turnInfo(b).od;
    changePosture(b, { id: 'down', actor: 'pak', to: 'prone' });
    expect(getEngine(b).wounds.combat.actors.pak!.posture).toBe('prone');
    expect(turnInfo(b).od).toBe(od);
    expect(() => changePosture(b, { id: 'kneel', actor: 'pak', to: 'kneeling' })).toThrow();
    toKelus(b);
    expect(labels(b)).toEqual(['Цель лежит']);
  });

  it('a kneeling target gives nothing', () => {
    const b = pakFirst();
    changePosture(b, { id: 'kneel', actor: 'pak', to: 'kneeling' });
    toKelus(b);
    expect(labels(b)).toEqual([]);
  });

  it('a full move counts as running until the target’s next turn starts', () => {
    const b = pakFirst();
    moveActor(b, { id: 'm', actor: 'pak', mode: 'full-move', to: { x: 15.5, y: 6.5 } });
    toKelus(b);
    expect(labels(b)).toEqual(['Цель бежит']);
    nextTurn(b, fixedDice('')); // Pak's next turn starts: he stands still this time
    toKelus(b);
    expect(labels(b)).toEqual([]);
  });

  it('a half move is not running', () => {
    const b = pakFirst();
    moveActor(b, { id: 'm', actor: 'pak', mode: 'half-move', to: { x: 15.5, y: 8.5 } });
    toKelus(b);
    expect(labels(b)).toEqual([]);
  });

  it('next to anyone else (not the shooter) is close combat; penalties add up', () => {
    const b = createBattle();
    addCombatant(b, combatant(b, 'pak').character, 'a');
    const extra = Object.keys(b.roster).find((id) => id !== 'pak' && id !== 'kelus-drakar')!;
    placeActor(b, extra, 16.5, 10.5); // right next to Pak
    startCombat(b, fixedDice('10:2,10:9,10:1'));
    for (let i = 0; i < 4 && turnInfo(b).active !== 'pak'; i++) nextTurn(b, fixedDice(''));
    changePosture(b, { id: 'down', actor: 'pak', to: 'prone' });
    toKelus(b);
    expect(labels(b).sort()).toEqual(['Цель в ближнем бою с другими', 'Цель лежит'].sort());
  });

  it('the shooter standing next to the target does not count', () => {
    const b = createBattle();
    placeActor(b, 'kelus-drakar', 14.5, 10.5);
    startCombat(b, fixedDice('10:9,10:2'));
    expect(turnInfo(b).active).toBe('kelus-drakar');
    expect(labels(b)).toEqual([]);
  });
});

describe('line of fire (ruling 184)', () => {
  it('another participant on the line gives −20', () => {
    const b = createBattle();
    addCombatant(b, combatant(b, 'pak').character, 'b');
    const extra = Object.keys(b.roster).find((id) => id !== 'pak' && id !== 'kelus-drakar')!;
    placeActor(b, extra, 10.5, 10.5); // between Kelus (5.5) and Pak (15.5)
    startCombat(b, fixedDice('10:9,10:2,10:1'));
    for (let i = 0; i < 4 && turnInfo(b).active !== 'kelus-drakar'; i++) nextTurn(b, fixedDice(''));
    expect(labels(b)).toEqual(['На линии огня другой участник']);
  });
});

describe('through an open door (ruling 185)', () => {
  const room = (kelus: { x: number; y: number }, pak: { x: number; y: number }) => {
    const b = stage3Stand();
    setDoorOpen(b, 'west-door', true);
    placeActor(b, 'kelus-drakar', kelus.x, kelus.y);
    placeActor(b, 'pak', pak.x, pak.y);
    startCombat(b, fixedDice('10:9,10:2'));
    expect(turnInfo(b).active).toBe('kelus-drakar');
    return b;
  };
  it('straight through the doorway — no penalty', () => {
    expect(labels(room({ x: 5.5, y: 10.5 }, { x: 10.5, y: 10.5 }))).toEqual([]);
  });
  it('more than 45° to the doorway — −20', () => {
    expect(labels(room({ x: 6.5, y: 7.5 }, { x: 9.5, y: 13.5 }))).toEqual([
      'Сквозь открытую дверь под углом',
    ]);
  });
});
