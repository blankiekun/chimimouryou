/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * What a stored book's elementHtml holds: '' (a placeholder), book HTML, or a marker plus JSON
 * for manga (the page order, manga.ts) and visual novels (VnInfo, vn.ts). Synced files are
 * trusted by nobody, so this parses and checks the shape once and never throws: damaged data
 * is `invalid`. The stored string stays as it is. Not upstream.
 */

import type { VnInfo } from '$lib/data/vn/vn';

export const mangaMarker = '<!--ttu-manga-->';
export const vnMarker = '<!--ttu-vn-->';

/** What book details, /m and /v show for `invalid` data. */
export const damagedBookText =
  "This book's data is damaged and can't be opened. Delete it and import it again.";

export type BookContent =
  | { kind: 'placeholder' }
  | { kind: 'book'; html: string }
  | { kind: 'manga'; pages: string[] }
  | { kind: 'vn'; info: VnInfo }
  | { kind: 'invalid' };

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const optional = (value: unknown, type: string) => value === undefined || typeof value === type;

function isVnInfo(value: any): value is VnInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value.encoding === 'sjis' || value.encoding === 'utf8') &&
    isStrings(value.files) &&
    optional(value.base, 'string') &&
    (value.engine === undefined ||
      (value.engine === 'vnbox' &&
        typeof value.folder === 'string' &&
        typeof value.exe === 'string')) &&
    optional(value.folder, 'string') &&
    optional(value.exe, 'string') &&
    (value.discs === undefined || isStrings(value.discs)) &&
    optional(value.hook, 'string') &&
    optional(value.hookFile, 'string') &&
    (value.hookCleanup === undefined ||
      (typeof value.hookCleanup === 'object' && value.hookCleanup !== null))
  );
}

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (_) {
    return undefined;
  }
}

export function bookContent(book: { elementHtml: string }): BookContent {
  const html = book.elementHtml;

  if (!html) return { kind: 'placeholder' };
  if (html.startsWith(mangaMarker)) {
    const pages = parse(html.slice(mangaMarker.length));

    return isStrings(pages) ? { kind: 'manga', pages } : { kind: 'invalid' };
  }
  if (html.startsWith(vnMarker)) {
    const info = parse(html.slice(vnMarker.length));

    return isVnInfo(info) ? { kind: 'vn', info } : { kind: 'invalid' };
  }

  return { kind: 'book', html };
}
