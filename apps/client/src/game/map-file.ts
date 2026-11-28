import {
  terrainModifier,
  MAP_SCHEMA_VERSION,
  READABLE_MAP_SCHEMAS,
  RASTER_LIMITS,
  mapProblems,
  type Decoration,
  type MapBackground,
  type MapDocument,
} from './map';
import { base64ByteLength, base64ToBytes, rasterByteProblem, sniffRaster } from './raster';

/**
 * Portable `*.kadat-map.json` document. The raster is embedded, so a saved map opens without
 * the original image file. Reading validates everything before anything is used.
 */
export const MAP_FILE_TYPE = 'kadat-map' as const;
export const MAP_FILE_EXTENSION = '.kadat-map.json';
export const MAP_FILE_MAX_BYTES = 16 * 1024 * 1024;

export class MapFileError extends Error {
  override readonly name = 'MapFileError';
}

const MAP_KEYS_V1 = [
  'schemaVersion',
  'id',
  'name',
  'cols',
  'rows',
  'cellMeters',
  'background',
  'floor',
  'decorations',
] as const;
const MAP_KEYS = [...MAP_KEYS_V1, 'walls', 'doors', 'obstacles', 'zones'] as const;
const WALL_KEYS = ['id', 'points', 'ob'] as const;
const VERTEX_KEYS = ['x', 'y'] as const;
const DOOR_KEYS = [
  'id',
  'wallId',
  'from',
  'to',
  'open',
  'blocksMovement',
  'blocksVision',
  'locked',
  'lockModifier',
  'lockOd',
  'coverOb',
  'coverHeight',
] as const;
const OBSTACLE_KEYS = [
  'id',
  'col',
  'row',
  'width',
  'height',
  'label',
  'blocksMovement',
  'blocksVision',
  'notes',
  'coverOb',
  'coverHeight',
] as const;
const ZONE_KEYS = ['id', 'col', 'row', 'width', 'height', 'label', 'modifier'] as const;
const BACKGROUND_KEYS = [
  'mime',
  'data',
  'widthPx',
  'heightPx',
  'x',
  'y',
  'metersPerPixel',
  'opacity',
  'locked',
] as const;
const DECORATION_KEYS = ['id', 'col', 'row', 'width', 'height', 'color', 'label'] as const;

/** Canonical form: fixed key order and sorted floor cells, so a round trip is byte-identical. */
function canonical(m: MapDocument): MapDocument {
  const floor = Object.fromEntries(
    Object.entries(m.floor).sort(([a], [b]) => {
      const [ac, ar] = a.split(':').map(Number);
      const [bc, br] = b.split(':').map(Number);
      return ar! - br! || ac! - bc!;
    }),
  );
  const pick = <T extends object>(o: T, keys: readonly (keyof T)[]) =>
    Object.fromEntries(keys.map((k) => [k, o[k]])) as T;
  return {
    ...pick(m, MAP_KEYS),
    background: m.background ? pick(m.background, BACKGROUND_KEYS) : null,
    floor,
    decorations: m.decorations.map((d) => pick(d, DECORATION_KEYS)),
    walls: m.walls.map((w) => ({ id: w.id, points: w.points.map((p) => pick(p, VERTEX_KEYS)) })),
    doors: m.doors.map((d) => ({
      ...pick(d, DOOR_KEYS),
      from: pick(d.from, VERTEX_KEYS),
      to: pick(d.to, VERTEX_KEYS),
    })),
    obstacles: m.obstacles.map((o) => pick(o, OBSTACLE_KEYS)),
    zones: m.zones.map((z) => pick(z, ZONE_KEYS)),
  };
}

export function serializeMapFile(m: MapDocument): string {
  const problems = mapProblems(m);
  if (problems.length) throw new MapFileError(`Карта не сохранена: ${problems.join(' ')}`);
  const text = JSON.stringify(
    { documentType: MAP_FILE_TYPE, schemaVersion: MAP_SCHEMA_VERSION, map: canonical(m) },
    null,
    2,
  );
  if (text.length > MAP_FILE_MAX_BYTES)
    throw new MapFileError(`Файл карты больше ${MAP_FILE_MAX_BYTES / 1024 / 1024} МиБ`);
  return text + '\n';
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function exactKeys(o: Record<string, unknown>, keys: readonly string[], where: string) {
  for (const k of Object.keys(o))
    if (!keys.includes(k)) throw new MapFileError(`Неизвестное поле ${where}.${k}`);
  for (const k of keys) if (!(k in o)) throw new MapFileError(`Нет поля ${where}.${k}`);
}

/** Parses and fully validates a map file; throws `MapFileError` with a readable reason. */
export function parseMapFile(text: string): MapDocument {
  if (text.length > MAP_FILE_MAX_BYTES)
    throw new MapFileError(`Файл карты больше ${MAP_FILE_MAX_BYTES / 1024 / 1024} МиБ`);
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new MapFileError('Файл не является JSON — возможно, он повреждён');
  }
  if (!isObject(root) || root.documentType !== MAP_FILE_TYPE)
    throw new MapFileError('Это не файл карты KADAT (нет documentType: "kadat-map")');
  const version = root.schemaVersion;
  if (!(READABLE_MAP_SCHEMAS as readonly unknown[]).includes(version))
    throw new MapFileError(
      `Версия схемы карты ${String(version)} не поддерживается (ожидается ${READABLE_MAP_SCHEMAS.join(' или ')})`,
    );
  exactKeys(root, ['documentType', 'schemaVersion', 'map'], 'файл');
  const source = root.map;
  if (!isObject(source)) throw new MapFileError('Нет описания карты');
  exactKeys(source, version === 1 ? MAP_KEYS_V1 : MAP_KEYS, 'map');
  if (source.schemaVersion !== version)
    throw new MapFileError('Версия схемы в карте не совпадает с версией файла');
  // Version 1 (stage 2) maps have no environment: upgrade with empty lists.
  const map: Record<string, unknown> =
    version === 1
      ? {
          ...source,
          schemaVersion: MAP_SCHEMA_VERSION,
          walls: [],
          doors: [],
          obstacles: [],
          zones: [],
        }
      : source;
  // Files saved before locks and terrain modifiers: fill the new fields with their defaults.
  if (Array.isArray(map.doors))
    map.doors = (map.doors as unknown[]).map((d) =>
      isObject(d) && !('locked' in d) ? { ...d, locked: false, lockModifier: 0, lockOd: 0 } : d,
    );
  // Files saved before windows had cover (ruling 153).
  if (Array.isArray(map.doors))
    map.doors = (map.doors as unknown[]).map((d) =>
      isObject(d) && !('coverOb' in d) ? { ...d, coverOb: 0, coverHeight: 'medium' } : d,
    );
  // Files saved before cover (ruling 142): walls and obstacles give no cover.
  if (Array.isArray(map.walls))
    map.walls = (map.walls as unknown[]).map((w) =>
      isObject(w) && !('ob' in w) ? { ...w, ob: 0 } : w,
    );
  if (Array.isArray(map.obstacles))
    map.obstacles = (map.obstacles as unknown[]).map((o) =>
      isObject(o) && !('coverOb' in o) ? { ...o, coverOb: 0, coverHeight: 'low' } : o,
    );
  if (Array.isArray(map.zones))
    map.zones = (map.zones as unknown[]).map((z) =>
      isObject(z) && !('modifier' in z) ? { ...z, modifier: terrainModifier(String(z.label)) } : z,
    );
  for (const [key, keys] of [
    ['walls', WALL_KEYS],
    ['doors', DOOR_KEYS],
    ['obstacles', OBSTACLE_KEYS],
    ['zones', ZONE_KEYS],
  ] as const) {
    const list = map[key];
    if (!Array.isArray(list)) throw new MapFileError(`Поле map.${key} повреждено`);
    list.forEach((x, i) => {
      if (!isObject(x)) throw new MapFileError(`Элемент map.${key}[${i}] повреждён`);
      exactKeys(x, keys, `map.${key}[${i}]`);
    });
  }
  (map.walls as Record<string, unknown>[]).forEach((w, i) => {
    if (!Array.isArray(w.points)) throw new MapFileError(`Поле map.walls[${i}].points повреждено`);
    w.points.forEach((p: unknown, j: number) => {
      if (!isObject(p)) throw new MapFileError(`Точка map.walls[${i}].points[${j}] повреждена`);
      exactKeys(p, VERTEX_KEYS, `map.walls[${i}].points[${j}]`);
    });
  });
  (map.doors as Record<string, unknown>[]).forEach((d, i) => {
    for (const end of ['from', 'to'] as const) {
      if (!isObject(d[end])) throw new MapFileError(`Поле map.doors[${i}].${end} повреждено`);
      exactKeys(d[end], VERTEX_KEYS, `map.doors[${i}].${end}`);
    }
  });
  if (!isObject(map.floor)) throw new MapFileError('Поле map.floor повреждено');
  if (!Array.isArray(map.decorations)) throw new MapFileError('Поле map.decorations повреждено');
  map.decorations.forEach((d, i) => {
    if (!isObject(d)) throw new MapFileError(`Декорация №${i + 1} повреждена`);
    exactKeys(d, DECORATION_KEYS, `map.decorations[${i}]`);
  });
  if (map.background !== null) {
    if (!isObject(map.background)) throw new MapFileError('Поле map.background повреждено');
    exactKeys(map.background, BACKGROUND_KEYS, 'map.background');
  }
  const doc = map as unknown as MapDocument;
  const problems = mapProblems(doc);
  if (problems.length) throw new MapFileError(problems.join(' '));
  if (doc.background) checkEmbeddedRaster(doc.background);
  return canonical(doc);
}

/** Byte-level checks of the embedded raster: base64, size limit and real format. */
function checkEmbeddedRaster(bg: MapBackground) {
  if (base64ByteLength(bg.data) > RASTER_LIMITS.maxBytes)
    throw new MapFileError(rasterByteProblem(RASTER_LIMITS.maxBytes + 1)!);
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(bg.data);
  } catch (e) {
    throw new MapFileError(`Подложка: ${(e as Error).message}`);
  }
  const problem = rasterByteProblem(bytes.length);
  if (problem) throw new MapFileError(`Подложка: ${problem}`);
  const real = sniffRaster(bytes);
  if (real !== bg.mime)
    throw new MapFileError(
      `Подложка: данные не совпадают с заявленным форматом ${bg.mime}${real ? ` (на деле ${real})` : ''}`,
    );
}

export type { Decoration };
