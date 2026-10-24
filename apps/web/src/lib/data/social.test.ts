/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import {
  bookKey,
  friendsWithBook,
  uploadCovers,
  hiddenBooks$,
  noteReading,
  setBookHidden,
  sharedBooks,
  socialStats,
  statisticsDeleted,
  type Friend,
  type FriendBook
} from '$lib/data/social';
import { socialSession$, type SocialMe } from '$lib/data/social-account';
import { enabledPlugins$ } from '$lib/plugins/plugin-settings';

vi.mock('$lib/data/store', () => ({
  database: {
    getStatisticsForTimeWindow: async () => [],
    getStatisticsForBook: async (title: string) => (title === 'Kept' ? [{ title }] : []),
    // One stored book with a cover, for uploadCovers
    db: Promise.resolve({
      transaction: () => ({
        store: {
          openCursor: async () => ({
            value: { title: 'Covered', coverImage: new Blob(['jpeg'], { type: 'image/jpeg' }) },
            continue: async () => null
          })
        }
      })
    })
  },
  startDayHoursForTracker$: { getValue: () => 0 }
}));

vi.mock('$lib/data/social-images', () => ({
  coverThumbnail: async (cover: Blob) =>
    cover.size ? new Blob(['RIFFthumb'], { type: 'image/webp' }) : null
}));

// Its import chain is slow on a cold CI worker and outlasts vi.waitFor; rank has its own tests.
vi.mock('$lib/data/reading-rank-data', () => ({ loadReadingRank: async () => undefined }));

const me: SocialMe = {
  id: '0123456789abcdef',
  username: 'aki',
  name: 'Aki',
  avatar: 0,
  code: 'K7QM2XPA',
  share: {},
  created: 0
};

function book(title: string, kind: FriendBook['kind'] = 'book', pct = 0.5): FriendBook {
  return { key: bookKey(title), title, author: '', kind, pct, readAt: 100 };
}

function day(dateKey: string, charactersRead: number, extra: Partial<BooksDbStatistic> = {}) {
  return { title: 'A', dateKey, charactersRead, readingTime: 600, ...extra } as BooksDbStatistic;
}

describe('social', () => {
  beforeEach(() => {
    window.localStorage.clear();
    socialSession$.next({ token: 't', me });
    hiddenBooks$.next([]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('computes the profile stats from daily statistics', () => {
    const stats = socialStats(
      [
        day('2026-10-21', 1000),
        day('2026-10-22', 2000),
        day('2026-10-23', 4000, { completedBook: 1 }),
        day('2025-12-01', 500, { title: 'B', completedBook: 1 })
      ],
      '2026-10-23',
      3210
    );

    expect(stats).toMatchObject({
      streak: 3,
      weekChars: 7000,
      weekMinutes: 30,
      finishedYear: 1,
      wordsKnown: 3210
    });
    expect(stats.heat).toHaveLength(84);
    expect(stats.heat.slice(-3)).toBe('124');
    expect(socialStats([], '2026-10-23')).not.toHaveProperty('wordsKnown');
  });

  it('keeps hidden books in the browser: only "Reading something" with its share', () => {
    const books = [book('薬屋のひとりごと 1', 'book', 0.62), book('魔女の旅々 3', 'manga')];

    setBookHidden('薬屋のひとりごと 1', true);
    expect(sharedBooks(books)).toEqual([books[1]]);

    socialSession$.next({ token: 't', me: { ...me, share: { hideManga: true } } });
    expect(sharedBooks(books)).toEqual([
      { key: '', title: '', author: '', kind: 'hidden', pct: 0.62, readAt: 100 }
    ]);

    socialSession$.next({ token: 't', me: { ...me, share: { current: false } } });
    expect(sharedBooks(books)).toEqual([]);
  });

  it('lists friends reading or done with a book, matched by book key', () => {
    const friends = [
      { name: 'Aki', books: [book('薬屋のひとりごと 1', 'book', 0.62)], finished: [] },
      {
        name: 'Ren',
        books: [],
        finished: [
          { key: bookKey('薬屋のひとりごと１'), title: 'x', kind: 'book', month: '2026-03' }
        ]
      },
      { name: 'Mio', books: [book('Other')], finished: [] }
    ] as unknown as Friend[];

    expect(
      friendsWithBook(friends, '薬屋のひとりごと 1').map(({ friend, pct, month }) => [
        friend.name,
        pct,
        month
      ])
    ).toEqual([
      ['Aki', 0.62, ''],
      ['Ren', 1, '2026-03']
    ]);
  });

  it('sends a finished book once, and never a hidden one', async () => {
    const bodies: Record<string, unknown>[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return new Response('{"ok":true}');
      })
    );

    noteReading('Book A', 50, 100);
    noteReading('Book A', 99, 100);
    // The first push imports its stats modules, which can outlast waitFor's 1 s on a cold CI worker.
    await vi.waitFor(() => expect(bodies).toHaveLength(2), { timeout: 5000 });
    expect(bodies.map((body) => body.finished).filter(Boolean)).toEqual([
      { key: bookKey('Book A'), title: 'Book A', kind: 'book' }
    ]);

    setBookHidden('Book B', true);
    noteReading('Book B', 10, 100);
    noteReading('Book B', 100, 100);
    await vi.waitFor(() => expect(bodies).toHaveLength(4), { timeout: 5000 });
    expect(JSON.stringify(bodies.slice(2))).not.toContain('Book B');
    // The two pushes may land in either order.
    expect(bodies.slice(2).flatMap((body) => body.books as unknown[])).toEqual([
      expect.objectContaining({ kind: 'hidden', key: '', title: '' })
    ]);
  }, 15000);

  it('gives the hub the thumbnails it asks for, once, from covers this reader has', async () => {
    const calls: { path: string; type: string | null; body: unknown }[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const { pathname, search } = new URL(url, 'http://app.example');

        if (pathname.startsWith('/calibre/')) return new Response('', { status: 404 });
        calls.push({
          path: `${init.method} ${pathname}${search}`,
          type: new Headers(init.headers).get('Content-Type'),
          body: init.body
        });
        return new Response(
          pathname === '/v1/status'
            ? JSON.stringify({ ok: true, needCovers: [bookKey('Covered'), bookKey('Missing')] })
            : '{}'
        );
      })
    );

    noteReading('Covered', 10, 100);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({
      path: `PUT /v1/cover?key=${encodeURIComponent(bookKey('Covered'))}`,
      type: 'image/webp'
    });
    expect(calls[1].body).toBeInstanceOf(Blob);

    // Asked again: this page already tried.
    await uploadCovers([bookKey('Covered')]);
    expect(calls).toHaveLength(2);
  });

  it('pushes the stats and drops books left without statistics when statistics are deleted', async () => {
    const calls: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${new URL(url).pathname}`);
        return new Response('{"ok":true}');
      })
    );

    enabledPlugins$.next([]);
    await statisticsDeleted(['Gone']);
    expect(calls).toEqual([]);

    enabledPlugins$.next(['social']);
    await statisticsDeleted(['Gone', 'Kept']);
    expect(calls).toEqual([
      `DELETE /v1/finished/${encodeURIComponent(bookKey('Gone'))}`,
      'PUT /v1/status'
    ]);

    calls.length = 0;
    socialSession$.next(null);
    await statisticsDeleted(['Gone']);
    expect(calls).toEqual([]);
  });
});
