/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hiddenBooks$ } from './social';
import { socialSession$ } from './social-account';
import {
  libraryCovers$,
  pauseLibraryCovers,
  uploadLibraryCovers,
  type LibraryCoverState
} from './library-covers';

const catalog = vi.hoisted(() => ({ books: [] as object[] }));

vi.mock('$lib/data/calibre', async (original) => ({
  ...(await original<typeof import('$lib/data/calibre')>()),
  loadCalibreCatalog: async () => catalog.books
}));
vi.mock('$lib/data/social', async (original) => ({
  ...(await original<typeof import('$lib/data/social')>()),
  bookKey: (title: string) => title,
  bookThumbnail: async (cover: string) =>
    cover.includes('broken') ? null : new Blob(['webp'], { type: 'image/webp' })
}));

const book = (title: string, extra: object = {}) => ({
  id: 1,
  title,
  format: 'EPUB',
  file: `${title}/${title}.epub`,
  cover: `${title}/cover.jpg`,
  ...extra
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('library covers', () => {
  const fetchMock = vi.fn();
  const puts = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'PUT')
      .map(([url]) => new URL(String(url)).searchParams.get('key'));
  const last = () => libraryCovers$.getValue();
  let onHub: string[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    vi.stubGlobal('fetch', fetchMock);
    socialSession$.next({ token: 't', me: { id: 'a', role: 'dev', share: {} } as never });
    onHub = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const { pathname, searchParams } = new URL(url);

      if (pathname.endsWith('/library-covers')) {
        // Two pages: the first key alone, then the rest.
        return searchParams.get('after')
          ? json({ keys: onHub.slice(1), next: null })
          : json({ keys: onHub.slice(0, 1), next: onHub.length > 1 ? onHub[0] : null });
      }
      if (init?.method === 'PUT') {
        const key = searchParams.get('key')!;

        if (key === 'mine') return json({ error: 'exists' }, 409);
        onHub.push(key);
        return json({ cover: '0123456789abcdef' });
      }
      return json({ error: 'route' }, 404);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    hiddenBooks$.next([]);
    socialSession$.next(null);
  });

  const run = async () => {
    const done = uploadLibraryCovers();

    await vi.runAllTimersAsync();
    await done;
  };

  it('uploads books and manga with a cover, skipping what the hub has, hidden books and VNs', async () => {
    catalog.books = [
      book('a'),
      book('b'),
      book('c'),
      book('c'), // the same key twice
      book('m', { file: 'm/m.cbz' }),
      book('hidden'),
      book('mine'),
      book('broken'),
      book('nocover', { cover: '' }),
      book('game', { format: 'VN' }),
      book('onscripter', { vn: true })
    ];
    onHub = ['a', 'b'];
    hiddenBooks$.next(['hidden']);

    await run();
    expect(puts()).toEqual(['c', 'm', 'mine']);
    expect(last()).toEqual<LibraryCoverState>({
      done: 4,
      skipped: 2,
      failed: 1,
      left: 0,
      running: false,
      stopped: ''
    });

    // A second run (or after a reload) finds them all on the hub.
    fetchMock.mockClear();
    await run();
    expect(puts()).toEqual(['mine']);
    expect(last().done).toBe(4);
  });

  it('pauses after the cover in hand and resumes from what the hub has', async () => {
    catalog.books = [book('a'), book('b'), book('c')];

    const running = uploadLibraryCovers();

    await vi.waitFor(() => expect(puts()).toEqual(['a']));
    pauseLibraryCovers();
    await vi.runAllTimersAsync();
    await running;
    expect(puts()).toEqual(['a']);
    expect(last()).toMatchObject({ done: 1, left: 2, running: false });

    await run();
    expect(puts()).toEqual(['a', 'b', 'c']);
    expect(last()).toMatchObject({ done: 3, left: 0 });
  });

  it('stops at the daily cap and waits out the edge limit', async () => {
    catalog.books = [book('a'), book('b'), book('c')];
    let busy = true;
    const ok = fetchMock.getMockImplementation()!;

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const key = new URL(url).searchParams.get('key');

      if (init?.method === 'PUT' && key === 'a' && busy) {
        busy = false;
        return json({ error: 'busy' }, 429);
      }
      if (init?.method === 'PUT' && key === 'b') return json({ error: 'limit' }, 429);
      return ok(url, init);
    });
    await run();
    expect(puts()).toEqual(['a', 'a', 'b']);
    expect(last()).toMatchObject({ done: 1, left: 2, stopped: 'limit' });
  });

  it('stops at once when the hub refuses the role', async () => {
    catalog.books = [book('a'), book('b')];
    fetchMock.mockImplementation(async () => json({ error: 'role' }, 403));
    await run();
    expect(puts()).toEqual([]);
    expect(last()).toMatchObject({ running: false, stopped: 'role' });
  });
});
