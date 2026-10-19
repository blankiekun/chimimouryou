/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Kanji met while reading, per book, counted from the text up to the reading
 * position, for the library's Home tab. Synced as kanji.json in the account's folder
 * while signed in (extras-sync.ts). Not part of upstream.
 */

import { kanjiChanged, pullKanji } from '$lib/data/extras-sync';
import { readerDb } from '$lib/data/reader-db';
import { textBetween } from '$lib/data/recap';
import type { SearchIndex } from '$lib/functions/book-text/book-search';

export interface KanjiSeen {
  title: string;
  /** Character count counted up to */
  upTo: number;
  counts: Record<string, number>;
  /** Characters jumped over rather than read (words-met.ts); missing on older records */
  skipped?: number;
  /** When this browser last recorded it (ms); missing on records from before syncing */
  modified?: number;
}

const kanjiPattern = /\p{Unified_Ideograph}/gu;
/** A forward jump larger than this (e.g. "Jump to position") isn't counted as read. */
const maxStep = 20_000;

export function countKanji(text: string, counts: Record<string, number> = {}) {
  for (const [kanji] of text.matchAll(kanjiPattern)) {
    counts[kanji] = (counts[kanji] ?? 0) + 1;
  }

  return counts;
}

/**
 * Adds the kanji between the last recorded position and `position`. The first
 * time a book is recorded, everything before the position counts as read.
 */
export async function recordKanjiSeen(title: string, index: SearchIndex, position: number) {
  // Start from another device's newer record rather than overwrite it.
  await pullKanji();
  const db = await readerDb();
  const seen = (await db.get('kanji', title)) ?? { title, upTo: 0, counts: {} };

  if (position <= seen.upTo) {
    return;
  }

  let skipped = seen.skipped;

  if (!seen.upTo || position - seen.upTo <= maxStep) {
    countKanji(textBetween(index, seen.upTo, position), seen.counts);
  } else {
    skipped = (skipped ?? 0) + position - seen.upTo;
  }

  await db.put('kanji', { ...seen, upTo: position, skipped, modified: Date.now() });
  kanjiChanged();
}

/** Adds the kanji of text read in a visual novel, which has no search index. */
export async function recordKanjiText(title: string, text: string, upTo: number) {
  await pullKanji();
  const db = await readerDb();
  const seen = (await db.get('kanji', title)) ?? { title, upTo: 0, counts: {} };

  await db.put('kanji', {
    ...seen,
    upTo,
    counts: countKanji(text, { ...seen.counts }),
    modified: Date.now()
  });
  kanjiChanged();
}

export interface KanjiCoverage {
  /** Share of the book's kanji occurrences already met, 0-1 */
  coverage: number;
  /** Different kanji in the book not met yet */
  newKanji: number;
  /** The most frequent of those, most frequent first (up to `newKanjiShown`) */
  topNew: string[];
}

export const newKanjiShown = 30;

/** How much of a book's kanji (its counts from the difficulty service) a reader has met. */
export function kanjiCoverage(
  bookCounts: Record<string, number>,
  books: KanjiSeen[]
): KanjiCoverage | undefined {
  const met = new Set(books.flatMap((book) => Object.keys(book.counts)));
  let total = 0;
  let known = 0;
  const unmet: [string, number][] = [];

  for (const [kanji, count] of Object.entries(bookCounts)) {
    total += count;
    if (met.has(kanji)) {
      known += count;
    } else {
      unmet.push([kanji, count]);
    }
  }

  const topNew = unmet
    .sort((a, b) => b[1] - a[1])
    .slice(0, newKanjiShown)
    .map(([kanji]) => kanji);

  return total ? { coverage: known / total, newKanji: unmet.length, topNew } : undefined;
}

export async function getKanjiSeen() {
  await pullKanji();
  return (await readerDb()).getAll('kanji');
}
