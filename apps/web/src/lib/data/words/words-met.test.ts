/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '$lib/data/test-utils/fake-api';
import type { BookWord } from '$lib/data/words/book-words';
import { loadCalibreCatalog } from '$lib/data/remote/calibre';
import { readerDb } from '$lib/data/reader-db';
import {
  addWordsMet,
  foldTotals,
  getWordsMet,
  knownMinCount,
  metCounter,
  readFraction,
  saveReadProgress,
  summarizeWords
} from '$lib/data/words/words-met';

vi.mock('$lib/data/sync/extras-sync', () => ({
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

// One API for the file (the catalog is cached per page load); the difficulty service stays a stub.
const api = fakeApi();

api.addBook({ id: 1, calibreId: 7, title: '猫の本' });

describe('words met', () => {
  it('reads the share of the book not skipped', () => {
    expect(readFraction({ title: 'A', upTo: 500, counts: {} }, 1000)).toBe(0.5);
    expect(readFraction({ title: 'A', upTo: 500, skipped: 300, counts: {} }, 1000)).toBe(0.2);
    expect(readFraction({ title: 'A', upTo: 1200, counts: {} }, 1000)).toBe(1);
    expect(readFraction({ title: 'A', upTo: 10, counts: {} }, 0)).toBe(0);
    // The start of the last page counts as finished.
    expect(readFraction({ title: 'A', upTo: 975, counts: {} }, 1000)).toBe(1);
  });

  it('folds a form met without a reading into its most met reading', () => {
    const totals = foldTotals({
      '呟く\t': 2,
      '呟く\tつぶやく': 7,
      '私\tわたくし': 1,
      'えっと\t': 3
    });

    expect(totals).toEqual({ '呟く\tつぶやく': 9, '私\tわたくし': 1, 'えっと\t': 3 });
    expect(metCounter(totals)(['呟く', null, 1, 1])).toBe(9);
    expect(metCounter(totals)(['えっと', 'えっと', 1, 1])).toBe(3);
    expect(metCounter(totals)(['犬', null, 1, 1])).toBe(0);
  });

  it('adds occurrences by the share read, without particles and noise', () => {
    expect(
      addWordsMet(
        {},
        [
          ['8', null, 5, null],
          ['えっと', null, 5, null]
        ],
        1
      )
    ).toEqual({});

    const totals = addWordsMet({}, words, 0.5);

    expect(totals).toEqual({ '猫\tねこ': 10, '宦官\tかんがん': 0.5 });
    expect(addWordsMet(totals, words, 0.5)['猫\tねこ']).toBe(20);
  });

  it('counts words met once and known from N meetings or Anki', () => {
    const totals = { '猫\tねこ': knownMinCount, '犬\tいぬ': 2, '宦官\tかんがん': 0.5 };

    expect(summarizeWords(totals)).toEqual({ met: 2, known: 1, metEnough: 1 });
    expect(summarizeWords(totals, new Set(['犬', '宦官', '鳥', '猫']))).toEqual({
      met: 2,
      known: 4,
      metEnough: 1
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
    ).toEqual({ met: 2, known: 2, metEnough: 0 });
  });
});

describe('summarizeWords with the word test cutoff', () => {
  it('counts the cutoff once, plus known words ranked past it or unranked', () => {
    const totals = {
      '猫\tねこ': knownMinCount, // known, ranked within the cutoff: in the cutoff already
      '犬\tいぬ': knownMinCount, // known, ranked past it
      '宦官\tかんがん': knownMinCount, // known, unranked
      '鳥\tとり': 1 // ranked within, not otherwise known: in the cutoff
    };
    const ranks = { '猫\tねこ': 50, '犬\tいぬ': 5000, '鳥\tとり': 900 };

    expect(summarizeWords(totals, new Set(), {}, { cutoff: 1000 }, ranks)).toEqual({
      met: 4,
      known: 1002,
      metEnough: 3
    });
    // Anki words in no book read have no rank: past the cutoff.
    expect(summarizeWords(totals, new Set(['猫', '馬']), {}, { cutoff: 1000 }, ranks).known).toBe(
      1003
    );
    expect(summarizeWords(totals, new Set(), {}, undefined, ranks).known).toBe(3);
  });

  it("counts Anki words and marks in no book read only past the cutoff, by the form's rank", () => {
    const totals = { '犬\tいぬ': 1 };
    const mark = { status: 'known' as const, modified: 1 };
    // 本 and 机 are common: the cutoff counts them already. 魑魅 is rare, 謎語 unranked.
    const formRanks = { 本: 30, 机: 800, 魑魅: 90000, 謎語: null };
    const anki = new Set(['本', '魑魅', '謎語', '犬']);
    const marks = { '机\t': mark, '机\tつくえ': mark, '本\t': mark };

    // 犬 met once, ranked past: +1; 魑魅 +1; 謎語 +1; 机 and 本 within the cutoff.
    expect(
      summarizeWords(totals, anki, marks, { cutoff: 1000 }, { '犬\tいぬ': 5000 }, formRanks).known
    ).toBe(1003);
    // Not looked up: past the cutoff, as before (机 once, not once per mark).
    expect(summarizeWords(totals, anki, marks, { cutoff: 1000 }, { '犬\tいぬ': 5000 }).known).toBe(
      1005
    );
  });

  it("adds to the test's estimate each known word's chance of being outside it", () => {
    const totals = {
      '猫\tねこ': knownMinCount, // rank 500, below the first no: in the estimate already
      '犬\tいぬ': knownMinCount, // rank 5000, where the curve is one half: +0.5
      '宦官\tかんがん': knownMinCount // unranked: +1
    };
    const ranks = { '猫\tねこ': 500, '犬\tいぬ': 5000 };
    const placement = {
      cutoff: 5000,
      words: 6000,
      curve: { shift: 0, slope: -2, firstNo: 1000 }
    };

    // 6000 + 0.5 + 1 = 6001.5; Anki's 魑魅 (rank 50,000: 1 / (1 + 10²) in the estimate) +0.99.
    expect(summarizeWords(totals, new Set(), {}, placement, ranks).known).toBe(6002);
    expect(
      summarizeWords(totals, new Set(['魑魅']), {}, placement, ranks, { 魑魅: 50000 }).known
    ).toBe(6002);
    expect(
      summarizeWords(totals, new Set(['魑魅', '謎語']), {}, placement, ranks, { 魑魅: 50000 }).known
    ).toBe(6003);
    // A result without a curve: its words, then the cutoff's rule.
    expect(summarizeWords(totals, new Set(), {}, { cutoff: 5000, words: 6000 }, ranks).known).toBe(
      6001
    );
  });

  it('keeps the best rank of a word over the lists', () => {
    const ranks: Record<string, number> = {};

    addWordsMet({}, [['猫', 'ねこ', 2, 300]], 1, ranks);
    addWordsMet(
      {},
      [
        ['猫', 'ねこ', 2, 100],
        ['犬', 'いぬ', 2, null]
      ],
      1,
      ranks
    );
    expect(ranks).toEqual({ '猫\tねこ': 100 });
  });
});

describe('getWordsMet', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sums Calibre books read from their word lists and caches the totals', async () => {
    const db = await readerDb();

    await db.put('kanji', { title: '猫の本', upTo: 500, counts: {} });
    await db.put('kanji', { title: 'Browser only', upTo: 500, counts: {} });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/v1/')) return api.fetch(url);
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

  it('counts books read before kanji were recorded from their synced progress', async () => {
    const db = await readerDb();

    await db.clear('kanji');
    await db.clear('known');
    api.addBook({ id: 2, calibreId: 8, title: '犬の本' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/v1/')) return api.fetch(url);
        if (url.endsWith('difficulty.json')) {
          return new Response(
            JSON.stringify({ books: { 8: { characters: 1000, computedAt: 1 } } })
          );
        }
        if (url.endsWith('/words/8')) return new Response(JSON.stringify(words));
        return new Response('', { status: 404 });
      })
    );
    await loadCalibreCatalog(true);

    expect((await getWordsMet()).words).toEqual({});
    expect(await saveReadProgress([{ title: '犬の本', progress: 0.5 }])).toBe(true);
    expect(await saveReadProgress([{ title: '犬の本', progress: 0.5 }])).toBe(false);
    expect((await getWordsMet()).words).toEqual({ '猫\tねこ': 10, '宦官\tかんがん': 0.5 });
  });

  it("doesn't cache a list the server failed to send", async () => {
    const db = await readerDb();

    await db.clear('known');
    api.addBook({ id: 2, calibreId: 9, title: '犬の本' });
    await saveReadProgress([{ title: '犬の本', progress: 0.5 }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/v1/')) return api.fetch(url);
        if (url.endsWith('difficulty.json')) {
          return new Response(
            JSON.stringify({ books: { 9: { characters: 1000, computedAt: 1 } } })
          );
        }
        return new Response('', { status: 502 });
      })
    );
    await loadCalibreCatalog(true);

    expect((await getWordsMet()).signature).toBe('');
    expect(await db.get('known', 'list:9')).toBeUndefined();
  });
});
