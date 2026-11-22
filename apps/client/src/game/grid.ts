/**
 * Tactical grid geometry: 1 × 1 m cells on a rectangular map (20 × 20 by default).
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
/** Map size in whole cells. X grows to the right, Y downwards, origin at the top-left. */
export interface GridSize {
  readonly cols: number;
  readonly rows: number;
}

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
/**
 * Token area by the «Размер» trait (author ruling 12): Размер 0 and less — 1 × 1 m,
 * Размер 1 — 2 × 2 m, Размер 2 — 3 × 3 m. Larger sizes are not needed yet.
 */
export const footprintPresets: readonly { id: string; label: string; footprint: Footprint }[] = [
  { id: '1x1', label: 'Размер 0 и меньше — 1 × 1', footprint: { width: 1, height: 1 } },
  { id: '2x2', label: 'Размер 1 — 2 × 2', footprint: { width: 2, height: 2 } },
  { id: '3x3', label: 'Размер 2 — 3 × 3', footprint: { width: 3, height: 3 } },
];
export function footprintForSize(size: number): Footprint {
  if (!Number.isInteger(size) || size > 2)
    throw new Error(`Размер ${size}: площадь токена задана только для Размера 2 и меньше`);
  return size <= 0
    ? { width: 1, height: 1 }
    : size === 1
      ? { width: 2, height: 2 }
      : { width: 3, height: 3 };
}
export const SINGLE_CELL: Footprint = footprintPresets[0]!.footprint;

export const area = (f: Footprint) => f.width * f.height;
export const cellKey = (c: Cell) => `${c.col}:${c.row}`;
export const sameFootprint = (a: Footprint, b: Footprint) =>
  a.width === b.width && a.height === b.height;

export function validateFootprint(f: Footprint) {
  if (!footprintPresets.some((p) => sameFootprint(p.footprint, f)))
    throw new Error(
      `Площадь ${f.width} × ${f.height} не задана: по Размеру доступны 1 × 1, 2 × 2 и 3 × 3`,
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
export function snapCenter(point: Point, f: Footprint, size: GridSize = GRID): Point {
  const a = anchorOf(point, f);
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));
  return centerOf(
    { col: clamp(a.col, size.cols - f.width), row: clamp(a.row, size.rows - f.height) },
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
  size: GridSize = GRID,
): string | null {
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y))
    return 'Координаты должны быть числами';
  if (!isAligned(center, f)) return 'Позиция не привязана к клеткам сетки';
  const cells = cellsOf(center, f);
  if (cells.some((c) => c.col < 0 || c.row < 0 || c.col >= size.cols || c.row >= size.rows))
    return `Токен выходит за границы карты ${size.cols} × ${size.rows} м`;
  if (cells.some((c) => blocked.has(cellKey(c)))) return 'Клетки заняты другим персонажем';
  return null;
}
/** Every grid-aligned centre for a footprint (candidates for movement highlighting). */
export function allCenters(f: Footprint, size: GridSize = GRID): Point[] {
  const out: Point[] = [];
  for (let row = 0; row <= size.rows - f.height; row++)
    for (let col = 0; col <= size.cols - f.width; col++) out.push(centerOf({ col, row }, f));
  return out;
}
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
