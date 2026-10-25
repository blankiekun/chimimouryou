/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getStorageHandler, replicateData, dialogs, stores, sources } = vi.hoisted(() => ({
  getStorageHandler: vi.fn((_window: unknown, type: string, name: string) => ({ type, name })),
  replicateData: vi.fn(async (..._args: unknown[]) => ''),
  dialogs: { next: vi.fn() },
  stores: {} as Record<string, { getValue: () => unknown }>,
  sources: new Map<string, { type: string }>()
}));

vi.mock('$lib/data/storage/storage-handler-factory', () => ({ getStorageHandler }));
vi.mock('$lib/functions/replication/replicator', () => ({ replicateData }));
vi.mock('$lib/data/dialog-manager', () => ({ dialogManager: { dialogs$: dialogs } }));
vi.mock('$lib/components/message-dialog.svelte', () => ({ default: {} }));
vi.mock('$lib/data/store', async () => {
  const { BehaviorSubject: Subject } = await import('rxjs');
  const value = (v: unknown) => new Subject(v);

  Object.assign(stores, {
    autoReplication: new Subject('off'),
    isOnline: new Subject(true)
  });

  return {
    autoReplication$: stores.autoReplication,
    isOnline$: stores.isOnline,
    cacheStorageData$: value(false),
    replicationSaveBehavior$: value('newOnly'),
    statisticsMergeMode$: value('merge'),
    readingGoalsMergeMode$: value('merge'),
    database: { db: Promise.resolve({ get: async (_: string, name: string) => sources.get(name) }) }
  };
});

const { getStorageHandlerByName, saveExternalLastRead, syncDownData } = await import(
  './reader-storage'
);
const { StorageKey, StorageSourceDefault } = await import('./storage-types');

const online = stores.isOnline as BehaviorSubject<boolean>;
const autoReplication = stores.autoReplication as BehaviorSubject<string>;

beforeEach(() => {
  vi.clearAllMocks();
  online.next(true);
  autoReplication.next('off');
  sources.clear();
});

describe('getStorageHandlerByName', () => {
  it('opens the Calibre handler even offline', async () => {
    online.next(false);
    expect(await getStorageHandlerByName(StorageSourceDefault.CALIBRE_DEFAULT)).toMatchObject({
      type: StorageKey.CALIBRE
    });
  });

  it('shows the offline dialog for cloud targets', async () => {
    online.next(false);
    expect(await getStorageHandlerByName(StorageSourceDefault.GDRIVE_DEFAULT)).toBe(undefined);
    expect(dialogs.next).toHaveBeenCalledTimes(1);

    sources.set('mine', { type: StorageKey.FS });
    expect(await getStorageHandlerByName('mine')).toMatchObject({ type: StorageKey.FS });
  });

  it('throws or warns for an unknown source', async () => {
    await expect(getStorageHandlerByName('', true)).rejects.toThrow('No storage source found');
    expect(await getStorageHandlerByName('')).toBe(undefined);
    await expect(getStorageHandlerByName('gone', true)).rejects.toThrow('gone');
    expect(await getStorageHandlerByName('gone')).toBe(undefined);
    expect(dialogs.next).toHaveBeenCalledTimes(1);
  });
});

describe('saveExternalLastRead', () => {
  const book = { id: 7, title: 'T', elementHtml: '<p/>', lastBookOpen: 5 } as any;

  it('takes the source copy of a sourced book, keeping the local id and open time', async () => {
    const handler = {
      getBook: async () => ({ id: 1, title: 'T', elementHtml: 'remote', lastBookOpen: 1 }),
      updateLastRead: vi.fn(async () => {})
    } as any;
    const result = await saveExternalLastRead(handler, { ...book, storageSource: 'src' });

    expect(result).toMatchObject({ id: 7, elementHtml: 'remote', lastBookOpen: 5 });
    expect(handler.updateLastRead).toHaveBeenCalledWith(result);
  });

  it('needs the book text for a book without a source', async () => {
    const handler = { updateLastRead: async () => {} } as any;

    await expect(saveExternalLastRead(handler, { ...book, elementHtml: '' })).rejects.toThrow(
      'Book has no data stored'
    );
    expect(await saveExternalLastRead(undefined, book)).toBe(book);
  });

  it('shows a failed update and still returns the data', async () => {
    const handler = { updateLastRead: async () => Promise.reject(new Error('down')) } as any;

    expect(await saveExternalLastRead(handler, book)).toMatchObject({ id: 7 });
    expect(dialogs.next).toHaveBeenCalledTimes(1);
  });
});

describe('syncDownData', () => {
  const context = { id: 1, title: 'T' };
  const local = {} as any;

  it('downloads from Calibre always and elsewhere only with down sync', async () => {
    const calibre = { storageType: StorageKey.CALIBRE, startContext: vi.fn() } as any;
    const drive = { storageType: StorageKey.GDRIVE, startContext: vi.fn() } as any;

    await syncDownData(local, calibre, context);
    await syncDownData(local, drive, context);
    expect(replicateData).toHaveBeenCalledTimes(1);
    expect(drive.startContext).toHaveBeenCalledWith(context);

    autoReplication.next('down');
    await syncDownData(local, drive, context);
    expect(replicateData).toHaveBeenCalledTimes(2);
  });

  it('throws the replication error', async () => {
    replicateData.mockResolvedValueOnce('broken');

    await expect(
      syncDownData(local, { storageType: StorageKey.CALIBRE, startContext() {} } as any, context)
    ).rejects.toThrow('broken');
  });
});
