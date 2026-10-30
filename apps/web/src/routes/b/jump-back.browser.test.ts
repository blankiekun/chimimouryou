/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error tsconfig's moduleResolution "node" doesn't read package exports; Vitest does.
import { page as browserPage } from 'vitest/browser';
import { ViewMode } from '$lib/data/view-mode';
import { nextChapter$ } from '$lib/components/book-reader/book-toc/book-toc';
import { addBook, mountReader, visibleParagraphs, waitOnScreen } from './reader-fixture';

/*
 * Back after a jump, in the whole /b page with real layout. Catches: the place before the jump
 * read after the reader already moved (Contents and in-book links go through nextChapter$, which
 * the readers also listen to), or Back landing a page or a section off the old place.
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

afterEach(async () => {
  component?.$destroy();
  component = undefined;
  document.body.innerHTML = '';
  scrollTo(0, 0);
  await browserPage.viewport(1000, 700);
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 500));
const backButton = () =>
  document.querySelector<HTMLElement>('button[aria-label="Back to where you were"]');

describe('/b Back after a Contents jump returns to the page before it', () => {
  for (const view of [ViewMode.Paginated, ViewMode.Continuous]) {
    for (const writing of ['horizontal-tb', 'vertical-rl'] as const) {
      it(`${view}, ${writing}`, async () => {
        component = await mountReader(await addBook(2, 25, true), view, writing);
        await waitOnScreen('p-2-25');
        await settle();
        const start = visibleParagraphs();
        expect(backButton()).toBeNull();

        nextChapter$.next('ttu-ch3');
        await waitOnScreen('p-3-1');
        await vi.waitFor(() => expect(backButton()).toBeTruthy());

        backButton()!.click();
        await waitOnScreen('p-2-25');
        await settle();
        expect(visibleParagraphs()).toEqual(start);
        expect(backButton()).toBeNull();
      }, 30_000);
    }
  }
});
