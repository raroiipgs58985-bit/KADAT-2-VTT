import data from './data/fixture.json';
import {
  SINGLE_CELL,
  cellKey,
  cellsOf,
  distance,
  placementProblem,
  type Footprint,
  type Point,
} from './grid';
import { STANDARD_MAP, type MapDocument } from './map';
import { emptySnapshotStore, type SnapshotStore } from './snapshots';
import {
  buildGeometry,
  footprintGeometryProblem,
  initialDoorStates,
  straightPathProblem,
  terrainAlong,
  type GeometryIndex,
  type PathProblem,
  type TerrainCell,
} from './geometry';
import armorCatalog from './data/canonical-armor.json';
export const pakArmorProperties = armorCatalog.sheets[0]!.data.find((d) => d.startRow === 32)!
  .rowData[0]!.values[2]!.formattedValue;
export type ActorId = 'kelus-drakar' | 'pak';
export const ids: ActorId[] = ['kelus-drakar', 'pak'];
export type WeaponId = 'hotshot' | 'kelus-chain' | 'pak-chain' | 'bracer' | 'flamer';
export const weapons: {
  id: WeaponId;
  owner: ActorId;
  name: string;
  raw: string;
  capacity: number | null;
}[] = [
  {
    id: 'hotshot',
    owner: 'kelus-drakar',
    name: 'Хот-шот лазган',
    raw: data.actors[0]!.profile.find((p) => p.label === 'Снаряжение:')!.note!.split('\n')[0]!,
    capacity: 250,
  },
  {
    id: 'kelus-chain',
    owner: 'kelus-drakar',
    name: 'Цепной меч Келуса',
    raw: data.actors[0]!.profile.find((p) => p.label === 'Снаряжение:')!.note!.split('\n')[1]!,
    capacity: 50,
  },
  ...(['pak-chain', 'bracer', 'flamer'] as WeaponId[]).map((id, i) => ({
    id,
    owner: 'pak' as const,
    name: ['Цепной меч Пака', 'Пирофорный наруч', 'Освящённый огнемёт'][i]!,
    raw: data.actors[1]!.profile.find((p) => p.label === 'Снаряжение:')!.formattedValue!.split(
      '\n',
    )[i]!,
    capacity: [null, 10, 9][i]!,
  })),
];
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
export const fixture = deepFreeze(structuredClone(data));
export const actor = (id: ActorId) => fixture.actors.find((a) => a.id === id)!;
export interface LogEntry {
  id: number;
  type: string;
  detail: unknown;
}
export interface Battle {
  active: ActorId;
  /** Centre of each token's footprint, metres; always aligned to the 1 m grid. */
  positions: Record<ActorId, { x: number; y: number }>;
  /** Cells each token occupies (GM-set token area, not the canonical «Размер»). */
  footprints: Record<ActorId, Footprint>;
  /** Applied map. Changes only through `applyMap`, before combat. */
  map: MapDocument;
  /** Increments on every applied map change; derived indexes are keyed by it. */
  mapRevision: number;
  /** Current open/closed state of each door (session instance; the map holds the initial). */
  doors: Record<string, boolean>;
  /** Current lock state of doors changed by the GM; absent — as the map says. */
  locks: Record<string, boolean>;
  /** Increments whenever the geometry relevant to movement changes (map apply, doors). */
  sceneRevision: number;
  /** Geometry of every applied map, layers shared (see snapshots.ts); replays reference it. */
  snapshots: SnapshotStore;
  hp: Record<ActorId, number>;
  ammo: Record<WeaponId, number | null>;
  log: LogEntry[];
}
export function append(b: Battle, type: string, detail: unknown) {
  b.log.push({ id: b.log.length + 1, type, detail: structuredClone(detail) });
}
export function createBattle(): Battle {
  return {
    active: 'kelus-drakar',
    // Test placement on cell centres; the 10 m separation of the experiment is preserved.
    positions: { 'kelus-drakar': { x: 5.5, y: 10.5 }, pak: { x: 15.5, y: 10.5 } },
    footprints: { 'kelus-drakar': SINGLE_CELL, pak: SINGLE_CELL },
    map: structuredClone(STANDARD_MAP),
    mapRevision: 0,
    doors: {},
    locks: {},
    sceneRevision: 0,
    snapshots: emptySnapshotStore(),
    hp: { 'kelus-drakar': 26, pak: 33 },
    ammo: Object.fromEntries(weapons.map((w) => [w.id, w.capacity])) as Battle['ammo'],
    log: [
      {
        id: 1,
        type: 'loaded',
        detail: {
          source: fixture.sources,
          authorRulings: fixture.authorRulings,
          map: 'test placement, not canonical coordinates',
        },
      },
    ],
  };
}
/** Cells taken by every token except `except` (walls and obstacles will join this set). */
export function occupiedCells(b: Battle, except?: ActorId): Set<string> {
  const taken = new Set<string>();
  for (const id of ids)
    if (id !== except)
      for (const c of cellsOf(b.positions[id], b.footprints[id])) taken.add(cellKey(c));
  return taken;
}
export function placementProblemFor(
  b: Battle,
  id: ActorId,
  center: Point,
  footprint: Footprint = b.footprints[id],
): string | null {
  return (
    placementProblem(center, footprint, occupiedCells(b, id), b.map) ??
    footprintGeometryProblem(center, footprint, sceneGeometry(b))
  );
}
/**
 * Geometry of the applied map with the current door states. Cached per map and door-state
 * object: both are replaced (never mutated) when they change, so the index is rebuilt only
 * after a map apply or a door toggle.
 */
const geometryCache = new WeakMap<MapDocument, { doors: object; index: GeometryIndex }>();
export function sceneGeometry(b: Battle): GeometryIndex {
  const cached = geometryCache.get(b.map);
  if (cached && cached.doors === b.doors) return cached.index;
  const index = buildGeometry(b.map, b.doors);
  geometryCache.set(b.map, { doors: b.doors, index });
  return index;
}

export type MovementProblem = { kind: 'position'; reason: string } | PathProblem;

/** A route by clicked points: each straight leg checked, length and cost with terrain. */
export interface RoutePlan {
  readonly points: readonly Point[];
  /** Metres actually walked: the sum of the legs (author ruling 8). */
  readonly meters: number;
  /** Metres of the centre's path inside difficult terrain. */
  readonly difficult: number;
  /** Movement spent: 1 m of normal ground — 1 m, 1 m of difficult terrain — 2 m (ruling 11). */
  readonly cost: number;
  /** Difficult stretches crossed, in route order; each needs its own ЛВ test when running. */
  readonly zones: readonly TerrainCell[];
  readonly problem: MovementProblem | null;
}
/**
 * The single movement check used by preview, highlighting and execution: every leg of the
 * route (walls, closed doors, obstacles, other tokens) and the final position (grid, bounds,
 * other tokens, obstacles, walls inside the footprint).
 */
export function planRoute(
  b: Battle,
  id: ActorId,
  points: readonly Point[],
  g: GeometryIndex = sceneGeometry(b),
): RoutePlan {
  const f = b.footprints[id];
  const others = occupiedCells(b, id);
  let from = b.positions[id];
  let meters = 0,
    difficult = 0,
    problem: MovementProblem | null = null;
  const zones: TerrainCell[] = [];
  // The destination first: a taken or invalid end point is the clearest reason.
  const end = points.at(-1);
  if (end) {
    const position = placementProblem(end, f, others, b.map) ?? footprintGeometryProblem(end, f, g);
    if (position) problem = { kind: 'position', reason: position };
  }
  for (const to of problem ? [] : points) {
    const leg = Math.hypot(to.x - from.x, to.y - from.y);
    if (leg === 0) {
      problem = { kind: 'position', reason: 'Точки маршрута совпадают' };
      break;
    }
    problem = straightPathProblem(from, to, f, g, others);
    if (problem) break;
    const terrain = terrainAlong(from, to, g);
    meters += leg;
    difficult += terrain.meters;
    for (const z of terrain.zones) if (!zones.some((x) => x.id === z.id)) zones.push(z);
    from = to;
  }
  return { points, meters, difficult, cost: meters + difficult, zones, problem };
}
export function movementProblem(
  b: Battle,
  id: ActorId,
  to: Point,
  g: GeometryIndex = sceneGeometry(b),
): MovementProblem | null {
  return planRoute(b, id, [to], g).problem;
}
/**
 * Grid-aligned centres reachable in a straight line for at most `maxDistance` metres of
 * movement (difficult terrain counts double). Only anchors inside the square around the token
 * are visited, so the cost does not grow with map size.
 */
export function destinationsWithin(b: Battle, id: ActorId, maxDistance: number): Point[] {
  const from = b.positions[id];
  const f = b.footprints[id];
  const g = sceneGeometry(b);
  const reach = Math.ceil(maxDistance) + 1;
  const col0 = Math.max(0, Math.floor(from.x - f.width / 2) - reach);
  const row0 = Math.max(0, Math.floor(from.y - f.height / 2) - reach);
  const col1 = Math.min(b.map.cols - f.width, Math.ceil(from.x - f.width / 2) + reach);
  const row1 = Math.min(b.map.rows - f.height, Math.ceil(from.y - f.height / 2) + reach);
  const out: Point[] = [];
  for (let row = row0; row <= row1; row++)
    for (let col = col0; col <= col1; col++) {
      const c = { x: col + f.width / 2, y: row + f.height / 2 };
      const d = distance(from, c);
      if (d === 0 || d > maxDistance + 1e-9) continue;
      const plan = planRoute(b, id, [c], g);
      if (plan.problem === null && plan.cost <= maxDistance + 1e-9) out.push(c);
    }
  return out;
}
/** Low-level placement: validates grid alignment, map bounds and overlap, then logs. */
export function move(b: Battle, id: ActorId, x: number, y: number) {
  if (!ids.includes(id)) throw new Error('Неизвестный персонаж');
  const problem = placementProblemFor(b, id, { x, y });
  if (problem) throw new Error(problem);
  const before = b.positions[id];
  b.positions[id] = { x, y };
  append(b, 'placement', {
    actor: id,
    before,
    after: b.positions[id],
    cells: cellsOf(b.positions[id], b.footprints[id]),
    meters: Math.hypot(x - before.x, y - before.y),
    od: 'manual placement; not a movement action',
  });
}
export function selectActor(b: Battle, id: ActorId) {
  if (!ids.includes(id)) throw new Error('Неизвестный Actor');
  b.active = id;
  append(b, 'manual-turn', { actor: id });
}
/**
 * СКР (base movement, metres) per personal profile cell `Движение`. The accepted Core
 * derives every movement distance from this value (Механика / Бой: СД = 1/2 СКР ≤ 5 м,
 * Полудвижение = СКР, Полное движение = СКР×2). Values are read, not computed here.
 */
export const movementProfiles: Record<
  ActorId,
  { skr: number; source: string; profileText: string; openQuestion?: string }
> = {
  'kelus-drakar': {
    skr: 4,
    source: 'Профили / Персонажи Вольного торговца, «Движение» (примечание), строка «Базовый»',
    profileText: '2/4/8/12/24 — Базовый; 3/5/10/15/30 — Броня; 2/4/8/12/24 — Гравишют',
    openQuestion:
      'Профиль указывает отдельную строку «Броня» (СКР 5) для запитанной брони. Какая строка действует в бою — решает автор; до решения используется «Базовый».',
  },
  pak: {
    skr: 4,
    source: 'Профили / Персонажи Вольного торговца, «Движение»',
    profileText: '4/8/12/24',
  },
};

/**
 * Placement problems of every token for a map size and a set of positions (a draft or the
 * current scene). Tokens are checked against the map bounds and against each other.
 */
export function tokenConflicts(
  map: MapDocument,
  positions: Record<ActorId, Point>,
  footprints: Record<ActorId, Footprint>,
  doors: Readonly<Record<string, boolean>> = initialDoorStates(map),
): { actor: ActorId; problem: string }[] {
  const out: { actor: ActorId; problem: string }[] = [];
  const g = buildGeometry(map, doors);
  for (const id of ids) {
    const blocked = new Set<string>();
    for (const other of ids)
      if (other !== id)
        for (const c of cellsOf(positions[other], footprints[other])) blocked.add(cellKey(c));
    const problem =
      placementProblem(positions[id], footprints[id], blocked, map) ??
      footprintGeometryProblem(positions[id], footprints[id], g);
    if (problem) out.push({ actor: id, problem });
  }
  return out;
}
