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

// Generated text, no book: 3 chapters of 40 numbered paragraphs. Even ones by default; `real`
// makes them uneven, with ruby and now and then an image between them, like a novel; 'long'
// makes each one text node over several phone pages.
type Kind = boolean | 'long';
const image =
  '<div class="fixture-image"><img alt="" width="300" height="200" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22200%22/%3E"></div>';
export const paragraph = (chapter: number, index: number, real: Kind = false) =>
  real === 'long'
    ? `<p id="p-${chapter}-${index}">第${chapter}章の${index}段落目。${'あいうえおかきくけこさしすせそ'.repeat(60)}</p>`
    : real
      ? `<p id="p-${chapter}-${index}">第${chapter}章の${index}段落目。${'<ruby>漢字<rt>かんじ</rt></ruby>あいうえおかきくけこさしすせそ'.repeat(1 + ((chapter * 7 + index * 5) % 9))}</p>${index % 9 === 0 ? image : ''}`
      : `<p id="p-${chapter}-${index}">第${chapter}章の${index}段落目。${'あいうえおかきくけこさしすせそ'.repeat(4)}</p>`;
/** `lines`: Aozora Bunko's layout, one block per chapter with a <br> after each paragraph. */
const asLine = (html: string) => html.replace(/^<p /, '<span ').replace(/<\/p>/, '</span><br>');
const chapters = (real: Kind, lines = false) =>
  [1, 2, 3].map(
    (chapter) =>
      `<div id="ttu-ch${chapter}"><div class="ttu-book-html-wrapper"><div class="ttu-book-body-wrapper">${lines ? '<div>' : ''}${Array.from(
        { length: 40 },
        (_, index) =>
          lines ? asLine(paragraph(chapter, index + 1, real)) : paragraph(chapter, index + 1, real)
      ).join('')}${lines ? '</div>' : ''}</div></div></div>`
  );

function countOf(html: string) {
  const el = document.createElement('div');
  el.innerHTML = html;
  el.querySelectorAll('rt').forEach((rt) => rt.remove()); // The reader doesn't count furigana.
  return getCharacterCount(el);
}

/** Id of the paragraph the character count `count` falls in. */
export function paragraphAt(count: number, real: Kind = false) {
  let start = 0;
  for (let chapter = 1; chapter <= 3; chapter++) {
    for (let index = 1; index <= 40; index++) {
      start += countOf(paragraph(chapter, index, real));
      if (count < start) return `p-${chapter}-${index}`;
    }
  }
  return 'p-3-40';
}

/** Character counts at the start and end of paragraph `index` of `chapter` (the reader's positions). */
export function paragraphCounts(chapter: number, index: number, real: Kind = false) {
  let start = 0;
  for (let c = 1; c <= 3; c++) {
    for (let i = 1; i <= 40; i++) {
      const count = countOf(paragraph(c, i, real));
      if (c === chapter && i === index) return { start, end: start + count };
      start += count;
    }
  }
  throw new Error(`no paragraph ${chapter}-${index}`);
}

/** Adds the book with a bookmark at the start of paragraph `index` of `chapter`; returns its id. */
export async function addBook(chapter = 2, index = 25, real: Kind = false, lines = false) {
  const html = chapters(real, lines);
  const counts = html.map(countOf);
  const startOf = (n: number) => counts.slice(0, n - 1).reduce((sum, c) => sum + c, 0);
  const total = startOf(4);
  const book = await database.upsertData(
    {
      title: `fixture-${Math.random()}`,
      styleSheet: '',
      elementHtml: html.join(''),
      blobs: {},
      hasThumb: false,
      characters: total,
      sections: [1, 2, 3].map((n) => ({
        reference: `ttu-ch${n}`,
        charactersWeight: counts[n - 1],
        label: `第${n}章`,
        startCharacter: startOf(n),
        characters: counts[n - 1]
      })),
      lastBookModified: Date.now(),
      lastBookOpen: Date.now()
    } as any,
    ReplicationSaveBehavior.Overwrite
  );
  const exploredCharCount =
    startOf(chapter) +
    countOf(Array.from({ length: index - 1 }, (_, i) => paragraph(chapter, i + 1, real)).join(''));

  await database.putBookmark({
    dataId: book.id,
    exploredCharCount,
    progress: exploredCharCount / total,
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
  await vi.waitFor(
    () => expect(onScreen(document.getElementById(id)), `${id}: ${visibleParagraphs()}`).toBe(true),
    {
      timeout: 10_000
    }
  );
}

/** Mounts /b on book `id` in the given view and direction. */
export async function mountReader(
  id: number,
  view: ViewMode,
  writing: 'horizontal-tb' | 'vertical-rl'
) {
  viewMode$.next(view);
  writingMode$.next(writing);
  const url = new URL(location.href);
  url.searchParams.set('id', `${id}`);
  (page as Writable<any>).set({ url, route: { id: '/b' }, state: {} });

  const { default: Page } = await import('./+page.svelte');
  return new (Page as any)({ target: document.body, props: {} }) as { $destroy(): void };
}

/** Mounts /b on a new book, in the given view and direction, and waits for its bookmark. */
export async function openReader(
  view: ViewMode,
  writing: 'horizontal-tb' | 'vertical-rl',
  chapter = 2,
  index = 25
) {
  const component = await mountReader(await addBook(chapter, index), view, writing);
  await waitOnScreen(`p-${chapter}-${index}`);
  return component;
}

/** The bar's panel button; the bar shows after a tap on the strip at the top. */
export async function togglePanel() {
  (document.querySelector('button.fixed.inset-x-0.top-0') as HTMLElement).click();
  await vi.waitFor(() => {
    const toggle = document.querySelector<HTMLElement>('button[title="Side panel"]');
    expect(toggle).toBeTruthy();
    toggle!.click();
  });
}

export const panelOpen = () => !!document.querySelector('aside.reader-index:not(.hidden)');
