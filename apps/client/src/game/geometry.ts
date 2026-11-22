import { cellKey, cellsOf, type Footprint, type Point } from './grid';
import { segmentLine, wallLines, type MapDocument } from './map';

/**
 * Map geometry for positions and straight movement paths.
 *
 * Unit edges are keyed `h:x:y` (from (x, y) to (x + 1, y)) and `v:x:y` (from (x, y) to
 * (x, y + 1)). Walls and closed doors block the edges they cover; movement-blocking
 * obstacles occupy cells and block their outer boundary edges. An open door removes every
 * barrier on its opening, including the wall beneath it.
 *
 * Path checks use exact integer arithmetic: all coordinates are multiples of 0.5 m, so they
 * are doubled before any comparison. This makes "touching" and "crossing" decidable.
 */
export interface Blocker {
  readonly kind: 'wall' | 'door' | 'obstacle' | 'token';
  readonly id: string;
  readonly label: string;
}
export interface GeometryIndex {
  readonly cols: number;
  readonly rows: number;
  readonly movementEdges: ReadonlyMap<string, Blocker>;
  readonly visionEdges: ReadonlyMap<string, Blocker>;
  readonly blockedCells: ReadonlyMap<string, Blocker>;
  readonly terrainCells: ReadonlyMap<string, TerrainCell>;
}

export interface TerrainCell {
  readonly id: string;
  readonly label: string;
  readonly modifier: number;
}

export const initialDoorStates = (m: MapDocument): Record<string, boolean> =>
  Object.fromEntries(m.doors.map((d) => [d.id, d.open]));

const lineEdges = (line: { axis: 'h' | 'v'; at: number; from: number; to: number }) => {
  const keys: string[] = [];
  for (let i = line.from; i < line.to; i++)
    keys.push(line.axis === 'h' ? `h:${i}:${line.at}` : `v:${line.at}:${i}`);
  return keys;
};

export function buildGeometry(
  m: MapDocument,
  doorOpen: Readonly<Record<string, boolean>> = initialDoorStates(m),
): GeometryIndex {
  const movementEdges = new Map<string, Blocker>();
  const visionEdges = new Map<string, Blocker>();
  const blockedCells = new Map<string, Blocker>();
  const terrainCells = new Map<string, TerrainCell>();
  for (const w of m.walls) {
    const blocker: Blocker = { kind: 'wall', id: w.id, label: 'стена' };
    for (const line of wallLines(w))
      if (line)
        for (const key of lineEdges(line)) {
          movementEdges.set(key, blocker);
          visionEdges.set(key, blocker);
        }
  }
  for (const d of m.doors) {
    const line = segmentLine(d.from, d.to);
    if (!line) continue;
    const open = doorOpen[d.id] ?? d.open;
    const blocker: Blocker = { kind: 'door', id: d.id, label: 'закрытая дверь' };
    for (const key of lineEdges(line)) {
      if (open || !d.blocksMovement) movementEdges.delete(key);
      else movementEdges.set(key, blocker);
      if (open || !d.blocksVision) visionEdges.delete(key);
      else visionEdges.set(key, blocker);
    }
  }
  const addCells = (
    target: Map<string, Blocker>,
    edges: Map<string, Blocker>,
    filter: (o: MapDocument['obstacles'][number]) => boolean,
  ) => {
    for (const o of m.obstacles) {
      if (!filter(o)) continue;
      const blocker: Blocker = {
        kind: 'obstacle',
        id: o.id,
        label: o.label ? `препятствие «${o.label}»` : 'препятствие',
      };
      for (let row = o.row; row < o.row + o.height; row++)
        for (let col = o.col; col < o.col + o.width; col++) target.set(`${col}:${row}`, blocker);
    }
    // Outer boundary edges of the blocked cells.
    for (const [key, blocker] of target) {
      const [col, row] = key.split(':').map(Number) as [number, number];
      const sides: [string, string][] = [
        [`${col}:${row - 1}`, `h:${col}:${row}`],
        [`${col}:${row + 1}`, `h:${col}:${row + 1}`],
        [`${col - 1}:${row}`, `v:${col}:${row}`],
        [`${col + 1}:${row}`, `v:${col + 1}:${row}`],
      ];
      for (const [neighbour, edge] of sides)
        if (!target.has(neighbour) && !edges.has(edge)) edges.set(edge, blocker);
    }
  };
  addCells(blockedCells, movementEdges, (o) => o.blocksMovement);
  addCells(new Map(), visionEdges, (o) => o.blocksVision);
  for (const z of m.zones)
    for (let row = z.row; row < z.row + z.height; row++)
      for (let col = z.col; col < z.col + z.width; col++)
        terrainCells.set(`${col}:${row}`, {
          id: z.id,
          label: z.label || 'трудный ландшафт',
          modifier: z.modifier,
        });
  return { cols: m.cols, rows: m.rows, movementEdges, visionEdges, blockedCells, terrainCells };
}

const what = (b: Blocker) => b.label;

/** Why a footprint cannot stand at `center` because of the environment, or null. */
export function footprintGeometryProblem(
  center: Point,
  f: Footprint,
  g: GeometryIndex,
): string | null {
  const cells = cellsOf(center, f);
  for (const c of cells) {
    const blocker = g.blockedCells.get(cellKey(c));
    if (blocker) return `Клетки заняты: ${what(blocker)}`;
  }
  const inside = new Set(cells.map(cellKey));
  for (const c of cells) {
    // Edges between two cells of the same footprint: a wall or closed door there means the
    // token would stand across it.
    if (inside.has(`${c.col + 1}:${c.row}`)) {
      const b = g.movementEdges.get(`v:${c.col + 1}:${c.row}`);
      if (b) return `Токен стоит поперёк: ${what(b)}`;
    }
    if (inside.has(`${c.col}:${c.row + 1}`)) {
      const b = g.movementEdges.get(`h:${c.col}:${c.row + 1}`);
      if (b) return `Токен стоит поперёк: ${what(b)}`;
    }
  }
  return null;
}

// --- Exact swept-path geometry (doubled integer coordinates) -----------------------------

type V = { x: number; y: number };
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: V, b: V) => a.x * b.y - a.y * b.x;
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y;

/** Convex hull, counter-clockwise, collinear points removed (Andrew's monotone chain). */
function hull(points: V[]): V[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const build = (list: V[]) => {
    const out: V[] = [];
    for (const q of list) {
      while (out.length >= 2 && cross(sub(out.at(-1)!, out.at(-2)!), sub(q, out.at(-2)!)) <= 0)
        out.pop();
      out.push(q);
    }
    return out;
  };
  const lower = build(p);
  const upper = build([...p].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
const rectCorners = (c: V, hw: number, hh: number): V[] => [
  { x: c.x - hw, y: c.y - hh },
  { x: c.x + hw, y: c.y - hh },
  { x: c.x + hw, y: c.y + hh },
  { x: c.x - hw, y: c.y + hh },
];
const project = (pts: V[], n: V) => {
  let lo = Infinity,
    hi = -Infinity;
  for (const p of pts) {
    const v = dot(p, n);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi };
};
const normals = (poly: V[]) =>
  poly.map((a, i) => {
    const e = sub(poly[(i + 1) % poly.length]!, a);
    return { x: -e.y, y: e.x };
  });
/** 'interior': convex sets overlap with positive extent; 'touch': contact only; 'none'. */
function relation(a: V[], b: V[]): 'interior' | 'touch' | 'none' {
  let touching = false;
  const axes = [...normals(a), ...(b.length > 1 ? normals(b) : [])];
  for (const n of axes) {
    if (n.x === 0 && n.y === 0) continue;
    const pa = project(a, n),
      pb = project(b, n);
    if (pa.hi < pb.lo || pb.hi < pa.lo) return 'none';
    if (pa.hi === pb.lo || pb.hi === pa.lo) touching = true;
  }
  return touching ? 'touch' : 'interior';
}
export type PathProblem = { kind: 'blocked'; blocker: Blocker; reason: string };

/**
 * Checks the whole area a footprint sweeps when moving in a straight line from one centre to
 * another. Crossing a wall, closed door, obstacle edge or another token's cells blocks the move;
 * sliding along one, touching a corner at a single point (author ruling 7) or fitting exactly
 * through an opening is fine. Difficult terrain does not block: it costs double (`terrainAlong`).
 */
export function straightPathProblem(
  from: Point,
  to: Point,
  f: Footprint,
  g: GeometryIndex,
  others: ReadonlySet<string> = new Set(),
): PathProblem | null {
  const a: V = { x: from.x * 2, y: from.y * 2 };
  const b: V = { x: to.x * 2, y: to.y * 2 };
  const hw = f.width,
    hh = f.height; // doubled half sizes
  const swept = hull([...rectCorners(a, hw, hh), ...rectCorners(b, hw, hh)]);
  const box = {
    x0: Math.floor(Math.min(a.x, b.x) / 2 - f.width),
    x1: Math.ceil(Math.max(a.x, b.x) / 2 + f.width),
    y0: Math.floor(Math.min(a.y, b.y) / 2 - f.height),
    y1: Math.ceil(Math.max(a.y, b.y) / 2 + f.height),
  };
  for (let x = box.x0; x <= box.x1; x++)
    for (let y = box.y0; y <= box.y1; y++)
      for (const [key, p2, q2] of [
        [`h:${x}:${y}`, { x: 2 * x, y: 2 * y }, { x: 2 * x + 2, y: 2 * y }],
        [`v:${x}:${y}`, { x: 2 * x, y: 2 * y }, { x: 2 * x, y: 2 * y + 2 }],
      ] as const) {
        const blocker = g.movementEdges.get(key);
        if (blocker && relation(swept, [p2, q2]) === 'interior')
          return { kind: 'blocked', blocker, reason: `Путь пересекает: ${what(blocker)}` };
      }
  for (const key of others) {
    const [col, row] = key.split(':').map(Number) as [number, number];
    if (col < box.x0 || col > box.x1 || row < box.y0 || row > box.y1) continue;
    if (relation(swept, rectCorners({ x: 2 * col + 1, y: 2 * row + 1 }, 1, 1)) === 'interior')
      return {
        kind: 'blocked',
        blocker: { kind: 'token', id: key, label: 'чужой токен' },
        reason: 'Путь проходит сквозь клетку другого персонажа: обойдите (решение 9)',
      };
  }
  return null;
}

/** Part of the segment from `from` to `to` inside the cell [col, col+1] × [row, row+1]. */
function clipToCell(from: Point, to: Point, col: number, row: number): [number, number] | null {
  let t0 = 0,
    t1 = 1;
  const dx = to.x - from.x,
    dy = to.y - from.y;
  for (const [p, q] of [
    [-dx, from.x - col],
    [dx, col + 1 - from.x],
    [-dy, from.y - row],
    [dy, row + 1 - from.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}

/**
 * Difficult terrain along the token centre's straight path: metres inside marked cells and the
 * stretches crossed, in path order (each zone once, by first entry).
 */
export function terrainAlong(
  from: Point,
  to: Point,
  g: GeometryIndex,
): { meters: number; zones: (TerrainCell & { at: number })[] } {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0 || g.terrainCells.size === 0) return { meters: 0, zones: [] };
  let inside = 0;
  const first = new Map<string, TerrainCell & { at: number }>();
  const col0 = Math.floor(Math.min(from.x, to.x)) - 1,
    col1 = Math.floor(Math.max(from.x, to.x)) + 1;
  const row0 = Math.floor(Math.min(from.y, to.y)) - 1,
    row1 = Math.floor(Math.max(from.y, to.y)) + 1;
  for (let row = row0; row <= row1; row++)
    for (let col = col0; col <= col1; col++) {
      const zone = g.terrainCells.get(`${col}:${row}`);
      if (!zone) continue;
      const clip = clipToCell(from, to, col, row);
      if (!clip) continue;
      inside += (clip[1] - clip[0]) * length;
      const known = first.get(zone.id);
      if (!known || clip[0] < known.at) first.set(zone.id, { ...zone, at: clip[0] });
    }
  return {
    meters: Math.round(inside * 1e6) / 1e6,
    zones: [...first.values()].sort((x, y) => x.at - y.at),
  };
}

/**
 * First vision barrier (wall, closed door, vision-blocking obstacle edge) that the straight
 * segment between two points crosses or touches, or null. Exact: coordinates are doubled.
 */
export function sightLineBlocker(from: Point, to: Point, g: GeometryIndex): Blocker | null {
  const a: V = { x: from.x * 2, y: from.y * 2 };
  const b: V = { x: to.x * 2, y: to.y * 2 };
  const orient = (p: V, q: V, r: V) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const within = (p: V, q: V, r: V) =>
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y &&
    r.y <= Math.max(p.y, q.y);
  const meets = (p: V, q: V) => {
    const o1 = orient(a, b, p),
      o2 = orient(a, b, q),
      o3 = orient(p, q, a),
      o4 = orient(p, q, b);
    if (o1 !== o2 && o3 !== o4) return true;
    return (
      (o1 === 0 && within(a, b, p)) ||
      (o2 === 0 && within(a, b, q)) ||
      (o3 === 0 && within(p, q, a)) ||
      (o4 === 0 && within(p, q, b))
    );
  };
  const x0 = Math.floor(Math.min(from.x, to.x)),
    x1 = Math.ceil(Math.max(from.x, to.x));
  const y0 = Math.floor(Math.min(from.y, to.y)),
    y1 = Math.ceil(Math.max(from.y, to.y));
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) {
      const h = g.visionEdges.get(`h:${x}:${y}`);
      if (h && meets({ x: 2 * x, y: 2 * y }, { x: 2 * x + 2, y: 2 * y })) return h;
      const v = g.visionEdges.get(`v:${x}:${y}`);
      if (v && meets({ x: 2 * x, y: 2 * y }, { x: 2 * x, y: 2 * y + 2 })) return v;
    }
  return null;
}
