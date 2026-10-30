/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageKey, StorageSourceDefault } from '$lib/data/storage/storage-types';

vi.mock('$lib/data/background-analysis', () => ({ analyseInBackground: vi.fn() }));

await import('$lib/data/storage/storage-handler-factory');
const { database } = await import('$lib/data/store');
const { storageSource$ } = await import('$lib/data/storage/storage-view');
const { calibreReceivedBooks$ } = await import('$lib/data/storage/handler/server-handler');
const { importReceived } = await import('$lib/data/book-transfer');

afterEach(() => vi.unstubAllGlobals());

describe('receiving a book from a friend', () => {
  it('under the Calibre source keeps it in this browser and sends nothing to the server', async () => {
    const fetch = vi.fn(async () => new Response('{}'));

    vi.stubGlobal('fetch', fetch);
    storageSource$.next(StorageKey.CALIBRE);

    await importReceived({
      title: '走れメロス (from Aki)',
      styleSheet: '',
      elementHtml: '<p>メロスは激怒した。</p>',
      blobs: {},
      coverImage: undefined,
      hasThumb: true,
      characters: 9,
      sections: [],
      lastBookModified: 1,
      lastBookOpen: 0
    });

    const urls = fetch.mock.calls.map((call) => String((call as unknown[])[0]));

    expect(urls.filter((url) => url.includes('/calibre/'))).toEqual([]);
    expect((await database.getDataByTitle('走れメロス (from Aki)'))?.storageSource).toBe(
      StorageSourceDefault.CALIBRE_DEFAULT
    );
    expect(calibreReceivedBooks$.getValue()).toContain('走れメロス (from Aki)');
  });
});
