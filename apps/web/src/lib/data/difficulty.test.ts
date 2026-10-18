/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { difficultyDescription, difficultyDescriptions, difficultyNames } from './difficulty';

describe('difficultyDescription', () => {
  it('has one description per band', () => {
    expect(difficultyDescriptions).toHaveLength(difficultyNames.length);
  });

  it('follows the band of the score, clamped to the scale', () => {
    expect(difficultyDescription(-1)).toBe(difficultyDescriptions[0]);
    expect(difficultyDescription(0.99)).toBe(difficultyDescriptions[0]);
    expect(difficultyDescription(2.4)).toBe(difficultyDescriptions[2]);
    expect(difficultyDescription(5)).toBe(difficultyDescriptions[5]);
    expect(difficultyDescription(7)).toBe(difficultyDescriptions[5]);
  });
});
