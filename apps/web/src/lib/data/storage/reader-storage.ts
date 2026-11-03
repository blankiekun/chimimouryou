/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The reader's (/b) storage glue: the book's sync handler, its last read time there and the
 * download of its data on open. Moved out of routes/b/+page.svelte unchanged.
 */

import MessageDialog from '$lib/components/message-dialog.svelte';
import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import { dialogManager } from '$lib/data/dialog-manager';
import { logger } from '$lib/data/logger';
import { serverless } from '$lib/data/remote/server-connect';
import { holdsAccountData } from '$lib/data/remote/server-rows';
import {
  autoReplication$,
  cacheStorageData$,
  database,
  fsStorageSource$,
  gDriveStorageSource$,
  isOnline$,
  oneDriveStorageSource$,
  readingGoalsMergeMode$,
  replicationSaveBehavior$,
  statisticsMergeMode$,
  syncTarget$
} from '$lib/data/store';
import type { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import type { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
import { getStorageHandler, ownStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageDataType, StorageKey, StorageSourceDefault } from '$lib/data/storage/storage-types';
import { MergeMode } from '$lib/data/merge-mode';
import { storageSource$ } from '$lib/data/storage/storage-view';
import {
  AutoReplicationType,
  ReplicationSaveBehavior
} from '$lib/functions/replication/replication-options';
import type { ReplicationContext } from '$lib/functions/replication/replication-progress';
import { replicateData } from '$lib/functions/replication/replicator';
import {
  dropWaiting,
  parseWaitingEntry,
  syncLocked,
  syncQueued,
  waitingChanges,
  waitingEntry
} from '$lib/data/sync/sync-status';
import { tr } from '$lib/i18n';

function showMessage(title: string, message: string) {
  dialogManager.dialogs$.next([{ component: MessageDialog, props: { title, message } }]);
}

function handlerFor(type: StorageKey, storageSourceName: string) {
  return getStorageHandler(
    window,
    type,
    storageSourceName,
    true,
    cacheStorageData$.getValue(),
    replicationSaveBehavior$.getValue(),
    statisticsMergeMode$.getValue(),
    readingGoalsMergeMode$.getValue()
  );
}

/** The storage handler of a sync target or book source; offline, cloud ones show a dialog instead. */
export async function getStorageHandlerByName(storageSourceName: string, throwIfNotFound = false) {
  if (!storageSourceName) {
    if (throwIfNotFound) {
      throw new Error(`No storage source found`);
    }

    return undefined;
  }

  if (storageSourceName === StorageSourceDefault.CALIBRE_DEFAULT) {
    return handlerFor(StorageKey.CALIBRE, storageSourceName);
  }
  if (storageSourceName === StorageSourceDefault.GDRIVE_DEFAULT) {
    if (!isOnline$.getValue()) {
      showMessage(tr('reader.loadError'), tr('reader.offline'));

      return undefined;
    }

    return handlerFor(StorageKey.GDRIVE, storageSourceName);
  }
  if (storageSourceName === StorageSourceDefault.ONEDRIVE_DEFAULT) {
    if (!isOnline$.getValue()) {
      showMessage(tr('reader.loadError'), tr('reader.offline'));

      return undefined;
    }

    return handlerFor(StorageKey.ONEDRIVE, storageSourceName);
  }
  if (storageSourceName) {
    const db = await database.db;
    const storageSource = await db.get('storageSource', storageSourceName);

    if (storageSource) {
      if (storageSource.type !== StorageKey.FS && !isOnline$.getValue()) {
        showMessage(tr('reader.loadError'), tr('reader.offline'));

        return undefined;
      }

      return handlerFor(storageSource.type, storageSourceName);
    }
    if (throwIfNotFound) {
      throw new Error(`No storage source with name ${storageSourceName} found`);
    }
  }

  const message = tr('reader.noStorageSource', { name: storageSourceName });

  logger.warn(message);
  showMessage(tr('reader.configError'), message);

  return undefined;
}

/** Saves the open time at the book's sync target; a book from a source takes the source's data. */
export async function saveExternalLastRead(
  storageHandler: BaseStorageHandler | undefined,
  localBookData: BooksDbBookData
) {
  if (!storageHandler) {
    return localBookData;
  }

  // eslint-disable-next-line prefer-const
  let { id, ...bookData } = localBookData;

  if (localBookData.storageSource) {
    const externalBookData = await storageHandler.getBook();

    if (externalBookData && !(externalBookData instanceof File)) {
      bookData = {
        ...externalBookData,
        ...{
          id: localBookData.id,
          lastBookOpen: localBookData.lastBookOpen,
          storageSource: localBookData.storageSource
        }
      };
    }
  } else if (!localBookData.elementHtml) {
    throw new Error('Book has no data stored');
  }

  const dataToReturn = { id, ...bookData };

  await storageHandler.updateLastRead(dataToReturn).catch((error: any) => {
    const message = tr('reader.lastReadError', { error: error.message });

    logger.warn(message);
    showMessage(tr('reader.updateError'), message);
  });

  return dataToReturn;
}

/** A place saved here that never reached the sync target, say with no signal when the page closed. */
export async function placeNewerHere(
  storageHandler: BaseStorageHandler | undefined,
  bookId: number
) {
  const place = await database.getBookmark(bookId);

  return (
    !!storageHandler &&
    !!place?.lastBookmarkModified &&
    !(await storageHandler.isUpToDate(StorageDataType.PROGRESS, place.lastBookmarkModified))
  );
}

/** Statistics saved here that never reached the sync target, like `placeNewerHere`. */
export async function statisticsNewerHere(
  storageHandler: BaseStorageHandler | undefined,
  title: string
) {
  const modified = await database.getLastModifiedForType(title, StorageDataType.STATISTICS);

  return (
    !!storageHandler &&
    !!modified &&
    !(await storageHandler.isUpToDate(StorageDataType.STATISTICS, modified))
  );
}

/** Downloads the book's progress, statistics, goals and audiobook data when down sync is on. */
export async function syncDownData(
  localStorageHandler: BrowserStorageHandler | undefined,
  storageHandler: BaseStorageHandler | undefined,
  context: ReplicationContext,
  types = [
    StorageDataType.PROGRESS,
    StorageDataType.STATISTICS,
    StorageDataType.READING_GOALS,
    StorageDataType.AUDIOBOOK,
    StorageDataType.SUBTITLE
  ]
) {
  if (localStorageHandler && storageHandler) {
    storageHandler.startContext(context);
  }

  const autoReplication = autoReplication$.getValue();

  if (
    localStorageHandler &&
    storageHandler &&
    (storageHandler.storageType === StorageKey.CALIBRE ||
      autoReplication === AutoReplicationType.Down ||
      autoReplication === AutoReplicationType.All)
  ) {
    const error = await replicateData(storageHandler, localStorageHandler, false, [context], types);

    if (error) {
      throw new Error(error);
    }
  }
}

/** The type of a sync source without touching the shared handlers; undefined once it's removed. */
async function sourceType(source: string) {
  if (source === StorageSourceDefault.CALIBRE_DEFAULT) return StorageKey.CALIBRE;
  if (source === StorageSourceDefault.GDRIVE_DEFAULT) return StorageKey.GDRIVE;
  if (source === StorageSourceDefault.ONEDRIVE_DEFAULT) return StorageKey.ONEDRIVE;

  return (await (await database.db).get('storageSource', source))?.type;
}

function sendsUpTo(source: string) {
  const autoReplication = autoReplication$.getValue();

  return source === StorageSourceDefault.CALIBRE_DEFAULT
    ? !serverless
    : autoReplication === AutoReplicationType.Up || autoReplication === AutoReplicationType.All;
}

/** This browser and a sync source, on handlers of their own (`ownStorageHandler`). */
function ownSyncPair(
  window: Window,
  type: StorageKey,
  source: string,
  saveBehavior: string,
  statisticsMode: MergeMode,
  goalsMode: MergeMode
) {
  const local = ownStorageHandler(window, StorageKey.BROWSER);
  const target = ownStorageHandler(window, type);
  const cache = cacheStorageData$.getValue();

  local.updateSettings(window, true, saveBehavior, statisticsMode, goalsMode, cache, false, '');
  target.updateSettings(
    window,
    false,
    saveBehavior,
    statisticsMode,
    goalsMode,
    cache,
    false,
    source
  );

  return { local, target };
}

/** One book's waiting changes for one source; what can no longer be sent leaves the list. */
async function retryBook(window: Window, entries: string[]) {
  const saved = waitingChanges();
  const left = entries.filter((entry) => saved.includes(entry));

  // Another tab sent them while this one waited for the lock.
  if (!left.length) return;

  const { source, title } = parseWaitingEntry(left[0]);
  const book = await database.getDataByTitle(title);
  const type =
    sendsUpTo(source) && book && (book.storageSource || syncTarget$.getValue()) === source
      ? await sourceType(source)
      : undefined;

  if (!book || !type) {
    dropWaiting(left);
    return;
  }

  // Signed out, this browser's rows wait for that account: signing in reloads the app.
  if (source === StorageSourceDefault.CALIBRE_DEFAULT && (await holdsAccountData())) return;

  const { local, target } = ownSyncPair(
    window,
    type,
    source,
    replicationSaveBehavior$.getValue(),
    statisticsMergeMode$.getValue(),
    readingGoalsMergeMode$.getValue()
  );

  // A failure keeps them waiting and shows in the status (syncEnded).
  await replicateData(
    local,
    target,
    false,
    [{ id: book.id, title, imagePath: book.coverImage }],
    left.map((entry) => parseWaitingEntry(entry).type)
  );
}

/** The source the library lists, for what no book record names; a custom one has its own name. */
function librarySource() {
  switch (storageSource$.getValue()) {
    case StorageKey.CALIBRE:
      return StorageSourceDefault.CALIBRE_DEFAULT;
    case StorageKey.GDRIVE:
      return gDriveStorageSource$.getValue();
    case StorageKey.ONEDRIVE:
      return oneDriveStorageSource$.getValue();
    case StorageKey.FS:
      return fsStorageSource$.getValue();
    default:
      return undefined;
  }
}

type Copy = (from: BaseStorageHandler, to: BaseStorageHandler) => Promise<void>;

/**
 * A deletion or edit of statistics or goals: this pulls what other devices wrote, makes the change,
 * then replaces the synced copy with the result, so the file holds the deletion at once. The pull
 * skips the replicator's up-to-date check: a merging upload leaves this browser's time as new as
 * days it never received, and replacing without them would delete them. For the same reason nothing
 * is pushed after a failed pull: the change stays here, a message says so, and the next sync takes it.
 */
function correct(
  window: Window,
  copy: Copy,
  titles: (string | undefined)[],
  change: () => Promise<unknown>
) {
  return syncLocked(async () => {
    const pushes: (() => Promise<void>)[] = [];
    let problem = '';
    // Statistics only: goals have no title, and go with any book's next sync.
    const unsent = (source: string, title: string | undefined, error: Error) => {
      problem = error.message;
      if (title !== undefined) {
        syncQueued(waitingEntry(source, StorageDataType.STATISTICS, title));
      }
    };

    for (const title of titles) {
      const book = title === undefined ? undefined : await database.getDataByTitle(title);
      const source = book?.storageSource || syncTarget$.getValue() || librarySource();
      const type = source && sendsUpTo(source) ? await sourceType(source) : undefined;

      if (
        !source ||
        !type ||
        (source === StorageSourceDefault.CALIBRE_DEFAULT && (await holdsAccountData()))
      ) {
        continue;
      }

      const pair = (mode: MergeMode) => {
        const handlers = ownSyncPair(
          window,
          type,
          source,
          ReplicationSaveBehavior.NewOnly,
          mode,
          mode
        );

        if (title !== undefined) {
          handlers.local.startContext({ id: book?.id ?? 0, title, imagePath: '' });
          handlers.target.startContext({ id: book?.id ?? 0, title, imagePath: '' });
        }

        return handlers;
      };

      try {
        const pulling = pair(MergeMode.MERGE);

        await copy(pulling.target, pulling.local);

        const pushing = pair(MergeMode.REPLACE);

        pushes.push(() =>
          copy(pushing.local, pushing.target).catch((error: Error) => unsent(source, title, error))
        );
      } catch (error: any) {
        unsent(source, title, error);
      }
    }

    await change();

    for (const push of pushes) {
      await push();
    }

    if (problem) {
      logger.warn(`Change not synced: ${problem}`);
      // After the dialog the statistics page closes when a deletion ends.
      setTimeout(() =>
        showMessage(
          'Changed on this device only',
          `Couldn't sync the change yet, so it goes with this device's next sync: ${problem}`
        )
      );
    }
  });
}

const copyStatistics: Copy = async (from, to) => {
  const { statistics, lastStatisticModified } = await from.getStatistics();

  if (statistics) await to.saveStatistics(statistics, lastStatisticModified);
};

const copyReadingGoals: Copy = async (from, to) => {
  const { readingGoals, lastGoalModified } = await from.getReadingGoals();

  if (readingGoals) await to.saveReadingGoals(readingGoals, lastGoalModified);
};

/** Makes a deletion or edit of these titles' statistics and syncs it. */
export function correctStatistics(
  window: Window,
  titles: string[],
  change: () => Promise<unknown>
) {
  return correct(window, copyStatistics, titles, change);
}

/** Makes a deletion or edit of the reading goals and syncs it. */
export function correctReadingGoals(window: Window, change: () => Promise<unknown>) {
  return correct(window, copyReadingGoals, [undefined], change);
}

let retrying = false;

/**
 * Sends what an earlier page left unsent, through the replicator, so a newer remote still wins.
 * Runs at app start, on `online` and on return (root layout).
 */
export async function retryWaitingChanges(window: Window) {
  if (retrying || !navigator.onLine) return;

  retrying = true;

  try {
    const byBook = new Map<string, string[]>();

    waitingChanges().forEach((entry) => {
      const { source, title } = parseWaitingEntry(entry);
      const key = `${source}\t${title}`;

      byBook.set(key, [...(byBook.get(key) || []), entry]);
    });

    for (const entries of byBook.values()) {
      await syncLocked(() => retryBook(window, entries));
    }
  } catch (error: any) {
    logger.warn(`Waiting changes not sent yet: ${error.message}`);
  } finally {
    retrying = false;
  }
}
