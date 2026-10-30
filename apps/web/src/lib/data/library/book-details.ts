/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import {
  keptEstimate,
  keptReadings,
  localWordList,
  type LocalEstimate
} from '$lib/data/analysis/analysis-tools';
import { bookContent } from '$lib/data/book-content';
import { bookKanjiCount } from '$lib/data/words/book-kanji';
import {
  loadBookMetadata,
  type BookMetadata,
  type MetadataKind
} from '$lib/data/library/book-metadata';
import { wordCoverage, type BookWord, type WordCoverage } from '$lib/data/words/book-words';
import {
  loadCalibreCatalog,
  loadCalibreDifficulty,
  type CalibreBook,
  type CalibreDifficulty
} from '$lib/data/remote/calibre';
import { standalone } from '$lib/data/env';
import {
  bookCoverage,
  getKnownSet,
  refreshKnownWordsIfStale,
  type KnownSet
} from '$lib/data/words/known-words';
import { localMokuro, type MokuroText } from '$lib/data/manga/mokuro';
import { database } from '$lib/data/store';
import { wordList } from '$lib/data/words/words-met';

/** What a book's page (book-details.svelte) shows besides the card: one load of it. */
export interface BookDetails {
  calibreBook?: CalibreBook;
  estimate?: CalibreDifficulty;
  /** Standalone: the analysis tools' estimate of a stored book */
  localScored?: LocalEstimate;
  metadata?: BookMetadata;
  /** The book's word list and the words known, for the Words row */
  listWords: BookWord[];
  knownSet?: KnownSet;
  wordStats?: WordCoverage;
  /** Standalone manga: its mokuro text, null when it has none */
  mokuro?: MokuroText | null;
  /** Standalone: different kanji counted from the stored book */
  browserKanji?: number;
  /** A Windows game in this browser: a pick sets its length from Jiten (it has no count of its own) */
  windowsGame: boolean;
  /** The stored manga or VN data can't be read (bookContent's `invalid`) */
  damaged: boolean;
  /** Standalone, generated furigana: no readings file kept yet */
  readingsMissing: boolean;
  /** Standalone: the word list was made without yurigana's Reader (redoWordList) */
  listWithoutReader: boolean;
}

export const noBookDetails = (): BookDetails => ({
  listWords: [],
  windowsGame: false,
  damaged: false,
  readingsMissing: false,
  listWithoutReader: false
});

export async function loadBookDetails(book: BookCardProps, kind: MetadataKind, isCalibre: boolean) {
  const title = book.title;
  const details = noBookDetails();
  const content =
    kind !== 'book'
      ? database
          .getDataByTitle(title)
          .then((data) => (data ? bookContent(data) : undefined))
          .catch(() => undefined)
      : undefined;
  const browserKanji =
    standalone && kind === 'book'
      ? bookKanjiCount(book.id, title, book.characters).catch(() => undefined)
      : undefined;

  if (standalone && kind === 'manga') {
    details.mokuro = (await localMokuro(title).catch(() => undefined)) ?? null;
  }

  if (standalone && kind !== 'vn') {
    // The estimate and word list the analysis tools made (analysis-tools.ts).
    const [scores, local, known, readings] = await Promise.all([
      keptEstimate(title),
      localWordList(title).catch(() => undefined),
      refreshKnownWordsIfStale()
        .then(getKnownSet)
        .catch(() => undefined),
      keptReadings(title)
    ]);

    details.estimate = details.localScored = scores;
    details.readingsMissing = !readings;
    details.listWithoutReader = !!local?.withoutReader;
    if (local && known) {
      details.listWords = local.words;
      details.knownSet = known;
      details.wordStats = wordCoverage(local.words, known.isKnown, local.totals);
    }
  }

  if (isCalibre) {
    const [catalog, difficulty, metadata] = await Promise.all([
      loadCalibreCatalog().catch(() => []),
      book.calibreId === undefined ? undefined : loadCalibreDifficulty().catch(() => undefined),
      loadBookMetadata().catch(() => ({}) as Record<string, BookMetadata>)
    ]);

    details.calibreBook = catalog.find((entry) => entry.title === title);
    details.estimate = book.calibreId === undefined ? undefined : difficulty?.[book.calibreId];
    details.metadata = metadata[title];

    if (details.estimate && book.calibreId !== undefined) {
      const id = book.calibreId;
      const bookEstimate = details.estimate;
      const [list, known] = await Promise.all([
        wordList(id, bookEstimate.computedAt).catch(() => null),
        refreshKnownWordsIfStale()
          .then(getKnownSet)
          .catch(() => undefined)
      ]);

      details.wordStats =
        list && known
          ? await bookCoverage(id, list, bookEstimate, known).catch(() => undefined)
          : undefined;
      details.listWords = list ?? [];
      details.knownSet = known;
    }
  }

  const stored = await content;

  details.damaged = stored?.kind === 'invalid';
  details.windowsGame = stored?.kind === 'vn' && stored.info.engine === 'vnbox';
  details.browserKanji = await browserKanji;

  return details;
}
