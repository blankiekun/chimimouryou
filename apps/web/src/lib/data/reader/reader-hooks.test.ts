/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const { plugin, recordKanjiSeen } = vi.hoisted(() => ({
  plugin: { onPositionSettled: vi.fn(), onBookOpened: vi.fn(), onBookLeft: vi.fn() },
  recordKanjiSeen: vi.fn()
}));

vi.mock('$lib/plugins', () => ({ activePlugins: () => [plugin, {}] }));
vi.mock('$lib/data/words/kanji-seen', () => ({ recordKanjiSeen }));

const { bookOpened, positionSettled } = await import('./reader-hooks');

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('reader hooks', () => {
  const index = { paragraphs: [] };
  const getIndex = async () => index;

  it('records kanji seen and tells the plugins where the reading settled', async () => {
    positionSettled('T', getIndex, 10, 100);

    expect(plugin.onPositionSettled).toHaveBeenCalledWith('T', getIndex, 10, 100);
    await Promise.resolve();
    expect(recordKanjiSeen).toHaveBeenCalledWith('T', index, 10);
  });

  it('runs the open hooks once the browser idles', () => {
    vi.useFakeTimers();
    bookOpened('T', getIndex);

    expect(plugin.onBookOpened).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(plugin.onBookOpened).toHaveBeenCalledWith('T', getIndex);
  });
});
