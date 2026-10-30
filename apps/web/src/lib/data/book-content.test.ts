/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { bookContent, mangaMarker, vnMarker } from '$lib/data/book-content';

// elementHtml comes from synced files (Drive, OneDrive, sync folders, the server), so the
// decoder is a trust boundary. The ways it can go wrong, written before the decoder:
// - '' (a placeholder) taken for a damaged or empty book
// - a marker followed by non-JSON or truncated JSON: JSON.parse throws and the caller breaks
// - a marker followed by valid JSON of the wrong shape (an object for manga, an array or
//   null for a VN, numbers in the page list): callers index or iterate it as if it were right
// - book HTML that contains a marker but doesn't start with it, taken for manga or a VN
//   (and then skipped by the sanitizer)
// - a VnInfo missing its encoding or file list, or with fields of the wrong type
//   (a Windows game without its folder or program)
// - a very large page list overflowing the stack (spread or recursion in the check)
// - anything above throwing instead of returning `invalid`
describe('bookContent', () => {
  const vn = (info: unknown) => ({ elementHtml: `${vnMarker}${JSON.stringify(info)}` });
  const manga = (pages: unknown) => ({ elementHtml: `${mangaMarker}${JSON.stringify(pages)}` });

  it('tells placeholders, books, manga and visual novels apart', () => {
    expect(bookContent({ elementHtml: '' })).toEqual({ kind: 'placeholder' });
    expect(bookContent({ elementHtml: '<p>本</p>' })).toEqual({ kind: 'book', html: '<p>本</p>' });
    expect(bookContent(manga(['1.jpg', '2.jpg']))).toEqual({
      kind: 'manga',
      pages: ['1.jpg', '2.jpg']
    });
    expect(bookContent(manga([]))).toEqual({ kind: 'manga', pages: [] });

    const windows = { encoding: 'sjis', files: [], engine: 'vnbox', folder: 'g', exe: 'g.exe' };

    expect(bookContent(vn(windows))).toEqual({ kind: 'vn', info: windows });
    expect(bookContent(vn({ encoding: 'utf8', files: ['0.txt'], base: '/vn/g/' }))).toEqual({
      kind: 'vn',
      info: { encoding: 'utf8', files: ['0.txt'], base: '/vn/g/' }
    });
  });

  it('keeps book HTML that only mentions a marker as a book', () => {
    for (const html of [`<p>${mangaMarker}["x"]</p>`, ` ${vnMarker}{}`, `\n${mangaMarker}[]`]) {
      expect(bookContent({ elementHtml: html })).toEqual({ kind: 'book', html });
    }
  });

  it('marks damaged manga and visual novel data invalid without throwing', () => {
    const damaged = [
      `${mangaMarker}`,
      `${mangaMarker}["1.jpg"`,
      `${mangaMarker}not json`,
      `${vnMarker}`,
      `${vnMarker}{"encoding":"sjis","files":[`,
      `${vnMarker}<p>本</p>`
    ];

    for (const elementHtml of damaged) {
      expect(bookContent({ elementHtml })).toEqual({ kind: 'invalid' });
    }
    for (const pages of [{}, null, 'a.jpg', [1], ['a.jpg', null], [['a.jpg']]]) {
      expect(bookContent(manga(pages))).toEqual({ kind: 'invalid' });
    }
    for (const info of [
      null,
      [],
      'sjis',
      {},
      { files: [] },
      { encoding: 'sjis' },
      { encoding: 'latin1', files: [] },
      { encoding: 'sjis', files: [1] },
      { encoding: 'sjis', files: 'a.txt' },
      { encoding: 'sjis', files: [], base: 1 },
      { encoding: 'sjis', files: [], engine: 'onscripter' },
      { encoding: 'sjis', files: [], engine: 'vnbox', exe: 'g.exe' },
      { encoding: 'sjis', files: [], engine: 'vnbox', folder: 'g' },
      { encoding: 'sjis', files: [], engine: 'vnbox', folder: 'g', exe: 'g.exe', discs: 'a' },
      { encoding: 'sjis', files: [], hook: 3 },
      { encoding: 'sjis', files: [], hookCleanup: 'yes' }
    ]) {
      expect(bookContent(vn(info))).toEqual({ kind: 'invalid' });
    }
  });

  it('checks a very large page list without overflowing the stack', () => {
    const pages = Array.from({ length: 300_000 }, (_, i) => `${i}.jpg`);

    expect(bookContent(manga(pages))).toEqual({ kind: 'manga', pages });
    expect(bookContent(manga([...pages, 0]))).toEqual({ kind: 'invalid' });
  });
});
