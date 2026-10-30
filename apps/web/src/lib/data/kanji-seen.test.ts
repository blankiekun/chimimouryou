/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';

import { recordKanjiText } from '$lib/data/kanji-seen';
import { readerDb } from '$lib/data/reader-db';

describe('recordKanjiText', () => {
  it('adds the kanji of each piece of text read', async () => {
    await recordKanjiText('ノベル', '吾輩は猫', 4);
    await recordKanjiText('ノベル', '猫である', 8);

    expect(await (await readerDb()).get('kanji', 'ノベル')).toEqual({
      title: 'ノベル',
      upTo: 8,
      counts: { 吾: 1, 輩: 1, 猫: 2 },
      modified: expect.any(Number)
    });
  });
});
