import { cellKey, type Cell, type Point } from './grid';
import { insideMap, mapProblems, type FloorColorId, type MapDocument } from './map';
import { ids, tokenConflicts, type ActorId, type Battle } from './model';

/**
 * Map editor draft and its local undo/redo history. Nothing here touches the battle: the draft
 * reaches the scene only through `applyMap`, which validates the whole draft at once.
 */
export interface EditorDraft {
  readonly map: MapDocument;
  readonly positions: Readonly<Record<ActorId, Point>>;
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
    present: { map: structuredClone(b.map), positions: structuredClone(b.positions) },
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
export const placeToken = (d: EditorDraft, id: ActorId, center: Point): EditorDraft => ({
  ...d,
  positions: { ...d.positions, [id]: center },
});
/** Cells of the rectangle spanned by two corner cells, inclusive. */
export function rectangleCells(a: Cell, b: Cell): Cell[] {
  const cells: Cell[] = [];
  for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row++)
    for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col++)
      cells.push({ col, row });
  return cells;
}

/** Problems that block applying the draft: map document problems and token conflicts. */
export function draftProblems(d: EditorDraft, b: Battle) {
  const map = mapProblems(d.map);
  const sizeInvalid = map.some((p) => /Ширина|Высота/.test(p));
  return {
    map,
    tokens: sizeInvalid
      ? []
      : tokenConflicts(d.map, d.positions as Record<ActorId, Point>, b.footprints),
  };
}
/** True when the draft differs from the applied scene. */
export function draftDiffers(d: EditorDraft, b: Battle) {
  return (
    JSON.stringify(d.map) !== JSON.stringify(b.map) ||
    ids.some(
      (id) => d.positions[id].x !== b.positions[id].x || d.positions[id].y !== b.positions[id].y,
    )
  );
}
