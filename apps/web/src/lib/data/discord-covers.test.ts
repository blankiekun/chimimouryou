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
  hubCover,
  localCover,
  matchKey,
  resetHubCovers
} from './discord-covers';
import type { MetadataCandidate } from './book-metadata';

const thumbnails = vi.hoisted(() => ({ made: 0 }));

vi.mock('$lib/data/social', async (original) => ({
  ...(await original<typeof import('$lib/data/social')>()),
  localCovers: async () => new Map([['own', { title: 'own', imagePath: new Blob(['jpeg']) }]]),
  bookKey: (title: string) => title,
  bookThumbnail: async () => {
    thumbnails.made += 1;
    return new Blob(['webp'], { type: 'image/webp' });
  }
}));

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

    it("saves a match's details without its cover, keeping the cover in this browser", async () => {
      const puts: Record<string, { cover: string }>[] = [];
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('anilist')) return aniList([reZeroMedia]);
        if (init?.method === 'PUT') {
          puts.push(JSON.parse(String(init.body)));
          return new Response('{}', { status: 200 });
        }
        return new Response(JSON.stringify(puts.at(-1) ?? {}), { status: 200 });
      });
      const { loadBookMetadata } = await import('./book-metadata');

      await loadBookMetadata(true);
      expect(await findCover('Re：ゼロから始める異世界生活 1', 'book')).toBe(true);
      expect(puts).toHaveLength(1);
      expect(puts[0]['Re：ゼロから始める異世界生活 1']).toMatchObject({
        cover: '',
        url: reZero.url
      });
      expect(localCover('Re：ゼロから始める異世界生活 1')).toBe(reZero.cover);

      // Details already there (picked in the dialog) are never replaced.
      window.localStorage.clear();
      expect(await findCover('Re：ゼロから始める異世界生活 1', 'book')).toBe(true);
      expect(puts).toHaveLength(1);
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

  describe('hubCover', () => {
    const fetchMock = vi.fn();
    const hub = 'https://chimi-hub.blankiekun.workers.dev/v1';
    const requests = () =>
      fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`);

    beforeEach(() => {
      vi.stubGlobal('fetch', fetchMock);
      resetHubCovers();
      thumbnails.made = 0;
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      fetchMock.mockReset();
    });

    it("uses the hub's thumbnail of the book key without uploading, once per page", async () => {
      fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ cover: '0123456789abcdef' }), { status: 200 })
      );

      expect(await hubCover('own')).toBe(`${hub}/cover/0123456789abcdef`);
      expect(await hubCover('own')).toBe(`${hub}/cover/0123456789abcdef`);
      expect(requests()).toEqual([`GET ${hub}/cover?key=own`]);
      expect(thumbnails.made).toBe(0);
    });

    it("uploads the book's own cover when the hub has none, and nothing without a cover", async () => {
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
        init?.method === 'PUT'
          ? new Response(JSON.stringify({ cover: 'fedcba9876543210' }), { status: 200 })
          : new Response(JSON.stringify({ error: 'route' }), { status: 404 })
      );

      expect(await hubCover('own')).toBe(`${hub}/cover/fedcba9876543210`);
      expect(requests()).toEqual([`GET ${hub}/cover?key=own`, `PUT ${hub}/cover?key=own`]);
      expect(await hubCover('none')).toBeUndefined();
      expect(requests()).toHaveLength(3);
    });

    it('asks again after an upload the hub refused, 3 times at most', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ error: 'book' }), { status: 404 })
      );

      expect(await hubCover('own')).toBeUndefined();
      expect(await hubCover('own')).toBeUndefined();
      expect(thumbnails.made).toBe(1);
      for (let i = 0; i < 4; i += 1) {
        vi.setSystemTime(Date.now() + 5 * 60_000);
        await hubCover('own');
      }
      expect(thumbnails.made).toBe(3);
    });
  });
});
