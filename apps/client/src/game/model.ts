import data from './data/fixture.json';
import {
  SINGLE_CELL,
  allCenters,
  cellKey,
  cellsOf,
  distance,
  placementProblem,
  type Footprint,
  type Point,
} from './grid';
import { STANDARD_MAP, type MapDocument } from './map';
import {
  buildGeometry,
  footprintGeometryProblem,
  initialDoorStates,
  straightPathProblem,
  type GeometryIndex,
  type PathProblem,
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
  /** Increments whenever the geometry relevant to movement changes (map apply, doors). */
  sceneRevision: number;
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
    sceneRevision: 0,
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
/** Geometry of the applied map with the current door states. */
export const sceneGeometry = (b: Battle): GeometryIndex => buildGeometry(b.map, b.doors);

export type MovementProblem = { kind: 'position'; reason: string } | PathProblem;
/**
 * The single movement check used by preview, highlighting and execution: the destination
 * (grid, bounds, other tokens, obstacles, walls inside the footprint) and the straight path
 * (walls, closed doors, obstacles, ambiguous corner contact, difficult terrain).
 */
export function movementProblem(
  b: Battle,
  id: ActorId,
  to: Point,
  g: GeometryIndex = sceneGeometry(b),
): MovementProblem | null {
  const f = b.footprints[id];
  const position =
    placementProblem(to, f, occupiedCells(b, id), b.map) ?? footprintGeometryProblem(to, f, g);
  if (position) return { kind: 'position', reason: position };
  return straightPathProblem(b.positions[id], to, f, g);
}
/** Grid-aligned centres reachable in a straight line within `maxDistance` metres. */
export function destinationsWithin(b: Battle, id: ActorId, maxDistance: number): Point[] {
  const from = b.positions[id];
  const g = sceneGeometry(b);
  return allCenters(b.footprints[id], b.map).filter(
    (c) =>
      distance(from, c) > 0 &&
      distance(from, c) <= maxDistance + 1e-9 &&
      movementProblem(b, id, c, g) === null,
  );
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
