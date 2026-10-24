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
import {
  isNoiseWord,
  newWords,
  wordCoverage,
  wordsToStudy,
  type BookWord,
  type WordTotals
} from '$lib/data/book-words';
import { loadCalibreDifficulty } from '$lib/data/calibre';
import { readerDb } from '$lib/data/reader-db';
import {
  getWordMarks,
  marksSignature,
  wordMark,
  wordMarks$,
  type WordMarks
} from '$lib/data/word-marks';
import { placementCutoff } from '$lib/data/placement';
import { getWordsMet, knownMinCount, metCounter, wordList } from '$lib/data/words-met';

export interface KnownWords {
  words: string[];
  /** When they were read from Anki (ms); coverages computed from older words are dropped */
  read: number;
}

export interface KnownSet {
  /** Changes whenever the known words change; empty when they are partial (offline) */
  key: string;
  isKnown: (word: BookWord) => boolean;
  /** Met `knownMinCount` times */
  met: (word: BookWord) => boolean;
  /** Mature in Anki (by form or lemma) */
  anki: (word: BookWord) => boolean;
  /** Ranked within the placement check's cutoff */
  placed: (word: BookWord) => boolean;
}

export interface BookWordGroups {
  /** Words to study not known yet (`newWords`) */
  new: BookWord[];
  /** Known, ignored words left out */
  known: BookWord[];
  ignored: BookWord[];
  /** Every word of the list, noise left out */
  all: BookWord[];
  /** Why the list's words are known (a word can have several reasons) */
  reasons: { met: number; anki: number; placed: number; marked: number; ignored: number };
}

export interface CoverageCache {
  /** `KnownSet.key` the coverages were computed from */
  key: string;
  /** Calibre book id → share of the book's word occurrences that are known, per estimate */
  books: Record<number, { share: number; computedAt: number }>;
}

const day = 24 * 60 * 60 * 1000;
const batchSize = 500;

/** Cached coverages for the current known words (Store's Coverage sort). */
export const knownCoverage$ = new BehaviorSubject<Record<number, number>>({});
/** The known words read last, for Settings; undefined until loaded or when there are none. */
export const knownWords$ = new BehaviorSubject<KnownWords | undefined>(undefined);

/**
 * The written forms in an Anki field: no HTML, no furigana (` 漢字[かんじ]` or Yomitan's
 * ruby), no spaces or leading 〜; several words (`食べる<br>食う`, `A、B`) come apart.
 */
export function cleanAnkiField(html: string) {
  const body = new DOMParser().parseFromString(
    html.replace(/<br\s*\/?>/gi, '\n'),
    'text/html'
  ).body;

  body.querySelectorAll('rt, rp').forEach((element) => element.remove());

  return (body.textContent ?? '')
    .replace(/\[[^\]]*\]/g, '')
    .split(/[\n、,，・/／;；]/)
    .map((word) => word.replace(/\s+/g, '').replace(/^[〜～]+/, ''))
    .filter(Boolean);
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
      for (const word of cleanAnkiField(note.fields[field]?.value ?? '')) {
        words.add(word);
        // 勉強する in Anki covers the book's 勉強.
        if (word.length > 2 && word.endsWith('する')) words.add(word.slice(0, -2));
      }
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
 * Anki → Known Words is on, mature in Anki (by written form), or marked known or ignored,
 * or ranked within the placement check's cutoff.
 */
export async function getKnownSet(): Promise<KnownSet> {
  const [met, anki, marks] = await Promise.all([
    getWordsMet(),
    ankiKnownWords$.getValue() ? getKnownWords().catch(() => undefined) : undefined,
    getWordMarks().catch(() => ({}) as WordMarks)
  ]);
  const forms = new Set(anki?.words);
  const metCount = metCounter(met.words);
  const isMet = (word: BookWord) => metCount(word) >= knownMinCount;
  const inAnki = (word: BookWord) => forms.has(word[0]) || (!!word[4] && forms.has(word[4]));
  const cutoff = placementCutoff();
  const placed = (word: BookWord) => word[3] !== null && word[3] <= cutoff;

  return {
    key: met.signature && `${met.signature}|${anki?.read ?? ''}|${marksSignature(marks)}|${cutoff}`,
    isKnown: (word) => isMet(word) || inAnki(word) || placed(word) || !!wordMark(marks, word),
    met: isMet,
    anki: inAnki,
    placed
  };
}

/**
 * A book's word list as the Book words page shows it: new, known and ignored words, with the
 * marks as they are now (`marks`, so marking a word moves it at once).
 */
export function bookWordGroups(
  list: BookWord[],
  words95: number | null | undefined,
  known: Pick<KnownSet, 'met' | 'anki' | 'placed'>,
  marks: WordMarks
): BookWordGroups {
  const all = list.filter((word) => !isNoiseWord(word));
  const isKnown = (word: BookWord) =>
    known.met(word) || known.anki(word) || known.placed(word) || !!wordMark(marks, word);
  const groups: BookWordGroups = {
    new: newWords(wordsToStudy(list, words95 ?? 0), isKnown),
    known: [],
    ignored: [],
    all,
    reasons: { met: 0, anki: 0, placed: 0, marked: 0, ignored: 0 }
  };

  for (const word of all) {
    const mark = wordMark(marks, word);

    if (mark === 'ignored') groups.ignored.push(word);
    else if (isKnown(word)) groups.known.push(word);
    if (known.met(word)) groups.reasons.met += 1;
    if (known.anki(word)) groups.reasons.anki += 1;
    if (known.placed(word)) groups.reasons.placed += 1;
    if (mark === 'known') groups.reasons.marked += 1;
    if (mark === 'ignored') groups.reasons.ignored += 1;
  }

  return groups;
}

async function coverageCache(key: string): Promise<CoverageCache> {
  const cache = key
    ? ((await (await readerDb()).get('known', 'coverage')) as CoverageCache | undefined)
    : undefined;

  return cache?.key === key ? cache : { key, books: {} };
}

/** The shares still current: books re-estimated since (or cached in the older format) are left out. */
function currentShares(
  books: CoverageCache['books'],
  difficulty: Record<number, { computedAt: number } | undefined>
) {
  const shares: Record<number, number> = {};

  for (const [id, cached] of Object.entries(books)) {
    if (cached?.computedAt === difficulty[+id]?.computedAt) shares[+id] = cached.share;
  }

  return shares;
}

/** Loads the cached coverages for the current known words into `knownCoverage$`. */
export async function loadCoverageCache() {
  const [known, difficulty] = await Promise.all([
    getKnownSet(),
    loadCalibreDifficulty().catch(() => ({}))
  ]);

  knownCoverage$.next(currentShares((await coverageCache(known.key)).books, difficulty));
}

/**
 * The book's word coverage (`wordCoverage`) from its word list; its share is cached for
 * the Store's Known words sort unless the known words are partial.
 */
export async function bookCoverage(
  id: number,
  words: BookWord[],
  estimate: WordTotals & { computedAt: number },
  known: KnownSet
) {
  const coverage = wordCoverage(words, known.isKnown, estimate);

  if (!coverage || !known.key) return coverage;

  // Re-read: another book may have been cached meanwhile.
  const latest = await coverageCache(known.key);
  const cached = latest.books[id];

  if (cached?.share !== coverage.share || cached.computedAt !== estimate.computedAt) {
    const books = {
      ...latest.books,
      [id]: { share: coverage.share, computedAt: estimate.computedAt }
    };

    await (await readerDb()).put('known', { key: known.key, books }, 'coverage');
    knownCoverage$.next({ ...knownCoverage$.getValue(), [id]: coverage.share });
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
      const cached = currentShares((await coverageCache(known.key)).books, difficulty);

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
