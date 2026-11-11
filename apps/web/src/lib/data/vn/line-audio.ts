/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * A mined VN line's sound, for Anki (lib/data/dictionary/anki.ts): native play's ring
 * (apps/desktop/game-media.js, via /hook) and the VN players' (static/vn/overlay.js, via /v) hand
 * over the recorded sound of the line's window, as GameSentenceMiner cuts it, up to the next
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

/** GameSentenceMiner's audio.end_offset. */
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

/** Speech segments, in seconds, of mono samples at `rate`. */
function vad(samples: Int16Array, rate: number) {
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

  return new Promise<Segment[]>((resolve, reject) => {
    const timer = setTimeout(() => failVad('no answer in 5 minutes'), vadTimeoutMs);

    pending.set(id, (message) => {
      clearTimeout(timer);
      if ('segments' in message) resolve(message.segments);
      else reject(new Error(message.error));
    });
    worker!.postMessage({ id, samples, rate }, [samples.buffer]);
  });
}

/** Seconds */
type Segment = [start: number, end: number];

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

/** Why the last recorded window gave no sound ('' when it did). */
export let lineAudioWhy = '';

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

  let speech: Segment[];

  lineAudioWhy = '';
  try {
    // Only the line's window, as GameSentenceMiner's detector hears it.
    const window = audio.samples.subarray(
      Math.max(0, Math.round(audio.start * audio.rate)),
      Math.round(audio.end * audio.rate)
    );

    speech = (await vad(window.slice(), audio.rate)).map(([from, to]) => [
      from + Math.max(0, audio.start),
      to + Math.max(0, audio.start)
    ]);
  } catch (error: any) {
    logger.warn(`Visual novel line sound skipped: ${error.message}`);
    lineAudioWhy = `the voice finder failed: ${error.message}`;
    return undefined;
  }

  if (!speech.length) {
    lineAudioWhy = 'no speech in it';
    return undefined;
  }

  // GameSentenceMiner's rules (vad.py _validate_detection): a last segment starting in the window's
  // final half second is the next line's; 0.05 s per character, half a second at least.
  const last =
    speech.length > 1 && audio.end - speech.at(-1)![0] < 0.5 ? speech.at(-2)! : speech.at(-1)!;
  const length = last[1] - speech[0][0];

  if (length < Math.max(0.5, text.length * 0.05)) {
    lineAudioWhy = `only ${length.toFixed(1)} s of speech for ${text.length} characters`;
    return undefined;
  }

  // Like GameSentenceMiner, the start isn't trimmed, the end is.
  return clip(audio, audio.start, Math.min(last[1] + padAfter, audio.end), true);
}
