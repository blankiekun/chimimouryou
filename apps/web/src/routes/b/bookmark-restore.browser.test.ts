/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewMode } from '$lib/data/view-mode';
// @ts-expect-error tsconfig's moduleResolution "node" doesn't read package exports; Vitest does.
import { page as browserPage } from 'vitest/browser';
import {
  autoBookmark$,
  autoBookmarkTime$,
  database,
  generatedFurigana$,
  manualBookmark$
} from '$lib/data/store';
import {
  addBook,
  mountReader,
  onScreen,
  openReader,
  panelOpen,
  paragraphAt,
  paragraphCounts,
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

// The book's readings file, as it arrives from the server or the local analysis; none by default.
const readings$ = await vi.hoisted(async () => {
  const { BehaviorSubject } = await import('rxjs');
  return new BehaviorSubject<any>(undefined);
});
vi.mock('$lib/data/analysis/analysis-tools', async (importOriginal) => {
  const { map } = await import('rxjs');
  return {
    ...(await importOriginal<object>()),
    readingsFor$: (book: { title: string }) =>
      readings$.pipe(map((readings) => ({ title: book.title, readings })))
  };
});

let component: { $destroy(): void } | undefined;
const savedAutoBookmark = autoBookmark$.getValue();

const close = () => {
  component?.$destroy();
  component = undefined;
  document.body.innerHTML = '';
  scrollTo(0, 0);
};

afterEach(async () => {
  close();
  autoBookmarkTime$.next(3);
  manualBookmark$.next(false);
  autoBookmark$.next(savedAutoBookmark);
  generatedFurigana$.next(false);
  readings$.next(undefined);
  await browserPage.viewport(1000, 700);
});

const key = (code: string) => dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const savedCount = async (id: number) => (await database.getBookmark(id))!.exploredCharCount;

/** PageDown, then wait for the page to move: paginated turns at once, continuous scrolls smoothly. */
async function pageDown(view: ViewMode) {
  const before = visibleParagraphs().join();
  const ended = new Promise((resolve) => addEventListener('scrollend', resolve, { once: true }));
  key('PageDown');
  if (view === ViewMode.Continuous) await ended;
  else await vi.waitFor(() => expect(visibleParagraphs().join()).not.toBe(before));
}

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
          let last: number | undefined;

          for (let turn = 0; turn < 3; turn++) {
            last = await savedCount(id);
            await pageDown(view);
          }
          const read = visibleParagraphs();
          if (panel) {
            await togglePanel();
            await vi.waitFor(() => expect(panelOpen()).toBe(true));
            // The re-layout the panel starts may not scroll: nothing to wait for.
            await settle(300);
            await togglePanel();
            await vi.waitFor(() => expect(panelOpen()).toBe(false));
          }
          // The save after the last turn.
          await vi.waitFor(async () => expect(await savedCount(id)).not.toBe(last), {
            timeout: 5000
          });
          const shown = visibleParagraphs();
          const saved = (await database.getBookmark(id))!.exploredCharCount ?? 0;
          const marked = paragraphAt(saved, true);
          const what = `read ${read}, left at ${shown}, bookmark ${saved} in ${marked}`;
          // Continuous may settle a few lines off; the bookmark must be in what was read.
          expect(read, what).toContain(marked);
          close();

          await browserPage.viewport(width, 700);
          component = await mountReader(id, view, writing);
          await vi.waitFor(
            () =>
              expect(
                onScreen(document.getElementById(marked)),
                `${what}, reopened at ${visibleParagraphs()}`
              ).toBe(true),
            { timeout: 10_000 }
          );
        });
      }
    }
  }
});

/** The first character on screen, as `paragraph id:offset` (plain paragraphs, one text node). */
function firstOnScreen() {
  const range = document.createRange();
  for (const id of visibleParagraphs()) {
    const text = document.getElementById(id)!.firstChild as Text;
    for (let i = 0; i < text.length; i += 1) {
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      const r = range.getBoundingClientRect();
      if (r.width && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight) {
        return `${id}:${i}`;
      }
    }
  }
  return '';
}

describe('/b paginated: the auto bookmark follows pages inside a paragraph (phones)', () => {
  for (const writing of ['horizontal-tb', 'vertical-rl'] as const) {
    it(writing, async () => {
      // Phone-sized pages: each paragraph is one text node over a few pages.
      await browserPage.viewport(412, 915);
      autoBookmarkTime$.next(0.3);
      const id = await addBook(2, 25, 'long');
      component = await mountReader(id, ViewMode.Paginated, writing);
      await waitOnScreen('p-2-25');
      await settle();

      const saved: number[] = [];
      for (let turn = 0; turn < 4; turn++) {
        const last = saved.at(-1) ?? (await savedCount(id)) ?? 0;
        key('PageDown');
        await vi.waitFor(async () => expect((await savedCount(id)) ?? 0).not.toBe(last), {
          timeout: 5000
        });
        saved.push((await savedCount(id)) ?? 0);
      }
      const left = firstOnScreen();
      // Each page saves its own place, not the start of the paragraph it is in.
      expect(new Set(saved).size, `${saved}`).toBe(saved.length);
      close();

      component = await mountReader(id, ViewMode.Paginated, writing);
      await waitOnScreen(left.split(':')[0]);
      await settle(800);
      expect(firstOnScreen(), `saved ${saved}`).toBe(left);
    });
  }
});

const openBar = async (title: string) => {
  (document.querySelector('button.fixed.inset-x-0.top-0') as HTMLElement).click();
  await vi.waitFor(() => {
    const button = document.querySelector<HTMLElement>(`button[title="${title}"]`);
    expect(button).toBeTruthy();
    button!.click();
  });
};
const clickText = (selector: string, text: string) =>
  vi.waitFor(() => {
    const button = [...document.querySelectorAll<HTMLElement>(selector)].find(
      (el) => el.textContent?.trim() === text
    );
    expect(button, text).toBeTruthy();
    button!.click();
  });

/*
 * Manual bookmarks and the Aa sheet's layout buttons. Ways this can go wrong:
 * - the change writes the current place to the database: the bookmark is gone on the next open;
 * - the reader reopens on the bookmark instead of the page being read;
 * - the place stays in memory as "the bookmark": Return to bookmark goes to the wrong place, and
 *   the send on hide would upload it over the real one.
 */
describe('/b keeps a manual bookmark through a layout change', () => {
  for (const view of [ViewMode.Paginated, ViewMode.Continuous]) {
    for (const writing of ['horizontal-tb', 'vertical-rl'] as const) {
      for (const change of ['direction', 'view'] as const) {
        it(`${view}, ${writing}, ${change}`, async () => {
          manualBookmark$.next(true);
          autoBookmark$.next(false);
          const id = await addBook(2, 25, true);
          component = await mountReader(id, view, writing);
          await waitOnScreen('p-2-25');
          await settle();
          const bookmark = await savedCount(id);

          for (let turn = 0; turn < 3; turn++) await pageDown(view);
          const read = visibleParagraphs();

          await openBar('Quick settings');
          if (change === 'direction') {
            await clickText('.app-segment', writing === 'vertical-rl' ? 'Horizontal' : 'Vertical');
          } else {
            await clickText('.app-segment', view === ViewMode.Paginated ? 'Scroll' : 'Pages');
          }
          // A paragraph can span pages, or the page can start with the one after: any of them.
          await vi.waitFor(
            () => expect(visibleParagraphs().filter((p) => read.includes(p))).not.toHaveLength(0),
            { timeout: 10_000 }
          );
          await settle(500);
          expect(await savedCount(id)).toBe(bookmark);

          await openBar('More reader actions');
          await clickText('button', 'Return to bookmark');
          await waitOnScreen('p-2-25');
          expect(await savedCount(id)).toBe(bookmark);
        }, 40_000);
      }
    }
  }
});

/*
 * Manual bookmarks and the readings file arriving (or generated furigana switched) while reading.
 * Ways this can go wrong:
 * - the place the re-render reopens at stays in memory as "the bookmark": Return to bookmark goes
 *   there, and the send on hide would upload it over the real one;
 * - the re-render writes that place to the database;
 * - readings that change nothing (no remount): the place never gives way to the bookmark.
 */
describe('/b keeps a manual bookmark through a re-render', () => {
  /**
   * A furigana at the start of each chapter, so the text really changes and it shows wherever the
   * reader got to: paginated renders one chapter, and where three pages end depends on the fonts
   * (a CI runner has no Japanese ones). `off` shifts the count.
   */
  const readingsFile = async (id: number, off = 0) => {
    const starts = [1, 2, 3].map((chapter) => paragraphCounts(chapter, 1, true).start);

    return {
      characters: (await database.getData(id))!.characters! + off,
      glosses: [[[0, 1, '第', 'だい']]],
      occ: starts.flatMap((start, i) => [start - (starts[i - 1] ?? 0), 0, 0])
    };
  };

  for (const view of [ViewMode.Paginated, ViewMode.Continuous]) {
    for (const writing of ['horizontal-tb', 'vertical-rl'] as const) {
      it(`${view}, ${writing}`, async () => {
        manualBookmark$.next(true);
        autoBookmark$.next(false);
        generatedFurigana$.next(true);
        const id = await addBook(2, 25, true);
        component = await mountReader(id, view, writing);
        await waitOnScreen('p-2-25');
        await settle();
        const bookmark = await savedCount(id);

        for (let turn = 0; turn < 3; turn++) await pageDown(view);
        const read = visibleParagraphs();

        readings$.next(await readingsFile(id));
        // The re-render happened and kept the page being read.
        await vi.waitFor(
          () => {
            expect(
              document.querySelector('.ttu-gen-ruby'),
              `reading ${visibleParagraphs()}`
            ).toBeTruthy();
            expect(visibleParagraphs().filter((p) => read.includes(p))).not.toHaveLength(0);
          },
          { timeout: 10_000 }
        );
        await settle(500);
        expect(await savedCount(id)).toBe(bookmark);

        await openBar('More reader actions');
        await clickText('button', 'Return to bookmark');
        await waitOnScreen('p-2-25');
        expect(await savedCount(id)).toBe(bookmark);
      }, 40_000);
    }

    it(`${view}, readings that change nothing`, async () => {
      manualBookmark$.next(true);
      autoBookmark$.next(false);
      generatedFurigana$.next(true);
      const id = await addBook(2, 25, true);
      component = await mountReader(id, view, 'horizontal-tb');
      await waitOnScreen('p-2-25');
      await settle();

      for (let turn = 0; turn < 3; turn++) await pageDown(view);

      // Made from another processing of the book: addGeneratedRuby leaves the text alone.
      readings$.next(await readingsFile(id, 1));
      await settle(500);

      await openBar('More reader actions');
      await clickText('button', 'Return to bookmark');
      await waitOnScreen('p-2-25');
    }, 40_000);
  }
});
