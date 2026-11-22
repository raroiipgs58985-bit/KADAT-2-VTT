import { describe, expect, it } from 'vitest';
import { emptyMap, mapProblems, type MapDocument, type Obstacle, type Wall } from './map';
import {
  addDoor,
  addObstacle,
  addWall,
  moveWallEnd,
  removeObstacle,
  startEditing,
  tryChange,
  type EditorDraft,
} from './map-editor';
import { createBattle, destinationsWithin, movementProblem, sceneGeometry } from './model';
import { applyMap, moveActor, setDoorOpen, startCombat } from './engine';
import { exportReplay, importReplay } from './replay';
import { fixedDice } from './dice';

/**
 * The TZ load check: a 200 × 200 m map with 500 wall edges and 50 obstacles, then several
 * edits applied one after another. Timings are reported; the assertion threshold is loose so
 * that a slow CI machine does not fail the suite, while the TZ target (p95 ≤ 100 ms on the
 * author's machine) is printed for comparison.
 */
export function bigMap(): MapDocument {
  const walls: Wall[] = [];
  // 25 horizontal walls of 20 edges each = 500 edges, rows y = 40, 46, …, 184.
  for (let i = 0; i < 25; i++) {
    const y = 40 + i * 6;
    const x = 10 + (i % 5) * 36;
    walls.push({
      id: `w${i}`,
      points: [
        { x, y },
        { x: x + 20, y },
      ],
    });
  }
  const obstacles: Obstacle[] = [];
  for (let i = 0; i < 50; i++)
    obstacles.push({
      id: `o${i}`,
      col: 30 + (i % 10) * 15,
      row: 2 + Math.floor(i / 10) * 7,
      width: 2,
      height: 2,
      label: `Ящики ${i + 1}`,
      blocksMovement: true,
      blocksVision: i % 2 === 0,
      notes: '',
    });
  return { ...emptyMap('big', 'Большая карта', 200, 200), walls, obstacles };
}
const p95 = (samples: number[]) =>
  [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]!;
function time(fn: () => void, runs: number) {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  return p95(samples);
}

describe('Large map with several edits (TZ load check)', () => {
  it('stays valid and fast through a sequence of edits', () => {
    const map = bigMap();
    expect(mapProblems(map)).toEqual([]);
    expect(map.walls.reduce((n, w) => n + Math.abs(w.points[1]!.x - w.points[0]!.x), 0)).toBe(500);
    expect(map.obstacles).toHaveLength(50);

    const b = createBattle();
    applyMap(b, { map, positions: b.positions });
    let d: EditorDraft = startEditing(b).present;
    const edit = (change: (m: MapDocument) => MapDocument) => {
      const r = tryChange(d, change);
      expect(r.problems).toEqual([]);
      d = r.draft!;
    };
    // Several edits in a row, each applied to the scene.
    const edits: ((m: MapDocument) => MapDocument)[] = [
      (m) =>
        addWall(m, {
          id: 'room',
          points: [
            { x: 8, y: 6 },
            { x: 14, y: 6 },
            { x: 14, y: 14 },
            { x: 8, y: 14 },
            { x: 8, y: 6 },
          ],
        }),
      (m) =>
        addDoor(m, {
          id: 'room-door',
          wallId: 'room',
          from: { x: 8, y: 10 },
          to: { x: 8, y: 11 },
          open: true,
          blocksMovement: true,
          blocksVision: true,
          locked: false,
          lockModifier: 0,
          lockOd: 0,
        }),
      (m) =>
        addObstacle(m, {
          id: 'crates',
          col: 11,
          row: 8,
          width: 1,
          height: 3,
          label: 'Ящики',
          blocksMovement: true,
          blocksVision: false,
          notes: '',
        }),
      (m) => moveWallEnd(m, 'w0', 'end', { x: 34, y: 40 }),
      (m) => removeObstacle(m, 'o49'),
    ];
    const highlight: number[] = [];
    const queries: number[] = [];
    for (const change of edits) {
      edit(change);
      applyMap(b, { map: d.map, positions: b.positions });
      // First call after an edit rebuilds the cached geometry index.
      highlight.push(time(() => destinationsWithin(b, 'kelus-drakar', 8), 10));
      queries.push(time(() => movementProblem(b, 'kelus-drakar', { x: 12.5, y: 20.5 }), 50));
    }
    setDoorOpen(b, 'room-door', false);
    highlight.push(time(() => destinationsWithin(b, 'kelus-drakar', 8), 10));
    const highlightP95 = Math.max(...highlight);
    const queryP95 = Math.max(...queries);
    console.log(
      `Большая карта 200×200: p95 подсветки ${highlightP95.toFixed(1)} мс, p95 проверки пути ${queryP95.toFixed(2)} мс (цель ТЗ ≤ 100 мс)`,
    );
    expect(highlightP95).toBeLessThan(500);
    expect(queryP95).toBeLessThan(100);

    // The edited geometry is in force: the cached index follows the last apply and door.
    expect(sceneGeometry(b).movementEdges.get('v:8:10')?.kind).toBe('door');
    expect(sceneGeometry(b).movementEdges.has('h:33:40')).toBe(true); // lengthened wall w0
    expect(sceneGeometry(b).blockedCells.has('165:30')).toBe(false); // removed obstacle o49

    // Combat on the edited map, then the replay reproduces it exactly.
    startCombat(b, fixedDice(''));
    expect(() =>
      moveActor(b, {
        id: 'into-room',
        actor: 'kelus-drakar',
        mode: 'full-move',
        to: { x: 9.5, y: 10.5 },
        sceneRevision: b.sceneRevision,
      }),
    ).toThrow(/закрытая дверь/);
    moveActor(b, {
      id: 'south',
      actor: 'kelus-drakar',
      mode: 'full-move',
      to: { x: 5.5, y: 17.5 },
      sceneRevision: b.sceneRevision,
    });
    const replay = JSON.parse(JSON.stringify(exportReplay(b)));
    const replayed = importReplay(replay);
    expect(replayed.positions).toEqual(b.positions);
    expect(replayed.map.walls).toEqual(b.map.walls);
    expect(replay.steps.filter((s: { type: string }) => s.type === 'map')).toHaveLength(6);
  });
});
