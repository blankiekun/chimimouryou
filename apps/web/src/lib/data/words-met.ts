/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Words met while reading, for the Home dashboard. Not recorded: derived from how far
 * each Calibre book was read (the kanji records' `upTo`, minus text skipped by jumps)
 * and the difficulty service's word list of the book, assuming its words are spread
 * evenly. A word is known when met `knownMinCount` times or mature in Anki (known-words.ts).
 * Cached in reader-db `known` (keys `met` and `list:<id>`), cleared with the known words
 * when the reader changes. Not part of upstream.
 */

import { ankiKnownWords$ } from '$lib/data/anki';
import { loadBookWords, type BookWord } from '$lib/data/book-words';
import {
  loadCalibreCatalog,
  loadCalibreDifficulty,
  type CalibreDifficulty
} from '$lib/data/calibre';
import { getKanjiSeen, type KanjiSeen } from '$lib/data/kanji-seen';
import { getKnownWords } from '$lib/data/known-words';
import { readerDb } from '$lib/data/reader-db';

/** Times a word must be met to count as known. */
export const knownMinCount = 8;

/**
 * Particles: frequent but not vocabulary to learn. The word lists carry no part of
 * speech, so they are dropped by form.
 */
const particles = new Set(
  (
    'は が を に で と も の へ や か な ね よ わ ぞ ぜ さ て ば し から まで より だけ ほど ' +
    'くらい ぐらい など なら って けど けれど のに ので しか こそ でも ても さえ'
  ).split(' ')
);

export interface WordsMetCache {
  /** The inputs the totals came from: catalog id, read fraction and list date per title */
  signature: string;
  /** `form\treading` → occurrences met over all books */
  words: Record<string, number>;
}

export interface WordList {
  /** The estimate's `computedAt` the list belongs to */
  computedAt: number;
  /** null: the book has no word list */
  words: BookWord[] | null;
}

export interface WordsSummary {
  /** Different words met at least once */
  met: number;
  /** Words met `knownMinCount` times, plus Anki's mature words */
  known: number;
}

export const wordKey = ([form, reading]: BookWord) => `${form}\t${reading ?? ''}`;

/** Share of the book read: text skipped by jumps doesn't count. */
export function readFraction(record: KanjiSeen, characters: number) {
  return characters > 0
    ? Math.max(0, Math.min(1, (record.upTo - (record.skipped ?? 0)) / characters))
    : 0;
}

/** Adds each word's count × the share read to `totals`. */
export function addWordsMet(totals: Record<string, number>, words: BookWord[], fraction: number) {
  for (const word of words) {
    if (!particles.has(word[0])) {
      const key = wordKey(word);

      totals[key] = (totals[key] ?? 0) + word[2] * fraction;
    }
  }

  return totals;
}

export function summarizeWords(
  totals: Record<string, number>,
  anki: ReadonlySet<string> = new Set()
): WordsSummary {
  let met = 0;
  let known = 0;
  const forms = new Set<string>();

  for (const [key, count] of Object.entries(totals)) {
    const form = key.slice(0, key.indexOf('\t'));

    forms.add(form);
    if (count >= 1) met += 1;
    if (count >= knownMinCount || anki.has(form)) known += 1;
  }

  for (const form of anki) {
    if (!forms.has(form) && !particles.has(form)) known += 1;
  }

  return { met, known };
}

async function wordList(id: number, computedAt: number) {
  const db = await readerDb();
  const key = `list:${id}`;
  const cached = (await db.get('known', key)) as WordList | undefined;

  if (cached?.computedAt === computedAt) return cached.words;

  // Throws when offline: the totals then aren't cached and are retried next time.
  const words = (await loadBookWords(id)) ?? null;

  await db.put('known', { computedAt, words }, key);

  return words;
}

let running: Promise<Record<string, number>> | undefined;

/**
 * Occurrences met per word over every Calibre book read, from the cache when the
 * kanji records and estimates haven't changed. Word lists are fetched one at a time.
 */
export function getWordsMet() {
  running ??= computeWordsMet().finally(() => {
    running = undefined;
  });

  return running;
}

async function computeWordsMet() {
  const [records, catalog, difficulty] = await Promise.all([
    getKanjiSeen(),
    loadCalibreCatalog().catch(() => []),
    loadCalibreDifficulty().catch(() => ({}) as Record<string, CalibreDifficulty>)
  ]);
  const ids = new Map(catalog.map((book) => [book.title, book.id]));
  const books = records
    .map((record) => {
      const id = ids.get(record.title);
      const estimate = id === undefined ? undefined : difficulty[id];

      return id !== undefined && estimate
        ? {
            id,
            computedAt: estimate.computedAt,
            fraction: readFraction(record, estimate.characters)
          }
        : undefined;
    })
    .filter((book) => !!book?.fraction)
    .map((book) => book!)
    .sort((a, b) => a.id - b.id);
  const signature = JSON.stringify(books);
  const db = await readerDb();
  const cached = (await db.get('known', 'met')) as WordsMetCache | undefined;

  if (cached?.signature === signature) return cached.words;

  const totals: Record<string, number> = {};
  let complete = true;

  for (const { id, computedAt, fraction } of books) {
    const words = await wordList(id, computedAt).catch(() => {
      complete = false;
      return null;
    });

    if (words) addWordsMet(totals, words, fraction);
  }

  if (complete) await db.put('known', { signature, words: totals }, 'met');

  return totals;
}

/** Words met and known, for the dashboard. */
export async function getWordsSummary() {
  const [totals, anki] = await Promise.all([
    getWordsMet(),
    ankiKnownWords$.getValue() ? getKnownWords().catch(() => undefined) : undefined
  ]);

  return summarizeWords(totals, new Set(anki?.words));
}
