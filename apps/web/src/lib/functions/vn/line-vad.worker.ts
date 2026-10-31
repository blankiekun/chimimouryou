/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The speech detector for mined VN lines' sound (lib/data/vn/line-audio.ts): Silero VAD v5
 * (silero_vad.onnx, https://github.com/snakers4/silero-vad v5.1.2, MIT, see NOTICE) on
 * onnxruntime-web's wasm, the runtime Whisper and manga text already ship. Gets 16 kHz mono
 * samples, posts the speech probability of each 512-sample (32 ms) frame. Not part of upstream.
 */

import * as ort from 'onnxruntime-web/webgpu';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import modelUrl from './silero_vad.onnx?url';

export interface LineVadRequest {
  id: number;
  samples: Float32Array;
}

export type LineVadMessage = { id: number; probs: Float32Array } | { id: number; error: string };

ort.env.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
// One small model: one thread is plenty, and threads need cross-origin isolation.
ort.env.wasm.numThreads = 1;

const frame = 512;
/** v5 takes the previous frame's last 64 samples in front of each frame. */
const context = 64;

let session: Promise<ort.InferenceSession> | undefined;

async function probabilities(samples: Float32Array) {
  session ??= fetch(modelUrl)
    .then((response) => response.arrayBuffer())
    .then((model) =>
      ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] })
    );
  const model = await session;
  const probs = new Float32Array(Math.floor(samples.length / frame));
  const sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
  let state: ort.Tensor = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  const input = new Float32Array(context + frame);

  for (let i = 0; i < probs.length; i += 1) {
    input.copyWithin(0, frame, frame + context);
    input.set(samples.subarray(i * frame, (i + 1) * frame), context);
    const out = await model.run({
      input: new ort.Tensor('float32', input.slice(), [1, context + frame]),
      state,
      sr
    });

    probs[i] = (out.output.data as Float32Array)[0];
    state = out.stateN as ort.Tensor;
  }
  return probs;
}

self.onmessage = async ({ data }: MessageEvent<LineVadRequest>) => {
  try {
    const probs = await probabilities(data.samples);

    self.postMessage({ id: data.id, probs } satisfies LineVadMessage, { transfer: [probs.buffer] });
  } catch (error: any) {
    self.postMessage({
      id: data.id,
      error: error?.message ?? String(error)
    } satisfies LineVadMessage);
  }
};
