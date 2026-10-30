/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Syncs "Story so far" recaps (recaps.json) and the lorebook (lorebook.json) of
 * books on a synced source through the book's folder (sync-files.ts; on the
 * server, the account's own folder while signed in), like annotations.json.
 * Local changes upload a second after they are saved; panels pull before
 * showing. Browser copies record their account and are ignored under another
 * sign-in state.
 *
 * Kanji met (kanji-seen.ts) sync for every book as one kanji.json in the account's
 * folder while signed in (else at the root of the library's Drive, OneDrive or folder),
 * after releaseReaderData has run. Words marked known or ignored (word-marks.ts) sync
 * the same way as words.json, and so does the immersion log (immersion-log.ts) as immersion.json.
 * Not part of upstream.
 */

import { BehaviorSubject, type Subject } from 'rxjs';
import { accountReady, currentAccount } from '$lib/data/account/account';
import {
  isImmersionEntry,
  mergeImmersion,
  sameImmersion,
  type ImmersionLog
} from '$lib/data/stats/immersion-log';
import type { KanjiSeen } from '$lib/data/words/kanji-seen';
import { logger } from '$lib/data/logger';
import {
  lorebookChanged$,
  mergeLorebooks,
  parseLorebook,
  sameLorebooks,
  type Lorebook
} from '$lib/data/ai/lorebook';
import {
  mergeRecaps,
  parseRecaps,
  recapsChanged$,
  sameRecaps,
  type BookRecaps
} from '$lib/data/ai/recap';
import { readerDataOwner } from '$lib/data/account/reader-data-owner';
import { readerDb } from '$lib/data/reader-db';
import type { WordMarks } from '$lib/data/words/word-marks';
import type { SyncFileName } from '$lib/data/remote/server-rows';
import { readerSyncStore, syncFileStore, syncJsonFile } from '$lib/data/sync/sync-files';

export type ExtrasKind = 'recaps' | 'lorebook';

interface Spec<T extends { title: string; account?: string }> {
  store: 'recaps' | 'lorebooks';
  file: SyncFileName;
  changed$: Subject<T>;
  parse: (raw: unknown) => T | undefined;
  merge: (title: string, local?: T, remote?: T) => T;
  same: (a?: T, b?: T) => boolean;
}

const specs: { recaps: Spec<BookRecaps>; lorebook: Spec<Lorebook> } = {
  recaps: {
    store: 'recaps',
    file: 'recaps.json',
    changed$: recapsChanged$,
    parse: parseRecaps,
    merge: mergeRecaps,
    same: sameRecaps
  },
  lorebook: {
    store: 'lorebooks',
    file: 'lorebook.json',
    changed$: lorebookChanged$,
    parse: parseLorebook,
    merge: mergeLorebooks,
    same: sameLorebooks
  }
};

/** Last sync error per kind ('' when fine), shown in the panels. */
export const extrasSyncError$ = new BehaviorSubject<Record<ExtrasKind, string>>({
  recaps: '',
  lorebook: ''
});

/** Synced books and the storage source their files go to. */
const syncedTitles = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const queues = new Map<string, Promise<void>>();
/** Copies being written by a sync, so their change events don't start another one. */
const applying = new Set<string>();

/** Turns syncing on for a book on a synced source (when the reader opens it). */
export function enableExtrasSync(title: string, source: string) {
  if (source) syncedTitles.set(title, source);
}

/** The source a book's extras sync to ('' when they don't). */
export function extrasSyncSource(title: string) {
  return syncedTitles.get(title) ?? '';
}

function schedule(kind: ExtrasKind, title: string) {
  const key = `${kind}\n${title}`;

  if (!syncedTitles.has(title) || applying.has(key)) {
    return;
  }

  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      syncExtras(kind, title);
    }, 1000)
  );
}

recapsChanged$.subscribe((recaps) => schedule('recaps', recaps.title));
lorebookChanged$.subscribe((lorebook) => schedule('lorebook', lorebook.title));

/** Pulls and pushes now (queued after a running sync); resolves without syncing for other books. */
export function syncExtras(kind: ExtrasKind, title: string): Promise<void> {
  if (!syncedTitles.has(title)) {
    return Promise.resolve();
  }

  const key = `${kind}\n${title}`;
  const next = (queues.get(key) ?? Promise.resolve()).then(() =>
    kind === 'recaps'
      ? syncOnce(kind, specs.recaps, title, key)
      : syncOnce(kind, specs.lorebook, title, key)
  );

  queues.set(key, next);

  return next;
}

function setError(kind: ExtrasKind, message: string) {
  extrasSyncError$.next({ ...extrasSyncError$.getValue(), [kind]: message });
}

async function syncOnce<T extends { title: string; account?: string }>(
  kind: ExtrasKind,
  spec: Spec<T>,
  title: string,
  key: string
) {
  try {
    await accountReady();

    const owner = currentAccount()?.id ?? '';
    const store = await syncFileStore(syncedTitles.get(title) ?? '');

    if (!store) return;

    await syncJsonFile<T>(store, spec.file, title, spec.parse, async (remote) => {
      // Read, merge and write in one transaction, so a save made during the fetch isn't lost.
      const tx = (await readerDb()).transaction(spec.store, 'readwrite');
      const stored = (await tx.store.get(title)) as T | undefined;
      // Another sign-in state's copy stays out of this account (it is on that account's server).
      const local = stored && (stored.account ?? owner) === owner ? stored : undefined;
      const merged = spec.merge(title, local, remote);
      const changed = !spec.same(merged, stored) || stored?.account !== owner;

      if (changed) {
        await tx.store.put({ ...merged, account: owner } as never);
      }

      await tx.done;

      if (changed) {
        applying.add(key);
        try {
          spec.changed$.next(merged);
        } finally {
          applying.delete(key);
        }
      }

      if (spec.same(merged, remote)) return undefined;

      const { account: _account, ...upload } = merged;

      return upload as T;
    });

    setError(kind, '');
  } catch (error: any) {
    const message = `${kind === 'recaps' ? 'Recap' : 'Lore'} sync failed: ${error.message}`;

    logger.warn(message);
    setError(kind, message);
  }
}

/** The store for kanji.json and words.json, once this browser's data belongs to the reader syncing. */
async function readerStore() {
  const user = await accountReady();

  // This browser still holds another reader's data (signed out: '' once released).
  if ((await readerDataOwner()) !== (user?.id ?? '')) return undefined;

  return readerSyncStore(!!user);
}
/** The file holds every book, so uploads wait for a pause in reading. */
const kanjiUploadDelay = 30_000;
/** Reads within this time of a sync don't download again. */
const kanjiFreshFor = 60_000;

let kanjiTimer: ReturnType<typeof setTimeout> | undefined;
let kanjiQueue = Promise.resolve();
let kanjiSyncedAt = 0;

const newerKanji = (a: KanjiSeen, b: KanjiSeen) =>
  (a.modified ?? 0) - (b.modified ?? 0) || a.upTo - b.upTo;

const sameKanji = (a: KanjiSeen, b?: KanjiSeen) =>
  !!b && a.modified === b.modified && a.upTo === b.upTo;

/**
 * Keeps the newest record per title (records from before syncing: the one read
 * further). Counts are never added: both devices may have counted the same reading.
 */
export function mergeKanji(local: KanjiSeen[], remote: KanjiSeen[]) {
  const merged = new Map(local.map((book) => [book.title, book]));

  for (const book of remote) {
    const mine = merged.get(book.title);

    if (!mine || newerKanji(book, mine) > 0) {
      merged.set(book.title, book);
    }
  }

  return [...merged.values()];
}

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** kanji.json: malformed books are dropped; undefined when `books` isn't a list. */
export function parseKanjiFile(raw: any): { books: KanjiSeen[] } | undefined {
  if (!Array.isArray(raw?.books)) return undefined;

  return {
    books: raw.books.filter(
      (book: any) =>
        typeof book?.title === 'string' && typeof book.upTo === 'number' && isRecord(book.counts)
    )
  };
}

/** Uploads a while after the reader records kanji. */
export function kanjiChanged() {
  clearTimeout(kanjiTimer);
  kanjiTimer = setTimeout(syncKanji, kanjiUploadDelay);
}

/** Downloads before kanji are read or recorded, unless synced a moment ago. */
export function pullKanji() {
  return Date.now() - kanjiSyncedAt < kanjiFreshFor ? Promise.resolve() : syncKanji();
}

export function syncKanji(): Promise<void> {
  kanjiQueue = kanjiQueue.then(syncKanjiOnce);

  return kanjiQueue;
}

async function syncKanjiOnce() {
  try {
    const store = await readerStore();

    if (!store) return;

    await syncJsonFile(store, 'kanji.json', undefined, parseKanjiFile, async (file) => {
      const remote = file?.books ?? [];
      const tx = (await readerDb()).transaction('kanji', 'readwrite');
      const local = await tx.store.getAll();
      const merged = mergeKanji(local, remote);
      const localByTitle = new Map(local.map((book) => [book.title, book]));
      const remoteByTitle = new Map(remote.map((book) => [book.title, book]));

      await Promise.all(
        merged
          .filter((book) => !sameKanji(book, localByTitle.get(book.title)))
          .map((book) => tx.store.put(book))
      );
      await tx.done;

      return merged.some((book) => !sameKanji(book, remoteByTitle.get(book.title)))
        ? { books: merged }
        : undefined;
    });

    kanjiSyncedAt = Date.now();
  } catch (error: any) {
    logger.warn(`Kanji sync failed: ${error.message}`);
  }
}

let wordsTimer: ReturnType<typeof setTimeout> | undefined;
let wordsQueue = Promise.resolve();
let wordsSyncedAt = 0;

/** Keeps the newest mark per word, removals (status null) included. */
export function mergeWordMarks(local: WordMarks, remote: WordMarks) {
  const merged = { ...local };

  for (const [key, mark] of Object.entries(remote)) {
    const known = merged[key];
    // On a tie the removal wins, so both devices end with the same marks.
    const tieRemoved = mark.modified === known?.modified && mark.status === null;

    if (!known || mark.modified > known.modified || tieRemoved) {
      merged[key] = mark;
    }
  }

  return merged;
}

const sameMarks = (a: WordMarks, b: WordMarks) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(
    ([key, mark]) => b[key]?.modified === mark.modified && b[key]?.status === mark.status
  );

/**
 * words.json: marks without a `modified` are dropped; a status this version doesn't know (a newer
 * one's) is kept, so it survives the next upload (getWordMarks leaves it out). Undefined when
 * `words` isn't a map.
 */
export function parseWordMarksFile(raw: any): { words: WordMarks } | undefined {
  if (!isRecord(raw?.words)) return undefined;

  return {
    words: Object.fromEntries(
      Object.entries(raw.words as WordMarks).filter(
        ([, mark]: [string, any]) =>
          typeof mark?.modified === 'number' &&
          (mark.status === null || typeof mark.status === 'string')
      )
    )
  };
}

/** Uploads a moment after the reader marks words. */
export function wordMarksChanged() {
  clearTimeout(wordsTimer);
  wordsTimer = setTimeout(syncWordMarks, 2000);
}

/** Downloads before the marks are read, unless synced a moment ago. */
export function pullWordMarks() {
  return Date.now() - wordsSyncedAt < kanjiFreshFor ? Promise.resolve() : syncWordMarks();
}

export function syncWordMarks(): Promise<void> {
  wordsQueue = wordsQueue.then(syncWordMarksOnce);

  return wordsQueue;
}

async function syncWordMarksOnce() {
  try {
    const store = await readerStore();

    if (!store) return;

    await syncJsonFile(store, 'words.json', undefined, parseWordMarksFile, async (file) => {
      const remote = file?.words ?? {};
      const tx = (await readerDb()).transaction('known', 'readwrite');
      const local = ((await tx.store.get('marks')) ?? {}) as WordMarks;
      const merged = mergeWordMarks(local, remote);

      if (!sameMarks(merged, local)) {
        await tx.store.put(merged, 'marks');
      }
      await tx.done;

      return sameMarks(merged, remote) ? undefined : { words: merged };
    });

    wordsSyncedAt = Date.now();
  } catch (error: any) {
    logger.warn(`Word marks sync failed: ${error.message}`);
  }
}

let immersionTimer: ReturnType<typeof setTimeout> | undefined;
let immersionQueue = Promise.resolve();
let immersionSyncedAt = 0;

/** immersion.json: malformed entries are dropped; undefined when `entries` isn't a map. */
export function parseImmersionFile(raw: any): { entries: ImmersionLog } | undefined {
  if (!isRecord(raw?.entries)) return undefined;

  return {
    entries: Object.fromEntries(
      Object.entries(raw.entries as ImmersionLog).filter(
        ([id, entry]) => isImmersionEntry(entry) && entry.id === id
      )
    )
  };
}

/**
 * Uploads a while after the first unsynced change: not reset by later ones, since the texthooker
 * writes at every line.
 */
export function immersionChanged() {
  immersionTimer ??= setTimeout(() => {
    immersionTimer = undefined;
    syncImmersion();
  }, kanjiUploadDelay);
}

/** Downloads before the log is shown, unless synced a moment ago. */
export function pullImmersion() {
  return Date.now() - immersionSyncedAt < kanjiFreshFor ? Promise.resolve() : syncImmersion();
}

export function syncImmersion(): Promise<void> {
  immersionQueue = immersionQueue.then(syncImmersionOnce);

  return immersionQueue;
}

async function syncImmersionOnce() {
  try {
    const store = await readerStore();

    if (!store) return;

    await syncJsonFile(store, 'immersion.json', undefined, parseImmersionFile, async (file) => {
      const remote = file?.entries ?? {};
      const tx = (await readerDb()).transaction('known', 'readwrite');
      const local = ((await tx.store.get('immersion')) ?? {}) as ImmersionLog;
      const merged = mergeImmersion(local, remote);

      if (!sameImmersion(merged, local)) {
        await tx.store.put(merged, 'immersion');
      }
      await tx.done;

      return sameImmersion(merged, remote) ? undefined : { entries: merged };
    });

    immersionSyncedAt = Date.now();
  } catch (error: any) {
    logger.warn(`Immersion log sync failed: ${error.message}`);
  }
}
