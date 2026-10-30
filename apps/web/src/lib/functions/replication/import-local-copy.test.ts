/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageKey } from '$lib/data/storage/storage-types';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';

vi.mock('$lib/data/env', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  standalone: true
}));

const analyseInBackground = vi.fn();

vi.mock('$lib/data/analysis/background-analysis', () => ({ analyseInBackground }));

const { database } = await import('$lib/data/store');
const { importData, replicateData, LOCAL_COPY_LIMIT } = await import(
  '$lib/functions/replication/replicator'
);
const { StorageDataType } = await import('$lib/data/storage/storage-types');

/** A Drive source; its uploads only count calls. */
function drive() {
  return {
    storageType: StorageKey.GDRIVE,
    isCacheDisabled: () => false,
    clearData: vi.fn(),
    startContext: vi.fn(),
    saveCover: vi.fn(),
    getCurrentStorageSource: () => 'My Drive',
    isUpToDate: async () => false,
    saveBook: vi.fn(async (_book: unknown) => 0)
  };
}

const txt = (name: string) => new File([`${name} text`], `${name}.txt`);

async function localTitles() {
  return (await (await database.db).getAll('data')).map((book) => [book.title, book.storageSource]);
}

function freeStorage(free: number | undefined) {
  vi.stubGlobal('navigator', {
    ...navigator,
    storage: {
      estimate: async () => (free === undefined ? {} : { quota: free + 1000, usage: 1000 })
    }
  });
}

beforeEach(async () => {
  await (await database.db).clear('data');
  analyseInBackground.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('importing into Drive in the standalone', () => {
  it('uploads the book and keeps a copy in the browser under the Drive source', async () => {
    const handler = drive();

    await importData(document, handler as any, [txt('one')], new AbortController().signal);

    expect(handler.saveBook).toHaveBeenCalledTimes(1);
    expect(await localTitles()).toEqual([['one', 'My Drive']]);
    expect(analyseInBackground).toHaveBeenCalledWith(['one']);
  });

  it(`keeps only the first ${LOCAL_COPY_LIMIT} books of a big import`, async () => {
    const handler = drive();
    const files = Array.from({ length: LOCAL_COPY_LIMIT + 2 }, (_, i) => txt(`book${i}`));

    await importData(document, handler as any, files, new AbortController().signal);

    expect(handler.saveBook).toHaveBeenCalledTimes(LOCAL_COPY_LIMIT + 2);
    expect(await localTitles()).toHaveLength(LOCAL_COPY_LIMIT);
  });

  it('keeps none when the browser is short of storage', async () => {
    freeStorage(100 * 1024 ** 2);

    await importData(document, drive() as any, [txt('one')], new AbortController().signal);

    expect(await localTitles()).toEqual([]);
  });

  it('keeps them when the browser has room or will not say', async () => {
    freeStorage(2 * 1024 ** 3);
    await importData(document, drive() as any, [txt('one')], new AbortController().signal);

    freeStorage(undefined);
    await importData(document, drive() as any, [txt('two')], new AbortController().signal);

    expect(await localTitles()).toEqual([
      ['one', 'My Drive'],
      ['two', 'My Drive']
    ]);
  });

  // Bug: a book whose upload failed keeps a Drive-tagged local copy, so it looks synced but is on no other device.
  it('keeps Drive-tagged copies only of the books that reached Drive when one upload fails', async () => {
    const handler = drive();

    handler.saveBook.mockImplementation(async (book: any) => {
      if (book.title === 'two') throw new Error('Drive upload failed');
      return 0;
    });

    const error = await importData(
      document,
      handler as any,
      [txt('one'), txt('two'), txt('three')],
      new AbortController().signal
    );

    expect(error).toContain('two');
    expect(await localTitles()).toEqual([
      ['one', 'My Drive'],
      ['three', 'My Drive']
    ]);
  });

  it('never takes over a browser-library book with the same title', async () => {
    await database.upsertData(
      { title: 'one', elementHtml: '<p>mine</p>', storageSource: undefined } as any,
      ReplicationSaveBehavior.Overwrite,
      false,
      false
    );

    await importData(document, drive() as any, [txt('one')], new AbortController().signal);

    expect(await localTitles()).toEqual([['one', undefined]]);
  });
});

describe('replicating browser books to Drive', () => {
  it('uploads them without re-tagging or copying them', async () => {
    const handler = drive();

    await database.upsertData(
      {
        title: 'one',
        styleSheet: '',
        elementHtml: '<p>mine</p>',
        blobs: {},
        coverImage: '',
        hasThumb: true,
        characters: 4,
        sections: [],
        lastBookModified: 1,
        lastBookOpen: 1,
        storageSource: undefined
      } as any,
      ReplicationSaveBehavior.Overwrite,
      false,
      false
    );

    const { getStorageHandler } = await import('$lib/data/storage/storage-handler-factory');

    await replicateData(
      getStorageHandler(window, StorageKey.BROWSER, undefined, true, true),
      handler as any,
      false,
      [{ title: 'one' }],
      [StorageDataType.DATA]
    );

    expect(handler.saveBook).toHaveBeenCalledTimes(1);
    expect(await localTitles()).toEqual([['one', undefined]]);
  });
});

describe('opening a Drive book cached in the browser', () => {
  async function driveHandler(remoteModified: number) {
    const { getStorageHandler } = await import('$lib/data/storage/storage-handler-factory');
    const handler = getStorageHandler(window, StorageKey.GDRIVE, undefined, true) as any;
    const book = { title: 'one', elementHtml: '<p>remote</p>' };

    vi.spyOn(handler, 'getExternalFile').mockImplementation(async () => ({
      file: { name: `bookdata_1_6_4_${remoteModified}_0.zip` }
    }));
    vi.spyOn(handler, 'downloadBook').mockImplementation(async () => book);
    handler.startContext({ title: 'one' });

    await database.upsertData(
      {
        title: 'one',
        elementHtml: '<p>local</p>',
        lastBookModified: 100,
        storageSource: handler.getCurrentStorageSource()
      } as any,
      ReplicationSaveBehavior.Overwrite,
      false,
      false
    );

    return { handler, book };
  }

  it('reads the local copy when the Drive copy is not newer', async () => {
    const { handler } = await driveHandler(100);

    expect(await handler.getBook()).toBeUndefined();
    expect(handler.downloadBook).not.toHaveBeenCalled();
  });

  it('downloads a newer Drive copy', async () => {
    const { handler, book } = await driveHandler(200);

    expect(await handler.getBook()).toBe(book);
    expect(handler.downloadBook).toHaveBeenCalledTimes(1);
  });
});
