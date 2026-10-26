/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Makes a manga volume's text in the browser (lib/data/manga-ocr.ts): an RT-DETR-v2 text detector
 * (ogkalu/comic-text-and-bubble-detector) finds the text boxes of each page, manga-ocr
 * (kha-white, onnx-community's ONNX export) reads each box, and the text is split over the box's
 * columns (manga-ocr-text.ts). int8 models on onnxruntime-web's wasm, read from the cache the
 * download filled. Posts each page as mokuro's shape. Not part of upstream.
 */

import * as ort from 'onnxruntime-web/webgpu';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import type { MokuroPage } from '$lib/data/mokuro';
import {
  decodeText,
  detectorInput,
  detectorSize,
  endId,
  inkLines,
  maxTokens,
  nextToken,
  ocrInput,
  ocrSize,
  startId,
  textBoxes,
  toBlock,
  type Box
} from './manga-ocr-text';

export interface MangaOcrRequest {
  cacheName: string;
  /** Cached model URLs */
  models: { detector: string; encoder: string; decoder: string; vocab: string };
  pages: { name: string; blob: Blob }[];
}

export type MangaOcrMessage =
  | { type: 'loaded' }
  | { type: 'page'; index: number; page: MokuroPage }
  | { type: 'done' }
  | { type: 'error'; message: string };

// The runtime from this site (the one Whisper uses), not a CDN.
ort.env.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
// Threads need cross-origin isolation, which the static site doesn't have.
ort.env.wasm.numThreads = self.crossOriginIsolated
  ? Math.min(4, navigator.hardwareConcurrency || 1)
  : 1;

const post = (message: MangaOcrMessage) => self.postMessage(message);

async function cached(cache: Cache, url: string) {
  const response = await cache.match(url);

  if (!response)
    throw new Error('The manga text models are missing: download them again in Settings');

  return response;
}

function pixels(source: ImageBitmap, box: Box, width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;

  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, box[0], box[1], box[2] - box[0], box[3] - box[1], 0, 0, width, height);

  return context.getImageData(0, 0, width, height).data;
}

async function run({ cacheName, models, pages }: MangaOcrRequest) {
  const cache = await caches.open(cacheName);
  const session = async (url: string) =>
    ort.InferenceSession.create(new Uint8Array(await (await cached(cache, url)).arrayBuffer()), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
  const detector = await session(models.detector);
  const encoder = await session(models.encoder);
  const decoder = await session(models.decoder);
  const vocab = (await (await cached(cache, models.vocab)).text()).split('\n');

  post({ type: 'loaded' });

  async function read(bitmap: ImageBitmap, box: Box) {
    const input = ocrInput(pixels(bitmap, box, ocrSize, ocrSize));
    const { last_hidden_state: hidden } = await encoder.run({
      pixel_values: new ort.Tensor('float32', input, [1, 3, ocrSize, ocrSize])
    });
    const ids = [startId];

    // shortcut: the export has no KV cache, so each token reruns the prefix; a merged decoder would halve this.
    while (ids.length < maxTokens) {
      const { logits } = await decoder.run({
        input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        encoder_hidden_states: hidden
      });
      const next = nextToken(logits.data as Float32Array, ids.length, logits.dims[2]);

      logits.dispose();
      if (next === endId) break;
      ids.push(next);
    }
    hidden.dispose();

    return decodeText(ids, vocab);
  }

  for (const [index, { name, blob }] of pages.entries()) {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    const found = await detector.run({
      images: new ort.Tensor(
        'float32',
        detectorInput(pixels(bitmap, [0, 0, width, height], detectorSize, detectorSize)),
        [1, 3, detectorSize, detectorSize]
      ),
      orig_target_sizes: new ort.Tensor(
        'int64',
        BigInt64Array.from([BigInt(width), BigInt(height)]),
        [1, 2]
      )
    });
    const boxes = textBoxes(
      found.scores.data as Float32Array,
      found.labels.data as BigInt64Array,
      found.boxes.data as Float32Array,
      width,
      height
    );
    const blocks = [];

    Object.values(found).forEach((tensor) => tensor.dispose());
    for (const box of boxes) {
      const text = await read(bitmap, box);

      if (!text) continue;

      const boxWidth = box[2] - box[0];
      const boxHeight = box[3] - box[1];
      const rgba = pixels(bitmap, box, boxWidth, boxHeight);
      const greyPixels = new Uint8Array(boxWidth * boxHeight);

      for (let i = 0; i < greyPixels.length; i += 1) {
        greyPixels[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
      }
      blocks.push(
        toBlock(box, text, inkLines(greyPixels, boxWidth, boxHeight, boxHeight > boxWidth))
      );
    }
    bitmap.close();
    post({ type: 'page', index, page: { name, width, height, blocks } });
  }
}

self.onmessage = ({ data }: MessageEvent<MangaOcrRequest>) =>
  run(data).then(
    () => post({ type: 'done' }),
    (error) =>
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  );
