/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The manga (/m) and VN (/v) players' storage glue: a storage handler, the one a book's progress
 * syncs to, and its replication context. Moved out of both pages unchanged. Also when a page comes
 * back after being away, for them, the book reader (/b) and the library (/manage). Not upstream.
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

/**
 * Calls `back(awayMs)` when the page returns after being hidden or losing the window's focus:
 * once per return, though a return can fire both visibilitychange and focus. A `place` that moved
 * meanwhile means reading here in a window beside another (scrolling doesn't focus it), so that
 * counts as 0 ms away. Returns the function that stops watching.
 */
export function watchReturn(back: (awayMs: number) => void, place: () => unknown = () => 0) {
  let left: { at: number; place: unknown } | undefined;

  const leave = () => {
    left ??= { at: Date.now(), place: place() };
  };
  const onBlur = () => {
    // Focus moving into a frame (a dictionary popup, the VN player) isn't leaving.
    if (!document.hasFocus()) leave();
  };
  const onReturn = () => {
    if (!left || document.visibilityState === 'hidden') return;

    const { at, place: was } = left;

    // Shown again without the focus (a window uncovered): the click into it is the next return.
    left = document.hasFocus() ? undefined : { at: Date.now(), place: place() };
    back(place() === was ? Date.now() - at : 0);
  };
  const onVisibility = () => (document.visibilityState === 'hidden' ? leave() : onReturn());

  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onReturn);
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onReturn);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
