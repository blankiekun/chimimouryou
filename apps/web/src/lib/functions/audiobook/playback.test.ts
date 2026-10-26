/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { clampRate, cueEndCrossed, cueTarget, pauseLength, repeatLine, stepRate } from './playback';

const cues = [
  { startSeconds: 1, endSeconds: 3, text: 'a' },
  { startSeconds: 4, endSeconds: 6, text: 'b' },
  { startSeconds: 6, endSeconds: 9, text: 'c' }
];

describe('playback', () => {
  it('keeps speeds on the 0.05 grid between 0.5 and 2', () => {
    expect(clampRate(0.8)).toBe(0.8);
    expect(clampRate(0.83)).toBe(0.85);
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(3)).toBe(2);
    expect(clampRate(Number.NaN)).toBe(1);
    expect(stepRate(0.8, -1)).toBe(0.75);
    expect(stepRate(0.95, 1)).toBe(1);
    expect(stepRate(2, 1)).toBe(2);
  });

  it('finds the previous, current and next line', () => {
    expect(cueTarget(cues, 5, 0)).toBe(1);
    expect(cueTarget(cues, 5, -1)).toBe(0);
    expect(cueTarget(cues, 5, 1)).toBe(2);
    expect(cueTarget(cues, 0, 0)).toBe(0);
    expect(cueTarget(cues, 0, -1)).toBe(0);
    expect(cueTarget(cues, 20, 1)).toBe(2);
    expect(cueTarget([], 5, 1)).toBe(-1);
  });

  it('notices the end of the line being played, not seeks', () => {
    expect(cueEndCrossed(cues, 2.8, 3.05)).toBe(0);
    // In the gap after the line, then into the next
    expect(cueEndCrossed(cues, 3.1, 3.4)).toBe(-1);
    expect(cueEndCrossed(cues, 5.9, 6.1)).toBe(1);
    expect(cueEndCrossed(cues, 2.8, 2.9)).toBe(-1);
    // Seeks: backwards, or too far at once
    expect(cueEndCrossed(cues, 3.2, 2)).toBe(-1);
    expect(cueEndCrossed(cues, 1, 5)).toBe(-1);
    expect(cueEndCrossed(cues, 0.5, 0.9)).toBe(-1);
  });

  it('repeats a line as often as asked', () => {
    expect(repeatLine(0, 100)).toBe(true);
    expect(repeatLine(3, 0)).toBe(true);
    expect(repeatLine(3, 1)).toBe(true);
    expect(repeatLine(3, 2)).toBe(false);
  });

  it('waits after an auto-pause for the gap or the line length', () => {
    expect(pauseLength(0, cues[0], 1)).toBe(0);
    expect(pauseLength(2, cues[0], 1)).toBe(2);
    expect(pauseLength(-1, cues[0], 1)).toBe(2);
    expect(pauseLength(-1, cues[0], 0.5)).toBe(4);
    expect(pauseLength(-1, undefined, 1)).toBe(0);
  });
});
