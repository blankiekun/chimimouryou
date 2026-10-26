/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import type { BookWord } from '$lib/data/book-words';
import { bookLevel, forYou, histogramShare, relativeLevel } from '$lib/data/difficulty-core';
import { RANKED_BUCKETS, type CoreNumbers } from '$lib/functions/analysis/core';

const core = (hist: Record<number, number>, v98: number | null = 45037): CoreNumbers => {
  const counts = Array.from({ length: RANKED_BUCKETS + 1 }, (_, b) => hist[b] ?? 0);

  return {
    v: 1,
    tokens: counts.reduce((a, b) => a + b, 0),
    types: 1,
    names: 0,
    v98,
    hist: counts,
    histTypes: counts.map((n) => (n ? 1 : 0))
  };
};

describe('bookLevel', () => {
  it('puts the reference median at 5.5, an Ogre, and beyond-the-list books at the top', () => {
    expect(bookLevel(core({ 8: 10 }))).toEqual({ score: 5.5, tier: 'Ogre', v98: 45037 });
    expect(bookLevel(core({ 8: 10 }, null))?.tier).toBe('Demon King');
    expect(bookLevel(core({}))).toBeUndefined();
  });
});

describe('relativeLevel', () => {
  it('maps coverage to 0-5 through its anchors, falling as coverage rises', () => {
    expect([1, 0.995, 0.98, 0.95, 0.9, 0.5].map(relativeLevel)).toEqual([0, 0, 2, 3.5, 5, 5]);
    const levels = Array.from({ length: 200 }, (_, i) => relativeLevel(0.8 + i / 1000));

    expect(levels).toEqual([...levels].sort((a, b) => b - a));
  });
});

describe('forYou', () => {
  const words: BookWord[] = [
    ['猫', 'ねこ', 900, 2000],
    ['犬', 'いぬ', 60, 3000],
    ['狐', 'きつね', 30, 9000],
    ['狸', 'たぬき', 10, 20000],
    ['の', null, 5000, 1]
  ];

  it('counts the words to learn, most frequent first, to reach 98%', () => {
    const known = (word: BookWord) => word[0] === '猫';

    expect(forYou(words, known)).toEqual({
      share: 0.9,
      learn: 2,
      atLeast: false,
      unknownTokens: 100
    });
  });

  it('says when the list runs out first', () => {
    expect(forYou(words, () => false, { tokens: 100_000 })?.atLeast).toBe(true);
  });
});

describe('histogramShare', () => {
  it('knows the buckets under the cutoff and a log share of the one it falls in', () => {
    // bucket 8: ranks 100-177, bucket 16: 10,000-17,782, the last: unranked
    const book = core({ 8: 50, 16: 30, [RANKED_BUCKETS]: 20 });

    expect(histogramShare(book, 1000)).toBeCloseTo(0.5);
    expect(histogramShare(book, 10 ** 6)).toBeCloseTo(0.8);
    expect(histogramShare(book, Math.sqrt(10_000 * 17_783) - 1)).toBeCloseTo(0.65, 2);
  });
});
