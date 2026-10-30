/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { BookWord } from '$lib/data/words/book-words';
import type { ReadingsFile } from '$lib/data/words/generated-furigana';
import { spansWithin, unknownSpans } from '$lib/data/words/unknown-words';

// 先生が本を食べた。三本 一
const readings: ReadingsFile = {
  characters: 20,
  words: [
    ['先生', 'せんせい'],
    ['本', 'ほん'],
    ['食べる', 'たべる'],
    ['三本', 'さんぼん'],
    ['三', 'さん'],
    ['一', 'いち']
  ],
  glosses: [[[0, 2, '先生', 'せんせい']], [[0, 1, '本', 'ほん']], [[0, 1, '食', 'た']]],
  occ: [0, 0, 0, 3, 1, 1, 2, 2, 2, 4, 3, -1, 0, 4, -1, 3, 5, -1]
};
const list: BookWord[] = [
  ['先生', 'せんせい', 3, 500, '先生'],
  ['本', 'ほん', 2, 100, '本'],
  ['食べる', 'たべる', 1, 300, '食べる']
];
const nobody = { met: () => false, anki: () => false, placed: () => false };

describe('unknownSpans', () => {
  it('spans each unknown occurrence, counter spans before their tokens, without noise', () => {
    expect(unknownSpans(readings, list, nobody, {})).toEqual([
      [0, 2],
      [3, 4],
      [5, 6],
      [9, 11]
    ]);
  });

  it("takes the file's surface lengths, the conjugated word whole", () => {
    expect(unknownSpans({ ...readings, len: [2, 1, 3, 2, 1, 1] }, list, nobody, {})).toEqual([
      [0, 2],
      [3, 4],
      [5, 8],
      [9, 11]
    ]);
  });

  it('leaves out known words: met, Anki by lemma, placement rank, marks', () => {
    const known = {
      met: ([form]: BookWord) => form === '先生',
      anki: (word: BookWord) => word[4] === '食べる',
      placed: (word: BookWord) => word[3] !== null && word[3] <= 100
    };

    expect(unknownSpans(readings, list, known, {})).toEqual([[9, 11]]);
    expect(
      unknownSpans(readings, list, nobody, {
        '三本\t': { status: 'known', modified: 1 },
        '本\t': { status: 'ignored', modified: 1 }
      })
    ).toEqual([
      [0, 2],
      [5, 6]
    ]);
  });
});

describe('spansWithin', () => {
  it('finds the spans overlapping a range', () => {
    const spans: [number, number][] = [
      [0, 2],
      [3, 4],
      [5, 6],
      [9, 11]
    ];

    expect(spansWithin(spans, 1, 5)).toEqual([
      [0, 2],
      [3, 4]
    ]);
    expect(spansWithin(spans, 11, 20)).toEqual([]);
  });
});
