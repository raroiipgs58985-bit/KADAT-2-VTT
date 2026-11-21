import { describe, expect, it } from 'vitest';
import { buildGeometry, footprintGeometryProblem, straightPathProblem } from './geometry';
import { emptyMap, mapProblems, type MapDocument } from './map';

const one = { width: 1, height: 1 };
const wide = { width: 2, height: 1 }; // 2 × 1, lies along X
const tall = { width: 1, height: 2 }; // 1 × 2, lies along Y

/** 12 × 12 map with a vertical wall on x = 6 from y = 0 to y = 12 and a 1-edge door at y 5..6. */
function walled(doorOpen: boolean | null, extra: Partial<MapDocument> = {}): MapDocument {
  return {
    ...emptyMap('stand', 'Стенд', 12, 12),
    walls: [
      {
        id: 'w1',
        points: [
          { x: 6, y: 0 },
          { x: 6, y: 12 },
        ],
      },
    ],
    doors:
      doorOpen === null
        ? []
        : [
            {
              id: 'd1',
              wallId: 'w1',
              from: { x: 6, y: 5 },
              to: { x: 6, y: 6 },
              open: doorOpen,
              blocksMovement: true,
              blocksVision: true,
            },
          ],
    ...extra,
  };
}
const path = (m: MapDocument, from: [number, number], to: [number, number], f = one) =>
  straightPathProblem({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }, f, buildGeometry(m));

describe('Walls and doors on a straight path (TZ stage 3 stands)', () => {
  it('a free cell right behind a wall is unreachable', () => {
    expect(path(walled(null), [5.5, 2.5], [6.5, 2.5])).toMatchObject({
      kind: 'blocked',
      blocker: { kind: 'wall', id: 'w1' },
    });
    expect(path(walled(null), [5.5, 2.5], [9.5, 6.5])?.kind).toBe('blocked');
  });

  it('an open doorway lets a 1 × 1 token through; a closed door blocks it', () => {
    expect(path(walled(true), [5.5, 5.5], [6.5, 5.5])).toBeNull();
    expect(path(walled(true), [2.5, 5.5], [10.5, 5.5])).toBeNull(); // fits exactly, long run
    expect(path(walled(false), [5.5, 5.5], [6.5, 5.5])).toMatchObject({
      kind: 'blocked',
      blocker: { kind: 'door', id: 'd1' },
    });
  });

  it('a 2 × 1 token fits through a 1-edge door along its length; 1 × 2 across it does not', () => {
    // Moving along X through a door in a vertical wall: the 2 × 1 shape is 1 cell high.
    expect(path(walled(true), [3, 5.5], [9, 5.5], wide)).toBeNull();
    // The 1 × 2 shape is 2 cells high and hits the wall beside the door.
    expect(path(walled(true), [3.5, 6], [9.5, 6], tall)).toMatchObject({
      kind: 'blocked',
      blocker: { kind: 'wall' },
    });
  });

  it('a token cannot stand across a wall or a closed door, but may across an open one', () => {
    const across = { x: 6, y: 5.5 }; // 2 × 1 covering cells 5:5 and 6:5
    expect(footprintGeometryProblem(across, wide, buildGeometry(walled(false)))).toMatch(
      /поперёк: закрытая дверь/,
    );
    expect(footprintGeometryProblem({ x: 6, y: 2.5 }, wide, buildGeometry(walled(true)))).toMatch(
      /поперёк: стена/,
    );
    expect(footprintGeometryProblem(across, wide, buildGeometry(walled(true)))).toBeNull();
    // Touching the wall along the outer boundary is fine.
    expect(
      footprintGeometryProblem({ x: 5, y: 5.5 }, wide, buildGeometry(walled(false))),
    ).toBeNull();
  });

  it('sliding along a wall is not a crossing', () => {
    expect(path(walled(null), [5.5, 0.5], [5.5, 11.5])).toBeNull();
  });

  it('a door that does not block movement when closed (e.g. a curtain) lets tokens pass', () => {
    const m = walled(false);
    const curtain = { ...m, doors: [{ ...m.doors[0]!, blocksMovement: false }] };
    expect(path(curtain, [5.5, 5.5], [6.5, 5.5])).toBeNull();
    expect(buildGeometry(curtain).visionEdges.has('v:6:5')).toBe(true);
  });
});

describe('Obstacles', () => {
  const low = (blocksMovement: boolean, blocksVision: boolean): MapDocument => ({
    ...emptyMap('o', 'Препятствия', 12, 12),
    obstacles: [
      {
        id: 'o1',
        col: 5,
        row: 4,
        width: 1,
        height: 3,
        label: 'Низкая стенка',
        blocksMovement,
        blocksVision,
        notes: 'высота 1 м',
      },
    ],
  });

  it('a low obstacle blocks movement while staying transparent', () => {
    const m = low(true, false);
    expect(path(m, [3.5, 5.5], [7.5, 5.5])).toMatchObject({
      kind: 'blocked',
      blocker: { kind: 'obstacle', label: 'препятствие «Низкая стенка»' },
    });
    const g = buildGeometry(m);
    expect(g.visionEdges.size).toBe(0);
    expect(footprintGeometryProblem({ x: 5.5, y: 5.5 }, one, g)).toMatch(/Клетки заняты/);
  });

  it('a transparent-to-movement obstacle (e.g. smoke marker) blocks vision only', () => {
    const g = buildGeometry(low(false, true));
    expect(g.movementEdges.size).toBe(0);
    expect(g.visionEdges.size).toBe(8); // outer boundary of the 1 × 3 cells
    expect(path(low(false, true), [3.5, 5.5], [7.5, 5.5])).toBeNull();
  });

  it('a diagonal move that cuts across an obstacle corner is blocked', () => {
    const m = low(true, false); // cells x 5, y 4..6
    // Halfway along (center 5, 4) the token would overlap the obstacle corner area.
    expect(path(m, [2.5, 6.5], [6.5, 2.5])).toMatchObject({ kind: 'blocked' });
    expect(path(m, [4.5, 3.5], [6.5, 5.5])).toMatchObject({ kind: 'blocked' });
    // Moving straight past along its edge is fine.
    expect(path(m, [4.5, 1.5], [4.5, 10.5])).toBeNull();
  });
});

describe('Ambiguous corner contact', () => {
  it('a diagonal move whose token corner grazes a wall end is reported, not passed', () => {
    // Wall from (4, 0) down to (4, 4). Token 1 × 1 from (2.5, 5.5) to (5.5, 2.5): its
    // top-right corner travels along the line x + y = 9 and touches the wall end (4, 4)?
    // x + y = 8 at (4, 4): the corner path x + y = 9 misses it; the top-left corner path
    // x + y = 8 passes exactly through (4, 4).
    const m: MapDocument = {
      ...emptyMap('a', 'Угол', 10, 10),
      walls: [
        {
          id: 'w',
          points: [
            { x: 4, y: 0 },
            { x: 4, y: 4 },
          ],
        },
      ],
    };
    const result = path(m, [2.5, 6.5], [6.5, 2.5]);
    expect(result).toMatchObject({ kind: 'ambiguous', at: { x: 4, y: 4 } });
    // The same move one cell lower clears the wall end with room to spare.
    expect(path(m, [2.5, 7.5], [6.5, 3.5])).toBeNull();
  });
});

describe('Difficult terrain', () => {
  it('crossing a marked zone waits for the author; passing beside it does not', () => {
    const m: MapDocument = {
      ...emptyMap('t', 'Болото', 10, 10),
      zones: [{ id: 'z', col: 4, row: 0, width: 2, height: 10, label: 'Болото' }],
    };
    expect(path(m, [2.5, 3.5], [7.5, 3.5])).toMatchObject({ kind: 'terrain' });
    expect(path(m, [2.5, 3.5], [3.5, 8.5])).toBeNull();
  });
});

describe('Environment validation', () => {
  const base = emptyMap('v', 'Проверка', 10, 10);
  it('rejects diagonal, zero-length and coinciding wall segments', () => {
    const diag = {
      ...base,
      walls: [
        {
          id: 'w',
          points: [
            { x: 0, y: 0 },
            { x: 2, y: 2 },
          ],
        },
      ],
    };
    expect(mapProblems(diag).join()).toMatch(/горизонтальными или вертикальными/);
    const zero = {
      ...base,
      walls: [
        {
          id: 'w',
          points: [
            { x: 1, y: 1 },
            { x: 1, y: 1 },
          ],
        },
      ],
    };
    expect(mapProblems(zero).join()).toMatch(/ненулевыми/);
    const overlap = {
      ...base,
      walls: [
        {
          id: 'a',
          points: [
            { x: 0, y: 2 },
            { x: 5, y: 2 },
          ],
        },
        {
          id: 'b',
          points: [
            { x: 4, y: 2 },
            { x: 8, y: 2 },
          ],
        },
      ],
    };
    expect(mapProblems(overlap).join()).toMatch(/совпадает на участке/);
    const joined = {
      ...base,
      walls: [
        {
          id: 'a',
          points: [
            { x: 0, y: 2 },
            { x: 5, y: 2 },
          ],
        },
        {
          id: 'b',
          points: [
            { x: 5, y: 2 },
            { x: 5, y: 8 },
          ],
        },
      ],
    };
    expect(mapProblems(joined)).toEqual([]);
  });

  it('rejects doors off their wall, on two segments, overlapping or dangling', () => {
    const wall = {
      id: 'w',
      points: [
        { x: 0, y: 3 },
        { x: 4, y: 3 },
        { x: 4, y: 8 },
      ],
    };
    const door = (id: string, from: [number, number], to: [number, number], wallId = 'w') => ({
      id,
      wallId,
      from: { x: from[0], y: from[1] },
      to: { x: to[0], y: to[1] },
      open: false,
      blocksMovement: true,
      blocksVision: true,
    });
    const ok = { ...base, walls: [wall], doors: [door('d', [1, 3], [3, 3])] };
    expect(mapProblems(ok)).toEqual([]);
    expect(mapProblems({ ...ok, doors: [door('d', [3, 3], [4, 4])] }).join()).toMatch(
      /горизонтальным или вертикальным/,
    );
    expect(mapProblems({ ...ok, doors: [door('d', [3, 3], [5, 3])] }).join()).toMatch(
      /не лежит на одном прямом участке/,
    );
    expect(
      mapProblems({ ...ok, doors: [door('a', [0, 3], [2, 3]), door('b', [1, 3], [3, 3])] }).join(),
    ).toMatch(/перекрываются/);
    expect(mapProblems({ ...ok, doors: [door('d', [1, 3], [2, 3], 'missing')] }).join()).toMatch(
      /несуществующую стену/,
    );
  });
});
