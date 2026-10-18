/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { translate } from '$lib/i18n';
import { difficultyDescriptionKey, difficultyNameKey, difficultyNames } from './difficulty';

describe('difficulty bands', () => {
  it('follows the band of the score, clamped to the scale', () => {
    expect(difficultyDescriptionKey(-1)).toBe('difficulty.beginnerHint');
    expect(difficultyDescriptionKey(0.99)).toBe('difficulty.beginnerHint');
    expect(difficultyNameKey(2.4)).toBe('difficulty.average');
    expect(difficultyNameKey(5)).toBe('difficulty.insane');
    expect(difficultyDescriptionKey(7)).toBe('difficulty.insaneHint');
  });

  it('names the bands in English for the filters, in Japanese on request', () => {
    expect(difficultyNames).toEqual(['Beginner', 'Easy', 'Average', 'Hard', 'Expert', 'Insane']);
    expect(translate('ja', difficultyNameKey(1.5))).toBe('初級');
  });
});
