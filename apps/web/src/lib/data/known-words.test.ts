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
  cacheCoverage,
  cleanAnkiField,
  clearKnownWords,
  getKnownSet,
  knownCoverage$,
  loadCoverageCache,
  refreshKnownWords,
  refreshKnownWordsIfStale
} from '$lib/data/known-words';
import { readerDb } from '$lib/data/reader-db';
import { setWordMarks } from '$lib/data/word-marks';

const met = vi.hoisted(() => ({ signature: 'read 1', words: {} as Record<string, number> }));

vi.mock('$lib/data/extras-sync', () => ({
  pullKanji: async () => {},
  kanjiChanged: () => {},
  pullWordMarks: async () => {},
  wordMarksChanged: () => {}
}));
vi.mock('$lib/data/words-met', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/data/words-met')>()),
  getWordsMet: async () => ({ ...met })
}));

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
    expect(cleanAnkiField(' 漢字[かんじ]')).toEqual(['漢字']);
    expect(cleanAnkiField('<b>食べ[た]る</b>&nbsp;')).toEqual(['食べる']);
    expect(cleanAnkiField('<div>猫</div>')).toEqual(['猫']);
  });

  it("drops Yomitan's ruby and 〜, and splits several words", () => {
    expect(cleanAnkiField('<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>')).toEqual([
      '漢字'
    ]);
    expect(cleanAnkiField('食べる<br>食う')).toEqual(['食べる', '食う']);
    expect(cleanAnkiField('〜さん、～様・殿/君;氏')).toEqual(['さん', '様', '殿', '君', '氏']);
  });
});

describe('known words', () => {
  beforeEach(async () => {
    ankiKnownWords$.next(true);
    ankiKnownDeck$.next('Mining "JP"');
    ankiKnownField$.next('Expression');
    met.signature = 'read 1';
    met.words = {};
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

  it('reads 勉強する as also covering 勉強', async () => {
    stubAnki(['勉強する']);
    expect((await refreshKnownWords()).words).toEqual(['勉強する', '勉強']);
  });

  it('counts a word met without a reading by its form', async () => {
    ankiKnownWords$.next(false);
    met.words = { '呟く\tつぶやく': 8 };
    expect((await getKnownSet()).isKnown(['呟く', null, 3, 900])).toBe(true);
  });

  it('drops cached coverages of re-estimated books', async () => {
    ankiKnownWords$.next(false);
    met.words = { '猫\tねこ': 8 };
    let computedAt = 1;

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ books: { 7: { characters: 10, computedAt } } }))
      )
    );
    await bookCoverage(7, words, { computedAt: 1 }, await getKnownSet());
    await loadCoverageCache();
    expect(knownCoverage$.getValue()).toEqual({ 7: 0.6 });
    computedAt = 2;
    await loadCoverageCache();
    expect(knownCoverage$.getValue()).toEqual({});
  });

  it('counts words met 8 times and Anki words as known, cached per known set', async () => {
    stubAnki(['猫']);
    await refreshKnownWords();
    met.words = { '犬\tいぬ': 8, '宦官\tかんがん': 7 };
    expect(await bookCoverage(7, words, { computedAt: 1 }, await getKnownSet())).toMatchObject({
      share: 0.9,
      newWords: 1
    });
    expect(knownCoverage$.getValue()).toEqual({ 7: 0.9 });

    // Reading on changes the known words: the cached shares are dropped.
    met.signature = 'read 2';
    await loadCoverageCache();
    expect(knownCoverage$.getValue()).toEqual({});
  });

  it('matches Anki words and marks on the form or the lemma', async () => {
    stubAnki(['分かる']);
    await refreshKnownWords();
    await setWordMarks([['出来る', null]], 'known');
    const known = await getKnownSet();

    expect(
      (
        [
          ['わかる', 'わかる', 3, 50, '分かる'],
          ['できる', 'できる', 3, 40, '出来る'],
          ['わかる', 'わかる', 3, 50]
        ] as BookWord[]
      ).map(known.isKnown)
    ).toEqual([true, true, false]);
  });

  it('works without Anki', async () => {
    stubAnki(['猫']);
    await refreshKnownWords();
    ankiKnownWords$.next(false);
    met.words = { '犬\tいぬ': 8 };
    expect(
      (await bookCoverage(7, words, { computedAt: 1 }, await getKnownSet()))?.share
    ).toBeCloseTo(0.3);
  });

  it('counts marked words as known and changes the key when the marks change', async () => {
    ankiKnownWords$.next(false);
    const before = await getKnownSet();

    await setWordMarks([['猫', 'ねこ']], 'known');
    await setWordMarks([['宦官', null]], 'ignored');
    const marked = await getKnownSet();

    expect(marked.key).not.toBe(before.key);
    expect(words.map(marked.isKnown)).toEqual([true, false, true]);

    await setWordMarks([['猫', 'ねこ']], null);
    const unmarked = await getKnownSet();

    expect(unmarked.key).not.toBe(marked.key);
    expect(words.map(unmarked.isKnown)).toEqual([false, false, true]);
  });

  it("doesn't cache coverage from partial known words", async () => {
    met.signature = '';
    expect(await bookCoverage(7, words, { computedAt: 1 }, await getKnownSet())).toMatchObject({
      share: 0
    });
    expect(knownCoverage$.getValue()).toEqual({});
  });

  it('computes the missing coverages in the background', async () => {
    met.words = { '猫\tねこ': 8 };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('difficulty.json')) {
        return new Response(JSON.stringify({ books: { 7: { characters: 10, computedAt: 1 } } }));
      }
      if (url.endsWith('/words/7')) return new Response(JSON.stringify(words));
      return new Response('', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);
    await cacheCoverage([7, 8]);
    expect(knownCoverage$.getValue()).toEqual({ 7: 0.6 });
    await cacheCoverage([7, 8]);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/words/'))).toHaveLength(1);
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
    await bookCoverage(7, words, { computedAt: 1 }, await getKnownSet());
    await clearKnownWords();
    expect(await (await readerDb()).count('known')).toBe(0);
    expect(knownCoverage$.getValue()).toEqual({});
  });
});
