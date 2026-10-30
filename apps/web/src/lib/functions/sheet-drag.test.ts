/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { sheetSnap } from './sheet-drag';
import { nextRate } from '$lib/data/audio/now-playing';

describe('sheetSnap', () => {
  const half = 500;
  const full = 800;

  it('settles on the nearest height when let go slowly', () => {
    expect(sheetSnap(520, 0, half, full)).toBe('half');
    expect(sheetSnap(700, 0, half, full)).toBe('full');
    expect(sheetSnap(400, 0, half, full)).toBe('half');
  });

  it('closes past the threshold', () => {
    expect(sheetSnap(250, 0, half, full)).toBe('closed');
  });

  it('follows a flick', () => {
    expect(sheetSnap(510, -1, half, full)).toBe('full');
    expect(sheetSnap(780, 1, half, full)).toBe('half');
    expect(sheetSnap(480, 1, half, full)).toBe('closed');
    expect(sheetSnap(300, -1, half, full)).toBe('half');
  });

  it('stays at its height when it cannot grow', () => {
    expect(sheetSnap(500, -1, half, half)).toBe('half');
    expect(sheetSnap(500, 0, half, half)).toBe('half');
  });
});

describe('nextRate', () => {
  it('steps up and wraps', () => {
    expect(nextRate([0.75, 1, 1.5], 1)).toBe(1.5);
    expect(nextRate([0.75, 1, 1.5], 1.1)).toBe(1.5);
    expect(nextRate([0.75, 1, 1.5], 1.5)).toBe(0.75);
  });
});
