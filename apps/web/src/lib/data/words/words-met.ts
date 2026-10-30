/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Words met while reading, for the Home dashboard. Not recorded: derived from how far
 * each book was read (the kanji records' `upTo`, minus text skipped by jumps; for
 * books read before kanji were recorded, the synced progress the library listed)
 * and the difficulty service's word list of the book, assuming its words are spread
 * evenly. A word is known when met `knownMinCount` times, mature in Anki (known-words.ts)
 * or marked known or ignored (word-marks.ts), and every word ranked within the word test's
 * cutoff (placement.ts) is known too.
 * In the standalone without a server, the books are the ones the analysis tools estimated
 * (reader-db `estimates`/`wordLists`, by title) instead.
 * Cached in reader-db `known` (keys `met`, `progress` and `list:<id>`), cleared with the known words
 * when the reader changes. Not part of upstream.
 */

import { coreFormRanks, localEstimates, localWordList } from '$lib/data/analysis/analysis-tools';
import { ankiKnownWords$ } from '$lib/data/dictionary/anki';
import {
  foldReadings,
  isNoiseWord,
  loadBookWords,
  particles,
  totalsOf,
  withTotals,
  type BookWord,
  type WordTotals
} from '$lib/data/words/book-words';
import {
  difficultyApiUrl,
  loadCalibreCatalog,
  loadCalibreDifficulty,
  type CalibreDifficulty
} from '$lib/data/remote/calibre';
import { getKanjiSeen, type KanjiSeen } from '$lib/data/words/kanji-seen';
import { getKnownWords } from '$lib/data/words/known-words';
import {
  knownChance,
  placementAt,
  placementCutoff,
  placementResults$,
  placementWords,
  type PlacementEstimate
} from '$lib/data/difficulty/placement';
import { readerDb } from '$lib/data/reader-db';
import { serverFetch, serverless } from '$lib/data/remote/server-connect';
import { getWordMarks, wordMark, type WordMarks } from '$lib/data/words/word-marks';

/** Times a word must be met to count as known. */
export const knownMinCount = 8;

export interface WordsMetCache {
  /** The inputs the totals came from: catalog id, read fraction and list date per title */
  signature: string;
  /** `form\treading` → occurrences met over all books */
  words: Record<string, number>;
  /** `form\treading` → its best Jiten rank over the word lists (unranked words absent) */
  ranks: Record<string, number>;
}

export interface WordList {
  /** The estimate's `computedAt` the list belongs to */
  computedAt: number;
  /** null: the book has no word list */
  words: BookWord[] | null;
  /** The list's totals (lists made on request; `withTotals`) */
  totals?: WordTotals;
}

export interface WordsSummary {
  /** Different words met at least once */
  met: number;
  /** Words met `knownMinCount` times, plus Anki's mature words, the words marked and the word
   * test's cutoff (words ranked within it counted once) */
  known: number;
  /** Words met `knownMinCount` times (the Words page's "Known because") */
  metEnough: number;
}

export const wordKey = ([form, reading]: BookWord) => `${form}\t${reading ?? ''}`;

/** Bumped when the totals are computed differently, so cached ones are redone. */
const metVersion = 3;

/** A finished book's position is the start of its last page: count it as read through. */
const fullyRead = (fraction: number) => (fraction >= 0.97 ? 1 : fraction);

/** Share of the book read: text skipped by jumps doesn't count. */
export function readFraction(record: KanjiSeen, characters: number) {
  return characters > 0
    ? fullyRead(Math.max(0, Math.min(1, (record.upTo - (record.skipped ?? 0)) / characters)))
    : 0;
}

/**
 * Remembers the synced progress of the books the library listed, for the books
 * read before kanji were recorded (they have no kanji record). Resolves true if it changed.
 */
export async function saveReadProgress(books: { title: string; progress: number }[]) {
  const progress = Object.fromEntries(
    books
      .filter((book) => book.progress > 0)
      .map((book) => [book.title, book.progress])
      .sort(([a], [b]) => (a < b ? -1 : 1))
  );
  const db = await readerDb();

  if (JSON.stringify(await db.get('known', 'progress')) === JSON.stringify(progress)) return false;
  await db.put('known', progress, 'progress');

  return true;
}

/** Adds each word's count × the share read to `totals`, and its rank to `ranks`. */
export function addWordsMet(
  totals: Record<string, number>,
  words: BookWord[],
  fraction: number,
  ranks: Record<string, number> = {}
) {
  for (const word of words) {
    if (!isNoiseWord(word)) {
      const key = wordKey(word);

      totals[key] = (totals[key] ?? 0) + word[2] * fraction;
      if (word[3] !== null && !(ranks[key] <= word[3])) ranks[key] = word[3];
    }
  }

  return totals;
}

/**
 * Totals of a form without a reading (a book where it only appeared conjugated) join its
 * most met reading, like `foldReadings` within a book.
 */
export function foldTotals(totals: Record<string, number>) {
  const top: Record<string, string> = {};

  for (const [key, count] of Object.entries(totals)) {
    const form = key.slice(0, key.indexOf('\t'));

    if (!key.endsWith('\t') && !(totals[top[form]] >= count)) top[form] = key;
  }

  const folded = { ...totals };

  for (const [form, key] of Object.entries(top)) {
    const bare = `${form}\t`;

    if (bare in folded) {
      folded[key] += folded[bare];
      delete folded[bare];
    }
  }

  return folded;
}

/** Occurrences met of a word in folded totals; a word without a reading takes its form's. */
export function metCounter(totals: Record<string, number>) {
  const byForm = new Map<string, number>();

  for (const [key, count] of Object.entries(totals)) {
    const form = key.slice(0, key.indexOf('\t'));

    byForm.set(form, Math.max(byForm.get(form) ?? 0, count));
  }

  return (word: BookWord) =>
    totals[wordKey(word)] ?? (word[1] === null ? byForm.get(word[0]) : totals[`${word[0]}\t`]) ?? 0;
}

export function summarizeWords(
  totals: Record<string, number>,
  anki: ReadonlySet<string> = new Set(),
  marks: WordMarks = {},
  placement?: PlacementEstimate,
  ranks: Record<string, number> = {},
  formRanks: Record<string, number | null> = {}
): WordsSummary {
  let met = 0;
  let metEnough = 0;

  for (const count of Object.values(totals)) {
    if (count >= 1) met += 1;
    if (count >= knownMinCount) metEnough += 1;
  }

  // The word test's estimate, then what the evidence adds to it.
  const known = Math.round(
    placementWords(placement) + knownBeyond(totals, anki, marks, placement, ranks, formRanks)
  );

  return { met, known, metEnough };
}

/**
 * Words known by evidence (met `knownMinCount` times, Anki mature, marked), each less the chance
 * the word test's estimate already counts it (`knownChance`; unranked words count whole).
 */
export function knownBeyond(
  totals: Record<string, number>,
  anki: ReadonlySet<string>,
  marks: WordMarks,
  placement: PlacementEstimate | undefined,
  ranks: Record<string, number>,
  formRanks: Record<string, number | null>
) {
  const unseen = (rank: number | null | undefined) => 1 - knownChance(placement, rank);
  let known = 0;
  const forms = new Set<string>();

  for (const [key, count] of Object.entries(totals)) {
    const tab = key.indexOf('\t');
    const form = key.slice(0, tab);

    forms.add(form);
    if (
      count >= knownMinCount ||
      anki.has(form) ||
      wordMark(marks, [form, key.slice(tab + 1) || null, count, null])
    ) {
      known += unseen(ranks[key]);
    }
  }

  // Words in no book read: by the form's own rank (`formRanks`), so the estimate doesn't count them twice.
  for (const form of anki) {
    if (!forms.has(form) && !particles.has(form)) known += unseen(formRanks[form]);
  }

  // Forms marked with a reading: a mark of the bare form is the same word.
  const readingMarked = new Set(
    Object.entries(marks)
      .filter(([key, mark]) => mark.status && !key.endsWith('\t'))
      .map(([key]) => key.slice(0, key.indexOf('\t')))
  );

  // Marked words not met yet (a mark without a reading covers the form's words met).
  for (const [key, mark] of Object.entries(marks)) {
    const form = key.slice(0, key.indexOf('\t'));

    if (
      mark.status &&
      !(key in totals) &&
      !(key.endsWith('\t') && (forms.has(form) || readingMarked.has(form))) &&
      !anki.has(form) &&
      !particles.has(form)
    ) {
      known += unseen(formRanks[form]);
    }
  }

  return known;
}

/** The book's word list, cached per estimate. */
export async function wordList(id: number, computedAt: number) {
  const db = await readerDb();
  const key = `list:${id}`;
  const cached = (await db.get('known', key)) as WordList | undefined;

  // Lists cached before readings were folded are folded here.
  if (cached?.computedAt === computedAt) {
    return cached.words && withTotals(foldReadings(cached.words), cached.totals);
  }

  // Throws when offline or the server fails (or is still making the list): nothing is cached and
  // it is retried next time.
  const words = (await loadBookWords(id)) ?? null;
  const totals = words ? totalsOf(words) : {};

  await db.put(
    'known',
    { computedAt, words, ...(totals.tokens !== undefined && { totals }) } satisfies WordList,
    key
  );

  return words;
}

export interface EstimatedBook {
  /** The catalog id; the title for a local estimate (standalone) */
  id: number | string;
  title: string;
  computedAt: number;
  characters: number;
  estimate: CalibreDifficulty;
}

/**
 * The books with an estimate, by id: the Calibre catalog's with the difficulty service's, or in
 * the standalone without a server the analysis tools' local estimates.
 */
export async function estimatedBooks(): Promise<EstimatedBook[]> {
  if (serverless) {
    return [...(await localEstimates()).values()]
      .map((estimate) => ({
        id: estimate.title,
        title: estimate.title,
        computedAt: estimate.computedAt,
        characters: estimate.characters,
        estimate
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  const [catalog, difficulty] = await Promise.all([
    loadCalibreCatalog().catch(() => []),
    loadCalibreDifficulty().catch(() => ({}) as Record<string, CalibreDifficulty>)
  ]);

  return catalog
    .filter(({ id }) => difficulty[id])
    .map(({ id, title }) => ({
      id,
      title,
      computedAt: difficulty[id].computedAt,
      characters: difficulty[id].characters,
      estimate: difficulty[id]
    }))
    .sort((a, b) => (a.id as number) - (b.id as number));
}

/** An estimated book's word list (a local one is read from reader-db, never cached again). */
export async function estimatedWordList({ id, title, computedAt }: EstimatedBook) {
  return typeof id === 'number'
    ? wordList(id, computedAt)
    : ((await localWordList(title))?.words ?? null);
}

let running: Promise<WordsMetCache> | undefined;

/**
 * Occurrences met per word over every estimated book read, from the cache when the
 * kanji records and estimates haven't changed. Word lists are fetched one at a time.
 * The signature is empty when a list couldn't be loaded (the totals are partial).
 */
export function getWordsMet() {
  running ??= computeWordsMet().finally(() => {
    running = undefined;
  });

  return running;
}

/** The estimated books read, with the share read of each. */
export async function readBooks() {
  const db = await readerDb();
  const [records, estimated, progress] = await Promise.all([
    getKanjiSeen(),
    estimatedBooks(),
    db.get('known', 'progress') as Promise<Record<string, number> | undefined>
  ]);
  const read = new Map(records.map((record) => [record.title, record]));
  // Local books are keyed by title, catalog books by id: the signatures never match.
  return estimated
    .map((book) => {
      const record = read.get(book.title);
      const fraction = record
        ? readFraction(record, book.characters)
        : fullyRead(Math.min(1, progress?.[book.title] ?? 0));

      return { ...book, fraction };
    })
    .filter((book) => !!book.fraction);
}

async function computeWordsMet(): Promise<WordsMetCache> {
  const db = await readerDb();
  const books = await readBooks();
  const signature = JSON.stringify([
    metVersion,
    books.map(({ id, computedAt, fraction }) => ({ id, computedAt, fraction }))
  ]);
  const cached = (await db.get('known', 'met')) as WordsMetCache | undefined;

  if (cached?.signature === signature) return cached;

  const totals: Record<string, number> = {};
  const ranks: Record<string, number> = {};
  let complete = true;

  for (const book of books) {
    const words = await estimatedWordList(book).catch(() => {
      complete = false;
      return null;
    });

    if (words) addWordsMet(totals, words, book.fraction, ranks);
  }

  if (!complete) return { signature: '', words: foldTotals(totals), ranks };

  const met = { signature, words: foldTotals(totals), ranks };

  await db.put('known', met, 'met');

  return met;
}

/** Words met and known, for the dashboard. */
export async function getWordsSummary() {
  const [{ words: totals, ranks }, anki, marks] = await Promise.all([
    getWordsMet(),
    ankiKnownWords$.getValue() ? getKnownWords().catch(() => undefined) : undefined,
    getWordMarks().catch(() => ({}) as WordMarks)
  ]);

  const forms = new Set(anki?.words);

  return summarizeWords(
    totals,
    forms,
    marks,
    placementAt(placementResults$.getValue()),
    ranks,
    await knownFormRanks(forms, marks)
  );
}

/** `formRanks` for the Anki words and marks. */
export const knownFormRanks = (anki: ReadonlySet<string>, marks: WordMarks) =>
  formRanks([...anki, ...Object.keys(marks).map((key) => key.slice(0, key.indexOf('\t')))]);

/**
 * Frequency ranks of forms (null: not in the list), for the Anki words and marks met in no book:
 * the difficulty service's list, or the standalone's analysis tools. Cached in reader-db `known`
 * (`ranks`); a form not looked up (offline, no tools) is missing and counts as unranked.
 */
export async function formRanks(forms: string[]) {
  if (!placementCutoff()) return {};

  const db = await readerDb();
  // shortcut: kept until the known words are cleared, so a replaced frequency list's ranks aren't
  // refetched; key it by the list if that ever matters.
  const cached = ((await db.get('known', 'ranks')) ?? {}) as Record<string, number | null>;
  const missing = [...new Set(forms)].filter((form) => !(form in cached));

  if (!missing.length) return cached;

  const found = await (serverless ? coreFormRanks(missing) : serverFormRanks(missing)).catch(
    () => undefined
  );

  if (!found) return cached;

  const ranks = { ...cached };

  for (const form of missing) ranks[form] = found[form] ?? null;
  await db.put('known', ranks, 'ranks');

  return ranks;
}

async function serverFormRanks(forms: string[]) {
  const response = await serverFetch(`${difficultyApiUrl}ranks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forms })
  });

  if (!response.ok) throw new Error(`Ranks: ${response.status}`);

  return (await response.json()).ranks as Record<string, number>;
}
