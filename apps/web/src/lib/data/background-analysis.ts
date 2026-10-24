/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Standalone: stored books get their difficulty estimate and word list, and their readings file
 * while Generated furigana is on, in the background with the downloaded analysis tools
 * (analysis-tools.ts): when a book is saved (BrowserStorageHandler.saveBook), and once per app
 * start (and when Generated furigana is turned on) for books still without them. One book at a time, behind what the reader asks for.
 * Manga, visual novels and placeholders are skipped. Not part of upstream.
 */

import { BehaviorSubject, filter, skip } from 'rxjs';
import {
  analysisTag,
  analysisToolsSupported,
  installedTools,
  keptEstimate,
  keptReadings,
  keptWordList,
  localEstimate,
  makeReadings,
  redoWordList
} from '$lib/data/analysis-tools';
import { isManga } from '$lib/data/manga';
import { database, generatedFurigana$ } from '$lib/data/store';
import { StorageKey } from '$lib/data/storage/storage-types';
import { storageSource$ } from '$lib/data/storage/storage-view';
import { isVn } from '$lib/data/vn';

/** The book being analysed (1-based), how many are queued with it and its percent, while any are. */
export const backgroundAnalysis$ = new BehaviorSubject<
  { current: number; total: number; percent: number } | undefined
>(undefined);

/** A book whose analysis gets no further for this long is given up (a large novel takes ~3 min). */
export const BACKGROUND_STALL_MS = 10 * 60 * 1000;

const waiting: string[] = [];
/** Books given up or failed: not tried again until the next start. */
const skipped = new Set<string>();
/** Books whose word list made without the Reader is redone after their estimate (redoWordLists). */
const redo = new Set<string>();
let done = 0;
let percent = 0;
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
    waiting.length ? { current: done + 1, total: done + waiting.length, percent } : undefined
  );
}

async function analyse(title: string) {
  const book = await storedBook(title);

  if (!book) return;

  const controller = new AbortController();
  const { signal } = controller;
  const readings = generatedFurigana$.getValue();
  const redoList = redo.has(title);
  const parts = 1 + +readings + +redoList;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let giveUp = () => {};
  // Rejects once the book's percent has stood still for BACKGROUND_STALL_MS.
  const stalled = new Promise<never>((_, reject) => {
    giveUp = () => {
      controller.abort();
      reject(new Error(`no progress for ${BACKGROUND_STALL_MS / 60000} minutes`));
    };
  });
  const wait = () => {
    clearTimeout(timer);
    timer = setTimeout(giveUp, BACKGROUND_STALL_MS);
  };
  // Each part's share (readings, then the estimate) moves the book's percent and the stall timer.
  const progress = (part: number) => (share: number) => {
    const value = Math.floor(((part + share) / parts) * 100);

    // signal: an abandoned job that still reports must not move the next book's percent.
    if (signal.aborted || value <= percent) return;
    percent = value;
    wait();
    report();
  };

  wait();

  const work = async () => {
    // Readings first: they are what a reader opening the book waits for.
    if (readings) {
      await makeReadings(title, book.elementHtml, progress(0), signal, true).catch((error) => {
        if (signal.aborted) throw error;
        console.warn(`Background analysis: no readings file for “${title}”`, error);
      });
    }

    const before = (await keptEstimate(title))?.etag;
    const estimate = await localEstimate(
      title,
      book.elementHtml,
      progress(+readings),
      signal,
      true
    );

    if (estimate && estimate.etag !== before) estimated = true;
    // Right after the book's other parts, so the worker still has its tokens.
    if (redoList) {
      redo.delete(title);
      await redoWordList(title, book.elementHtml, progress(parts - 1), signal, true);
    }
  };

  // The race lets the queue go on even when the stalled job never settles.
  stalled.catch(() => undefined);
  try {
    await Promise.race([work(), stalled]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function run() {
  while (waiting.length) {
    const title = waiting[0];

    percent = 0;
    report();
    // A book that fails is passed over until the next start: the queue and its progress go on.
    await analyse(title).catch((error) => {
      skipped.add(title);
      console.warn(`Background analysis: skipped “${title}” until the next start`, error);
    });
    waiting.shift();
    done += 1;
  }
  // In the same tick as the last shift: a title queued after it starts a new run, not this one.
  running = undefined;
  done = 0;
  percent = 0;
  report();
  if (estimated) {
    estimated = false;
    await refreshLibrary().catch((error) => console.warn('Background analysis:', error));
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
        !skipped.has(title) &&
        (await stale(title, difficulty, furigana).catch(() => false))
      ) {
        queue(title);
      }
    }
  });

  return checking;
}

function queue(title: string) {
  waiting.push(title);
  report();
  running ??= run();
}

/** Queues these books' word lists made without the Reader to be made with it (opt-in). */
export function redoWordLists(titles: string[]) {
  checking = checking.then(() => {
    for (const title of titles) {
      redo.add(title);
      // The book running now has passed its redo: queued again.
      if (waiting.indexOf(title) < 1) queue(title);
    }
  });

  return checking;
}

/**
 * Once per app start, when the page is idle: every stored book still missing something; and again
 * whenever Generated furigana is turned on, for their readings files.
 */
export function catchUpAnalysis() {
  if (caughtUp || !analysisToolsSupported()) return;
  caughtUp = true;

  generatedFurigana$
    .pipe(skip(1), filter(Boolean))
    .subscribe(() =>
      analyseStoredBooks().catch((error) => console.warn('Background analysis:', error))
    );

  const idle = (callback: () => void) =>
    'requestIdleCallback' in window
      ? requestIdleCallback(callback, { timeout: 10000 })
      : setTimeout(callback, 2000);

  idle(() => analyseStoredBooks().catch((error) => console.warn('Background analysis:', error)));
}

async function storedTitles() {
  const db = await database.db;
  const titles: string[] = [];
  let cursor = await db.transaction('data').store.index('title').openKeyCursor();

  while (cursor) {
    titles.push(cursor.key as string);
    cursor = await cursor.continue();
  }

  return titles;
}

/** Queues every stored book the installed tools have something new for. */
export async function analyseStoredBooks() {
  return analyseInBackground(await storedTitles());
}

/**
 * The stored books (of `titles`, else all) the furigana tools would make a readings file for and
 * that aren't queued yet: Generate readings queues them with analyseInBackground.
 */
export async function booksWithoutReadings(titles?: string[]) {
  const furigana = await installedTools('furigana');
  const found: string[] = [];

  if (!furigana) return found;
  for (const title of titles ?? (await storedTitles())) {
    if (!waiting.includes(title) && (await stale(title, undefined, furigana).catch(() => false))) {
      found.push(title);
    }
  }

  return found;
}

/** The stored books whose current word list was made without the Reader, once furigana is installed. */
export async function wordListsWithoutReader(titles?: string[]) {
  const furigana = await installedTools('furigana');
  const found: string[] = [];

  if (!furigana) return found;
  for (const title of titles ?? (await storedTitles())) {
    const [estimate, list] = await Promise.all([keptEstimate(title), keptWordList(title)]);

    if (!redo.has(title) && list?.reader === false && list.etag === estimate?.etag) {
      found.push(title);
    }
  }

  return found;
}

/** Resolves when nothing is queued or being checked (tests). */
export async function backgroundAnalysisIdle() {
  await checking;
  await running;
}
