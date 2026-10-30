/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The server's rows outside a handler: the extra sync files (`sync-files.ts`) as rows, writing
 * rows, and 401 as the sign-in message. Used by ServerStorageHandler and sync-files.ts; it
 * imports no handler, so neither of them imports the other. Not part of upstream.
 */

import { accountReady, currentAccount } from '$lib/data/account';
import { readerDataOwner } from '$lib/data/reader-data-owner';
import {
  apiVersion,
  bookIdOf,
  putRow,
  syncMirror,
  type Mirror,
  type SyncRow
} from '$lib/data/server-api';
import { serverConnected } from '$lib/data/server-connect';
import {
  SyncConflictError,
  type SyncFileOptions,
  type SyncFileStore
} from '$lib/data/storage/handler/base-handler';
import pLimit from 'p-limit';

/** Where readers sign in: Settings → Sync in the standalone, Settings → General otherwise. */
const signInPlace = serverConnected ? 'Settings → Sync → Server' : 'Settings → General → Account';

/** 401: an expired session, or a signed-out reader outside the trusted networks. */
export function unauthorizedError(expired = !!currentAccount()) {
  return Object.assign(
    new Error(
      expired
        ? `Your sign-in has expired. Sign in again in ${signInPlace}.`
        : `Using the library from this network needs an account. Sign in in ${signInPlace}.`
    ),
    { status: 401 }
  );
}

/** Server requests with 401 as the sign-in message. */
export async function signedInOr401<T>(request: Promise<T>) {
  try {
    return await request;
  } catch (error) {
    if ((error as { status?: number }).status === 401) throw unauthorizedError();
    throw error;
  }
}

export const newest = (rows: SyncRow[]) =>
  rows.reduce<number | undefined>((max, row) => Math.max(max || 0, row.modified), undefined);

export const live = (rows: SyncRow[]) => rows.filter((row) => !row.deleted);

/** Extra sync files (`sync-files.ts`) per book and their rows; the rest are account docs. */
const bookDocs: Record<string, string> = {
  'recaps.json': 'recaps',
  'lorebook.json': 'lorebook',
  'vnsaves.json': 'vnsaves'
};
const accountDocs: Record<string, string> = {
  'kanji.json': 'kanji',
  'words.json': 'words',
  'immersion.json': 'immersion',
  'settings.json': 'settings'
};
const annotationsName = 'annotations.json';

/**
 * Extra sync files (`sync-files.ts`) as rows: a book's annotations.json as its highlights,
 * recaps/lorebook/VN saves as book docs, the root files (kanji, words, immersion, settings) as
 * account docs, which callers only sync while signed in (`readerSyncStore`). The version is the
 * row's `modified` (annotations: the newest highlight's).
 */
export async function readSyncFile(name: string, title?: string) {
  const { mirror, book } = await syncFileRows(title);
  const rows = syncFileOf(mirror, name, title, book);

  if (!rows?.length) return undefined;

  return {
    text: JSON.stringify(
      name === annotationsName ? { title, highlights: rows.map((row) => row.data) } : rows[0].data
    ),
    version: String(newest(rows))
  };
}

/** A sync file's rows (undefined: not one the server keeps, or a book it doesn't have). */
function syncFileOf(mirror: Mirror, name: string, title?: string, book?: number) {
  if (name === annotationsName && book !== undefined) {
    return mirror.highlights.filter((row) => row.book === book);
  }
  if (title === undefined && accountDocs[name]) {
    return mirror.accountDocs.filter((row) => row.kind === accountDocs[name]);
  }
  if (book !== undefined && bookDocs[name]) {
    return mirror.bookDocs.filter((row) => row.book === book && row.kind === bookDocs[name]);
  }
  // A Windows game (an account's, not in the catalog): its VN saves are a game doc.
  if (name === 'vnsaves.json' && live(mirror.games).some((row) => row.name === title)) {
    return mirror.gameDocs.filter((row) => row.name === title && row.kind === 'vnsaves');
  }
  return undefined;
}

export async function writeSyncFile(
  name: string,
  text: string,
  { title, version, keepalive }: SyncFileOptions = {}
) {
  const { mirror, book } = await syncFileRows(title);
  const rows = syncFileOf(mirror, name, title, book);
  const data = JSON.parse(text);

  // A book the server doesn't know (one a friend sent) keeps its files in this browser.
  if (!rows) return;
  // Another device wrote since `version` was read: merge with its rows first.
  if (version !== undefined && String(newest(rows) ?? '') !== version) {
    throw new SyncConflictError();
  }

  if (name === annotationsName) {
    const stored = new Map(rows.map((row) => [row.hid, row]));
    const changed = (data.highlights || []).filter(
      (highlight: { id: string; modified: number }) =>
        (stored.get(highlight.id)?.modified ?? -1) < highlight.modified
    );
    const results = await Promise.all(
      changed.map((highlight: { id: string; modified: number }) =>
        signedInOr401(
          putRow(
            `books/${book}/highlights/${encodeURIComponent(highlight.id)}`,
            { modified: highlight.modified, data: highlight },
            'PUT',
            keepalive
          )
        )
      )
    );

    if (results.some((result) => !result.ok)) throw new SyncConflictError();
    return;
  }

  const path =
    title === undefined
      ? `docs/${accountDocs[name]}`
      : book === undefined
        ? `games/${encodeURIComponent(title)}/docs/vnsaves`
        : `books/${book}/docs/${bookDocs[name]}`;

  // Newer than what was merged with, even when this device's clock is behind.
  const modified = Math.max(Date.now(), Number(version || 0) + 1);
  const result = await signedInOr401(
    putRow(
      path,
      { modified, data },
      'PUT',
      // Browsers keep requests alive after the tab closes only up to 64 KiB in total.
      !!keepalive && new Blob([text]).size <= 60_000
    )
  );

  if (!result.ok) throw new SyncConflictError();
}

/** The mirror and a titled file's book id; a signed-out browser holding an account's data refuses. */
async function syncFileRows(title?: string) {
  await apiVersion();

  if (title !== undefined && (await holdsAccountData())) {
    throw unauthorizedError(true);
  }

  const mirror = await signedInOr401(syncMirror());

  return { mirror, book: title === undefined ? undefined : await bookIdOf(title) };
}

/**
 * Signed out while this browser still holds an account's data (its session expired): that
 * reader's rows wait in the browser for sign-in, never mixing with the shared ones.
 */
export async function holdsAccountData() {
  return !(await accountReady()) && !!(await readerDataOwner());
}

/** PUTs the entries newer than their rows; `replace` also DELETEs live rows the list lacks. */
export async function writeRows(
  rows: SyncRow[],
  entries: { key: string; modified: number; data: unknown }[],
  path: (key: string) => string,
  keyOf: (row: SyncRow) => string,
  replace: boolean
) {
  const stored = new Map(rows.map((row) => [keyOf(row), row]));
  const keys = new Set(entries.map((entry) => entry.key));
  const limiter = pLimit(6);

  await Promise.all([
    ...entries
      .filter((entry) => (stored.get(entry.key)?.modified ?? -1) < entry.modified)
      .map((entry) =>
        limiter(() =>
          signedInOr401(putRow(path(entry.key), { modified: entry.modified, data: entry.data }))
        )
      ),
    ...(replace
      ? live(rows)
          .filter((row) => !keys.has(keyOf(row)))
          .map((row) =>
            limiter(() =>
              signedInOr401(
                putRow(
                  path(keyOf(row)),
                  { modified: Math.max(Date.now(), row.modified + 1) },
                  'DELETE'
                )
              )
            )
          )
      : [])
  ]);
}

/** The server as a sync-file store (`syncFileStore`, `readerSyncStore`). */
export const serverSyncFiles: SyncFileStore = { readSyncFile, writeSyncFile };
