import { describe, expect, it } from 'vitest';
import { createBattle } from './model';
import {
  attack,
  continueAfterWatch,
  declareOverwatch,
  getEngine,
  moveActor,
  nextTurn,
  placeActor,
  skipOverwatch,
  startCombat,
  turnInfo,
} from './engine';
import { exportReplay, importReplay } from './replay';
import { fixedDice } from './dice';

// «Бой» A63 and rulings 177–178: overwatch — 1 ОД, ends the turn, a 90° sector by heading
// without a range limit, triggers chosen by the player; the shot at the sector entry point.
const setup = (triggers: ('move' | 'attack')[], heading = 0) => {
  const b = createBattle();
  placeActor(b, 'pak', 10.5, 2.5); // outside the sector (to the north-east, −58°)
  startCombat(b, fixedDice('10:9,10:2'));
  expect(turnInfo(b).active).toBe('kelus-drakar');
  declareOverwatch(b, {
    id: 'ow',
    actor: 'kelus-drakar',
    weapon: 'kelus-drakar:0',
    mode: 'single',
    heading,
    triggers,
  });
  nextTurn(b, fixedDice(''));
  expect(turnInfo(b).active).toBe('pak');
  return b;
};
const shot = {
  id: 'ow-shot',
  actor: 'kelus-drakar',
  target: 'pak',
  weapon: 'kelus-drakar:0',
  mode: 'single' as const,
  overwatch: true,
  targetActivity: 'PHYSICAL_ACTION' as const,
  defense: 'DECLINE' as const,
};

describe('overwatch', () => {
  it('declaring spends 1 ОД and ends the turn; the sector is stored', () => {
    const b = setup(['move']);
    const ov = getEngine(b).wounds.combat.actors['kelus-drakar']!.overwatch!;
    expect(ov.sector.widthDegrees).toBe(90);
    expect(ov.sector.headingDegrees).toBe(0);
  });

  it('a move into the sector stops at the entry point; the shot spends the reaction; then on', () => {
    const b = setup(['move']);
    moveActor(b, { id: 'm', actor: 'pak', mode: 'half-move', to: { x: 10.5, y: 6.5 } });
    const w = getEngine(b).pendingWatch!;
    expect(w).toMatchObject({ kind: 'move', watcher: 'kelus-drakar', actor: 'pak', fired: false });
    expect(b.positions.pak).toEqual(w.at);
    expect(b.positions.pak).not.toEqual({ x: 10.5, y: 6.5 });
    // Nothing else happens before the watcher answers.
    expect(() =>
      moveActor(b, { id: 'm2', actor: 'pak', mode: 'free-move', to: { x: 10.5, y: 3.5 } }),
    ).toThrow(/дозор/);
    attack(b, shot, fixedDice('100:90,10:5,10:5,10:5'));
    expect(getEngine(b).pendingWatch!.fired).toBe(true);
    expect(turnInfo(b).reactions['kelus-drakar']).toBeFalsy();
    expect(getEngine(b).wounds.combat.actors['kelus-drakar']!.overwatch).toBeUndefined();
    continueAfterWatch(b, { actor: 'pak' });
    expect(b.positions.pak).toEqual({ x: 10.5, y: 6.5 });
    expect(getEngine(b).pendingWatch).toBeUndefined();
  });

  it('the watcher may pass; a move outside the sector triggers nothing', () => {
    const b = setup(['move']);
    moveActor(b, { id: 'm', actor: 'pak', mode: 'half-move', to: { x: 10.5, y: 6.5 } });
    skipOverwatch(b, { watcher: 'kelus-drakar' });
    const at = getEngine(b).pendingWatch!.at;
    continueAfterWatch(b, { actor: 'pak', stop: true });
    expect(b.positions.pak).toEqual(at);
    expect(turnInfo(b).reactions['kelus-drakar']).toBeTruthy();

    const c = setup(['move'], 180); // facing west: Pak never enters
    moveActor(c, { id: 'm', actor: 'pak', mode: 'half-move', to: { x: 10.5, y: 6.5 } });
    expect(getEngine(c).pendingWatch).toBeUndefined();
    expect(c.positions.pak).toEqual({ x: 10.5, y: 6.5 });
  });

  it('only the chosen triggers fire: «attack» does not react to movement', () => {
    const b = setup(['attack']);
    moveActor(b, { id: 'm', actor: 'pak', mode: 'half-move', to: { x: 10.5, y: 6.5 } });
    expect(getEngine(b).pendingWatch).toBeUndefined();
  });

  it('an attack from the sector: the watcher shoots first, then the attack goes on', () => {
    const b = createBattle();
    startCombat(b, fixedDice('10:9,10:2'));
    declareOverwatch(b, {
      id: 'ow',
      actor: 'kelus-drakar',
      weapon: 'kelus-drakar:0',
      mode: 'single',
      heading: 0,
      triggers: ['attack'],
    });
    nextTurn(b, fixedDice(''));
    const fists = {
      id: 'f',
      actor: 'pak',
      target: 'kelus-drakar',
      weapon: 'pak:hands',
      targetActivity: 'REST' as const,
      defense: 'DECLINE' as const,
    };
    expect(attack(b, fists, fixedDice(''))).toMatchObject({ status: 'WATCHED' });
    expect(getEngine(b).pendingWatch).toMatchObject({ kind: 'attack', fired: false });
    skipOverwatch(b, { watcher: 'kelus-drakar' });
    // The attack itself goes on now (and is refused for its own reason: fists at 10 m).
    expect(() => attack(b, fists, fixedDice('100:50'))).toThrow(/reach|досягаемост/i);
    expect(getEngine(b).pendingWatch).toBeUndefined();
  });

  it('the overwatch ends at the watcher’s next own turn', () => {
    const b = setup(['move'], 180);
    nextTurn(b, fixedDice(''));
    expect(turnInfo(b).active).toBe('kelus-drakar');
    expect(getEngine(b).wounds.combat.actors['kelus-drakar']!.overwatch).toBeUndefined();
  });

  it('a replay restores the stop at the entry point, the shot and the rest of the move', () => {
    const b = setup(['move']);
    moveActor(b, { id: 'm', actor: 'pak', mode: 'half-move', to: { x: 10.5, y: 6.5 } });
    attack(b, shot, fixedDice('100:90,10:5,10:5,10:5'));
    continueAfterWatch(b, { actor: 'pak' });
    const again = importReplay(exportReplay(b));
    expect(again.positions).toEqual(b.positions);
    expect(turnInfo(again).reactions['kelus-drakar']).toBeFalsy();
  });
});
