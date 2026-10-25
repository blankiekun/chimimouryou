/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The match toast's AniList search
vi.mock('$lib/data/book-metadata', async (original) => ({
  ...(await original<typeof import('$lib/data/book-metadata')>()),
  searchMetadata: async () => [
    { title: 'Wagahai wa Neko de Aru', url: 'https://anilist.co/manga/7', cover: 'c.jpg' }
  ]
}));

import {
  communityMatchAsked$,
  communityWorks$,
  lineHash,
  lineIndex,
  visibleThreads,
  type CommunityNote,
  type CommunityPost
} from '$lib/data/community';
import {
  bookLines,
  communityMarks$,
  lineAt,
  lineLinkTarget,
  loadBookCommunity,
  answerMatch,
  communityMarksCache$,
  markBookOnOpen,
  matchOffer$,
  passedLine,
  refreshBookMarks,
  restoreBookMarks,
  shouldOfferMatch,
  splitContext,
  notePath,
  splitThread,
  unseenNotes
} from '$lib/data/community-book';
import { socialSession$ } from '$lib/data/social-account';
import type { SearchIndex } from '$lib/functions/book-text/book-search';
import { enabledPlugins$ } from '$lib/plugins/plugin-settings';

const paragraphs = [
  { text: '一章', startCount: 0 },
  {
    text: '私はその人を常に先生と呼んでいた。だからここでもただ先生と書くだけで本名は打ち明けない。',
    startCount: 2
  },
  { text: '「本当ですか」と彼は言った。', startCount: 46 }
];

describe('community in the book', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    enabledPlugins$.next(['social']);
  });

  it('splits the book into lines with their character counts', () => {
    const lines = bookLines(paragraphs);

    expect(lines.map((line) => line.text)).toEqual([
      '一章',
      '私はその人を常に先生と呼んでいた。',
      'だからここでもただ先生と書くだけで本名は打ち明けない。',
      '「本当ですか」と彼は言った。'
    ]);
    // Punctuation doesn't count as characters: 「 and 」 are skipped in reader positions.
    expect(lines[1]).toMatchObject({ start: 2, end: 18 });
    expect(lines[2].start).toBe(18);
    expect(lines[3].start).toBe(46);
  });

  it('finds the line at a position and the lines passed', () => {
    const lines = bookLines(paragraphs);

    expect(lineAt(lines, 0)).toBe(0);
    expect(lineAt(lines, 20)).toBe(2);
    expect(passedLine(lines, 18)).toBe(1);
    expect(passedLine(lines, 19)).toBe(2);
  });

  it('shows threads on lines ahead of the reader too', async () => {
    const lines = bookLines(paragraphs);
    const index = await lineIndex(lines.map((line) => line.text));
    const later = (await lineHash(lines[3].text))!;
    const threads = [{ prefix: later.slice(0, 8), posts: 2, spoiler: false }];

    expect(visibleThreads(threads, index)).toMatchObject([{ hash: later, index: 3, posts: 2 }]);
  });

  it('marks the line in its page', () => {
    expect(splitContext('前の文。この行。後の文。', 'この行。')).toEqual({
      before: '前の文。',
      line: 'この行。',
      after: '後の文。'
    });
    expect(splitContext('どこにもない', 'この行。').line).toBe('この行。');
  });

  it('groups unseen replies by the post they answer', () => {
    const note = (id: string, parent: string, at: number, name: string) =>
      ({
        id,
        parent,
        at,
        work: 'w',
        line: 'l',
        title: 't',
        vol: '1',
        cover: null,
        author: { name }
      }) as unknown as CommunityNote;
    const groups = unseenNotes(
      [
        note('a', 'p1', 30, 'Mio'),
        note('b', 'p1', 20, 'Ren'),
        note('c', 'p2', 10, 'Aki'),
        note('d', 'p1', 25, 'Mio')
      ],
      { p2: 10 }
    );

    expect(groups).toEqual([
      expect.objectContaining({ parent: 'p1', count: 3, at: 30, names: ['Mio', 'Ren'] })
    ]);
  });

  it("opens a reply's feed post, or a line comment's line", () => {
    const group = { parent: 'p1', work: 'anilist:1', line: 'h', title: '', vol: '', cover: null };
    const open = (inFeed?: boolean) =>
      new URL(notePath({ ...group, names: [], count: 1, at: 1, inFeed }), 'http://x').searchParams;

    expect(open(true).get('post')).toBe('p1');
    expect(open().get('post')).toBe('p1');
    expect(open(false).get('post')).toBeNull();
    expect(open(false).get('line')).toBe('h');
  });

  it('sends line links nowhere with social off or a malformed line', async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal('fetch', fetchMock);
    expect(await lineLinkTarget(new URLSearchParams({ line: 'x', work: 'w' }))).toBeNull();
    enabledPlugins$.next([]);
    expect(
      await lineLinkTarget(new URLSearchParams({ line: 'a'.repeat(32), work: 'anilist:1' }))
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens the thread when the book is not in this browser', async () => {
    enabledPlugins$.next(['social']);
    expect(
      await lineLinkTarget(new URLSearchParams({ line: 'a'.repeat(32), work: 'anilist:1/2' }))
    ).toBe(`/community?work=anilist%3A1%2F2&line=${'a'.repeat(32)}`);
  });

  it('marks a matched book on open signed in, once for the tab too, and asks nothing otherwise', async () => {
    const later = (await lineHash(bookLines(paragraphs)[3].text))!;
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('/v1/community/threads')
        ? new Response(
            JSON.stringify({
              threads: [{ prefix: later.slice(0, 8), posts: 2, spoiler: false }],
              next: null
            })
          )
        : new Response('', { status: 404 })
    );
    const hubCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/'));
    const getIndex = async () => ({ paragraphs }) as unknown as SearchIndex;

    vi.stubGlobal('fetch', fetchMock);
    communityWorks$.next({ 本: 'anilist:1' });
    // Signed out: nothing, even for a matched book.
    await markBookOnOpen('本', getIndex);
    expect(fetchMock).not.toHaveBeenCalled();

    socialSession$.next({ token: 't', me: { id: 'a', share: {} } } as never);
    // Not matched yet: only the hub's suggestion is asked for (the match toast), no threads.
    await markBookOnOpen('別の本', getIndex);
    expect(hubCalls().map(([url]) => String(url))).toEqual([
      expect.stringContaining('/v1/community/work?')
    ]);
    expect(matchOffer$.getValue()).toBeNull();
    fetchMock.mockClear();

    await markBookOnOpen('本', getIndex);
    expect(hubCalls()).toHaveLength(1);
    expect(communityMarks$.getValue()).toMatchObject({
      title: '本',
      marks: [{ hash: later, posts: 2, start: 46 }]
    });
    // The tab opened later reuses it.
    expect((await loadBookCommunity('本', getIndex)).threads).toHaveLength(1);
    expect(hubCalls()).toHaveLength(1);

    // A post: the book's threads again, its new line marked without the tab.
    const first = (await lineHash(bookLines(paragraphs)[1].text))!;

    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            threads: [
              { prefix: first.slice(0, 8), posts: 1, spoiler: false },
              { prefix: later.slice(0, 8), posts: 2, spoiler: false }
            ],
            next: null
          })
        )
    );
    await refreshBookMarks('本', getIndex);
    expect(communityMarks$.getValue().marks.map((mark) => mark.hash)).toEqual([first, later]);

    // The book opened again (another getIndex): fresh markers replace the ones kept from before.
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            threads: [{ prefix: first.slice(0, 8), posts: 3, spoiler: false }],
            next: null
          })
        )
    );
    await markBookOnOpen('本', async () => ({ paragraphs }) as unknown as SearchIndex);
    expect(communityMarks$.getValue().marks).toMatchObject([{ hash: first, posts: 3 }]);
    socialSession$.next(null);
    communityWorks$.next({});
  });

  it('keeps line comments apart from feed posts and their replies', () => {
    const post = (id: string, parent: string | null, inFeed?: boolean) =>
      ({ id, parent, ...(inFeed !== undefined && { inFeed }) }) as CommunityPost;
    // a feed post (old hubs send no inFeed), its reply, a line comment and its reply, a reply
    // whose post is hidden
    const posts = [
      post('a', null),
      post('b', 'a', true),
      post('c', null, false),
      post('d', 'x', true),
      post('e', 'c', true)
    ];
    const { comments, feed } = splitThread(posts);

    expect(comments.map((one) => one.id)).toEqual(['c', 'e', 'd']);
    expect(feed.map(({ root, replies }) => [root.id, replies.map((one) => one.id)])).toEqual([
      ['a', ['b']]
    ]);
  });

  it('asks to match only signed in with social on, unmatched, with a suggestion, once', () => {
    const suggested = { work: null, suggestion: 'anilist:7' };

    communityMatchAsked$.next({ 答えた本: 1 });
    // Signed out
    expect(shouldOfferMatch('本', suggested)).toBe(false);
    socialSession$.next({ token: 't', me: { id: 'a', share: {} } } as never);
    expect(shouldOfferMatch('本', suggested)).toBe(true);
    // Matched, no suggestion, answered before
    expect(shouldOfferMatch('本', { work: 'anilist:7', suggestion: null })).toBe(false);
    expect(shouldOfferMatch('本', { work: null, suggestion: null })).toBe(false);
    expect(shouldOfferMatch('答えた本', suggested)).toBe(false);
    // Social off
    enabledPlugins$.next([]);
    expect(shouldOfferMatch('本', suggested)).toBe(false);
    socialSession$.next(null);
    communityMatchAsked$.next({});
  });

  it('offers the suggestion on open and Match marks the lines', async () => {
    const title = '吾輩は猫である';
    const first = (await lineHash(bookLines(paragraphs)[1].text))!;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/v1/community/work')) {
        return new Response(JSON.stringify(init?.method === 'PUT' ? {} : { work: 'anilist:7' }));
      }
      return new Response(
        JSON.stringify({
          threads: [{ prefix: first.slice(0, 8), posts: 1, spoiler: false }],
          next: null
        })
      );
    });
    const getIndex = async () => ({ paragraphs }) as unknown as SearchIndex;

    vi.stubGlobal('fetch', fetchMock);
    socialSession$.next({ token: 't', me: { id: 'a', share: {} } } as never);
    await markBookOnOpen(title, getIndex);

    const offer = matchOffer$.getValue()!;

    expect(offer).toMatchObject({ title, work: 'anilist:7', name: 'Wagahai wa Neko de Aru' });
    await answerMatch(offer, true);
    expect(matchOffer$.getValue()).toBeNull();
    expect(communityWorks$.getValue()[title]).toBe('anilist:7');
    expect(communityMatchAsked$.getValue()[title]).toBeGreaterThan(0);
    expect(communityMarks$.getValue()).toMatchObject({ title, marks: [{ hash: first }] });

    // Answered: the next open of another unmatched copy asks the hub nothing for it.
    communityWorks$.next({});
    fetchMock.mockClear();
    await markBookOnOpen(title, getIndex);
    expect(fetchMock).not.toHaveBeenCalled();
    socialSession$.next(null);
    communityMatchAsked$.next({});
  });

  it('keeps marks per book in this browser, without the lines, and restores them on open', () => {
    const mark = { prefix: 'abcd1234', hash: 'abcd1234'.repeat(4), posts: 2, spoiler: false };

    communityMarksCache$.next({});
    communityMarks$.next({
      title: '本',
      marks: [{ ...mark, index: 1, text: '吾輩は猫である。', start: 2, end: 10 }]
    });
    expect(communityMarksCache$.getValue()['本'].marks).toEqual([
      { ...mark, index: 1, text: '', start: 2, end: 10 }
    ]);

    // Another book opened, then this one again: its bubbles at once.
    communityMarks$.next({ title: '別の本', marks: [] });
    expect(Object.keys(communityMarksCache$.getValue())).toEqual(['本']);
    restoreBookMarks('本');
    expect(communityMarks$.getValue()).toMatchObject({ title: '本', marks: [{ start: 2 }] });

    // Social off: nothing shown from the cache.
    communityMarks$.next({ title: '', marks: [] });
    enabledPlugins$.next([]);
    restoreBookMarks('本');
    expect(communityMarks$.getValue().title).toBe('');

    // At most 30 books, the latest kept.
    enabledPlugins$.next(['social']);
    for (let i = 0; i < 31; i++) {
      communityMarks$.next({
        title: `b${i}`,
        marks: [{ ...mark, index: 0, text: '', start: 0, end: 1 }]
      });
    }
    expect(Object.keys(communityMarksCache$.getValue())).toHaveLength(30);
    expect(communityMarksCache$.getValue()['b30']).toBeDefined();
    communityMarksCache$.next({});
  });
});
