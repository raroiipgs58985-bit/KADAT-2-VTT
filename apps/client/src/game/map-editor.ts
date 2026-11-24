import { cellKey, type Cell, type Point } from './grid';
import {
  emptyMap,
  insideMap,
  mapProblems,
  sameMap,
  segmentLine,
  wallLines,
  type Decoration,
  type Door,
  type FloorColorId,
  type MapBackground,
  type MapDocument,
  type Obstacle,
  type RasterMime,
  type TerrainZone,
  type Vertex,
  type Wall,
} from './map';
import { actorIds, actorName, posOf, tokenConflicts, type ActorId, type Battle } from './model';
import { applyMap } from './engine';

/**
 * Map editor draft and its local undo/redo history. Nothing here touches the battle: the draft
 * reaches the scene only through `applyMap`, which validates the whole draft at once.
 */
export interface EditorDraft {
  readonly map: MapDocument;
  /** Token positions as edited in the draft. */
  readonly positions: Readonly<Record<ActorId, Point>>;
  /**
   * Scene positions the draft positions were based on. A token whose draft position still
   * equals its base was not edited in the draft and follows the live scene; a token edited
   * in the draft whose scene position moved away from the base is a conflict.
   */
  readonly basePositions: Readonly<Record<ActorId, Point>>;
}
export interface EditorHistory {
  readonly past: readonly EditorDraft[];
  readonly present: EditorDraft;
  readonly future: readonly EditorDraft[];
}
const HISTORY_LIMIT = 200;

export function startEditing(b: Battle): EditorHistory {
  return {
    past: [],
    present: {
      map: structuredClone(b.map),
      positions: structuredClone(b.positions),
      basePositions: structuredClone(b.positions),
    },
    future: [],
  };
}
const sameDraft = (a: EditorDraft, b: EditorDraft) =>
  sameMap(a.map, b.map) &&
  JSON.stringify([a.positions, a.basePositions]) === JSON.stringify([b.positions, b.basePositions]);

/** Records one editor operation (a whole gesture counts as one). No-ops are not recorded. */
export function commit(h: EditorHistory, next: EditorDraft): EditorHistory {
  if (sameDraft(h.present, next)) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}
export function undo(h: EditorHistory): EditorHistory {
  const previous = h.past.at(-1);
  return previous
    ? { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] }
    : h;
}
export function redo(h: EditorHistory): EditorHistory {
  const next = h.future[0];
  return next ? { past: [...h.past, h.present], present: next, future: h.future.slice(1) } : h;
}

export const rename = (d: EditorDraft, name: string): EditorDraft => ({
  ...d,
  map: { ...d.map, name },
});
/** Changes the size only; floor and tokens are never clipped or moved implicitly. */
export const resize = (d: EditorDraft, cols: number, rows: number): EditorDraft => ({
  ...d,
  map: { ...d.map, cols, rows },
});
/**
 * A fresh empty map of the given size: no background, floor paint or decorations. Tokens keep
 * their positions and are re-validated against the new size by the usual placement checks.
 */
export const newEmpty = (
  d: EditorDraft,
  id: string,
  name: string,
  cols: number,
  rows: number,
): EditorDraft => ({ ...d, map: emptyMap(id, name, cols, rows) });

/** Paints (or erases with `null`) the given cells; cells outside the map are ignored. */
export function paint(d: EditorDraft, cells: readonly Cell[], colour: FloorColorId | null) {
  const floor = { ...d.map.floor };
  for (const c of cells) {
    if (!insideMap(d.map, c.col, c.row)) continue;
    if (colour) floor[cellKey(c)] = colour;
    else delete floor[cellKey(c)];
  }
  return { ...d, map: { ...d.map, floor } };
}
/**
 * Explicit GM action: erase floor paint outside the current bounds and delete decorations,
 * walls (with their doors), obstacles and zones that do not fit entirely inside them.
 * Nothing is clipped silently.
 */
export function eraseOutside(d: EditorDraft): EditorDraft {
  const floor = Object.fromEntries(
    Object.entries(d.map.floor).filter(([key]) => {
      const [col, row] = key.split(':').map(Number);
      return insideMap(d.map, col!, row!);
    }),
  );
  const fits = (x: { col: number; row: number; width: number; height: number }) =>
    x.col + x.width <= d.map.cols && x.row + x.height <= d.map.rows;
  const walls = d.map.walls.filter((w) =>
    w.points.every((p) => p.x <= d.map.cols && p.y <= d.map.rows),
  );
  const wallIds = new Set(walls.map((w) => w.id));
  return {
    ...d,
    map: {
      ...d.map,
      floor,
      decorations: d.map.decorations.filter(fits),
      walls,
      doors: d.map.doors.filter((x) => wallIds.has(x.wallId)),
      obstacles: d.map.obstacles.filter(fits),
      zones: d.map.zones.filter(fits),
    },
  };
}

/** Replaces the draft map with an opened document; token positions stay as they are. */
export const loadDocument = (d: EditorDraft, map: MapDocument): EditorDraft => ({ ...d, map });

// --- Background -------------------------------------------------------------------------

/** Initial transform for a new raster: fitted to the map width, top-left at the origin. */
export function fitBackground(
  map: MapDocument,
  raster: { mime: RasterMime; data: string; widthPx: number; heightPx: number },
): MapBackground {
  return {
    ...raster,
    x: 0,
    y: 0,
    metersPerPixel: map.cols / raster.widthPx,
    opacity: 0.8,
    locked: false,
  };
}
export const setBackground = (d: EditorDraft, background: MapBackground | null): EditorDraft => ({
  ...d,
  map: { ...d.map, background },
});
export function updateBackground(
  d: EditorDraft,
  patch: Partial<Pick<MapBackground, 'x' | 'y' | 'metersPerPixel' | 'opacity' | 'locked'>>,
): EditorDraft {
  if (!d.map.background) return d;
  return { ...d, map: { ...d.map, background: { ...d.map.background, ...patch } } };
}
/**
 * Two-point calibration: the GM marks two points on the map and states the real distance
 * between them. The scale changes so that the image distance between the points equals that
 * distance; the first point stays where it is. Tokens and geometry are unaffected.
 */
export function calibrateBackground(
  bg: MapBackground,
  first: Point,
  second: Point,
  meters: number,
): MapBackground {
  if (bg.locked) throw new Error('Подложка заблокирована: снимите блокировку для калибровки');
  if (!Number.isFinite(meters) || meters <= 0)
    throw new Error('Укажите известную дистанцию в метрах больше нуля');
  const pixels = Math.hypot(second.x - first.x, second.y - first.y) / bg.metersPerPixel;
  if (!Number.isFinite(pixels) || pixels === 0)
    throw new Error('Точки калибровки совпадают: нулевая длина');
  const metersPerPixel = meters / pixels;
  const k = metersPerPixel / bg.metersPerPixel;
  return {
    ...bg,
    metersPerPixel,
    x: first.x - (first.x - bg.x) * k,
    y: first.y - (first.y - bg.y) * k,
  };
}

// --- Decorations ------------------------------------------------------------------------

export const addDecoration = (d: EditorDraft, decoration: Decoration): EditorDraft => ({
  ...d,
  map: { ...d.map, decorations: [...d.map.decorations, decoration] },
});
export const updateDecoration = (
  d: EditorDraft,
  id: string,
  patch: Partial<Pick<Decoration, 'label' | 'color'>>,
): EditorDraft => ({
  ...d,
  map: {
    ...d.map,
    decorations: d.map.decorations.map((x) => (x.id === id ? { ...x, ...patch } : x)),
  },
});
export const removeDecoration = (d: EditorDraft, id: string): EditorDraft => ({
  ...d,
  map: { ...d.map, decorations: d.map.decorations.filter((x) => x.id !== id) },
});
const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const editedInDraft = (d: EditorDraft, id: ActorId) => {
  const p = d.positions[id],
    base = d.basePositions[id];
  return !!p && !!base && !samePoint(p, base);
};

/**
 * Moves a token in the draft. A token not yet edited in the draft is rebased on its current
 * scene position first, so moving it here never counts as a conflict with the scene.
 */
export function placeToken(d: EditorDraft, id: ActorId, center: Point, scene: Point): EditorDraft {
  return {
    ...d,
    positions: { ...d.positions, [id]: center },
    basePositions: editedInDraft(d, id) ? d.basePositions : { ...d.basePositions, [id]: scene },
  };
}
/** Conflict resolution: keep the draft position and accept that the scene moved meanwhile. */
export const keepDraftPosition = (d: EditorDraft, id: ActorId, scene: Point): EditorDraft => ({
  ...d,
  basePositions: { ...d.basePositions, [id]: scene },
});
/** Conflict resolution: drop the draft edit and follow the current scene position. */
export const takeScenePosition = (d: EditorDraft, id: ActorId, scene: Point): EditorDraft => ({
  ...d,
  positions: { ...d.positions, [id]: scene },
  basePositions: { ...d.basePositions, [id]: scene },
});

/**
 * Positions the draft would apply: unedited tokens follow the live scene, edited ones keep
 * the draft position. `stale` lists tokens moved both in the draft and in the scene.
 */
export function resolveDraftPositions(d: EditorDraft, b: Battle) {
  const positions = {} as Record<ActorId, Point>;
  const stale: { actor: ActorId; draft: Point; scene: Point }[] = [];
  for (const id of actorIds(b)) {
    const edited = editedInDraft(d, id);
    positions[id] = edited ? d.positions[id]! : posOf(b, id);
    if (edited && !samePoint(posOf(b, id), d.basePositions[id]!))
      stale.push({ actor: id, draft: d.positions[id]!, scene: posOf(b, id) });
  }
  return { positions, stale };
}
/** Cells of the rectangle spanned by two corner cells, inclusive. */
export function rectangleCells(a: Cell, b: Cell): Cell[] {
  const cells: Cell[] = [];
  for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row++)
    for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col++)
      cells.push({ col, row });
  return cells;
}

/** Problems that block applying the draft: map problems, token conflicts, stale edits. */
export function draftProblems(d: EditorDraft, b: Battle) {
  const map = mapProblems(d.map);
  const sizeInvalid = map.some((p) => /Ширина|Высота/.test(p));
  const { positions, stale } = resolveDraftPositions(d, b);
  return {
    map,
    tokens: sizeInvalid ? [] : tokenConflicts(d.map, positions, b.footprints),
    stale,
  };
}
/** True when applying the draft would change the scene. */
export function draftDiffers(d: EditorDraft, b: Battle) {
  const { positions, stale } = resolveDraftPositions(d, b);
  return (
    stale.length > 0 ||
    !sameMap(d.map, b.map) ||
    actorIds(b).some((id) => !samePoint(positions[id]!, posOf(b, id)))
  );
}
/** A token was moved both in the draft and in the scene; the GM must choose first. */
export class DraftPositionConflict extends Error {
  override readonly name = 'DraftPositionConflict';
}
/**
 * Applies the draft to the scene: unedited tokens keep their live positions; a token moved
 * both in the draft and in the scene stops the command until the GM resolves it.
 */
export function applyDraft(b: Battle, d: EditorDraft) {
  const { positions, stale } = resolveDraftPositions(d, b);
  if (stale.length)
    throw new DraftPositionConflict(
      `Токен перемещён и в черновике, и в расстановке: ${stale.map((s) => actorName(b, s.actor)).join(', ')}. Выберите, какую позицию оставить.`,
    );
  return applyMap(b, { map: d.map, positions });
}

// --- Environment: walls, doors, obstacles, terrain zones ---------------------------------

/**
 * Applies an environment change only if it introduces no new map problem; otherwise returns
 * the reasons. Existing problems (e.g. a pending resize) do not block unrelated edits.
 */
export function tryChange(
  d: EditorDraft,
  change: (m: MapDocument) => MapDocument,
): { draft: EditorDraft; problems: [] } | { draft: null; problems: string[] } {
  const before = new Set(mapProblems(d.map));
  const map = change(d.map);
  const added = mapProblems(map).filter((p) => !before.has(p));
  return added.length ? { draft: null, problems: added } : { draft: { ...d, map }, problems: [] };
}
export const addWall = (m: MapDocument, wall: Wall): MapDocument => ({
  ...m,
  walls: [...m.walls, wall],
});
/** Deletes a wall together with every door on it, as one change. */
export const removeWall = (m: MapDocument, id: string): MapDocument => ({
  ...m,
  walls: m.walls.filter((w) => w.id !== id),
  doors: m.doors.filter((x) => x.wallId !== id),
});
/**
 * Moves the first or last vertex of a wall. The changed end segment must stay horizontal or
 * vertical and non-zero, and every door on the wall must still lie on one straight segment;
 * otherwise `tryChange` refuses the edit with the reason (doors are never moved or dropped).
 */
export function moveWallEnd(
  m: MapDocument,
  id: string,
  end: 'start' | 'end',
  to: Vertex,
): MapDocument {
  return {
    ...m,
    walls: m.walls.map((w) => {
      if (w.id !== id) return w;
      const points = [...w.points];
      points[end === 'start' ? 0 : points.length - 1] = { x: to.x, y: to.y };
      return { ...w, points };
    }),
  };
}
/** The wall with a straight segment that contains the interval, if any. */
export function hostWall(m: MapDocument, from: Vertex, to: Vertex): Wall | null {
  const line = segmentLine(from, to);
  if (!line) return null;
  return (
    m.walls.find((w) =>
      wallLines(w).some(
        (l) =>
          l && l.axis === line.axis && l.at === line.at && l.from <= line.from && line.to <= l.to,
      ),
    ) ?? null
  );
}
export const addDoor = (m: MapDocument, door: Door): MapDocument => ({
  ...m,
  doors: [...m.doors, door],
});
export const updateDoor = (
  m: MapDocument,
  id: string,
  patch: Partial<Pick<Door, 'open' | 'blocksMovement' | 'blocksVision'>>,
): MapDocument => ({ ...m, doors: m.doors.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
export const removeDoor = (m: MapDocument, id: string): MapDocument => ({
  ...m,
  doors: m.doors.filter((x) => x.id !== id),
});
export const addObstacle = (m: MapDocument, o: Obstacle): MapDocument => ({
  ...m,
  obstacles: [...m.obstacles, o],
});
export const updateObstacle = (
  m: MapDocument,
  id: string,
  patch: Partial<
    Pick<
      Obstacle,
      'label' | 'blocksMovement' | 'blocksVision' | 'notes' | 'coverOb' | 'coverHeight'
    >
  >,
): MapDocument => ({
  ...m,
  obstacles: m.obstacles.map((x) => (x.id === id ? { ...x, ...patch } : x)),
});
/** ОБ of a wall as cover at its corners (ruling 142). */
export const updateWallOb = (m: MapDocument, id: string, ob: number): MapDocument => ({
  ...m,
  walls: m.walls.map((w) => (w.id === id ? { ...w, ob } : w)),
});
export const removeObstacle = (m: MapDocument, id: string): MapDocument => ({
  ...m,
  obstacles: m.obstacles.filter((x) => x.id !== id),
});
export const addZone = (m: MapDocument, z: TerrainZone): MapDocument => ({
  ...m,
  zones: [...m.zones, z],
});
export const updateZone = (
  m: MapDocument,
  id: string,
  patch: Partial<Pick<TerrainZone, 'label' | 'modifier'>>,
): MapDocument => ({
  ...m,
  zones: m.zones.map((x) => (x.id === id ? { ...x, ...patch } : x)),
});
export const removeZone = (m: MapDocument, id: string): MapDocument => ({
  ...m,
  zones: m.zones.filter((x) => x.id !== id),
});
