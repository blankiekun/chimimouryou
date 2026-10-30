/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Backups from Settings → Sync (standalone): the library's own handlers, as Import and Export use. */

import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageDataType, StorageKey } from '$lib/data/storage/storage-types';
import {
  cacheStorageData$,
  readingGoalsMergeMode$,
  replicationSaveBehavior$,
  statisticsMergeMode$
} from '$lib/data/store';
import { importBackup, replicateData } from '$lib/functions/replication/replicator';

/** A handler set up as the library sets up its own (shared instances keep these settings). */
export function libraryHandler(window: Window, type: StorageKey, source: StorageKey) {
  return getStorageHandler(
    window,
    type,
    '',
    source === StorageKey.BROWSER,
    cacheStorageData$.getValue(),
    replicationSaveBehavior$.getValue(),
    statisticsMergeMode$.getValue(),
    readingGoalsMergeMode$.getValue()
  );
}

/** Downloads a zip of every book's progress and statistics, and the reading goals. */
export async function exportBackup(window: Window, source: StorageKey) {
  const sourceHandler = libraryHandler(window, source, source);
  const books = await sourceHandler.getBookList();

  return replicateData(
    sourceHandler,
    libraryHandler(window, StorageKey.BACKUP, source),
    false,
    books.map((book) => ({ title: book.title, imagePath: book.imagePath })),
    [StorageDataType.PROGRESS, StorageDataType.STATISTICS, StorageDataType.READING_GOALS]
  );
}

/** Merges a backup zip into the library's source; newer entries win. */
export async function restoreBackup(window: Window, source: StorageKey, file: File) {
  if (!file.name.endsWith('.zip')) return 'This is not a backup: choose a .zip file.';

  return importBackup(
    getStorageHandler(
      window,
      StorageKey.BACKUP,
      undefined,
      source === StorageKey.BROWSER,
      cacheStorageData$.getValue(),
      replicationSaveBehavior$.getValue(),
      statisticsMergeMode$.getValue(),
      readingGoalsMergeMode$.getValue()
    ),
    libraryHandler(window, source, source),
    file,
    new AbortController().signal
  );
}
