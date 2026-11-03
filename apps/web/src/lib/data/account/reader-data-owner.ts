/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Keeps one reader's progress, statistics and reading goals for Calibre books (and kanji met
 * and known words read from Anki) from
 * showing up for, and syncing into, the next account on a shared browser. They are
 * on the server, so they come back when their reader signs in again. Not part of upstream.
 */

import type { AccountUser } from '$lib/data/account/account';
import { loadCalibreCatalog } from '$lib/data/remote/calibre';
import { standalone } from '$lib/data/env';
import { clearKnownWords } from '$lib/data/words/known-words';
import { readerDb } from '$lib/data/reader-db';
import { database } from '$lib/data/store';
import { cachedCatalogTitles, dropSyncMirrors } from '$lib/data/remote/server-api';
import {
  dropWaiting,
  parseWaitingEntry,
  syncLocked,
  waitingChanges
} from '$lib/data/sync/sync-status';
import { StorageSourceDefault } from '$lib/data/storage/storage-types';

const ownerKey = 'readerDataOwner';

let release: Promise<void> | undefined;

/**
 * Called once per page load with the session state, and with `signingOut` once the reader has
 * signed out (`titles`: the catalog's, read while it still could be).
 */
export function releaseReaderData(
  user: AccountUser | null,
  signingOut = false,
  titles?: Set<string>
) {
  release = releaseFor(user, signingOut, titles);

  return release;
}

async function catalogTitles() {
  return new Set((await loadCalibreCatalog()).map((book) => book.title));
}

/** `signOutAndRelease` refused: changes for the server are still unsent, and nothing happened. */
export class UnsentChangesError extends Error {}

// Other sync targets' changes stay queued, and only what the server holds is cleared.
function waitingForServer() {
  return waitingChanges().filter(
    (entry) => parseWaitingEntry(entry).source === StorageSourceDefault.CALIBRE_DEFAULT
  );
}

/**
 * Sends what's unsent, ends the session (`end`), then forgets the reader's data here. Throws with
 * nothing cleared while changes for the server are unsent (`UnsentChangesError`, `end` isn't called)
 * or when `end` fails (offline): this device may hold the only copy.
 *
 * `discardUnsent` ("Sign out anyway") skips the sending and takes those changes off the waiting list,
 * but only once `end` has worked: offline it still throws, with the data and the list as they were.
 *
 * A dead session can't read the catalog, so this browser's cached one names the titles (books added
 * since stay). With neither, the sign-out still happens and the data stays, released when another
 * account signs in.
 */
export async function signOutAndRelease(end: () => Promise<unknown>, discardUnsent = false) {
  if (!discardUnsent) {
    const { retryWaitingChanges } = await import('$lib/data/storage/reader-storage');

    await retryWaitingChanges(window);

    if (waitingForServer().length) throw new UnsentChangesError('Changes not sent yet');
  }

  const titles = await catalogTitles().catch(cachedCatalogTitles);

  await end();
  // Under the upload lock: a retry in flight would put back what it failed to send.
  await syncLocked(async () => dropWaiting(waitingForServer()));
  await releaseReaderData(null, true, titles).catch(() => {});
}

/** The reader ('' signed out) whose data this browser holds, once this page load's release is done. */
export async function readerDataOwner() {
  await release?.catch(() => {});

  return window.localStorage.getItem(ownerKey);
}

async function releaseFor(user: AccountUser | null, signingOut: boolean, titles?: Set<string>) {
  const owner = window.localStorage.getItem(ownerKey);
  const id = user?.id ?? '';

  // A session that expired (or was ended by the server) keeps its reader's unsynced data: it is
  // released when they sign out themselves or another account signs in.
  if (!user && owner && !signingOut) return;

  // Data from before owners were recorded is adopted, like settings. So is the standalone's own
  // (owner '') when it connects to a server: it was this device's reader all along.
  if (owner !== null && owner !== id && !(standalone && owner === '')) {
    // Throws when the catalog can't be read (signed out): nothing is cleared, the next load retries.
    const forget = titles ?? (await catalogTitles());

    await clearKnownWords();
    await database.clearReaderData(forget);
    // Kanji met sync for every title, so none stay behind.
    await (await readerDb()).clear('kanji');
  }

  window.localStorage.setItem(ownerKey, id);
  // The server rows other readers left in this browser's mirror (server-api.ts).
  await dropSyncMirrors(id);
}
