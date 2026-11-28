import data from './data/fixture.json';
import {
  footprintForSize,
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
import { currentSkr, type CharacterDocument } from './character';
import { characterFromProfile } from './character-file';
import { weaponById, withAmmo } from './arsenal';
import type { ArsenalWeapon } from '../../../../packages/canonical-data/src/arsenal';
/** Any participant of the battle: a character from the library or a profile (step 4). */
export type ActorId = string;
/** A weapon carried by a participant: `${actorId}:${index}` of the character's weapon list. */
export type WeaponId = string;
export type Side = 'a' | 'b';
export interface Combatant {
  readonly id: ActorId;
  readonly character: CharacterDocument;
  /** Token colour / side chosen by the GM. */
  readonly side: Side;
}
export interface BattleWeapon {
  id: WeaponId;
  owner: ActorId;
  name: string;
  /** Arsenal record (ruling 76: weapons in combat come only from the Arsenal); null — not found. */
  arsenal: ArsenalWeapon | null;
  capacity: number | null;
  /** On a sling or chain (rulings 81–82). */
  sling: boolean;
  /** How many are carried (thrown items, ruling 154). */
  count: number;
  /** Spare magazines carried at the start (ruling 156); null — not tracked. */
  spares: number | null;
}
/** Participants in initiative-independent order (the order they were added). */
export const actorIds = (b: Battle): ActorId[] => Object.keys(b.roster);
export function combatant(b: Battle, id: ActorId): Combatant {
  const c = b.roster[id];
  if (!c) throw new Error('Неизвестный персонаж');
  return c;
}
export const actorName = (b: Battle, id: ActorId) => b.roster[id]?.character.name ?? id;
export const maxWounds = (b: Battle, id: ActorId) => combatant(b, id).character.wounds;
export const skrOf = (b: Battle, id: ActorId) => currentSkr(combatant(b, id).character);
export function battleWeapons(b: Battle, owner?: ActorId): BattleWeapon[] {
  const all = actorIds(b).flatMap((id) =>
    combatant(b, id).character.weapons.map((w, i) => {
      // A launcher takes damage, ББ and properties from its ammunition (ruling 167).
      const arsenal = w.ref ? (withAmmo(weaponById(w.ref), w.ammo) ?? null) : null;
      const ammoName = w.ammo && arsenal && w.ammo !== w.ref ? weaponById(w.ammo)?.name : undefined;
      const weaponId = `${id}:${i}`;
      return {
        id: weaponId,
        // Ruling 114: a weapon taken by «Разоружение» belongs to the taker till the fight ends.
        owner: b.taken?.[weaponId] ?? id,
        name: ammoName ? `${w.name} (${ammoName})` : w.name,
        arsenal,
        // Thrown items: the «magazine» is how many are carried (ruling 154).
        capacity:
          arsenal?.weaponClass === 'Метательное' ? (w.count ?? 1) : (arsenal?.magazine ?? null),
        sling: !!w.sling,
        count: w.count ?? 1,
        spares: w.spares ?? null,
      };
    }),
  );
  return owner === undefined ? all : all.filter((w) => w.owner === owner);
}
export const weaponOf = (b: Battle, id: WeaponId) =>
  battleWeapons(b).find((w) => w.id === id) ?? null;
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
export const fixture = deepFreeze(structuredClone(data));
export interface LogEntry {
  id: number;
  type: string;
  detail: unknown;
}
export interface Battle {
  /** Participants by id; tokens, wounds and ammunition are keyed by the same ids. */
  roster: Record<ActorId, Combatant>;
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
  /** Weapons knocked out of the hand lying on the map (ruling 108), centre in metres. */
  loose?: Record<WeaponId, { x: number; y: number }>;
  /** Weapons taken from the enemy by «Разоружение» with 5+ degrees: new owner (ruling 114). */
  taken?: Record<WeaponId, ActorId>;
  log: LogEntry[];
}
export function append(b: Battle, type: string, detail: unknown) {
  b.log.push({ id: b.log.length + 1, type, detail: structuredClone(detail) });
}
/** The default test pair from «Профили персонажей»: Келус and Пак, 10 m apart. */
export const DEFAULT_ROSTER: readonly { id: ActorId; side: Side; at: Point }[] = [
  { id: 'kelus-drakar', side: 'a', at: { x: 5.5, y: 10.5 } },
  { id: 'pak', side: 'b', at: { x: 15.5, y: 10.5 } },
];
export function createBattle(
  participants: readonly {
    character: CharacterDocument;
    side: Side;
    at: Point;
    id?: ActorId;
  }[] = DEFAULT_ROSTER.map((p) => ({ ...p, character: characterFromProfile(p.id) })),
): Battle {
  const roster: Record<ActorId, Combatant> = {};
  const positions: Record<ActorId, Point> = {};
  const footprints: Record<ActorId, Footprint> = {};
  const hp: Record<ActorId, number> = {};
  for (const p of participants) {
    let id = p.id ?? p.character.id;
    for (let n = 2; roster[id]; n++) id = `${p.id ?? p.character.id}-${n}`;
    roster[id] = { id, character: structuredClone(p.character), side: p.side };
    positions[id] = { x: p.at.x, y: p.at.y };
    footprints[id] = footprintForSize(p.character.size);
    hp[id] = p.character.wounds;
  }
  const b: Battle = {
    roster,
    active: Object.keys(roster)[0] ?? '',
    positions,
    footprints,
    map: structuredClone(STANDARD_MAP),
    mapRevision: 0,
    doors: {},
    locks: {},
    sceneRevision: 0,
    snapshots: emptySnapshotStore(),
    hp,
    ammo: {},
    log: [],
  };
  b.ammo = Object.fromEntries(battleWeapons(b).map((w) => [w.id, w.capacity]));
  b.log.push({
    id: 1,
    type: 'loaded',
    detail: {
      participants: Object.values(roster).map((c) => ({
        id: c.id,
        character: c.character,
        side: c.side,
        at: positions[c.id],
      })),
      source: fixture.sources,
      map: 'test placement, not canonical coordinates',
    },
  });
  return b;
}
/** Cells taken by every token except `except` (walls and obstacles will join this set). */
export function occupiedCells(b: Battle, except?: ActorId): Set<string> {
  const taken = new Set<string>();
  for (const id of actorIds(b))
    if (id !== except) for (const c of cellsOf(posOf(b, id), fpOf(b, id))) taken.add(cellKey(c));
  return taken;
}
export function placementProblemFor(
  b: Battle,
  id: ActorId,
  center: Point,
  footprint: Footprint = fpOf(b, id),
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
  const f = fpOf(b, id);
  const others = occupiedCells(b, id);
  let from = posOf(b, id);
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
export function destinationsWithin(
  b: Battle,
  id: ActorId,
  maxDistance: number,
  /** Route mode: the points chosen so far; the next leg starts from the last one. */
  route: readonly Point[] = [],
): Point[] {
  const g0 = sceneGeometry(b);
  const spent = route.length ? planRoute(b, id, route, g0) : null;
  if (spent?.problem) return [];
  const used = spent?.cost ?? 0;
  const from = route.at(-1) ?? posOf(b, id);
  maxDistance -= used;
  if (maxDistance <= 1e-9) return [];
  const f = fpOf(b, id);
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
      const plan = planRoute(b, id, [...route, c], g);
      if (plan.problem === null && plan.cost <= maxDistance + used + 1e-9) out.push(c);
    }
  return out;
}
/** Low-level placement: validates grid alignment, map bounds and overlap, then logs. */
export function move(b: Battle, id: ActorId, x: number, y: number) {
  combatant(b, id);
  const problem = placementProblemFor(b, id, { x, y });
  if (problem) throw new Error(problem);
  const before = posOf(b, id);
  b.positions[id] = { x, y };
  append(b, 'placement', {
    actor: id,
    before,
    after: posOf(b, id),
    cells: cellsOf(posOf(b, id), fpOf(b, id)),
    meters: Math.hypot(x - before.x, y - before.y),
    od: 'manual placement; not a movement action',
  });
}
export function selectActor(b: Battle, id: ActorId) {
  combatant(b, id);
  b.active = id;
  append(b, 'manual-turn', { actor: id });
}
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
  const ids = Object.keys(positions);
  for (const id of ids) {
    const blocked = new Set<string>();
    for (const other of ids)
      if (other !== id)
        for (const c of cellsOf(positions[other]!, footprints[other]!)) blocked.add(cellKey(c));
    const problem =
      placementProblem(positions[id]!, footprints[id]!, blocked, map) ??
      footprintGeometryProblem(positions[id]!, footprints[id]!, g);
    if (problem) out.push({ actor: id, problem });
  }
  return out;
}
/** Token centre of a participant (throws for an unknown id). */
export function posOf(b: Battle, id: ActorId): Point {
  const p = b.positions[id];
  if (!p) throw new Error('Неизвестный персонаж');
  return p;
}
export function fpOf(b: Battle, id: ActorId): Footprint {
  const f = b.footprints[id];
  if (!f) throw new Error('Неизвестный персонаж');
  return f;
}
