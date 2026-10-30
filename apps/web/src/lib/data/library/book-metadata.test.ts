/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '$lib/data/test-utils/fake-api';
import {
  applyMetadata,
  cleanDescription,
  jitenCharacters,
  jitenVnCharacters,
  parseBookMetadata,
  parseJitenDecks,
  saveBookMetadata
} from './book-metadata';
import type { BookCardProps } from '$lib/components/book-card/book-card-props';

const entry = {
  source: 'anilist',
  url: 'https://anilist.co/manga/1',
  title: 'タイトル',
  description: 'Text',
  cover: 'https://s4.anilist.co/file/cover.jpg',
  genres: ['Drama', 3],
  released: '2001-02-03',
  score: 80,
  modified: 1
};

describe('parseBookMetadata', () => {
  it('keeps entries linking to the sources', () => {
    const map = parseBookMetadata({ a: entry });

    expect(map.a.cover).toBe(entry.cover);
    expect(map.a.genres).toEqual(['Drama']);
  });

  it('drops foreign pages and covers', () => {
    const map = parseBookMetadata({
      a: { ...entry, cover: 'https://evil.example/x.jpg' },
      b: { ...entry, url: 'javascript:alert(1)' },
      c: { ...entry, source: 'other' }
    });

    expect(map.a.cover).toBe('');
    expect(Object.keys(map)).toEqual(['a']);
  });

  it('ignores non-objects', () => {
    expect(parseBookMetadata([entry])).toEqual({});
    expect(parseBookMetadata(null)).toEqual({});
  });
});

describe('cleanDescription', () => {
  it('strips markup and spoilers', () => {
    expect(
      cleanDescription(
        'A<br><br>\n<i>B</i> &amp; [url=/c1]C[/url] ~!secret!~[spoiler]x[/spoiler]<img src=x>'
      )
    ).toBe('A\n\nB & C');
  });
});

describe('applyMetadata', () => {
  it('replaces the cover only when one was saved', () => {
    const card = { title: 'a', imagePath: 'own.jpg' } as BookCardProps;
    const map = parseBookMetadata({ a: entry });

    expect(applyMetadata(card, map).imagePath).toBe(entry.cover);
    expect(applyMetadata(card, map).displayTitle).toBeUndefined();
    expect(applyMetadata(card, { a: { ...map.a, cover: '' } })).toBe(card);
  });

  it("shows VNDB's title", () => {
    const card = { title: 'game_folder', imagePath: 'own.jpg' } as BookCardProps;
    const map = parseBookMetadata({
      game_folder: { ...entry, source: 'vndb', url: 'https://vndb.org/v1', cover: '' }
    });

    expect(applyMetadata(card, map)).toEqual({ ...card, displayTitle: 'タイトル' });
  });
});

describe('parseJitenDecks', () => {
  const deck = {
    deckId: 233,
    mediaType: 7,
    parentDeckId: null,
    originalTitle: 'Fate/stay night',
    description: 'Text',
    coverName: 'https://cdn.jiten.moe/233/cover.jpg',
    genres: [1, 99],
    tags: [
      { name: 'Magic', percentage: 96 },
      { name: 'Rare', percentage: 10 }
    ],
    releaseDate: '2004-01-30T00:00:00',
    externalRating: 85
  };

  it('keeps decks of the kind and maps their fields', () => {
    const [candidate, ...rest] = parseJitenDecks(
      { data: [deck, { ...deck, deckId: 1, mediaType: 1 }, { ...deck, parentDeckId: 233 }] },
      'vn'
    );

    expect(rest).toEqual([]);
    expect(candidate).toEqual({
      source: 'jiten',
      url: 'https://jiten.moe/decks/media/233/detail',
      title: 'Fate/stay night',
      description: 'Text',
      cover: deck.coverName,
      genres: ['Action', 'Magic'],
      released: '2004-01-30',
      score: 85
    });
    expect(parseBookMetadata({ a: { ...candidate, modified: 1 } }).a.cover).toBe(deck.coverName);
  });
});

describe('Jiten lengths', () => {
  const vndbUrl = 'https://vndb.org/v17';
  const mainDeck = {
    deckId: 118931,
    mediaType: 7,
    parentDeckId: null,
    characterCount: 626352,
    links: [{ linkType: 2, url: vndbUrl }]
  };
  const vndb = {
    source: 'vndb' as const,
    url: vndbUrl,
    title: 'Ever17',
    description: '',
    cover: '',
    genres: [],
    released: '',
    score: null
  };

  afterEach(() => vi.unstubAllGlobals());

  it('takes a search result deck count', () => {
    const [candidate] = parseJitenDecks({ data: [mainDeck] }, 'vn');

    expect(candidate.characters).toBe(626352);
    expect(
      parseJitenDecks({ data: [{ ...mainDeck, characterCount: 0 }] }, 'vn')[0]
    ).not.toHaveProperty('characters');
  });

  it('takes a deck count only from a whole VN deck linked to the VNDB entry', () => {
    expect(jitenVnCharacters({ data: { mainDeck } }, vndbUrl)).toBe(626352);
    expect(jitenVnCharacters({ data: { mainDeck } }, 'https://vndb.org/v1')).toBeUndefined();
    expect(
      jitenVnCharacters({ data: { mainDeck: { ...mainDeck, mediaType: 4 } } }, vndbUrl)
    ).toBeUndefined();
    expect(
      jitenVnCharacters({ data: { mainDeck: { ...mainDeck, parentDeckId: 5 } } }, vndbUrl)
    ).toBeUndefined();
    expect(jitenVnCharacters({}, vndbUrl)).toBeUndefined();
  });

  it('finds the Jiten deck of a VNDB pick by its link', async () => {
    const fetch = vi.fn(async (url: string) =>
      Response.json(url.includes('by-link-id') ? [118931] : { data: { mainDeck } })
    );

    vi.stubGlobal('fetch', fetch);

    expect(await jitenCharacters(vndb)).toBe(626352);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/jiten/api/media-deck/by-link-id/2/v17',
      '/jiten/api/media-deck/118931/detail?pageSize=1'
    ]);
  });

  it('asks nothing for an AniList pick or a VNDB entry Jiten lacks', async () => {
    const fetch = vi.fn(async () => Response.json([]));

    vi.stubGlobal('fetch', fetch);

    expect(
      await jitenCharacters({ ...vndb, source: 'anilist', url: 'https://anilist.co/manga/1' })
    ).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(await jitenCharacters(vndb)).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('saveBookMetadata', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // Bugs: removed details coming back (a `{}` row listed as an entry) or a save touching other
  // books' rows (the old whole-file write); a save must not drop another device's book either.
  it('writes only its book, and a removal is no longer listed', async () => {
    const api = fakeApi();

    vi.useFakeTimers({ toFake: ['Date'] });
    api.addBook({ id: 1, calibreId: 11, title: 'Mine' });
    api.addBook({ id: 2, calibreId: 12, title: 'Other' });
    api.setRow('metadata', { book: 2, modified: 1, data: entry });
    vi.stubGlobal('fetch', api.fetch);

    const saved = await saveBookMetadata('Mine', entry as never);

    expect(Object.keys(saved).sort()).toEqual(['Mine', 'Other']);

    // A later click: an equal `modified` is kept as it is on the server.
    vi.setSystemTime(Date.now() + 1000);
    const removed = await saveBookMetadata('Mine', undefined);

    expect(Object.keys(removed)).toEqual(['Other']);
    expect(api.requests.filter((request) => request.startsWith('PUT'))).toEqual([
      'PUT /api/v1/metadata/1',
      'PUT /api/v1/metadata/1'
    ]);
  });
});
