/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import {
  advanceStep,
  countedReading,
  dailyCap,
  eligibleStep,
  lightNovels,
  mergeStepState,
  qualifyingLevels,
  rankMarks,
  rankPlacementCutoff,
  rankSteps,
  readingRank,
  realBook,
  riseGap,
  stepState,
  testGap,
  tierOfStep,
  type RankBook,
  type RankInput
} from '$lib/data/stats/reading-rank';
import { difficultyScale } from '$lib/data/difficulty/difficulty-core';
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
/** A finished book at this level; `copy` makes another text (another unique-kanji count). */
const book = (level: number, extra: Partial<RankBook> = {}, copy = 0): RankBook => ({
  estimate: {
    ...shape,
    uniqueKanji: shape.uniqueKanji + copy,
    core: { ...shape.core, v98: v98At(level) }
  },
  fraction: 1,
  seconds: 4 * 3600,
  coverage: 0.96,
  ...extra
});
/** Everything a step (1-19) needs, with its books at its level */
const enough = (step: number, books?: RankBook[]): RankInput => {
  const need = rankSteps[step - 1];

  return {
    characters: need.characters,
    days: need.days,
    wordsKnown: need.words,
    books: books ?? Array.from({ length: need.books }, (_, i) => book(need.level, {}, i))
  };
};
const T = 1000 * riseGap;
const stat = (dateKey: string, charactersRead: number, readingTime: number, title = 'A') =>
  ({ dateKey, charactersRead, readingTime, title }) as BooksDbStatistic;

describe('eligibleStep', () => {
  it('meets each step exactly at its thresholds', () => {
    for (let step = 1; step <= 19; step += 1) expect(eligibleStep(enough(step))).toBe(step);
  });

  it('stays below a step when any one requirement is short', () => {
    for (let step = 2; step <= 19; step += 1) {
      const input = enough(step);
      const { level } = rankSteps[step - 1];

      expect(eligibleStep({ ...input, wordsKnown: input.wordsKnown - 1 })).toBeLessThan(step);
      expect(eligibleStep({ ...input, characters: input.characters - 1 })).toBeLessThan(step);
      expect(eligibleStep({ ...input, days: input.days - 1 })).toBeLessThan(step);
      expect(eligibleStep({ ...input, books: input.books.slice(1) })).toBeLessThan(step);
      expect(
        eligibleStep({ ...input, books: [...input.books.slice(1), book(level - 0.05, {}, 99)] })
      ).toBeLessThan(step);
    }
  });

  // Catches the gate taking the single hardest book again: one 9.5 book must not pass 3-book steps.
  it('counts books at the level, not the single hardest', () => {
    const top = { characters: 1e8, days: 5000, wordsKnown: 50_000 };
    const three = [book(9.5, {}, 1), book(9.5, {}, 2), book(9.5, {}, 3)];

    expect(eligibleStep({ ...top, books: [book(9.5)] })).toBe(4);
    expect(eligibleStep({ ...top, books: three })).toBe(17);
  });

  // Catches a copy of one book (the same text under two titles) counting as two.
  it('counts the same book once', () => {
    expect(qualifyingLevels([book(6), book(6)])).toHaveLength(1);
    expect(qualifyingLevels([book(6, {}, 1), book(6, {}, 2)])).toHaveLength(2);
  });

  it('needs 95% coverage of each book', () => {
    expect(eligibleStep(enough(4, [book(2.4, { coverage: 0.949 })]))).toBe(1);
    expect(eligibleStep(enough(4, [book(2.4, { coverage: 0.95 })]))).toBe(4);
  });

  it('does not rise from easy reading, however much', () => {
    const input = { characters: 50_000_000, days: 2000, wordsKnown: 50_000, books: [] };

    expect(eligibleStep(input)).toBe(1);
    expect(eligibleStep({ ...input, books: [book(2.4)] })).toBe(4);
  });

  it('counts only finished, plausibly read, real books', () => {
    expect(eligibleStep(enough(4, [book(2.4, { fraction: 0.96 })]))).toBe(1);
    // 120k characters at 1,000 a minute is two hours.
    expect(eligibleStep(enough(4, [book(2.4, { seconds: 7100 })]))).toBe(1);
    expect(eligibleStep(enough(4, [book(2.4, { seconds: 7200 })]))).toBe(4);
  });

  it('takes the canonical engine check', () => {
    expect(eligibleStep(enough(4), () => false)).toBe(1);
    expect(eligibleStep(enough(4), () => true)).toBe(4);
  });

  // Catches III drifting from the old tiers, which old devices still rise on.
  it('keeps III of each rank at the old tier thresholds', () => {
    const old = [
      [100_000, 7, 1_500, 2.4],
      [250_000, 20, 3_000, 4.1],
      [600_000, 45, 6_000, 5.6],
      [1_500_000, 90, 10_000, 6.7],
      [4_000_000, 180, 15_000, 8.1],
      [10_000_000, 300, 20_000, 9.2]
    ];

    old.forEach(([characters, days, words, level], i) =>
      expect(rankSteps[3 * i + 3]).toMatchObject({
        rank: i + 2,
        step: 3,
        characters,
        days,
        words,
        level
      })
    );
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
    expect(qualifyingLevels([book(9.2)])[0]).toBeGreaterThanOrEqual(9.2);
    expect(
      qualifyingLevels([{ ...book(1), estimate: { ...shape, core: core(5000, 33_000, null) } }])[0]
    ).toBeGreaterThanOrEqual(9.2);
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

describe('steps over time', () => {
  // Catches a rise of two steps at once after a long gap.
  it('rises one step per week at most', () => {
    const first = advanceStep(undefined, 19, T);

    expect(first).toEqual({ step: 2, at: T });
    expect(advanceStep(first, 19, T + riseGap - 1)).toEqual(first);
    expect(advanceStep(first, 19, T + riseGap * 50)).toEqual({ step: 3, at: T + riseGap * 50 });
  });

  it('never drops', () => {
    expect(advanceStep({ step: 12, at: 0 }, 1, riseGap * 10)).toEqual({ step: 12, at: 0 });
  });

  // Catches a sync keeping the lower or the later-reached step.
  it('merges to the higher step, reached first', () => {
    expect(mergeStepState({ step: 11, at: 5 }, { step: 12, at: 9 })).toEqual({ step: 12, at: 9 });
    expect(mergeStepState({ step: 12, at: 5 }, { step: 11, at: 1 })).toEqual({ step: 12, at: 5 });
    expect(mergeStepState({ step: 12, at: 5 }, { step: 12, at: 9 })).toEqual({ step: 12, at: 5 });
    expect(mergeStepState({}, { step: 4, at: 9 })).toEqual({ step: 4, at: 9 });
  });

  // Catches an old device's tier (always III of that rank) read as a lower step, and the new
  // app writing the rank of a I/II step as a tier, which an old device would read as III.
  it('reads an old tier as III and writes only ranks whose III is reached', () => {
    expect(stepState({}, { tier: 5, at: 7 })).toEqual({ step: 13, at: 7 });
    expect(stepState({}, { tier: 1, at: 0 })).toEqual({ step: 1, at: 0 });
    expect(stepState({ step: 14, at: 9 }, { tier: 5, at: 7 })).toEqual({ step: 14, at: 9 });
    expect(stepState({ step: 11, at: 9 }, { tier: 5, at: 7 })).toEqual({ step: 13, at: 7 });
    expect([1, 2, 3, 4, 5, 11, 12, 13, 19].map(tierOfStep)).toEqual([1, 1, 1, 2, 2, 4, 4, 5, 7]);
  });
});

describe('readingRank', () => {
  const day = 24 * 60 * 60 * 1000;

  it('gives the next step with tracks from the step before, and the light novels', () => {
    const rank = readingRank(
      { characters: 1_234_567, days: 80, wordsKnown: 9000, books: [book(6.8)] },
      { step: 12, at: 0 },
      riseGap
    );

    expect([rank.step, rank.rank, rank.stepOfRank]).toEqual([12, 5, 2]);
    expect(rank.novels).toBe(12.3);
    expect(rank.next?.step).toBe(13);
    expect(
      rank.next?.requirements.map(({ key, have, from, need }) => [key, have, from, need])
    ).toEqual([
      ['characters', 1_234_567, 1_100_000, 1_500_000],
      ['words', 9000, 8400, 10_000],
      ['days', 80, 75, 90],
      ['books', 1, 0, 3]
    ]);
    expect(lightNovels(99_999)).toBe(0.9);
  });

  // Catches a fresh step's track starting where the last one ended (80% full on day one).
  it('starts a fresh step at zero', () => {
    const rank = readingRank(enough(12), { step: 12, at: 0 }, riseGap);
    const share = ({ have, from, need }: { have: number; from: number; need: number }) =>
      (have - from) / (need - from);

    expect(rank.next?.requirements.filter((req) => req.key !== 'books').map(share)).toEqual([
      0, 0, 0
    ]);
  });

  it('says when an earned step comes, and has no next at the top', () => {
    const waiting = readingRank(enough(4), { step: 2, at: 50 }, 60);

    expect(waiting.step).toBe(2);
    expect(waiting.next?.risesAt).toBe(50 + riseGap);
    expect(readingRank(enough(19), { step: 19, at: 0 }, 0).next).toBeUndefined();
  });

  it('estimates from the pace: the slowest requirement, never before the week is up', () => {
    const now = 100 * day;
    const input = { ...enough(13), characters: 1_400_000, days: 85, wordsKnown: 8400 };
    const pace = { characters: 50_000, days: 1, words: 100 };
    const rank = readingRank({ ...input, pace }, { step: 12, at: now - 2 * day }, now);
    const etas = Object.fromEntries(rank.next!.requirements.map((req) => [req.key, req.eta]));

    // 100k at 50k a day, 5 days at 1 a day, 1,600 words at 100 a day.
    expect(etas).toMatchObject({ characters: 2 * day, days: 5 * day, words: 16 * day });
    expect(rank.next?.eta).toBe(16 * day);

    const near = readingRank(
      { ...input, wordsKnown: 10_000, days: 89, pace },
      { step: 12, at: now - 2 * day },
      now
    );

    // Paced ones 2 days off, but the week since the last rise has 5 days left.
    expect(near.next?.eta).toBe(5 * day);
  });

  // Catches a division by zero showing "in about Infinity" or a date past any use.
  it('has no estimate without reading in the window, or past a year', () => {
    const now = 100 * day;
    const input = { ...enough(13), characters: 1_400_000 };

    expect(
      readingRank(
        { ...input, pace: { characters: 0, days: 0, words: 0 } },
        { step: 12, at: 0 },
        now
      ).next?.eta
    ).toBeNull();
    expect(
      readingRank(
        { ...input, pace: { characters: 100, days: 1, words: 100 } },
        { step: 12, at: 0 },
        now
      ).next?.eta
    ).toBeNull();
  });
});
