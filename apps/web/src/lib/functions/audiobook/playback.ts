/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Audiobook playback rules shared by both players (audiobook and Audiobookshelf): speed steps,
 * line (cue) navigation and what happens at the end of a line (repeat, pause). Not part of upstream.
 */

import { cueAt, type SubtitleCue } from '$lib/functions/audiobook/subtitles';

export const rateMin = 0.5;
export const rateMax = 2;
export const rateStep = 0.05;
export const ratePresets = [0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5, 2];

/** A speed on the 0.05 grid between 0.5× and 2×. */
export function clampRate(rate: number) {
  if (!Number.isFinite(rate)) return 1;
  const stepped = Math.round(rate / rateStep) * rateStep;

  return Math.min(rateMax, Math.max(rateMin, Number(stepped.toFixed(2))));
}

export const stepRate = (rate: number, steps: number) => clampRate(rate + steps * rateStep);

/** The line to play: offset -1 the previous one, 0 the current one again, 1 the next. -1 without lines. */
export function cueTarget(cues: SubtitleCue[], seconds: number, offset: number) {
  if (!cues.length) return -1;

  return Math.min(Math.max(cueAt(cues, seconds) + offset, 0), cues.length - 1);
}

/** Longest step between two playback ticks; a longer one is a seek, not playback. */
const maxTick = 1.5;

/**
 * The line whose end playback passed going from `from` to `to` seconds (the line playing at
 * `from`), or -1 (none, or a seek).
 */
export function cueEndCrossed(cues: SubtitleCue[], from: number, to: number) {
  if (to <= from || to - from > maxTick) return -1;

  const index = cueAt(cues, from);
  const cue = cues[index];

  return cue && from < cue.endSeconds && to >= cue.endSeconds ? index : -1;
}

/**
 * Whether a line already repeated `repeats` times plays again while looping. `loopCount` is how
 * often each line plays, 0 = until looping is switched off.
 */
export const repeatLine = (loopCount: number, repeats: number) =>
  loopCount <= 0 || repeats + 1 < loopCount;

/** Seconds to wait after an auto-pause before going on: `gap` seconds, -1 = the line's length. */
export function pauseLength(gap: number, cue: SubtitleCue | undefined, rate: number) {
  if (gap < 0) {
    return cue ? Math.max(0.5, (cue.endSeconds - cue.startSeconds) / (rate || 1)) : 0;
  }

  return gap;
}
