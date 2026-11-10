/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  blockStyle,
  convertMokuro,
  importMokuroFiles,
  keptMokuro,
  localMokuroChanged$,
  mokuroHtml,
  mokuroPlainText,
  pagesText,
  readMokuroFile,
  removeLocalMokuro,
  saveLocalMokuro,
  maxMangaSearchResults,
  pageOfSentence,
  searchMangaText,
  type MokuroPage,
  type MokuroText
} from './mokuro';

// jsdom's File has no text().
const file = (name: string, body: string) =>
  Object.assign(new File([body], name), { text: async () => body });

/** The shape of mokuro's own test output (tests/data/expected_results/test0/vol1.mokuro) */
const mokuroFile = {
  version: '0.2.0-beta.6',
  title: 'test0',
  volume: 'vol1',
  pages: [
    {
      version: '0.2.0-beta.6',
      img_width: 827,
      img_height: 1170,
      img_path: './vol1\\000a.jpg',
      blocks: [
        {
          box: [37, 0, 863.04, 235],
          vertical: false,
          font_size: 137.5,
          lines_coords: [],
          lines: ['ダイアリー・', 'うちの猫ず日記']
        }
      ]
    },
    { img_width: 827, img_height: 1170, img_path: 'vol1/000b.jpg' }
  ]
};

describe('convertMokuro', () => {
  it('keeps what the reader needs, as service.py does', () => {
    const text = convertMokuro(mokuroFile, 'upload');

    expect(text).toEqual({
      source: 'upload',
      mokuro: '0.2.0-beta.6',
      created: expect.any(Number),
      pages: [
        {
          name: 'vol1/000a.jpg',
          width: 827,
          height: 1170,
          blocks: [
            {
              box: [37, 0, 863, 235],
              vertical: false,
              fontSize: 137.5,
              lines: ['ダイアリー・', 'うちの猫ず日記']
            }
          ]
        },
        { name: 'vol1/000b.jpg', width: 827, height: 1170, blocks: [] }
      ]
    });
  });

  it.each([
    ['not an object', []],
    ['no pages', { pages: [] }],
    ['pages not a list', { pages: {} }]
  ])('rejects %s', (_, value) => {
    expect(() => convertMokuro(value, 'upload')).toThrow('Not a .mokuro file (no pages)');
  });

  const withBlock = (block: object, page: object = {}) => ({
    pages: [{ img_width: 10, img_height: 10, img_path: 'a.jpg', blocks: [block], ...page }]
  });

  it.each([
    ['a size that is no number', withBlock({ box: [0, 0, 1, 1], lines: [] }, { img_width: '10' })],
    ['a boolean size', withBlock({ box: [0, 0, 1, 1], lines: [] }, { img_height: true })],
    ['a zero size', withBlock({ box: [0, 0, 1, 1], lines: [] }, { img_width: 0 })],
    ['no path', withBlock({ box: [0, 0, 1, 1], lines: [] }, { img_path: 3 })],
    ['a short box', withBlock({ box: [0, 0, 1], lines: [] })],
    ['a box of text', withBlock({ box: '0001', lines: [] })],
    ['lines not text', withBlock({ box: [0, 0, 1, 1], lines: [1] })],
    ['too long a line', withBlock({ box: [0, 0, 1, 1], lines: ['あ'.repeat(2001)] })],
    ['too many lines', withBlock({ box: [0, 0, 1, 1], lines: Array(101).fill('') })],
    ['no lines', withBlock({ box: [0, 0, 1, 1] })]
  ])('rejects a page with %s', (_, value) => {
    expect(() => convertMokuro(value, 'upload')).toThrow(
      'Not a .mokuro file (a page is malformed)'
    );
  });

  it('reads files, refusing ones that are not JSON', async () => {
    await expect(readMokuroFile(file('a.mokuro', '{'))).rejects.toThrow('not JSON');
    expect((await readMokuroFile(file('a.mokuro', JSON.stringify(mokuroFile)))).pages).toHaveLength(
      2
    );
  });
});

describe('browser-stored text', () => {
  it('is kept per title, announced, and removed', async () => {
    const changed: string[] = [];
    const subscription = localMokuroChanged$.subscribe((title) => changed.push(title));
    const text = convertMokuro(mokuroFile, 'browser');

    await saveLocalMokuro('猫日記 1', text);
    expect(await keptMokuro('猫日記 1')).toEqual({ ...text, title: '猫日記 1' });
    expect(await keptMokuro('猫日記 2')).toBeUndefined();
    await removeLocalMokuro('猫日記 1');
    expect(await keptMokuro('猫日記 1')).toBeUndefined();
    expect(changed).toEqual(['猫日記 1', '猫日記 1']);
    subscription.unsubscribe();
  });

  it('imports a .mokuro dropped beside its CBZ, only for the books imported', async () => {
    const error = await importMokuroFiles(
      [
        file('vol1.mokuro', JSON.stringify(mokuroFile)),
        file('vol2.mokuro', JSON.stringify(mokuroFile)),
        file('vol3.mokuro', '{"pages": []}')
      ],
      ['vol1', 'vol3']
    );

    expect((await keptMokuro('vol1'))?.pages).toHaveLength(2);
    expect(await keptMokuro('vol2')).toBeUndefined();
    expect(error).toBe('vol3.mokuro: Not a .mokuro file (no pages)');
  });
});

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

describe('mokuroPlainText', () => {
  const block = (...lines: string[]) => ({
    box: [0, 0, 1, 1] as [number, number, number, number],
    vertical: true,
    fontSize: 20,
    lines
  });
  const volume: MokuroText = {
    ...text(),
    pages: [
      { ...page('1.jpg'), blocks: [block('吾輩は', '猫である。'), block(' ')] },
      { ...page('2.jpg'), blocks: [block('<名前>&')] }
    ]
  };

  it('gives a line per bubble, as the difficulty service reads it', () => {
    expect(mokuroPlainText(volume)).toBe('吾輩は猫である。\n<名前>&');
  });

  it('escapes the text as HTML for the analysis tools', () => {
    expect(mokuroHtml(volume)).toBe('<p>吾輩は猫である。</p><p>&lt;名前&gt;&amp;</p>');
  });
});

describe('searchMangaText', () => {
  const block = (...lines: string[]) => ({
    box: [0, 0, 1, 1] as [number, number, number, number],
    vertical: true,
    fontSize: 20,
    lines
  });
  const withBlocks = (...blocks: string[][]): MokuroPage => ({
    ...page('p.jpg'),
    blocks: blocks.map((lines) => block(...lines))
  });

  it('finds a query in a block, with its page and text', () => {
    const pages = [withBlocks(['おはよう']), withBlocks(['吾輩は猫である'], ['名前はまだ無い'])];

    expect(searchMangaText(pages, '猫')).toEqual([{ page: 1, text: '吾輩は猫である' }]);
  });

  it('finds a query across the lines of one block', () => {
    expect(searchMangaText([withBlocks(['吾輩は', '猫である'])], 'は猫')).toEqual([
      { page: 0, text: '吾輩は猫である' }
    ]);
  });

  it('does not match across blocks', () => {
    expect(searchMangaText([withBlocks(['吾輩は'], ['猫である'])], 'は猫')).toEqual([]);
  });

  it('ignores kana type and full-width letters', () => {
    const pages = [withBlocks(['ネコがいる']), withBlocks(['abc の本'])];

    expect(searchMangaText(pages, 'ねこ')).toEqual([{ page: 0, text: 'ネコがいる' }]);
    expect(searchMangaText(pages, 'ＡＢＣ')).toEqual([{ page: 1, text: 'abc の本' }]);
  });

  it('gives nothing for an empty or blank query', () => {
    const pages = [withBlocks(['猫'])];

    expect(searchMangaText(pages, '')).toEqual([]);
    expect(searchMangaText(pages, ' 　')).toEqual([]);
  });

  it('skips pages without text and keeps the page indexes', () => {
    const pages = [undefined, withBlocks(['犬']), undefined, withBlocks(['猫'])];

    expect(searchMangaText(pages, '猫')).toEqual([{ page: 3, text: '猫' }]);
  });

  it('stops at the result limit', () => {
    const pages = Array.from({ length: maxMangaSearchResults + 50 }, () => withBlocks(['猫']));

    expect(searchMangaText(pages, '猫')).toHaveLength(maxMangaSearchResults);
  });

  it('takes regex characters as plain text', () => {
    const pages = [withBlocks(['(笑)']), withBlocks(['笑い'])];

    expect(searchMangaText(pages, '(笑')).toEqual([{ page: 0, text: '(笑)' }]);
    expect(searchMangaText(pages, '.')).toEqual([]);
  });
});

describe('pageOfSentence', () => {
  const withLines = (...lines: string[]): MokuroPage => ({
    ...page('p.jpg'),
    blocks: [{ box: [0, 0, 1, 1], vertical: true, fontSize: 20, lines }]
  });
  const pages = [withLines('おはよう'), withLines('こんにちは'), withLines('吾輩は', '猫である')];

  it('gives the shown page the sentence is on', () => {
    expect(pageOfSentence(pages, [0, 1], 'こんにちは')).toBe(1);
  });

  it('finds a sentence across the lines of a block', () => {
    expect(pageOfSentence(pages, [1, 2], '吾輩は猫である')).toBe(2);
  });

  it('ignores whitespace on both sides', () => {
    expect(pageOfSentence(pages, [1, 2], '吾輩は 猫\nである')).toBe(2);
    expect(pageOfSentence([withLines('吾輩は ', '猫'), withLines('犬')], [1, 0], '吾輩は猫')).toBe(
      0
    );
  });

  it('finds a sentence longer than the bubble', () => {
    expect(pageOfSentence(pages, [0, 1], '「こんにちは」と言った。')).toBe(1);
  });

  it('gives the first shown page when no page has it, or it is empty', () => {
    expect(pageOfSentence(pages, [1, 2], 'さようなら')).toBe(1);
    expect(pageOfSentence(pages, [2, 1], '')).toBe(2);
  });

  it('skips shown pages without text', () => {
    expect(pageOfSentence([undefined, withLines('猫')], [0, 1], '猫')).toBe(1);
  });
});
