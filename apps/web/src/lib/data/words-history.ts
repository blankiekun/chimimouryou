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
 * once met `knownMinCount` times. Anki's words aren't in the history (only today's total
 * has them). Cached in reader-db `known` (key `history`), cleared with the known words.
 * Not part of upstream.
 */

import { particles, type BookWord } from '$lib/data/book-words';
import {
  loadCalibreCatalog,
  loadCalibreDifficulty,
  type CalibreDifficulty
} from '$lib/data/calibre';
import { getKanjiSeen } from '$lib/data/kanji-seen';
import { readerDb } from '$lib/data/reader-db';
import { knownMinCount, readFraction, wordKey, wordList } from '$lib/data/words-met';

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
}

export interface HistoryCache {
  signature: string;
  points: KnownPoint[];
}

/** Words known (met `knownMinCount` times) at the end of each day with statistics. */
export function knownHistory(days: DayRead[], books: Map<string, HistoryBook>) {
  const read = new Map<string, number>();
  const counted = new Map<string, number>();
  const totals = new Map<string, number>();
  const points: KnownPoint[] = [];
  let known = 0;

  const sorted = days
    .filter((day) => day.charactersRead > 0 && books.get(day.title)?.characters)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  for (const { title, dateKey, charactersRead } of sorted) {
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
          if (before < knownMinCount - 1e-9 && after >= knownMinCount - 1e-9) known += 1;
        }
      }
    }

    if (points.at(-1)?.dateKey === dateKey) points.pop();
    points.push({ dateKey, known });
  }

  return points;
}

/** Known words gained since the start of the month `todayKey` is in. */
export function gainedThisMonth(points: KnownPoint[], todayKey: string) {
  const monthStart = `${todayKey.slice(0, 8)}01`;
  const before = points.filter((point) => point.dateKey < monthStart).at(-1)?.known ?? 0;

  return (points.at(-1)?.known ?? before) - before;
}

/** The history for these statistics, from the cache when its inputs haven't changed. */
export async function getKnownHistory(days: DayRead[]) {
  const [records, catalog, difficulty] = await Promise.all([
    getKanjiSeen(),
    loadCalibreCatalog().catch(() => []),
    loadCalibreDifficulty().catch(() => ({}) as Record<string, CalibreDifficulty>)
  ]);
  const caps = new Map(records.map((record) => [record.title, record]));
  const titles = new Set(days.filter((day) => day.charactersRead > 0).map((day) => day.title));
  const inputs = catalog
    .filter((book) => titles.has(book.title) && difficulty[book.id]?.characters)
    .map(({ id, title }) => {
      const { computedAt, characters } = difficulty[id];
      const record = caps.get(title);

      return {
        id,
        title,
        computedAt,
        characters,
        cap: record ? readFraction(record, characters) : 1
      };
    })
    .sort((a, b) => a.id - b.id);
  const inputTitles = new Set(inputs.map((book) => book.title));
  const used = days
    .filter((day) => day.charactersRead > 0 && inputTitles.has(day.title))
    .map(({ title, dateKey, charactersRead }) => [title, dateKey, charactersRead])
    .sort();
  const signature = JSON.stringify([inputs, used]);
  const db = await readerDb();
  const cached = (await db.get('known', 'history')) as HistoryCache | undefined;

  if (cached?.signature === signature) return cached.points;

  const books = new Map<string, HistoryBook>();
  let complete = true;

  for (const { id, title, computedAt, characters, cap } of inputs) {
    // Lists are cached by words-met; fetched one at a time when missing.
    const words = await wordList(id, computedAt).catch(() => {
      complete = false;
      return null;
    });

    if (words) books.set(title, { words, characters, cap });
  }

  const points = knownHistory(days, books);

  if (complete) await db.put('known', { signature, points }, 'history');

  return points;
}
