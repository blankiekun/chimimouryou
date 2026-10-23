/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

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
  entries: { dateKey: string; charactersRead: number }[],
  start: string,
  end: string
): CharactersBar[] {
  if (!start || !end || start > end) return [];

  const byDay = new Map<string, number>();

  entries.forEach(({ dateKey, charactersRead }) =>
    byDay.set(dateKey, (byDay.get(dateKey) || 0) + charactersRead)
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
  const days = new Set<string>();
  const titles = new Set<string>();
  let characters = 0;
  let time = 0;

  entries.forEach((entry) => {
    days.add(entry.dateKey);
    titles.add(entry.title);
    characters += entry.charactersRead;
    time += entry.readingTime;
  });

  return {
    characters,
    time,
    speed: time ? Math.ceil((3600 * characters) / time) : 0,
    days: days.size,
    titles: titles.size
  };
}
