/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('standalone edition', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_EDITION', 'standalone');
    vi.stubGlobal('fetch', fetchMock);
    // A Calibre source saved by a server build on the same origin.
    window.localStorage.setItem('lastStorageSource', 'calibre');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    window.localStorage.clear();
  });

  it('offers no Calibre source and starts on Browser', async () => {
    const view = await import('$lib/data/storage/storage-view');

    expect(view.calibreSourceAvailable).toBe(false);
    expect(view.browserSourceAvailable).toBe(true);
    expect(view.storageSource$.getValue()).toBe('browser');
  });

  it('never asks the server for the catalog, estimates or the session', async () => {
    const calibre = await import('$lib/data/calibre');
    const account = await import('$lib/data/account');
    const { loadSeriesOverrides } = await import('$lib/data/series-overrides');
    const { loadBookMetadata } = await import('$lib/data/book-metadata');

    expect(await calibre.loadCalibreCatalog()).toEqual([]);
    expect(await calibre.loadCalibreDifficulty()).toEqual({});
    expect(await loadSeriesOverrides()).toEqual({});
    expect(await loadBookMetadata()).toEqual({});
    expect(await account.accountReady()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never constructs the Calibre handler', async () => {
    const { getStorageHandler } = await import('$lib/data/storage/storage-handler-factory');
    const { StorageKey } = await import('$lib/data/storage/storage-types');

    expect(() => getStorageHandler(window, StorageKey.CALIBRE)).toThrow(/server/);
  });
});
