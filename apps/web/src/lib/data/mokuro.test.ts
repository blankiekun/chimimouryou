/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { blockStyle, pagesText, type MokuroPage, type MokuroText } from './mokuro';

const page = (name: string): MokuroPage => ({ name, width: 800, height: 1200, blocks: [] });
const text = (...names: string[]): MokuroText => ({
  source: 'upload',
  mokuro: '0.2.5',
  created: 0,
  pages: names.map(page)
});

describe('pagesText', () => {
  it('matches pages by their path in the CBZ', () => {
    expect(pagesText(text('a/2.jpg', 'a/1.jpg'), ['a/1.jpg', 'a/2.jpg', 'a/3.jpg'])).toEqual([
      page('a/1.jpg'),
      page('a/2.jpg'),
      undefined
    ]);
  });

  it('matches by file name when the folders differ', () => {
    expect(pagesText(text('Vol 1/Images/1.jpg'), ['Images/1.jpg', 'Images/2.jpg'])).toEqual([
      page('Vol 1/Images/1.jpg'),
      undefined
    ]);
  });

  it('falls back to the order when names repeat and the counts match', () => {
    expect(pagesText(text('x/1.jpg', 'y/1.jpg'), ['p1.jpg', 'p2.jpg'])).toEqual([
      page('x/1.jpg'),
      page('y/1.jpg')
    ]);
  });
});

describe('blockStyle', () => {
  it('places a block in percent of its page and scales its font', () => {
    const block = {
      box: [80, 120, 160, 360] as [number, number, number, number],
      vertical: true,
      fontSize: 20,
      lines: []
    };

    expect(blockStyle(block, page('1.jpg'), 0.5)).toBe(
      'left: 10%; top: 10%;width: 10%; height: 20%;font-size: 10px;'
    );
  });
});
