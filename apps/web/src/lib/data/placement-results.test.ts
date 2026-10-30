/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  mergePlacementResults,
  placementAt,
  placementCutoff,
  placementCutoff$,
  placementResults$,
  recordPlacement,
  type PlacementRecord
} from '$lib/data/placement';

const result = (date: number, cutoff: number, mode: PlacementRecord['mode'] = 'yesno') => ({
  mode,
  date,
  cutoff,
  length: 40
});

describe('placement results', () => {
  it('lets a retake replace the result, lower or higher', () => {
    vi.useFakeTimers();
    placementResults$.next([]);
    recordPlacement('yesno', 4000, 40);
    expect(placementCutoff$.getValue()).toBe(4000);
    vi.advanceTimersByTime(1000);
    recordPlacement('yesno', 1500, 20);
    expect(placementCutoff$.getValue()).toBe(1500);
    vi.advanceTimersByTime(1000);
    recordPlacement('yesno', 6000, 60);
    expect(placementCutoff$.getValue()).toBe(6000);
    expect(placementResults$.getValue()).toHaveLength(3);
    vi.useRealTimers();
  });

  it('keeps both devices’ results when merging, by date', () => {
    const phone = [result(1, 1000), result(5, 3000)];
    const desktop = [result(1, 1000), result(3, 2000)];
    const merged = mergePlacementResults(phone, desktop);

    expect(merged.map(({ date }) => date)).toEqual([1, 3, 5]);
    expect(mergePlacementResults(desktop, phone)).toEqual(merged);
    expect(placementAt(merged)?.cutoff).toBe(3000);
    expect(placementAt(merged, 4)?.cutoff).toBe(2000);
    expect(placementAt(merged, 0)).toBeUndefined();
  });

  it('takes the stricter of the modes’ latest results', () => {
    const results = [result(1, 1000, 'typed'), result(2, 5000), result(3, 4000, 'typed')];

    expect(placementAt(results)?.cutoff).toBe(4000);
    expect(placementAt(results, 2)?.cutoff).toBe(1000);

    // recordPlacement keeps a typed result as its own record beside the yes/no one.
    vi.useFakeTimers();
    placementResults$.next([]);
    recordPlacement('yesno', 20000, 40);
    expect(placementCutoff()).toBe(20000);
    vi.advanceTimersByTime(1000);
    recordPlacement('typed', 12000, 40);
    expect(placementCutoff()).toBe(12000);
    expect(
      placementResults$
        .getValue()
        .map(({ mode }) => mode)
        .sort()
    ).toEqual(['typed', 'yesno']);
    placementResults$.next([]);
    vi.useRealTimers();
  });

  it('ignores the retired multiple-choice hard mode', () => {
    expect(placementAt([result(1, 5000), result(2, 398000, 'hard')])?.cutoff).toBe(5000);
    expect(placementAt([result(2, 398000, 'hard')])).toBeUndefined();
  });
});
