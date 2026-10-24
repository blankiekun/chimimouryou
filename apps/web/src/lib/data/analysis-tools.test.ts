/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analysisToolsSize, usesReader } from '$lib/data/analysis-tools';

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

  it('runs the Reader for word lists only while furigana is installed, or with older tools', () => {
    const tagged = {
      version: '2',
      files: [{ name: 'reader.ygp.gz', bytes: 1, features: ['furigana' as const] }]
    };
    const old = { version: '1', files: [{ name: 'reader.ygp.gz', bytes: 1 }] };

    expect(usesReader('readings', tagged, false)).toBe(true);
    expect(usesReader('words', tagged, true)).toBe(true);
    expect(usesReader('words', tagged, false)).toBe(false);
    expect(usesReader('words', old, false)).toBe(true);
  });
});
