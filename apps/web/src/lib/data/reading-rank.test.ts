/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import {
  advanceRank,
  countedReading,
  dailyCap,
  eligibleTier,
  lightNovels,
  mergeRankState,
  rankMarks,
  rankPlacementCutoff,
  rankTiers,
  readingRank,
  realBook,
  riseGap,
  testGap,
  type RankBook,
  type RankInput
} from '$lib/data/reading-rank';
import { difficultyScale } from '$lib/data/difficulty-core';
import { coreScore, type CoreNumbers } from '$lib/functions/analysis/core';

const core = (types: number, tokens: number, v98: number | null = 40_000): CoreNumbers => ({
  v: 1,
  tokens,
  types,
  names: 0,
  v98,
  hist: [],
  histTypes: []
});
const shape = { characters: 120_000, uniqueKanji: 1600, core: core(5000, 33_000) };
/** The smallest V98 at this 1-10 level or above */
function v98At(level: number) {
  let [low, high] = [1, 1_000_000];

  while (low < high) {
    const mid = Math.floor((low + high) / 2);

    if (coreScore(mid, difficultyScale) >= level) high = mid;
    else low = mid + 1;
  }
  return low;
}
const book = (level: number, extra: Partial<RankBook> = {}): RankBook => ({
  estimate: { ...shape, core: { ...shape.core, v98: v98At(level) } },
  fraction: 1,
  seconds: 4 * 3600,
  coverage: 0.96,
  ...extra
});
/** Everything a tier needs, with a book at its difficulty */
const enough = (tier: number, books = [book(rankTiers[tier - 1].difficulty)]): RankInput => ({
  characters: rankTiers[tier - 1].characters,
  days: rankTiers[tier - 1].days,
  wordsKnown: rankTiers[tier - 1].words,
  books
});
const T = 1000 * riseGap;
const stat = (dateKey: string, charactersRead: number, readingTime: number, title = 'A') =>
  ({ dateKey, charactersRead, readingTime, title }) as BooksDbStatistic;

describe('eligibleTier', () => {
  it('meets each tier exactly at its thresholds', () => {
    for (let tier = 1; tier <= 7; tier += 1) expect(eligibleTier(enough(tier))).toBe(tier);
  });

  it('stays below a tier when any one requirement is short', () => {
    for (let tier = 2; tier <= 7; tier += 1) {
      const input = enough(tier);

      expect(eligibleTier({ ...input, wordsKnown: input.wordsKnown - 1 })).toBe(tier - 1);
      expect(eligibleTier({ ...input, characters: input.characters - 1 })).toBe(tier - 1);
      expect(eligibleTier({ ...input, days: input.days - 1 })).toBe(tier - 1);
      expect(eligibleTier(enough(tier, [book(rankTiers[tier - 1].difficulty - 0.01)]))).toBe(
        tier - 1
      );
    }
  });

  it('needs 95% coverage of the hard book', () => {
    expect(eligibleTier(enough(4, [book(5.6, { coverage: 0.949 })]))).toBe(1);
    expect(eligibleTier(enough(4, [book(5.6, { coverage: 0.95 })]))).toBe(4);
  });

  it('does not rise from easy reading, however much', () => {
    const input = { characters: 50_000_000, days: 2000, wordsKnown: 50_000, books: [] };

    expect(eligibleTier(input)).toBe(1);
    expect(eligibleTier({ ...input, books: Array(500).fill(book(2.4)) })).toBe(2);
  });

  it('counts only finished, plausibly read, real books', () => {
    expect(eligibleTier(enough(4, [book(5.6, { fraction: 0.96 })]))).toBe(1);
    // 120k characters at 1,000 a minute is two hours.
    expect(eligibleTier(enough(4, [book(5.6, { seconds: 7100 })]))).toBe(1);
    expect(eligibleTier(enough(4, [book(5.6, { seconds: 7200 })]))).toBe(4);
  });

  it('takes the canonical engine check', () => {
    expect(eligibleTier(enough(4), () => false)).toBe(1);
    expect(eligibleTier(enough(4), () => true)).toBe(4);
  });
});

describe('realBook', () => {
  it('accepts real books, long ones too', () => {
    expect(realBook(shape)).toBe(true);
    expect(realBook({ characters: 827_000, uniqueKanji: 2600, core: core(20_000, 229_000) })).toBe(
      true
    );
  });

  it('rejects short, small, repetitive or odd-kanji texts and older estimates', () => {
    expect(realBook({ ...shape, characters: 49_999 })).toBe(false);
    expect(realBook({ ...shape, core: core(2500, 33_000) })).toBe(false);
    expect(realBook({ ...shape, core: core(9000, 33_000) })).toBe(false);
    expect(realBook({ ...shape, core: core(5000, 37_500) })).toBe(false);
    expect(realBook({ ...shape, core: core(5000, 28_000) })).toBe(false);
    expect(realBook({ ...shape, uniqueKanji: 2200 })).toBe(false);
    expect(realBook({ ...shape, uniqueKanji: 900 })).toBe(false);
    expect(realBook({ characters: 120_000, uniqueKanji: 1600 })).toBe(false);
    // The thresholds are 1-10 levels; a book beyond the frequency list is the top.
    expect(eligibleTier(enough(7, [book(9.2)]))).toBe(7);
    expect(
      eligibleTier(
        enough(7, [{ ...book(1), estimate: { ...shape, core: core(5000, 33_000, null) } }])
      )
    ).toBe(7);
  });
});

describe('countedReading', () => {
  it('caps a day at its reading time × 1,000 a minute and at the daily cap', () => {
    expect(countedReading([stat('2026-10-01', 30_000, 600)])).toEqual({
      characters: 10_000,
      days: 1
    });
    expect(countedReading([stat('2026-10-01', 900_000, 36_000)]).characters).toBe(dailyCap);
  });

  it('counts jumps and negative days as nothing', () => {
    expect(countedReading([stat('2026-10-01', 80_000, 0), stat('2026-10-02', -500, 60)])).toEqual({
      characters: 0,
      days: 0
    });
  });

  it('caps the day over all titles', () => {
    const day = [stat('2026-10-01', 6000, 60, 'A'), stat('2026-10-01', 6000, 60, 'B')];

    expect(countedReading(day)).toEqual({ characters: 2000, days: 1 });
  });
});

describe('word test and marks', () => {
  const at = (date: number, cutoff: number) => ({
    mode: 'yesno' as const,
    date,
    cutoff,
    length: 40
  });

  it('ignores retakes within a week', () => {
    const t = 100 * testGap;

    expect(rankPlacementCutoff([at(t, 5000), at(t + 60_000, 40_000)])).toBe(5000);
    expect(rankPlacementCutoff([at(t, 5000), at(t + testGap, 40_000)])).toBe(40_000);
    // Each retake restarts the week.
    expect(
      rankPlacementCutoff([at(t, 5000), at(t + testGap - 1, 9000), at(t + testGap + 1, 40_000)])
    ).toBe(5000);
    expect(rankPlacementCutoff([])).toBe(0);
  });

  it('keeps only marks of words met', () => {
    const mark = { status: 'known' as const, modified: 1 };

    expect(
      Object.keys(
        rankMarks(
          { '猫\tねこ': mark, '犬\t': mark, '鳥\t': mark },
          { '猫\tねこ': 3, '犬\tいぬ': 1 }
        )
      )
    ).toEqual(['猫\tねこ', '犬\t']);
  });
});

describe('advanceRank', () => {
  it('rises one tier per week at most', () => {
    const first = advanceRank(undefined, 7, T);

    expect(first).toEqual({ tier: 2, at: T });
    expect(advanceRank(first, 7, T + riseGap - 1)).toEqual(first);
    expect(advanceRank(first, 7, T + riseGap)).toEqual({ tier: 3, at: T + riseGap });
  });

  it('never drops', () => {
    expect(advanceRank({ tier: 5, at: 0 }, 1, riseGap * 10)).toEqual({ tier: 5, at: 0 });
  });

  it('merges to the higher rank', () => {
    expect(mergeRankState({ tier: 3, at: 5 }, { tier: 4, at: 9 })).toEqual({ tier: 4, at: 9 });
    expect(mergeRankState({ tier: 4, at: 5 }, { tier: 4, at: 9 })).toEqual({ tier: 4, at: 5 });
  });
});

describe('readingRank', () => {
  it('gives the next tier with progress and the light novels', () => {
    const rank = readingRank(
      { characters: 1_234_567, days: 50, wordsKnown: 7000, books: [book(6)] },
      { tier: 3, at: 0 },
      riseGap
    );

    expect(rank.tier).toBe(4);
    expect(rank.novels).toBe(12.3);
    expect(rank.next?.tier).toBe(5);
    expect(rank.next?.requirements.map((req) => req.met)).toEqual([false, false, false, false]);
    expect(lightNovels(99_999)).toBe(0.9);
  });

  it('says when an earned tier comes, and has no next at the top', () => {
    const waiting = readingRank(enough(4), { tier: 2, at: 50 }, 60);

    expect(waiting.tier).toBe(2);
    expect(waiting.next?.risesAt).toBe(50 + riseGap);
    expect(readingRank(enough(7), { tier: 7, at: 0 }, 0).next).toBeUndefined();
  });
});
