/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const books: Record<string, { title: string; elementHtml: string }> = {
  novel: { title: 'novel', elementHtml: '<p>本</p>' },
  done: { title: 'done', elementHtml: '<p>済</p>' },
  manga: { title: 'manga', elementHtml: '<!--ttu-manga-->[]' },
  vn: { title: 'vn', elementHtml: '<!--ttu-vn-->{}' },
  placeholder: { title: 'placeholder', elementHtml: '' }
};

const tools = vi.hoisted(() => ({
  analysisToolsSupported: vi.fn(() => true),
  installedTools: vi.fn(async (_feature: string) => ({ version: 'v1' })),
  analysisTag: vi.fn(async (html: string, version: string) => `${version} ${html}`),
  keptEstimate: vi.fn(async (_title: string) => undefined as { etag: string } | undefined),
  keptReadings: vi.fn(async (_title: string) => undefined as { etag: string } | undefined),
  localEstimate: vi.fn(async (title: string) => ({ title, etag: 'new' })),
  makeReadings: vi.fn(async () => undefined),
  keptWordList: vi.fn(async (_title: string) => undefined as unknown),
  redoWordList: vi.fn(async () => undefined)
}));
const db = vi.hoisted(() => ({
  get: (title: string) => books[title] as unknown,
  refreshed: () => {}
}));
const source = vi.hoisted(() => ({ value: 'gdrive' }));
const storedCursor = vi.hoisted(() => {
  const cursor = (i: number): unknown =>
    i < Object.keys(books).length
      ? { key: Object.keys(books)[i], continue: async () => cursor(i + 1) }
      : null;

  return cursor;
});
const furigana = vi.hoisted(() => ({ on: undefined as unknown as BehaviorSubject<boolean> }));

const capacity = vi.hoisted(() => ({ workers: 1 }));

vi.mock('$lib/data/analysis/analysis-tools', () => tools);
vi.mock('$lib/data/analysis/analysis-capacity', () => ({
  analysisWorkers: () => capacity.workers
}));
vi.mock('$lib/data/store', async () => {
  const { BehaviorSubject } = await import('rxjs');

  furigana.on = new BehaviorSubject(false);

  return {
    database: {
      db: Promise.resolve({
        transaction: () => ({
          store: { index: () => ({ openKeyCursor: async () => storedCursor(0) }) }
        })
      }),
      getDataByTitle: async (title: string) => db.get(title),
      dataListChanged$: { next: () => db.refreshed() }
    },
    generatedFurigana$: furigana.on
  };
});
vi.mock('$lib/data/storage/storage-view', () => {
  return { storageSource$: { getValue: () => source.value } };
});
vi.mock('$lib/data/storage/storage-handler-factory', () => ({
  getStorageHandler: () => ({ clearData: () => {} })
}));

const {
  analyseInBackground,
  backgroundAnalysis$,
  backgroundAnalysisIdle,
  BACKGROUND_STALL_MS,
  booksWithoutReadings,
  catchUpAnalysis,
  redoWordLists,
  wordListsWithoutReader
} = await import('./background-analysis');

const titles = Object.keys(books);
const analysed = (mock: typeof tools.localEstimate | typeof tools.makeReadings) =>
  mock.mock.calls.map((call) => (call as unknown[])[0]);

describe('background analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capacity.workers = 1;
    db.get = (title) => books[title];
    db.refreshed = () => {};
    source.value = 'gdrive';
    // "done" already has an estimate and readings file from these tools.
    tools.keptEstimate.mockImplementation(async (title) =>
      title === 'done' ? { etag: `v1 ${books.done.elementHtml}` } : undefined
    );
    tools.keptReadings.mockImplementation(async (title) =>
      title === 'done' ? { etag: `v1 ${books.done.elementHtml}` } : undefined
    );
  });

  it('estimates stale books only, skipping manga, VNs and placeholders', async () => {
    furigana.on.next(false);
    analyseInBackground(titles);
    await backgroundAnalysisIdle();

    expect(analysed(tools.localEstimate)).toEqual(['novel']);
    expect(tools.makeReadings).not.toHaveBeenCalled();
    expect(tools.installedTools).not.toHaveBeenCalledWith('furigana');
  });

  it('makes readings files too while Generated furigana is on', async () => {
    furigana.on.next(true);
    analyseInBackground(titles);
    await backgroundAnalysisIdle();

    expect(analysed(tools.makeReadings)).toEqual(['novel']);
    expect(analysed(tools.localEstimate)).toEqual(['novel']);
    // Behind the reader's own jobs.
    expect(tools.localEstimate.mock.calls[0]).toContain(true);
  });

  it('queues readings files when Generated furigana is turned on later', async () => {
    vi.useFakeTimers();
    furigana.on.next(false);
    catchUpAnalysis();
    furigana.on.next(true);
    await vi.waitFor(() => expect(analysed(tools.makeReadings)).toEqual(['novel']));
    await backgroundAnalysisIdle();
    vi.useRealTimers();
  });

  it('lists the books Generate readings would make readings for', async () => {
    expect(await booksWithoutReadings(titles)).toEqual(['novel']);
    tools.installedTools.mockResolvedValueOnce(undefined as never);
    expect(await booksWithoutReadings(titles)).toEqual([]);
  });

  it('redoes word lists made without the Reader only when asked, after the estimate', async () => {
    tools.keptWordList.mockImplementation(async (title) =>
      title === 'done' ? { etag: `v1 ${books.done.elementHtml}`, reader: false } : undefined
    );
    expect(await wordListsWithoutReader(titles)).toEqual(['done']);

    furigana.on.next(true);
    analyseInBackground(titles);
    await backgroundAnalysisIdle();
    expect(tools.redoWordList).not.toHaveBeenCalled();

    redoWordLists(['done']);
    await backgroundAnalysisIdle();
    expect(analysed(tools.redoWordList)).toEqual(['done']);
  });

  it('does nothing without the tools', async () => {
    tools.installedTools.mockResolvedValueOnce(undefined as never);
    tools.installedTools.mockResolvedValueOnce(undefined as never);
    analyseInBackground(titles);
    await backgroundAnalysisIdle();

    expect(tools.localEstimate).not.toHaveBeenCalled();
  });

  it('passes over a book that fails and clears the progress', async () => {
    furigana.on.next(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let reads = 0;

    // "broken" is readable when checked, then its record fails to load when analysed.
    books.broken = { title: 'broken', elementHtml: '<p>壊</p>' };
    db.get = (title) => {
      if (title === 'broken' && (reads += 1) > 1) throw new Error('UnknownError');
      return books[title];
    };
    tools.localEstimate.mockImplementation(async (title) => ({ title, etag: 'new' }));
    analyseInBackground(['broken', 'other']);
    books.other = { title: 'other', elementHtml: '<p>他</p>' };
    await backgroundAnalysisIdle();
    delete books.other;
    delete books.broken;

    expect(analysed(tools.localEstimate)).toEqual(['other']);
    expect(backgroundAnalysis$.getValue()).toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it('runs a book queued while the last one is being finished', async () => {
    furigana.on.next(false);
    source.value = 'browser';
    // The library refresh after the last estimate is the moment a newly saved book arrives.
    db.refreshed = () => {
      db.refreshed = () => {};
      books.late = { title: 'late', elementHtml: '<p>遅</p>' };
      analyseInBackground(['late']);
    };
    analyseInBackground(['novel']);
    await backgroundAnalysisIdle();
    await vi.waitFor(() => expect(analysed(tools.localEstimate)).toEqual(['novel', 'late']));
    await backgroundAnalysisIdle();
    delete books.late;

    expect(backgroundAnalysis$.getValue()).toBeUndefined();
  });

  it('analyses two books at once on large machines, one on small ones, counting each once', async () => {
    furigana.on.next(false);
    const batch = ['b1', 'b2', 'b3'];

    batch.forEach((title) => (books[title] = { title, elementHtml: `<p>${title}</p>` }));

    for (const workers of [1, 2]) {
      capacity.workers = workers;
      vi.clearAllMocks();

      const running = new Set<string>();
      const finish = new Map<string, () => void>();
      let most = 0;

      // Each book's estimate waits until the test lets it finish.
      tools.localEstimate.mockImplementation(((title: string) => {
        running.add(title);
        most = Math.max(most, running.size);
        return new Promise((resolve) =>
          finish.set(title, () => {
            running.delete(title);
            resolve({ title, etag: 'new' });
          })
        );
      }) as never);
      analyseInBackground(batch);
      await vi.waitFor(() => expect(running.size).toBe(workers));
      expect(backgroundAnalysis$.getValue()).toMatchObject({ current: 1, total: 3 });

      for (const title of batch) {
        await vi.waitFor(() => expect(finish.has(title)).toBe(true));
        finish.get(title)!();
      }
      await backgroundAnalysisIdle();

      expect(most).toBe(workers);
      expect(analysed(tools.localEstimate)).toEqual(batch);
      expect(backgroundAnalysis$.getValue()).toBeUndefined();
    }
    batch.forEach((title) => delete books[title]);
    tools.localEstimate.mockImplementation(async (title) => ({ title, etag: 'new' }));
  });

  it("shows the book's percent and gives up a book that stops moving until the next start", async () => {
    furigana.on.next(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();

    const seen: (number | undefined)[] = [];
    const subscription = backgroundAnalysis$.subscribe((value) => seen.push(value?.percent));
    let signal: AbortSignal | undefined;

    // Moves to 40%, then never settles.
    tools.localEstimate.mockImplementationOnce((async (
      _title: string,
      _html: string,
      onProgress: (share: number) => void,
      stop: AbortSignal
    ) => {
      signal = stop;
      onProgress(0.4);
      return new Promise(() => {});
    }) as never);
    analyseInBackground(['novel']);
    await vi.advanceTimersByTimeAsync(BACKGROUND_STALL_MS - 1000);
    expect(backgroundAnalysis$.getValue()).toEqual({ current: 1, total: 1, percent: 40 });
    await vi.advanceTimersByTimeAsync(2000);
    await backgroundAnalysisIdle();
    vi.useRealTimers();
    subscription.unsubscribe();

    expect(signal?.aborted).toBe(true);
    expect(seen).toContain(40);
    expect(backgroundAnalysis$.getValue()).toBeUndefined();
    expect(console.warn).toHaveBeenCalled();

    // Not tried again in this session.
    analyseInBackground(['novel']);
    await backgroundAnalysisIdle();
    expect(analysed(tools.localEstimate)).toEqual(['novel']);
  });
});
