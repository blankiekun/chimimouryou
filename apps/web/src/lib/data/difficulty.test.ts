/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { translate } from '$lib/i18n';
import { levelGroup, levelGroupKey, levelTier } from './difficulty';

describe('book levels', () => {
  it('names the tier of the whole step and groups two steps, clamped to the scale', () => {
    expect([0.5, 1, 5.99, 10, 11].map(levelTier)).toEqual([
      'Slime',
      'Slime',
      'Ogre',
      'Demon King',
      'Demon King'
    ]);
    expect([1, 2.99, 3, 8.5, 10].map(levelGroup)).toEqual([0, 0, 1, 3, 4]);
    expect(translate('en', levelGroupKey(4))).toBe('Levels 9–10');
    expect(translate('ja', levelGroupKey(0))).toBe('レベル1〜2');
  });
});
