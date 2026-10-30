/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { goto } from '$app/navigation';
import { pagePath } from '$lib/data/env';
import { isManga } from '$lib/data/manga/manga';
import { isVn } from '$lib/data/vn/vn';

/** The page that opens an item: v for visual novels, m for manga, b (the reader) for books. */
export type ReaderRoute = 'b' | 'm' | 'v';

export function readerRoute(kind: { manga?: boolean; vn?: boolean }): ReaderRoute {
  if (kind.vn) return 'v';

  return kind.manga ? 'm' : 'b';
}

/** The route of a book record stored in this browser. */
export function bookRoute(book: { elementHtml: string }): ReaderRoute {
  return readerRoute({ manga: isManga(book), vn: isVn(book) });
}

/** Without a route (last items saved before it was kept): the reader, which sends VNs and manga on. */
export function readerPath(id: number, route: ReaderRoute = 'b') {
  return `${pagePath}/${route}?id=${id}`;
}

/**
 * Servers that can send headers serve /v cross-origin isolated (COOP/COEP, for VNBox's
 * AudioWorklet) and the rest of the site not; headers only come with a full page load. So going
 * into /v loads it in full, and so does leaving an isolated /v (popups such as sign-ins need
 * the site un-isolated). Where /v isn't isolated (GitHub Pages), leaving it stays client-side.
 */
export function needsFullLoad(from: URL, to: URL, isolated: boolean) {
  const player = (url: URL) =>
    url.pathname === `${pagePath}/v` || url.pathname === `${pagePath}/v.html`;

  if (from.origin !== to.origin || player(from) === player(to)) return false;

  return player(to) || isolated;
}

/**
 * Replaces this page with `path`. When the client-side navigation fails or is dropped
 * (aborted by another navigation to this same page, a chunk of an old build gone) and the
 * browser is still here, it loads `path` in full, so the caller never waits on a lost goto.
 */
export async function replacePage(path: string, win: Window = window) {
  const from = win.location.href;

  await goto(path, { replaceState: true }).catch(() => {});

  if (win.location.href === from) win.location.replace(path);
}
