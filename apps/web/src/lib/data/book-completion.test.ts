/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';

const { db } = vi.hoisted(() => ({
  db: {
    finished: undefined as BooksDbStatistic | undefined,
    untilToday: [] as BooksDbStatistic[],
    getStatisticForCompletedBook: vi.fn(async () => db.finished),
    getStatisticsUntilDate: vi.fn(async () => db.untilToday),
    storeStatistics: vi.fn(async (..._args: unknown[]) => {})
  }
}));

vi.mock('$lib/data/store', () => ({ database: db }));
vi.mock('$lib/components/book-reader/book-reading-tracker/book-reading-tracker', () => ({
  getDefaultStatistic: (title: string, dateKey: string) => ({ title, dateKey })
}));

// The storage handlers import each other in a cycle: the factory first.
await import('$lib/data/storage/storage-handler-factory');
const { storeBookCompletion } = await import('./book-completion');
const { getDateKey } = await import('$lib/functions/statistic-util');

const stat = (dateKey: string, extra = {}) =>
  ({ title: 'T', dateKey, ...extra }) as unknown as BooksDbStatistic;

beforeEach(() => {
  vi.clearAllMocks();
  db.finished = undefined;
  db.untilToday = [];
});

describe('storeBookCompletion', () => {
  it('marks today as the completion of a book never completed', async () => {
    const result = await storeBookCompletion('T', 0, false);

    expect(result.stored).toEqual([result.todayStatistic]);
    expect(result.todayStatistic).toMatchObject({
      dateKey: getDateKey(0),
      completedBook: 1,
      completedData: { dateKey: getDateKey(0) }
    });
    expect(result.finishedStatistic).toBe(undefined);
    expect(db.storeStatistics).toHaveBeenCalledTimes(1);
  });

  it('keeps an earlier completion unless overwriting', async () => {
    db.finished = stat('2020-01-01', { completedBook: 1, completedData: {} });

    expect((await storeBookCompletion('T', 0, false)).stored).toEqual([]);
    expect(db.storeStatistics).not.toHaveBeenCalled();
  });

  it('moves an earlier completion to today when overwriting', async () => {
    const earlier = stat('2020-01-01', { completedBook: 1, completedData: {} });

    db.finished = earlier;

    const result = await storeBookCompletion('T', 0, true);

    expect(result.stored).toEqual([result.todayStatistic, earlier]);
    expect(result.finishedStatistic).toBe(earlier);
    expect(earlier.completedBook).toBe(undefined);
    expect(earlier.completedData).toBe(undefined);
  });

  it('rewrites today when it already is the completion day', async () => {
    const today = stat(getDateKey(0), { completedBook: 1 });

    db.finished = today;
    db.untilToday = [today];

    const result = await storeBookCompletion('T', 0, true);

    expect(result.stored).toEqual([today]);
    expect(result.finishedStatistic).toBe(undefined);
  });
});
