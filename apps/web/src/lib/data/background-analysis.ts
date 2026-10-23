/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Standalone: stored books get their difficulty estimate and word list, and their readings file
 * while Generated furigana is on, in the background with the downloaded analysis tools
 * (analysis-tools.ts): when a book is saved (BrowserStorageHandler.saveBook), and once per app
 * start for books still without them. One book at a time, behind what the reader asks for.
 * Manga, visual novels and placeholders are skipped. Not part of upstream.
 */

import { BehaviorSubject } from 'rxjs';
import {
  analysisTag,
  analysisToolsSupported,
  installedTools,
  keptEstimate,
  keptReadings,
  localEstimate,
  makeReadings
} from '$lib/data/analysis-tools';
import { isManga } from '$lib/data/manga';
import { database, generatedFurigana$ } from '$lib/data/store';
import { StorageKey } from '$lib/data/storage/storage-types';
import { storageSource$ } from '$lib/data/storage/storage-view';
import { isVn } from '$lib/data/vn';

/** The book being analysed (1-based) and how many are queued with it, while any are. */
export const backgroundAnalysis$ = new BehaviorSubject<
  { current: number; total: number } | undefined
>(undefined);

const waiting: string[] = [];
let done = 0;
let checking = Promise.resolve();
let running: Promise<void> | undefined;
let estimated = false;
let caughtUp = false;

type Tools = Awaited<ReturnType<typeof installedTools>>;

async function storedBook(title: string) {
  const book = await database.getDataByTitle(title);

  return book?.elementHtml && !isManga(book) && !isVn(book) ? book : undefined;
}

/** Whether the installed tools would make something new for the book. */
async function stale(title: string, difficulty: Tools, furigana: Tools) {
  const book = await storedBook(title);

  if (!book) return false;

  const [estimate, readings] = await Promise.all([
    difficulty && keptEstimate(title),
    furigana && keptReadings(title)
  ]);

  return (
    (!!difficulty &&
      estimate?.etag !== (await analysisTag(book.elementHtml, difficulty.version))) ||
    (!!furigana && readings?.etag !== (await analysisTag(book.elementHtml, furigana.version)))
  );
}

function report() {
  backgroundAnalysis$.next(
    waiting.length ? { current: done + 1, total: done + waiting.length } : undefined
  );
}

async function analyse(title: string) {
  const book = await storedBook(title);

  if (!book) return;
  // Readings first: they are what a reader opening the book waits for.
  if (generatedFurigana$.getValue()) {
    await makeReadings(title, book.elementHtml, undefined, undefined, true).catch(() => undefined);
  }

  const before = (await keptEstimate(title))?.etag;
  const estimate = await localEstimate(title, book.elementHtml, undefined, undefined, true).catch(
    () => undefined
  );

  if (estimate && estimate.etag !== before) estimated = true;
}

async function run() {
  while (waiting.length) {
    report();
    // A book that fails is passed over: the queue and its progress go on.
    await analyse(waiting[0]).catch(() => undefined);
    waiting.shift();
    done += 1;
  }
  // In the same tick as the last shift: a title queued after it starts a new run, not this one.
  running = undefined;
  done = 0;
  report();
  if (estimated) {
    estimated = false;
    await refreshLibrary().catch(() => undefined);
  }
}

/** Shows the new estimates on the library's cards (they come from the browser handler's list). */
async function refreshLibrary() {
  if (storageSource$.getValue() !== StorageKey.BROWSER) return;

  const { getStorageHandler } = await import('$lib/data/storage/storage-handler-factory');
  const handler = getStorageHandler(window, StorageKey.BROWSER, '');

  handler.clearData();
  database.dataListChanged$.next(handler);
}

/** Queues the stored books with these titles that the installed tools have something new for. */
export function analyseInBackground(titles: string[]) {
  if (!titles.length || !analysisToolsSupported()) return checking;

  checking = checking.then(async () => {
    const [difficulty, furigana] = await Promise.all([
      installedTools('difficulty'),
      generatedFurigana$.getValue() ? installedTools('furigana') : undefined
    ]);

    if (!difficulty && !furigana) return;

    for (const title of titles) {
      if (
        !waiting.includes(title) &&
        (await stale(title, difficulty, furigana).catch(() => false))
      ) {
        waiting.push(title);
        report();
        running ??= run();
      }
    }
  });

  return checking;
}

/** Once per app start, when the page is idle: every stored book still missing something. */
export function catchUpAnalysis() {
  if (caughtUp || !analysisToolsSupported()) return;
  caughtUp = true;

  const idle = (callback: () => void) =>
    'requestIdleCallback' in window
      ? requestIdleCallback(callback, { timeout: 10000 })
      : setTimeout(callback, 2000);

  idle(() => analyseStoredBooks().catch(() => undefined));
}

/** Queues every stored book the installed tools have something new for. */
export async function analyseStoredBooks() {
  const db = await database.db;
  const titles: string[] = [];
  let cursor = await db.transaction('data').store.index('title').openKeyCursor();

  while (cursor) {
    titles.push(cursor.key as string);
    cursor = await cursor.continue();
  }

  return analyseInBackground(titles);
}

/** Resolves when nothing is queued or being checked (tests). */
export async function backgroundAnalysisIdle() {
  await checking;
  await running;
}
