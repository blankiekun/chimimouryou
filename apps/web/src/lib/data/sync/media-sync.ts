/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The manga (/m) and VN (/v) players' storage glue: a storage handler, the one a book's progress
 * syncs to, and its replication context. Moved out of both pages unchanged. Not upstream.
 */

import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import {
  cacheStorageData$,
  database,
  readingGoalsMergeMode$,
  replicationSaveBehavior$,
  statisticsMergeMode$
} from '$lib/data/store';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageKey, StorageSourceDefault } from '$lib/data/storage/storage-types';
import { bookSyncSource } from '$lib/data/sync/sync-files';

const defaultSources: Record<string, StorageKey> = {
  [StorageSourceDefault.CALIBRE_DEFAULT]: StorageKey.CALIBRE,
  [StorageSourceDefault.GDRIVE_DEFAULT]: StorageKey.GDRIVE,
  [StorageSourceDefault.ONEDRIVE_DEFAULT]: StorageKey.ONEDRIVE
};

export function handler(type: StorageKey, name?: string, isForBrowser = true) {
  return getStorageHandler(
    window,
    type,
    name,
    isForBrowser,
    cacheStorageData$.getValue(),
    replicationSaveBehavior$.getValue(),
    statisticsMergeMode$.getValue(),
    readingGoalsMergeMode$.getValue()
  );
}

/** Where this book's progress syncs, as in the book reader (Calibre always syncs). */
export async function externalHandler(data: BooksDbBookData) {
  const name = bookSyncSource(data.storageSource);

  if (!name) return undefined;

  const type = defaultSources[name] ?? (await (await database.db).get('storageSource', name))?.type;

  return type ? handler(type, name) : undefined;
}

export function context(book: BooksDbBookData) {
  return { id: book.id, title: book.title, imagePath: book.coverImage };
}
