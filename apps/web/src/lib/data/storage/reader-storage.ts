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
  isOnline$,
  readingGoalsMergeMode$,
  replicationSaveBehavior$,
  statisticsMergeMode$,
  syncTarget$
} from '$lib/data/store';
import type { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import type { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
import { getStorageHandler, ownStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageDataType, StorageKey, StorageSourceDefault } from '$lib/data/storage/storage-types';
import { AutoReplicationType } from '$lib/functions/replication/replication-options';
import type { ReplicationContext } from '$lib/functions/replication/replication-progress';
import { replicateData } from '$lib/functions/replication/replicator';
import {
  dropWaiting,
  parseWaitingEntry,
  syncLocked,
  waitingChanges
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

/** One book's waiting changes for one source; what can no longer be sent leaves the list. */
async function retryBook(window: Window, entries: string[]) {
  const saved = waitingChanges();
  const left = entries.filter((entry) => saved.includes(entry));

  // Another tab sent them while this one waited for the lock.
  if (!left.length) return;

  const { source, title } = parseWaitingEntry(left[0]);
  const isCalibre = source === StorageSourceDefault.CALIBRE_DEFAULT;
  const autoReplication = autoReplication$.getValue();
  const sendsUp = isCalibre
    ? !serverless
    : autoReplication === AutoReplicationType.Up || autoReplication === AutoReplicationType.All;
  const book = await database.getDataByTitle(title);
  const type =
    sendsUp && book && (book.storageSource || syncTarget$.getValue()) === source
      ? await sourceType(source)
      : undefined;

  if (!book || !type) {
    dropWaiting(left);
    return;
  }

  // Signed out, this browser's rows wait for that account: signing in reloads the app.
  if (isCalibre && (await holdsAccountData())) return;

  const local = ownStorageHandler(window, StorageKey.BROWSER);
  const target = ownStorageHandler(window, type);
  const saveBehavior = replicationSaveBehavior$.getValue();
  const statisticsMode = statisticsMergeMode$.getValue();
  const goalsMode = readingGoalsMergeMode$.getValue();
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

  // A failure keeps them waiting and shows in the status (syncEnded).
  await replicateData(
    local,
    target,
    false,
    [{ id: book.id, title, imagePath: book.coverImage }],
    left.map((entry) => parseWaitingEntry(entry).type)
  );
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
