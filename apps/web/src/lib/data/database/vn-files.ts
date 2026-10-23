/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Imported visual novels' files, apart from their book records: games can be GBs, and the books
 * store is read whole to list the library. Written in batches before the record, so a cancelled
 * or interrupted import leaves no book, only files that `dropOrphanVnFiles` removes.
 * Its own database, so adding it needed no books database upgrade (open old tabs block one).
 * Not part of upstream.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { throwIfAborted } from '$lib/functions/replication/replication-error';
import { reportBytes } from '$lib/functions/replication/replication-progress';

interface VnFilesDb extends DBSchema {
  /** [key of one stored game, path inside it] */
  files: { key: [string, string]; value: Blob };
}

/** About this many bytes go in one transaction, so cancelling stops between batches (tests lower it). */
export const vnBatch = { bytes: 64 * 1024 ** 2 };
/** Files no book points to are dropped once this old (an import may still run in another tab). */
const ORPHAN_AGE = 24 * 3600 * 1000;

let opened: Promise<IDBPDatabase<VnFilesDb>> | undefined;

function vnFilesDb() {
  opened ??= openDB<VnFilesDb>('chimi-vn-files', 1, {
    upgrade(db) {
      db.createObjectStore('files');
    }
  });
  return opened;
}

const range = (key: string) => IDBKeyRange.bound([key], [key, []]);

/** Stores a game's files under a new key, reporting bytes saved; nothing stays when it fails. */
export async function putVnFiles(blobs: Record<string, Blob>, cancelSignal?: AbortSignal) {
  const db = await vnFilesDb();
  const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const entries = Object.entries(blobs);
  const total = entries.reduce((sum, [, blob]) => sum + blob.size, 0);
  let done = 0;

  reportBytes('saving', 0, total);

  try {
    for (let index = 0; index < entries.length; ) {
      throwIfAborted(cancelSignal);

      const tx = db.transaction('files', 'readwrite');
      const puts: Promise<unknown>[] = [];
      let size = 0;

      while (index < entries.length && (!puts.length || size < vnBatch.bytes)) {
        const [path, blob] = entries[index];

        puts.push(tx.store.put(blob, [key, path]));
        size += blob.size;
        index += 1;
      }

      await Promise.all([...puts, tx.done]);
      done += size;
      reportBytes('saving', done, total);
    }
  } catch (error) {
    await deleteVnFiles(key).catch(() => undefined);
    throw error;
  }

  return key;
}

/** A stored game's files by path */
export async function getVnFiles(key: string): Promise<Record<string, Blob>> {
  const tx = (await vnFilesDb()).transaction('files');
  const [keys, blobs] = await Promise.all([
    tx.store.getAllKeys(range(key)),
    tx.store.getAll(range(key))
  ]);

  return Object.fromEntries(keys.map(([, path], index) => [path, blobs[index]]));
}

export async function deleteVnFiles(key: string) {
  await (await vnFilesDb()).delete('files', range(key));
}

/** Drops stored games no book points to (`used`): imports that never finished. */
export async function dropOrphanVnFiles(used: Set<string>, now = Date.now()) {
  const tx = (await vnFilesDb()).transaction('files', 'readwrite');
  const orphans: string[] = [];
  let cursor = await tx.store.openKeyCursor();

  while (cursor) {
    const [key] = cursor.key;

    if (!used.has(key) && now - parseInt(key, 10) > ORPHAN_AGE) orphans.push(key);
    // Past every path of this game: [key, []] sorts after [key, any string].
    cursor = await cursor.continue([key, []] as unknown as [string, string]);
  }

  await Promise.all([...orphans.map((key) => tx.store.delete(range(key))), tx.done]);

  return orphans;
}
