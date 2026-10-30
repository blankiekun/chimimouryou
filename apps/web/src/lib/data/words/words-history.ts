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
 * once met `knownMinCount` times, on top of the word test's estimate in force that day as
 * words-met's `summarizeWords` counts it (a test is a step up or down on its day, counted in
 * `tests`, not as words gained). Marks count from the day they were made; Anki's words from the
 * start (Anki gives no date per word, and the deck's read time is only its latest refresh), so
 * the last point is the Words known box. Cached in reader-db `known` (key `history`), cleared
 * with the known words.
 * Not part of upstream.
 */

import { ankiKnownWords$ } from '$lib/data/dictionary/anki';
import { isNoiseWord, type BookWord } from '$lib/data/words/book-words';
import { getKanjiSeen } from '$lib/data/words/kanji-seen';
import { getKnownWords } from '$lib/data/words/known-words';
import {
  knownChance,
  placementAt,
  placementResults$,
  placementWords,
  type PlacementEstimate,
  type PlacementRecord
} from '$lib/data/difficulty/placement';
import { readerDb } from '$lib/data/reader-db';
import { getWordMarks, type WordMarks } from '$lib/data/words/word-marks';
import { getDateString } from '$lib/functions/statistic-util';
import {
  estimatedBooks,
  estimatedWordList,
  knownBeyond,
  knownFormRanks,
  knownMinCount,
  readFraction,
  wordKey
} from '$lib/data/words/words-met';

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

/** The word test result in force from `dateKey` ('' for an undated one: from the start). */
export interface CutoffChange extends PlacementEstimate {
  dateKey: string;
}

/** Anki's words (by form), the marks and their forms' ranks, as words-met's box takes them. */
export interface HistoryExtras {
  anki: ReadonlySet<string>;
  marks: WordMarks;
  formRanks: Record<string, number | null>;
}

export interface HistoryCache {
  signature: string;
  points: KnownPoint[];
}

/**
 * Words known (`summarizeWords`: the word test's estimate in force then, plus the words met
 * `knownMinCount` times, marked by then or in Anki) at the end of each day with statistics, a
 * word test or a mark.
 */
export function knownHistory(
  days: DayRead[],
  books: Map<string, HistoryBook>,
  cutoffs: CutoffChange[] = [],
  { anki, marks, formRanks }: HistoryExtras = { anki: new Set(), marks: {}, formRanks: {} }
) {
  const read = new Map<string, number>();
  const counted = new Map<string, number>();
  const totals = new Map<string, number>();
  const points: KnownPoint[] = [];
  // Words of a form in Anki or marked go through words-met's `knownBeyond` at each point; the
  // others add up here: the ranks of those met enough, and what they add to the estimate.
  const formOf = (key: string) => key.slice(0, key.indexOf('\t'));
  const watched = new Set([...anki, ...Object.keys(marks).map(formOf)]);
  const watchedTotals: Record<string, number> = {};
  const watchedRanks: Record<string, number> = {};
  const knownRanks: (number | null)[] = [];
  let placement: PlacementEstimate | undefined;
  let beyond = 0;
  let tests = 0;
  const unseen = (rank: number | null) => 1 - knownChance(placement, rank);
  const marked = Object.entries(marks)
    .map(([key, mark]) => ({ key, mark, dateKey: getDateString(new Date(mark.modified)) }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  let markedSoFar: WordMarks = {};
  let mark = 0;
  const total = () =>
    placementWords(placement) +
    beyond +
    knownBeyond(watchedTotals, anki, markedSoFar, placement, watchedRanks, formRanks);
  // A form without a reading joins its most frequent reading over the books, as `foldTotals` does.
  const byReading = new Map<string, number>();
  const top = new Map<string, string>();

  for (const { words } of books.values()) {
    for (const word of words) {
      if (word[1] !== null)
        byReading.set(wordKey(word), (byReading.get(wordKey(word)) ?? 0) + word[2]);
    }
  }
  for (const [key, count] of byReading) {
    const form = key.slice(0, key.indexOf('\t'));

    if (!(byReading.get(top.get(form)!)! >= count)) top.set(form, key);
  }

  const sorted = days
    .filter((day) => day.charactersRead > 0 && books.get(day.title)?.characters)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const changes = [...cutoffs].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const dateKeys = [
    ...new Set([...sorted, ...changes, ...marked].map(({ dateKey }) => dateKey))
  ].sort();
  let day = 0;
  let change = 0;

  const push = (dateKey: string) => {
    if (!dateKey) return;
    if (points.at(-1)?.dateKey === dateKey) points.pop();
    const roundedTests = Math.round(tests);

    points.push({
      dateKey,
      known: Math.round(total()),
      ...(roundedTests ? { tests: roundedTests } : {})
    });
  };

  for (const dateKey of dateKeys) {
    // The day's test first, then its reading.
    while (changes[change]?.dateKey === dateKey) {
      const before = total();

      placement = changes[change];
      beyond = knownRanks.reduce<number>((sum, rank) => sum + unseen(rank), 0);
      tests += total() - before;
      change += 1;
    }
    if (marked[mark]?.dateKey === dateKey) {
      markedSoFar = { ...markedSoFar };
      for (; marked[mark]?.dateKey === dateKey; mark += 1) {
        markedSoFar[marked[mark].key] = marked[mark].mark;
      }
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
        // The words words-met counts (`addWordsMet`): no particles, numbers or lone kana.
        if (!isNoiseWord(word)) {
          const key = (word[1] === null && top.get(word[0])) || wordKey(word);

          if (watched.has(word[0])) {
            watchedTotals[key] = (watchedTotals[key] ?? 0) + word[2] * delta;
            // As `addWordsMet` keeps them: the best rank per unfolded key.
            if (word[3] !== null && !(watchedRanks[wordKey(word)] <= word[3])) {
              watchedRanks[wordKey(word)] = word[3];
            }
            continue;
          }

          const before = totals.get(key) ?? 0;
          const after = before + word[2] * delta;

          totals.set(key, after);
          // The epsilon absorbs rounding from adding the shares day by day.
          if (before < knownMinCount - 1e-9 && after >= knownMinCount - 1e-9) {
            knownRanks.push(word[3]);
            beyond += unseen(word[3]);
          }
        }
      }
    }
  }
}

/** The results as changes, by local day: the one in force after each test. */
export function cutoffChanges(results: PlacementRecord[]): CutoffChange[] {
  return results.map(({ date }) => {
    const { cutoff = 0, words, curve } = placementAt(results, date) ?? {};

    // shortcut: local midnight, not the tracker's start-of-day hour; upgrade if days look off.
    return { dateKey: date ? getDateString(new Date(date)) : '', cutoff, words, curve };
  });
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
  // The same Anki words and marks as words-met's box (`getWordsSummary`).
  const [known, marks] = await Promise.all([
    ankiKnownWords$.getValue() ? getKnownWords().catch(() => undefined) : undefined,
    getWordMarks().catch(() => ({}) as WordMarks)
  ]);
  const anki = new Set(known?.words);
  const formRanks = await knownFormRanks(anki, marks);
  // 3: the test's estimate as the base, Anki words and marks counted.
  const signature = JSON.stringify([
    3,
    inputs,
    used,
    cutoffs,
    known?.read ?? 0,
    marks,
    Object.keys(formRanks).length
  ]);
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

  const points = knownHistory(days, books, cutoffs, { anki, marks, formRanks });

  if (complete) await db.put('known', { signature, points }, 'history');

  return points;
}
