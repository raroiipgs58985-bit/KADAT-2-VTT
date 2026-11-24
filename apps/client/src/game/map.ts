import { GRID, cellKey, type GridSize } from './grid';

/**
 * Tactical map document, schema version 1. Holds only map data: size in whole 1 m cells,
 * name, stable ID, an optional background raster with its transform, the visual floor layer
 * and labelled decorations. Camera, zoom and derived indexes are not part of the document.
 * Floor colours, decorations and the background are purely visual: they carry no rule.
 */
export const MAP_SCHEMA_VERSION = 2 as const;
/** Older schema versions that can be opened (and are upgraded on read). */
export const READABLE_MAP_SCHEMAS = [1, 2] as const;
export const MAP_LIMITS = {
  minCells: 1,
  maxCells: 200,
  maxNameLength: 80,
  maxDecorations: 2000,
  maxLabelLength: 60,
  maxEnvironment: 5000,
  maxNotesLength: 300,
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
/** A grid vertex (corner of cells), in whole metres. */
export interface Vertex {
  readonly x: number;
  readonly y: number;
}
/** A chain of horizontal/vertical segments along cell edges. Blocks movement and vision. */
export interface Wall {
  readonly id: string;
  readonly points: readonly Vertex[];
  /** ОБ of the wall as cover when a shot grazes its corner (ruling 142); absent — 0. */
  readonly ob?: number;
}
/** Height of an obstacle as cover: covered body zones (ruling 142). */
export type CoverHeight = 'low' | 'medium' | 'high';
/**
 * A continuous interval of whole edges on one straight segment of a wall. An open door
 * removes all blocking on its opening; a closed door blocks movement and vision as flagged.
 */
export interface Door {
  readonly id: string;
  readonly wallId: string;
  readonly from: Vertex;
  readonly to: Vertex;
  readonly open: boolean;
  readonly blocksMovement: boolean;
  readonly blocksVision: boolean;
  /** Locked: cannot be opened by a character's Free Action; the GM sets the lock test. */
  readonly locked: boolean;
  /** Modifier of the Безопасность (ИН) test to pick the lock, set by the GM (ruling 17). */
  readonly lockModifier: number;
  /** OD one lock-picking attempt costs, set by the GM (ruling 17). */
  readonly lockOd: number;
}
/** Cells with independent movement and vision flags; notes are text only, no calculation. */
export interface Obstacle {
  readonly id: string;
  readonly col: number;
  readonly row: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly blocksMovement: boolean;
  readonly blocksVision: boolean;
  readonly notes: string;
  /** ОБ as cover for a target right behind it (ruling 142); absent or 0 — no cover. */
  readonly coverOb?: number;
  /** Low — legs, medium — legs and torso, high — everything (ruling 142). */
  readonly coverHeight?: CoverHeight;
}
/**
 * Difficult terrain («Общая механика» A41): 1 m costs 2 m of movement (ruling 11); Run, Charge
 * and Sprint across it need an ЛВ test with the terrain modifier, one per stretch (ruling 43).
 */
export interface TerrainZone {
  readonly id: string;
  readonly col: number;
  readonly row: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
  /** ЛВ test modifier of this terrain («Общая механика» A44–A55). */
  readonly modifier: number;
}
/** Terrain examples and their ЛВ test modifiers, «Общая механика» A44–A55. */
export const TERRAIN_TYPES: readonly { readonly label: string; readonly modifier: number }[] = [
  { label: 'Дым или туман', modifier: 0 },
  { label: 'Грязь', modifier: 0 },
  { label: 'Лужи крови или жидкостей', modifier: 0 },
  { label: 'Тьма', modifier: -10 },
  { label: 'Глубокий снег', modifier: -10 },
  { label: 'Густой подлесок', modifier: -10 },
  { label: 'Лёд', modifier: -10 },
  { label: 'Плотная толпа', modifier: -20 },
  { label: 'Трупы', modifier: -20 },
  { label: 'Обломки', modifier: -20 },
  { label: 'Землетрясение', modifier: -20 },
];
/** Modifier of a known terrain label, else 0 (used when reading older map files). */
export const terrainModifier = (label: string) =>
  TERRAIN_TYPES.find((t) => t.label === label)?.modifier ?? 0;
export interface MapDocument extends GridSize {
  readonly schemaVersion: typeof MAP_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly cellMeters: 1;
  readonly background: MapBackground | null;
  /** Painted floor cells, keyed `col:row`. Visual only. */
  readonly floor: Readonly<Record<string, FloorColorId>>;
  readonly decorations: readonly Decoration[];
  readonly walls: readonly Wall[];
  readonly doors: readonly Door[];
  readonly obstacles: readonly Obstacle[];
  readonly zones: readonly TerrainZone[];
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
  walls: Object.freeze([]) as readonly Wall[],
  doors: Object.freeze([]) as readonly Door[],
  obstacles: Object.freeze([]) as readonly Obstacle[],
  zones: Object.freeze([]) as readonly TerrainZone[],
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
    walls: [],
    doors: [],
    obstacles: [],
    zones: [],
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
  problems.push(
    ...decorationProblems(m),
    ...backgroundProblems(m.background),
    ...environmentProblems(m),
  );
  return problems;
}

/** Horizontal or vertical segment between two vertices, normalised (a ≤ b along its axis). */
export function segmentLine(a: Vertex, b: Vertex) {
  if (a.y === b.y && a.x !== b.x)
    return { axis: 'h' as const, at: a.y, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x) };
  if (a.x === b.x && a.y !== b.y)
    return { axis: 'v' as const, at: a.x, from: Math.min(a.y, b.y), to: Math.max(a.y, b.y) };
  return null;
}
type Line = NonNullable<ReturnType<typeof segmentLine>>;
const overlapLength = (p: Line, q: Line) =>
  p.axis === q.axis && p.at === q.at ? Math.min(p.to, q.to) - Math.max(p.from, q.from) : 0;
const isVertex = (v: unknown, m: GridSize): v is Vertex =>
  typeof v === 'object' &&
  v !== null &&
  Number.isInteger((v as Vertex).x) &&
  Number.isInteger((v as Vertex).y) &&
  (v as Vertex).x >= 0 &&
  (v as Vertex).y >= 0 &&
  (v as Vertex).x <= m.cols &&
  (v as Vertex).y <= m.rows;
/** Straight segments of a wall as lines. */
export const wallLines = (w: Wall) => w.points.slice(1).map((p, i) => segmentLine(w.points[i]!, p));

function environmentProblems(m: MapDocument): string[] {
  const problems: string[] = [];
  const lists = [
    ['walls', m.walls],
    ['doors', m.doors],
    ['obstacles', m.obstacles],
    ['zones', m.zones],
  ] as const;
  for (const [name, list] of lists)
    if (!Array.isArray(list)) {
      problems.push(`Список ${name} повреждён`);
      return problems;
    }
  const total = m.walls.length + m.doors.length + m.obstacles.length + m.zones.length;
  if (total > MAP_LIMITS.maxEnvironment)
    problems.push(`Объектов окружения больше ${MAP_LIMITS.maxEnvironment}`);
  const uniqueIds = (list: readonly { id: unknown }[], what: string) => {
    const seen = new Set<unknown>();
    for (const x of list) {
      if (typeof x?.id !== 'string' || !x.id.trim() || seen.has(x.id))
        problems.push(`Повторяющийся или пустой ID (${what}): ${String(x?.id)}`);
      seen.add(x?.id);
    }
  };
  uniqueIds(m.walls, 'стена');
  uniqueIds(m.doors, 'дверь');
  uniqueIds(m.obstacles, 'препятствие');
  uniqueIds(m.zones, 'зона');

  // Walls: axis-aligned, non-zero segments on the map, no coinciding intervals.
  const lines: { wall: string; line: Line }[] = [];
  let wallsOutside = 0;
  for (const w of m.walls) {
    if (w.ob !== undefined && (!Number.isInteger(w.ob) || w.ob < 0 || w.ob > 99))
      problems.push(`Стена ${w.id}: ОБ укрытия 0–99`);
    if (!Array.isArray(w.points) || w.points.length < 2) {
      problems.push(`Стена ${w.id}: нужно не меньше двух точек`);
      continue;
    }
    if (
      !w.points.every((p) =>
        isVertex(p, { cols: Number.MAX_SAFE_INTEGER, rows: Number.MAX_SAFE_INTEGER }),
      )
    ) {
      problems.push(`Стена ${w.id}: точки должны быть целыми вершинами сетки`);
      continue;
    }
    if (!w.points.every((p) => isVertex(p, m))) wallsOutside++;
    const own = wallLines(w);
    if (own.some((l) => l === null)) {
      problems.push(
        `Стена ${w.id}: отрезки должны быть горизонтальными или вертикальными и ненулевыми`,
      );
      continue;
    }
    for (const line of own as Line[]) {
      const clash = lines.find((o) => overlapLength(o.line, line) > 0);
      if (clash)
        problems.push(
          clash.wall === w.id
            ? `Стена ${w.id}: отрезки накладываются друг на друга`
            : `Стена ${w.id} совпадает на участке со стеной ${clash.wall}`,
        );
      lines.push({ wall: w.id, line });
    }
  }
  if (wallsOutside) problems.push(`Стены выходят за границы карты: ${wallsOutside}`);

  // Doors: one interval on one straight segment of an existing wall; no overlaps.
  const doorLines: { id: string; line: Line }[] = [];
  for (const d of m.doors) {
    const wall = m.walls.find((w) => w.id === d.wallId);
    if (!wall) {
      problems.push(`Дверь ${d.id} ссылается на несуществующую стену ${String(d.wallId)}`);
      continue;
    }
    if (
      ![d.open, d.blocksMovement, d.blocksVision, d.locked].every((f) => typeof f === 'boolean') ||
      !Number.isInteger(d.lockModifier) ||
      Math.abs(d.lockModifier) > 60 ||
      !Number.isInteger(d.lockOd) ||
      d.lockOd < 0 ||
      d.lockOd > 10 ||
      !isVertex(d.from, { cols: Number.MAX_SAFE_INTEGER, rows: Number.MAX_SAFE_INTEGER }) ||
      !isVertex(d.to, { cols: Number.MAX_SAFE_INTEGER, rows: Number.MAX_SAFE_INTEGER })
    ) {
      problems.push(`Дверь ${d.id} повреждена`);
      continue;
    }
    const line = segmentLine(d.from, d.to);
    if (!line) {
      problems.push(`Дверь ${d.id}: проём должен быть горизонтальным или вертикальным и ненулевым`);
      continue;
    }
    const host = wallLines(wall).find(
      (l) =>
        l && l.axis === line.axis && l.at === line.at && l.from <= line.from && line.to <= l.to,
    );
    if (!host) problems.push(`Дверь ${d.id} не лежит на одном прямом участке стены ${wall.id}`);
    const clash = doorLines.find((o) => overlapLength(o.line, line) > 0);
    if (clash) problems.push(`Двери ${clash.id} и ${d.id} перекрываются`);
    doorLines.push({ id: d.id, line });
  }

  // Obstacles and zones: whole-cell rectangles on the map.
  const rectBad = (r: {
    col: unknown;
    row: unknown;
    width: unknown;
    height: unknown;
    label: unknown;
  }) =>
    !isCount(r.col, 0) ||
    !isCount(r.row, 0) ||
    !isCount(r.width, 1) ||
    !isCount(r.height, 1) ||
    typeof r.label !== 'string' ||
    r.label.length > MAP_LIMITS.maxLabelLength;
  let rectsOutside = 0;
  for (const o of m.obstacles) {
    if (
      rectBad(o) ||
      typeof o.blocksMovement !== 'boolean' ||
      typeof o.blocksVision !== 'boolean' ||
      typeof o.notes !== 'string' ||
      o.notes.length > MAP_LIMITS.maxNotesLength ||
      (o.coverOb !== undefined &&
        (!Number.isInteger(o.coverOb) || o.coverOb < 0 || o.coverOb > 99)) ||
      (o.coverHeight !== undefined && !['low', 'medium', 'high'].includes(o.coverHeight))
    ) {
      problems.push(`Препятствие ${o.id} повреждено`);
      continue;
    }
    if (o.col + o.width > m.cols || o.row + o.height > m.rows) rectsOutside++;
  }
  for (const z of m.zones) {
    if (rectBad(z) || !Number.isInteger(z.modifier) || Math.abs(z.modifier) > 60) {
      problems.push(`Зона ${z.id} повреждена`);
      continue;
    }
    if (z.col + z.width > m.cols || z.row + z.height > m.rows) rectsOutside++;
  }
  if (rectsOutside) problems.push(`Препятствия или зоны выходят за границы карты: ${rectsOutside}`);
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
