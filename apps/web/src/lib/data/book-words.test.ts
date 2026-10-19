/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import {
  newWords,
  wordCoverage,
  wordsCsv,
  wordsFileName,
  wordsPerBook,
  wordsToStudy,
  type BookWord
} from './book-words';

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

describe('newWords', () => {
  it('leaves known words out, frequent in the book × rare in general first', () => {
    const study: BookWord[] = [
      ['後宮', 'こうきゅう', 100, 1000],
      ['宦官', 'かんがん', 70, 100000],
      ['猫', 'ねこ', 500, 40000],
      ['小姐', 'しゃおじぇ', 50, null]
    ];

    // 70 × 5 = 350, 100 × 3 = 300, 50 × log10(100000) = 250
    expect(newWords(study, ([form]) => form === '猫').map(([form]) => form)).toEqual([
      '宦官',
      '後宮',
      '小姐'
    ]);
  });
});

describe('wordCoverage', () => {
  const words: BookWord[] = [
    ['猫', 'ねこ', 6, 400],
    ['は', null, 50, 1],
    ['8', null, 9, null],
    ['犬', 'いぬ', 3, 500],
    ['宦官', 'かんがん', 1, 68872]
  ];
  const isKnown = ([form]: BookWord) => form === '猫' || form === 'は';

  it('weighs known words by occurrences, without particles and noise', () => {
    expect(wordCoverage(words, isKnown)).toEqual({
      words: 3,
      newWords: 2,
      share: 0.6,
      complete: true
    });
  });

  it("counts the words past the list's cap as unknown when the estimate has totals", () => {
    expect(wordCoverage(words, isKnown, { uniqueWords: 5, tokens: 20 })).toEqual({
      words: 5,
      newWords: 4,
      share: 0.3,
      complete: true
    });
  });

  it('counts only the listed words of a cut list without totals', () => {
    const full: BookWord[] = Array.from({ length: wordsPerBook }, (_, i) => [
      `語${i}`,
      null,
      1,
      100
    ]);

    expect(wordCoverage(full, () => true)).toMatchObject({ share: 1, complete: false });
  });

  it('has nothing to say without words', () => {
    expect(wordCoverage([['は', null, 5, 1]], isKnown)).toBeUndefined();
  });
});
