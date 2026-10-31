/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * A mined VN line's sound, for Anki (lib/data/dictionary/anki.ts): native play's ring
 * (apps/desktop/game-media.js, via /hook) and the VN players' (static/vn/overlay.js, via /v) hand
 * over the recorded sound of the line's window, from the click that brought the line to the next
 * line's, with a little before and after. With "Voice only" (Settings → Anki) the speech
 * detector (line-vad.worker.ts) finds the voice in it: speech already going before the line's
 * click is the previous line's and is dropped, and a line with no speech left, or too little for
 * its text, gets no sound at all (not a BGM clip). Not part of upstream.
 */

import { ankiVnVoiceOnly$ } from '$lib/data/dictionary/anki';
import type { LineVadMessage } from '$lib/functions/vn/line-vad.worker';

/** A line's recorded sound: mono s16 samples; `start`/`end` its window, seconds into them. */
export interface LinePcm {
  samples: Int16Array;
  rate: number;
  start: number;
  end: number;
}

/** Recorded before the window's start, so speech crossing it is seen as already going. */
export const preRollMs = 400;
/** Recorded after the window's end: a voice that began in the window is kept to its end. */
export const tailMs = 6000;

const frameSeconds = 512 / 16000;
const threshold = 0.5;
const negThreshold = 0.35;
const minSilence = 0.1;
const minSpeech = 0.25;
/** Speech starting this little before the click still counts as the line's (timing jitter). */
const startGrace = 0.15;
const padBefore = 0.15;
const padAfter = 0.2;
const fade = 0.05;

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, (message: LineVadMessage) => void>();

/** Speech probability per 32 ms frame of 16 kHz samples. */
function vad(samples: Float32Array) {
  if (!worker) {
    worker = new Worker(new URL('../../functions/vn/line-vad.worker.ts', import.meta.url), {
      type: 'module'
    });
    worker.onmessage = ({ data }: MessageEvent<LineVadMessage>) => {
      pending.get(data.id)?.(data);
      pending.delete(data.id);
    };
  }
  const id = (nextId += 1);

  return new Promise<Float32Array>((resolve, reject) => {
    pending.set(id, (message) =>
      'probs' in message ? resolve(message.probs) : reject(new Error(message.error))
    );
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

/** Seconds; `cut`: ended where the next line's sound begins, so no padding after it. */
type Segment = [start: number, end: number, cut?: boolean];

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

/**
 * The line's speech: segments that began in [start, end). One already going at the start is the
 * previous line's voice (a voice the game doesn't cut at the click). One going on past the end runs
 * on only while it doesn't pause: after a pause, or right where the next line's voice starts, it is
 * the next line's.
 */
export function lineSpeech(probs: ArrayLike<number>, start: number, end: number): Segment[] {
  return speechSegments(probs)
    .filter(([from]) => from >= start - startGrace && from < end)
    .map(([from, to]) => {
      for (let i = Math.ceil(end / frameSeconds); i * frameSeconds < to; i += 1)
        if (probs[i] < threshold) return [from, i * frameSeconds, true];
      return [from, to];
    });
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
 * window (LinePcm) trimmed to its voice (Voice only) or whole; undefined for none.
 */
export async function lineAudio(
  audio: Blob | LinePcm | null | undefined,
  text: string
): Promise<Blob | undefined> {
  if (!audio) return undefined;
  if (!isPcm(audio)) return audio;
  if (!ankiVnVoiceOnly$.getValue()) return clip(audio, audio.start, audio.end);

  const speech = lineSpeech(await vad(to16k(audio)), audio.start, audio.end);
  const length = (speech.at(-1)?.[1] ?? 0) - (speech[0]?.[0] ?? 0);
  // GameSentenceMiner's rule: 0.05 s per character, half a second at least.
  const chars = text.replace(/\s/g, '').length;

  if (!speech.length || length < Math.max(0.5, chars * 0.05)) return undefined;
  const [, to, cut] = speech.at(-1)!;

  return clip(audio, speech[0][0] - padBefore, to + (cut ? 0 : padAfter), true);
}
