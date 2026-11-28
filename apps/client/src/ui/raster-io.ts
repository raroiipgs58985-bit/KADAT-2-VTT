import { useEffect, useMemo } from 'react';
import type { MapBackground, RasterMime } from '../game/map';
import {
  base64ToBytes,
  bytesToBase64,
  rasterByteProblem,
  rasterSizeProblem,
  sniffRaster,
} from '../game/raster';

/** Decodes the bytes with the browser to prove they are a real image and read its size. */
async function decode(bytes: Uint8Array, mime: RasterMime) {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  } catch {
    throw new Error('Изображение не удалось декодировать — файл повреждён или это не картинка');
  }
  const size = { widthPx: bitmap.width, heightPx: bitmap.height };
  bitmap.close();
  return size;
}

/** Reads a local PNG/JPEG/WebP file: size limit, signature, real decoding, pixel limits. */
export async function readRasterFile(file: File) {
  const sizeProblem = rasterByteProblem(file.size);
  if (sizeProblem) throw new Error(sizeProblem);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffRaster(bytes);
  if (!mime) throw new Error('Поддерживаются только PNG, JPEG и WebP (проверено по содержимому)');
  const { widthPx, heightPx } = await decode(bytes, mime);
  const pixelProblem = rasterSizeProblem(widthPx, heightPx);
  if (pixelProblem) throw new Error(pixelProblem);
  return { mime, data: bytesToBase64(bytes), widthPx, heightPx };
}

/** Confirms an embedded background from a map file decodes and matches its stated size. */
export async function verifyEmbeddedRaster(bg: MapBackground) {
  const size = await decode(base64ToBytes(bg.data), bg.mime);
  if (size.widthPx !== bg.widthPx || size.heightPx !== bg.heightPx)
    throw new Error(
      `Подложка: размер изображения ${size.widthPx} × ${size.heightPx} не совпадает с указанным ${bg.widthPx} × ${bg.heightPx}`,
    );
}

/** Object URL for the current background raster; revoked when the raster changes or unmounts. */
export function useBackgroundUrl(bg: MapBackground | null): string | null {
  const data = bg?.data ?? null;
  const mime = bg?.mime ?? null;
  const url = useMemo(
    () =>
      data && mime
        ? URL.createObjectURL(new Blob([base64ToBytes(data) as BlobPart], { type: mime }))
        : null,
    [data, mime],
  );
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}
