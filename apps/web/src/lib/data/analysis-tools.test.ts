/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analysisToolsSize } from '$lib/data/analysis-tools';

describe('analysis tools', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sizes the download by the features chosen, shared files once', async () => {
    const manifest = {
      version: '1',
      files: [
        { name: 'shared.wasm', bytes: 100 },
        { name: 'model.onnx', bytes: 20, features: ['difficulty'] },
        { name: 'readings.zip', bytes: 3, features: ['furigana'] }
      ]
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(manifest)))
    );
    vi.stubGlobal('caches', { open: async () => ({ match: async () => undefined }) });

    expect(await analysisToolsSize(['difficulty'])).toBe(120);
    expect(await analysisToolsSize(['furigana'])).toBe(103);
    expect(await analysisToolsSize(['difficulty', 'furigana'])).toBe(123);
  });
});
