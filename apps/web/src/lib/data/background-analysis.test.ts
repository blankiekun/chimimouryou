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
const furigana = vi.hoisted(() => ({ on: undefined as unknown as BehaviorSubject<boolean> }));

vi.mock('$lib/data/analysis-tools', () => tools);
vi.mock('$lib/data/store', async () => {
  const { BehaviorSubject } = await import('rxjs');

  furigana.on = new BehaviorSubject(false);

  return {
    database: { getDataByTitle: async (title: string) => books[title] },
    generatedFurigana$: furigana.on
  };
});
vi.mock('$lib/data/storage/storage-view', async () => {
  const { BehaviorSubject } = await import('rxjs');

  return { storageSource$: new BehaviorSubject('gdrive') };
});

const { analyseInBackground, backgroundAnalysisIdle } = await import('./background-analysis');

const titles = Object.keys(books);
const analysed = (mock: typeof tools.localEstimate | typeof tools.makeReadings) =>
  mock.mock.calls.map((call) => (call as unknown[])[0]);

describe('background analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
