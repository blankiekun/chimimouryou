/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ankiKnownDeck$, ankiKnownField$, ankiKnownWords$ } from '$lib/data/anki';
import type { BookWord } from '$lib/data/book-words';
import {
  bookCoverage,
  cleanAnkiField,
  clearKnownWords,
  knownCoverage$,
  refreshKnownWords,
  refreshKnownWordsIfStale
} from '$lib/data/known-words';
import { readerDb } from '$lib/data/reader-db';

const words: BookWord[] = [
  ['猫', 'ねこ', 6, 100],
  ['犬', 'いぬ', 3, 200],
  ['宦官', 'かんがん', 1, 68872]
];

function stubAnki(fields: string[]) {
  const calls: any[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/difficulty/api/words/')) {
        return new Response(JSON.stringify(words));
      }
      const body = JSON.parse(init.body as string);

      calls.push(body);
      const result =
        body.action === 'findNotes'
          ? fields.map((_, i) => i + 1)
          : body.params.notes.map((id: number) => ({
              noteId: id,
              fields: { Expression: { value: fields[id - 1], order: 0 } }
            }));

      return new Response(JSON.stringify({ result, error: null }));
    })
  );

  return calls;
}

describe('cleanAnkiField', () => {
  it('keeps the written form', () => {
    expect(cleanAnkiField(' 漢字[かんじ]')).toBe('漢字');
    expect(cleanAnkiField('<b>食べ[た]る</b>&nbsp;')).toBe('食べる');
    expect(cleanAnkiField('<div>猫</div>')).toBe('猫');
  });
});

describe('known words', () => {
  beforeEach(async () => {
    ankiKnownWords$.next(true);
    ankiKnownDeck$.next('Mining "JP"');
    ankiKnownField$.next('Expression');
    await clearKnownWords();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads mature notes of the deck', async () => {
    const calls = stubAnki([' 猫[ねこ]', '<b>犬</b>']);

    expect((await refreshKnownWords()).words).toEqual(['猫', '犬']);
    expect(calls[0]).toMatchObject({
      action: 'findNotes',
      params: { query: '"deck:Mining \\"JP\\"" prop:ivl>=21' }
    });
    expect(calls[1]).toMatchObject({ action: 'notesInfo', params: { notes: [1, 2] } });
  });

  it('computes, caches and invalidates coverage when the words are read again', async () => {
    stubAnki(['猫']);
    await refreshKnownWords();
    expect(await bookCoverage(7, 50, words)).toEqual({ known: ['猫'], total: 3, share: 0.6 });
    expect(knownCoverage$.getValue()).toEqual({ 7: 0.6 });
    // Cached: the word list isn't loaded again.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await bookCoverage(7, 50)).toEqual({ share: 0.6 });

    await new Promise((resolve) => setTimeout(resolve, 2));
    stubAnki(['猫', '犬']);
    await refreshKnownWords();
    expect(knownCoverage$.getValue()).toEqual({});
    // Not cached any more: loaded from the server again.
    expect((await bookCoverage(7, 50))?.share).toBeCloseTo(0.9);
  });

  it('gives nothing while the feature is off', async () => {
    stubAnki(['猫']);
    await refreshKnownWords();
    ankiKnownWords$.next(false);
    expect(await bookCoverage(7, 50, words)).toBeUndefined();
  });

  it('keeps the old words quietly when Anki is closed', async () => {
    stubAnki(['猫']);
    const known = await refreshKnownWords();
    await (await readerDb()).put('known', { ...known, read: 0 }, 'words');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    expect((await refreshKnownWordsIfStale())?.words).toEqual(['猫']);
  });

  it('clears everything', async () => {
    stubAnki(['猫']);
    await refreshKnownWords();
    await bookCoverage(7, 50, words);
    await clearKnownWords();
    expect(await (await readerDb()).count('known')).toBe(0);
    expect(knownCoverage$.getValue()).toEqual({});
  });
});
