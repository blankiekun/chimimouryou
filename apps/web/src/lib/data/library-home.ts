/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The library's Home tab (current reads and the books you picked) and Store tab
 * (the whole library, e.g. the Calibre catalog), with series search so a whole
 * series can be added at once. Not part of upstream.
 */

import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import { isFinished, isReading } from '$lib/components/book-card/library-filters';
import { orderSeries, titleVolume } from '$lib/components/book-card/library-sort';
import { writableObjectLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';
import { deleteCachedReadings } from '$lib/data/generated-furigana';
import { deleteVnCache } from '$lib/data/vn';
import { standalone } from '$lib/data/env';
import { guessSeriesName } from '$lib/data/series-overrides';
import { coverageTarget } from '$lib/data/difficulty-core';

export type LibraryTab = 'home' | 'store';

export const libraryTab$ = writableStringLocalStorageSubject()('libraryTab', 'home');

export type PendingImport = { files: File[] } | { backup: File };

/** Files picked in the Import menu outside /manage (e.g. /words); /manage imports them on open. */
let pendingImport: PendingImport | undefined;

export function setPendingImport(value: PendingImport) {
  pendingImport = value;
}

export function takePendingImport() {
  const value = pendingImport;
  pendingImport = undefined;
  return value;
}

/** Store → Books or Series */
export const storeView$ = writableStringLocalStorageSubject()('libraryStoreView', 'books');

/** Titles added to Home from the Store (titles are how books are identified across devices). */
export const homeBookTitles$ = writableObjectLocalStorageSubject<string[]>()('homeBookTitles', []);

/** Titles removed from Home and when: Continue reading skips them until they are read again. */
export const homeRemovedTitles$ = writableObjectLocalStorageSubject<Record<string, number>>()(
  'homeRemovedTitles',
  {}
);

// lastBookOpen is stored with the shared book file; the bookmark time is per account.
export const lastRead = (card: BookCardProps) =>
  Math.max(card.lastBookOpen || 0, card.lastBookmarkModified || 0);

/** Shown on Home's Continue reading shelf. */
export function isContinueReading(card: BookCardProps, removed: Record<string, number>) {
  return isReading(card) && lastRead(card) > (removed[card.title] ?? 0);
}

/** Home's Continue reading shelf: the books being read, last read first. */
export function continueReading(
  cards: BookCardProps[],
  removed: Record<string, number>,
  limit = 12
) {
  return cards
    .filter((card) => isContinueReading(card, removed))
    .sort((a, b) => lastRead(b) - lastRead(a))
    .slice(0, limit);
}

export function addToHome(titles: string[]) {
  homeBookTitles$.next([...new Set([...homeBookTitles$.getValue(), ...titles])]);
  const removed = { ...homeRemovedTitles$.getValue() };
  // A negative time records the add, so syncing with another device's older removal keeps it.
  titles.forEach((title) => (removed[title] = -Date.now()));
  homeRemovedTitles$.next(removed);
}

/** Two devices' removals (positive times) and adds (negative), the newest per title. */
export function mergeHomeRemovals(
  local: Record<string, number> = {},
  remote: Record<string, number> = {}
) {
  const merged = { ...remote };

  Object.entries(local).forEach(([title, time]) => {
    if (!(title in merged) || Math.abs(time) > Math.abs(merged[title])) merged[title] = time;
  });

  return merged;
}

/** Both devices' Home books, without the ones the newest change removed. */
export function mergeHomeTitles(
  local: string[] = [],
  remote: string[] = [],
  localRemoved?: Record<string, number>,
  remoteRemoved?: Record<string, number>
) {
  const removed = mergeHomeRemovals(localRemoved, remoteRemoved);

  return [...new Set([...local, ...remote])].filter((title) => !(removed[title] > 0));
}

/** Imports of more books than this (a library dump, not today's reading) stay in the Store only. */
export const maxImportsToHome = 3;

export function addImportsToHome(titles: string[]) {
  if (titles.length <= maxImportsToHome) addToHome(titles);
}

export function removeFromHome(title: string) {
  homeBookTitles$.next(homeBookTitles$.getValue().filter((t) => t !== title));
  homeRemovedTitles$.next({ ...homeRemovedTitles$.getValue(), [title]: Date.now() });
  deleteVnCache(title).catch(() => {});
  deleteCachedReadings(title).catch(() => {});
}

export interface SeriesMatch {
  series: string;
  books: BookCardProps[];
}

/**
 * Series whose name matches the search, or that contain a book whose title or
 * author matches, with all their books in reading order.
 */
export function matchingSeries(bookCards: BookCardProps[], searchTerm: string, limit = 6) {
  const term = searchTerm.trim().toLocaleLowerCase();

  if (!term) {
    return [];
  }

  const bySeries = new Map<string, BookCardProps[]>();

  bookCards.forEach((card) => {
    if (card.series) {
      bySeries.set(card.series, [...(bySeries.get(card.series) ?? []), card]);
    }
  });

  const matches: (SeriesMatch & { byName: boolean })[] = [];

  bySeries.forEach((books, series) => {
    const byName = series.toLocaleLowerCase().includes(term);
    const byBook = books.some(
      (book) =>
        book.title.toLocaleLowerCase().includes(term) ||
        !!book.authors?.toLocaleLowerCase().includes(term)
    );

    if ((byName || byBook) && books.length > 1) {
      matches.push({
        series,
        byName,
        books: orderSeries(books)
      });
    }
  });

  return matches
    .sort((a, b) => Number(b.byName) - Number(a.byName) || b.books.length - a.books.length)
    .slice(0, limit)
    .map(({ series, books }): SeriesMatch => ({ series, books }));
}

export interface SeriesGroup {
  series: string;
  /** In reading order; the first one's cover stands for the series */
  books: BookCardProps[];
  started: number;
}

/** Books grouped by series, by name. Books without a series are left out. */
export function seriesGroups(bookCards: BookCardProps[]): SeriesGroup[] {
  const bySeries = new Map<string, BookCardProps[]>();

  bookCards.forEach((card) => {
    if (card.series) {
      bySeries.set(card.series, [...(bySeries.get(card.series) ?? []), card]);
    }
  });

  return [...bySeries.entries()]
    .map(([series, books]) => ({
      series,
      books: orderSeries(books),
      started: books.filter((book) => book.progress > 0).length
    }))
    .sort((a, b) => a.series.localeCompare(b.series, 'ja'));
}

/** Read next: books this close to the recent finished books' median difficulty */
const readNextRange = 0.3;
// shortcut: only the books closest in difficulty get a coverage worked out (one word list
// fetch each); rank the whole range once coverages are computed server-side.
const readNextPoolSize = 40;

/** Difficulties of the last 3 finished books with an estimate, lowest first: Read next's level. */
export function recentLevels(cards: BookCardProps[]) {
  return cards
    .filter((card) => isFinished(card) && card.difficulty !== undefined)
    .sort((a, b) => lastRead(b) - lastRead(a))
    .slice(0, 3)
    .map((card) => card.difficulty!)
    .sort((a, b) => a - b);
}

/** The first unread volume after the last started one of each started series, last read first. */
function nextVolumes(groups: SeriesGroup[]) {
  return groups
    .filter((group) => group.started)
    .map((group) => {
      const lastStarted = group.books.findLastIndex((book) => book.progress > 0);

      return group.books.slice(lastStarted + 1).find((book) => !book.progress);
    })
    .filter((card): card is BookCardProps => !!card)
    .sort((a, b) => lastRead(b) - lastRead(a));
}

/**
 * Read next without a server (no catalog series): the next volumes, books without a series
 * grouped by the name before their title's volume number, then the books near the reader's level
 * by the analysis tools' estimates (readNextPool; no coverage), closest first.
 */
export function standaloneReadNext(cards: BookCardProps[], limit = 12) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const withSeries = cards.map((card) =>
    card.series || titleVolume(card.title) === undefined
      ? card
      : { ...card, series: guessSeriesName(card.title) }
  );

  return [...nextVolumes(seriesGroups(withSeries)), ...readNextPool(withSeries).pool]
    .slice(0, limit)
    .map((card) => byId.get(card.id)!);
}

/**
 * Home's Read next candidates: the next unread volume of each series the reader has
 * started, and the unread books within ±0.3 of the median difficulty of the last 3
 * finished books (closest first, at most `readNextPoolSize`). Nothing when no finished
 * book has a difficulty estimate.
 */
export function readNextPool(cards: BookCardProps[]) {
  const recent = recentLevels(cards);

  if (!recent.length) {
    return { next: [], pool: [] };
  }

  const median = recent.length % 2 ? recent[(recent.length - 1) / 2] : (recent[0] + recent[1]) / 2;
  const groups = seriesGroups(cards);
  const next = nextVolumes(groups);
  const nextIds = new Set(next.map((card) => card.id));
  // A series only enters the pool by its first unread volume.
  const firstUnread = new Set(groups.map((group) => group.books.find((book) => !book.progress)));
  const distance = (card: BookCardProps) => Math.abs(card.difficulty! - median);
  const pool = cards
    .filter(
      (card) =>
        !card.progress &&
        !nextIds.has(card.id) &&
        (!card.series || firstUnread.has(card)) &&
        card.difficulty !== undefined &&
        distance(card) <= readNextRange
    )
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, readNextPoolSize);

  return { next, pool };
}

/**
 * Home's Read next shelf: next volumes first, then the pool by known-word coverage
 * (`known-words.ts`, Calibre id → share), closest to the 98% target first; books without one
 * after, closest difficulty first.
 */
export function readNext(cards: BookCardProps[], coverage: Record<number, number>, limit = 12) {
  if (standalone) return standaloneReadNext(cards, limit);

  const { next, pool } = readNextPool(cards);
  const distance = (card: BookCardProps) => {
    const share = card.calibreId === undefined ? undefined : coverage[card.calibreId];

    return share === undefined ? 2 : Math.abs(share - coverageTarget);
  };

  return [...next, ...pool.sort((a, b) => distance(a) - distance(b))].slice(0, limit);
}
