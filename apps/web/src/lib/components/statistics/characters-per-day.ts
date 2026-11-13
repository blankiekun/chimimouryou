/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { countsAsRead, readingTotals, rowCharacters } from '$lib/data/stats/learner-stats';
import { advanceDateDays, getDate } from '$lib/functions/statistic-util';

/** Not part of upstream: the Statistics page's "Characters per day" bars and period totals. */

export interface CharactersBar {
  /** First day of the bar (yyyy-mm-dd) */
  key: string;
  /** Last day of the bar; equal to key for a day */
  end: string;
  characters: number;
}

/** Longest period drawn one bar per day; longer ones get one bar per month. */
export const maxDailyBars = 92;

export function charactersPerDay(
  entries: { dateKey: string; charactersRead: number; readingTime?: number }[],
  start: string,
  end: string
): CharactersBar[] {
  if (!start || !end || start > end) return [];

  const byDay = new Map<string, number>();

  entries.forEach((entry) =>
    byDay.set(entry.dateKey, (byDay.get(entry.dateKey) || 0) + rowCharacters(entry))
  );

  const days: string[] = [];
  const date = getDate(start);

  for (let day = start; day <= end; { dateString: day } = advanceDateDays(date)) {
    days.push(day);
  }

  if (days.length <= maxDailyBars) {
    return days.map((day) => ({ key: day, end: day, characters: byDay.get(day) || 0 }));
  }

  const months: CharactersBar[] = [];

  days.forEach((day) => {
    const last = months[months.length - 1];
    const characters = byDay.get(day) || 0;

    if (last && last.key.slice(0, 7) === day.slice(0, 7)) {
      last.end = day;
      last.characters += characters;
    } else {
      months.push({ key: day, end: day, characters });
    }
  });

  return months;
}

export function periodTotals(
  entries: { dateKey: string; title: string; readingTime: number; charactersRead: number }[]
) {
  const counted = entries.filter(countsAsRead);
  const days = new Set(counted.map((entry) => entry.dateKey));
  const titles = new Set(counted.map((entry) => entry.title));

  return {
    ...readingTotals(counted),
    days: days.size,
    titles: titles.size
  };
}
