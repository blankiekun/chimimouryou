/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewMode } from '$lib/data/view-mode';
import { onScreen, openReader } from './reader-fixture';

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
        component = await openReader(view, writing);
        expect(onScreen(document.getElementById('p-2-1'))).toBe(false);
      });
    }
  }
});
