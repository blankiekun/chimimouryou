/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  database,
  trackerBackwardSkipThreshold$,
  trackerForwardSkipThreshold$,
  trackerStartOnOpen$,
  writingMode$
} from '$lib/data/store';
import { ViewMode } from '$lib/data/view-mode';
import { addBook, mountReader, waitOnScreen } from './reader-fixture';

/*
 * The whole /b page in Chromium, with the skip thresholds off so a wrong jump isn't hidden. Bugs:
 * - a re-render counts from 0 until the place is back: read as moving back (today loses what was
 *   read) and then forward (the whole position is added);
 * - the tracker starting before a slow restore: the jump to the bookmark counts as reading.
 */

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn()
}));
vi.mock('$lib/data/page-store', async () => {
  const { writable } = await import('svelte/store');
  return { page: writable({ url: new URL(location.href), route: { id: '/b' }, state: {} }) };
});

const views = [ViewMode.Paginated, ViewMode.Continuous];
const writings = ['horizontal-tb', 'vertical-rl'] as const;
const other = (writing: (typeof writings)[number]) =>
  writing === 'vertical-rl' ? 'horizontal-tb' : 'vertical-rl';
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let component: { $destroy(): void } | undefined;

trackerStartOnOpen$.next(true);
trackerForwardSkipThreshold$.next(0);
trackerBackwardSkipThreshold$.next(0);

afterEach(() => {
  component?.$destroy();
  component = undefined;
  document.body.innerHTML = '';
  scrollTo(0, 0);
  vi.restoreAllMocks();
});

/** Today's characters once the tracker saved them: it writes when over 10 s passed. */
async function charactersRead(id: number) {
  const { title } = (await database.getData(id))!;

  return vi.waitFor(
    async () => {
      const rows = await database.getStatisticsForBook(title);

      expect(rows[0]?.readingTime).toBeGreaterThan(5);
      return rows.reduce((sum, row) => sum + row.charactersRead, 0);
    },
    { timeout: 20_000, interval: 500 }
  );
}

describe('/b tracker and the place', () => {
  for (const view of views) {
    for (const writing of writings) {
      it(`a direction change while the font loads adds nothing: ${view} ${writing}`, async () => {
        const id = await addBook(2, 25);

        component = await mountReader(id, view, writing);
        await waitOnScreen('p-2-25');
        // Running from the restored place.
        await settle(3000);
        // A web font still loading: the new render waits on it, with the tracker ticking meanwhile.
        const fontCheck = vi.spyOn(document.fonts, 'check').mockReturnValue(false);

        writingMode$.next(other(writing));
        await settle(2500);
        fontCheck.mockRestore();
        document.fonts.dispatchEvent(new Event('loadingdone'));
        await waitOnScreen('p-2-25');

        expect(Math.abs(await charactersRead(id))).toBeLessThan(500);
      }, 40_000);

      it(`a slow restore adds nothing: ${view} ${writing}`, async () => {
        const id = await addBook(2, 25);
        const getBookmark = database.getBookmark.bind(database);

        vi.spyOn(database, 'getBookmark').mockImplementation(async (dataId) => {
          await settle(4000);
          return getBookmark(dataId);
        });
        component = await mountReader(id, view, writing);
        await vi.waitFor(() => waitOnScreen('p-2-25'), { timeout: 15_000 });

        expect(await charactersRead(id)).toBe(0);
      }, 40_000);
    }
  }
});
