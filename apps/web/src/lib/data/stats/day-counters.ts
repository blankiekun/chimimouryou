/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Per-browser counts for today (not synced), for the Discord status: cards the dictionary popup
 * sent to Anki ({cardsMinedToday}) and visual novel lines read on /v and /hook ({linesToday}).
 * Days follow the statistics' start-of-day hour. Not part of upstream.
 */

import { getDateKey } from '$lib/functions/statistic-util';

export function dayCounter(key: string) {
  const read = (): { day?: unknown; count?: unknown } => {
    try {
      return JSON.parse(window.localStorage.getItem(key) || '{}') ?? {};
    } catch {
      return {};
    }
  };
  const today = (startDayHours: number, now = Date.now()) => {
    const last = read();

    return last.day === getDateKey(startDayHours, new Date(now)) && typeof last.count === 'number'
      ? last.count
      : 0;
  };

  return {
    today,
    add(startDayHours: number, now = Date.now()) {
      const day = getDateKey(startDayHours, new Date(now));

      try {
        window.localStorage.setItem(
          key,
          JSON.stringify({ day, count: today(startDayHours, now) + 1 })
        );
      } catch {
        // Storage full or blocked: the count only feeds the status.
      }
    }
  };
}

/** Cards added by the built-in popup (addAnkiNote) */
export const minedCards = dayCounter('ankiMinedToday');
/** Visual novel lines that added characters */
export const vnLines = dayCounter('vnLinesToday');
