/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getStorageHandler,
  ownStorageHandler,
  replicateData,
  dialogs,
  stores,
  sources,
  books,
  holdsAccountData,
  connection
} = vi.hoisted(() => ({
  getStorageHandler: vi.fn((_window: unknown, type: string, name: string) => ({ type, name })),
  ownStorageHandler: vi.fn((_window: unknown, own: string) => ({ own, updateSettings: () => {} })),
  replicateData: vi.fn(async (..._args: unknown[]) => ''),
  dialogs: { next: vi.fn() },
  stores: {} as Record<string, { getValue: () => unknown }>,
  sources: new Map<string, { type: string }>(),
  books: new Map<string, Record<string, unknown>>(),
  holdsAccountData: vi.fn(async () => false),
  connection: { serverless: false }
}));

vi.mock('$lib/data/storage/storage-handler-factory', () => ({
  getStorageHandler,
  ownStorageHandler
}));
vi.mock('$lib/data/remote/server-rows', () => ({ holdsAccountData }));
vi.mock('$lib/data/remote/server-connect', () => ({
  get serverless() {
    return connection.serverless;
  }
}));
vi.mock('$lib/functions/replication/replicator', () => ({ replicateData }));
vi.mock('$lib/data/dialog-manager', () => ({ dialogManager: { dialogs$: dialogs } }));
vi.mock('$lib/components/message-dialog.svelte', () => ({ default: {} }));
vi.mock('$lib/data/store', async () => {
  const { BehaviorSubject: Subject } = await import('rxjs');
  const value = (v: unknown) => new Subject(v);

  Object.assign(stores, {
    autoReplication: new Subject('off'),
    isOnline: new Subject(true),
    syncTarget: new Subject('')
  });

  return {
    autoReplication$: stores.autoReplication,
    isOnline$: stores.isOnline,
    syncTarget$: stores.syncTarget,
    cacheStorageData$: value(false),
    replicationSaveBehavior$: value('newOnly'),
    statisticsMergeMode$: value('merge'),
    readingGoalsMergeMode$: value('merge'),
    database: {
      db: Promise.resolve({ get: async (_: string, name: string) => sources.get(name) }),
      getDataByTitle: async (title: string) => books.get(title)
    }
  };
});

const { getStorageHandlerByName, retryWaitingChanges, saveExternalLastRead, syncDownData } =
  await import('./reader-storage');
const { syncState$ } = await import('$lib/data/sync/sync-status');
const { AutoReplicationType } = await import('$lib/functions/replication/replication-options');
const { StorageKey, StorageSourceDefault } = await import('./storage-types');

const online = stores.isOnline as BehaviorSubject<boolean>;
const autoReplication = stores.autoReplication as BehaviorSubject<string>;
const syncTarget = stores.syncTarget as BehaviorSubject<string>;

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

/*
 * retryWaitingChanges, written before the code. How it could go wrong:
 * - it retries a deleted book, a removed source or a source the book no longer uses forever;
 * - it uses the shared handlers, which the open reader is using for another book;
 * - it sends for a signed-out browser that holds an account's rows, or asks a server the
 *   standalone doesn't have;
 * - offline it shows the "you're offline" dialog on app start;
 * - a second tab sends what the first already sent.
 */
describe('retryWaitingChanges', () => {
  const calibre = StorageSourceDefault.CALIBRE_DEFAULT;
  const waiting = (source: string, type: string, title: string) => `${source}\t${type}\t${title}`;

  beforeEach(() => {
    books.clear();
    localStorage.clear();
    syncState$.next({ ...syncState$.getValue(), waiting: [] });
    holdsAccountData.mockResolvedValue(false);
    connection.serverless = false;
    syncTarget.next('');
    vi.stubGlobal('navigator', { onLine: true });
  });

  function queue(...keys: string[]) {
    localStorage.setItem('syncWaiting', JSON.stringify(keys));
  }

  const list = () => JSON.parse(localStorage.getItem('syncWaiting') || '[]');

  it('sends all of a book through the replicator, with handlers of its own', async () => {
    books.set('Book', { id: 7, title: 'Book', coverImage: 'c.png', storageSource: calibre });
    queue(waiting(calibre, 'bookmark', 'Book'), waiting(calibre, 'statistic', 'Book'));

    await retryWaitingChanges(window);

    expect(replicateData).toHaveBeenCalledTimes(1);
    const [source, target, refresh, contexts, types] = replicateData.mock.calls[0] as any[];
    expect(source.own).toBe(StorageKey.BROWSER);
    expect(target.own).toBe(StorageKey.CALIBRE);
    expect(refresh).toBe(false);
    expect(contexts).toEqual([{ id: 7, title: 'Book', imagePath: 'c.png' }]);
    expect(types).toEqual(['bookmark', 'statistic']);
    expect(getStorageHandler).not.toHaveBeenCalled();
  });

  it('drops a deleted book', async () => {
    queue(waiting(calibre, 'bookmark', 'Gone'));

    await retryWaitingChanges(window);

    expect(replicateData).not.toHaveBeenCalled();
    expect(list()).toEqual([]);
  });

  it('drops a change for a source the book no longer syncs to', async () => {
    autoReplication.next(AutoReplicationType.All);
    syncTarget.next('new folder');
    sources.set('old folder', { type: StorageKey.FS });
    sources.set('new folder', { type: StorageKey.FS });
    books.set('Book', { id: 1, title: 'Book' });
    queue(waiting('old folder', 'bookmark', 'Book'));

    await retryWaitingChanges(window);

    expect(replicateData).not.toHaveBeenCalled();
    expect(list()).toEqual([]);
  });

  it('drops a source that was removed, without a dialog', async () => {
    autoReplication.next(AutoReplicationType.All);
    books.set('Book', { id: 1, title: 'Book', storageSource: 'removed' });
    queue(waiting('removed', 'bookmark', 'Book'));

    await retryWaitingChanges(window);

    expect(replicateData).not.toHaveBeenCalled();
    expect(list()).toEqual([]);
    expect(dialogs.next).not.toHaveBeenCalled();
  });

  it('drops what sync-up, since turned off, would not send', async () => {
    sources.set('folder', { type: StorageKey.FS });
    books.set('Book', { id: 1, title: 'Book', storageSource: 'folder' });
    queue(waiting('folder', 'bookmark', 'Book'));

    await retryWaitingChanges(window);

    expect(replicateData).not.toHaveBeenCalled();
    expect(list()).toEqual([]);
  });

  it('keeps an account’s changes quietly until sign-in', async () => {
    holdsAccountData.mockResolvedValue(true);
    books.set('Book', { id: 1, title: 'Book', storageSource: calibre });
    const key = waiting(calibre, 'bookmark', 'Book');
    queue(key);

    await retryWaitingChanges(window);

    expect(replicateData).not.toHaveBeenCalled();
    expect(list()).toEqual([key]);
  });

  it('asks no server in the standalone without one', async () => {
    connection.serverless = true;
    books.set('Book', { id: 1, title: 'Book', storageSource: calibre });
    queue(waiting(calibre, 'bookmark', 'Book'));

    await retryWaitingChanges(window);

    expect(holdsAccountData).not.toHaveBeenCalled();
    expect(replicateData).not.toHaveBeenCalled();
    expect(list()).toEqual([]);
  });

  it('does nothing and shows nothing offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const key = waiting(StorageSourceDefault.GDRIVE_DEFAULT, 'bookmark', 'Book');
    queue(key);

    await retryWaitingChanges(window);

    expect(replicateData).not.toHaveBeenCalled();
    expect(dialogs.next).not.toHaveBeenCalled();
    expect(list()).toEqual([key]);
  });

  it('skips what another tab sent while this one waited for the lock', async () => {
    books.set('Book', { id: 1, title: 'Book', storageSource: calibre });
    queue(waiting(calibre, 'bookmark', 'Book'));
    vi.stubGlobal('navigator', {
      onLine: true,
      locks: {
        request: (_name: string, run: () => Promise<unknown>) => {
          queue();
          return run();
        }
      }
    });

    await retryWaitingChanges(window);

    expect(replicateData).not.toHaveBeenCalled();
  });
});
