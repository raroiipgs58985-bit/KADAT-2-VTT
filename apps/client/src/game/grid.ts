/**
 * Tactical grid geometry: 1 × 1 m cells on a 20 × 20 m map.
 *
 * A token occupies a rectangular footprint of whole cells. Its position is stored as the
 * centre of that footprint in metres, so every distance the Core receives stays a plain
 * straight-line distance between centres (KADAT measures distances in metres; the tables
 * define no diagonal-counting rule). Footprint area is a token property chosen by the GM;
 * it is not derived from the canonical «Размер» trait, whose scale (human = 0) defines no
 * cell count.
 *
 * Blocked cells are an explicit input so that walls, doors and obstacles can join the same
 * placement check later without changing callers.
 */

export const GRID = { cols: 20, rows: 20, cellMeters: 1 } as const;

export interface Footprint {
  readonly width: number;
  readonly height: number;
}
export interface Cell {
  readonly col: number;
  readonly row: number;
}
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Only unambiguous rectangles are offered; other areas need an approved shape first. */
export const footprintPresets: readonly { id: string; label: string; footprint: Footprint }[] = [
  { id: '1x1', label: '1 клетка (1 × 1)', footprint: { width: 1, height: 1 } },
  { id: '2x1', label: '2 клетки (2 × 1, горизонтально)', footprint: { width: 2, height: 1 } },
  { id: '1x2', label: '2 клетки (1 × 2, вертикально)', footprint: { width: 1, height: 2 } },
];
export const SINGLE_CELL: Footprint = footprintPresets[0]!.footprint;

export const area = (f: Footprint) => f.width * f.height;
export const cellKey = (c: Cell) => `${c.col}:${c.row}`;
export const sameFootprint = (a: Footprint, b: Footprint) =>
  a.width === b.width && a.height === b.height;

export function validateFootprint(f: Footprint) {
  if (!footprintPresets.some((p) => sameFootprint(p.footprint, f)))
    throw new Error(
      `Площадь ${f.width} × ${f.height} не согласована: доступны только 1 × 1, 2 × 1 и 1 × 2`,
    );
}

/** Top-left cell of the footprint whose centre is `center`; not necessarily integral. */
export const anchorOf = (center: Point, f: Footprint) => ({
  col: center.x - f.width / 2,
  row: center.y - f.height / 2,
});
export const centerOf = (anchor: Cell, f: Footprint): Point => ({
  x: anchor.col + f.width / 2,
  y: anchor.row + f.height / 2,
});
export function isAligned(center: Point, f: Footprint) {
  const a = anchorOf(center, f);
  return Number.isInteger(a.col) && Number.isInteger(a.row);
}
/** Cells covered by a grid-aligned footprint. */
export function cellsOf(center: Point, f: Footprint): Cell[] {
  if (!isAligned(center, f)) throw new Error('Позиция не привязана к клеткам сетки');
  const a = anchorOf(center, f);
  const cells: Cell[] = [];
  for (let row = a.row; row < a.row + f.height; row++)
    for (let col = a.col; col < a.col + f.width; col++) cells.push({ col, row });
  return cells;
}
/** Nearest grid-aligned centre for a free point, kept inside the map. */
export function snapCenter(point: Point, f: Footprint): Point {
  const a = anchorOf(point, f);
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));
  return centerOf(
    { col: clamp(a.col, GRID.cols - f.width), row: clamp(a.row, GRID.rows - f.height) },
    f,
  );
}
/**
 * Why a footprint cannot stand at `center`, or null when it can. `blocked` holds cells taken
 * by other tokens now, and by walls/obstacles later.
 */
export function placementProblem(
  center: Point,
  f: Footprint,
  blocked: ReadonlySet<string>,
): string | null {
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y))
    return 'Координаты должны быть числами';
  if (!isAligned(center, f)) return 'Позиция не привязана к клеткам сетки';
  const cells = cellsOf(center, f);
  if (cells.some((c) => c.col < 0 || c.row < 0 || c.col >= GRID.cols || c.row >= GRID.rows))
    return `Токен выходит за границы карты ${GRID.cols} × ${GRID.rows} м`;
  if (cells.some((c) => blocked.has(cellKey(c)))) return 'Клетки заняты другим персонажем';
  return null;
}
/** Every grid-aligned centre for a footprint (candidates for movement highlighting). */
export function allCenters(f: Footprint): Point[] {
  const out: Point[] = [];
  for (let row = 0; row <= GRID.rows - f.height; row++)
    for (let col = 0; col <= GRID.cols - f.width; col++) out.push(centerOf({ col, row }, f));
  return out;
}
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
