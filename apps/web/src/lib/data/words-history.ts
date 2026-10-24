/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Words known over time, for the Statistics chart and Home's Words known tile. An
 * estimate rebuilt from the daily statistics with words-met's rule: each day, the share
 * of every book read so far (characters read since the start over the book's length,
 * capped by its kanji record's share when there is one) × its word list; a word is known
 * once met `knownMinCount` times, or ranked within the word test's cutoff in force that day (a
 * test is a step up or down on its day, counted in `tests`, not as words gained). Anki's words
 * and the marks aren't in the history (only today's total has them). Cached in reader-db `known` (key `history`), cleared with the known words.
 * Not part of upstream.
 */

import { particles, type BookWord } from '$lib/data/book-words';
import { getKanjiSeen } from '$lib/data/kanji-seen';
import { placementAt, placementResults$, type PlacementRecord } from '$lib/data/placement';
import { readerDb } from '$lib/data/reader-db';
import { getDateString } from '$lib/functions/statistic-util';
import {
  estimatedBooks,
  estimatedWordList,
  knownMinCount,
  readFraction,
  wordKey
} from '$lib/data/words-met';

export interface DayRead {
  title: string;
  dateKey: string;
  charactersRead: number;
}

export interface HistoryBook {
  words: BookWord[];
  characters: number;
  /** Most of the book that counts as read (the kanji record's share), 0-1 */
  cap: number;
}

export interface KnownPoint {
  dateKey: string;
  known: number;
  /** Of `known`, the change the word tests made so far, when they made one */
  tests?: number;
}

/** A word test's cutoff, in force from `dateKey` ('' for an undated one: from the start). */
export interface CutoffChange {
  dateKey: string;
  cutoff: number;
}

export interface HistoryCache {
  signature: string;
  points: KnownPoint[];
}

/**
 * Words known (met `knownMinCount` times, or ranked within the cutoff then) at the end of each
 * day with statistics or a word test.
 */
export function knownHistory(
  days: DayRead[],
  books: Map<string, HistoryBook>,
  cutoffs: CutoffChange[] = []
) {
  const read = new Map<string, number>();
  const counted = new Map<string, number>();
  const totals = new Map<string, number>();
  const points: KnownPoint[] = [];
  // Ranks of the words met enough; `within`: how many of them the cutoff covers.
  const knownRanks: (number | null)[] = [];
  let within = 0;
  let cutoff = 0;
  let tests = 0;
  const covered = (rank: number | null) => rank !== null && rank <= cutoff;
  const total = () => cutoff + knownRanks.length - within;

  const sorted = days
    .filter((day) => day.charactersRead > 0 && books.get(day.title)?.characters)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const changes = [...cutoffs].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const dateKeys = [...new Set([...sorted, ...changes].map(({ dateKey }) => dateKey))].sort();
  let day = 0;
  let change = 0;

  const push = (dateKey: string) => {
    if (!dateKey) return;
    if (points.at(-1)?.dateKey === dateKey) points.pop();
    points.push({ dateKey, known: total(), ...(tests ? { tests } : {}) });
  };

  for (const dateKey of dateKeys) {
    // The day's test first, then its reading.
    while (changes[change]?.dateKey === dateKey) {
      const before = total();

      cutoff = changes[change].cutoff;
      within = knownRanks.filter(covered).length;
      tests += total() - before;
      change += 1;
    }
    for (; sorted[day]?.dateKey === dateKey; day += 1) addDay(sorted[day]);
    push(dateKey);
  }

  return points;

  function addDay({ title, charactersRead }: DayRead) {
    const book = books.get(title)!;
    const characters = (read.get(title) ?? 0) + charactersRead;
    const fraction = Math.min(book.cap, characters / book.characters);
    const delta = fraction - (counted.get(title) ?? 0);

    read.set(title, characters);

    if (delta > 0) {
      counted.set(title, fraction);

      for (const word of book.words) {
        if (!particles.has(word[0])) {
          const key = wordKey(word);
          const before = totals.get(key) ?? 0;
          const after = before + word[2] * delta;

          totals.set(key, after);
          // The epsilon absorbs rounding from adding the shares day by day.
          if (before < knownMinCount - 1e-9 && after >= knownMinCount - 1e-9) {
            knownRanks.push(word[3]);
            if (covered(word[3])) within += 1;
          }
        }
      }
    }
  }
}

/** The results as cutoff changes, by local day: the one in force after each test. */
export function cutoffChanges(results: PlacementRecord[]): CutoffChange[] {
  return results.map(({ date }) => ({
    // shortcut: local midnight, not the tracker's start-of-day hour; upgrade if days look off.
    dateKey: date ? getDateString(new Date(date)) : '',
    cutoff: placementAt(results, date)?.cutoff ?? 0
  }));
}

/** Known words gained by reading since the start of the month `todayKey` is in (not by tests). */
export function gainedThisMonth(points: KnownPoint[], todayKey: string) {
  const monthStart = `${todayKey.slice(0, 8)}01`;
  const read = (point?: KnownPoint) => (point ? point.known - (point.tests ?? 0) : undefined);
  const before = read(points.filter((point) => point.dateKey < monthStart).at(-1)) ?? 0;

  return (read(points.at(-1)) ?? before) - before;
}

/** The history for these statistics, from the cache when its inputs haven't changed. */
export async function getKnownHistory(days: DayRead[]) {
  const [records, estimated] = await Promise.all([getKanjiSeen(), estimatedBooks()]);
  const caps = new Map(records.map((record) => [record.title, record]));
  const titles = new Set(days.filter((day) => day.charactersRead > 0).map((day) => day.title));
  const inputs = estimated
    .filter((book) => titles.has(book.title) && book.characters)
    .map((book) => {
      const record = caps.get(book.title);

      return { ...book, cap: record ? readFraction(record, book.characters) : 1 };
    });
  const inputTitles = new Set(inputs.map((book) => book.title));
  const used = days
    .filter((day) => day.charactersRead > 0 && inputTitles.has(day.title))
    .map(({ title, dateKey, charactersRead }) => [title, dateKey, charactersRead])
    .sort();
  const cutoffs = cutoffChanges(placementResults$.getValue());
  const signature = JSON.stringify([inputs, used, cutoffs]);
  const db = await readerDb();
  const cached = (await db.get('known', 'history')) as HistoryCache | undefined;

  if (cached?.signature === signature) return cached.points;

  const books = new Map<string, HistoryBook>();
  let complete = true;

  for (const book of inputs) {
    const { title, characters, cap } = book;
    // Lists are cached by words-met; fetched one at a time when missing.
    const words = await estimatedWordList(book).catch(() => {
      complete = false;
      return null;
    });

    if (words) books.set(title, { words, characters, cap });
  }

  const points = knownHistory(days, books, cutoffs);

  if (complete) await db.put('known', { signature, points }, 'history');

  return points;
}
