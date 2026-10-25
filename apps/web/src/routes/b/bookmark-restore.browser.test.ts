/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewMode } from '$lib/data/view-mode';
// @ts-expect-error tsconfig's moduleResolution "node" doesn't read package exports; Vitest does.
import { page as browserPage } from 'vitest/browser';
import { autoBookmarkTime$, database } from '$lib/data/store';
import {
  addBook,
  mountReader,
  onScreen,
  openReader,
  panelOpen,
  paragraphAt,
  togglePanel,
  visibleParagraphs,
  waitOnScreen
} from './reader-fixture';

/*
 * The whole /b page in Chromium with a book and a bookmark in this browser's IndexedDB: the reader
 * must open on the bookmarked paragraph (#215: a late subscriber missed the book and every book
 * opened at the start). Only navigation and the page store are stubbed; no sync, no server.
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

let component: { $destroy(): void } | undefined;

const close = () => {
  component?.$destroy();
  component = undefined;
  document.body.innerHTML = '';
  scrollTo(0, 0);
};

afterEach(async () => {
  close();
  autoBookmarkTime$.next(3);
  await browserPage.viewport(1000, 700);
});

const key = (code: string) => dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

describe('/b reopens a book at its bookmark', () => {
  for (const view of [ViewMode.Paginated, ViewMode.Continuous]) {
    for (const writing of ['horizontal-tb', 'vertical-rl'] as const) {
      it(`${view}, ${writing}`, async () => {
        component = await openReader(view, writing);
        expect(onScreen(document.getElementById('p-2-1'))).toBe(false);
      });
    }
  }
});

describe('/b reopens where reading stopped (page turns, the auto bookmark; a novel-like book)', () => {
  for (const view of [ViewMode.Paginated, ViewMode.Continuous]) {
    for (const writing of ['horizontal-tb', 'vertical-rl'] as const) {
      for (const [width, panel] of [
        [1000, false],
        [1300, false],
        [1000, true]
      ] as const) {
        const name = panel
          ? 'the side panel opened and closed in between'
          : `reopened ${width}px wide`;
        it(`${view}, ${writing}, ${name}`, async () => {
          autoBookmarkTime$.next(panel ? 1 : 0.3);
          const id = await addBook(2, 25, true);
          component = await mountReader(id, view, writing);
          await waitOnScreen('p-2-25');
          await settle();
          const opened = (await database.getBookmark(id))!.exploredCharCount;

          for (let turn = 0; turn < 3; turn++) {
            key('PageDown');
            await settle(300);
          }
          const read = visibleParagraphs();
          if (panel) {
            await togglePanel();
            await vi.waitFor(() => expect(panelOpen()).toBe(true));
            await settle(300);
            await togglePanel();
            await vi.waitFor(() => expect(panelOpen()).toBe(false));
          }
          await vi
            .waitFor(
              async () =>
                expect((await database.getBookmark(id))!.exploredCharCount).not.toBe(opened),
              { timeout: 5000 }
            )
            .catch(() => {}); // Checked below, with what was on screen.
          await settle(1500);
          const shown = visibleParagraphs();
          const saved = (await database.getBookmark(id))!.exploredCharCount ?? 0;
          const marked = paragraphAt(saved, true);
          const what = `read ${read}, left at ${shown}, bookmark ${saved} in ${marked}`;
          // Continuous may settle a few lines off; the bookmark must be in what was read.
          expect(read, what).toContain(marked);
          close();

          await browserPage.viewport(width, 700);
          component = await mountReader(id, view, writing);
          await waitOnScreen(marked).catch(() => {});
          await settle(800);
          expect(
            onScreen(document.getElementById(marked)),
            `${what}, reopened at ${visibleParagraphs()}`
          ).toBe(true);
        });
      }
    }
  }
});
