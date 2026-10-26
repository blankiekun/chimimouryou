/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import {
  decodeText,
  detectorInput,
  inkLines,
  nextToken,
  ocrInput,
  splitText,
  textBoxes,
  toBlock
} from './manga-ocr-text';

/** A grey crop (255 = paper) with dark columns at the given x ranges and y ranges */
function crop(width: number, height: number, marks: [number, number, number, number][]) {
  const pixels = new Uint8Array(width * height).fill(255);

  for (const [x1, x2, y1, y2] of marks) {
    for (let y = y1; y < y2; y += 1) for (let x = x1; x < x2; x += 1) pixels[y * width + x] = 0;
  }

  return pixels;
}

describe('model inputs', () => {
  it('lays the detector input out as channels, 0-1', () => {
    expect(
      Array.from(detectorInput(new Uint8ClampedArray([255, 0, 128, 255, 0, 255, 0, 255])))
    ).toEqual([1, 0, 0, 1, 128 / 255, 0].map(Math.fround));
  });

  it('greys the OCR crop into three channels, -1 to 1', () => {
    const input = ocrInput(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]));

    expect(Array.from(input)).toEqual([1, -1, 1, -1, 1, -1]);
  });
});

describe('textBoxes', () => {
  it('keeps confident text boxes, not bare bubbles, clamped to the page', () => {
    expect(
      textBoxes(
        [0.9, 0.9, 0.3, 0.8, 0.95],
        [1n, 0n, 2n, 2n, 1n],
        [10, 20, 50, 80, 0, 0, 100, 100, 0, 0, 9, 9, -5, 10, 40, 1300, 1, 1, 3, 3],
        827,
        1170
      )
    ).toEqual([
      [10, 20, 50, 80],
      [0, 10, 40, 1170]
    ]);
  });
});

describe('decoding', () => {
  it('takes the arg max of the last step', () => {
    expect(nextToken([9, 0, 0, 0, 1, 7], 2, 3)).toBe(2);
  });

  it('post-processes as manga-ocr: no spaces, dots and full width', () => {
    const vocab = [
      '[PAD]',
      '[UNK]',
      '[CLS]',
      '[SEP]',
      '[MASK]',
      'す',
      '##ごい',
      ' ',
      '!',
      '…',
      '1'
    ];

    expect(decodeText([2, 5, 6, 7, 8, 8, 1, 3], vocab)).toBe('すごい！！');
    expect(decodeText([5, 9, 10], vocab)).toBe('す．．．１');
  });
});

describe('inkLines', () => {
  it('finds a vertical block’s columns right to left, without furigana', () => {
    // Two columns 10 px wide, the right one shorter; a 3 px furigana run beside the left one.
    const pixels = crop(40, 100, [
      [2, 12, 0, 100],
      [14, 17, 10, 20],
      [25, 35, 0, 50]
    ]);

    expect(inkLines(pixels, 40, 100, true)).toEqual([
      { from: 25, to: 35, length: 50 },
      { from: 2, to: 12, length: 100 }
    ]);
  });

  it('finds a horizontal block’s rows top to bottom', () => {
    const pixels = crop(100, 30, [
      [0, 80, 2, 12],
      [0, 40, 16, 26]
    ]);

    expect(inkLines(pixels, 100, 30, false).map(({ length }) => length)).toEqual([80, 40]);
  });

  it('finds none in light text on dark', () => {
    expect(inkLines(new Uint8Array(100).fill(200), 10, 10, true)).toEqual([]);
  });
});

describe('splitText', () => {
  it('splits by ink length', () => {
    expect(splitText('一二三四五六', [2, 1])).toEqual(['一二三四', '五六']);
  });

  it('never starts a line with closing punctuation or a small kana', () => {
    expect(splitText('あいう。えお', [1, 1])).toEqual(['あいう。', 'えお']);
    expect(splitText('ちょっと', [1, 1])).toEqual(['ちょっ', 'と']);
  });

  it('keeps one line when there is nothing to split over', () => {
    expect(splitText('あい', [])).toEqual(['あい']);
    expect(splitText('あい', [5])).toEqual(['あい']);
    expect(splitText('あ', [1, 1, 1])).toEqual(['あ']);
  });

  it('gives every line a character', () => {
    expect(splitText('あいう', [10, 0.1, 0.1])).toEqual(['あ', 'い', 'う']);
  });
});

describe('toBlock', () => {
  it('makes a vertical block with one line per column and a font that fits', () => {
    expect(
      toBlock([100, 50, 140, 250], 'かといってナナに', [{ length: 200 }, { length: 100 }])
    ).toEqual({
      box: [100, 50, 140, 250],
      vertical: true,
      fontSize: 16,
      lines: ['かといって', 'ナナに']
    });
  });

  it('fits the font to the longest line', () => {
    expect(toBlock([0, 0, 40, 60], 'あいうえおかきくけこ', []).fontSize).toBe(6);
  });
});
