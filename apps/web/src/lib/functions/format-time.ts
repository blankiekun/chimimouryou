/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { tr, type MessageKey, type MessageParams } from '$lib/i18n';

/**
 * "1 h 5 min" (`dashboard.*` keys) for a number of seconds; 'short' is the compact "1h 5m".
 * Whole minutes are taken first, so 59.5 minutes is never shown as "60 min".
 */
export function formatDuration(
  seconds: number,
  t: (key: MessageKey, params?: MessageParams) => string = tr,
  style: 'long' | 'short' = 'long'
) {
  const total = Math.floor(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;

  // shortcut: the short style is English in both UI languages, as the profile had it; add keys if Japanese should differ.
  if (style === 'short') return hours ? `${hours}h ${minutes}m` : `${minutes}m`;

  return hours ? t('dashboard.hours', { hours, minutes }) : t('dashboard.minutes', { minutes });
}

const units = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['week', 7 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60]
] as const;

/** "2 hours ago" for a Unix time (seconds), in `lang` */
export function relativeTime(seconds: number, lang: string, now = Date.now()) {
  const diff = Math.round(seconds - now / 1000);
  const format = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });

  for (const [unit, size] of units) {
    if (Math.abs(diff) >= size) return format.format(Math.round(diff / size), unit);
  }
  return format.format(0, 'minute');
}
