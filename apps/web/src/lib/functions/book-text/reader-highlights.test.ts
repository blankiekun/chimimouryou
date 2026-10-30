/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Highlight } from '$lib/data/reader/annotations';
import {
  getTextWithoutFurigana,
  highlightAt,
  isOnScreen,
  paintHighlights,
  selectionPassage
} from './reader-highlights';

function content(html: string) {
  const div = document.createElement('div');

  div.innerHTML = html;
  document.body.replaceChildren(div);

  return div;
}

const highlight = (id: string, start: number, end: number): Highlight => ({
  id,
  start,
  end,
  text: '',
  note: '',
  color: 'yellow',
  chapter: '',
  created: 0,
  modified: 0
});

afterEach(() => {
  delete (document as any).caretRangeFromPoint;
});

describe('getTextWithoutFurigana', () => {
  it('leaves out rt and rp and folds whitespace', () => {
    const div = content('<p>  <ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>を\n 読む </p>');
    const range = document.createRange();

    range.selectNodeContents(div);
    expect(getTextWithoutFurigana(range)).toBe('漢字を 読む');
  });
});

describe('paintHighlights', () => {
  it('returns ranges for the highlights and the reading line on screen', () => {
    const div = content('<p>あいうえお</p><p>かきくけこ</p>');
    const { highlightRanges, readingRange } = paintHighlights(
      div,
      100,
      [highlight('a', 101, 103), highlight('off', 0, 50), highlight('b', 108, 200)],
      undefined,
      { start: 105, end: 107 },
      []
    );

    expect(highlightRanges.map(({ highlight: h }) => h.id)).toEqual(['a', 'b']);
    expect(highlightRanges[0].range.toString()).toBe('いう');
    // Clipped to the rendered text.
    expect(highlightRanges[1].range.toString()).toBe('けこ');
    expect(readingRange?.toString()).toBe('かき');
  });

  it('has no reading range when the line is not rendered', () => {
    const div = content('<p>あいうえお</p>');

    expect(paintHighlights(div, 0, [], undefined, { start: 10, end: 12 }, []).readingRange).toBe(
      undefined
    );
  });
});

describe('highlightAt', () => {
  it('finds the highlight under the caret', () => {
    const div = content('<p>あいうえお</p>');
    const { highlightRanges } = paintHighlights(
      div,
      0,
      [highlight('a', 1, 3)],
      undefined,
      undefined,
      []
    );
    const text = div.querySelector('p')!.firstChild!;
    let offset = 2;

    (document as any).caretRangeFromPoint = () => {
      const range = document.createRange();

      range.setStart(text, offset);
      return range;
    };

    expect(highlightAt(highlightRanges, 0, 0)?.id).toBe('a');
    offset = 4;
    expect(highlightAt(highlightRanges, 0, 0)).toBe(undefined);
  });

  it('asks for no caret without highlights', () => {
    const caret = vi.fn();

    (document as any).caretRangeFromPoint = caret;
    expect(highlightAt([], 0, 0)).toBe(undefined);
    expect(caret).not.toHaveBeenCalled();
  });
});

describe('selectionPassage', () => {
  it('gives the text before, the selection and after, with its count', () => {
    const div = content('<p>あいう<ruby>漢<rt>かん</rt></ruby>えお</p>');
    const text = div.querySelector('p')!.firstChild!;
    const range = document.createRange();

    range.setStart(text, 1);
    range.setEnd(text, 2);

    expect(selectionPassage(div, range, 'Book', 1, 10)).toEqual({
      bookTitle: 'Book',
      before: 'あ',
      selection: 'い',
      after: 'う漢えお',
      start: 11
    });
    expect(selectionPassage(div, range, 'Book', 2000, undefined).start).toBe(undefined);
  });
});

describe('isOnScreen', () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

  it('needs a box inside the book width and window height', () => {
    expect(isOnScreen(rect(10, 10, 20, 20), 100, 100)).toBe(true);
    expect(isOnScreen(undefined, 100, 100)).toBe(false);
    expect(isOnScreen(rect(10, 10, 0, 0), 100, 100)).toBe(false);
    expect(isOnScreen(rect(100, 10, 20, 20), 100, 100)).toBe(false);
    expect(isOnScreen(rect(10, 90, 20, 20), 100, 100)).toBe(false);
    expect(isOnScreen(rect(-30, 10, 20, 20), 100, 100)).toBe(false);
  });
});
