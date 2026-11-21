import { describe, expect, it } from 'vitest';
import { allCenters, cellsOf, placementProblem, snapCenter, type Footprint } from './grid';
import { STANDARD_MAP, emptyMap, mapProblems } from './map';
import {
  commit,
  draftProblems,
  eraseOutside,
  newEmpty,
  paint,
  placeToken,
  rectangleCells,
  redo,
  resize,
  startEditing,
  undo,
} from './map-editor';
import { createBattle, destinationsWithin, occupiedCells } from './model';
import {
  applyMap,
  MapApplyRejected,
  moveActor,
  movementOptions,
  setFootprint,
  startCombat,
  turnInfo,
} from './engine';
import { exportReplay, importReplay, replayExportProblem } from './replay';
import { fixedDice } from './dice';

const presets: [string, Footprint][] = [
  ['1 × 1', { width: 1, height: 1 }],
  ['2 × 1', { width: 2, height: 1 }],
  ['1 × 2', { width: 1, height: 2 }],
];
const wideMap = { cols: 24, rows: 12 };

describe('Rectangular map geometry', () => {
  it.each(presets)('%s fits the 24 × 12 bounds exactly', (_, f) => {
    const centers = allCenters(f, wideMap);
    expect(centers).toHaveLength((24 - f.width + 1) * (12 - f.height + 1));
    for (const c of centers) expect(placementProblem(c, f, new Set(), wideMap)).toBeNull();
    const last = centers.at(-1)!;
    expect(cellsOf(last, f).at(-1)).toEqual({ col: 23, row: 11 });
  });

  it.each(presets)('%s is refused one cell past each edge of 24 × 12', (_, f) => {
    expect(
      placementProblem({ x: 24 + f.width / 2, y: f.height / 2 }, f, new Set(), wideMap),
    ).toMatch(/24 × 12/);
    expect(
      placementProblem({ x: f.width / 2, y: 12 + f.height / 2 }, f, new Set(), wideMap),
    ).toMatch(/границы/);
    expect(
      placementProblem({ x: f.width / 2 - 1, y: f.height / 2 }, f, new Set(), wideMap),
    ).toMatch(/границы/);
  });

  it.each(presets)('%s snaps into the rectangle and keeps the top-left anchor', (_, f) => {
    const snapped = snapCenter({ x: 99, y: 99 }, f, wideMap);
    expect(cellsOf(snapped, f).at(-1)).toEqual({ col: 23, row: 11 });
    expect(cellsOf(snapCenter({ x: -5, y: -5 }, f, wideMap), f)[0]).toEqual({ col: 0, row: 0 });
  });
});

describe('Map document validation', () => {
  it('accepts the standard scene and a new empty 24 × 12 map', () => {
    expect(mapProblems(STANDARD_MAP)).toEqual([]);
    expect(mapProblems(emptyMap('m1', 'Склад', 24, 12))).toEqual([]);
  });

  it.each([
    [0, 10],
    [201, 10],
    [10, -1],
    [12.5, 10],
    [Number.NaN, 10],
  ])('refuses size %s × %s', (cols, rows) => {
    expect(mapProblems(emptyMap('m', 'Карта', cols, rows)).join(' ')).toMatch(
      /целым числом клеток от 1 до 200/,
    );
  });

  it('refuses an empty or too long name and broken floor cells', () => {
    expect(mapProblems(emptyMap('m', '  ', 10, 10))).toContain('Укажите название карты');
    expect(mapProblems(emptyMap('m', 'x'.repeat(81), 10, 10)).join()).toMatch(/80/);
    const broken = { ...emptyMap('m', 'Карта', 10, 10), floor: { 'a:b': 'grey' as const } };
    expect(mapProblems(broken).join()).toMatch(/Повреждённая/);
  });
});

describe('Editor draft history', () => {
  it('a rectangle fill is one undoable step; undo and redo restore it exactly', () => {
    let h = startEditing(createBattle());
    h = commit(h, paint(h.present, rectangleCells({ col: 1, row: 1 }, { col: 3, row: 2 }), 'sand'));
    expect(Object.keys(h.present.map.floor)).toHaveLength(6);
    h = commit(h, paint(h.present, [{ col: 2, row: 1 }], null));
    expect(Object.keys(h.present.map.floor)).toHaveLength(5);
    h = undo(h);
    expect(Object.keys(h.present.map.floor)).toHaveLength(6);
    h = undo(h);
    expect(h.present.map.floor).toEqual({});
    h = redo(redo(h));
    expect(Object.keys(h.present.map.floor)).toHaveLength(5);
  });

  it('does not record no-op operations and clears redo after a new edit', () => {
    let h = startEditing(createBattle());
    h = commit(h, paint(h.present, [{ col: 99, row: 99 }], 'grey')); // outside: ignored
    expect(h.past).toHaveLength(0);
    h = commit(h, paint(h.present, [{ col: 0, row: 0 }], 'grey'));
    h = undo(h);
    h = commit(h, paint(h.present, [{ col: 1, row: 0 }], 'blue'));
    expect(h.future).toHaveLength(0);
  });

  it('resizing never clips floor paint; erasing outside is an explicit step', () => {
    const b = createBattle();
    let h = startEditing(b);
    h = commit(h, paint(h.present, [{ col: 15, row: 15 }], 'rust'));
    h = commit(h, resize(h.present, 8, 8));
    expect(h.present.map.floor).toEqual({ '15:15': 'rust' });
    expect(draftProblems(h.present, b).map.join()).toMatch(/выходит за новые границы: 1/);
    h = commit(h, eraseOutside(h.present));
    expect(draftProblems(h.present, b).map).toEqual([]);
  });
});

describe('Applying a map to the scene', () => {
  it('20 × 20 → empty 24 × 12 applies atomically with a new revision', () => {
    const b = createBattle();
    let h = startEditing(b);
    h = commit(h, newEmpty(h.present, 'warehouse', 'Склад', 24, 12));
    h = commit(h, paint(h.present, [{ col: 23, row: 11 }], 'grey'));
    applyMap(b, h.present);
    expect(b.map).toMatchObject({
      id: 'warehouse',
      cols: 24,
      rows: 12,
      floor: { '23:11': 'grey' },
    });
    expect(b.mapRevision).toBe(1);
    expect(b.log.at(-1)).toMatchObject({ type: 'map-applied', detail: { cols: 24, revision: 1 } });
    // Tokens can now use the new columns.
    expect(destinationsWithin(b, 'pak', 8).some((c) => c.x > 20)).toBe(true);
  });

  it('shrinking to 8 × 8 with current tokens is refused and changes nothing', () => {
    const b = createBattle();
    const before = JSON.stringify(b);
    const draft = resize(startEditing(b).present, 8, 8);
    expect(draftProblems(draft, b).tokens.map((t) => t.actor)).toEqual(['kelus-drakar', 'pak']);
    let error: unknown;
    try {
      applyMap(b, draft);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MapApplyRejected);
    expect((error as MapApplyRejected).tokenProblems.map((t) => t.actor)).toEqual([
      'kelus-drakar',
      'pak',
    ]);
    expect(JSON.stringify(b)).toBe(before);
  });

  it('the GM can re-place conflicting tokens inside the draft and apply both together', () => {
    const b = createBattle();
    let d = resize(startEditing(b).present, 8, 8);
    d = placeToken(d, 'kelus-drakar', { x: 1.5, y: 1.5 });
    d = placeToken(d, 'pak', { x: 6.5, y: 6.5 });
    applyMap(b, d);
    expect(b.positions).toEqual({ 'kelus-drakar': { x: 1.5, y: 1.5 }, pak: { x: 6.5, y: 6.5 } });
    expect(b.log.at(-1)).toMatchObject({ detail: { repositioned: [{}, {}] } });
  });

  it('a draft that puts tokens on top of each other is refused', () => {
    const b = createBattle();
    const d = placeToken(startEditing(b).present, 'pak', { x: 5.5, y: 10.5 });
    expect(() => applyMap(b, d)).toThrow(/заняты другим персонажем/);
    expect(b.positions.pak).toEqual({ x: 15.5, y: 10.5 });
  });

  it('a 2-cell token keeps its area and anchor checks on the new map', () => {
    const b = createBattle();
    setFootprint(b, 'pak', { width: 2, height: 1 });
    const d = placeToken(resize(startEditing(b).present, 24, 12), 'pak', { x: 23, y: 11.5 });
    applyMap(b, d);
    expect(occupiedCells(b, 'kelus-drakar')).toEqual(new Set(['22:11', '23:11']));
    const outside = placeToken(startEditing(b).present, 'pak', { x: 24, y: 11.5 });
    expect(() => applyMap(b, outside)).toThrow(/границы карты 24 × 12/);
  });

  it('maps change only before combat; combat on the new map uses the same Core budget', () => {
    const b = createBattle();
    applyMap(b, resize(startEditing(b).present, 24, 12));
    startCombat(b, fixedDice(''));
    expect(() => applyMap(b, startEditing(b).present)).toThrow(/до начала боя/);
    expect(movementOptions(b, 'kelus-drakar')[1]).toMatchObject({ maxDistance: 4 });
    moveActor(b, { id: 'm', actor: 'kelus-drakar', mode: 'half-move', to: { x: 8.5, y: 10.5 } });
    expect(turnInfo(b).od).toBe(1);
  });
});

describe('Replay v0.3 and the map', () => {
  it('still imports the original 20 × 20 scenario', () => {
    const b = createBattle();
    startCombat(b, fixedDice(''));
    moveActor(b, { id: 'm1', actor: 'kelus-drakar', mode: 'half-move', to: { x: 8.5, y: 10.5 } });
    const replayed = importReplay(JSON.parse(JSON.stringify(exportReplay(b))));
    expect(replayed.map).toEqual(STANDARD_MAP);
    expect(replayed.positions).toEqual(b.positions);
  });

  it('is refused with a reason once the history used another map size', () => {
    const b = createBattle();
    applyMap(b, resize(startEditing(b).present, 24, 12));
    expect(replayExportProblem(b)).toMatch(/24 × 12/);
    expect(() => exportReplay(b)).toThrow(/24 × 12/);
    applyMap(b, resize(startEditing(b).present, 20, 20));
    expect(replayExportProblem(b)).toMatch(/В истории боя есть карта 24 × 12/);
  });

  it('marks omitted floor paint on a standard-size map', () => {
    const b = createBattle();
    applyMap(b, paint(startEditing(b).present, [{ col: 1, row: 1 }], 'green'));
    const replay = exportReplay(b);
    expect(replay.visualLayersOmitted).toBe(true);
    expect(importReplay(JSON.parse(JSON.stringify(replay))).map.floor).toEqual({});
  });
});
