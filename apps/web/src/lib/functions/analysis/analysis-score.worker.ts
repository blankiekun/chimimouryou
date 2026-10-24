/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Stage 3 of a book's difficulty estimate (lib/data/analysis-tools.ts): chimi-difficulty's three
 * models (scripts/calibre/jiten/, from the tools' cache) on the input row browser.py made, scored as
 * the difficulty service's _estimate does. A worker of its own so onnxruntime's memory goes when
 * the page ends it. Not part of upstream.
 */

import * as ort from 'onnxruntime-web';
import { toolsFile } from './tools-files';

export interface ScoreRequest {
  base: string;
  features: number[];
}

export type ScoreMessage =
  | { type: 'scores'; difficulty: number; low: number; high: number }
  | { type: 'error'; message: string };

ort.env.wasm.numThreads = 1;

/** The runtime from the tools (ort/ in build.sh), so it works offline and stays out of the app. */
async function loadRuntime(base: string) {
  const script = await (await toolsFile(base, 'ort/ort-wasm-simd-threaded.mjs')).text();

  ort.env.wasm.wasmPaths = {
    mjs: URL.createObjectURL(new Blob([script], { type: 'text/javascript' }))
  };
  ort.env.wasm.wasmBinary = await (
    await toolsFile(base, 'ort/ort-wasm-simd-threaded.wasm')
  ).arrayBuffer();
}

// Kept for the next book while the page keeps the worker (analysis-tools.ts).
let runtime: Promise<void> | undefined;
let range: Promise<{ widen: number }> | undefined;
const sessions: Record<string, Promise<ort.InferenceSession>> = {};

const round = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number) => Math.min(Math.max(value, 0), 5);

self.onmessage = async ({ data }: MessageEvent<ScoreRequest>) => {
  try {
    await (runtime ??= loadRuntime(data.base));

    const input = new ort.Tensor('float32', Float32Array.from(data.features), [
      1,
      data.features.length
    ]);
    const scores: number[] = [];

    for (const suffix of ['', '-low', '-high']) {
      const session = await (sessions[suffix] ??= toolsFile(
        data.base,
        `chimi-difficulty${suffix}.onnx`
      )
        .then((response) => response.arrayBuffer())
        .then((model) => ort.InferenceSession.create(new Uint8Array(model))));
      const output = await session.run({ float_input: input });

      scores.push(round(clamp(Number((output.variable.data as Float32Array)[0]))));
    }

    const [difficulty, low, high] = scores;
    const { widen } = await (range ??= toolsFile(data.base, 'chimi-difficulty-range.json').then(
      (response) => response.json()
    ));

    self.postMessage({
      type: 'scores',
      difficulty,
      low: round(Math.max(Math.min(low, difficulty) - widen, 0)),
      high: round(Math.min(Math.max(high, difficulty) + widen, 5))
    } satisfies ScoreMessage);
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: String((error as Error)?.message ?? error)
    } satisfies ScoreMessage);
  }
};
