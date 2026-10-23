/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Different kanji in a stored book, counted in the browser for the standalone's
 * book page (the server edition gets them from the difficulty service). Cached
 * in reader-db `known` as `kanji:<title>`. Not part of upstream.
 */

import { countKanji } from '$lib/data/kanji-seen';
import { readerDb } from '$lib/data/reader-db';
import { database } from '$lib/data/store';

export interface BookKanji {
  /** The book's character count when counted: a re-import with other text recounts */
  characters: number;
  uniqueKanji: number;
}

const key = (title: string) => `kanji:${title}`;

/** Different kanji in the book's HTML, furigana (rt, rp) left out. */
export function uniqueKanjiInHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc.querySelectorAll('rt, rp').forEach((node) => node.remove());

  return Object.keys(countKanji(doc.body.textContent ?? '')).length;
}

/** The book's different kanji, from the cache or counted from the stored book. */
export async function bookKanjiCount(id: number, title: string, characters: number) {
  const db = await readerDb();
  const cached = (await db.get('known', key(title))) as BookKanji | undefined;

  if (cached && cached.characters === characters) return cached.uniqueKanji;

  const data = await database.getData(id);

  if (!data?.elementHtml) return undefined;

  const uniqueKanji = uniqueKanjiInHtml(data.elementHtml);

  await db.put('known', { characters, uniqueKanji }, key(title));

  return uniqueKanji;
}

export async function deleteBookKanji(title: string) {
  await (await readerDb()).delete('known', key(title));
}
