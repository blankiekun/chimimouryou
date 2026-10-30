/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The reader's (/b) calls into background work that follows the open book: kanji seen (Home tab)
 * and the plugins' hooks (Community markers, reading activity, the automatic lorebook update).
 * Moved out of routes/b/+page.svelte unchanged.
 */

import type { ReadingActivity } from '$lib/data/discord';
import { recordKanjiSeen } from '$lib/data/kanji-seen';
import type { SearchIndex } from '$lib/functions/book-text/book-search';
import { activePlugins } from '$lib/plugins';

type GetIndex = () => Promise<SearchIndex>;

/** The reading position stayed put for a while. */
export function positionSettled(
  title: string,
  getIndex: GetIndex,
  position: number,
  characters: number
) {
  getIndex()
    .then((index) => recordKanjiSeen(title, index, position))
    .catch(() => {});
  activePlugins().forEach((plugin) =>
    plugin.onPositionSettled?.(title, getIndex, position, characters)
  );
}

/** The book rendered: the plugins' work runs once the browser idles. */
export function bookOpened(title: string, getIndex: GetIndex, before?: () => void) {
  const run = () => {
    before?.();
    activePlugins().forEach((plugin) => plugin.onBookOpened?.(title, getIndex));
  };

  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1000);
}

/** What is open now (a reader's position or the library), undefined when leaving it: Discord status. */
export function readingActivity(activity?: ReadingActivity) {
  activePlugins().forEach((plugin) => plugin.onReadingActivity?.(activity));
}

/** The reader is leaving the book. */
export function bookLeft(title: string, position: number, characters: number) {
  activePlugins().forEach((plugin) => plugin.onBookLeft?.(title, position, characters));
}

/**
 * The hooks' state for one reader page: the settle timer and the opened book's run, which a
 * Community line link's jump waits for (earlier, the reader isn't ready or its restore of the
 * bookmark moves the book back).
 */
export class ReaderHooksSession {
  private readingWorkTimer: ReturnType<typeof setTimeout> | undefined;

  private openedTitle = '';

  private openedDone = '';

  private pendingReveal: number | undefined;

  constructor(
    private getIndex: GetIndex,
    /** The book's length when the timer fires */
    private characters: () => number,
    private jumpToCount: (count: number) => void
  ) {}

  /** The position moved: positionSettled runs after 15 s without another move. */
  moved(title: string, position: number) {
    clearTimeout(this.readingWorkTimer);
    this.readingWorkTimer = setTimeout(
      (bookTitle: string, at: number) =>
        positionSettled(bookTitle, this.getIndex, at, this.characters()),
      15_000,
      title,
      position
    );
  }

  /** The book rendered: bookOpened once per title. */
  opened(title: string) {
    if (this.openedTitle === title) return;

    this.openedTitle = title;
    bookOpened(title, this.getIndex, () => {
      this.openedDone = title;
      if (this.pendingReveal !== undefined) this.jumpToCount(this.pendingReveal);
      this.pendingReveal = undefined;
    });
  }

  /** A Community line link's place: now if the opened book's run is done, else after it. */
  reveal(count: number, title: string | undefined) {
    if (this.openedDone && this.openedDone === title) this.jumpToCount(count);
    else this.pendingReveal = count;
  }

  /** Leaving the reader. */
  left(title: string | undefined, position: number, characters: number) {
    clearTimeout(this.readingWorkTimer);
    readingActivity();

    if (title && position) {
      bookLeft(title, position, characters);
    }
  }
}
