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
import {
  autoReplication$,
  cacheStorageData$,
  database,
  isOnline$,
  readingGoalsMergeMode$,
  replicationSaveBehavior$,
  statisticsMergeMode$
} from '$lib/data/store';
import type { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import type { BrowserStorageHandler } from '$lib/data/storage/handler/browser-handler';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageDataType, StorageKey, StorageSourceDefault } from '$lib/data/storage/storage-types';
import { AutoReplicationType } from '$lib/functions/replication/replication-options';
import type { ReplicationContext } from '$lib/functions/replication/replication-progress';
import { replicateData } from '$lib/functions/replication/replicator';
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

/** Downloads the book's progress, statistics, goals and audiobook data when down sync is on. */
export async function syncDownData(
  localStorageHandler: BrowserStorageHandler | undefined,
  storageHandler: BaseStorageHandler | undefined,
  context: ReplicationContext
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
    const error = await replicateData(
      storageHandler,
      localStorageHandler,
      false,
      [context],
      [
        StorageDataType.PROGRESS,
        StorageDataType.STATISTICS,
        StorageDataType.READING_GOALS,
        StorageDataType.AUDIOBOOK,
        StorageDataType.SUBTITLE
      ]
    );

    if (error) {
      throw new Error(error);
    }
  }
}
