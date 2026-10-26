/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Reading rank (light-novel guild style): seven gated tiers, not XP. Each tier past the first
 * needs words known, characters read, distinct reading days and one finished hard book read with
 * 95% known-word coverage, so easy reading can't raise it. The figures are self-reported by the
 * client: the guards below aim for plausibility, not proof (the hub caps what it is shown).
 * Pure functions plus the stored rank; the loader is reading-rank-data.ts. Not part of upstream.
 */

import type { CalibreDifficulty } from '$lib/data/calibre';
import { levelOf } from '$lib/data/difficulty-core';
import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import { writableObjectLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { placementAt, type PlacementRecord } from '$lib/data/placement';
import type { WordMarks } from '$lib/data/word-marks';

export interface RankTier {
  ja: string;
  /** Characters read, counted at a plausible speed (`countedReading`) */
  characters: number;
  /** Distinct days with counted reading */
  days: number;
  /** Words known for rank (`rankMarks`, `rankPlacementCutoff`) */
  words: number;
  /** A finished real book at or above this 1-10 level (`levelOf`), read with `minCoverage` known */
  difficulty: number;
}

/**
 * Book levels on the 1-10 scale (difficulty-core.ts). The thresholds are the old 0-5 ones (2.0,
 * 2.5, 3.0, 3.3, 3.6, 3.9) moved to the same quantiles of the library's books of 50k+ characters,
 * rounded up, never lower: 5.5% of them are under 2.4, 24% under 4.1, 53% under 5.6, 74% under
 * 6.7, 91% under 8.1 and 98% under 9.2 (5,739 books sampled, 2026-10).
 * Characters rise about ×2.5 a tier up to 10M; 300 reading days is about a year.
 */
export const rankTiers: RankTier[] = [
  { ja: '見習い', characters: 0, days: 0, words: 0, difficulty: 0 },
  { ja: '駆け出し', characters: 100_000, days: 7, words: 1_500, difficulty: 2.4 },
  { ja: '冒険者', characters: 250_000, days: 20, words: 3_000, difficulty: 4.1 },
  { ja: '熟練者', characters: 600_000, days: 45, words: 6_000, difficulty: 5.6 },
  { ja: '英雄', characters: 1_500_000, days: 90, words: 10_000, difficulty: 6.7 },
  { ja: '勇者', characters: 4_000_000, days: 180, words: 15_000, difficulty: 8.1 },
  { ja: '魔王', characters: 10_000_000, days: 300, words: 20_000, difficulty: 9.2 }
];

/** Characters a minute nobody reads faster than (fast readers' statistics show about 500). */
export const maxSpeed = 1000;
/** Characters counted in one day at most. */
export const dailyCap = 300_000;
export const minCoverage = 0.95;
const day = 24 * 60 * 60 * 1000;
/** The rank rises by one tier at most this often. */
export const riseGap = 7 * day;
/** A word test result counts only this long after the one before it. */
export const testGap = 7 * day;

/**
 * Characters and days that count: per day, at most the day's reading time × `maxSpeed` and
 * `dailyCap`, so jumps ahead (characters without reading time) and negative days add nothing.
 */
export function countedReading(statistics: BooksDbStatistic[]) {
  const days = new Map<string, { characters: number; seconds: number }>();

  for (const { dateKey, charactersRead, readingTime } of statistics) {
    const total = days.get(dateKey) ?? { characters: 0, seconds: 0 };

    total.characters += Math.max(0, charactersRead || 0);
    total.seconds += Math.max(0, readingTime || 0);
    days.set(dateKey, total);
  }

  let characters = 0;
  let readDays = 0;

  for (const total of days.values()) {
    const counted = Math.min(total.characters, (total.seconds / 60) * maxSpeed, dailyCap);

    characters += Math.floor(counted);
    if (counted > 0) readDays += 1;
  }

  return { characters, days: readDays };
}

/** Reading time (seconds) per title, for `plausibleFinish`. */
export function readingTimeByTitle(statistics: BooksDbStatistic[]) {
  const time = new Map<string, number>();

  for (const { title, readingTime } of statistics) {
    time.set(title, (time.get(title) ?? 0) + Math.max(0, readingTime || 0));
  }
  return time;
}

/** The estimate's figures the shape check reads. */
export type BookShape = Pick<CalibreDifficulty, 'characters' | 'uniqueKanji' | 'core'>;

/**
 * Real-book shape: the core's different words and running words (`types`, `tokens`) and the
 * unique kanji within the 0.5-99.5th percentile band of the library's books of 50k+ characters
 * for a book of this length (power fits, as they grow slower than its characters; 5,739 books
 * sampled), so a crafted text repeating rare words falls outside it. 96% of real books pass (long
 * omnibuses less often). Estimates without core numbers never pass.
 */
export const bookShape = {
  characters: 50_000,
  types: [2.25, 5.8, 0.61] as const,
  kanji: [22, 50, 0.32] as const,
  tokens: [0.235, 0.31, 1] as const
};

const within = (value: number, characters: number, [low, high, power]: readonly number[]) =>
  value >= low * characters ** power && value <= high * characters ** power;

export function realBook({ characters, uniqueKanji, core }: BookShape) {
  if (!core?.types || !core.tokens) return false;

  return (
    characters >= bookShape.characters &&
    within(core.types, characters, bookShape.types) &&
    within(uniqueKanji, characters, bookShape.kanji) &&
    within(core.tokens, characters, bookShape.tokens)
  );
}

/** Read for long enough at `maxSpeed` to have read the whole book, so a jump to 97% doesn't count. */
export const plausibleFinish = (characters: number, seconds: number) =>
  seconds >= (characters / maxSpeed) * 60;

/**
 * The word test cutoff for rank: only results taken `testGap` after the one before them (of
 * either mode) count, so retaking it until a lucky score does nothing.
 */
export function rankPlacementCutoff(results: PlacementRecord[]) {
  // Retired hard results count for nothing, so they must not start a gap either.
  const sorted = results.filter(({ mode }) => mode !== 'hard').sort((a, b) => a.date - b.date);
  const counted = sorted.filter((record, i) => !i || record.date - sorted[i - 1].date >= testGap);

  return placementAt(counted)?.cutoff ?? 0;
}

/** Marks of words met in a book (`totals`, folded words-met keys): marking unmet words does nothing. */
export function rankMarks(marks: WordMarks, totals: Record<string, number>) {
  const forms = new Set(Object.keys(totals).map((key) => key.slice(0, key.indexOf('\t'))));

  return Object.fromEntries(
    Object.entries(marks).filter(([key]) => forms.has(key.slice(0, key.indexOf('\t'))))
  ) as WordMarks;
}

export interface RankBook {
  estimate: BookShape & Pick<CalibreDifficulty, 'engine'>;
  /** Share read (words-met's `readFraction`) */
  fraction: number;
  /** Seconds of reading time in the statistics */
  seconds: number;
  /** Share of its word occurrences known (`wordCoverage`) */
  coverage: number;
}

export interface RankInput {
  /** `countedReading`'s */
  characters: number;
  days: number;
  wordsKnown: number;
  books: RankBook[];
}

/** Whether the estimate came from this release's difficulty engine; injected, see `readingRank`. */
export type CanonicalCheck = (estimate: RankBook['estimate']) => boolean;

/** The hardest 1-10 level among the books that count for the gate (0 when none). */
export function hardestBook(books: RankBook[], canonical: CanonicalCheck = () => true) {
  return Math.max(
    0,
    ...books
      .filter(
        (book) =>
          book.fraction >= 0.97 &&
          book.coverage >= minCoverage &&
          realBook(book.estimate) &&
          plausibleFinish(book.estimate.characters, book.seconds) &&
          canonical(book.estimate)
      )
      .map((book) => levelOf(book.estimate) ?? 0)
  );
}

export interface Requirement {
  key: 'words' | 'characters' | 'days' | 'book';
  have: number;
  need: number;
  met: boolean;
}

function requirements(input: RankInput, hardest: number, tier: RankTier): Requirement[] {
  return [
    { key: 'words', have: input.wordsKnown, need: tier.words },
    { key: 'characters', have: input.characters, need: tier.characters },
    { key: 'days', have: input.days, need: tier.days },
    { key: 'book', have: hardest, need: tier.difficulty }
  ].map((req) => ({ ...(req as Omit<Requirement, 'met'>), met: req.have >= req.need }));
}

/** The highest tier (1-7) whose requirements are all met. */
export function eligibleTier(input: RankInput, canonical?: CanonicalCheck) {
  const hardest = hardestBook(input.books, canonical);
  let tier = 1;

  rankTiers.forEach((t, i) => {
    if (requirements(input, hardest, t).every((req) => req.met)) tier = i + 1;
  });
  return tier;
}

/** The rank reached and when it last rose (ms). */
export interface RankState {
  tier: number;
  at: number;
}

/**
 * The rank never drops (a lower word test or a re-estimate keeps it; so does a device offline)
 * and rises by one tier at most every `riseGap`.
 */
export function advanceRank(state: Partial<RankState> | undefined, eligible: number, now: number) {
  const tier = state?.tier && state.tier >= 1 ? Math.min(state.tier, rankTiers.length) : 1;
  const at = state?.at ?? 0;

  return eligible > tier && now - at >= riseGap ? { tier: tier + 1, at: now } : { tier, at };
}

/** Two devices' ranks: the higher, reached first. */
export function mergeRankState(local: Partial<RankState> = {}, remote: Partial<RankState> = {}) {
  const [a, b] = [local, remote].map((s) => ({ tier: s.tier ?? 1, at: s.at ?? 0 }));

  return a.tier !== b.tier ? (a.tier > b.tier ? a : b) : a.at <= b.at ? a : b;
}

/** Characters read in light novels (100,000 characters each), to one decimal. */
export const lightNovels = (characters: number) => Math.floor(characters / 10_000) / 10;

export interface ReadingRank {
  /** 1-7 */
  tier: number;
  state: RankState;
  /** The next tier's requirements (none at the top) */
  next?: { tier: number; requirements: Requirement[]; risesAt?: number };
  characters: number;
  novels: number;
}

/**
 * The rank from the inputs and the stored state. `canonical` is the difficulty engine check
 * (only its estimates count for the hard-book gate; reading-rank-data.ts passes isCanonicalEstimate).
 */
export function readingRank(
  input: RankInput,
  state: Partial<RankState> | undefined,
  now: number,
  canonical?: CanonicalCheck
): ReadingRank {
  const next = advanceRank(state, eligibleTier(input, canonical), now);
  const tier = rankTiers[next.tier];
  const reqs = tier && requirements(input, hardestBook(input.books, canonical), tier);

  return {
    tier: next.tier,
    state: next,
    next: tier && {
      tier: next.tier + 1,
      requirements: reqs,
      ...(reqs.every((req) => req.met) ? { risesAt: next.at + riseGap } : {})
    },
    characters: input.characters,
    novels: lightNovels(input.characters)
  };
}

export const readingRank$ = writableObjectLocalStorageSubject<Partial<RankState>>()(
  'readingRank',
  {}
);
