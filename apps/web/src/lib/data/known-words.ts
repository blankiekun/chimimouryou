/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Known words read from an Anki deck (mature cards) and which of each book's words to
 * study (`wordsToStudy`) they cover: an estimate on the book page, also used by the
 * Store's Known words sort. Personal: kept in this browser only (reader-db `known`), cleared when the reader
 * changes (`releaseReaderData`). Off unless Settings → Anki turns it on. Not part of upstream.
 */

import { BehaviorSubject } from 'rxjs';
import { ankiInvoke, ankiKnownDeck$, ankiKnownField$, ankiKnownWords$ } from '$lib/data/anki';
import { knownCoverage, loadBookWords, wordsToStudy, type BookWord } from '$lib/data/book-words';
import { readerDb } from '$lib/data/reader-db';

export interface KnownWords {
  words: string[];
  /** When they were read from Anki (ms); coverages computed from older words are dropped */
  read: number;
}

export interface CoverageCache {
  /** `KnownWords.read` the coverages were computed from */
  read: number;
  /** Calibre book id → share of the study words' occurrences that are known */
  books: Record<number, number>;
}

const day = 24 * 60 * 60 * 1000;
const batchSize = 500;

/** Cached coverages for the current known words (Store's Coverage sort). */
export const knownCoverage$ = new BehaviorSubject<Record<number, number>>({});
/** The known words read last, for Settings; undefined until loaded or when there are none. */
export const knownWords$ = new BehaviorSubject<KnownWords | undefined>(undefined);

/** The written form in an Anki field: no HTML, no furigana (` 漢字[かんじ]`), no spaces. */
export function cleanAnkiField(html: string) {
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';

  return text.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, '');
}

/** Reads the deck's mature cards (interval of 21 days or more) from Anki and caches them. */
export async function refreshKnownWords() {
  const deck = ankiKnownDeck$.getValue().trim();
  const field = ankiKnownField$.getValue().trim();

  if (!deck) {
    throw new Error('Choose a deck first');
  }

  const ids = await ankiInvoke<number[]>('findNotes', {
    query: `"deck:${deck.replace(/["\\]/g, '\\$&')}" prop:ivl>=21`
  });
  const words = new Set<string>();

  for (let i = 0; i < ids.length; i += batchSize) {
    const notes = await ankiInvoke<{ fields: Record<string, { value: string }> }[]>('notesInfo', {
      notes: ids.slice(i, i + batchSize)
    });

    for (const note of notes) {
      const word = cleanAnkiField(note.fields[field]?.value ?? '');

      if (word) words.add(word);
    }
  }

  const known: KnownWords = { words: [...words], read: Date.now() };

  await (await readerDb()).put('known', known, 'words');
  knownWords$.next(known);
  knownCoverage$.next({});

  return known;
}

export async function getKnownWords() {
  const known = await (await readerDb()).get('known', 'words');

  knownWords$.next(known as KnownWords | undefined);

  return known as KnownWords | undefined;
}

let lastTry = 0;

/**
 * Refreshes the known words if they are a day old and the feature is on; at most one
 * try an hour per page load, and failures (Anki closed) are silent.
 */
export async function refreshKnownWordsIfStale() {
  if (!ankiKnownWords$.getValue() || Date.now() - lastTry < 60 * 60 * 1000) {
    return getKnownWords().catch(() => undefined);
  }

  lastTry = Date.now();

  const known = await getKnownWords().catch(() => undefined);

  if (known && Date.now() - known.read < day) {
    return known;
  }

  return refreshKnownWords().catch(() => known);
}

async function coverageCache(read: number): Promise<CoverageCache> {
  const cache = (await (await readerDb()).get('known', 'coverage')) as CoverageCache | undefined;

  return cache?.read === read ? cache : { read, books: {} };
}

/** Loads the cached coverages for the current known words into `knownCoverage$`. */
export async function loadCoverageCache() {
  const known = await getKnownWords();

  knownCoverage$.next(known ? (await coverageCache(known.read)).books : {});
}

/**
 * The book's words to study (`wordsToStudy`) known from Anki. Computed from `words` when
 * given (the book page), else the cached share or one computed from the loaded word list;
 * the share is cached. Undefined when the feature is off or data is missing.
 */
export async function bookCoverage(id: number, words95: number, words?: BookWord[]) {
  const known = ankiKnownWords$.getValue() ? await getKnownWords() : undefined;

  if (!known) return undefined;

  if (!words) {
    const cached = (await coverageCache(known.read)).books[id];

    if (cached !== undefined) return { share: cached };
    words = await loadBookWords(id).catch(() => undefined);
  }

  const coverage = words && knownCoverage(wordsToStudy(words, words95), new Set(known.words));

  if (!coverage) return undefined;

  // Re-read: another book may have been cached meanwhile.
  const latest = await coverageCache(known.read);

  if (latest.books[id] !== coverage.share) {
    const books = { ...latest.books, [id]: coverage.share };

    await (await readerDb()).put('known', { read: known.read, books }, 'coverage');
    knownCoverage$.next(books);
  }

  return coverage;
}

let pending: { id: number; words95: number }[] | undefined;
let running: Promise<void> | undefined;

/** Computes the coverage of these books one at a time in the background (Home's books). */
export function cacheCoverage(books: { id: number; words95: number }[]) {
  pending = books;
  running ??= (async () => {
    while (pending) {
      const batch = pending;

      pending = undefined;
      for (const { id, words95 } of batch) {
        if (pending) break;
        await bookCoverage(id, words95).catch(() => undefined);
      }
    }
  })().finally(() => {
    running = undefined;
  });

  return running;
}

/** Forgets everything read from Anki (the reader changed). */
export async function clearKnownWords() {
  await (await readerDb()).clear('known');
  knownWords$.next(undefined);
  knownCoverage$.next({});
}
