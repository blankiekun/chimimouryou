/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Reading rank (light-novel guild style): seven gated ranks in 19 steps (I, II, III of each past
 * 見習い), not XP. Each step needs words known, characters read, distinct reading days and a few
 * finished books at its level read with 95% known-word coverage, so easy reading can't raise it.
 * The figures are self-reported by the client: the guards below aim for plausibility, not proof
 * (the hub caps what it is shown). Pure functions plus the stored rank; the loader is
 * reading-rank-data.ts. Not part of upstream.
 */

import type { CalibreDifficulty } from '$lib/data/remote/calibre';
import { levelOf } from '$lib/data/difficulty/difficulty-core';
import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import { writableObjectLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { placementAt, type PlacementRecord } from '$lib/data/difficulty/placement';
import type { WordMarks } from '$lib/data/words/word-marks';
import { record } from '$lib/data/setting-parsers';

/** A rank's name; its colour is `--rank-N`. */
export interface RankTier {
  ja: string;
}

export const rankTiers: RankTier[] = [
  { ja: '見習い' },
  { ja: '駆け出し' },
  { ja: '冒険者' },
  { ja: '熟練者' },
  { ja: '英雄' },
  { ja: '勇者' },
  { ja: '魔王' }
];

/** One of the 19 steps: 見習い, then I, II and III of each rank. */
export interface RankStep {
  /** 1-7 (`rankTiers`) */
  rank: number;
  /** 1-3, 0 for 見習い */
  step: number;
  /** Characters read, counted at a plausible speed (`countedReading`) */
  characters: number;
  /** Distinct days with counted reading */
  days: number;
  /** Words known for rank (`rankMarks`, `rankPlacement`) */
  words: number;
  /** Finished real books at or above this 1-10 level (`levelOf`), each read with `minCoverage` known */
  level: number;
  books: number;
}

const step = (
  rank: number,
  stepOfRank: number,
  characters: number,
  days: number,
  words: number,
  level: number,
  books: number
): RankStep => ({ rank, step: stepOfRank, characters, days, words, level, books });

/**
 * Step III of each rank is the old seven-tier rank (book levels on the 1-10 scale: the old 0-5
 * gates moved to the same quantiles of the library's books of 50k+ characters, never lower).
 * I and II sit between it and the rank before: characters and words about ×1.36 a step
 * (駆け出し from 0), days and book levels evenly; books per step from simulated readers (s67
 * sketch): every rank name comes 1-23 weeks sooner, III about when the old rank came.
 */
export const rankSteps: RankStep[] = [
  step(1, 0, 0, 0, 0, 0, 0),
  step(2, 1, 33_000, 2, 500, 1.5, 1),
  step(2, 2, 67_000, 5, 1_000, 1.9, 1),
  step(2, 3, 100_000, 7, 1_500, 2.4, 1),
  step(3, 1, 140_000, 11, 1_800, 3.0, 2),
  step(3, 2, 180_000, 16, 2_300, 3.5, 2),
  step(3, 3, 250_000, 20, 3_000, 4.1, 2),
  step(4, 1, 330_000, 28, 3_700, 4.6, 2),
  step(4, 2, 450_000, 37, 4_700, 5.1, 3),
  step(4, 3, 600_000, 45, 6_000, 5.6, 3),
  step(5, 1, 810_000, 60, 7_100, 6.0, 3),
  step(5, 2, 1_100_000, 75, 8_400, 6.3, 3),
  step(5, 3, 1_500_000, 90, 10_000, 6.7, 3),
  step(6, 1, 2_100_000, 120, 11_400, 7.2, 3),
  step(6, 2, 2_900_000, 150, 13_100, 7.6, 4),
  step(6, 3, 4_000_000, 180, 15_000, 8.1, 4),
  step(7, 1, 5_400_000, 220, 16_500, 8.5, 3),
  step(7, 2, 7_400_000, 260, 18_200, 8.8, 4),
  step(7, 3, 10_000_000, 300, 20_000, 9.2, 5)
];

const clampStep = (n: number) => Math.min(Math.max(Math.floor(n) || 1, 1), rankSteps.length);

/** The roman numeral of a step of a rank ('' for 見習い or none). */
export const stepNumeral = (stepOfRank?: number | null) =>
  ['', 'I', 'II', 'III'][stepOfRank ?? 0] ?? '';

/** The step (1-19) an old seven-tier rank stands for: III of that rank. */
export const thirdStepOf = (tier: number) => (tier <= 1 ? 1 : 3 * Math.min(tier, 7) - 2);

/**
 * The old-style tier of a step: the highest rank whose III is reached. Old devices read
 * `readingRank.tier` as that, so I and II of a rank are written as the rank before.
 */
export function tierOfStep(stepNumber: number) {
  const { rank, step: stepOfRank } = rankSteps[clampStep(stepNumber) - 1];

  return stepOfRank === 1 || stepOfRank === 2 ? rank - 1 : rank;
}

/** Characters a minute nobody reads faster than (fast readers' statistics show about 500). */
export const maxSpeed = 1000;
/** Characters counted in one day at most. */
export const dailyCap = 300_000;
export const minCoverage = 0.95;
const day = 24 * 60 * 60 * 1000;
/** The rank rises by one step at most this often. */
export const riseGap = 7 * day;
/** A word test result counts only this long after the one before it. */
export const testGap = 7 * day;
/** Estimates further off than this aren't shown. */
export const maxEta = 365 * day;

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
 * The word test result for rank: only results taken `testGap` after the one before them (of
 * either mode) count, so retaking it until a lucky score does nothing.
 */
export function rankPlacement(results: PlacementRecord[]) {
  // Retired hard results count for nothing, so they must not start a gap either.
  const sorted = results.filter(({ mode }) => mode !== 'hard').sort((a, b) => a.date - b.date);
  const counted = sorted.filter((record, i) => !i || record.date - sorted[i - 1].date >= testGap);

  return placementAt(counted);
}

/** `rankPlacement`'s cutoff, 0 without one. */
export const rankPlacementCutoff = (results: PlacementRecord[]) =>
  rankPlacement(results)?.cutoff ?? 0;

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

/** Gain a day over the last 28 days (reading-rank-data.ts), for the estimates. */
export interface RankPace {
  characters: number;
  days: number;
  words: number;
}

export interface RankInput {
  /** `countedReading`'s */
  characters: number;
  days: number;
  wordsKnown: number;
  books: RankBook[];
  pace?: RankPace;
}

/** Whether the estimate came from this release's difficulty engine; injected, see `readingRank`. */
export type CanonicalCheck = (estimate: RankBook['estimate']) => boolean;

/**
 * The 1-10 levels of the books that count for the gate, one per text: a copy of a book under
 * another title (the same shape figures) counts once.
 */
export function qualifyingLevels(books: RankBook[], canonical: CanonicalCheck = () => true) {
  const levels = new Map<string, number>();

  for (const book of books) {
    const { characters, uniqueKanji, core } = book.estimate;

    if (
      book.fraction >= 0.97 &&
      book.coverage >= minCoverage &&
      realBook(book.estimate) &&
      plausibleFinish(characters, book.seconds) &&
      canonical(book.estimate)
    ) {
      levels.set(
        [characters, uniqueKanji, core?.types, core?.tokens, core?.v98].join(),
        levelOf(book.estimate) ?? 0
      );
    }
  }
  return [...levels.values()];
}

export interface Requirement {
  key: 'characters' | 'words' | 'days' | 'books';
  have: number;
  /** The step before's need: a fresh step's track starts here */
  from: number;
  need: number;
  met: boolean;
  /** Books: the level each needs */
  level?: number;
  /** Paced ones: ms until met at the current pace (undefined: met, no pace, or over `maxEta`) */
  eta?: number;
}

function requirements(input: RankInput, levels: number[], index: number): Requirement[] {
  const need = rankSteps[index];
  const before = rankSteps[index - 1] ?? need;
  const pace = input.pace;
  const reqs = [
    { key: 'characters', have: input.characters, from: before.characters, need: need.characters },
    { key: 'words', have: input.wordsKnown, from: before.words, need: need.words },
    { key: 'days', have: input.days, from: before.days, need: need.days },
    {
      key: 'books',
      have: levels.filter((level) => level >= need.level).length,
      from: 0,
      need: need.books,
      level: need.level
    }
  ] as Omit<Requirement, 'met'>[];

  return reqs.map((req) => {
    const met = req.have >= req.need;
    const perDay = req.key === 'books' ? 0 : (pace?.[req.key] ?? 0);
    const eta = met || !perDay ? undefined : ((req.need - req.have) / perDay) * day;

    return { ...req, met, ...(eta !== undefined && eta <= maxEta ? { eta } : {}) };
  });
}

/** The highest step (1-19) whose requirements are all met. */
export function eligibleStep(input: RankInput, canonical?: CanonicalCheck) {
  const levels = qualifyingLevels(input.books, canonical);
  let found = 1;

  rankSteps.forEach((_, i) => {
    if (requirements(input, levels, i).every((req) => req.met)) found = i + 1;
  });
  return found;
}

/** The step reached (1-19, `readingRankStep`) and when it last rose (ms). */
export interface StepState {
  step: number;
  at: number;
}

/** The old seven-tier rank (`readingRank`), still read and written by older app versions. */
export interface RankState {
  tier: number;
  at: number;
}

/**
 * The step to go on from: the stored step, or III of the stored tier when that is higher (an
 * older app on another device rose; its tier always means III).
 */
export function stepState(
  stored: Partial<StepState> = {},
  tier: Partial<RankState> = {}
): StepState {
  const own = { step: clampStep(stored.step ?? 1), at: stored.at ?? 0 };
  const old = { step: thirdStepOf(tier.tier ?? 1), at: tier.at ?? 0 };

  return old.step > own.step ? old : own;
}

/**
 * The rank never drops (a lower word test or a re-estimate keeps it; so does a device offline)
 * and rises by one step at most every `riseGap`.
 */
export function advanceStep(state: Partial<StepState> | undefined, eligible: number, now: number) {
  const current = clampStep(state?.step ?? 1);
  const at = state?.at ?? 0;

  return eligible > current && now - at >= riseGap
    ? { step: current + 1, at: now }
    : { step: current, at };
}

/** Two devices' steps: the higher, reached first. */
export function mergeStepState(local: Partial<StepState> = {}, remote: Partial<StepState> = {}) {
  const [a, b] = [local, remote].map((s) => ({ step: s.step ?? 1, at: s.at ?? 0 }));

  return a.step !== b.step ? (a.step > b.step ? a : b) : a.at <= b.at ? a : b;
}

/** Two devices' old tiers: the higher, reached first. */
export function mergeRankState(local: Partial<RankState> = {}, remote: Partial<RankState> = {}) {
  const [a, b] = [local, remote].map((s) => ({ tier: s.tier ?? 1, at: s.at ?? 0 }));

  return a.tier !== b.tier ? (a.tier > b.tier ? a : b) : a.at <= b.at ? a : b;
}

/** Characters read in light novels (100,000 characters each), to one decimal. */
export const lightNovels = (characters: number) => Math.floor(characters / 10_000) / 10;

export interface ReadingRank {
  /** 1-19 */
  step: number;
  /** 1-7 */
  rank: number;
  /** 1-3, 0 for 見習い */
  stepOfRank: number;
  state: StepState;
  /**
   * The next step's requirements (none at the top). `eta`: ms until the paced ones are met and
   * the week since the last rise is up; null when unknown (no reading lately, or over a year);
   * absent when only books are missing or all is met (`risesAt`).
   */
  next?: { step: number; requirements: Requirement[]; risesAt?: number; eta?: number | null };
  characters: number;
  novels: number;
}

/**
 * The rank from the inputs and the stored step. `canonical` is the difficulty engine check
 * (only its estimates count for the book gate; reading-rank-data.ts passes isCanonicalEstimate).
 */
export function readingRank(
  input: RankInput,
  state: Partial<StepState> | undefined,
  now: number,
  canonical?: CanonicalCheck
): ReadingRank {
  const reached = advanceStep(state, eligibleStep(input, canonical), now);
  const current = rankSteps[reached.step - 1];
  const reqs =
    reached.step < rankSteps.length
      ? requirements(input, qualifyingLevels(input.books, canonical), reached.step)
      : undefined;
  const paced = reqs?.filter((req) => !req.met && req.key !== 'books') ?? [];
  const eta = paced.length
    ? paced.some((req) => req.eta === undefined)
      ? null
      : Math.max(...paced.map((req) => req.eta!), reached.at + riseGap - now)
    : undefined;

  return {
    step: reached.step,
    rank: current.rank,
    stepOfRank: current.step,
    state: reached,
    next: reqs && {
      step: reached.step + 1,
      requirements: reqs,
      ...(reqs.every((req) => req.met) ? { risesAt: reached.at + riseGap } : {}),
      ...(eta === undefined ? {} : { eta })
    },
    characters: input.characters,
    novels: lightNovels(input.characters)
  };
}

/** The old tier, kept for older app versions: `tierOfStep` of the step, never lowered. */
export const readingRank$ = writableObjectLocalStorageSubject<Partial<RankState>>()(
  'readingRank',
  {},
  record
);

export const readingRankStep$ = writableObjectLocalStorageSubject<Partial<StepState>>()(
  'readingRankStep',
  {},
  record
);
