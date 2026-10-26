/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The two difficulty measures built on the fast core (functions/analysis/core.ts, the service's
 * core.py):
 * - objective: the book's V98 on the frozen 1-10 scale (difficulty-scale.json, a bell curve over
 *   the reference library: mean 5.5, SD 2) with a book tier name per whole step; the library's
 *   difficulty column, sort and filters, Read next and Reading rank's gate use it;
 * - relative ("for you"): this reader's share of the book's running words known, and a 0-5 level
 *   from it (`relativeLevel`), with the words to learn to reach 98%.
 * Not part of upstream.
 */

import {
  coreScore,
  EDGES,
  RANKED_BUCKETS,
  type CoreNumbers,
  type CoreScale
} from '$lib/functions/analysis/core';
import { isNoiseWord, totalsOf, type BookWord, type WordTotals } from '$lib/data/book-words';
import scaleJson from '$lib/data/difficulty-scale.json';

export const difficultyScale = scaleJson as unknown as CoreScale;

/** The comfortable share of running words known (Hu & Nation 2000) */
export const coverageTarget = 0.98;

export interface BookLevel {
  /** 1.0-10.0, two decimals; shown with one */
  score: number;
  /** The book tier of its whole step (difficultyScale.tiers: 1 Slime … 10 Demon King) */
  tier: string;
  v98: number | null;
}

/** The book's objective level from its core numbers; undefined without them or with too few words. */
export function bookLevel(core: CoreNumbers | undefined): BookLevel | undefined {
  if (!core?.tokens) return undefined;

  const score = coreScore(core.v98, difficultyScale);

  return { score, tier: difficultyScale.tiers[Math.min(Math.floor(score), 10) - 1], v98: core.v98 };
}

export type SentenceBand = 'short' | 'average' | 'long';

/** From this share of the kanji under the author's ruby a book counts as full furigana (総ルビ) */
export const fullFuriganaShare = 0.5;
/**
 * The library's sentence-length tertiles (mean characters per sentence; core.py's facets), from
 * 3,000 random library books: below the first is short, from the second on long.
 */
export const sentenceCuts = [22.3, 25.9] as const;

export interface BookFacets {
  rubyKanji: number;
  fullFurigana: boolean;
  sentLen: number;
  sentBand: SentenceBand;
}

/** The facets beside the level (core version 2); undefined for older core numbers. */
export function bookFacets(core: CoreNumbers | undefined): BookFacets | undefined {
  if (!core?.tokens || core.rubyKanji === undefined || !core.sentLen) return undefined;

  const { rubyKanji, sentLen } = core;

  return {
    rubyKanji,
    fullFurigana: rubyKanji >= fullFuriganaShare,
    sentLen,
    sentBand: sentLen < sentenceCuts[0] ? 'short' : sentLen < sentenceCuts[1] ? 'average' : 'long'
  };
}

/** An estimate's 1-10 level (`bookLevel`), undefined without core numbers */
export const levelOf = (estimate: { core?: CoreNumbers } | undefined) =>
  bookLevel(estimate?.core)?.score;

/**
 * Coverage → the reader's 0-5 level for a book, piecewise linear in the unknown share and clamped:
 * 99.5%+ known is 0, 98% (the target) 2, 95% 3.5, 90% or less 5.
 */
const relativeAnchors: [unknown: number, level: number][] = [
  [0.005, 0],
  [0.02, 2],
  [0.05, 3.5],
  [0.1, 5]
];

export function relativeLevel(share: number) {
  const unknown = 1 - share;

  if (unknown <= relativeAnchors[0][0]) return 0;
  for (let i = 1; i < relativeAnchors.length; i++) {
    const [u0, l0] = relativeAnchors[i - 1];
    const [u1, l1] = relativeAnchors[i];

    if (unknown <= u1)
      return Math.floor((l0 + ((l1 - l0) * (unknown - u0)) / (u1 - u0)) * 10 + 0.5) / 10;
  }

  return 5;
}

export interface ForYou {
  /** Share of the running words known */
  share: number;
  /** Words to learn (most frequent in the book first) to reach `coverageTarget`; 0 when there */
  learn: number;
  /** The word list ran out first: at least `learn` */
  atLeast: boolean;
  /** Unknown occurrences, for "1 unknown word every N characters" */
  unknownTokens: number;
}

/**
 * This reader's numbers for a book from its word list (exact, like `wordCoverage`): rows past the
 * list's cap count as unknown, and each as a word to learn of its own.
 */
export function forYou(
  words: BookWord[],
  isKnown: (word: BookWord) => boolean,
  totals: WordTotals = {}
): ForYou | undefined {
  let listed = 0;
  let known = 0;
  const unknownCounts: number[] = [];

  for (const word of words) {
    if (isNoiseWord(word)) continue;
    listed += word[2];
    if (isKnown(word)) known += word[2];
    else unknownCounts.push(word[2]);
  }

  const tokens = Math.max(listed, totalsOf(words, totals).tokens ?? 0);

  if (!tokens) return undefined;

  let covered = known;
  let learn = 0;

  for (const count of unknownCounts.sort((a, b) => b - a)) {
    if (covered >= coverageTarget * tokens) break;
    covered += count;
    learn++;
  }

  return {
    share: known / tokens,
    learn,
    atLeast: covered < coverageTarget * tokens,
    unknownTokens: tokens - known
  };
}

/**
 * The share of a book's running words known to a reader who knows every word ranked up to `cutoff`
 * (the placement check's), from its core histogram: ranks spread evenly in log rank within a
 * bucket; unranked words unknown. For books without a word list at hand (whole-library sorting).
 */
export function histogramShare(core: CoreNumbers, cutoff: number) {
  if (!core.tokens) return undefined;

  const top = Math.log(cutoff + 1);
  let known = 0;

  for (let b = 0; b < RANKED_BUCKETS; b++) {
    const low = Math.log(EDGES[b]);
    const high = Math.log(b + 1 < RANKED_BUCKETS ? EDGES[b + 1] : 10 ** 6);

    known += core.hist[b] * Math.min(Math.max((top - low) / (high - low), 0), 1);
  }

  return known / core.tokens;
}
