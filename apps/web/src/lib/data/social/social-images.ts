/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Images for the social hub, re-encoded in the browser so no EXIF or location data leaves it:
 * a book's cover thumbnail (160 px wide WebP under 20 KB) and the reader's picture (a 256 px
 * square WebP of at most 64 KB). The hub checks the same limits (deploy/social-hub). Not part
 * of upstream.
 */

import type { WebpRequest } from '$lib/functions/webp/webp-encode.worker';

export const coverWidth = 160;
export const coverBytes = 20_480;
export const pictureSize = 256;
export const pictureBytes = 65_536;

/** The part of the source to draw, in source pixels */
export interface Crop {
  x: number;
  y: number;
  size: number;
}

const qualities = [0.85, 0.75, 0.6, 0.45, 0.3];

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));

/**
 * Draws a part of `source` at width × height and encodes it as WebP, lowering the quality until
 * it fits `maxBytes`. Null when it doesn't fit. Browsers whose canvas can't encode WebP (it then
 * hands back a PNG: Safari) get the wasm encoder, downloaded on first use.
 */
export async function encodeWebp(
  source: CanvasImageSource,
  [sx, sy, sw, sh]: number[],
  width: number,
  height: number,
  maxBytes: number
) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) return null;
  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
  for (const quality of qualities) {
    const blob = await toBlob(canvas, quality);

    if (!blob || blob.type !== 'image/webp') {
      return wasmWebp(context.getImageData(0, 0, width, height), maxBytes);
    }
    if (blob.size <= maxBytes) return blob;
  }
  return null;
}

function wasmWebp(image: ImageData, maxBytes: number) {
  const worker = new Worker(
    new URL('../../functions/webp/webp-encode.worker.ts', import.meta.url),
    {
      type: 'module'
    }
  );

  return new Promise<Blob | null>((resolve) => {
    worker.onmessage = ({ data }: MessageEvent<ArrayBuffer | null>) =>
      resolve(data && new Blob([data], { type: 'image/webp' }));
    worker.onerror = () => resolve(null);
    worker.postMessage({ image, qualities, maxBytes } satisfies WebpRequest, [image.data.buffer]);
  }).finally(() => worker.terminate());
}

/** A cover's thumbnail for the hub: 160 px wide, at most 400 px high (taller ones are cut). */
export async function coverThumbnail(cover: Blob) {
  const image = await createImageBitmap(cover);
  const height = Math.min(400, Math.round((image.height * coverWidth) / image.width));

  try {
    return await encodeWebp(
      image,
      [0, 0, image.width, Math.round((height * image.width) / coverWidth)],
      coverWidth,
      height,
      coverBytes
    );
  } finally {
    image.close();
  }
}

/** The crop that fills the square at this zoom (1 = the short side fits), centred on (cx, cy) as shares */
export function squareCrop(width: number, height: number, zoom: number, cx = 0.5, cy = 0.5): Crop {
  const size = Math.min(width, height) / Math.max(1, zoom);
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);

  return {
    x: clamp(cx * width - size / 2, width - size),
    y: clamp(cy * height - size / 2, height - size),
    size
  };
}

/** The cropped picture: a 256 px square WebP */
export function encodePicture(image: CanvasImageSource, crop: Crop) {
  return encodeWebp(
    image,
    [crop.x, crop.y, crop.size, crop.size],
    pictureSize,
    pictureSize,
    pictureBytes
  );
}
