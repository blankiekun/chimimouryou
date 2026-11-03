/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * A mined VN line's sound, for Anki (lib/data/dictionary/anki.ts): native play's ring
 * (apps/desktop/game-media.js, via /hook) and the VN players' (static/vn/overlay.js, via /v) hand
 * over the recorded sound of the line's window, from the click that brought the line to the next
 * line's, with a little before and after. The speech detector (line-vad.worker.ts) trims it the way GameSentenceMiner does: the clip ends 0.5 s after
 * the last speech in the window, and a line with too little speech for its text gets no sound.
 * Not part of upstream.
 */

import { logger } from '$lib/data/logger';
import type { LineVadMessage } from '$lib/functions/vn/line-vad.worker';

/** A line's recorded sound: mono s16 samples; `start`/`end` its window, seconds into them. */
export interface LinePcm {
  samples: Int16Array;
  rate: number;
  start: number;
  end: number;
}

/** Recorded before the window's start, so a voice starting with the click isn't clipped. */
export const preRollMs = 400;
/** Recorded after the window's end (unused by the trim, which stops at the next line). */
export const tailMs = 6000;

const frameSeconds = 512 / 16000;
const threshold = 0.5;
const negThreshold = 0.35;
const minSilence = 0.1;
const minSpeech = 0.25;
/** GameSentenceMiner's defaults: audio.beginning_offset and audio.end_offset. */
const padBefore = 0.4;
const padAfter = 0.5;
const fade = 0.05;

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, (message: LineVadMessage) => void>();
let stopWhenIdle = false;
/** A line's window is at most the 3-minute ring: minutes on a slow phone, with the runtime to fetch. */
const vadTimeoutMs = 5 * 60_000;

/** The worker won't answer: what waits on it fails, and the next line starts a new one. */
function failVad(error: string) {
  worker?.terminate();
  worker = undefined;
  pending.forEach((settle, id) => settle({ id, error }));
  pending.clear();
}

/** The player left: ends the worker, after the last answer so a card being made keeps its voice. */
export function stopLineAudio() {
  stopWhenIdle = true;
  if (!pending.size) failVad('stopped');
}

/** Speech probability per 32 ms frame of 16 kHz samples. */
function vad(samples: Float32Array) {
  stopWhenIdle = false;
  if (!worker) {
    worker = new Worker(new URL('../../functions/vn/line-vad.worker.ts', import.meta.url), {
      type: 'module'
    });
    worker.onmessage = ({ data }: MessageEvent<LineVadMessage>) => {
      pending.get(data.id)?.(data);
      pending.delete(data.id);
      if (stopWhenIdle && !pending.size) failVad('stopped');
    };
    worker.onerror = (event) => failVad(event.message || "its worker file didn't load");
  }
  const id = (nextId += 1);

  return new Promise<Float32Array>((resolve, reject) => {
    const timer = setTimeout(() => failVad('no answer in 5 minutes'), vadTimeoutMs);

    pending.set(id, (message) => {
      clearTimeout(timer);
      if ('probs' in message) resolve(message.probs);
      else reject(new Error(message.error));
    });
    worker!.postMessage({ id, samples }, [samples.buffer]);
  });
}

/** Linear resampling to 16 kHz, as floats. */
function to16k({ samples, rate }: LinePcm) {
  const out = new Float32Array(Math.floor((samples.length * 16000) / rate));
  const step = rate / 16000;

  for (let i = 0; i < out.length; i += 1) {
    const at = i * step;
    const j = Math.floor(at);
    const next = samples[Math.min(j + 1, samples.length - 1)];

    out[i] = (samples[j] + (next - samples[j]) * (at - j)) / 32768;
  }
  return out;
}

/** Seconds */
type Segment = [start: number, end: number];

/** Speech segments in seconds, Silero's get_speech_timestamps rules (no padding). */
export function speechSegments(probs: ArrayLike<number>): Segment[] {
  const segments: Segment[] = [];
  let start = -1;
  let quietFrom = -1;

  for (let i = 0; i <= probs.length; i += 1) {
    const p = i < probs.length ? probs[i] : 0;

    if (start < 0) {
      if (p >= threshold) start = i;
      continue;
    }
    if (p >= threshold) quietFrom = -1;
    else if (p < negThreshold) {
      if (quietFrom < 0) quietFrom = i;
      if (i === probs.length || (i - quietFrom) * frameSeconds >= minSilence) {
        if ((quietFrom - start) * frameSeconds >= minSpeech)
          segments.push([start * frameSeconds, quietFrom * frameSeconds]);
        start = quietFrom = -1;
      }
    }
  }
  return segments;
}

/** The speech inside the line's window [start, end], cut at its end (GameSentenceMiner's window). */
export function lineSpeech(
  probs: ArrayLike<number>,
  { start, end }: { start: number; end: number }
) {
  return speechSegments(probs)
    .filter(([from, to]) => to > start && from < end)
    .map(([from, to]): Segment => [Math.max(from, start), Math.min(to, end)]);
}

/** A WAV file of mono s16 samples. */
function wav(samples: Int16Array, rate: number) {
  const header = new DataView(new ArrayBuffer(44));
  const text = (at: number, value: string) =>
    [...value].forEach((c, i) => header.setUint8(at + i, c.charCodeAt(0)));

  text(0, 'RIFF');
  header.setUint32(4, 36 + samples.byteLength, true);
  text(8, 'WAVEfmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, 'data');
  header.setUint32(40, samples.byteLength, true);
  return new Blob([header, samples.slice()], { type: 'audio/wav' });
}

function clip({ samples, rate }: LinePcm, from: number, to: number, fades = false) {
  const out = samples.slice(
    Math.max(0, Math.round(from * rate)),
    Math.min(samples.length, Math.round(to * rate))
  );

  if (fades) {
    const n = Math.min(Math.round(fade * rate), out.length >> 1);

    for (let i = 0; i < n; i += 1) {
      out[i] = Math.round((out[i] * i) / n);
      out[out.length - 1 - i] = Math.round((out[out.length - 1 - i] * i) / n);
    }
  }
  return out.length ? wav(out, rate) : undefined;
}

const isPcm = (audio: unknown): audio is LinePcm =>
  !!audio && typeof audio === 'object' && 'samples' in audio && 'rate' in audio;

/**
 * The sound to put on the note of a line with this text: a voice file (Blob) as is, a recorded
 * window (LinePcm) trimmed to its voice; undefined for none (no voice, or the detector failed: the
 * card keeps its picture).
 */
export async function lineAudio(
  audio: Blob | LinePcm | null | undefined,
  text: string
): Promise<Blob | undefined> {
  if (!audio) return undefined;
  if (!isPcm(audio)) return audio;

  let probs: Float32Array;

  try {
    probs = await vad(to16k(audio));
  } catch (error: any) {
    logger.warn(`Visual novel line sound skipped: ${error.message}`);
    return undefined;
  }

  const speech = lineSpeech(probs, audio);
  const length = (speech.at(-1)?.[1] ?? 0) - (speech[0]?.[0] ?? 0);
  // GameSentenceMiner's rule: 0.05 s per character, half a second at least.
  const chars = text.replace(/\s/g, '').length;

  if (!speech.length || length < Math.max(0.5, chars * 0.05)) return undefined;
  // Like GameSentenceMiner, the start isn't trimmed (the click is the line's start), the end is.
  return clip(audio, audio.start - padBefore, speech.at(-1)![1] + padAfter, true);
}
