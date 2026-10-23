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
  makeReadings: vi.fn(async () => undefined)
}));
const db = vi.hoisted(() => ({
  get: (title: string) => books[title] as unknown,
  refreshed: () => {}
}));
const source = vi.hoisted(() => ({ value: 'gdrive' }));
const furigana = vi.hoisted(() => ({ on: undefined as unknown as BehaviorSubject<boolean> }));

vi.mock('$lib/data/analysis-tools', () => tools);
vi.mock('$lib/data/store', async () => {
  const { BehaviorSubject } = await import('rxjs');

  furigana.on = new BehaviorSubject(false);

  return {
    database: {
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

const { analyseInBackground, backgroundAnalysis$, backgroundAnalysisIdle } = await import(
  './background-analysis'
);

const titles = Object.keys(books);
const analysed = (mock: typeof tools.localEstimate | typeof tools.makeReadings) =>
  mock.mock.calls.map((call) => (call as unknown[])[0]);

describe('background analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('does nothing without the tools', async () => {
    tools.installedTools.mockResolvedValueOnce(undefined as never);
    tools.installedTools.mockResolvedValueOnce(undefined as never);
    analyseInBackground(titles);
    await backgroundAnalysisIdle();

    expect(tools.localEstimate).not.toHaveBeenCalled();
  });

  it('passes over a book that fails and clears the progress', async () => {
    furigana.on.next(false);
    let reads = 0;

    // "novel" is readable when checked, then its record fails to load when analysed.
    db.get = (title) => {
      if (title === 'novel' && (reads += 1) > 1) throw new Error('UnknownError');
      return books[title];
    };
    tools.localEstimate.mockImplementation(async (title) => ({ title, etag: 'new' }));
    analyseInBackground(['novel', 'other']);
    books.other = { title: 'other', elementHtml: '<p>他</p>' };
    await backgroundAnalysisIdle();
    delete books.other;

    expect(analysed(tools.localEstimate)).toEqual(['other']);
    expect(backgroundAnalysis$.getValue()).toBeUndefined();
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
});
