/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { translate, type MessageKey, type MessageParams } from '$lib/i18n';
import { formatDuration, relativeTime } from './format-time';

/*
 * How formatDuration could fail (written before the code):
 * - It rounds the minutes after taking the hours, so 7170 s (1 h 59.5 min) prints "1 h 60 min".
 * - Just under an hour (3570 s) it rolls into "1 h 0 min" or prints a negative or fractional minute.
 * - 0 s or under a minute prints '', NaN or "0 h 0 min" instead of "0 min".
 * - Exactly an hour loses its "0 min" (the dashboard keys always carry minutes).
 * - It ignores the UI language (the statistics copies were hard-coded English).
 * - The short style drops its compact "1h 5m" / "5m" form.
 */
const ja = (key: MessageKey, params?: MessageParams) => translate('ja', key, params);
const en = (key: MessageKey, params?: MessageParams) => translate('en', key, params);

describe('formatDuration', () => {
  it('never shows 60 minutes', () => {
    expect(formatDuration(7170, en)).toBe('1 h 59 min');
    expect(formatDuration(3570, en)).toBe('59 min');
    expect(formatDuration(3599.9, en)).toBe('59 min');
  });

  it('shows minutes under an hour and at zero', () => {
    expect(formatDuration(0, en)).toBe('0 min');
    expect(formatDuration(59, en)).toBe('0 min');
    expect(formatDuration(3600, en)).toBe('1 h 0 min');
    expect(formatDuration(3900, en)).toBe('1 h 5 min');
  });

  it('follows the UI language', () => {
    expect(formatDuration(3900, ja)).toBe('1時間5分');
    expect(formatDuration(300, ja)).toBe('5分');
  });

  it('has a compact style', () => {
    expect(formatDuration(7170, en, 'short')).toBe('1h 59m');
    expect(formatDuration(300, en, 'short')).toBe('5m');
  });
});

/*
 * How relativeTime could fail for the library table (its old copy went up to years):
 * it stops at days ("400 days ago") or uses the browser's locale rather than the UI language.
 */
describe('relativeTime', () => {
  const now = Date.UTC(2026, 0, 1);

  it('goes past days', () => {
    expect(relativeTime(now / 1000 - 400 * 86400, 'en', now)).toBe('last year');
    expect(relativeTime(now / 1000 - 14 * 86400, 'en', now)).toBe('2 weeks ago');
  });

  it('uses the language it is given', () => {
    expect(relativeTime(now / 1000 - 2 * 3600, 'ja', now)).toBe('2 時間前');
  });
});
