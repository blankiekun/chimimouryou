/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { BookWord } from '$lib/data/book-words';
import { readerDb } from '$lib/data/reader-db';
import { bookWordForms } from '$lib/data/word-marks';
import { getKnownHistory } from '$lib/data/words-history';
import { getWordsMet, saveReadProgress } from '$lib/data/words-met';

vi.mock('$lib/data/server-connect', () => ({ serverless: true, serverFetch: () => fetch('') }));
vi.mock('$lib/data/extras-sync', () => ({
  pullKanji: async () => {},
  kanjiChanged: () => {},
  pullWordMarks: async () => {},
  wordMarksChanged: () => {}
}));
vi.mock('$lib/data/storage/handler/server-handler', () => ({ ServerStorageHandler: {} }));

const words: BookWord[] = [
  ['猫', 'ねこ', 20, 100],
  ['宦官', 'かんがん', 1, 68872]
];

async function addEstimate(title: string) {
  const db = await readerDb();

  await db.put('estimates', {
    title,
    etag: 'a',
    difficulty: 10,
    characters: 1000,
    computedAt: 1
  } as never);
  await db.put('wordLists', { title, etag: 'a', words });
}

describe('words met in the standalone', () => {
  it('reads the local estimates and word lists, by title, without requests', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 500 }));

    vi.stubGlobal('fetch', fetchMock);
    const db = await readerDb();

    await addEstimate('猫の本');
    await addEstimate('犬の本');
    await db.put('kanji', { title: '猫の本', upTo: 500, counts: {} });

    expect((await getWordsMet()).words).toEqual({ '猫\tねこ': 10, '宦官\tかんがん': 0.5 });
    // A book without a kanji record counts from its saved progress.
    await saveReadProgress([{ title: '犬の本', progress: 0.5 }]);
    expect((await getWordsMet()).words['猫\tねこ']).toBe(20);
    expect(await db.get('known', 'list:猫の本')).toBeUndefined();

    // Reading on redoes the totals.
    await db.put('kanji', { title: '猫の本', upTo: 1000, counts: {} });
    expect((await getWordsMet()).words['猫\tねこ']).toBe(30);

    const points = await getKnownHistory([
      { title: '猫の本', dateKey: '2026-10-01', charactersRead: 500 }
    ]);

    expect(points).toEqual([{ dateKey: '2026-10-01', known: 1 }]);
    // The reader's "Mark known" reads the local list too.
    expect(await bookWordForms('猫の本')).toEqual(new Set(['猫', '宦官']));
    expect(await bookWordForms('Not estimated')).toEqual(new Set());
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
