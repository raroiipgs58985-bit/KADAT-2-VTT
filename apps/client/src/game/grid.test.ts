import { describe, expect, it } from 'vitest';
import { cellsOf, placementProblem, snapCenter, validateFootprint } from './grid';
import { createBattle, destinationsWithin, occupiedCells, type Battle } from './model';
import {
  moveActor,
  placeActor,
  setFootprint,
  startCombat,
  turnInfo,
  type MoveMode,
} from './engine';
import { exportReplay, importReplay } from './replay';
import { fixedDice } from './dice';

const wide = { width: 2, height: 1 };
const tall = { width: 1, height: 2 };
let n = 0;
const go = (b: Battle, actor: 'kelus-drakar' | 'pak', mode: MoveMode, x: number, y: number) =>
  moveActor(b, { id: `g${++n}`, actor, mode, to: { x, y } });

describe('Grid geometry', () => {
  it('a 1-cell token occupies exactly one cell', () => {
    expect(cellsOf({ x: 5.5, y: 10.5 }, { width: 1, height: 1 })).toEqual([{ col: 5, row: 10 }]);
  });

  it('a 2-cell token occupies exactly two cells in either orientation', () => {
    expect(cellsOf({ x: 6, y: 10.5 }, wide)).toEqual([
      { col: 5, row: 10 },
      { col: 6, row: 10 },
    ]);
    expect(cellsOf({ x: 5.5, y: 11 }, tall)).toEqual([
      { col: 5, row: 10 },
      { col: 5, row: 11 },
    ]);
  });

  it('snaps free points to the nearest cell-aligned centre inside the map', () => {
    expect(snapCenter({ x: 7.2, y: 3.9 }, { width: 1, height: 1 })).toEqual({ x: 7.5, y: 3.5 });
    expect(snapCenter({ x: 7.2, y: 3.9 }, wide)).toEqual({ x: 7, y: 3.5 });
    expect(snapCenter({ x: 25, y: -3 }, wide)).toEqual({ x: 19, y: 0.5 });
  });

  it('rejects off-grid, out-of-map and blocked placements', () => {
    const none = new Set<string>();
    expect(placementProblem({ x: 5.2, y: 10.5 }, wide, none)).toMatch(/не привязана/);
    expect(placementProblem({ x: 20, y: 10.5 }, wide, none)).toMatch(/границы карты/);
    expect(placementProblem({ x: 6, y: 10.5 }, wide, new Set(['6:10']))).toMatch(/заняты/);
    expect(placementProblem({ x: 6, y: 10.5 }, wide, none)).toBeNull();
  });

  it('offers only agreed rectangular areas', () => {
    expect(() => validateFootprint({ width: 3, height: 1 })).toThrow(/не согласована/);
    expect(() => validateFootprint({ width: 2, height: 2 })).toThrow(/не согласована/);
  });
});

describe('Token area in the scene', () => {
  it('sets a 2-cell area before combat, keeping the top-left cell', () => {
    const b = createBattle();
    setFootprint(b, 'pak', wide);
    expect(b.positions.pak).toEqual({ x: 16, y: 10.5 });
    expect(occupiedCells(b, 'kelus-drakar')).toEqual(new Set(['15:10', '16:10']));
    expect(b.log.at(-1)).toMatchObject({ type: 'footprint', detail: { cells: [{}, {}] } });
    startCombat(b, fixedDice(''));
    expect(() => setFootprint(b, 'pak', tall)).toThrow(/до начала боя/);
  });

  it('refuses an area that would leave the map or overlap another token', () => {
    const b = createBattle();
    placeActor(b, 'pak', 19.5, 10.5);
    expect(() => setFootprint(b, 'pak', wide)).toThrow(/границы карты/);
    placeActor(b, 'pak', 4.5, 10.5);
    expect(() => setFootprint(b, 'pak', wide)).toThrow(/заняты/);
    expect(b.footprints.pak).toEqual({ width: 1, height: 1 });
  });

  it('setup placement cannot overlap another token or leave the map', () => {
    const b = createBattle();
    setFootprint(b, 'kelus-drakar', wide); // Kelus now covers 5:10 and 6:10
    expect(() => placeActor(b, 'pak', 6.5, 10.5)).toThrow(/заняты/);
    expect(() => placeActor(b, 'pak', 20.5, 10.5)).toThrow(/границы карты/);
    expect(() => placeActor(b, 'pak', 7.2, 10.5)).toThrow(/не привязана/);
    placeActor(b, 'pak', 7.5, 10.5);
    expect(b.positions.pak).toEqual({ x: 7.5, y: 10.5 });
  });
});

describe('Grid movement through the Core', () => {
  it('a move into another token is rejected before Core spends OD', () => {
    const b = createBattle();
    placeActor(b, 'pak', 8.5, 10.5);
    startCombat(b, fixedDice(''));
    expect(() => go(b, 'kelus-drakar', 'half-move', 8.5, 10.5)).toThrow(/заняты/);
    expect(turnInfo(b).od).toBe(2);
    expect(b.positions['kelus-drakar']).toEqual({ x: 5.5, y: 10.5 });
  });

  it('an off-grid or out-of-map destination is rejected without spending OD', () => {
    const b = createBattle();
    startCombat(b, fixedDice(''));
    expect(() => go(b, 'kelus-drakar', 'half-move', 7.2, 10.5)).toThrow(/не привязана/);
    expect(() => go(b, 'kelus-drakar', 'half-move', 5.5, -0.5)).toThrow(/границы карты/);
    expect(turnInfo(b).od).toBe(2);
  });

  it('a 2-cell token moves by its centre, spends OD and occupies two cells', () => {
    const b = createBattle();
    setFootprint(b, 'kelus-drakar', wide); // centre 6, 10.5
    startCombat(b, fixedDice(''));
    go(b, 'kelus-drakar', 'half-move', 9, 10.5); // 3 m of 4 m
    expect(turnInfo(b).od).toBe(1);
    expect(occupiedCells(b, 'pak')).toEqual(new Set(['8:10', '9:10']));
    expect(b.log.at(-1)).toMatchObject({
      type: 'move',
      detail: { distance: 3, maxDistance: 4, cells: [{ col: 8 }, { col: 9 }] },
    });
  });

  it('highlighted destinations respect distance, map edges, other tokens and token area', () => {
    const b = createBattle();
    placeActor(b, 'pak', 7.5, 10.5);
    const single = destinationsWithin(b, 'kelus-drakar', 2);
    expect(single).toContainEqual({ x: 6.5, y: 11.5 }); // diagonal 1.41 m
    expect(single).not.toContainEqual({ x: 7.5, y: 10.5 }); // Pak's cell
    expect(single).not.toContainEqual({ x: 7.5, y: 11.5 }); // 2.24 m
    expect(single.every((c) => Math.hypot(c.x - 5.5, c.y - 10.5) <= 2)).toBe(true);

    setFootprint(b, 'kelus-drakar', wide); // covers 5:10, 6:10
    const double = destinationsWithin(b, 'kelus-drakar', 2);
    expect(double).not.toContainEqual({ x: 7, y: 10.5 }); // would cover Pak at 7:10
    expect(double).toContainEqual({ x: 6, y: 11.5 });
    placeActor(b, 'kelus-drakar', 18, 0.5); // covers 17:0, 18:0
    const edge = destinationsWithin(b, 'kelus-drakar', 2);
    expect(edge.every((c) => c.x <= 19 && c.y >= 0.5)).toBe(true);
    expect(edge).not.toContainEqual({ x: 20, y: 0.5 });
  });
});

describe('Replay on the grid', () => {
  it('reproduces the same centres, areas and occupied cells', () => {
    const b = createBattle();
    setFootprint(b, 'pak', tall);
    placeActor(b, 'pak', 12.5, 8);
    startCombat(b, fixedDice(''));
    go(b, 'kelus-drakar', 'half-move', 8.5, 10.5);
    const replayed = importReplay(JSON.parse(JSON.stringify(exportReplay(b))));
    expect(replayed.positions).toEqual(b.positions);
    expect(replayed.footprints).toEqual(b.footprints);
    expect(occupiedCells(replayed)).toEqual(occupiedCells(b));
    expect(occupiedCells(replayed)).toEqual(new Set(['8:10', '12:7', '12:8']));
  });
});
