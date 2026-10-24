/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import {
  isPseudoSlot,
  nextItem,
  placementBands,
  placementLength,
  placementList,
  placementPseudoWords,
  scorePlacement,
  type PlacementAnswer,
  type PlacementItem
} from '$lib/data/placement';

/** A seeded random, so runs repeat. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

/** Takes the whole test with these answers. */
function take(says: (item: PlacementItem) => boolean, seed = 1) {
  const random = seeded(seed);
  const answers: PlacementAnswer[] = [];

  for (let item = nextItem(answers, undefined, random); item; ) {
    answers.push({ item, yes: says(item) });
    item = nextItem(answers, undefined, random);
  }

  return answers;
}

/** Knows every word ranked 1…rank; says yes to the first `falseAlarms` made-up words. */
function knower(rank: number, falseAlarms = 0) {
  let fooled = 0;

  return (item: PlacementItem) => (item.r === undefined ? fooled++ < falseAlarms : item.r <= rank);
}

describe('placement items', () => {
  it('has enough real words in every band and plenty of made-up words', () => {
    placementBands.forEach((high, band) => {
      const real = placementList.filter((item) => item.b === band);

      expect(real.length).toBeGreaterThanOrEqual(6);
      for (const item of real) {
        expect(item.r).toBeGreaterThan(placementBands[band - 1] ?? 0);
        expect(item.r).toBeLessThanOrEqual(high);
      }
    });
    expect(placementList.filter((item) => item.r === undefined).length).toBeGreaterThanOrEqual(
      placementPseudoWords * 20
    );
    expect(new Set(placementList.map((item) => item.w)).size).toBe(placementList.length);
  });

  it('keeps loanwords few and common', () => {
    const loans = placementList.filter((item) => /^[ァ-ヺー]+$/.test(item.w));

    expect(loans.length).toBeLessThanOrEqual(placementList.length / 10);
    for (const item of loans) expect(item.r).toBeLessThanOrEqual(15000);
  });
});

describe('nextItem', () => {
  it('shows each word once, 5 made-up ones spread through it, and stops after the test', () => {
    const answers = take(knower(5000));

    expect(answers).toHaveLength(placementLength);
    expect(new Set(answers.map(({ item }) => item.w)).size).toBe(placementLength);
    answers.forEach(({ item }, i) => expect(item.r === undefined).toBe(isPseudoSlot(i)));
    expect(answers.filter(({ item }) => item.r === undefined)).toHaveLength(5);
  });

  it('spends most words near the boundary', () => {
    const near = take(knower(20000)).filter(
      ({ item }) => item.r && item.r > 7000 && item.r <= 56000
    );

    expect(near.length).toBeGreaterThan(placementLength * 0.6);
  });
});

describe('scorePlacement', () => {
  it('lands near the rank a perfect knower stops at', () => {
    for (const rank of [5000, 20000]) {
      for (const seed of [1, 2, 3]) {
        const { cutoff, retake } = scorePlacement(take(knower(rank), seed));

        expect(retake).toBe(false);
        expect(Math.abs(cutoff - rank) / rank).toBeLessThan(0.25);
      }
    }
  });

  it('climbs to the end of the frequency list for a reader who knows everything real', () => {
    const top = placementBands[placementBands.length - 1];

    expect(top).toBeGreaterThan(300000);
    expect(scorePlacement(take(knower(Infinity))).cutoff).toBe(top);
    expect(Math.abs(scorePlacement(take(knower(100000))).cutoff - 100000)).toBeLessThan(25000);
  });

  it('asks a yes-to-everything clicker to retake, and saves nothing', () => {
    const result = scorePlacement(take(() => true));

    expect(result).toMatchObject({ cutoff: 0, retake: true });
    expect(result.falseAlarms).toBe(result.pseudoWords);
  });

  it('keeps a result after one or two slips, not after three', () => {
    expect(scorePlacement(take(knower(20000, 1))).retake).toBe(false);
    expect(scorePlacement(take(knower(20000, 2))).retake).toBe(false);
    expect(scorePlacement(take(knower(20000, 3)))).toMatchObject({ cutoff: 0, retake: true });
  });

  it('lowers the estimate for made-up words answered yes', () => {
    const fooled = scorePlacement(take(knower(20000, 2)));

    expect(fooled.retake).toBe(false);
    expect(fooled.cutoff).toBeLessThan(scorePlacement(take(knower(20000))).cutoff);
    expect(scorePlacement(take(() => false)).cutoff).toBe(0);
  });
});
