import { RASTER_LIMITS, type RasterMime } from './map';

/**
 * Raster checks shared by the editor and the map file reader. The real format is taken from
 * the file signature, never from the file name or the browser-reported type; decoding the
 * image (done at the browser boundary) confirms it and supplies the pixel size.
 */
export function sniffRaster(bytes: Uint8Array): RasterMime | null {
  const at = (i: number) => bytes[i] ?? -1;
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => at(i) === v))
    return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  const ascii = (from: number, text: string) =>
    [...text].every((ch, i) => at(from + i) === ch.charCodeAt(0));
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  return null;
}

export function rasterByteProblem(byteLength: number): string | null {
  if (byteLength === 0) return 'Файл изображения пуст';
  if (byteLength > RASTER_LIMITS.maxBytes)
    return `Изображение больше ${RASTER_LIMITS.maxBytes / 1024 / 1024} МиБ`;
  return null;
}
export function rasterSizeProblem(widthPx: number, heightPx: number): string | null {
  if (!Number.isInteger(widthPx) || !Number.isInteger(heightPx) || widthPx < 1 || heightPx < 1)
    return 'Изображение не декодировано';
  if (widthPx > RASTER_LIMITS.maxSide || heightPx > RASTER_LIMITS.maxSide)
    return `Изображение больше ${RASTER_LIMITS.maxSide} пикс. по стороне (${widthPx} × ${heightPx})`;
  if (widthPx * heightPx > RASTER_LIMITS.maxPixels)
    return `Изображение больше ${RASTER_LIMITS.maxPixels} пикселей`;
  return null;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map([...ALPHABET].map((ch, i) => [ch, i]));

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!,
      b = bytes[i + 1],
      c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    out += b === undefined ? '=' : ALPHABET[(n >> 6) & 63]!;
    out += c === undefined ? '=' : ALPHABET[n & 63]!;
  }
  return out;
}
/** Strict base64 decoding; throws on any character outside the alphabet or bad padding. */
export function base64ToBytes(text: string): Uint8Array {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text))
    throw new Error('Данные изображения повреждены (неверный base64)');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n =
      (LOOKUP.get(text[i]!)! << 18) |
      (LOOKUP.get(text[i + 1]!)! << 12) |
      ((LOOKUP.get(text[i + 2]!) ?? 0) << 6) |
      (LOOKUP.get(text[i + 3]!) ?? 0);
    out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
/** Decoded byte length of a base64 string without decoding it. */
export const base64ByteLength = (text: string) =>
  (text.length / 4) * 3 - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0);
