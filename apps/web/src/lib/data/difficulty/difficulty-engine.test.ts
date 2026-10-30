/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { canonicalEngine, isCanonicalEstimate } from '$lib/data/difficulty/difficulty-engine';

describe('isCanonicalEstimate', () => {
  it("accepts only this release's engine", () => {
    expect(canonicalEngine).toMatch(/^[0-9a-f]{64}$/);
    expect(isCanonicalEstimate({ engine: canonicalEngine })).toBe(true);
    expect(isCanonicalEstimate({ engine: '0'.repeat(64) })).toBe(false);
  });

  it('treats estimates without an engine as unknown', () => {
    expect(isCanonicalEstimate({})).toBe(false);
    expect(isCanonicalEstimate(undefined)).toBe(false);
    expect(isCanonicalEstimate(null)).toBe(false);
  });
});
