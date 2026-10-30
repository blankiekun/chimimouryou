/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { analysisKeepAlive } from './analysis-capacity';

describe('analysisKeepAlive', () => {
  it('keeps the worker on machines with room, or that do not say', () => {
    expect(analysisKeepAlive({ hardwareConcurrency: 8, deviceMemory: 8 })).toBeGreaterThan(0);
    expect(analysisKeepAlive({ hardwareConcurrency: 16 })).toBeGreaterThan(0);
    expect(analysisKeepAlive({})).toBeGreaterThan(0);
  });

  it('ends it after every job on small machines', () => {
    expect(analysisKeepAlive({ hardwareConcurrency: 4, deviceMemory: 8 })).toBe(0);
    expect(analysisKeepAlive({ hardwareConcurrency: 2 })).toBe(0);
    expect(analysisKeepAlive({ hardwareConcurrency: 12, deviceMemory: 4 })).toBe(0);
  });
});
