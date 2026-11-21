import { cellKey, type Cell, type Point } from './grid';
import { insideMap, mapProblems, type FloorColorId, type MapDocument } from './map';
import { actor, ids, tokenConflicts, type ActorId, type Battle } from './model';
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
const sameDraft = (a: EditorDraft, b: EditorDraft) => JSON.stringify(a) === JSON.stringify(b);

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
/** A fresh empty map of the given size; tokens keep their positions and are re-validated. */
export const newEmpty = (
  d: EditorDraft,
  id: string,
  name: string,
  cols: number,
  rows: number,
): EditorDraft => ({ ...d, map: { ...d.map, id, name, cols, rows, floor: {} } });

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
/** Explicit GM action: erase floor paint left outside the current bounds. */
export function eraseOutside(d: EditorDraft): EditorDraft {
  const floor = Object.fromEntries(
    Object.entries(d.map.floor).filter(([key]) => {
      const [col, row] = key.split(':').map(Number);
      return insideMap(d.map, col!, row!);
    }),
  );
  return { ...d, map: { ...d.map, floor } };
}
const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const editedInDraft = (d: EditorDraft, id: ActorId) =>
  !samePoint(d.positions[id], d.basePositions[id]);

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
  for (const id of ids) {
    const edited = editedInDraft(d, id);
    positions[id] = edited ? d.positions[id] : b.positions[id];
    if (edited && !samePoint(b.positions[id], d.basePositions[id]))
      stale.push({ actor: id, draft: d.positions[id], scene: b.positions[id] });
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
    JSON.stringify(d.map) !== JSON.stringify(b.map) ||
    ids.some((id) => !samePoint(positions[id], b.positions[id]))
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
      `Токен перемещён и в черновике, и в расстановке: ${stale.map((s) => actor(s.actor).name).join(', ')}. Выберите, какую позицию оставить.`,
    );
  return applyMap(b, { map: d.map, positions });
}
