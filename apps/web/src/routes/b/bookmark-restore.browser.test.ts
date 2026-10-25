/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Writable } from 'svelte/store';
import { page } from '$lib/data/page-store';
import { database, viewMode$, writingMode$ } from '$lib/data/store';
import { ViewMode } from '$lib/data/view-mode';
import { getCharacterCount } from '$lib/functions/get-character-count';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';

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

// Generated text, no book: 3 chapters of 40 numbered paragraphs.
const paragraph = (chapter: number, index: number) =>
  `<p id="p-${chapter}-${index}">第${chapter}章の${index}段落目。${'あいうえおかきくけこさしすせそ'.repeat(4)}</p>`;
const chapters = [1, 2, 3].map(
  (chapter) =>
    `<div id="ttu-ch${chapter}"><div class="ttu-book-html-wrapper"><div class="ttu-book-body-wrapper">${Array.from(
      { length: 40 },
      (_, index) => paragraph(chapter, index + 1)
    ).join('')}</div></div></div>`
);

function countOf(html: string) {
  const el = document.createElement('div');
  el.innerHTML = html;
  return getCharacterCount(el);
}

async function addBook() {
  const perChapter = countOf(chapters[0]);
  const book = await database.upsertData(
    {
      title: `fixture-${Math.random()}`,
      styleSheet: '',
      elementHtml: chapters.join(''),
      blobs: {},
      hasThumb: false,
      characters: perChapter * 3,
      sections: [1, 2, 3].map((chapter) => ({
        reference: `ttu-ch${chapter}`,
        charactersWeight: perChapter,
        label: `第${chapter}章`,
        startCharacter: perChapter * (chapter - 1),
        characters: perChapter
      })),
      lastBookModified: Date.now(),
      lastBookOpen: Date.now()
    } as any,
    ReplicationSaveBehavior.Overwrite
  );
  // Mid chapter 2, at the start of its 25th paragraph.
  const exploredCharCount =
    perChapter + countOf(Array.from({ length: 24 }, (_, i) => paragraph(2, i + 1)).join(''));

  await database.putBookmark({
    dataId: book.id,
    exploredCharCount,
    progress: exploredCharCount / (perChapter * 3),
    lastBookmarkModified: Date.now()
  });
  return book.id;
}

function onScreen(el: Element | null) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
}

let component: { $destroy(): void } | undefined;

afterEach(() => {
  component?.$destroy();
  component = undefined;
  document.body.innerHTML = '';
  scrollTo(0, 0);
});

describe('/b reopens a book at its bookmark', () => {
  for (const view of [ViewMode.Paginated, ViewMode.Continuous]) {
    for (const writing of ['horizontal-tb', 'vertical-rl'] as const) {
      it(`${view}, ${writing}`, async () => {
        viewMode$.next(view);
        writingMode$.next(writing);
        const id = await addBook();

        const url = new URL(location.href);
        url.searchParams.set('id', `${id}`);
        (page as Writable<any>).set({ url, route: { id: '/b' }, state: {} });

        const { default: Page } = await import('./+page.svelte');
        component = new (Page as any)({ target: document.body, props: {} });

        await vi.waitFor(() => expect(onScreen(document.getElementById('p-2-25'))).toBe(true), {
          timeout: 10_000
        });
        expect(onScreen(document.getElementById('p-2-1'))).toBe(false);
      });
    }
  }
});
