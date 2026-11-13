/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '$lib/data/test-utils/fake-api';
import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import { getDateKey } from '$lib/functions/statistic-util';
import {
  agedStats,
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
} from '$lib/data/social/social';
import { socialSession$, type SocialMe } from '$lib/data/social/social-account';
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

vi.mock('$lib/data/social/social-images', () => ({
  coverThumbnail: async (cover: Blob) =>
    cover.size ? new Blob(['RIFFthumb'], { type: 'image/webp' }) : null
}));

// Its import chain is slow on a cold CI worker and outlasts vi.waitFor; rank has its own tests.
vi.mock('$lib/data/stats/reading-rank-data', () => ({ loadReadingRank: async () => undefined }));
// What each push imports, loaded here outside any wait: cold, under load, they outlast vi.waitFor
// (1 run in 25 alone, 1 in 5 with six at once), and the late push lands in the next test.
await Promise.all([
  import('$lib/functions/statistic-util'),
  import('$lib/data/words/words-met').catch(() => {})
]);

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

// The library's server: an empty catalog (the hub is another host, stubbed per test).
const api = fakeApi();

describe('social', () => {
  beforeEach(() => {
    window.localStorage.clear();
    socialSession$.next({ token: 't', me });
    hiddenBooks$.next([]);
    // Never the real hub: its 401 for this token would also sign the next test out.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}'))
    );
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

  // Catches a reader who stopped reading showing the streak, week and heat of their last push, and
  // last year's finished count under this year in January.
  it('ages stats by the day they were pushed', () => {
    const at = new Date(2026, 11, 31, 20).getTime() / 1000;
    const pushed = { ...socialStats([], '2026-12-31'), streak: 5, weekChars: 900, at };
    const read = { ...pushed, heat: pushed.heat.slice(1) + '3' };
    const on = (month: number, date: number) => new Date(2027, month, date, 9);

    expect(agedStats(read, on(0, 1))).toMatchObject({ streak: 5, weekChars: 900, year: 2026 });
    expect(agedStats(read, on(0, 1)).heat.slice(-2)).toBe('30');
    expect(agedStats(pushed, on(0, 1))).toMatchObject({ streak: 0, weekChars: 900 });
    expect(agedStats(read, on(0, 2))).toMatchObject({ streak: 0 });
    expect(agedStats(read, on(0, 7))).toMatchObject({ weekChars: 0, weekMinutes: 0 });
    // Older hubs send no time: as sent, under this year.
    expect(agedStats({ ...read, at: undefined }, on(0, 9))).toMatchObject({
      streak: 5,
      year: 2027
    });
  });

  it('keeps hidden books in the browser: only "Reading something" with its share', () => {
    const books = [book('薬屋のひとりごと 1', 'book', 0.62), book('魔女の旅々 3', 'manga')];

    hiddenBooks$.next([bookKey('薬屋のひとりごと 1')]);
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
        // Hiding also sends a DELETE of the book's finished row, with no body.
        if (init.body) bodies.push(JSON.parse(init.body as string));
        return new Response('{"ok":true}');
      })
    );

    noteReading('Book A', 50, 100);
    noteReading('Book A', 99, 100);
    await vi.waitFor(() => expect(bodies).toHaveLength(2), { timeout: 5000 });
    // With the reader's own month (the hub's is UTC).
    expect(bodies.map((body) => body.finished).filter(Boolean)).toEqual([
      { key: bookKey('Book A'), title: 'Book A', kind: 'book', month: getDateKey(0).slice(0, 7) }
    ]);

    setBookHidden('Book B', true);
    noteReading('Book B', 10, 100);
    noteReading('Book B', 100, 100);
    // The hide's own push (its row leaves at once) and the two of Book B.
    await vi.waitFor(() => expect(bodies).toHaveLength(5), { timeout: 5000 });
    expect(JSON.stringify(bodies.slice(2))).not.toContain('Book B');
    // The pushes may land in any order.
    expect(bodies.slice(2).flatMap((body) => body.books as unknown[])).toEqual([
      expect.objectContaining({ kind: 'hidden', key: '', title: '' })
    ]);
  }, 15000);

  // Bug: finishing needed the book's earlier position in the 3 current books, so a book that left
  // them never counted; and a book first seen finished (finished long ago, or announced by
  // another device) must not be sent again.
  it('sends a book finished after leaving the current books, not one first seen finished', async () => {
    const bodies: Record<string, unknown>[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.body) bodies.push(JSON.parse(init.body as string));
        return new Response('{"ok":true}');
      })
    );

    noteReading('Old Finished', 98, 100, true);
    noteReading('Long Book', 40, 100, true);
    for (const other of ['X1', 'X2', 'X3']) noteReading(other, 10, 100, true);
    noteReading('Long Book', 99, 100, true);
    await vi.waitFor(() => expect(bodies).toHaveLength(6), { timeout: 5000 });
    expect(bodies.map((body) => body.finished).filter(Boolean)).toEqual([
      { key: bookKey('Long Book'), title: 'Long Book', kind: 'book' }
    ]);
  }, 15000);

  // Bugs: a book hidden before hiding removed rows (or whose DELETE failed) stays on the hub until
  // toggled; naming every hidden book to find out would send books the hub never had; asking on
  // every push would use up the hub's 30 profile reads a day.
  it('takes books still on the hub off it, naming only those', async () => {
    const [kept, never, shown] = ['Kept', 'Never', 'Shown'].map(bookKey);
    const on = (start: number) => vi.spyOn(Date, 'now').mockReturnValue(start);
    const calls: string[] = [];
    let deleteStatus = 500;
    const start = Date.now() + 2 * 3_600_000;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname;

        if (init.method === 'DELETE') {
          calls.push(`DELETE ${decodeURIComponent(path)}`);
          return new Response('{"error":"down"}', { status: deleteStatus });
        }
        if (path.startsWith('/v1/profile/')) {
          calls.push('profile');
          return new Response(
            JSON.stringify({ finished: [{ key: kept }], events: [{ key: shown }] })
          );
        }
        return new Response('{"ok":true}');
      })
    );
    hiddenBooks$.next([kept, never]);

    on(start);
    noteReading('Sweep 1', 10, 100);
    await vi.waitFor(() => expect(calls).toContain(`DELETE /v1/finished/${kept}`), {
      timeout: 5000
    });
    expect(calls.join()).not.toContain(never);
    expect(calls.join()).not.toContain(shown);

    // It failed: not within the hour, then again.
    calls.length = 0;
    noteReading('Sweep 2', 10, 100);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toEqual([]);

    deleteStatus = 200;
    on(start + 2 * 3_600_000);
    noteReading('Sweep 3', 10, 100);
    await vi.waitFor(() => expect(calls).toContain(`DELETE /v1/finished/${kept}`), {
      timeout: 5000
    });

    // Done: no more profile reads for these books, whatever the time.
    await new Promise((resolve) => setTimeout(resolve, 50));
    calls.length = 0;
    on(start + 4 * 3_600_000);
    noteReading('Sweep 4', 10, 100);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toEqual([]);
    vi.restoreAllMocks();
  }, 15000);

  // Bug: the hub refuses a whole push over one title or key past 200, silently, on every push, while
  // the long book stays among the current ones.
  it('clips long titles and keys to what the hub takes, kept ones too', async () => {
    const long = 'あ'.repeat(300);
    const bodies: { books: FriendBook[] }[] = [];

    expect(bookKey(long)).toHaveLength(200);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return new Response('{"ok":true}');
      })
    );

    // A title kept whole in the current books, sent again with the next book's push.
    noteReading(long, 10, 100);
    noteReading('短い本', 10, 100);
    await vi.waitFor(() => expect(bodies).toHaveLength(2), { timeout: 5000 });
    for (const body of bodies) {
      const clipped = body.books.find((other) => other.title.startsWith('あ'))!;

      expect(clipped.title).toHaveLength(200);
      expect(clipped.key).toHaveLength(200);
    }
  }, 15000);

  it('gives the hub the thumbnails it asks for, once, from covers this reader has', async () => {
    const calls: { path: string; type: string | null; body: unknown }[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const { pathname, search } = new URL(url, 'http://app.example');

        if (pathname.startsWith('/api/v1/')) return api.fetch(url, init);
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
