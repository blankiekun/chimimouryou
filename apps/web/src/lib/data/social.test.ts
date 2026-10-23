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
  hiddenBooks$,
  noteReading,
  setBookHidden,
  sharedBooks,
  socialStats,
  type Friend,
  type FriendBook
} from '$lib/data/social';
import { socialSession$, type SocialMe } from '$lib/data/social-account';

vi.mock('$lib/data/store', () => ({
  database: { getStatisticsForTimeWindow: async () => [] },
  startDayHoursForTracker$: { getValue: () => 0 }
}));

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
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies.map((body) => body.finished).filter(Boolean)).toEqual([
      { key: bookKey('Book A'), title: 'Book A', kind: 'book' }
    ]);

    setBookHidden('Book B', true);
    noteReading('Book B', 10, 100);
    noteReading('Book B', 100, 100);
    await vi.waitFor(() => expect(bodies).toHaveLength(4));
    expect(JSON.stringify(bodies.slice(2))).not.toContain('Book B');
    // The two pushes may land in either order.
    expect(bodies.slice(2).flatMap((body) => body.books as unknown[])).toEqual([
      expect.objectContaining({ kind: 'hidden', key: '', title: '' })
    ]);
  });
});
