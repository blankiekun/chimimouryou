/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildSearchIndex, chapterLabelAt, searchBook, searchIndexCache } from './book-search';
import { getTextSegments, rangeForText } from './text-positions';
import type { Section } from '$lib/data/database/books-db/versions/v3/books-db-v3';

const html =
  '<p>彼は<ruby>猫<rp>(</rp><rt>ねこ</rt><rp>)</rp></ruby>が好きだ。</p><p>カタカナのネコもいる。ＡＢＣ</p>';
const sections = [
  { reference: 'a', label: 'One', startCharacter: 0 },
  { reference: 'b', label: 'Two', startCharacter: 7 }
] as Section[];

describe('searchBook', () => {
  const index = buildSearchIndex(html);

  it('indexes paragraphs without furigana', () => {
    expect(index.paragraphs.map((p) => p.text)).toEqual([
      '彼は猫が好きだ。',
      'カタカナのネコもいる。ＡＢＣ'
    ]);
    expect(index.paragraphs[1].startCount).toBe(7);
  });

  it('finds plain text with character counts', () => {
    const [result] = searchBook(index, '猫', { ignoreKana: false, regex: false }, sections);

    expect(result).toMatchObject({ start: 2, end: 3, match: '猫', chapter: 'One' });
  });

  it('folds kana, width and case', () => {
    expect(searchBook(index, 'ねこ', { ignoreKana: true, regex: false }, sections)).toHaveLength(1);
    expect(searchBook(index, 'ねこ', { ignoreKana: false, regex: false }, sections)).toHaveLength(
      0
    );
    expect(searchBook(index, 'abc', { ignoreKana: false, regex: false }, sections)[0].chapter).toBe(
      'Two'
    );
  });

  it('supports regular expressions and survives empty matches', () => {
    expect(searchBook(index, '好き.', { ignoreKana: false, regex: true }, sections)[0].match).toBe(
      '好きだ'
    );
    expect(() =>
      searchBook(index, 'x*', { ignoreKana: false, regex: true }, sections)
    ).not.toThrow();
    expect(() => searchBook(index, '(', { ignoreKana: false, regex: true }, sections)).toThrow(
      SyntaxError
    );
  });
});

describe('search highlight range', () => {
  it('covers matches that counts skip, like punctuation', () => {
    const div = document.createElement('div');

    div.innerHTML = html;
    document.body.replaceChildren(div);

    const segments = getTextSegments(div);
    const rangeOf = (query: string) =>
      searchBook(buildSearchIndex(html), query, { ignoreKana: false, regex: false }, sections).map(
        (r) => rangeForText(document, segments, r.start, r.skip, r.match.length)?.toString()
      );

    expect(rangeOf('。')).toEqual(['。', '。']);
    expect(rangeOf('猫が')).toEqual(['猫(ねこ)が']); // the range spans the ruby
    expect(rangeOf('。ＡＢ')).toEqual(['。ＡＢ']);
  });
});

describe('chapterLabelAt', () => {
  it('uses the last section starting at or before the count', () => {
    expect(chapterLabelAt(sections, 6)).toBe('One');
    expect(chapterLabelAt(sections, 7)).toBe('Two');
  });
});

describe('searchIndexCache', () => {
  it('builds the index once per HTML', async () => {
    vi.useFakeTimers();

    const indexOf = searchIndexCache();
    const first = indexOf(html);

    expect(indexOf(html)).toBe(first);
    vi.runAllTimers();
    expect((await first).paragraphs).toHaveLength(2);

    const other = indexOf('<p>別</p>');

    expect(other).not.toBe(first);
    vi.runAllTimers();
    expect((await other).paragraphs).toHaveLength(1);
    vi.useRealTimers();
  });
});
