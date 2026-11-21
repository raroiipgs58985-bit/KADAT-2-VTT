import { GRID, cellKey, type GridSize } from './grid';

/**
 * Tactical map document, schema version 1. Holds only map data: size in whole 1 m cells,
 * name, stable ID, an optional background raster with its transform, the visual floor layer
 * and labelled decorations. Camera, zoom and derived indexes are not part of the document.
 * Floor colours, decorations and the background are purely visual: they carry no rule.
 */
export const MAP_SCHEMA_VERSION = 1 as const;
export const MAP_LIMITS = {
  minCells: 1,
  maxCells: 200,
  maxNameLength: 80,
  maxDecorations: 2000,
  maxLabelLength: 60,
} as const;
/** v1 raster limits: source file size, side length and total pixels. */
export const RASTER_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  maxSide: 4096,
  maxPixels: 16_777_216,
} as const;
export const rasterMimes = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type RasterMime = (typeof rasterMimes)[number];

export const floorPalette = [
  { id: 'grey', label: 'Серый', color: '#3b4552' },
  { id: 'sand', label: 'Песочный', color: '#6b5a3c' },
  { id: 'green', label: 'Зелёный', color: '#33513b' },
  { id: 'blue', label: 'Синий', color: '#2f4766' },
  { id: 'rust', label: 'Ржавый', color: '#6a3a2e' },
] as const;
export type FloorColorId = (typeof floorPalette)[number]['id'];
export const floorColor = (id: FloorColorId) => floorPalette.find((p) => p.id === id)!.color;

/** A labelled rectangle of whole cells. Visual only. */
export interface Decoration {
  readonly id: string;
  readonly col: number;
  readonly row: number;
  readonly width: number;
  readonly height: number;
  readonly color: FloorColorId;
  readonly label: string;
}
/**
 * Background raster embedded as base64 with its own transform: top-left corner in metres
 * and a uniform scale in metres per source pixel. Moving or scaling it never moves tokens
 * or geometry.
 */
export interface MapBackground {
  readonly mime: RasterMime;
  readonly data: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly x: number;
  readonly y: number;
  readonly metersPerPixel: number;
  readonly opacity: number;
  readonly locked: boolean;
}
export interface MapDocument extends GridSize {
  readonly schemaVersion: typeof MAP_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly cellMeters: 1;
  readonly background: MapBackground | null;
  /** Painted floor cells, keyed `col:row`. Visual only. */
  readonly floor: Readonly<Record<string, FloorColorId>>;
  readonly decorations: readonly Decoration[];
}

export const STANDARD_MAP: MapDocument = Object.freeze({
  schemaVersion: MAP_SCHEMA_VERSION,
  id: 'standard-20x20',
  name: 'Стандартная сцена 20 × 20',
  cols: GRID.cols,
  rows: GRID.rows,
  cellMeters: 1,
  background: null,
  floor: Object.freeze({}),
  decorations: Object.freeze([]) as readonly Decoration[],
});

export function emptyMap(id: string, name: string, cols: number, rows: number): MapDocument {
  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    id,
    name,
    cols,
    rows,
    cellMeters: 1,
    background: null,
    floor: {},
    decorations: [],
  };
}

/** The original scene geometry; floor paint does not take part in any calculation. */
export const isStandardGeometry = (m: GridSize) => m.cols === GRID.cols && m.rows === GRID.rows;

const parseKey = (key: string) => {
  const m = /^(\d+):(\d+)$/.exec(key);
  return m ? { col: Number(m[1]), row: Number(m[2]) } : null;
};

/** Every reason the document cannot be applied; empty when it is valid. */
export function mapProblems(m: MapDocument): string[] {
  const problems: string[] = [];
  if (m.schemaVersion !== MAP_SCHEMA_VERSION) problems.push('Неизвестная версия схемы карты');
  if (typeof m.id !== 'string' || !m.id.trim()) problems.push('У карты нет идентификатора');
  const name = typeof m.name === 'string' ? m.name.trim() : '';
  if (!name) problems.push('Укажите название карты');
  if (name.length > MAP_LIMITS.maxNameLength)
    problems.push(`Название длиннее ${MAP_LIMITS.maxNameLength} символов`);
  for (const [axis, value] of [
    ['Ширина', m.cols],
    ['Высота', m.rows],
  ] as const)
    if (!Number.isInteger(value) || value < MAP_LIMITS.minCells || value > MAP_LIMITS.maxCells)
      problems.push(
        `${axis} карты должна быть целым числом клеток от ${MAP_LIMITS.minCells} до ${MAP_LIMITS.maxCells}`,
      );
  if (m.cellMeters !== 1) problems.push('В версии 1 клетка равна 1 м');
  let outside = 0;
  for (const [key, colour] of Object.entries(m.floor ?? {})) {
    const cell = parseKey(key);
    if (!cell || !floorPalette.some((p) => p.id === colour)) {
      problems.push(`Повреждённая клетка разметки пола: ${key}`);
      continue;
    }
    if (cell.col >= m.cols || cell.row >= m.rows) outside++;
  }
  if (outside)
    problems.push(
      `Разметка пола выходит за новые границы: ${outside} кл. Сотрите её или верните размер.`,
    );
  problems.push(...decorationProblems(m), ...backgroundProblems(m.background));
  return problems;
}

const isCount = (v: unknown, min: number) => Number.isInteger(v) && (v as number) >= min;

function decorationProblems(m: MapDocument): string[] {
  const problems: string[] = [];
  const list = Array.isArray(m.decorations) ? m.decorations : [];
  if (!Array.isArray(m.decorations)) problems.push('Список декораций повреждён');
  if (list.length > MAP_LIMITS.maxDecorations)
    problems.push(`Декораций больше ${MAP_LIMITS.maxDecorations}`);
  const seen = new Set<string>();
  let outside = 0;
  for (const d of list) {
    if (typeof d?.id !== 'string' || !d.id.trim() || seen.has(d.id)) {
      problems.push(`Повторяющийся или пустой ID декорации: ${String(d?.id)}`);
      continue;
    }
    seen.add(d.id);
    if (
      !isCount(d.col, 0) ||
      !isCount(d.row, 0) ||
      !isCount(d.width, 1) ||
      !isCount(d.height, 1) ||
      !floorPalette.some((p) => p.id === d.color) ||
      typeof d.label !== 'string' ||
      d.label.length > MAP_LIMITS.maxLabelLength
    ) {
      problems.push(`Повреждённая декорация: ${d.id}`);
      continue;
    }
    if (d.col + d.width > m.cols || d.row + d.height > m.rows) outside++;
  }
  if (outside)
    problems.push(`Декорации выходят за границы карты: ${outside}. Удалите их или верните размер.`);
  return problems;
}

/** Transform and size checks for a background; byte-level checks run when a file is read. */
export function backgroundProblems(bg: MapBackground | null): string[] {
  if (bg === null) return [];
  const problems: string[] = [];
  if (!rasterMimes.includes(bg.mime)) problems.push('Подложка: недопустимый формат изображения');
  if (typeof bg.data !== 'string' || !bg.data) problems.push('Подложка: нет данных изображения');
  if (
    !isCount(bg.widthPx, 1) ||
    !isCount(bg.heightPx, 1) ||
    bg.widthPx > RASTER_LIMITS.maxSide ||
    bg.heightPx > RASTER_LIMITS.maxSide ||
    bg.widthPx * bg.heightPx > RASTER_LIMITS.maxPixels
  )
    problems.push(
      `Подложка: размер изображения вне пределов (до ${RASTER_LIMITS.maxSide} пикс. по стороне, ${RASTER_LIMITS.maxPixels} пикс. всего)`,
    );
  if (![bg.x, bg.y, bg.metersPerPixel, bg.opacity].every((v) => Number.isFinite(v)))
    problems.push('Подложка: координаты, масштаб и прозрачность должны быть числами');
  else {
    if (bg.metersPerPixel <= 0) problems.push('Подложка: масштаб должен быть больше нуля');
    if (bg.opacity < 0 || bg.opacity > 1) problems.push('Подложка: прозрачность от 0 до 1');
  }
  if (typeof bg.locked !== 'boolean') problems.push('Подложка: флаг блокировки повреждён');
  return problems;
}

/** Map equality without serialising the background bytes on every comparison. */
export function sameMap(a: MapDocument, b: MapDocument) {
  if (a === b) return true;
  const { background: ba, floor: fa, ...ra } = a;
  const { background: bb, floor: fb, ...rb } = b;
  if (JSON.stringify(ra) !== JSON.stringify(rb)) return false;
  // Floor cells are a set: their key order carries no meaning.
  const keys = Object.keys(fa);
  if (keys.length !== Object.keys(fb).length || keys.some((k) => fa[k] !== fb[k])) return false;
  if (ba === bb) return true;
  if (!ba || !bb) return false;
  return (Object.keys(ba) as (keyof MapBackground)[]).every((k) => ba[k] === bb[k]);
}

export const floorCellCount = (m: MapDocument) => Object.keys(m.floor).length;
export const insideMap = (m: GridSize, col: number, row: number) =>
  col >= 0 && row >= 0 && col < m.cols && row < m.rows;
export { cellKey };
