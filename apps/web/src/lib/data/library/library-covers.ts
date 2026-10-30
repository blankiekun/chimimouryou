/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BehaviorSubject } from 'rxjs';
import { calibreCoverUrl, loadCalibreCatalog } from '$lib/data/remote/calibre';
import { standalone } from '$lib/data/env';
import { isMangaFileName } from '$lib/data/manga/manga';
import { bookKey, bookThumbnail, isHidden } from '$lib/data/social/social';
import { HubError, hubFetch } from '$lib/data/social/social-account';

/**
 * Upload library covers (/moderation, role 'dev', server builds): a thumbnail of every Calibre
 * book and manga with a cover to the hub's `PUT /v1/admin/library-cover`, so anyone's Discord
 * status shows it with no upload of their own. Resumes from the keys the hub already has, so a
 * reload or Pause loses nothing. Not part of upstream.
 */

export interface LibraryCoverCounts {
  /** On the hub (before this run too) */
  done: number;
  /** Hidden from friends in this browser, or this dev already has a cover of the key */
  skipped: number;
  failed: number;
  left: number;
}

export interface LibraryCoverState extends LibraryCoverCounts {
  running: boolean;
  /** Set when a run stopped early: 'limit' (today's cap) or a hub error code */
  stopped: string;
}

const idle: LibraryCoverState = {
  done: 0,
  skipped: 0,
  failed: 0,
  left: 0,
  running: false,
  stopped: ''
};

export const libraryCovers$ = new BehaviorSubject<LibraryCoverState>(idle);

/** About 4 a second, under the hub's LIBRARY_LIMIT (50 per 10 s per address) */
export const UPLOAD_GAP_MS = 250;
/** Wait after the hub's edge limit answers 'busy' */
export const BUSY_WAIT_MS = 10_000;

/** Server builds only: the standalone has no Calibre catalog and must not ask for one */
export const libraryCoversAvailable = !standalone;

let pausing = false;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every book key with a library cover on the hub */
async function hubKeys() {
  const keys = new Set<string>();
  let after: string | null = '';

  while (after !== null) {
    const page: { keys: string[]; next: string | null } = await hubFetch(
      `/v1/admin/library-covers?${new URLSearchParams({ after })}`
    );

    page.keys.forEach((key) => keys.add(key));
    after = page.next;
  }
  return keys;
}

/** Calibre books and manga with a cover, one per book key; never VNs */
async function libraryBooks() {
  const books = new Map<string, { kind: 'book' | 'manga'; cover: string }>();

  for (const book of await loadCalibreCatalog()) {
    const cover = calibreCoverUrl(book);
    const key = bookKey(book.title);

    if (!cover || !key || book.format === 'VN' || book.vn || books.has(key)) continue;
    books.set(key, { kind: isMangaFileName(book.file) ? 'manga' : 'book', cover });
  }
  return books;
}

/** Stops the running upload after the cover in hand */
export function pauseLibraryCovers() {
  if (libraryCovers$.getValue().running) pausing = true;
}

/** Counts what the hub has and uploads the rest, until done, paused or stopped by the hub */
export async function uploadLibraryCovers() {
  if (!libraryCoversAvailable || libraryCovers$.getValue().running) return;

  pausing = false;
  const state: LibraryCoverState = { ...idle, running: true };
  const show = () => libraryCovers$.next({ ...state });

  show();
  try {
    const [books, onHub] = await Promise.all([libraryBooks(), hubKeys()]);
    const todo: [string, string][] = [];

    for (const [key, book] of books) {
      if (onHub.has(key)) state.done++;
      else if (isHidden({ key, kind: book.kind })) state.skipped++;
      else todo.push([key, book.cover]);
    }
    state.left = todo.length;
    show();

    for (const [key, cover] of todo) {
      if (pausing) break;
      const outcome = await uploadOne(key, cover);

      if (outcome === 'done' || outcome === 'skipped' || outcome === 'failed') {
        state[outcome]++;
        state.left--;
        show();
      } else {
        state.stopped = outcome;
        break;
      }
      await wait(UPLOAD_GAP_MS);
    }
  } catch (error) {
    state.stopped = error instanceof HubError ? error.code : 'other';
  }
  state.running = false;
  pausing = false;
  show();
}

/** 'done', 'skipped' (409), 'failed' (no thumbnail, a refused image), else a code that stops the run */
async function uploadOne(key: string, cover: string): Promise<string> {
  let thumbnail: Blob | null | undefined;

  try {
    thumbnail = await bookThumbnail(cover);
  } catch (_) {
    return 'failed';
  }
  if (!thumbnail) return 'failed';

  for (;;) {
    try {
      await hubFetch(`/v1/admin/library-cover?key=${encodeURIComponent(key)}`, 'PUT', thumbnail);
      return 'done';
    } catch (error) {
      const { status, code } = error instanceof HubError ? error : new HubError(0, 'other');

      if (status === 409) return 'skipped';
      if (status === 429 && code === 'busy' && !pausing) {
        await wait(BUSY_WAIT_MS);
        continue;
      }
      // Today's cap, a lost session or role, the hub paused or down: stop and keep the rest.
      if (status === 0 || status === 401 || status === 403 || status === 429 || status >= 500) {
        return code;
      }
      return 'failed';
    }
  }
}
