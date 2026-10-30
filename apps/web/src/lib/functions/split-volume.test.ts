/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import fixture from './split-volume.json';
import { isSeriesName, splitVolume } from './split-volume';

// Rows come from build-catalog.py (test_build_catalog.py reads the same file). Catches the port
// drifting from the catalog: Unicode digits and whitespace, kanji 十/百, 上/下 before a number,
// edition labels (ブックス), trailing ～, author prefixes, bare numbers, empty titles, astral
// characters counted as one.
describe('splitVolume', () => {
  it.each(Object.entries(fixture.splitVolume))('%j', (title, expected) => {
    expect(splitVolume(title)).toEqual(expected);
  });
});

describe('isSeriesName', () => {
  it.each(Object.entries(fixture.isSeriesName))('%j', (name, expected) => {
    expect(isSeriesName(name)).toBe(expected);
  });
});
