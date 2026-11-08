/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { autoThread, type NativeThread } from './native-games';

const thread = (hookcode: string, lines: number, id = hookcode): NativeThread => ({
  id,
  hookcode,
  label: hookcode,
  kind: 'hcode',
  count: lines,
  recent: Array.from({ length: lines }, (_, index) => ({ text: `行${index}`, click: index }))
});
const row = (score: number, hookcode = 'HA', lines = 10, id?: string) => ({
  thread: thread(hookcode, lines, id),
  score
});

// Ways it could pick wrong: too early (few lines), a mediocre best, two hooks with the game's
// text (which one is a guess), or the best's own other contexts counted as rivals.
describe('autoThread', () => {
  it('picks nothing before any line', () => {
    expect(autoThread([])).toBeUndefined();
  });

  it('waits for enough lines on the best thread', () => {
    expect(autoThread([row(1, 'HA', 7), row(0.1, 'HB')])).toBeUndefined();
  });

  it('leaves a best that is only fairly good to the reader', () => {
    expect(autoThread([row(0.7), row(0.1, 'HB')])).toBeUndefined();
  });

  it('leaves two hooks with the game’s text to the reader', () => {
    expect(autoThread([row(0.95), row(0.6, 'HB')])).toBeUndefined();
  });

  it('picks a clear winner', () => {
    const best = row(0.9);

    expect(autoThread([best, row(0.45, 'HB'), row(0.1, 'HC')])).toBe(best.thread);
  });

  it('does not count the same hook on another context as a rival', () => {
    const best = row(0.9, 'HA', 10, 'HA|1');

    expect(autoThread([best, row(0.85, 'HA', 10, 'HA|2'), row(0.2, 'HB')])).toBe(best.thread);
  });
});
