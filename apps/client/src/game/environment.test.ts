import { describe, expect, it } from 'vitest';
import { emptyMap, type MapDocument } from './map';
import { createBattle, destinationsWithin, type Battle } from './model';
import {
  applyMap,
  moveActor,
  placeActor,
  setDoorLocked,
  setDoorOpen,
  setFootprint,
  startCombat,
  turnInfo,
  type MoveMode,
} from './engine';
import { exportReplay, importReplay } from './replay';
import { fixedDice } from './dice';

/**
 * 20 × 20 room: walls around x 8..14, y 6..14 with a 1-edge door on the west wall (x = 8,
 * y 10..11), a low crate wall inside and a marked mud zone outside.
 */
function room(doorOpen: boolean, wideDoor = false): MapDocument {
  return {
    ...emptyMap('room', 'Комната', 20, 20),
    walls: [
      {
        id: 'room',
        points: [
          { x: 8, y: 6 },
          { x: 14, y: 6 },
          { x: 14, y: 14 },
          { x: 8, y: 14 },
          { x: 8, y: 6 },
        ],
      },
    ],
    doors: [
      {
        id: 'west-door',
        wallId: 'room',
        from: { x: 8, y: 10 },
        to: { x: 8, y: wideDoor ? 12 : 11 },
        open: doorOpen,
        blocksMovement: true,
        blocksVision: true,
        locked: false,
        lockModifier: 0,
        lockOd: 0,
      },
    ],
    obstacles: [
      {
        id: 'crates',
        col: 11,
        row: 8,
        width: 1,
        height: 4,
        label: 'Ящики',
        blocksMovement: true,
        blocksVision: false,
        notes: '',
      },
    ],
    zones: [{ id: 'mud', col: 2, row: 2, width: 3, height: 3, label: 'Грязь', modifier: 0 }],
  };
}
let n = 0;
const go = (b: Battle, mode: MoveMode, x: number, y: number) =>
  moveActor(b, { id: `e${++n}`, actor: 'kelus-drakar', mode, to: { x, y } });
/** Kelus at (6.5, 10.5) west of the door, Pak far away in the east. */
function scene(doorOpen: boolean, wideDoor = false) {
  const b = createBattle();
  applyMap(b, {
    map: room(doorOpen, wideDoor),
    positions: { 'kelus-drakar': { x: 6.5, y: 10.5 }, pak: { x: 17.5, y: 17.5 } },
  });
  return b;
}

describe('Combat movement with walls, doors and obstacles', () => {
  it('a move through a closed door is refused before Core spends OD', () => {
    const b = scene(false);
    startCombat(b, fixedDice('10:9,10:2'));
    expect(() => go(b, 'half-move', 9.5, 10.5)).toThrow(/Путь пересекает: закрытая дверь/);
    expect(turnInfo(b).od).toBe(2);
    expect(b.positions['kelus-drakar']).toEqual({ x: 6.5, y: 10.5 });
    expect(b.log.at(-1)).toMatchObject({ type: 'move-rejected', detail: { committed: false } });
  });

  it('the same move through the open door succeeds and spends 1 OD', () => {
    const b = scene(true);
    startCombat(b, fixedDice('10:9,10:2'));
    expect(go(b, 'half-move', 9.5, 10.5)).toMatchObject({ status: 'RESOLVED', distance: 3 });
    expect(turnInfo(b).od).toBe(1);
  });

  it('a free cell behind the wall is not highlighted and cannot be reached', () => {
    const b = scene(false);
    startCombat(b, fixedDice('10:9,10:2'));
    const reachable = destinationsWithin(b, 'kelus-drakar', 8);
    expect(reachable.some((c) => c.x > 8)).toBe(false); // nothing inside the room
    expect(() => go(b, 'full-move', 9.5, 8.5)).toThrow(/Путь пересекает: стена/);
    expect(turnInfo(b).od).toBe(2);
  });

  it('obstacle cells are neither destinations nor passable', () => {
    const b = scene(true);
    placeActor(b, 'kelus-drakar', 9.5, 9.5); // inside the room
    startCombat(b, fixedDice('10:9,10:2'));
    expect(() => go(b, 'half-move', 11.5, 9.5)).toThrow(/Ящики/);
    expect(() => go(b, 'full-move', 12.5, 9.5)).toThrow(/Путь пересекает: препятствие «Ящики»/);
    expect(destinationsWithin(b, 'kelus-drakar', 4).some((c) => c.x === 11.5 && c.y < 12)).toBe(
      false,
    );
  });

  it('difficult terrain costs double: 4 m with 3 m of mud cost 7 m (ruling 11)', () => {
    const b = scene(true);
    placeActor(b, 'kelus-drakar', 1.5, 3.5);
    startCombat(b, fixedDice('10:9,10:2'));
    expect(() => go(b, 'half-move', 5.5, 3.5)).toThrow(
      /7.00 м \(трудная местность 3.00 м считается вдвое\)/,
    );
    expect(turnInfo(b).od).toBe(2);
    expect(go(b, 'full-move', 5.5, 3.5).status).toBe('RESOLVED');
    expect(b.log.at(-1)).toMatchObject({ type: 'move', detail: { cost: 7, difficult: 3 } });
  });

  it('a stale preview (scene changed) is refused, never re-routed', () => {
    const b = scene(true);
    const previewed = b.sceneRevision;
    setDoorOpen(b, 'west-door', false);
    startCombat(b, fixedDice('10:9,10:2'));
    expect(() =>
      moveActor(b, {
        id: 'stale',
        actor: 'kelus-drakar',
        mode: 'half-move',
        to: { x: 7.5, y: 10.5 },
        sceneRevision: previewed,
      }),
    ).toThrow(/Сцена изменилась/);
    expect(turnInfo(b).od).toBe(2);
  });
});

describe('Doors during setup', () => {
  it('the GM toggles a door before and during combat and each change is logged', () => {
    const b = scene(false);
    setDoorOpen(b, 'west-door', true);
    expect(b.doors['west-door']).toBe(true);
    expect(b.log.at(-1)).toMatchObject({
      type: 'door',
      detail: { doorId: 'west-door', open: true, by: null },
    });
    expect(() => setDoorOpen(b, 'west-door', true)).toThrow(/уже открыта/);
    startCombat(b, fixedDice('10:9,10:2'));
    setDoorOpen(b, 'west-door', false); // the GM, at any moment (ruling 10)
    expect(b.doors['west-door']).toBe(false);
    expect(turnInfo(b).od).toBe(2);
  });

  it('in combat a character opens a door for the Free Action, from any distance (rulings 10, 44)', () => {
    const b = scene(false);
    placeActor(b, 'pak', 17.5, 17.5);
    startCombat(b, fixedDice('10:9,10:2'));
    expect(() => setDoorOpen(b, 'west-door', true, 'pak')).toThrow(/ход другого/);
    setDoorOpen(b, 'west-door', true, 'kelus-drakar');
    expect(b.log.at(-1)).toMatchObject({ detail: { by: 'kelus-drakar', freeAction: true } });
    expect(turnInfo(b).od).toBe(2);
    // The Free Action is spent: no Free Movement and no second door this turn.
    expect(() => setDoorOpen(b, 'west-door', false, 'kelus-drakar')).toThrow(/Free Action/);
    expect(() => go(b, 'free-move', 6.5, 11.5)).toThrow(/Free Action/);
  });

  it('a locked door does not open for a Free Action; the GM unlocks it', () => {
    const b = scene(false);
    setDoorLocked(b, 'west-door', true);
    startCombat(b, fixedDice('10:9,10:2'));
    expect(() => setDoorOpen(b, 'west-door', true, 'kelus-drakar')).toThrow(/заперта/);
    setDoorLocked(b, 'west-door', false);
    setDoorOpen(b, 'west-door', true, 'kelus-drakar');
    expect(b.doors['west-door']).toBe(true);
    expect(importReplay(JSON.parse(JSON.stringify(exportReplay(b)))).doors).toEqual(b.doors);
  });

  it('refuses to close a door while a 2 × 2 token stands in the doorway', () => {
    const b = scene(true, true);
    setFootprint(b, 'kelus-drakar', { width: 2, height: 2 });
    placeActor(b, 'kelus-drakar', 8, 11); // covers 7–8 × 10–11, across the open 2 m door
    expect(() => setDoorOpen(b, 'west-door', false)).toThrow(/стоит в проёме/);
    expect(b.doors['west-door']).toBe(true);
  });

  it('a token cannot be placed across a closed door or on an obstacle', () => {
    const b = scene(false, true);
    setFootprint(b, 'kelus-drakar', { width: 2, height: 2 });
    expect(() => placeActor(b, 'kelus-drakar', 8, 11)).toThrow(/поперёк: закрытая дверь/);
    setFootprint(b, 'pak', { width: 1, height: 1 });
    expect(() => placeActor(b, 'pak', 11.5, 9.5)).toThrow(/Ящики/);
  });

  it('applying a map refuses tokens standing in obstacles or across walls', () => {
    const b = createBattle();
    expect(() =>
      applyMap(b, {
        map: room(false),
        positions: { 'kelus-drakar': { x: 11.5, y: 9.5 }, pak: { x: 17.5, y: 17.5 } },
      }),
    ).toThrow(/Ящики/);
  });
});

describe('Replay v0.4 on a saved geometry snapshot', () => {
  it('reproduces the room, the door change and the accepted move', () => {
    const b = scene(false);
    setDoorOpen(b, 'west-door', true);
    startCombat(b, fixedDice('10:9,10:2'));
    go(b, 'half-move', 9.5, 10.5);
    expect(() => go(b, 'half-move', 12.5, 10.5)).toThrow(); // crates: refused, not replayed
    const replay = JSON.parse(JSON.stringify(exportReplay(b)));
    expect(replay.steps.map((s: { type: string }) => s.type)).toEqual([
      'map',
      'door',
      'start-combat',
      'move',
      'journal', // the refused move: kept in the journal, no game effect
    ]);
    const replayed = importReplay(replay);
    expect(replayed.map.walls).toEqual(b.map.walls);
    expect(replayed.doors).toEqual(b.doors);
    expect(replayed.positions).toEqual(b.positions);
    expect(turnInfo(replayed).od).toBe(1);
  });
});
