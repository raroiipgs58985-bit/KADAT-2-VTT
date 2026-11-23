import { describe, expect, it } from 'vitest';
import { cellsOf, footprintForSize, placementProblem, snapCenter, validateFootprint } from './grid';
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

const big = { width: 2, height: 2 }; // Размер 1
const huge = { width: 3, height: 3 }; // Размер 2
let n = 0;
const go = (b: Battle, actor: 'kelus-drakar' | 'pak', mode: MoveMode, x: number, y: number) =>
  moveActor(b, { id: `g${++n}`, actor, mode, to: { x, y } });

describe('Grid geometry', () => {
  it('a 1-cell token occupies exactly one cell', () => {
    expect(cellsOf({ x: 5.5, y: 10.5 }, { width: 1, height: 1 })).toEqual([{ col: 5, row: 10 }]);
  });

  it('Размер 1 occupies 2 × 2 cells, Размер 2 — 3 × 3 (ruling 12)', () => {
    expect(cellsOf({ x: 6, y: 11 }, big)).toHaveLength(4);
    expect(cellsOf({ x: 6, y: 11 }, big)).toContainEqual({ col: 6, row: 11 });
    expect(cellsOf({ x: 6.5, y: 11.5 }, huge)).toHaveLength(9);
    expect(cellsOf({ x: 6.5, y: 11.5 }, huge)).toContainEqual({ col: 7, row: 12 });
  });

  it('snaps free points to the nearest cell-aligned centre inside the map', () => {
    expect(snapCenter({ x: 7.2, y: 3.9 }, { width: 1, height: 1 })).toEqual({ x: 7.5, y: 3.5 });
    expect(snapCenter({ x: 7.2, y: 3.9 }, big)).toEqual({ x: 7, y: 4 });
    expect(snapCenter({ x: 25, y: -3 }, big)).toEqual({ x: 19, y: 1 });
  });

  it('rejects off-grid, out-of-map and blocked placements', () => {
    const none = new Set<string>();
    expect(placementProblem({ x: 5.2, y: 11 }, big, none)).toMatch(/не привязана/);
    expect(placementProblem({ x: 20, y: 11 }, big, none)).toMatch(/границы карты/);
    expect(placementProblem({ x: 6, y: 11 }, big, new Set(['6:10']))).toMatch(/заняты/);
    expect(placementProblem({ x: 6, y: 11 }, big, none)).toBeNull();
  });

  it('offers only the areas tied to Размер', () => {
    expect(() => validateFootprint({ width: 2, height: 1 })).toThrow(/не задана/);
    expect(() => validateFootprint(big)).not.toThrow();
    expect(() => validateFootprint(huge)).not.toThrow();
    expect(footprintForSize(-2)).toEqual({ width: 1, height: 1 });
    expect(footprintForSize(1)).toEqual(big);
    expect(footprintForSize(2)).toEqual(huge);
    expect(() => footprintForSize(3)).toThrow(/Размера 2 и меньше/);
  });
});

describe('Token area in the scene', () => {
  it('sets a 2 × 2 area before combat, keeping the top-left cell', () => {
    const b = createBattle();
    setFootprint(b, 'pak', big);
    expect(b.positions.pak).toEqual({ x: 16, y: 11 });
    expect(occupiedCells(b, 'kelus-drakar')).toEqual(new Set(['15:10', '16:10', '15:11', '16:11']));
    expect(b.log.at(-1)).toMatchObject({ type: 'footprint', detail: { cells: [{}, {}, {}, {}] } });
    startCombat(b, fixedDice('10:9,10:2'));
    expect(() => setFootprint(b, 'pak', huge)).toThrow(/до начала боя/);
  });

  it('refuses an area that would leave the map or overlap another token', () => {
    const b = createBattle();
    placeActor(b, 'pak', 19.5, 10.5);
    expect(() => setFootprint(b, 'pak', big)).toThrow(/границы карты/);
    placeActor(b, 'pak', 4.5, 10.5);
    expect(() => setFootprint(b, 'pak', big)).toThrow(/заняты/);
    expect(b.footprints.pak).toEqual({ width: 1, height: 1 });
  });

  it('setup placement cannot overlap another token or leave the map', () => {
    const b = createBattle();
    setFootprint(b, 'kelus-drakar', big); // Kelus now covers 5–6 × 10–11
    expect(() => placeActor(b, 'pak', 6.5, 11.5)).toThrow(/заняты/);
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
    startCombat(b, fixedDice('10:9,10:2'));
    expect(() => go(b, 'kelus-drakar', 'half-move', 8.5, 10.5)).toThrow(/заняты/);
    expect(turnInfo(b).od).toBe(2);
    expect(b.positions['kelus-drakar']).toEqual({ x: 5.5, y: 10.5 });
  });

  it('an off-grid or out-of-map destination is rejected without spending OD', () => {
    const b = createBattle();
    startCombat(b, fixedDice('10:9,10:2'));
    expect(() => go(b, 'kelus-drakar', 'half-move', 7.2, 10.5)).toThrow(/не привязана/);
    expect(() => go(b, 'kelus-drakar', 'half-move', 5.5, -0.5)).toThrow(/границы карты/);
    expect(turnInfo(b).od).toBe(2);
  });

  it('a 2 × 2 token moves by its centre, spends OD and occupies four cells', () => {
    const b = createBattle();
    setFootprint(b, 'kelus-drakar', big); // centre 6, 11
    startCombat(b, fixedDice('10:9,10:2'));
    go(b, 'kelus-drakar', 'half-move', 9, 11); // 3 m of 4 m
    expect(turnInfo(b).od).toBe(1);
    expect(occupiedCells(b, 'pak')).toEqual(new Set(['8:10', '9:10', '8:11', '9:11']));
    expect(b.log.at(-1)).toMatchObject({ type: 'move', detail: { distance: 3, maxDistance: 4 } });
  });

  it('highlighted destinations respect distance, map edges, other tokens and token area', () => {
    const b = createBattle();
    placeActor(b, 'pak', 7.5, 10.5);
    const single = destinationsWithin(b, 'kelus-drakar', 2);
    expect(single).toContainEqual({ x: 6.5, y: 11.5 }); // diagonal 1.41 m
    expect(single).not.toContainEqual({ x: 7.5, y: 10.5 }); // Pak's cell
    expect(single).not.toContainEqual({ x: 7.5, y: 11.5 }); // 2.24 m
    expect(single.every((c) => Math.hypot(c.x - 5.5, c.y - 10.5) <= 2)).toBe(true);

    setFootprint(b, 'kelus-drakar', big); // covers 5–6 × 10–11
    const double = destinationsWithin(b, 'kelus-drakar', 2);
    expect(double).not.toContainEqual({ x: 7, y: 11 }); // would cover Pak at 7:10
    expect(double).toContainEqual({ x: 6, y: 12 });
    placeActor(b, 'kelus-drakar', 18, 1); // covers 17–18 × 0–1
    const edge = destinationsWithin(b, 'kelus-drakar', 2);
    expect(edge.every((c) => c.x <= 19 && c.y >= 1)).toBe(true);
    expect(edge).not.toContainEqual({ x: 20, y: 1 });
  });
});

describe('Replay on the grid', () => {
  it('reproduces the same centres, areas and occupied cells', () => {
    const b = createBattle();
    setFootprint(b, 'pak', big);
    placeActor(b, 'pak', 12, 8);
    startCombat(b, fixedDice('10:9,10:2'));
    go(b, 'kelus-drakar', 'half-move', 8.5, 10.5);
    const replayed = importReplay(JSON.parse(JSON.stringify(exportReplay(b))));
    expect(replayed.positions).toEqual(b.positions);
    expect(replayed.footprints).toEqual(b.footprints);
    expect(occupiedCells(replayed)).toEqual(occupiedCells(b));
    expect(occupiedCells(replayed)).toEqual(new Set(['8:10', '11:7', '12:7', '11:8', '12:8']));
  });
});
