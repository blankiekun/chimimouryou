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
  placementCutoff,
  placementResults$,
  recordPlacement,
  placementLength,
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

/** Right on reading and meaning, given the item and a random source. */
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
/** Picks a reading and a meaning at random. */
const guesser: Sheet = (_, random) => pick(random) && pick(random);

const cutoffs = (sheet: Sheet, length = placementLength) =>
  Array.from(
    { length: 20 },
    (_, i) => scorePlacement(take(sheet, i + 1, length), undefined, hardGuess).cutoff
  ).sort((a, b) => a - b);

describe('hard items', () => {
  it('has 40 words in every band, four distinct choices each, none giving the answer away', () => {
    expect(hardItems.bands).toEqual(placementBands);
    placementBands.forEach((_, band) =>
      expect(items.filter((item) => item.b === band).length).toBe(40)
    );
    for (const item of items) {
      expect(new Set(item.k).size).toBe(4);
      expect(new Set(item.m).size).toBe(4);
      for (const meaning of item.m) {
        expect(meaning).not.toContain(item.w);
        expect(meaning).not.toContain(item.k[0]);
        expect(meaning.length).toBeLessThanOrEqual(60);
      }
      expect(item.w).toMatch(/[一-鿿々]/);
    }
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

  it('saves a hard result as its own record, and the stricter latest counts', () => {
    placementResults$.next([]);
    recordPlacement('yesno', 20000, 40);
    expect(placementCutoff()).toBe(20000);
    recordPlacement('hard', 12000, 40);
    expect(placementCutoff()).toBe(12000);
    expect(
      placementResults$
        .getValue()
        .map(({ mode }) => mode)
        .sort()
    ).toEqual(['hard', 'yesno']);
    placementResults$.next([]);
  });

  it.skip('prints the simulation table', () => {
    for (const [name, sheet] of [
      ['20k knower', knower(20000)],
      ['readings only past 10k', readerOnly(10000)],
      ['random guesser', guesser]
    ] as const) {
      for (const length of [20, 40, 60]) {
        const run = cutoffs(sheet, length);

        console.log(name, length, run[0], run[10], run[19]);
      }
    }
  });
});
