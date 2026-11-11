/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * GPL-3.0-or-later, as a port of GPL code. FireRedVAD's input and output as GameSentenceMiner runs it (GameSentenceMiner/vad.py, GPL-3.0,
 * https://github.com/bpwhelan/GameSentenceMiner): Kaldi's 80-bin log filterbank with its
 * normalization, and the post-processor with its default settings. Not part of upstream.
 */

import cmvn from './firered-cmvn.json';

const frameLength = 400;
const frameShift = 160;
const fftSize = 512;
const bins = 80;
export const featureBins = bins;

const shiftSeconds = 0.01;
const lengthSeconds = 0.025;
const smoothWindow = 5;
const speechThreshold = 0.4;
const minSpeechFrames = 20;
const maxSpeechFrames = 2000;
const minSilenceFrames = 20;

const window = Float64Array.from(
  { length: frameLength },
  (_, i) => (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameLength - 1))) ** 0.85
);

const mel = (hz: number) => 1127 * Math.log(1 + hz / 700);

/** Kaldi's triangular mel filters over the FFT's bins, 20 Hz to Nyquist. */
const filters = Array.from({ length: bins }, (_, bin) => {
  const low = mel(20);
  const delta = (mel(8000) - low) / (bins + 1);
  const [left, center, right] = [0, 1, 2].map((step) => low + (bin + step) * delta);
  const weights: [number, number][] = [];

  for (let i = 0; i < fftSize / 2; i += 1) {
    const at = mel((i * 16000) / fftSize);

    if (at > left && at < right) {
      weights.push([
        i,
        at <= center ? (at - left) / (center - left) : (right - at) / (right - center)
      ]);
    }
  }
  return weights;
});

/** In-place radix-2 FFT of fftSize points. */
function fft(re: Float64Array, im: Float64Array) {
  for (let i = 1, j = 0; i < fftSize; i += 1) {
    let bit = fftSize >> 1;

    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= fftSize; size <<= 1) {
    const angle = (-2 * Math.PI) / size;

    for (let start = 0; start < fftSize; start += size) {
      for (let k = 0; k < size / 2; k += 1) {
        const [wr, wi] = [Math.cos(angle * k), Math.sin(angle * k)];
        const [a, b] = [start + k, start + k + size / 2];
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;

        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** Normalized features of 16 kHz samples at 16-bit scale: frames × 80, row by row. */
export function features(samples: Int16Array) {
  const frames =
    samples.length < frameLength ? 0 : 1 + Math.floor((samples.length - frameLength) / frameShift);
  const out = new Float32Array(frames * bins);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  for (let frame = 0; frame < frames; frame += 1) {
    const from = frame * frameShift;
    let mean = 0;

    re.fill(0);
    im.fill(0);
    for (let i = 0; i < frameLength; i += 1) mean += samples[from + i];
    mean /= frameLength;
    for (let i = 0; i < frameLength; i += 1) re[i] = samples[from + i] - mean;
    for (let i = frameLength - 1; i > 0; i -= 1) re[i] -= 0.97 * re[i - 1];
    re[0] -= 0.97 * re[0];
    for (let i = 0; i < frameLength; i += 1) re[i] *= window[i];
    fft(re, im);
    for (let bin = 0; bin < bins; bin += 1) {
      let energy = 0;

      for (const [i, weight] of filters[bin]) energy += weight * (re[i] * re[i] + im[i] * im[i]);
      out[frame * bins + bin] =
        (Math.log(Math.max(energy, 1.1920928955078125e-7)) - cmvn.means[bin]) *
        cmvn.inverseStd[bin];
    }
  }
  return { data: out, frames };
}

function decide(probs: ArrayLike<number>) {
  const n = probs.length;
  const speechy = Array.from({ length: n }, (_, i) => {
    const from = Math.max(0, i - smoothWindow + 1);
    let sum = 0;

    for (let j = from; j <= i; j += 1) sum += probs[j];
    return sum / (i - from + 1) >= speechThreshold;
  });
  const decisions = new Array<number>(n).fill(0);
  let state: 'silence' | 'maybeSpeech' | 'speech' | 'maybeSilence' = 'silence';
  let speechStart = -1;
  let silenceStart = -1;

  speechy.forEach((isSpeech, i) => {
    if (state === 'silence') {
      if (isSpeech) {
        state = 'maybeSpeech';
        speechStart = i;
      }
    } else if (state === 'maybeSpeech') {
      if (!isSpeech) {
        state = 'silence';
        speechStart = -1;
      } else if (i - speechStart >= minSpeechFrames) {
        state = 'speech';
        decisions.fill(1, speechStart, i);
      }
    } else if (state === 'speech') {
      if (!isSpeech) {
        state = 'maybeSilence';
        silenceStart = i;
      }
    } else if (isSpeech) {
      state = 'speech';
      silenceStart = -1;
    } else if (i - silenceStart >= minSilenceFrames) {
      state = 'silence';
      decisions.fill(0, silenceStart, i + 1);
      speechStart = -1;
    }
    if (state === 'speech' || state === 'maybeSilence') decisions[i] = 1;
  });

  const started = decisions.slice();

  decisions.forEach((decision, i) => {
    if (i > 0 && decisions[i - 1] === 0 && decision === 1) {
      started.fill(1, Math.max(0, i - smoothWindow), i);
    }
  });
  return started;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function toSegments(decisions: number[], duration?: number) {
  const segments: [number, number][] = [];
  let start = -1;

  decisions.forEach((decision, i) => {
    if (decision === 1 && start < 0) start = i;
    else if (decision === 0 && start >= 0) {
      segments.push([round3(start * shiftSeconds), round3(i * shiftSeconds)]);
      start = -1;
    }
  });
  if (start >= 0) {
    const end = decisions.length * shiftSeconds + lengthSeconds;

    segments.push([
      round3(start * shiftSeconds),
      round3(duration === undefined ? end : Math.min(end, duration))
    ]);
  }
  return segments;
}

/** Speech segments in seconds from the model's per-frame probabilities. */
export function speechSegments(probs: ArrayLike<number>, duration: number) {
  const decisions = decide(probs);
  const split = decisions.slice();

  for (const [from, to] of toSegments(decisions)) {
    const startFrame = Math.trunc(from / shiftSeconds);
    const length = Math.trunc(to / shiftSeconds) - startFrame;

    if (length <= maxSpeechFrames) continue;
    for (let at = 0; length - at > maxSpeechFrames;) {
      const windowStart = Math.trunc(at + maxSpeechFrames / 2);
      let lowest = windowStart;

      for (let i = windowStart; i < at + maxSpeechFrames; i += 1) {
        if (probs[startFrame + i] < probs[startFrame + lowest]) lowest = i;
      }
      split[startFrame + lowest] = 0;
      at = lowest + 1;
    }
  }
  return toSegments(split, duration).filter(([from, to]) => to > from);
}
