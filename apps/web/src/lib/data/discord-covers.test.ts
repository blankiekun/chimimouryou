/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canSearch,
  coverQuery,
  exactMatch,
  findCover,
  localCover,
  matchKey
} from './discord-covers';
import type { MetadataCandidate } from './book-metadata';

const reZero: MetadataCandidate = {
  source: 'anilist',
  url: 'https://anilist.co/manga/85737',
  title: 'Re:ゼロから始める異世界生活',
  names: ['Re:ゼロから始める異世界生活', 'Re:Zero kara Hajimeru Isekai Seikatsu', 'Re:ZERO'],
  description: '',
  cover: 'https://s4.anilist.co/file/re-zero.jpg',
  genres: [],
  released: '2014',
  score: 80
};
const aniList = (media: object[]) =>
  new Response(JSON.stringify({ data: { Page: { media } } }), { status: 200 });
const reZeroMedia = {
  siteUrl: reZero.url,
  title: { native: 'Re:ゼロから始める異世界生活', romaji: 'Re:Zero kara Hajimeru Isekai Seikatsu' },
  synonyms: [],
  coverImage: { extraLarge: reZero.cover },
  genres: []
};

describe('discord covers', () => {
  it('ignores width, case, spaces and punctuation when matching', () => {
    expect(matchKey('Ｒｅ：ゼロから始める異世界生活')).toBe(
      matchKey('re ゼロから始める異世界生活')
    );
    expect(matchKey('「本」・。')).toBe('本');
  });

  it('searches the series, else the title without volume, store tags and author', () => {
    expect(coverQuery('Ｒｅ：ゼロから始める異世界生活')).toBe('Re:ゼロから始める異世界生活');
    expect(coverQuery('Re：ゼロから始める異世界生活 23 (MF文庫J) - 長月 達平')).toBe(
      'Re:ゼロから始める異世界生活'
    );
    expect(coverQuery('【電子特典付き】本好きの下剋上 第三部 1')).toBe('本好きの下剋上 第三部');
    expect(coverQuery('どれでも 3', 'Ｓｅｒｉｅｓ')).toBe('Series');
  });

  it('accepts only an exact title match', () => {
    const query = coverQuery('Re：ゼロから始める異世界生活 23 (MF文庫J) - 長月 達平');

    expect(exactMatch(query, [reZero])).toBe(reZero);
    expect(exactMatch('re zero', [reZero])).toBe(reZero);
    expect(exactMatch('Re:ゼロから始める異世界生活 短編集', [reZero])).toBeUndefined();
    expect(exactMatch('', [reZero])).toBeUndefined();
  });

  describe('findCover', () => {
    const fetchMock = vi.fn();

    beforeEach(() => vi.stubGlobal('fetch', fetchMock));
    afterEach(() => {
      vi.unstubAllGlobals();
      fetchMock.mockReset();
      window.localStorage.clear();
    });

    it('keeps the match in this browser when the server refuses to save it', async () => {
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
        url.includes('anilist')
          ? aniList([reZeroMedia])
          : new Response(null, { status: init?.method === 'PUT' ? 403 : 404 })
      );

      expect(await findCover('Ｒｅ：ゼロから始める異世界生活 1', 'book')).toBe(true);
      expect(localCover('Ｒｅ：ゼロから始める異世界生活 1')).toBe(reZero.cover);
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(JSON.parse(put![1].body)['Ｒｅ：ゼロから始める異世界生活 1']).not.toHaveProperty(
        'names'
      );
    });

    it('remembers a miss for 7 days and runs one search at a time', async () => {
      let answer: (response: Response) => void = () => {};
      fetchMock.mockImplementation(() => new Promise((resolve) => (answer = resolve)));

      const first = findCover('A', 'book');
      expect(canSearch('B')).toBe(false);
      expect(await findCover('B', 'book')).toBe(false);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      answer(aniList([{ ...reZeroMedia, title: { native: 'Other' } }]));
      expect(await first).toBe(false);
      expect(canSearch('A')).toBe(false);
      expect(canSearch('B')).toBe(true);

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 8 * 24 * 3600_000);
      expect(canSearch('A')).toBe(true);
      vi.useRealTimers();
    });
  });
});
