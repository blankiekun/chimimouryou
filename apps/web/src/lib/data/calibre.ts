/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Access to the self-hosted Calibre library, served read-only by nginx
 * (see scripts/calibre/). Not part of upstream.
 */

import { standalone } from '$lib/data/env';

export interface CalibreBook {
  id: number;
  title: string;
  authors: string;
  series: string;
  seriesIndex: number | null;
  /** Series guessed from volume numbers in titles rather than set in Calibre */
  seriesInferred?: boolean;
  tags?: string[];
  /** 0-5 stars */
  rating?: number | null;
  publisher?: string;
  /** Epoch milliseconds */
  published?: number | null;
  /** Epoch milliseconds */
  added: number;
  /** 'VN' for a game folder in VN_PATH (file and cover are relative to it) */
  format: string;
  /** An ONScripter game: a VN folder, or a CBZ/ZIP holding one rather than manga */
  vn?: boolean;
  size: number;
  file: string;
  cover: string;
}

/** Difficulty estimate (chimi-difficulty, run on demand on the server), 0-5. */
export interface CalibreDifficulty {
  /** chimi-difficulty's estimate, on jiten.moe's scale */
  difficulty: number;
  /** 10th and 90th percentile of the estimate (older estimates have none) */
  low?: number;
  high?: number;
  /** Top-N words a reader needs to know for 95% of the book's words */
  words95?: number | null;
  characters: number;
  uniqueKanji: number;
  /** Different words and their occurrences, without noise (`isNoiseWord`); newer estimates only */
  uniqueWords?: number;
  tokens?: number;
  computedAt: number;
}

const catalogUrl = '/calibre/catalog.json';
const difficultyUrl = '/calibre/difficulty.json';
export const difficultyApiUrl = '/calibre/difficulty/api/';
const libraryUrl = '/calibre/library/';
const vnUrl = '/calibre/vn/';

let catalogCache: Promise<CalibreBook[]> | undefined;

/**
 * The catalog, fetched once per session (it is several MB for a large library);
 * `refresh` refetches it, e.g. when the library list is reloaded. Failures are not cached.
 */
export function loadCalibreCatalog(refresh = false) {
  if (refresh) {
    catalogCache = undefined;
  }

  // The standalone edition has no server: an empty catalog, never a request.
  if (standalone) return Promise.resolve([] as CalibreBook[]);

  catalogCache ??= fetch(catalogUrl, { cache: 'no-cache' })
    .then((response) => {
      if (!response.ok) {
        throw Object.assign(new Error(`Calibre catalog unavailable (HTTP ${response.status})`), {
          status: response.status
        });
      }

      return response.json();
    })
    .then((catalog: { books: CalibreBook[] }) => catalog.books)
    .catch((error) => {
      catalogCache = undefined;
      throw error;
    });

  return catalogCache;
}

export async function loadCalibreDifficulty(): Promise<Record<string, CalibreDifficulty>> {
  if (standalone) return {};

  const response = await fetch(difficultyUrl, { cache: 'no-cache' });

  if (!response.ok) {
    return {};
  }

  return (await response.json()).books || {};
}

function toLibraryUrl(path: string, base = libraryUrl) {
  return `${base}${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** URL of a VN_PATH game's folder, ending in a slash. */
export function calibreVnUrl(book: CalibreBook) {
  return `${toLibraryUrl(book.file, vnUrl)}/`;
}

export function calibreBookUrl(book: CalibreBook) {
  return toLibraryUrl(book.file);
}

export function calibreCoverUrl(book: CalibreBook) {
  return book.cover ? toLibraryUrl(book.cover, book.format === 'VN' ? vnUrl : libraryUrl) : '';
}

/**
 * The library card's copy of a Calibre or game cover (the catalog builder's thumbnail; nginx
 * sends the full cover until it exists). Other images are returned as they are.
 */
export function coverThumbUrl(imagePath: string) {
  return imagePath.replace(/^\/calibre\/(library|vn)\//, '/calibre/thumbs/$1/');
}

export function calibreBookFileName(book: CalibreBook) {
  return `${book.title.replace(/[\\/]/g, '_')}.${book.format.toLowerCase()}`;
}

export async function downloadCalibreBook(book: CalibreBook) {
  const response = await fetch(calibreBookUrl(book));

  if (!response.ok) {
    throw new Error(`${book.title}: download failed (HTTP ${response.status})`);
  }

  return new File([await response.blob()], calibreBookFileName(book));
}
