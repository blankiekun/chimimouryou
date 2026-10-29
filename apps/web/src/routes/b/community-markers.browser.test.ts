/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error tsconfig's moduleResolution "node" doesn't read package exports; Vitest does.
import { page as browserPage } from 'vitest/browser';
import { communityMarks$ } from '$lib/data/community-book';
import { database } from '$lib/data/store';
import { ViewMode } from '$lib/data/view-mode';
import {
  addBook,
  mountReader,
  panelOpen,
  paragraphCounts,
  togglePanel,
  visibleParagraphs,
  waitOnScreen
} from './reader-fixture';

/*
 * Where community-markers.svelte puts a thread's bubble, with real layout in both view modes and
 * directions: just past the end of the paragraph holding the line, in the text's direction, inside
 * the book's visible box, and placed again when the side panel opens or closes (ResizeObserver).
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
  communityMarks$.next({ title: '', marks: [] });
  document.body.innerHTML = '';
  scrollTo(0, 0);
  await browserPage.viewport(1000, 700);
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
const key = (code: string) => dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));

/** A thread on a line inside paragraph `index` of chapter 2 (or `chapter`) */
function mark(index: number, posts: number, from = 2, to = 20, hash = `h${index}`, chapter = 2) {
  const { start } = paragraphCounts(chapter, index);
  return {
    hash,
    prefix: hash,
    posts,
    spoiler: false,
    index,
    text: '',
    start: start + from,
    end: start + to
  };
}

const bubble = (hash: string) =>
  document.querySelector<HTMLElement>(`.community-tag[data-hash="${hash}"]`);

/** The bubble's centre */
function centre(tag: HTMLElement) {
  const rect = tag.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** The last box of paragraph `id`'s text inside the book's box */
function lastLine(id: string) {
  const box = document.querySelector('.book-content')!.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(document.getElementById(id)!);
  return [...range.getClientRects()]
    .filter(
      (r) =>
        r.width &&
        r.height &&
        r.right > Math.max(0, box.left) &&
        r.left < Math.min(innerWidth, box.right) &&
        r.bottom > Math.max(0, box.top) &&
        r.top < Math.min(innerHeight, box.bottom)
    )
    .pop()!;
}

async function open(
  view: ViewMode,
  writing: 'horizontal-tb' | 'vertical-rl',
  lines = false,
  marks = [mark(26, 3), mark(27, 1)]
) {
  const id = await addBook(2, 25, false, lines);
  component = await mountReader(id, view, writing);
  await waitOnScreen('p-2-25');
  const { title } = (await database.getData(id))!;
  communityMarks$.next({ title, marks });
  await vi.waitFor(() => expect(bubble(marks[0].hash)).toBeTruthy(), { timeout: 5000 });
  await settle();
}

function expectAfterParagraph(hash: string, id: string, vertical: boolean) {
  const tag = bubble(hash)!;
  const { x, y } = centre(tag);
  const line = lastLine(id);
  const box = document.querySelector('.book-content')!.getBoundingClientRect();
  const where = `${hash} at ${x},${y}; ${id} ends ${JSON.stringify(line)}; ${visibleParagraphs()}`;

  if (vertical) {
    expect(x, where).toBeGreaterThanOrEqual(line.left);
    expect(x, where).toBeLessThanOrEqual(line.right);
    expect(y, where).toBeGreaterThan(line.bottom);
  } else {
    expect(y, where).toBeGreaterThanOrEqual(line.top);
    expect(y, where).toBeLessThanOrEqual(line.bottom);
    expect(x, where).toBeGreaterThan(line.right);
  }
  // Never under the side panel or off the window
  expect(x, where).toBeLessThanOrEqual(Math.min(innerWidth, box.right + 28));
  expect(y, where).toBeLessThanOrEqual(innerHeight);
}

for (const view of [ViewMode.Paginated, ViewMode.Continuous]) {
  for (const writing of ['horizontal-tb', 'vertical-rl'] as const) {
    const vertical = writing === 'vertical-rl';

    describe(`community bubbles, ${view}, ${writing}`, () => {
      it('sits just past the end of the paragraph holding the line', async () => {
        await open(view, writing);
        expectAfterParagraph('h26', 'p-2-26', vertical);
        expectAfterParagraph('h27', 'p-2-27', vertical);
        expect(bubble('h26')!.textContent).toBe('3');
        // Vertical text gets a drawn dotted rule (no highlight decoration there)
        expect(document.querySelectorAll('.community-rule').length > 0).toBe(vertical);
      });

      it('sits past the paragraph in a book that ends paragraphs with <br> (Aozora Bunko)', async () => {
        await open(view, writing, true);
        expectAfterParagraph('h26', 'p-2-26', vertical);
        expectAfterParagraph('h27', 'p-2-27', vertical);
      });

      it('lines up two lines ending one paragraph, apart and inside the window', async () => {
        await open(view, writing, false, [mark(26, 2, 2, 10, 'a'), mark(26, 1, 12, 20, 'b')]);
        await vi.waitFor(() => expect(bubble('b')).toBeTruthy());
        const a = centre(bubble('a')!);
        const b = centre(bubble('b')!);

        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(24);
        for (const { x, y } of [a, b]) {
          expect(x).toBeGreaterThan(0);
          expect(x).toBeLessThan(innerWidth);
          expect(y).toBeGreaterThan(0);
          expect(y).toBeLessThan(innerHeight);
        }
      });

      it('is placed again when the side panel opens and closes', async () => {
        await open(view, writing);
        await togglePanel();
        await vi.waitFor(() => expect(panelOpen()).toBe(true));
        await settle();
        const tag = bubble('h26');
        // Still on the paragraph, or gone with it under the panel
        if (tag && document.getElementById('p-2-26'))
          expectAfterParagraph('h26', 'p-2-26', vertical);
        await togglePanel();
        await vi.waitFor(() => expect(panelOpen()).toBe(false));
        await settle();
        await waitOnScreen('p-2-26');
        await vi.waitFor(() => expectAfterParagraph('h26', 'p-2-26', vertical), { timeout: 3000 });
      });
    });
  }
}

describe('community bubbles, paginated, across chapters', () => {
  for (const writing of ['horizontal-tb', 'vertical-rl'] as const) {
    // Paginated mode swaps the section's HTML: the marks of the chapter turned to are drawn, and
    // those of the one turned back to again.
    it(`come back after turning into the previous chapter and back, ${writing}`, async () => {
      const id = await addBook(2, 1);
      component = await mountReader(id, ViewMode.Paginated, writing);
      await waitOnScreen('p-2-1');
      const { title } = (await database.getData(id))!;
      communityMarks$.next({ title, marks: [mark(40, 1, 2, 20, 'a', 1), mark(1, 2, 2, 20, 'b')] });
      await vi.waitFor(() => expect(bubble('b')).toBeTruthy(), { timeout: 5000 });

      key('PageUp');
      await waitOnScreen('p-1-40');
      await vi.waitFor(() => expect(bubble('a')).toBeTruthy(), { timeout: 3000 });
      key('PageDown');
      await waitOnScreen('p-2-1');
      await vi.waitFor(() => expect(bubble('b')).toBeTruthy(), { timeout: 3000 });
      expect(bubble('a')).toBeNull();
    });
  }
});
