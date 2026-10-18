/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { translate, type MessageKey } from '$lib/i18n';
import { libraryFilterLabel, seriesFilterKey } from './library-filters';

describe('libraryFilterLabel', () => {
  const ja = (key: MessageKey) => translate('ja', key);

  it('translates filters by their stored key and keeps series names', () => {
    expect(libraryFilterLabel('difficulty-1', ja)).toBe('初級');
    expect(libraryFilterLabel('unread', ja)).toBe('未読');
    expect(libraryFilterLabel('gone', (key) => translate('en', key))).toBe('All books');
    expect(libraryFilterLabel(seriesFilterKey('薬屋のひとりごと'), ja)).toBe('薬屋のひとりごと');
  });
});
