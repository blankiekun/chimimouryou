/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error tsconfig's moduleResolution "node" doesn't read package exports; Vitest does.
import { page as browserPage } from 'vitest/browser';
import { ViewMode } from '$lib/data/view-mode';
import {
  onScreen,
  openReader,
  panelOpen,
  position,
  togglePanel,
  visibleParagraphs,
  waitOnScreen
} from './reader-fixture';

/*
 * Where the reader is after page turns, chapter jumps, the side panel and a resize, in Chromium
 * with real layout: the net under b/+page.svelte and book-reader.svelte before they change shape
 * (runes). The book opens at its bookmark, paragraph 25 of chapter 2 (reader-fixture.ts).
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

const key = (code: string) => dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));

/** Lets a re-layout (and the reader's debounced listeners) finish before checking it held. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

/** a is before b in reading order */
const before = (a: string, b: string) => {
  const [ca, pa] = position(a);
  const [cb, pb] = position(b);
  return ca < cb || (ca === cb && pa < pb);
};

for (const view of [ViewMode.Paginated, ViewMode.Continuous]) {
  for (const writing of ['horizontal-tb', 'vertical-rl'] as const) {
    describe(`${view}, ${writing}`, () => {
      // Vertical text swaps the chapter keys (M goes back), as its pages run right to left.
      const [nextChapterKey, prevChapterKey] =
        writing === 'vertical-rl' ? ['KeyN', 'KeyM'] : ['KeyM', 'KeyN'];

      it('next and previous page continue from the page edge and come back', async () => {
        component = await openReader(view, writing);
        await settle();
        const start = visibleParagraphs();

        // The next page starts with the paragraph the last one ended in, or the one after it.
        const [chapter, last] = position(start[start.length - 1]);
        key('PageDown');
        await vi.waitFor(() =>
          expect([`p-${chapter}-${last}`, `p-${chapter}-${last + 1}`]).toContain(
            visibleParagraphs()[0]
          )
        );

        key('PageUp');
        await vi.waitFor(() => expect(visibleParagraphs()).toEqual(start));
      });

      it('next and previous chapter land on the chapter start', async () => {
        component = await openReader(view, writing);

        key(nextChapterKey);
        await waitOnScreen('p-3-1');
        // Continuous jumps keep a line of the page before in view (jumpOffset), no more.
        expect(visibleParagraphs().every((id) => !before(id, 'p-2-40'))).toBe(true);
        await settle(); // Continuous scrolls there; the chapter counts from where it stops.

        key(prevChapterKey);
        await waitOnScreen('p-2-1');
        expect(visibleParagraphs().every((id) => !before(id, 'p-1-40'))).toBe(true);
        expect(onScreen(document.getElementById('p-2-25'))).toBe(false);
      });

      for (const [chapter, index] of [
        [2, 25],
        [1, 40]
      ]) {
        const id = `p-${chapter}-${index}`;
        it(`opening and closing the side panel keeps ${id} on screen`, async () => {
          component = await openReader(view, writing, chapter, index);
          await settle();

          await togglePanel();
          await vi.waitFor(() => expect(panelOpen()).toBe(true));
          await settle();
          expect(onScreen(document.getElementById(id)), `open: ${visibleParagraphs()}`).toBe(true);

          await togglePanel();
          await vi.waitFor(() => expect(panelOpen()).toBe(false));
          await settle();
          expect(onScreen(document.getElementById(id)), `closed: ${visibleParagraphs()}`).toBe(
            true
          );
        });
      }

      it('a resize to phone width and back keeps the paragraph on screen', async () => {
        component = await openReader(view, writing);
        await settle();

        await browserPage.viewport(390, 700);
        await settle();
        expect(onScreen(document.getElementById('p-2-25')), `phone: ${visibleParagraphs()}`).toBe(
          true
        );

        await browserPage.viewport(1000, 700);
        await settle();
        expect(onScreen(document.getElementById('p-2-25')), `back: ${visibleParagraphs()}`).toBe(
          true
        );
      });

      it('a chapter in Contents opens at its start beside the panel', async () => {
        component = await openReader(view, writing);
        await togglePanel();

        const rows = await vi.waitFor(() => {
          const found = document.querySelectorAll<HTMLElement>('.contents-row');
          expect(found.length).toBe(3);
          return found;
        });
        rows[2].click();
        await waitOnScreen('p-3-1');
        expect(visibleParagraphs().every((id) => !before(id, 'p-2-40'))).toBe(true);
      });
    });
  }
}
