/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { wordsCsv, wordsFileName, wordsToStudy, type BookWord } from './book-words';

describe('wordsToStudy', () => {
  it('keeps words rarer than the 95% coverage rank, in book order', () => {
    const words: BookWord[] = [
      ['する', 'する', 900, 10],
      ['後宮', 'こうきゅう', 104, 44745],
      ['宦官', 'かんがん', 89, 68872],
      ['女官', 'じょかん', 59, 30000],
      ['小姐', 'しゃおじぇ', 19, null]
    ];

    expect(wordsToStudy(words, 31510).map(([form]) => form)).toEqual(['後宮', '宦官', '小姐']);
  });

  it('drops numbers, lone kana and unlisted kana-only tokens', () => {
    const words: BookWord[] = [
      ['だ', 'だ', 39, 129412],
      ['一', 'ひと', 28, null],
      ['8', null, 12, null],
      ['１００', null, 8, null],
      ['トゥアン', 'とぅあん', 13, 171994],
      ['えっと', null, 5, null]
    ];

    expect(wordsToStudy(words, 12618).map(([form]) => form)).toEqual(['トゥアン']);
  });
});

describe('wordsCsv', () => {
  it('has a BOM, a header and quotes fields with quotes or commas', () => {
    expect(
      wordsCsv([
        ['後宮', 'こうきゅう', 104, 44745],
        ['a,b', null, 2, null],
        ['say "hi"', 'x', 1, 5]
      ])
    ).toBe(
      '\uFEFFword,reading,count in book,frequency rank\r\n' +
        '後宮,こうきゅう,104,44745\r\n' +
        '"a,b",,2,\r\n' +
        '"say ""hi""",x,1,5\r\n'
    );
  });
});

describe('wordsFileName', () => {
  it('replaces characters file systems refuse', () => {
    expect(wordsFileName('Re:ゼロ <1>/2?')).toBe('Re_ゼロ _1__2_ words.csv');
  });

  it('falls back when nothing is left', () => {
    expect(wordsFileName(' .. ')).toBe('book words.csv');
  });
});
