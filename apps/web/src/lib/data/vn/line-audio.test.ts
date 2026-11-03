/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { lineSpeech } from './line-audio';

const frame = 512 / 16000;
/** Speech probabilities over `seconds`, 0.9 inside the given [from, to] spans. */
const probs = (seconds: number, spans: [number, number][]) =>
  Array.from({ length: Math.round(seconds / frame) }, (_, i) =>
    spans.some(([from, to]) => i * frame >= from && i * frame < to) ? 0.9 : 0
  );

describe('lineSpeech', () => {
  it('keeps a voice through a long pause, up to the next line', () => {
    // 「私が娘を、」 1.5 s of silence 「見ていないとでも？」, next click at 8 s.
    const speech = lineSpeech(
      probs(12, [
        [0.6, 1.6],
        [3.1, 4.2]
      ]),
      { start: 0.5, end: 8 }
    );

    expect(speech.at(-1)![1]).toBeGreaterThan(4);
  });

  it('cuts at the next line and drops speech outside the window', () => {
    const speech = lineSpeech(
      probs(12, [
        [0.1, 0.3],
        [0.6, 3],
        [4, 5]
      ]),
      { start: 0.5, end: 2 }
    );

    expect(speech).toHaveLength(1);
    expect(speech[0][1]).toBeCloseTo(2, 1);
  });
});
