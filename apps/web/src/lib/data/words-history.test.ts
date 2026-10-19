/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { BookWord } from '$lib/data/book-words';
import { gainedThisMonth, knownHistory, type HistoryBook } from '$lib/data/words-history';

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
