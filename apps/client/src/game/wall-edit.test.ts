import { describe, expect, it } from 'vitest';
import { emptyMap, type MapDocument } from './map';
import { moveWallEnd, startEditing, loadDocument, tryChange } from './map-editor';
import { createBattle } from './model';

/** A wall (2, 5) → (10, 5) → (10, 12) with a door on its first segment at x 4..5. */
function draft() {
  const m: MapDocument = {
    ...emptyMap('w', 'Стена', 20, 20),
    walls: [
      {
        id: 'w',
        points: [
          { x: 2, y: 5 },
          { x: 10, y: 5 },
          { x: 10, y: 12 },
        ],
      },
    ],
    doors: [
      {
        id: 'door',
        wallId: 'w',
        from: { x: 4, y: 5 },
        to: { x: 5, y: 5 },
        open: false,
        blocksMovement: true,
        blocksVision: true,
        locked: false,
        lockModifier: 0,
        lockOd: 0,
      },
    ],
  };
  return loadDocument(startEditing(createBattle()).present, m);
}
const move = (end: 'start' | 'end', x: number, y: number) =>
  tryChange(draft(), (m) => moveWallEnd(m, 'w', end, { x, y }));

describe('Editing a wall end', () => {
  it('lengthens or shortens the end segment and keeps the door', () => {
    const longer = move('end', 10, 18);
    expect(longer.problems).toEqual([]);
    expect(longer.draft?.map.walls[0]!.points.at(-1)).toEqual({ x: 10, y: 18 });
    const shorter = move('start', 3, 5);
    expect(shorter.problems).toEqual([]);
    expect(shorter.draft?.map.doors).toHaveLength(1);
  });

  it('may turn the end segment by 90° around its inner vertex', () => {
    expect(move('end', 16, 5).problems).toEqual([]);
  });

  it('refuses a cut that would leave the door off the wall, naming the door', () => {
    const result = move('start', 5, 5); // the door 4..5 would be left outside the wall
    expect(result.draft).toBeNull();
    expect(result.problems.join()).toMatch(/Дверь door не лежит на одном прямом участке стены w/);
  });

  it('refuses a diagonal or zero-length end segment', () => {
    expect(move('end', 13, 15).problems.join()).toMatch(/горизонтальными или вертикальными/);
    expect(move('start', 10, 5).problems.join()).toMatch(/ненулевыми/);
  });

  it('refuses an end that folds back onto the wall itself', () => {
    expect(move('end', 10, 2).problems).toEqual([]); // turning up past the corner is fine
    expect(move('end', 6, 5).problems.join()).toMatch(/накладываются/);
  });

  it('refuses an end outside the map', () => {
    expect(move('end', 10, 25).problems.join()).toMatch(/за границы карты/);
  });
});
