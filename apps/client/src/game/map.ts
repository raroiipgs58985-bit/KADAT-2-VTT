import { GRID, cellKey, type GridSize } from './grid';

/**
 * Tactical map document, schema version 1. Holds only map data: size in whole 1 m cells,
 * name, stable ID and the visual floor layer. Camera, zoom and derived indexes are not part
 * of the document. Floor colours are purely visual: they carry no terrain rule.
 */
export const MAP_SCHEMA_VERSION = 1 as const;
export const MAP_LIMITS = { minCells: 1, maxCells: 200, maxNameLength: 80 } as const;

export const floorPalette = [
  { id: 'grey', label: 'Серый', color: '#3b4552' },
  { id: 'sand', label: 'Песочный', color: '#6b5a3c' },
  { id: 'green', label: 'Зелёный', color: '#33513b' },
  { id: 'blue', label: 'Синий', color: '#2f4766' },
  { id: 'rust', label: 'Ржавый', color: '#6a3a2e' },
] as const;
export type FloorColorId = (typeof floorPalette)[number]['id'];
export const floorColor = (id: FloorColorId) => floorPalette.find((p) => p.id === id)!.color;

export interface MapDocument extends GridSize {
  readonly schemaVersion: typeof MAP_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly cellMeters: 1;
  /** Painted floor cells, keyed `col:row`. Visual only. */
  readonly floor: Readonly<Record<string, FloorColorId>>;
}

export const STANDARD_MAP: MapDocument = Object.freeze({
  schemaVersion: MAP_SCHEMA_VERSION,
  id: 'standard-20x20',
  name: 'Стандартная сцена 20 × 20',
  cols: GRID.cols,
  rows: GRID.rows,
  cellMeters: 1,
  floor: Object.freeze({}),
});

export function emptyMap(id: string, name: string, cols: number, rows: number): MapDocument {
  return { schemaVersion: MAP_SCHEMA_VERSION, id, name, cols, rows, cellMeters: 1, floor: {} };
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
  return problems;
}

export const floorCellCount = (m: MapDocument) => Object.keys(m.floor).length;
export const insideMap = (m: GridSize, col: number, row: number) =>
  col >= 0 && row >= 0 && col < m.cols && row < m.rows;
export { cellKey };
