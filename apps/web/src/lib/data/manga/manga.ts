/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Manga (CBZ/ZIP) is stored like a book, so library, storage and sync work unchanged:
 * the page images are its blobs and elementHtml holds a marker plus the page order.
 * Progress is a normal bookmark with the page index as exploredCharCount. Not upstream.
 */

import type { BooksDbBookmarkData } from '$lib/data/database/books-db/versions/books-db';
import { combineLatest, map } from 'rxjs';
import { writableObjectLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { writableBooleanLocalStorageSubject } from '$lib/data/internal/writable-boolean-local-storage-subject';
import { writableStringLocalStorageSubject } from '$lib/data/internal/writable-string-local-storage-subject';
import type { SeriesOverrides } from '$lib/data/library/series-overrides';
import { orderSeries } from '$lib/data/library/library-sort';
import { record } from '$lib/data/setting-parsers';
import { bookContent, mangaMarker as marker } from '$lib/data/book-content';

export type MangaReadingMode = 'rtl' | 'ltr' | 'vertical';

/** Right to left by default, as in Japanese manga. */
export const mangaReadingMode$ = writableStringLocalStorageSubject<MangaReadingMode>()(
  'mangaReadingMode',
  'rtl'
);

/** Reading modes chosen per series (by name), synced with the account like Mihon's per-series setting. */
export const mangaSeriesModes$ = writableObjectLocalStorageSubject<
  Record<string, MangaReadingMode>
>()('mangaSeriesModes', {}, record);

/**
 * A store of the series' reading mode, else the last one chosen. Setting it keeps it for the
 * series and makes it the mode of books without one.
 */
export function seriesReadingMode(series: string | undefined) {
  const resolve = (fallback: MangaReadingMode, modes: Record<string, MangaReadingMode>) =>
    (series && modes[series]) || fallback;
  const mode$ = combineLatest([mangaReadingMode$, mangaSeriesModes$]).pipe(
    map(([fallback, modes]) => resolve(fallback, modes))
  );

  return {
    subscribe(run: (mode: MangaReadingMode) => void) {
      const subscription = mode$.subscribe(run);

      return () => subscription.unsubscribe();
    },
    set(mode: MangaReadingMode) {
      // A bind: sets the value it was given when it mounts, which is no choice.
      if (mode === resolve(mangaReadingMode$.getValue(), mangaSeriesModes$.getValue())) return;
      mangaReadingMode$.next(mode);
      if (series) mangaSeriesModes$.next({ ...mangaSeriesModes$.getValue(), [series]: mode });
    }
  };
}

/** How a page fits the screen in the paged modes (Mihon's scale types). */
export type MangaScale = 'screen' | 'width' | 'height' | 'original' | 'smart';

export type MangaDualPage = 'auto' | 'on' | 'off';

export type MangaBackground = 'black' | 'gray' | 'white' | 'auto';

export const mangaScale$ = writableStringLocalStorageSubject<MangaScale>()('mangaScale', 'screen');

/** Two pages side by side: auto means on screens wider than tall. */
export const mangaDualPage$ = writableStringLocalStorageSubject<MangaDualPage>()(
  'mangaDualPage',
  'auto'
);

export const mangaBackground$ = writableStringLocalStorageSubject<MangaBackground>()(
  'mangaBackground',
  'black'
);

export const mangaDoubleTapZoom$ = writableBooleanLocalStorageSubject()('mangaDoubleTapZoom', true);

export const mangaKeepScreenOn$ = writableBooleanLocalStorageSubject()('mangaKeepScreenOn', true);

export const mangaPageNumber$ = writableBooleanLocalStorageSubject()('mangaPageNumber', true);

export interface PageSize {
  width: number;
  height: number;
}

function isWide(size: PageSize | undefined) {
  return !!size && size.width > size.height;
}

/**
 * Pages grouped as they are shown: one each, or pairs when dual. The cover, wide pages (already a
 * spread) and the last page stand alone; shift pairs the cover too, for books whose pairs are off by
 * one. Pages whose size isn't known yet count as portrait.
 */
export function pageSpreads(sizes: (PageSize | undefined)[], dual: boolean, shift: boolean) {
  const groups: number[][] = [];

  for (let i = 0; i < sizes.length; ) {
    const alone =
      !dual ||
      i === sizes.length - 1 ||
      (i === 0 && !shift) ||
      isWide(sizes[i]) ||
      isWide(sizes[i + 1]);

    groups.push(alone ? [i] : [i, i + 1]);
    i += alone ? 1 : 2;
  }

  return groups;
}

/**
 * Size of a group of pages (laid out side by side at one height) before zooming. Smart fit is fit
 * screen, except a spread on a portrait screen fits its height, to be panned across.
 */
export function fitSize(scale: MangaScale, pages: PageSize[], view: PageSize): PageSize {
  const aspect = pages.reduce((sum, page) => sum + page.width / page.height, 0);
  const contain = Math.min(view.height, view.width / aspect);
  const height = {
    screen: contain,
    width: view.width / aspect,
    height: view.height,
    original: Math.max(...pages.map((page) => page.height)),
    smart: aspect > view.width / view.height && view.width < view.height ? view.height : contain
  }[scale];

  return { width: height * aspect, height };
}

/** Offset of content along one axis: centred when it fits, else kept covering the view. */
export function clampPan(offset: number, content: number, view: number) {
  if (content <= view) return (view - content) / 2;

  return Math.min(0, Math.max(view - content, offset));
}

/** Average colour of the outer ring of a size×size RGBA image, as CSS (auto background). */
export function borderColor(data: ArrayLike<number>, size: number) {
  const sum = [0, 0, 0];
  let count = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (x > 0 && y > 0 && x < size - 1 && y < size - 1) continue;

      const i = (y * size + x) * 4;

      sum[0] += data[i];
      sum[1] += data[i + 1];
      sum[2] += data[i + 2];
      count += 1;
    }
  }

  return `rgb(${sum.map((value) => Math.round(value / count)).join(', ')})`;
}

export function isMangaFileName(name: string) {
  return /\.(?:cbz|zip)$/i.test(name);
}

export function sortPages(names: string[]) {
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function mangaElementHtml(pages: string[]) {
  return `${marker}${JSON.stringify(pages)}`;
}

export function isManga(book: { elementHtml: string }) {
  return book.elementHtml.startsWith(marker);
}

/** The page order; none for damaged data (bookContent's `invalid`) or other books. */
export function mangaPages(book: { elementHtml: string }): string[] {
  const content = bookContent(book);

  return content.kind === 'manga' ? content.pages : [];
}

export function mangaBookmark(
  dataId: number,
  page: number,
  pageCount: number
): BooksDbBookmarkData {
  return {
    dataId,
    exploredCharCount: page,
    progress: pageCount > 1 ? page / (pageCount - 1) : 0,
    lastBookmarkModified: Date.now()
  };
}

export type MangaTapLayout = 'default' | 'l' | 'kindle' | 'edge' | 'sides' | 'off';

export type MangaTapInvert = 'none' | 'horizontal' | 'vertical' | 'both';

export const mangaTapLayout$ = writableStringLocalStorageSubject<MangaTapLayout>()(
  'mangaTapLayout',
  'default'
);

export const mangaTapInvert$ = writableStringLocalStorageSubject<MangaTapInvert>()(
  'mangaTapInvert',
  'none'
);

/**
 * Mihon's tap zone layouts on a 3×3 grid, rows from the top: N forward, P back, L/R the page on
 * that side (forward on the left in right-to-left manga), M the menu.
 */
const tapGrids: Record<Exclude<MangaTapLayout, 'default'>, string[]> = {
  l: ['PPP', 'PMN', 'NNN'],
  kindle: ['MMM', 'PNN', 'PNN'],
  edge: ['NMN', 'NMN', 'NPN'],
  sides: ['LMR', 'LMR', 'LMR'],
  off: ['MMM', 'MMM', 'MMM']
};

/**
 * Page turn for a tap at x, y: 1 forward, -1 back, 0 the menu. The default layout is the sides
 * for pages and the L shape for the vertical strip, as in Mihon.
 */
export function tapDirection(
  x: number,
  y: number,
  view: PageSize,
  mode: MangaReadingMode,
  layout: MangaTapLayout = 'default',
  invert: MangaTapInvert = 'none'
) {
  const grid = tapGrids[layout === 'default' ? (mode === 'vertical' ? 'l' : 'sides') : layout];
  const third = (at: number, size: number) => Math.max(0, Math.min(2, Math.floor((3 * at) / size)));
  const column = third(x, view.width);
  const row = third(y, view.height);
  const flipX = invert === 'horizontal' || invert === 'both';
  const flipY = invert === 'vertical' || invert === 'both';
  const zone = grid[flipY ? 2 - row : row][flipX ? 2 - column : column];

  if (zone === 'N') return 1;
  if (zone === 'P') return -1;
  if (zone === 'M') return 0;

  const side = zone === 'L' ? -1 : 1;

  return mode === 'rtl' ? -side : side;
}

interface VolumeBook {
  title: string;
  series?: string;
  seriesIndex?: number | null;
  format: string;
  vn?: boolean;
}

/**
 * The manga volumes before and after a title in its series (reading order as in the Store), with
 * readers' series overrides applied. Novels and games of the same series are left out.
 */
export function adjacentVolumes<T extends VolumeBook>(
  books: T[],
  overrides: SeriesOverrides,
  title: string
): { series?: string; previous?: T; next?: T } {
  const isMangaBook = (book: T) => /^(?:CBZ|ZIP)$/i.test(book.format) && !book.vn;
  const withOverrides = books.map((book) => {
    const override = overrides[book.title];

    return !override || override.series === book.series
      ? book
      : { ...book, series: override.series, seriesIndex: null };
  });
  const current = withOverrides.find((book) => book.title === title);

  if (!current?.series || !isMangaBook(current)) return {};

  const ordered = orderSeries(
    withOverrides.filter((book) => book.series === current.series && isMangaBook(book))
  );
  const index = ordered.indexOf(current);

  return { series: current.series, previous: ordered[index - 1], next: ordered[index + 1] };
}
