/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/data/storage/handler/server-handler', () => ({ ServerStorageHandler: {} }));
vi.mock('$lib/data/store', () => ({
  database: { getData: vi.fn(async () => ({ elementHtml: '<p>猫と犬</p>' })) }
}));

import { bookKanjiCount, deleteBookKanji, uniqueKanjiInHtml } from '$lib/data/book-kanji';
import { database } from '$lib/data/store';

describe('uniqueKanjiInHtml', () => {
  it('counts each kanji once and leaves furigana out', () => {
    expect(
      uniqueKanjiInHtml(
        '<p><ruby>吾輩<rp>(</rp><rt>我輩</rt><rp>)</rp></ruby>は猫である。<ruby>猫<rt>ねこ</rt></ruby></p>'
      )
    ).toBe(3);
  });
});

describe('bookKanjiCount', () => {
  it('counts the stored book once and recounts when its length changes', async () => {
    expect(await bookKanjiCount(1, 'ノベル', 3)).toBe(2);
    expect(await bookKanjiCount(1, 'ノベル', 3)).toBe(2);
    expect(database.getData).toHaveBeenCalledTimes(1);

    expect(await bookKanjiCount(1, 'ノベル', 4)).toBe(2);
    expect(database.getData).toHaveBeenCalledTimes(2);

    await deleteBookKanji('ノベル');
    await bookKanjiCount(1, 'ノベル', 4);
    expect(database.getData).toHaveBeenCalledTimes(3);
  });
});
