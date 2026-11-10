/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Every book's highlights kept in this browser, for the Highlights page (/highlights).
 * Restates annotations.ts's ownership rules (isOwnedByOther, heldKey): keep them in step.
 * Not part of upstream.
 */

import { readerDb } from '$lib/data/reader-db';
import { highlightsToMarkdown, type Highlight } from '$lib/data/reader/annotations';

export interface BookHighlights {
  title: string;
  highlights: Highlight[];
}

/** Every book's highlights kept in this browser for `owner` (the account id, '' signed out). */
export async function allHighlights(owner: string): Promise<BookHighlights[]> {
  const records = await (await readerDb()).getAll('annotations');
  const newest = (book: BookHighlights) => Math.max(...book.highlights.map((h) => h.modified));

  return (
    records
      // A held copy (`title\0account`) waits for another sign-in state; another account's record isn't ours.
      .filter(
        (record) =>
          Array.isArray(record?.highlights) &&
          typeof record.title === 'string' &&
          !record.title.includes('\0') &&
          (record.account === undefined || record.account === owner)
      )
      .map((record) => ({
        title: record.title,
        highlights: record.highlights
          .filter((h) => !h.deleted)
          .sort((a, b) => a.start - b.start || a.created - b.created)
      }))
      .filter((book) => book.highlights.length)
      .sort((a, b) => newest(b) - newest(a))
  );
}

export function allHighlightsMarkdown(books: BookHighlights[]): string {
  return books.map((book) => highlightsToMarkdown(book.title, book.highlights)).join('\n');
}
