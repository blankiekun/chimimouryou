/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Loads the reading rank (reading-rank.ts) from the daily statistics, the books read and their
 * word lists, and stores how far it rose. Words met count only from books of a real-book shape,
 * marks only for words met, the word test only per `rankPlacementCutoff`. Not part of upstream.
 */

import { ankiKnownWords$ } from '$lib/data/anki';
import { wordCoverage, type BookWord } from '$lib/data/book-words';
import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import { getKnownWords } from '$lib/data/known-words';
import { placementResults$ } from '$lib/data/placement';
import {
  countedReading,
  rankMarks,
  rankPlacementCutoff,
  readingRank,
  readingRank$,
  readingTimeByTitle,
  realBook,
  type CanonicalCheck,
  type RankBook
} from '$lib/data/reading-rank';
import { isCanonicalEstimate } from '$lib/data/difficulty-engine';
import { getWordMarks, wordMark, type WordMarks } from '$lib/data/word-marks';
import {
  addWordsMet,
  estimatedWordList,
  foldTotals,
  knownFormRanks,
  knownMinCount,
  metCounter,
  readBooks,
  summarizeWords
} from '$lib/data/words-met';

/** Only this release's difficulty engine's estimates count for the hard-book gate. */
export const canonicalEstimate: CanonicalCheck = isCanonicalEstimate;

export async function loadReadingRank(statistics: BooksDbStatistic[]) {
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
  const cutoff = rankPlacementCutoff(placementResults$.getValue());
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
        cutoff,
        ranks,
        await knownFormRanks(forms, counted)
      ).known,
      books: rankBooks
    },
    readingRank$.getValue(),
    Date.now(),
    canonicalEstimate
  );
  const stored = readingRank$.getValue();

  if (stored.tier !== rank.state.tier || stored.at !== rank.state.at) readingRank$.next(rank.state);
  return rank;
}
