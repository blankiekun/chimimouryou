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

  it('hands out the browser handler for Calibre', async () => {
    const { getStorageHandler } = await import('$lib/data/storage/storage-handler-factory');
    const { StorageKey } = await import('$lib/data/storage/storage-types');

    expect(getStorageHandler(window, StorageKey.CALIBRE)).toBe(
      getStorageHandler(window, StorageKey.BROWSER)
    );
  });

  describe('connected to a server', () => {
    beforeEach(() => {
      window.localStorage.setItem('serverBase', 'https://books.example');
      window.localStorage.setItem('serverToken', 'secret-token');
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ books: [] })));
    });

    it('offers the Calibre source and reads the catalog with the token, without cookies', async () => {
      const view = await import('$lib/data/storage/storage-view');
      const calibre = await import('$lib/data/calibre');

      expect(view.calibreSourceAvailable).toBe(true);
      await calibre.loadCalibreCatalog();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://books.example/calibre/catalog.json');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret-token');
      expect(init.credentials).toBe('omit');
      expect(url).not.toContain('secret-token');
    });

    it('leaves other URLs alone', async () => {
      const { serverUrl } = await import('$lib/data/server');

      expect(serverUrl('/calibre/sync/a')).toBe('https://books.example/calibre/sync/a');
      expect(serverUrl('/jiten/search')).toBe('/jiten/search');
      expect(serverUrl('https://api.example/calibre/x')).toBe('https://api.example/calibre/x');
    });

    it('is ignored by the self-hosted build', async () => {
      vi.stubEnv('VITE_EDITION', '');
      const { serverConnected, serverUrl } = await import('$lib/data/server');

      expect(serverConnected).toBe(false);
      expect(serverUrl('/calibre/catalog.json')).toBe('/calibre/catalog.json');
    });
  });

  it('accepts only https server addresses', async () => {
    const { serverOrigin } = await import('$lib/data/server');

    expect(serverOrigin('books.example/')).toBe('https://books.example');
    expect(serverOrigin(' https://books.example:8443/x ')).toBe('https://books.example:8443');
    expect(() => serverOrigin('http://192.0.2.1')).toThrow(/HTTPS/);
  });
});
