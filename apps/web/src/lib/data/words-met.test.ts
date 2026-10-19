/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookWord } from '$lib/data/book-words';
import { readerDb } from '$lib/data/reader-db';
import {
  addWordsMet,
  getWordsMet,
  knownMinCount,
  readFraction,
  summarizeWords
} from '$lib/data/words-met';

vi.mock('$lib/data/extras-sync', () => ({
  pullKanji: async () => {},
  kanjiChanged: () => {},
  pullWordMarks: async () => {},
  wordMarksChanged: () => {}
}));

const words: BookWord[] = [
  ['猫', 'ねこ', 20, 100],
  ['は', null, 50, 1],
  ['宦官', 'かんがん', 1, 68872]
];

describe('words met', () => {
  it('reads the share of the book not skipped', () => {
    expect(readFraction({ title: 'A', upTo: 500, counts: {} }, 1000)).toBe(0.5);
    expect(readFraction({ title: 'A', upTo: 500, skipped: 300, counts: {} }, 1000)).toBe(0.2);
    expect(readFraction({ title: 'A', upTo: 1200, counts: {} }, 1000)).toBe(1);
    expect(readFraction({ title: 'A', upTo: 10, counts: {} }, 0)).toBe(0);
  });

  it('adds occurrences by the share read, without particles', () => {
    const totals = addWordsMet({}, words, 0.5);

    expect(totals).toEqual({ '猫\tねこ': 10, '宦官\tかんがん': 0.5 });
    expect(addWordsMet(totals, words, 0.5)['猫\tねこ']).toBe(20);
  });

  it('counts words met once and known from N meetings or Anki', () => {
    const totals = { '猫\tねこ': knownMinCount, '犬\tいぬ': 2, '宦官\tかんがん': 0.5 };

    expect(summarizeWords(totals)).toEqual({ met: 2, known: 1 });
    expect(summarizeWords(totals, new Set(['犬', '宦官', '鳥', '猫']))).toEqual({
      met: 2,
      known: 4
    });
  });

  it('counts marked words as known, met or not, removals not', () => {
    const totals = { '猫\tねこ': 1, '犬\tいぬ': 2 };
    const mark = (status: 'known' | 'ignored' | null) => ({ status, modified: 1 });

    expect(
      summarizeWords(totals, new Set(), {
        '猫\t': mark('known'),
        '犬\tいぬ': mark(null),
        '鳥\tとり': mark('ignored')
      })
    ).toEqual({ met: 2, known: 2 });
  });
});

describe('getWordsMet', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sums Calibre books read from their word lists and caches the totals', async () => {
    const db = await readerDb();

    await db.put('kanji', { title: '猫の本', upTo: 500, counts: {} });
    await db.put('kanji', { title: 'Browser only', upTo: 500, counts: {} });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('catalog.json')) {
        return new Response(JSON.stringify({ books: [{ id: 7, title: '猫の本' }] }));
      }
      if (url.endsWith('difficulty.json')) {
        return new Response(JSON.stringify({ books: { 7: { characters: 1000, computedAt: 1 } } }));
      }
      if (url.endsWith('/words/7')) return new Response(JSON.stringify(words));
      return new Response('', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    expect((await getWordsMet()).words).toEqual({ '猫\tねこ': 10, '宦官\tかんがん': 0.5 });
    expect((await getWordsMet()).words).toEqual({ '猫\tねこ': 10, '宦官\tかんがん': 0.5 });
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/words/'))).toHaveLength(1);

    // Reading on changes the totals; the list comes from the cache.
    await db.put('kanji', { title: '猫の本', upTo: 1000, counts: {} });
    expect((await getWordsMet()).words['猫\tねこ']).toBe(20);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/words/'))).toHaveLength(1);
  });
});
