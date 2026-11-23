import { describe, expect, it } from 'vitest';
import { createBattle, skrOf } from './model';
import {
  actorStatus,
  attack,
  getEngine,
  moveActor,
  movementOptions,
  nextTurn,
  placeActor,
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
  expect(startCombat(b, fixedDice('10:9,10:2')).status).toBe('RESOLVED');
  return b;
};
const option = (b: ReturnType<typeof createBattle>, mode: MoveMode) =>
  movementOptions(b, 'kelus-drakar').find((o) => o.mode === mode)!;

describe('Setup phase', () => {
  it('allows logged GM placement only before combat starts', () => {
    const b = createBattle();
    placeActor(b, 'pak', 12.5, 9.5);
    expect(b.positions.pak).toEqual({ x: 12.5, y: 9.5 });
    expect(b.log.at(-1)?.type).toBe('placement');
    startCombat(b, fixedDice('10:9,10:2'));
    expect(() => placeActor(b, 'pak', 13.5, 9.5)).toThrow(/только до начала боя/);
    expect(b.positions.pak).toEqual({ x: 12.5, y: 9.5 });
  });

  it('offers no movement before the combat has started', () => {
    const options = movementOptions(createBattle(), 'kelus-drakar');
    expect(options.every((o) => !o.available && /не начат/.test(o.reason!))).toBe(true);
  });

  it('starts the manually ordered first turn through the accepted turn hooks', () => {
    const b = started();
    expect(turnInfo(b)).toMatchObject({ turnActive: true, active: 'kelus-drakar', od: 2 });
    expect(b.log.at(-1)?.type).toBe('combat-start');
    expect(() => startCombat(b, fixedDice('10:9,10:2'))).toThrow(/уже начат/);
  });
});

describe('Movement through the accepted Core', () => {
  it('uses the sourced profile СКР and returns Core distances for every mode', () => {
    const b = started();
    expect(getEngine(b).wounds.combat.actors['kelus-drakar']!.movement).toBe(
      skrOf(b, 'kelus-drakar'),
    );
    expect(option(b, 'free-move')).toMatchObject({ available: true, maxDistance: 2 });
    expect(option(b, 'half-move')).toMatchObject({ available: true, maxDistance: 4 });
    expect(option(b, 'full-move')).toMatchObject({ available: true, maxDistance: 8 });
    // Ruling 1: Бег СКР × 6, Спринт СКР × 12 («Бой» A44, A46).
    expect(option(b, 'run')).toMatchObject({ available: true, maxDistance: 24 });
    expect(option(b, 'sprint')).toMatchObject({ available: true, maxDistance: 48 });
  });

  it('spends OD, moves the token and logs the Core execution', () => {
    const b = started();
    const result = moveActor(b, step('kelus-drakar', 'half-move', 8.5, 10.5));
    expect(result).toMatchObject({ status: 'RESOLVED', distance: 3, maxDistance: 4 });
    expect(b.positions['kelus-drakar']).toEqual({ x: 8.5, y: 10.5 });
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
    expect(() => moveActor(b, step('kelus-drakar', 'half-move', 10.5, 10.5))).toThrow(
      /5.00 м больше допустимой 4 м/,
    );
    expect(b.positions).toEqual(before);
    expect(turnInfo(b).od).toBe(2);
    expect(b.log.at(-1)).toMatchObject({ type: 'move-rejected', detail: { committed: false } });
  });

  it('rejects insufficient OD atomically through Core validation', () => {
    const b = started();
    moveActor(b, step('kelus-drakar', 'full-move', 13.5, 10.5));
    expect(turnInfo(b).od).toBe(0);
    expect(() => moveActor(b, step('kelus-drakar', 'half-move', 14.5, 10.5))).toThrow(
      'Insufficient OD',
    );
    expect(b.positions['kelus-drakar']).toEqual({ x: 13.5, y: 10.5 });
  });

  it('allows one free move without OD; the turn’s single Free Action blocks a repeat (ruling 24)', () => {
    const b = started();
    moveActor(b, step('kelus-drakar', 'free-move', 6.5, 10.5));
    expect(turnInfo(b).od).toBe(2);
    expect(option(b, 'free-move')).toMatchObject({ available: false, blockedBy: 'engine' });
    expect(() => moveActor(b, step('kelus-drakar', 'free-move', 7.5, 10.5))).toThrow(
      /Free Action already used/,
    );
    expect(b.positions['kelus-drakar']).toEqual({ x: 6.5, y: 10.5 });
    expect(b.log.at(-1)).toMatchObject({ type: 'move-rejected', detail: { committed: false } });
  });

  it('Run costs 2 OD and the Reaction (ruling 1, «Бой» A44)', () => {
    const b = started();
    moveActor(b, step('kelus-drakar', 'run', 5.5, 2.5));
    expect(turnInfo(b).od).toBe(0);
    expect(turnInfo(b).reactions['kelus-drakar']).toBe(0);
  });

  it('only the active participant moves, and the turn passes through Core', () => {
    const b = started();
    expect(() => moveActor(b, step('pak', 'half-move', 14.5, 10.5))).toThrow(/ход другого/);
    nextTurn(b, fixedDice(''));
    expect(turnInfo(b).active).toBe('pak');
    moveActor(b, step('pak', 'half-move', 12.5, 10.5));
    expect(b.positions.pak).toEqual({ x: 12.5, y: 10.5 });
    expect(movementOptions(b, 'kelus-drakar').every((o) => !o.available)).toBe(true);
  });

  it('rejects destinations outside the map and zero-length moves', () => {
    const b = started();
    expect(() => moveActor(b, step('kelus-drakar', 'half-move', -0.5, 10.5))).toThrow(
      /границы карты/,
    );
    expect(() => moveActor(b, step('kelus-drakar', 'half-move', 5.5, 10.5))).toThrow(/совпадает/);
  });

  it('a move and a shot share the same 2 OD and the shot measures the new distance', () => {
    const b = started();
    moveActor(b, step('kelus-drakar', 'half-move', 9.5, 10.5));
    const shot = attack(
      b,
      {
        id: 'shot-after-move',
        actor: 'kelus-drakar',
        target: 'pak',
        weapon: 'kelus-drakar:0',
        targetActivity: 'REST',
        defense: 'DECLINE',
      },
      fixedDice('100:45,10:2,100:20'),
    );
    expect(shot.status).toBe('RESOLVED');
    expect(turnInfo(b).od).toBe(0);
    expect(actorStatus(b, 'pak').wounds).toBe(29);
    const entry = b.log.at(-1)!.detail as { coreLogs: { result?: { distance?: number } }[] };
    expect(JSON.stringify(entry.coreLogs)).toContain('"distance":6');
  });
});

describe('Replay and reporting', () => {
  it('replays combat start, movement and attacks exactly', () => {
    const b = started();
    moveActor(b, step('kelus-drakar', 'free-move', 7.5, 10.5));
    moveActor(b, step('kelus-drakar', 'half-move', 9.5, 11.5));
    nextTurn(b, fixedDice(''));
    moveActor(b, step('pak', 'full-move', 11.5, 11.5));
    const replayed = importReplay(JSON.parse(JSON.stringify(exportReplay(b))));
    expect(replayed.positions).toEqual(b.positions);
    expect(replayed.hp).toEqual(b.hp);
    expect(turnInfo(replayed)).toEqual(turnInfo(b));
    expect(replayed.log.map((e) => e.type)).toEqual(b.log.map((e) => e.type));
  });

  it('reports weapon boundaries honestly', () => {
    const b = createBattle();
    // «Регулировка мощности» is read but its modes are not offered yet.
    expect(weaponSupport(b, 'kelus-drakar:0').level).not.toBe('blocked');
    expect(weaponSupport(b, 'kelus-drakar:1').level).toBe('supported');
    expect(weaponSupport(b, 'pak:0').level).toBe('blocked');
  });
});
