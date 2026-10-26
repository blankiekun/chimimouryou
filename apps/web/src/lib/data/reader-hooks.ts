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
