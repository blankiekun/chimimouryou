/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Loads the reading rank (reading-rank.ts) from the daily statistics, the books read and their
 * word lists, and stores how far it rose. Words met count only from books of a real-book shape,
 * marks only for words met, the word test only per `rankPlacement`. Not part of upstream.
 */

import { ankiKnownWords$ } from '$lib/data/dictionary/anki';
import { wordCoverage, type BookWord } from '$lib/data/words/book-words';
import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import { getKnownWords } from '$lib/data/words/known-words';
import { placementResults$ } from '$lib/data/difficulty/placement';
import {
  countedReading,
  rankMarks,
  rankPlacement,
  readingRank,
  readingRank$,
  readingRankStep$,
  readingTimeByTitle,
  realBook,
  stepState,
  tierOfStep,
  type CanonicalCheck,
  type RankBook,
  type RankPace
} from '$lib/data/stats/reading-rank';
import { getKnownHistory, type KnownPoint } from '$lib/data/words/words-history';
import { getDateString } from '$lib/functions/statistic-util';
import { isCanonicalEstimate } from '$lib/data/difficulty/difficulty-engine';
import { getWordMarks, wordMark, type WordMarks } from '$lib/data/words/word-marks';
import {
  addWordsMet,
  estimatedWordList,
  foldTotals,
  knownFormRanks,
  knownMinCount,
  metCounter,
  readBooks,
  summarizeWords
} from '$lib/data/words/words-met';

/** Only this release's difficulty engine's estimates count for the hard-book gate. */
export const canonicalEstimate: CanonicalCheck = isCanonicalEstimate;

/** Days the estimates' pace is taken over */
const paceDays = 28;

/** The rank; with `today` (the date key) also the pace for the estimates, which costs more. */
export async function loadReadingRank(statistics: BooksDbStatistic[], today?: string) {
  const [books, anki, marks] = await Promise.all([
    readBooks(),
    ankiKnownWords$.getValue() ? getKnownWords().catch(() => undefined) : undefined,
    getWordMarks().catch(() => ({}) as WordMarks)
  ]);
  const real = books.filter((book) => realBook(book.estimate));
  const lists = new Map<string, BookWord[]>();
  const raw: Record<string, number> = {};
  const ranks: Record<string, number> = {};

  for (const book of real) {
    // Lists are cached in reader-db by words-met; offline ones are left out (the rank never drops).
    const words = await estimatedWordList(book).catch(() => null);

    if (words) {
      lists.set(book.title, words);
      addWordsMet(raw, words, book.fraction, ranks);
    }
  }

  const totals = foldTotals(raw);
  const forms = new Set(anki?.words);
  const placement = rankPlacement(placementResults$.getValue());
  const cutoff = placement?.cutoff ?? 0;
  const counted = rankMarks(marks, totals);
  const metCount = metCounter(totals);
  const isKnown = (word: BookWord) =>
    metCount(word) >= knownMinCount ||
    forms.has(word[0]) ||
    (!!word[4] && forms.has(word[4])) ||
    (word[3] !== null && word[3] <= cutoff) ||
    !!wordMark(counted, word);
  const time = readingTimeByTitle(statistics);
  const rankBooks: RankBook[] = real
    .filter((book) => book.fraction >= 0.97 && lists.has(book.title))
    .map((book) => ({
      estimate: book.estimate,
      fraction: book.fraction,
      seconds: time.get(book.title) ?? 0,
      coverage: wordCoverage(lists.get(book.title)!, isKnown, book.estimate)?.share ?? 0
    }));
  const rank = readingRank(
    {
      ...countedReading(statistics),
      wordsKnown: summarizeWords(
        totals,
        forms,
        counted,
        placement,
        ranks,
        await knownFormRanks(forms, counted)
      ).known,
      books: rankBooks,
      ...(today ? { pace: await paceOf(statistics, today) } : {})
    },
    stepState(readingRankStep$.getValue(), readingRank$.getValue()),
    Date.now(),
    canonicalEstimate
  );
  const stored = readingRankStep$.getValue();
  const tier = tierOfStep(rank.state.step);

  if (stored.step !== rank.state.step || stored.at !== rank.state.at) {
    readingRankStep$.next(rank.state);
  }
  // Older app versions read the tier as III of that rank: written only once III is reached.
  if ((readingRank$.getValue().tier ?? 1) < tier) readingRank$.next({ tier, at: rank.state.at });
  return rank;
}

/**
 * Gain a day over the 28 days up to `today` (a date key): counted characters, reading days, and
 * words known by reading (`knownHistory`, word tests left out).
 */
async function paceOf(statistics: BooksDbStatistic[], today: string): Promise<RankPace> {
  const start = new Date(`${today}T00:00:00`);

  start.setDate(start.getDate() - (paceDays - 1));

  const from = getDateString(start);
  const recent = countedReading(
    statistics.filter(({ dateKey }) => dateKey >= from && dateKey <= today)
  );
  const points = await getKnownHistory(statistics).catch(() => []);
  const read = (point?: KnownPoint) => (point ? point.known - (point.tests ?? 0) : undefined);
  const before = read(points.filter((point) => point.dateKey < from).at(-1)) ?? 0;
  const words = (read(points.at(-1)) ?? before) - before;

  return {
    characters: recent.characters / paceDays,
    days: recent.days / paceDays,
    words: Math.max(0, words) / paceDays
  };
}
