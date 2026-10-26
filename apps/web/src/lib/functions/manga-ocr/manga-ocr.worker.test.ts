/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MangaOcrMessage } from './manga-ocr.worker';

const runs = vi.hoisted(() => ({ detector: vi.fn(), encoder: vi.fn(), decoder: vi.fn() }));

vi.mock('onnxruntime-web/webgpu', () => {
  class Tensor {
    constructor(
      public type: string,
      public data: ArrayLike<unknown>,
      public dims: number[]
    ) {}

    dispose() {}
  }
  const order = [runs.detector, runs.encoder, runs.decoder];
  let created = 0;

  return {
    Tensor,
    env: { wasm: {} },
    InferenceSession: { create: vi.fn(async () => ({ run: order[created++ % 3] })) }
  };
});

describe('manga text worker', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts each page in mokuro’s shape, the text split over the block’s columns', async () => {
    const { Tensor } = (await import('onnxruntime-web/webgpu')) as any;
    const vocab = ['[PAD]', '[UNK]', '[CLS]', '[SEP]', '[MASK]', 'かと', 'いって', 'ナナに'].join(
      '\n'
    );
    // The decoder answers かと いって ナナに, then [SEP].
    const answer = [5, 6, 7, 3];

    runs.detector.mockResolvedValue({
      scores: new Tensor('float32', [0.9, 0.95], [1, 2]),
      labels: new Tensor('int64', [1n, 0n], [1, 2]),
      boxes: new Tensor('float32', [10, 10, 50, 110, 0, 0, 100, 200], [1, 2, 4])
    });
    runs.encoder.mockResolvedValue({ last_hidden_state: new Tensor('float32', [], [1, 1, 768]) });
    runs.decoder.mockImplementation(async ({ input_ids }: any) => {
      const steps = input_ids.dims[1];
      const logits = new Float32Array(steps * 8);

      logits[(steps - 1) * 8 + answer[steps - 1]] = 1;

      return { logits: new Tensor('float32', logits, [1, steps, 8]) };
    });
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async (url: string) => new Response(url.endsWith('vocab.txt') ? vocab : 'model')
      })
    });
    vi.stubGlobal('createImageBitmap', async () => ({ width: 100, height: 200, close() {} }));
    // The 40 × 100 crop of the box has two columns: the right one half as tall.
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {
            fillRect() {},
            drawImage() {},
            getImageData: (_x: number, _y: number, width: number, height: number) => {
              const data = new Uint8ClampedArray(width * height * 4).fill(255);

              if (width === 40) {
                for (let y = 0; y < height; y += 1) {
                  for (let x = 0; x < width; x += 1) {
                    if ((x >= 2 && x < 12) || (x >= 25 && x < 35 && y < 50)) {
                      data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
                    }
                  }
                }
              }

              return { data };
            }
          };
        }
      }
    );

    const posted: MangaOcrMessage[] = [];

    vi.stubGlobal('postMessage', (message: MangaOcrMessage) => posted.push(message));
    await import('./manga-ocr.worker');
    await (self.onmessage as any)({
      data: {
        cacheName: 'manga-text',
        models: { detector: 'd.onnx', encoder: 'e.onnx', decoder: 'x.onnx', vocab: 'vocab.txt' },
        pages: [{ name: 'vol1/001.jpg', blob: new Blob() }]
      }
    });

    expect(posted).toEqual([
      { type: 'loaded' },
      {
        type: 'page',
        index: 0,
        page: {
          name: 'vol1/001.jpg',
          width: 100,
          height: 200,
          // A third of the text in the short right column, っ kept off the next line's start.
          blocks: [
            {
              box: [10, 10, 50, 110],
              vertical: true,
              fontSize: 16,
              lines: ['かといっ', 'てナナに']
            }
          ]
        }
      },
      { type: 'done' }
    ]);
  });
});
