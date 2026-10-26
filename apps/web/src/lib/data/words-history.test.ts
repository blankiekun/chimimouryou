/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { BookWord } from '$lib/data/book-words';
import { summarizeWords } from '$lib/data/words-met';
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

  it('counts as words-met does: a form without a reading joins its reading, noise left out', () => {
    const books = new Map([
      [
        'A',
        book([
          ['呟く', 'つぶやく', 4, 9000],
          ['三', null, 20, null]
        ])
      ],
      ['B', book([['呟く', null, 4, 9000]])]
    ]);
    const points = knownHistory(
      [
        { title: 'A', dateKey: '2026-10-01', charactersRead: 1000 },
        { title: 'B', dateKey: '2026-10-02', charactersRead: 1000 }
      ],
      books
    );

    expect(points.map((point) => point.known)).toEqual([0, 1]);
  });

  it("starts from the test's estimate and ends at words-met's total, Anki words and marks in", () => {
    const books = new Map([
      [
        'A',
        book([
          ['猫', 'ねこ', 16, 500],
          ['犬', 'いぬ', 16, 5000]
        ])
      ]
    ]);
    const placement = { cutoff: 5000, words: 6000, curve: { shift: 0, slope: -2, firstNo: 1000 } };
    const anki = new Set(['犬', '魑魅']);
    const marks = {
      '謎語\t': { status: 'known' as const, modified: new Date(2026, 9, 3, 12).getTime() }
    };
    const formRanks = { 魑魅: 50000, 謎語: null };
    const points = knownHistory(
      [{ title: 'A', dateKey: '2026-10-01', charactersRead: 1000 }],
      books,
      [{ dateKey: '', ...placement }],
      { anki, marks, formRanks }
    );

    // 6000, 犬 +0.5 (rank 5000), 魑魅 +0.99 from the start; the mark +1 on its day.
    expect(points).toEqual([
      { dateKey: '2026-10-01', known: 6001, tests: 6000 },
      { dateKey: '2026-10-03', known: 6002, tests: 6000 }
    ]);
    expect(points.at(-1)!.known).toBe(
      summarizeWords(
        { '猫\tねこ': 16, '犬\tいぬ': 16 },
        anki,
        marks,
        placement,
        { '猫\tねこ': 500, '犬\tいぬ': 5000 },
        formRanks
      ).known
    );
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
