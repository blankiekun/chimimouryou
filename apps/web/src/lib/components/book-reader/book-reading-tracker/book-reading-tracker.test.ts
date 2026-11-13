/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { holdTracker, isTrackerPaused$ } from './book-reading-tracker';

describe('holdTracker', () => {
  it('resumes a running tracker on release', () => {
    isTrackerPaused$.next(false);
    const release = holdTracker(true);
    expect(isTrackerPaused$.getValue()).toBe(true);
    release();
    expect(isTrackerPaused$.getValue()).toBe(false);
  });

  it('leaves a paused tracker paused', () => {
    isTrackerPaused$.next(true);
    holdTracker(true)();
    expect(isTrackerPaused$.getValue()).toBe(true);
  });

  it('keeps the first snapshot when holds overlap (double-click on sync)', () => {
    isTrackerPaused$.next(false);
    const first = holdTracker(true);
    const second = holdTracker(true);
    second();
    expect(isTrackerPaused$.getValue()).toBe(true);
    first();
    expect(isTrackerPaused$.getValue()).toBe(false);
  });

  it('does nothing with statistics off', () => {
    isTrackerPaused$.next(false);
    holdTracker(false)();
    expect(isTrackerPaused$.getValue()).toBe(false);
  });
});
