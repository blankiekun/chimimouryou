/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import {
  addToHome,
  homeBookTitles$,
  homeRemovedTitles$,
  isContinueReading,
  matchingSeries,
  readNext,
  recentLevels,
  removeFromHome,
  seriesGroups,
  standaloneReadNext
} from './library-home';
import { filterBookCards, seriesFilterKey } from '$lib/components/book-card/library-filters';

const card = (title: string, series?: string, seriesIndex?: number, authors = '') =>
  ({ id: title.length, title, series, seriesIndex, authors }) as BookCardProps;

const cards = [
  card('魔女の旅々 2', '魔女の旅々', 2),
  card('魔女の旅々 1', '魔女の旅々', 1),
  card('Other', 'Single', 1),
  card('涼宮ハルヒの憂鬱', 'ハルヒ', 1, '谷川流'),
  card('涼宮ハルヒの溜息', 'ハルヒ', 2, '谷川流'),
  card('Standalone')
];

describe('matchingSeries', () => {
  it('finds series by name, book title or author, in reading order', () => {
    expect(matchingSeries(cards, '魔女').map((m) => m.books.map((b) => b.title))).toEqual([
      ['魔女の旅々 1', '魔女の旅々 2']
    ]);
    expect(matchingSeries(cards, '溜息')[0].series).toBe('ハルヒ');
    expect(matchingSeries(cards, '谷川')[0].books).toHaveLength(2);
  });

  it('skips one-book series and empty searches', () => {
    expect(matchingSeries(cards, 'other')).toEqual([]);
    expect(matchingSeries(cards, ' ')).toEqual([]);
  });
});

describe('home titles', () => {
  it('adds without duplicates and removes', () => {
    homeBookTitles$.next([]);
    addToHome(['a', 'b']);
    addToHome(['b', 'c']);
    removeFromHome('a');

    expect(homeBookTitles$.getValue()).toEqual(['b', 'c']);
  });

  it('hides a removed book from Continue reading until it is read again', () => {
    const reading = {
      title: 'r',
      progress: 0.5,
      lastBookOpen: 1,
      lastBookmarkModified: 0
    } as BookCardProps;

    expect(isContinueReading(reading, homeRemovedTitles$.getValue())).toBe(true);
    removeFromHome('r');
    expect(isContinueReading(reading, homeRemovedTitles$.getValue())).toBe(false);
    expect(
      isContinueReading({ ...reading, lastBookOpen: Date.now() + 1 }, homeRemovedTitles$.getValue())
    ).toBe(true);
    addToHome(['r']);
    expect(isContinueReading(reading, homeRemovedTitles$.getValue())).toBe(true);
  });
});

describe('seriesGroups', () => {
  it('groups books by series in reading order, first volume first', () => {
    const groups = seriesGroups([
      ...cards,
      { ...card('魔女の旅々 0'), series: '魔女の旅々', seriesIndex: null, progress: 0.5 }
    ]);

    expect(groups.map((g) => [g.series, g.books.map((b) => b.title)[0], g.books.length])).toEqual([
      ['Single', 'Other', 1],
      ['ハルヒ', '涼宮ハルヒの憂鬱', 2],
      ['魔女の旅々', '魔女の旅々 0', 3]
    ]);
    expect(groups[2].started).toBe(1);
  });

  it('filters the Store to one series', () => {
    expect(filterBookCards(cards, seriesFilterKey('ハルヒ'), '').map((c) => c.title)).toEqual([
      '涼宮ハルヒの憂鬱',
      '涼宮ハルヒの溜息'
    ]);
  });
});

describe('readNext', () => {
  let id = 0;
  const book = (title: string, props: Partial<BookCardProps> = {}) =>
    ({ id: ++id, title, progress: 0, ...props }) as BookCardProps;
  const done = (title: string, difficulty: number, lastBookOpen: number) =>
    book(title, { progress: 1, difficulty, lastBookOpen });

  it('is empty without a finished book with a difficulty', () => {
    expect(readNext([book('a', { difficulty: 2 }), book('b', { progress: 1 })], {})).toEqual([]);
  });

  it('puts next volumes first, then books near the median of the last 3 finished, by coverage', () => {
    const titles = readNext(
      [
        done('old', 5, 1),
        done('f1', 2, 10),
        done('f2', 3, 11),
        done('f3', 2.6, 12),
        book('S 1', { series: 'S', seriesIndex: 1, progress: 1, lastBookOpen: 5 }),
        book('S 2', { series: 'S', seriesIndex: 2, difficulty: 4.5 }),
        book('S 3', { series: 'S', seriesIndex: 3 }),
        book('near', { difficulty: 2.5, calibreId: 1 }),
        book('known', { difficulty: 2.8, calibreId: 2 }),
        book('far', { difficulty: 3.2 }),
        book('started', { difficulty: 2.6, progress: 0.2 })
      ],
      { 1: 0.5, 2: 0.9 }
    ).map((card) => card.title);

    expect(titles).toEqual(['S 2', 'known', 'near']);
  });

  it('takes an unstarted series only by its first unread volume', () => {
    const titles = readNext(
      [
        done('f', 2, 10),
        book('T 1', { series: 'T', seriesIndex: 1, difficulty: 1.9 }),
        book('T 2', { series: 'T', seriesIndex: 2, difficulty: 2 }),
        book('U 1', { series: 'U', seriesIndex: 1, difficulty: 3 }),
        book('U 2', { series: 'U', seriesIndex: 2, difficulty: 2 })
      ],
      {}
    ).map((card) => card.title);

    expect(titles).toEqual(['T 1']);
  });

  it('without a server, gives the next volumes of started series from their titles', () => {
    const titles = standaloneReadNext([
      book('魔女の旅々 1', { progress: 1, lastBookOpen: 5 }),
      book('魔女の旅々 3'),
      book('魔女の旅々 2'),
      book('86―エイティシックス― 1', { progress: 0.4, lastBookOpen: 9 }),
      book('86―エイティシックス― 2'),
      book('Unread 1'),
      book('Unread 2'),
      book('No volume', { progress: 1 })
    ]).map((card) => card.title);

    expect(titles).toEqual(['86―エイティシックス― 2', '魔女の旅々 2']);
  });

  it('without a server, adds the books near the level of the local estimates after them', () => {
    const titles = standaloneReadNext([
      book('魔女の旅々 1', { progress: 1, lastBookOpen: 5, difficulty: 3 }),
      book('魔女の旅々 2', { difficulty: 3 }),
      book('Far', { difficulty: 4 }),
      book('Near', { difficulty: 3.2 }),
      book('Nearer', { difficulty: 2.9 })
    ]).map((card) => card.title);

    expect(titles).toEqual(['魔女の旅々 2', 'Nearer', 'Near']);
  });

  it("gives Read next's level: the last 3 finished books, lowest first", () => {
    expect(
      recentLevels([done('a', 3, 1), done('b', 2, 4), done('c', 2.5, 3), done('d', 1, 2)])
    ).toEqual([1, 2, 2.5]);
  });
});
