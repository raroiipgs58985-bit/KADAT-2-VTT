import { describe, expect, it } from 'vitest';
import { emptyMap, RASTER_LIMITS, sameMap, type MapDocument } from './map';
import { MAP_FILE_MAX_BYTES, MapFileError, parseMapFile, serializeMapFile } from './map-file';
import {
  addDecoration,
  calibrateBackground,
  eraseOutside,
  fitBackground,
  draftProblems,
  loadDocument,
  newEmpty,
  removeDecoration,
  resize,
  startEditing,
  updateBackground,
  updateDecoration,
} from './map-editor';
import {
  base64ToBytes,
  bytesToBase64,
  rasterByteProblem,
  rasterSizeProblem,
  sniffRaster,
} from './raster';
import { createBattle } from './model';
import { applyMap } from './engine';
import { exportReplay } from './replay';

/** A real 1 × 1 PNG. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function sampleMap(): MapDocument {
  const base = emptyMap('map-sample', 'Склад', 24, 12);
  const bg = fitBackground(base, { mime: 'image/png', data: PNG_1X1, widthPx: 1, heightPx: 1 });
  return {
    ...base,
    background: { ...bg, x: 1.5, y: -0.5, opacity: 0.6, locked: true },
    floor: { '3:2': 'sand', '0:0': 'grey', '23:11': 'blue' },
    decorations: [
      { id: 'dec-1', col: 2, row: 3, width: 4, height: 2, color: 'rust', label: 'Ящики' },
      { id: 'dec-2', col: 10, row: 0, width: 1, height: 1, color: 'green', label: '' },
    ],
  };
}
/** The same sample on the standard 20 × 20 size (all its content fits). */
const sample20 = (): MapDocument => ({
  ...sampleMap(),
  cols: 20,
  rows: 20,
  floor: { '3:2': 'sand', '0:0': 'grey' },
});
const fileOf = (patch: (root: Record<string, unknown>) => void) => {
  const root = JSON.parse(serializeMapFile(sampleMap()));
  patch(root);
  return JSON.stringify(root);
};
const reason = (text: string) => {
  try {
    parseMapFile(text);
  } catch (e) {
    expect(e).toBeInstanceOf(MapFileError);
    return (e as Error).message;
  }
  throw new Error('expected the file to be refused');
};

describe('Map file round trip', () => {
  it('save → open → save is byte-identical and keeps every field', () => {
    const text = serializeMapFile(sampleMap());
    const opened = parseMapFile(text);
    expect(sameMap(opened, sampleMap())).toBe(true);
    expect(serializeMapFile(opened)).toBe(text);
    expect(opened.background?.data).toBe(PNG_1X1);
  });

  it('opens without any external image file (raster is embedded)', () => {
    const opened = parseMapFile(serializeMapFile(sampleMap()));
    expect(sniffRaster(base64ToBytes(opened.background!.data))).toBe('image/png');
  });

  it('a map without background or decorations round-trips too', () => {
    const plain = emptyMap('m', 'Пусто', 5, 7);
    expect(parseMapFile(serializeMapFile(plain))).toEqual(plain);
  });
});

describe('Map file is refused with a readable reason', () => {
  it('broken JSON', () => {
    expect(reason('{"documentType": "kadat-map",')).toMatch(/не является JSON/);
  });
  it('another document type (e.g. a combat replay)', () => {
    expect(reason(JSON.stringify(exportReplay(createBattle())))).toMatch(/не файл карты KADAT/);
  });
  it('an unknown schema version', () => {
    expect(reason(fileOf((r) => (r.schemaVersion = 2)))).toMatch(/Версия схемы карты 2/);
  });
  it('an unknown or missing field', () => {
    expect(reason(fileOf((r) => ((r.map as Record<string, unknown>).extra = 1)))).toMatch(
      /Неизвестное поле map.extra/,
    );
    expect(reason(fileOf((r) => delete (r.map as Record<string, unknown>).floor))).toMatch(
      /Нет поля map.floor/,
    );
  });
  it('wrong types and non-finite numbers', () => {
    expect(reason(fileOf((r) => ((r.map as Record<string, unknown>).cols = '24')))).toMatch(
      /Ширина/,
    );
    expect(
      reason(
        fileOf((r) => {
          const bg = (r.map as { background: Record<string, unknown> }).background;
          bg.metersPerPixel = 0;
        }),
      ),
    ).toMatch(/масштаб/);
  });
  it('duplicate decoration IDs and decorations outside the map', () => {
    expect(
      reason(
        fileOf((r) => {
          const decs = (r.map as { decorations: { id: string }[] }).decorations;
          decs[1]!.id = 'dec-1';
        }),
      ),
    ).toMatch(/Повторяющийся/);
    expect(
      reason(
        fileOf((r) => {
          const decs = (r.map as { decorations: { col: number }[] }).decorations;
          decs[0]!.col = 22;
        }),
      ),
    ).toMatch(/Декорации выходят за границы/);
  });
  it('floor cells outside the map', () => {
    expect(
      reason(fileOf((r) => ((r.map as { floor: Record<string, string> }).floor['30:1'] = 'grey'))),
    ).toMatch(/Разметка пола выходит/);
  });
  it('corrupted image data or a raster that is not what it claims', () => {
    expect(
      reason(fileOf((r) => ((r.map as { background: { data: string } }).background.data = '@@@@'))),
    ).toMatch(/base64/);
    const jpeg = bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));
    expect(
      reason(fileOf((r) => ((r.map as { background: { data: string } }).background.data = jpeg))),
    ).toMatch(/не совпадают с заявленным форматом image\/png \(на деле image\/jpeg\)/);
  });
  it('an oversized file or embedded raster', () => {
    expect(reason(' '.repeat(MAP_FILE_MAX_BYTES + 1))).toMatch(/больше 16 МиБ/);
    const big = 'A'.repeat(Math.ceil((((RASTER_LIMITS.maxBytes + 3) / 3) * 4) / 4) * 4);
    expect(
      reason(fileOf((r) => ((r.map as { background: { data: string } }).background.data = big))),
    ).toMatch(/больше 8 МиБ/);
  });
});

describe('Raster checks', () => {
  it('detects PNG, JPEG and WebP by signature, not by name', () => {
    expect(sniffRaster(base64ToBytes(PNG_1X1))).toBe('image/png');
    expect(sniffRaster(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe('image/jpeg');
    const webp = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ');
    expect(sniffRaster(webp)).toBe('image/webp');
    expect(sniffRaster(new TextEncoder().encode('GIF89a'))).toBeNull();
  });
  it('enforces the v1 limits', () => {
    expect(rasterByteProblem(0)).toMatch(/пуст/);
    expect(rasterByteProblem(RASTER_LIMITS.maxBytes)).toBeNull();
    expect(rasterByteProblem(RASTER_LIMITS.maxBytes + 1)).toMatch(/8 МиБ/);
    expect(rasterSizeProblem(4096, 4096)).toBeNull();
    expect(rasterSizeProblem(4097, 10)).toMatch(/4096/);
    expect(rasterSizeProblem(4096, 4096 + 1)).toMatch(/4096/);
  });
  it('base64 round-trips arbitrary bytes and rejects bad padding', () => {
    for (const n of [0, 1, 2, 3, 4, 255]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255);
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
    expect(() => base64ToBytes('abc')).toThrow(/base64/);
  });
});

describe('Background calibration and transform', () => {
  const bg = { ...sampleMap().background!, locked: false, x: 0, y: 0, metersPerPixel: 0.05 };

  it('two points 100 px apart at a known 4 m give 0.04 m per pixel', () => {
    // Points measured on the current transform: 100 px = 5 m apart.
    const out = calibrateBackground(bg, { x: 2, y: 3 }, { x: 7, y: 3 }, 4);
    expect(out.metersPerPixel).toBeCloseTo(0.04, 12);
    // The first point keeps its place on the map.
    const firstPx = { x: (2 - bg.x) / bg.metersPerPixel, y: (3 - bg.y) / bg.metersPerPixel };
    expect(out.x + firstPx.x * out.metersPerPixel).toBeCloseTo(2, 12);
    expect(out.y + firstPx.y * out.metersPerPixel).toBeCloseTo(3, 12);
  });
  it('refuses zero length, a non-positive distance and a locked background', () => {
    expect(() => calibrateBackground(bg, { x: 1, y: 1 }, { x: 1, y: 1 }, 4)).toThrow(/нулевая/);
    expect(() => calibrateBackground(bg, { x: 1, y: 1 }, { x: 2, y: 1 }, 0)).toThrow(/больше нуля/);
    expect(() =>
      calibrateBackground({ ...bg, locked: true }, { x: 1, y: 1 }, { x: 2, y: 1 }, 1),
    ).toThrow(/заблокирована/);
  });
  it('moving and scaling the background never moves tokens', () => {
    const b = createBattle();
    const positions = structuredClone(b.positions);
    let d = loadDocument(startEditing(b).present, sample20());
    d = updateBackground(d, { x: 7, y: 9, metersPerPixel: 3, locked: false });
    applyMap(b, d);
    expect(b.positions).toEqual(positions);
    expect(b.map.background).toMatchObject({ x: 7, y: 9, metersPerPixel: 3 });
  });
});

describe('Decorations in the draft', () => {
  it('add, edit and delete keep stable IDs', () => {
    let d = startEditing(createBattle()).present;
    d = addDecoration(d, {
      id: 'dec-a',
      col: 1,
      row: 1,
      width: 2,
      height: 1,
      color: 'sand',
      label: 'Стол',
    });
    d = updateDecoration(d, 'dec-a', { label: 'Стол офицера', color: 'blue' });
    expect(d.map.decorations).toEqual([
      { id: 'dec-a', col: 1, row: 1, width: 2, height: 1, color: 'blue', label: 'Стол офицера' },
    ]);
    expect(removeDecoration(d, 'dec-a').map.decorations).toEqual([]);
  });
  it('erasing outside the bounds removes only decorations that no longer fit', () => {
    let d = loadDocument(startEditing(createBattle()).present, sampleMap());
    d = eraseOutside(resize(d, 8, 8));
    expect(d.map.decorations.map((x) => x.id)).toEqual(['dec-1']);
  });
});

describe('Replay v0.3 and visual layers', () => {
  it('a 20 × 20 map with background and decorations exports with the visual-layer mark', () => {
    const b = createBattle();
    applyMap(b, loadDocument(startEditing(b).present, sample20()));
    expect(exportReplay(b).visualLayersOmitted).toBe(true);
  });
});

describe('New empty map from a filled draft', () => {
  it('drops background, floor paint and decorations, keeps token positions', () => {
    const b = createBattle();
    const filled = loadDocument(startEditing(b).present, sample20());
    const empty = newEmpty(filled, 'map-new', 'Новая карта 24 × 12', 24, 12);
    expect(empty.map).toEqual(emptyMap('map-new', 'Новая карта 24 × 12', 24, 12));
    expect(empty.positions).toEqual(filled.positions);
    expect(draftProblems(empty, b)).toEqual({ map: [], tokens: [], stale: [] });
  });

  it('still checks token positions against the new size', () => {
    const b = createBattle();
    const filled = loadDocument(startEditing(b).present, sample20());
    const small = newEmpty(filled, 'map-small', 'Малая', 8, 8);
    expect(small.map.background).toBeNull();
    expect(draftProblems(small, b).tokens.map((t) => t.actor)).toEqual(['kelus-drakar', 'pak']);
  });
});
