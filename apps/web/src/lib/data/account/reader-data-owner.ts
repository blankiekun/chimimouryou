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
import { dropSyncMirrors } from '$lib/data/remote/server-api';

const ownerKey = 'readerDataOwner';

let release: Promise<void> | undefined;

/**
 * Called once per page load with the session state, and with `signingOut` just before the reader
 * signs out (while the catalog can still be read).
 */
export function releaseReaderData(user: AccountUser | null, signingOut = false) {
  release = releaseFor(user, signingOut);

  return release;
}

/** The reader ('' signed out) whose data this browser holds, once this page load's release is done. */
export async function readerDataOwner() {
  await release?.catch(() => {});

  return window.localStorage.getItem(ownerKey);
}

async function releaseFor(user: AccountUser | null, signingOut: boolean) {
  const owner = window.localStorage.getItem(ownerKey);
  const id = user?.id ?? '';

  // A session that expired (or was ended by the server) keeps its reader's unsynced data: it is
  // released when they sign out themselves or another account signs in.
  if (!user && owner && !signingOut) return;

  // Data from before owners were recorded is adopted, like settings. So is the standalone's own
  // (owner '') when it connects to a server: it was this device's reader all along.
  if (owner !== null && owner !== id && !(standalone && owner === '')) {
    // Throws when the catalog can't be read (signed out): nothing is cleared, the next load retries.
    const titles = new Set((await loadCalibreCatalog()).map((book) => book.title));

    await clearKnownWords();
    await database.clearReaderData(titles);
    // Kanji met sync for every title, so none stay behind.
    await (await readerDb()).clear('kanji');
  }

  window.localStorage.setItem(ownerKey, id);
  // The server rows other readers left in this browser's mirror (server-api.ts).
  await dropSyncMirrors(id);
}
