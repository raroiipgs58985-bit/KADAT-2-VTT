import {
  MAP_SCHEMA_VERSION,
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

const MAP_KEYS = [
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
  if (root.schemaVersion !== MAP_SCHEMA_VERSION)
    throw new MapFileError(
      `Версия схемы карты ${String(root.schemaVersion)} не поддерживается (ожидается ${MAP_SCHEMA_VERSION})`,
    );
  exactKeys(root, ['documentType', 'schemaVersion', 'map'], 'файл');
  const map = root.map;
  if (!isObject(map)) throw new MapFileError('Нет описания карты');
  exactKeys(map, MAP_KEYS, 'map');
  if (map.schemaVersion !== MAP_SCHEMA_VERSION)
    throw new MapFileError('Версия схемы в карте не совпадает с версией файла');
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
