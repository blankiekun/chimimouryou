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

import type { AccountUser } from '$lib/data/account';
import { loadCalibreCatalog } from '$lib/data/calibre';
import { clearKnownWords } from '$lib/data/known-words';
import { readerDb } from '$lib/data/reader-db';
import { database } from '$lib/data/store';

const ownerKey = 'readerDataOwner';

let release: Promise<void> | undefined;

/** Called once per page load with the session state ('' = signed out). */
export function releaseReaderData(user: AccountUser | null) {
  release = releaseFor(user);

  return release;
}

/** The reader ('' signed out) whose data this browser holds, once this page load's release is done. */
export async function readerDataOwner() {
  await release?.catch(() => {});

  return window.localStorage.getItem(ownerKey);
}

async function releaseFor(user: AccountUser | null) {
  const owner = window.localStorage.getItem(ownerKey);
  const id = user?.id ?? '';

  // Data from before owners were recorded is adopted, like settings.
  if (owner !== null && owner !== id) {
    await clearKnownWords();
    // Throws when the catalog can't be read (signed out): the next page load retries.
    const titles = new Set((await loadCalibreCatalog()).map((book) => book.title));

    await database.clearReaderData(titles);
    // Kanji met sync for every title, so none stay behind.
    await (await readerDb()).clear('kanji');
  }

  window.localStorage.setItem(ownerKey, id);
}
