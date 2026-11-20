import { describe, expect, it } from 'vitest';
import { createBattle, movementProfiles } from './model';
import {
  actorStatus,
  attack,
  getEngine,
  moveActor,
  movementOptions,
  nextTurn,
  placeActor,
  RuleDecisionRequired,
  startCombat,
  turnInfo,
  weaponSupport,
  type MoveMode,
} from './engine';
import { exportReplay, importReplay } from './replay';
import { fixedDice } from './dice';

let serial = 0;
const step = (actor: 'kelus-drakar' | 'pak', mode: MoveMode, x: number, y: number) => ({
  id: `move-${++serial}`,
  actor,
  mode,
  to: { x, y },
});
const started = () => {
  const b = createBattle();
  expect(startCombat(b, fixedDice('')).status).toBe('RESOLVED');
  return b;
};
const option = (b: ReturnType<typeof createBattle>, mode: MoveMode) =>
  movementOptions(b, 'kelus-drakar').find((o) => o.mode === mode)!;

describe('Setup phase', () => {
  it('allows logged GM placement only before combat starts', () => {
    const b = createBattle();
    placeActor(b, 'pak', 12, 9);
    expect(b.positions.pak).toEqual({ x: 12, y: 9 });
    expect(b.log.at(-1)?.type).toBe('placement');
    startCombat(b, fixedDice(''));
    expect(() => placeActor(b, 'pak', 13, 9)).toThrow(/только до начала боя/);
    expect(b.positions.pak).toEqual({ x: 12, y: 9 });
  });

  it('offers no movement before the combat has started', () => {
    const options = movementOptions(createBattle(), 'kelus-drakar');
    expect(options.every((o) => !o.available && /не начат/.test(o.reason!))).toBe(true);
  });

  it('starts the manually ordered first turn through the accepted turn hooks', () => {
    const b = started();
    expect(turnInfo(b)).toMatchObject({ turnActive: true, active: 'kelus-drakar', od: 2 });
    expect(b.log.at(-1)?.type).toBe('combat-start');
    expect(() => startCombat(b, fixedDice(''))).toThrow(/уже начат/);
  });
});

describe('Movement through the accepted Core', () => {
  it('uses the sourced profile СКР and returns Core distances for every mode', () => {
    const b = started();
    expect(getEngine(b).wounds.combat.actors['kelus-drakar']!.movement).toBe(
      movementProfiles['kelus-drakar'].skr,
    );
    expect(option(b, 'free-move')).toMatchObject({ available: true, maxDistance: 2 });
    expect(option(b, 'half-move')).toMatchObject({ available: true, maxDistance: 4 });
    expect(option(b, 'full-move')).toMatchObject({ available: true, maxDistance: 8 });
    for (const mode of ['run', 'sprint'] as const)
      expect(option(b, mode)).toMatchObject({ available: false, blockedBy: 'author' });
  });

  it('spends OD, moves the token and logs the Core execution', () => {
    const b = started();
    const result = moveActor(b, step('kelus-drakar', 'half-move', 8, 10));
    expect(result).toMatchObject({ status: 'RESOLVED', distance: 3, maxDistance: 4 });
    expect(b.positions['kelus-drakar']).toEqual({ x: 8, y: 10 });
    expect(turnInfo(b).od).toBe(1);
    expect(b.log.at(-1)).toMatchObject({
      type: 'move',
      detail: { odBefore: 2, odAfter: 1, distance: 3, maxDistance: 4, committed: true },
    });
    expect(option(b, 'full-move')).toMatchObject({ available: false, blockedBy: 'engine' });
  });

  it('rejects a destination beyond the Core distance without spending anything', () => {
    const b = started();
    const before = structuredClone(b.positions);
    expect(() => moveActor(b, step('kelus-drakar', 'half-move', 9.5, 10))).toThrow(
      /4.50 м больше допустимой 4 м/,
    );
    expect(b.positions).toEqual(before);
    expect(turnInfo(b).od).toBe(2);
    expect(b.log.at(-1)).toMatchObject({ type: 'move-rejected', detail: { committed: false } });
  });

  it('rejects insufficient OD atomically through Core validation', () => {
    const b = started();
    moveActor(b, step('kelus-drakar', 'full-move', 13, 10));
    expect(turnInfo(b).od).toBe(0);
    expect(() => moveActor(b, step('kelus-drakar', 'half-move', 14, 10))).toThrow(
      'Insufficient OD',
    );
    expect(b.positions['kelus-drakar']).toEqual({ x: 13, y: 10 });
  });

  it('allows one free move without OD and blocks a repeat until the author decides', () => {
    const b = started();
    moveActor(b, step('kelus-drakar', 'free-move', 6, 10));
    expect(turnInfo(b).od).toBe(2);
    expect(option(b, 'free-move')).toMatchObject({ available: false, blockedBy: 'author' });
    expect(() => moveActor(b, step('kelus-drakar', 'free-move', 7, 10))).toThrow(
      RuleDecisionRequired,
    );
    expect(b.positions['kelus-drakar']).toEqual({ x: 6, y: 10 });
    expect(b.log.at(-1)).toMatchObject({
      type: 'move-rejected',
      detail: { authorDecisionRequired: true },
    });
  });

  it('never resolves Run or Sprint while their distances are unresolved', () => {
    const b = started();
    expect(() => moveActor(b, step('kelus-drakar', 'run', 6, 10))).toThrow(RuleDecisionRequired);
    expect(turnInfo(b).od).toBe(2);
    expect(turnInfo(b).reactions['kelus-drakar']).toBe(1);
  });

  it('only the active participant moves, and the turn passes through Core', () => {
    const b = started();
    expect(() => moveActor(b, step('pak', 'half-move', 14, 10))).toThrow(/ход другого/);
    nextTurn(b, fixedDice(''));
    expect(turnInfo(b).active).toBe('pak');
    moveActor(b, step('pak', 'half-move', 12, 10));
    expect(b.positions.pak).toEqual({ x: 12, y: 10 });
    expect(movementOptions(b, 'kelus-drakar').every((o) => !o.available)).toBe(true);
  });

  it('rejects destinations outside the map and zero-length moves', () => {
    const b = started();
    expect(() => moveActor(b, step('kelus-drakar', 'half-move', -1, 10))).toThrow(/вне карты/);
    expect(() => moveActor(b, step('kelus-drakar', 'half-move', 5, 10))).toThrow(/совпадает/);
  });

  it('a move and a shot share the same 2 OD and the shot measures the new distance', () => {
    const b = started();
    moveActor(b, step('kelus-drakar', 'half-move', 9, 10));
    const shot = attack(
      b,
      {
        id: 'shot-after-move',
        actor: 'kelus-drakar',
        target: 'pak',
        weapon: 'hotshot',
        targetActivity: 'REST',
        defense: 'DECLINE',
      },
      fixedDice('100:45,10:2,100:20'),
    );
    expect(shot.status).toBe('RESOLVED');
    expect(turnInfo(b).od).toBe(0);
    expect(actorStatus(b, 'pak').wounds).toBe(31);
    const entry = b.log.at(-1)!.detail as { coreLogs: { result?: { distance?: number } }[] };
    expect(JSON.stringify(entry.coreLogs)).toContain('"distance":6');
  });
});

describe('Replay and reporting', () => {
  it('replays combat start, movement and attacks exactly', () => {
    const b = started();
    moveActor(b, step('kelus-drakar', 'free-move', 6.5, 10));
    moveActor(b, step('kelus-drakar', 'half-move', 9, 11));
    nextTurn(b, fixedDice(''));
    moveActor(b, step('pak', 'full-move', 11, 11));
    const replayed = importReplay(JSON.parse(JSON.stringify(exportReplay(b))));
    expect(replayed.positions).toEqual(b.positions);
    expect(replayed.hp).toEqual(b.hp);
    expect(turnInfo(replayed)).toEqual(turnInfo(b));
    expect(replayed.log.map((e) => e.type)).toEqual(b.log.map((e) => e.type));
  });

  it('reports weapon boundaries honestly', () => {
    expect(weaponSupport('hotshot').level).toBe('supported');
    expect(weaponSupport('pak-chain').level).toBe('partial');
    expect(weaponSupport('kelus-chain').level).toBe('blocked');
    expect(weaponSupport('flamer').level).toBe('blocked');
  });
});
