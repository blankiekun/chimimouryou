/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { BookWord } from '$lib/data/book-words';
import {
  cutoffChanges,
  gainedThisMonth,
  knownHistory,
  type HistoryBook
} from '$lib/data/words-history';

vi.mock('$lib/data/extras-sync', () => ({ pullKanji: async () => {}, kanjiChanged: () => {} }));
vi.mock('$lib/data/storage/handler/calibre-handler', () => ({ CalibreStorageHandler: {} }));

const book = (words: BookWord[], cap = 1): HistoryBook => ({ words, characters: 1000, cap });

describe('words known over time', () => {
  it('adds each day the share read since, across two books', () => {
    const books = new Map([
      // 猫 16 times: known (8) at half the book; は is a particle
      [
        'A',
        book([
          ['猫', 'ねこ', 16, 100],
          ['は', null, 50, 1],
          ['犬', 'いぬ', 4, 200]
        ])
      ],
      // 犬 4 more times: with A's 4, known once both are read
      ['B', book([['犬', 'いぬ', 4, 200]])]
    ]);
    const points = knownHistory(
      [
        { title: 'B', dateKey: '2026-10-03', charactersRead: 1000 },
        { title: 'A', dateKey: '2026-10-01', charactersRead: 400 },
        { title: 'A', dateKey: '2026-10-02', charactersRead: 100 },
        { title: 'A', dateKey: '2026-10-03', charactersRead: 500 },
        { title: 'Unknown', dateKey: '2026-10-04', charactersRead: 500 }
      ],
      books
    );

    expect(points).toEqual([
      { dateKey: '2026-10-01', known: 0 },
      { dateKey: '2026-10-02', known: 1 },
      { dateKey: '2026-10-03', known: 2 }
    ]);
  });

  it('never counts more than the kanji record read, nor rereads', () => {
    const books = new Map([['A', book([['猫', 'ねこ', 10, 100]], 0.5)]]);

    expect(
      knownHistory(
        [
          { title: 'A', dateKey: '2026-10-01', charactersRead: 2000 },
          { title: 'A', dateKey: '2026-10-02', charactersRead: 2000 }
        ],
        books
      )
    ).toEqual([
      { dateKey: '2026-10-01', known: 0 },
      { dateKey: '2026-10-02', known: 0 }
    ]);
  });

  it('steps on test days and leaves the tests out of the words gained', () => {
    // 猫 within every cutoff, 犬 past it: both known by reading on 10-05.
    const books = new Map([
      [
        'A',
        book([
          ['猫', 'ねこ', 16, 100],
          ['犬', 'いぬ', 16, 5000]
        ])
      ]
    ]);
    const days = [
      { title: 'A', dateKey: '2026-09-28', charactersRead: 100 },
      { title: 'A', dateKey: '2026-10-05', charactersRead: 900 }
    ];
    const points = knownHistory(days, books, [
      { dateKey: '2026-09-01', cutoff: 1000 }, // first test: the baseline
      { dateKey: '2026-10-03', cutoff: 2000 }, // retake higher
      { dateKey: '2026-10-10', cutoff: 500 } // retake lower: the latest counts
    ]);

    expect(points).toEqual([
      { dateKey: '2026-09-01', known: 1000, tests: 1000 },
      { dateKey: '2026-09-28', known: 1000, tests: 1000 },
      { dateKey: '2026-10-03', known: 2000, tests: 2000 },
      // 猫 is within the cutoff already
      { dateKey: '2026-10-05', known: 2001, tests: 2000 },
      { dateKey: '2026-10-10', known: 501, tests: 500 }
    ]);
    expect(gainedThisMonth(points, '2026-10-19')).toBe(1);
  });

  it('turns dated results into the cutoff in force after each', () => {
    expect(
      cutoffChanges([
        { mode: 'yesno', date: 0, cutoff: 3000, length: 40 },
        { mode: 'yesno', date: new Date(2026, 9, 3, 12).getTime(), cutoff: 800, length: 40 },
        { mode: 'typed', date: new Date(2026, 9, 4, 12).getTime(), cutoff: 1500, length: 20 }
      ])
    ).toEqual([
      { dateKey: '', cutoff: 3000 },
      { dateKey: '2026-10-03', cutoff: 800 },
      // both modes: the stricter latest one
      { dateKey: '2026-10-04', cutoff: 800 }
    ]);
  });

  it('counts the words gained this month', () => {
    const points = [
      { dateKey: '2026-09-20', known: 100 },
      { dateKey: '2026-10-02', known: 130 },
      { dateKey: '2026-10-10', known: 150 }
    ];

    expect(gainedThisMonth(points, '2026-10-19')).toBe(50);
    expect(gainedThisMonth(points, '2026-11-01')).toBe(0);
    expect(gainedThisMonth([], '2026-10-19')).toBe(0);
  });
});
