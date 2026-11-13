/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { dayCounter } from './day-counters';

describe('dayCounter', () => {
  beforeEach(() => window.localStorage.clear());

  it('counts today and starts again on the next day (start-of-day hour)', () => {
    const counter = dayCounter('testCount');
    const evening = new Date(2026, 10, 13, 22).getTime();
    const night = new Date(2026, 10, 14, 2).getTime();
    const morning = new Date(2026, 10, 14, 5).getTime();

    counter.add(4, evening);
    counter.add(4, night);
    expect(counter.today(4, night)).toBe(2);
    expect(counter.today(4, morning)).toBe(0);
    counter.add(4, morning);
    expect(counter.today(4, morning)).toBe(1);
  });

  it('reads broken storage as zero', () => {
    window.localStorage.setItem('testCount', '{');
    expect(dayCounter('testCount').today(0)).toBe(0);
  });
});
