/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The "Known" furigana style: hides ruby over kanji the reader has met often,
 * but only ruby that is a plain hiragana reading of its base (yurigana's hideKnownRuby).
 * Not part of upstream.
 */

import { hideKnownRuby } from 'yurigana';
import { getKanjiSeen } from '$lib/data/kanji-seen';

export { hideKnownRuby, isPlainReading, knownKanjiMinCount } from 'yurigana';

export const knownRubyClass = 'ttu-known-ruby';

/** Kanji met across all books in this browser. */
export function totalKanjiCounts(books: { counts: Record<string, number> }[]) {
  const totals: Record<string, number> = {};
  for (const book of books) {
    for (const [kanji, count] of Object.entries(book.counts)) {
      totals[kanji] = (totals[kanji] ?? 0) + count;
    }
  }
  return totals;
}

/** Loads the kanji met and the readings table once, e.g. when a book opens. */
export async function loadKnownRubyCheck() {
  const [books, table] = await Promise.all([getKanjiSeen(), import('yurigana/kanji-readings.json')]);
  const totals = totalKanjiCounts(books);
  const readings: Record<string, string> = table.default;

  return (base: string, reading: string) => hideKnownRuby(base, reading, totals, readings);
}

/** Marks the ruby elements to hide in a rendered section and returns them. */
export function markKnownRuby(
  contentEl: HTMLElement,
  hide: (base: string, reading: string) => boolean
) {
  return Array.from(contentEl.getElementsByTagName('ruby')).filter((ruby) => {
    let base = '';
    let reading = '';
    for (const node of ruby.childNodes) {
      const tag = node.nodeName.toLowerCase();
      if (tag === 'rt') {
        reading += node.textContent ?? '';
      } else if (tag !== 'rp') {
        base += node.textContent ?? '';
      }
    }

    const marked = hide(base.trim(), reading.trim());
    ruby.classList.toggle(knownRubyClass, marked);
    return marked;
  });
}
