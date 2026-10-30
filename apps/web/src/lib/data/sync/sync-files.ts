/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Where the reader's extra files sync, beside the book data of any storage source: per book
 * (annotations.json, recaps.json, lorebook.json, vnsaves.json) in the book's folder on its own
 * source; per reader (kanji.json, words.json, immersion.json, settings.json) in the account's
 * folder while signed in to the server, else at the root of the library's Google Drive, OneDrive
 * or folder source.
 * Not part of upstream.
 */

import { serverSyncFiles, type SyncFileName } from '$lib/data/server-rows';
import { FilesystemStorageHandler } from '$lib/data/storage/handler/filesystem-handler';
import { GDriveStorageHandler } from '$lib/data/storage/handler/gdrive-handler';
import { OneDriveStorageHandler } from '$lib/data/storage/handler/onedrive-handler';
import {
  SyncConflictError,
  type SyncFileStore,
  type SyncedFile
} from '$lib/data/storage/handler/base-handler';
import { storageOAuthTokens, storedRefreshToken } from '$lib/data/storage/storage-oauth-manager';
import { StorageKey, StorageSourceDefault } from '$lib/data/storage/storage-types';
import { storageSource$ } from '$lib/data/storage/storage-view';
import {
  autoReplication$,
  database,
  fsStorageSource$,
  gDriveStorageSource$,
  oneDriveStorageSource$,
  syncTarget$
} from '$lib/data/store';
import { MergeMode } from '$lib/data/merge-mode';
import { recordSyncError } from '$lib/data/sync-status';
import {
  AutoReplicationType,
  ReplicationSaveBehavior
} from '$lib/functions/replication/replication-options';

export type { SyncFileStore, SyncedFile };

/** A book's sync source: its own, else the auto-replication target ('' = this browser only). */
export function bookSyncSource(storageSource: string | undefined) {
  if (storageSource) return storageSource;

  return autoReplication$.getValue() === AutoReplicationType.Off ? '' : syncTarget$.getValue();
}

const handlers = new Map<
  string,
  GDriveStorageHandler | OneDriveStorageHandler | FilesystemStorageHandler
>();

async function sourceType(name: string) {
  if (name === StorageSourceDefault.GDRIVE_DEFAULT) return StorageKey.GDRIVE;
  if (name === StorageSourceDefault.ONEDRIVE_DEFAULT) return StorageKey.ONEDRIVE;

  return (await (await database.db).get('storageSource', name))?.type;
}

/**
 * The files of a storage source by name, or undefined when it can't sync without asking: the
 * browser, or Drive/OneDrive before signing in (a sign-in pop-up needs a click).
 */
export async function syncFileStore(name: string): Promise<SyncFileStore | undefined> {
  if (!name) return undefined;
  if (name === StorageSourceDefault.CALIBRE_DEFAULT) return serverSyncFiles;

  const type = await sourceType(name);

  if (
    (type === StorageKey.GDRIVE || type === StorageKey.ONEDRIVE) &&
    !storageOAuthTokens.has(name) &&
    !storedRefreshToken(name)
  ) {
    return undefined;
  }

  let handler = handlers.get(name);

  if (!handler) {
    // Own instances: the shared ones switch context while a book opens or the library syncs.
    if (type === StorageKey.GDRIVE) handler = new GDriveStorageHandler(window);
    else if (type === StorageKey.ONEDRIVE) handler = new OneDriveStorageHandler(window);
    else if (type === StorageKey.FS) handler = new FilesystemStorageHandler(window, StorageKey.FS);
    else return undefined;

    handler.updateSettings(
      window,
      false,
      ReplicationSaveBehavior.NewOnly,
      MergeMode.MERGE,
      MergeMode.MERGE,
      false,
      false,
      name
    );
    handlers.set(name, handler);
  }

  return handler;
}

/**
 * Where kanji, word marks and settings sync while signed out: the library's own cloud or folder,
 * else (books in the browser) the auto-replication target.
 */
export function readerSyncSource() {
  switch (storageSource$.getValue()) {
    case StorageKey.GDRIVE:
      return gDriveStorageSource$.getValue();
    case StorageKey.ONEDRIVE:
      return oneDriveStorageSource$.getValue();
    case StorageKey.FS:
      return fsStorageSource$.getValue();
    default: {
      const target = bookSyncSource(undefined);

      // The server's folder is the account's: readerSyncStore uses it only signed in.
      return target === StorageSourceDefault.CALIBRE_DEFAULT ? '' : target;
    }
  }
}

/** The store for the reader's own files: the account's folder while signed in. */
export function readerSyncStore(signedIn: boolean) {
  return signedIn ? Promise.resolve(serverSyncFiles) : syncFileStore(readerSyncSource());
}

type Merge<T> = (remote: T | undefined) => Promise<T | undefined>;

/**
 * A synced file's document: undefined when it is missing or empty. A syntax error (a cut-off
 * write, a hand edit) is copied to `<name>.bad-<ms>` beside it and listed in the sync errors,
 * then counts as missing, so the local copy replaces it; if the copy fails, nothing is written.
 * A document `parse` refuses (another app version's format) is never written over.
 */
async function parseSyncFile<T>(
  store: SyncFileStore,
  name: string,
  title: string | undefined,
  remote: SyncedFile | undefined,
  parse: (raw: unknown) => T | undefined
) {
  if (!remote?.text.trim()) return undefined;

  let raw: unknown;

  try {
    raw = JSON.parse(remote.text);
  } catch {
    const copy = `${name}.bad-${Date.now()}`;

    await store.writeSyncFile(copy, remote.text, { title, version: '' });
    recordSyncError(title ?? name, `${name} could not be read: kept as ${copy}, then replaced`);
    return undefined;
  }

  const document = parse(raw);

  // Heals when any device writes a file this version reads.
  if (document === undefined) {
    throw new Error(`${name} is in a format this app version can't read; it is left unchanged`);
  }

  return document;
}

/**
 * Reads a JSON file, checks it with `parse` (undefined: refused), lets `merge` combine it with
 * the local copy and writes what it returns (undefined: the file is up to date). Another device
 * writing in between is caught by the version check where the source has one, and the sync runs
 * once more.
 */
export async function syncJsonFile<T>(
  store: SyncFileStore,
  name: SyncFileName,
  title: string | undefined,
  parse: (raw: unknown) => T | undefined,
  merge: Merge<T>,
  keepalive = false
) {
  for (let attempt = 0; ; attempt += 1) {
    const remote = await store.readSyncFile(name, title);
    const upload = await merge(await parseSyncFile(store, name, title, remote, parse));

    if (upload === undefined) return;

    try {
      await store.writeSyncFile(name, JSON.stringify(upload), {
        title,
        version: remote?.version ?? '',
        keepalive
      });
      return;
    } catch (error) {
      if (!(error instanceof SyncConflictError) || attempt) throw error;
    }
  }
}
