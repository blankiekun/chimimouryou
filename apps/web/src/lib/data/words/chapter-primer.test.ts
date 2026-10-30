/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { chapterPrimer } from '$lib/data/words/chapter-primer';
import type { ReadingsFile } from '$lib/data/words/generated-furigana';

// Words 0 (先生), 1 (本), 2 (電報); one occurrence every 2 characters.
const words: [string, string | null][] = [
  ['先生', 'せんせい'],
  ['本', 'ほん'],
  ['電報', 'でんぽう']
];
const order = [0, 0, 1, 0, 2, 2, 2, 2, 1, 1, 1, 0];
const readings: ReadingsFile = {
  characters: 24,
  words,
  glosses: [],
  occ: order.flatMap((word, i) => [i ? 2 : 0, word, -1]),
  len: order.map(() => 1)
};
const sections = [
  { reference: 'a', charactersWeight: 1, startCharacter: 0, characters: 8 },
  { reference: 'b', charactersWeight: 1, startCharacter: 8, characters: 8 },
  { reference: 'b2', charactersWeight: 1, startCharacter: 16, characters: 8, parentChapter: 'b' }
];

describe('chapterPrimer', () => {
  it('counts unknown words per chapter, continuations included, keeping 3+', () => {
    expect(chapterPrimer(readings, [true, true, true], sections)).toEqual({
      a: [{ form: '先生', reading: 'せんせい', count: 3 }],
      b: [
        { form: '電報', reading: 'でんぽう', count: 4 },
        { form: '本', reading: 'ほん', count: 3 }
      ]
    });
  });

  it('leaves out known words and chapters without a range', () => {
    expect(
      chapterPrimer(readings, [true, false, false], [{ reference: 'a', charactersWeight: 1 }])
    ).toEqual({});
    expect(chapterPrimer(readings, [false, true, false], sections)).toEqual({
      b: [{ form: '本', reading: 'ほん', count: 3 }]
    });
  });
});
