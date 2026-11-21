import { describe, expect, it } from 'vitest';
import { emptyMap, type MapDocument } from './map';
import { createBattle, destinationsWithin, type Battle } from './model';
import {
  applyMap,
  moveActor,
  placeActor,
  RuleDecisionRequired,
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
function room(doorOpen: boolean): MapDocument {
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
        to: { x: 8, y: 11 },
        open: doorOpen,
        blocksMovement: true,
        blocksVision: true,
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
    zones: [{ id: 'mud', col: 2, row: 2, width: 3, height: 3, label: 'Грязь' }],
  };
}
let n = 0;
const go = (b: Battle, mode: MoveMode, x: number, y: number) =>
  moveActor(b, { id: `e${++n}`, actor: 'kelus-drakar', mode, to: { x, y } });
/** Kelus at (6.5, 10.5) west of the door, Pak far away in the east. */
function scene(doorOpen: boolean) {
  const b = createBattle();
  applyMap(b, {
    map: room(doorOpen),
    positions: { 'kelus-drakar': { x: 6.5, y: 10.5 }, pak: { x: 17.5, y: 17.5 } },
  });
  return b;
}

describe('Combat movement with walls, doors and obstacles', () => {
  it('a move through a closed door is refused before Core spends OD', () => {
    const b = scene(false);
    startCombat(b, fixedDice(''));
    expect(() => go(b, 'half-move', 9.5, 10.5)).toThrow(/Путь пересекает: закрытая дверь/);
    expect(turnInfo(b).od).toBe(2);
    expect(b.positions['kelus-drakar']).toEqual({ x: 6.5, y: 10.5 });
    expect(b.log.at(-1)).toMatchObject({ type: 'move-rejected', detail: { committed: false } });
  });

  it('the same move through the open door succeeds and spends 1 OD', () => {
    const b = scene(true);
    startCombat(b, fixedDice(''));
    expect(go(b, 'half-move', 9.5, 10.5)).toMatchObject({ status: 'RESOLVED', distance: 3 });
    expect(turnInfo(b).od).toBe(1);
  });

  it('a free cell behind the wall is not highlighted and cannot be reached', () => {
    const b = scene(false);
    startCombat(b, fixedDice(''));
    const reachable = destinationsWithin(b, 'kelus-drakar', 8);
    expect(reachable.some((c) => c.x > 8)).toBe(false); // nothing inside the room
    expect(() => go(b, 'full-move', 9.5, 8.5)).toThrow(/Путь пересекает: стена/);
    expect(turnInfo(b).od).toBe(2);
  });

  it('obstacle cells are neither destinations nor passable', () => {
    const b = scene(true);
    placeActor(b, 'kelus-drakar', 9.5, 9.5); // inside the room
    startCombat(b, fixedDice(''));
    expect(() => go(b, 'half-move', 11.5, 9.5)).toThrow(/Ящики/);
    expect(() => go(b, 'full-move', 12.5, 9.5)).toThrow(/Путь пересекает: препятствие «Ящики»/);
    expect(destinationsWithin(b, 'kelus-drakar', 4).some((c) => c.x === 11.5 && c.y < 12)).toBe(
      false,
    );
  });

  it('crossing marked difficult terrain waits for the author and spends nothing', () => {
    const b = scene(true);
    placeActor(b, 'kelus-drakar', 1.5, 3.5);
    startCombat(b, fixedDice(''));
    expect(() => go(b, 'half-move', 5.5, 3.5)).toThrow(RuleDecisionRequired);
    expect(turnInfo(b).od).toBe(2);
    expect(b.log.at(-1)).toMatchObject({ detail: { authorDecisionRequired: true } });
  });

  it('a stale preview (scene changed) is refused, never re-routed', () => {
    const b = scene(true);
    const previewed = b.sceneRevision;
    setDoorOpen(b, 'west-door', false);
    startCombat(b, fixedDice(''));
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
  it('toggles only before combat and logs each change', () => {
    const b = scene(false);
    setDoorOpen(b, 'west-door', true);
    expect(b.doors['west-door']).toBe(true);
    expect(b.log.at(-1)).toMatchObject({
      type: 'door',
      detail: { doorId: 'west-door', open: true },
    });
    expect(() => setDoorOpen(b, 'west-door', true)).toThrow(/уже открыта/);
    startCombat(b, fixedDice(''));
    expect(() => setDoorOpen(b, 'west-door', false)).toThrow(/только на этапе расстановки/);
  });

  it('refuses to close a door while a 2 × 1 token stands in the doorway', () => {
    const b = scene(true);
    setFootprint(b, 'kelus-drakar', { width: 2, height: 1 });
    placeActor(b, 'kelus-drakar', 8, 10.5); // covers 7:10 and 8:10, across the open door
    expect(() => setDoorOpen(b, 'west-door', false)).toThrow(/стоит в проёме/);
    expect(b.doors['west-door']).toBe(true);
  });

  it('a token cannot be placed across a closed door or on an obstacle', () => {
    const b = scene(false);
    setFootprint(b, 'kelus-drakar', { width: 2, height: 1 });
    expect(() => placeActor(b, 'kelus-drakar', 8, 10.5)).toThrow(/поперёк: закрытая дверь/);
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
    startCombat(b, fixedDice(''));
    go(b, 'half-move', 9.5, 10.5);
    expect(() => go(b, 'half-move', 12.5, 10.5)).toThrow(); // crates: refused, not replayed
    const replay = JSON.parse(JSON.stringify(exportReplay(b)));
    expect(replay.steps.map((s: { type: string }) => s.type)).toEqual([
      'map',
      'door',
      'start-combat',
      'move',
    ]);
    const replayed = importReplay(replay);
    expect(replayed.map.walls).toEqual(b.map.walls);
    expect(replayed.doors).toEqual(b.doors);
    expect(replayed.positions).toEqual(b.positions);
    expect(turnInfo(replayed).od).toBe(1);
  });
});
