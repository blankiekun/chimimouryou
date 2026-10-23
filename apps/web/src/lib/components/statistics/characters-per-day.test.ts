/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { charactersPerDay, periodTotals } from './characters-per-day';

const entry = (dateKey: string, charactersRead: number, title = 'A', readingTime = 60) => ({
  dateKey,
  charactersRead,
  title,
  readingTime
});

describe('charactersPerDay', () => {
  it('gives one bar per day, empty days included, entries of a day summed', () => {
    const bars = charactersPerDay(
      [entry('2026-10-01', 100), entry('2026-10-01', 50, 'B'), entry('2026-10-03', 10)],
      '2026-09-30',
      '2026-10-03'
    );

    expect(bars.map((bar) => [bar.key, bar.characters])).toEqual([
      ['2026-09-30', 0],
      ['2026-10-01', 150],
      ['2026-10-02', 0],
      ['2026-10-03', 10]
    ]);
  });

  it('groups long periods by month', () => {
    const bars = charactersPerDay(
      [entry('2026-01-05', 100), entry('2026-01-20', 20), entry('2026-12-31', 7)],
      '2026-01-01',
      '2026-12-31'
    );

    expect(bars).toHaveLength(12);
    expect(bars[0]).toEqual({ key: '2026-01-01', end: '2026-01-31', characters: 120 });
    expect(bars[11]).toEqual({ key: '2026-12-01', end: '2026-12-31', characters: 7 });
  });

  it('is empty for a reversed or missing range', () => {
    expect(charactersPerDay([], '2026-10-02', '2026-10-01')).toEqual([]);
    expect(charactersPerDay([], '', '2026-10-01')).toEqual([]);
  });
});

describe('periodTotals', () => {
  it('sums characters and time and counts days and titles', () => {
    expect(
      periodTotals([
        entry('2026-10-01', 600, 'A', 60),
        entry('2026-10-01', 300, 'B', 60),
        entry('2026-10-02', 300, 'A', 120)
      ])
    ).toEqual({ characters: 1200, time: 240, speed: 18000, days: 2, titles: 2 });
    expect(periodTotals([])).toEqual({ characters: 0, time: 0, speed: 0, days: 0, titles: 0 });
  });
});
