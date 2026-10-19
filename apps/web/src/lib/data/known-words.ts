/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Known words: read from an Anki deck (mature cards, off unless Settings → Anki turns it
 * on) together with the words met often enough (words-met.ts) and those marked by hand
 * (word-marks.ts, synced), and how much of each book's text they cover (`wordCoverage`):
 * the book page, the difficulty dialog, the Store's Known words sort and Read next.
 * Personal: kept in this browser (reader-db `known`), cleared when the reader changes
 * (`releaseReaderData`). Not part of upstream.
 */

import { BehaviorSubject } from 'rxjs';
import { ankiInvoke, ankiKnownDeck$, ankiKnownField$, ankiKnownWords$ } from '$lib/data/anki';
import { wordCoverage, type BookWord, type WordTotals } from '$lib/data/book-words';
import { loadCalibreDifficulty } from '$lib/data/calibre';
import { readerDb } from '$lib/data/reader-db';
import {
  getWordMarks,
  marksSignature,
  wordMark,
  wordMarks$,
  type WordMarks
} from '$lib/data/word-marks';
import { getWordsMet, knownMinCount, wordKey, wordList } from '$lib/data/words-met';

export interface KnownWords {
  words: string[];
  /** When they were read from Anki (ms); coverages computed from older words are dropped */
  read: number;
}

export interface KnownSet {
  /** Changes whenever the known words change; empty when they are partial (offline) */
  key: string;
  isKnown: (word: BookWord) => boolean;
}

export interface CoverageCache {
  /** `KnownSet.key` the coverages were computed from */
  key: string;
  /** Calibre book id → share of the book's word occurrences that are known */
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

/**
 * The words the reader knows: met `knownMinCount` times (words-met.ts) or, when Settings →
 * Anki → Known Words is on, mature in Anki (by written form), or marked known or ignored.
 */
export async function getKnownSet(): Promise<KnownSet> {
  const [met, anki, marks] = await Promise.all([
    getWordsMet(),
    ankiKnownWords$.getValue() ? getKnownWords().catch(() => undefined) : undefined,
    getWordMarks().catch(() => ({}) as WordMarks)
  ]);
  const forms = new Set(anki?.words);

  return {
    key: met.signature && `${met.signature}|${anki?.read ?? ''}|${marksSignature(marks)}`,
    isKnown: (word) =>
      (met.words[wordKey(word)] ?? 0) >= knownMinCount ||
      forms.has(word[0]) ||
      (!!word[4] && forms.has(word[4])) ||
      !!wordMark(marks, word)
  };
}

async function coverageCache(key: string): Promise<CoverageCache> {
  const cache = key
    ? ((await (await readerDb()).get('known', 'coverage')) as CoverageCache | undefined)
    : undefined;

  return cache?.key === key ? cache : { key, books: {} };
}

/** Loads the cached coverages for the current known words into `knownCoverage$`. */
export async function loadCoverageCache() {
  knownCoverage$.next((await coverageCache((await getKnownSet()).key)).books);
}

/**
 * The book's word coverage (`wordCoverage`) from its word list; its share is cached for
 * the Store's Known words sort unless the known words are partial.
 */
export async function bookCoverage(
  id: number,
  words: BookWord[],
  totals: WordTotals,
  known: KnownSet
) {
  const coverage = wordCoverage(words, known.isKnown, totals);

  if (!coverage || !known.key) return coverage;

  // Re-read: another book may have been cached meanwhile.
  const latest = await coverageCache(known.key);

  if (latest.books[id] !== coverage.share) {
    const books = { ...latest.books, [id]: coverage.share };

    await (await readerDb()).put('known', { key: known.key, books }, 'coverage');
    knownCoverage$.next(books);
  }

  return coverage;
}

let pending: number[] | undefined;
let runningIds = '';
let running: Promise<void> | undefined;

/**
 * Computes the coverage of these Calibre books one at a time in the background (Home's
 * books and Read next's), skipping those cached for the current known words.
 */
export function cacheCoverage(ids: number[]) {
  // The library re-renders as each coverage arrives: don't restart the same batch.
  if (running && ids.join() === runningIds) return running;

  pending = ids;
  running ??= (async () => {
    while (pending) {
      const batch = pending;

      pending = undefined;
      runningIds = batch.join();

      const [known, difficulty] = await Promise.all([getKnownSet(), loadCalibreDifficulty()]);
      const cached = (await coverageCache(known.key)).books;

      for (const id of batch) {
        if (pending) break;

        const estimate = difficulty[id];

        if (!estimate || cached[id] !== undefined) continue;

        const words = await wordList(id, estimate.computedAt).catch(() => null);

        if (words) await bookCoverage(id, words, estimate, known);
      }
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      running = undefined;
    });

  return running;
}

/** Forgets everything read from Anki (the reader changed). */
export async function clearKnownWords() {
  await (await readerDb()).clear('known');
  knownWords$.next(undefined);
  wordMarks$.next({});
  knownCoverage$.next({});
}
