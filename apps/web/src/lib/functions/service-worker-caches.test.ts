/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { staleServiceWorkerCaches } from './service-worker-caches';

describe('staleServiceWorkerCaches', () => {
  it('deletes only its own old caches', () => {
    const names = [
      'chimi:build:2',
      'chimi:build:1',
      'chimi:other:1',
      'chimi:ui-font',
      'build:1700000000000',
      'other:1700000000000',
      'vn-engine',
      'ui-font',
      'ttu-userfonts',
      'ttu-vn:Some game',
      'site',
      'build:v1'
    ];

    expect(staleServiceWorkerCaches(names, ['chimi:build:2', 'chimi:ui-font'])).toEqual([
      'chimi:build:1',
      'chimi:other:1',
      'build:1700000000000',
      'other:1700000000000',
      'vn-engine',
      'ui-font'
    ]);
  });
});
