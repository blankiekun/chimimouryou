/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import hardItems from '$lib/data/placement-hard-items.json';
import {
  hardGuess,
  nextItem,
  placementBands,
  placementLength,
  readingMatches,
  scorePlacement,
  type HardItem,
  type PlacementAnswer
} from '$lib/data/placement';

const items = hardItems.items as HardItem[];

function seeded(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

/** Right on the typed reading and the meaning, given the item and a random source. */
type Sheet = (item: HardItem, random: () => number) => boolean;

function take(sheet: Sheet, seed = 1, length = placementLength) {
  const random = seeded(seed);
  const answers: PlacementAnswer[] = [];
  const next = () => nextItem(answers, items, random, undefined, length) as HardItem | undefined;

  for (let item = next(); item; item = next()) answers.push({ item, yes: sheet(item, random) });

  return answers;
}

const pick = (random: () => number) => Math.floor(random() * 4) === 0;
/** Knows readings and meanings to `rank`, answers "I don't know" past it. */
const knower =
  (rank: number): Sheet =>
  (item) =>
    item.r! <= rank;
/** Knows every reading, but meanings only to `rank`: guesses the meaning past it. */
const readerOnly =
  (rank: number): Sheet =>
  (item, random) =>
    item.r! <= rank || pick(random);
/** Types a reading built from the kanji's usual readings (right about 60% of the time past
 * the words it knows, measured on the bank) and rules out meanings down to two. */
const eliminator =
  (rank: number): Sheet =>
  (item, random) =>
    item.r! <= rank || (random() < 0.6 && random() < 0.5);
/** Types some reading and picks a meaning at random. */
const guesser: Sheet = (_, random) => random() < 0.05 && pick(random);
const kanjiIn = (item: HardItem, text: string) =>
  [...new Set(item.w)].filter((c) => /[一-鿿々]/.test(c) && text.includes(c)).length;

const cutoffs = (sheet: Sheet, length = placementLength) =>
  Array.from(
    { length: 20 },
    (_, i) => scorePlacement(take(sheet, i + 1, length), undefined, hardGuess).cutoff
  ).sort((a, b) => a - b);

describe('hard items', () => {
  it('has 40 words in every band, four distinct meanings each, none giving the answer away', () => {
    expect(hardItems.bands).toEqual(placementBands);
    placementBands.forEach((_, band) =>
      expect(items.filter((item) => item.b === band).length).toBe(40)
    );
    for (const item of items) {
      expect(new Set(item.k).size).toBe(item.k.length);
      expect(new Set(item.m).size).toBe(4);
      for (const meaning of item.m) {
        expect(meaning).not.toContain(item.w);
        expect(meaning).not.toContain(item.k[0]);
        expect(meaning.length).toBeLessThanOrEqual(60);
        // The word's kanji don't point to the right meaning.
        expect(kanjiIn(item, meaning)).toBe(kanjiIn(item, item.m[0]));
      }
      expect(item.w).toMatch(/[一-鿿々]/);
    }
  });
});

describe('typed readings', () => {
  const item = { w: '今日', r: 1, b: 0, k: ['きょう', 'こんにち'], m: [] } as HardItem;

  it('takes any listed reading, in hiragana, katakana or romaji', () => {
    expect(readingMatches(item, 'きょう')).toBe(true);
    expect(readingMatches(item, ' コンニチ ')).toBe(true);
    expect(readingMatches(item, 'kyou')).toBe(true);
    expect(readingMatches(item, 'konnnichi')).toBe(true);
    expect(readingMatches(item, 'きょ')).toBe(false);
    expect(readingMatches(item, 'こんじつ')).toBe(false);
  });
});

describe('hard scoring', () => {
  it('lands near a perfect knower’s rank', () => {
    const run = cutoffs(knower(20000));

    expect(run[10]).toBeGreaterThan(16000);
    expect(run[10]).toBeLessThan(24000);
  });

  it('gives a reader who only knows readings past 10k about 10k, not more', () => {
    expect(cutoffs(readerOnly(10000))[10]).toBeLessThan(14000);
  });

  it('gives a random guesser next to nothing', () => {
    expect(cutoffs(guesser)[19]).toBeLessThan(1000);
  });

  it('keeps a 5k learner who eliminates near 5k, not 400k', () => {
    expect(cutoffs(eliminator(5000))[19]).toBeLessThan(10000);
  });
});
