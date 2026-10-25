/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { expect, vi } from 'vitest';
import type { Writable } from 'svelte/store';
import { page } from '$lib/data/page-store';
import { database, viewMode$, writingMode$ } from '$lib/data/store';
import type { ViewMode } from '$lib/data/view-mode';
import { getCharacterCount } from '$lib/functions/get-character-count';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';

/*
 * Shared by the /b browser tests (*.browser.test.ts): a generated book in this browser's IndexedDB
 * and the whole /b page mounted on it. Each test file mocks `$app/navigation` and
 * `$lib/data/page-store` itself (vi.mock is hoisted per file).
 */

// Generated text, no book: 3 chapters of 40 numbered paragraphs.
export const paragraph = (chapter: number, index: number) =>
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

/** Adds the book with a bookmark at the start of paragraph `index` of `chapter`; returns its id. */
export async function addBook(chapter = 2, index = 25) {
  const perChapter = countOf(chapters[0]);
  const book = await database.upsertData(
    {
      title: `fixture-${Math.random()}`,
      styleSheet: '',
      elementHtml: chapters.join(''),
      blobs: {},
      hasThumb: false,
      characters: perChapter * 3,
      sections: [1, 2, 3].map((n) => ({
        reference: `ttu-ch${n}`,
        charactersWeight: perChapter,
        label: `第${n}章`,
        startCharacter: perChapter * (n - 1),
        characters: perChapter
      })),
      lastBookModified: Date.now(),
      lastBookOpen: Date.now()
    } as any,
    ReplicationSaveBehavior.Overwrite
  );
  const exploredCharCount =
    perChapter * (chapter - 1) +
    countOf(Array.from({ length: index - 1 }, (_, i) => paragraph(chapter, i + 1)).join(''));

  await database.putBookmark({
    dataId: book.id,
    exploredCharCount,
    progress: exploredCharCount / (perChapter * 3),
    lastBookmarkModified: Date.now()
  });
  return book.id;
}

/** The part of the window the book shows in: left of the side panel when it's open beside it. */
function visibleRight() {
  const panel = document.querySelector('aside.reader-index:not(.hidden)');
  const left = panel?.getBoundingClientRect().left ?? innerWidth;
  return left > innerWidth / 2 ? left : innerWidth;
}

export function onScreen(el: Element | null) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.right > 0 &&
    rect.left < visibleRight() &&
    rect.bottom > 0 &&
    rect.top < innerHeight
  );
}

/** Ids of the book's paragraphs on screen, in reading order. */
export function visibleParagraphs() {
  return [...document.querySelectorAll('p[id^="p-"]')].filter(onScreen).map((p) => p.id);
}

/** Chapter and paragraph number of an id from `paragraph()` */
export const position = (id: string) => id.split('-').slice(1).map(Number) as [number, number];

export async function waitOnScreen(id: string) {
  await vi.waitFor(() => expect(onScreen(document.getElementById(id)), id).toBe(true), {
    timeout: 10_000
  });
}

/** Mounts /b on a new book, in the given view and direction, and waits for its bookmark. */
export async function openReader(
  view: ViewMode,
  writing: 'horizontal-tb' | 'vertical-rl',
  chapter = 2,
  index = 25
) {
  viewMode$.next(view);
  writingMode$.next(writing);
  const id = await addBook(chapter, index);

  const url = new URL(location.href);
  url.searchParams.set('id', `${id}`);
  (page as Writable<any>).set({ url, route: { id: '/b' }, state: {} });

  const { default: Page } = await import('./+page.svelte');
  const component: { $destroy(): void } = new (Page as any)({
    target: document.body,
    props: {}
  });
  await waitOnScreen(`p-${chapter}-${index}`);
  return component;
}
