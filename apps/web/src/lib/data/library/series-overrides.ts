/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Series set by readers (the series generator in the library), shared by
 * everyone as the server's series rows (one per book, /api/v1/series). They override
 * the catalog's series by title; an empty series takes a book out of its catalog series.
 * Not part of upstream.
 */

import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import { loadCalibreCatalog } from '$lib/data/remote/calibre';
import { serverless } from '$lib/data/remote/server-connect';
import { isSeriesName, splitVolume } from '$lib/functions/split-volume';
import { apiVersion, putRow, syncMirror } from '$lib/data/remote/server-api';

export interface SeriesOverride {
  series: string;
  modified: number;
}

export type SeriesOverrides = Record<string, SeriesOverride>;

const maxSeriesLength = 200;

let cache: Promise<SeriesOverrides> | undefined;

/** Keeps only well-formed entries: the file is writable by every reader. */
export function parseSeriesOverrides(data: unknown): SeriesOverrides {
  const result: SeriesOverrides = {};

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return result;
  }

  Object.entries(data).forEach(([title, entry]) => {
    if (
      entry &&
      typeof entry.series === 'string' &&
      entry.series.length <= maxSeriesLength &&
      typeof entry.modified === 'number'
    ) {
      result[title] = { series: entry.series.trim(), modified: entry.modified };
    }
  });

  return result;
}

/** The mirror's series rows by title (rows of books no longer in the catalog are left out). */
async function fetchSeriesOverrides(refresh = true) {
  if (serverless) return {};

  await apiVersion();

  const [mirror, books] = await Promise.all([syncMirror(refresh), loadCalibreCatalog()]);
  const titles = new Map(books.map((book) => [book.bookId, book.title]));

  return parseSeriesOverrides(
    Object.fromEntries(
      mirror.series
        .filter((row) => titles.has(row.book))
        .map((row) => [titles.get(row.book), { series: row.series, modified: row.modified }])
    )
  );
}

/** Fetched once per session like the catalog; `refresh` refetches. Failures are not cached. */
export function loadSeriesOverrides(refresh = false) {
  if (refresh) {
    cache = undefined;
  }

  cache ??= fetchSeriesOverrides().catch((error) => {
    cache = undefined;
    throw error;
  });

  return cache;
}

/**
 * Sets the series of each title (`''` for none), on top of the latest server copy, or with
 * `local` in this browser's copy for its own books (`withBrowserSeries`).
 */
export async function saveSeriesOverrides(changes: Record<string, string>, local = false) {
  const modified = Date.now();

  if (local) {
    const overrides = { ...readBrowserSeries() };

    Object.entries(changes).forEach(([title, series]) => {
      overrides[title] = { series: series.trim().slice(0, maxSeriesLength), modified };
    });
    writeBrowserSeries(overrides);
    syncBrowserSeries().catch(() => undefined);

    return overrides;
  }

  const ids = new Map((await loadCalibreCatalog()).map((book) => [book.title, book.bookId]));

  // One row per book: a newer save of the same book elsewhere (409) wins and is kept.
  await Promise.all(
    Object.entries(changes).map(([title, series]) => {
      const id = ids.get(title);

      return id === undefined
        ? undefined
        : putRow(`series/${id}`, {
            modified,
            series: series.trim().slice(0, maxSeriesLength)
          }).catch((error) => {
            throw new Error(`Saving the series failed (HTTP ${error.status})`);
          });
    })
  );

  // The latest rows: other devices' saves come down with this one's.
  const overrides = await fetchSeriesOverrides();

  cache = Promise.resolve(overrides);

  return overrides;
}

export function applySeriesOverride(card: BookCardProps, overrides: SeriesOverrides) {
  const override = overrides[card.title];

  if (!override) {
    return card;
  }

  return override.series === card.series
    ? card
    : {
        ...card,
        series: override.series || undefined,
        seriesIndex: null,
        seriesInferred: false
      };
}

function normalize(text: string) {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
}

/** Likely series name of a title: `split_volume`'s base, or the cleaned title without a volume. */
export function guessSeriesName(title: string) {
  return splitVolume(title)[0];
}

/** Books whose title contains the series name (width, case and spaces ignored). */
export function findSeriesBooks<T extends { title: string }>(books: T[], name: string) {
  const term = normalize(name);

  return term ? books.filter((book) => normalize(book.title).includes(term)) : [];
}

/** The longest existing series name contained in the title, for a newly imported book. */
export function seriesForTitle(books: BookCardProps[], title: string) {
  const text = normalize(title);
  let best = '';

  new Set(books.map((book) => book.series).filter(Boolean)).forEach((series) => {
    if (series!.length > best.length && series!.length >= 2 && text.includes(normalize(series!))) {
      best = series!;
    }
  });

  return best;
}

/** Browser books' series made in the library, per browser; synced as series.json (`syncBrowserSeries`). */
const browserSeriesKey = 'browserSeries';

function readBrowserSeries(): SeriesOverrides {
  try {
    return parseSeriesOverrides(JSON.parse(window.localStorage.getItem(browserSeriesKey) || '{}'));
  } catch {
    return {};
  }
}

function writeBrowserSeries(overrides: SeriesOverrides) {
  try {
    window.localStorage.setItem(browserSeriesKey, JSON.stringify(overrides));
  } catch {
    // Kept for this page only; the next sync or save tries again.
  }
}

/** The newest change per title wins. */
export function mergeSeriesOverrides(local: SeriesOverrides, remote: SeriesOverrides) {
  const merged = { ...local };

  Object.entries(remote).forEach(([title, entry]) => {
    if (!merged[title] || entry.modified > merged[title].modified) merged[title] = entry;
  });

  return merged;
}

function sameOverrides(a: SeriesOverrides, b: SeriesOverrides) {
  const titles = Object.keys(a);

  return (
    titles.length === Object.keys(b).length &&
    titles.every(
      (title) => b[title]?.series === a[title].series && b[title].modified === a[title].modified
    )
  );
}

/**
 * Merges the browser's series with series.json at the root of the library's Drive, OneDrive or
 * folder (the auto-replication target for a browser library), like kanji.json. True when this
 * browser's copy changed. Nothing is sent without such a source.
 */
export async function syncBrowserSeries() {
  const { readerSyncSource, syncFileStore, syncJsonFile } = await import(
    '$lib/data/sync/sync-files'
  );
  // Never the Calibre source: it has its own shared series.json (`saveSeriesOverrides`).
  const store = await syncFileStore(readerSyncSource());
  let changed = false;

  if (!store) return changed;

  await syncJsonFile(store, 'series.json', undefined, parseSeriesOverrides, async (file) => {
    const remote = file ?? {};
    const local = readBrowserSeries();
    const merged = mergeSeriesOverrides(local, remote);

    if (!sameOverrides(merged, local)) {
      writeBrowserSeries(merged);
      changed = true;
    }

    return sameOverrides(merged, remote) ? undefined : merged;
  });

  return changed;
}

/**
 * Series from volume numbers in titles for books without one, like `split_volume` in
 * build-catalog.py: two or more volumes with the same name form a series, and a single one joins
 * an existing series of that name (width and case ignored).
 */
export function inferSeries(cards: BookCardProps[]) {
  const key = (name: string) => name.normalize('NFKC').toLocaleLowerCase();
  const existing = new Map(
    cards.filter((card) => card.series).map((card) => [key(card.series!), card.series!])
  );
  const groups = new Map<string, BookCardProps[]>();
  const volumes = new Map<BookCardProps, number>();

  cards.forEach((card) => {
    const [name, volume] = card.series ? ['', null] : splitVolume(card.title);

    if (volume !== null && isSeriesName(name)) {
      groups.set(name, [...(groups.get(name) ?? []), card]);
      volumes.set(card, volume);
    }
  });

  const inferred = new Map<BookCardProps, string>();

  groups.forEach((members, name) => {
    const series = existing.get(key(name));

    if (series || members.length > 1) {
      members.forEach((card) => inferred.set(card, series ?? name));
    }
  });

  return cards.map((card) =>
    inferred.has(card)
      ? {
          ...card,
          series: inferred.get(card),
          seriesIndex: volumes.get(card),
          seriesInferred: true
        }
      : card
  );
}

/** Browser books with series: their EPUB's, inferred from titles, then the ones made in the library. */
export function withBrowserSeries(cards: BookCardProps[]) {
  const overrides = readBrowserSeries();

  return inferSeries(cards).map((card) => applySeriesOverride(card, overrides));
}
