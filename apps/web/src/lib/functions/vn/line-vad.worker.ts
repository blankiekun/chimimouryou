/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The speech detector for mined VN lines' sound (lib/data/vn/line-audio.ts): FireRedVAD
 * (fireredvad_vad.onnx, Apache-2.0, see NOTICE), GameSentenceMiner's default, on onnxruntime-web's
 * wasm, the runtime Whisper and manga text already ship. Gets mono samples, posts the speech
 * segments in seconds. Not part of upstream.
 */

import * as ort from 'onnxruntime-web/webgpu';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import modelUrl from './fireredvad_vad.onnx?url';
import { featureBins, features, speechSegments } from './firered-vad';

export interface LineVadRequest {
  id: number;
  samples: Int16Array;
  rate: number;
}

export type LineVadMessage =
  { id: number; segments: [number, number][] } | { id: number; error: string };

ort.env.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
// One small model: one thread is plenty, and threads need cross-origin isolation.
ort.env.wasm.numThreads = 1;

/** A band-limited resampling to 16 kHz (as ffmpeg gives GameSentenceMiner). */
function to16k(samples: Int16Array, rate: number) {
  if (rate === 16000) return samples;
  const out = new Int16Array(Math.floor((samples.length * 16000) / rate));
  const step = rate / 16000;
  const cutoff = 0.97 / Math.max(step, 1);
  const reach = Math.ceil(16 / cutoff);

  for (let i = 0; i < out.length; i += 1) {
    const at = i * step;
    let sum = 0;

    for (let j = Math.ceil(at - reach); j <= at + reach; j += 1) {
      if (j < 0 || j >= samples.length) continue;
      const x = j - at;
      const sinc = x ? Math.sin(Math.PI * cutoff * x) / (Math.PI * x) : cutoff;

      sum += samples[j] * sinc * (0.5 + 0.5 * Math.cos((Math.PI * x) / (reach + 1)));
    }
    out[i] = Math.max(-32768, Math.min(32767, Math.round(sum)));
  }
  return out;
}

let session: Promise<ort.InferenceSession> | undefined;

async function segments(samples: Int16Array) {
  session ??= fetch(modelUrl)
    .then((response) => response.arrayBuffer())
    .then((model) =>
      ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] })
    );
  const model = await session;
  const { data, frames } = features(samples);

  if (!frames) return [];
  const out = await model.run({ feat: new ort.Tensor('float32', data, [1, frames, featureBins]) });

  return speechSegments(out.probs.data as Float32Array, samples.length / 16000);
}

self.onmessage = async ({ data }: MessageEvent<LineVadRequest>) => {
  try {
    self.postMessage({
      id: data.id,
      segments: await segments(to16k(data.samples, data.rate))
    } satisfies LineVadMessage);
  } catch (error: any) {
    self.postMessage({
      id: data.id,
      error: error?.message ?? String(error)
    } satisfies LineVadMessage);
  }
};
