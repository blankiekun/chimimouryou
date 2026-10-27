/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import { mangaElementHtml } from '$lib/data/manga';
import { bookRoute, readerPath, readerRoute, replacePage } from '$lib/data/reader-route';
import { vnElementHtml } from '$lib/data/vn';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

describe('reader routes', () => {
  it('sends visual novels to /v, manga to /m and books to /b', () => {
    expect(readerRoute({ vn: true })).toBe('v');
    expect(readerRoute({ manga: true })).toBe('m');
    expect(readerRoute({})).toBe('b');
    expect(bookRoute({ elementHtml: vnElementHtml({ engine: 'vnbox' } as never) })).toBe('v');
    expect(bookRoute({ elementHtml: mangaElementHtml(['1.jpg']) })).toBe('m');
    expect(bookRoute({ elementHtml: '<p>本</p>' })).toBe('b');
    expect(readerPath(3, 'v')).toBe('/v?id=3');
    expect(readerPath(3)).toBe('/b?id=3');
  });
});

describe('replacePage', () => {
  const win = (href: string) => ({ location: { href, replace: vi.fn() } }) as unknown as Window;

  beforeEach(() => vi.mocked(goto).mockReset());

  it('leaves it to the client navigation when that moved the page', async () => {
    const page = win('http://x/b?id=3');

    vi.mocked(goto).mockImplementation(async () => {
      page.location.href = 'http://x/v?id=3';
    });
    await replacePage('/v?id=3', page);

    expect(goto).toHaveBeenCalledWith('/v?id=3', { replaceState: true });
    expect(page.location.replace).not.toHaveBeenCalled();
  });

  it('loads the page in full when the navigation failed or was dropped', async () => {
    const failed = win('http://x/b?id=3');
    const dropped = win('http://x/b?id=3');

    vi.mocked(goto).mockRejectedValueOnce(new Error('navigation aborted'));
    await replacePage('/v?id=3', failed);
    vi.mocked(goto).mockResolvedValueOnce(undefined);
    await replacePage('/v?id=3', dropped);

    expect(failed.location.replace).toHaveBeenCalledWith('/v?id=3');
    expect(dropped.location.replace).toHaveBeenCalledWith('/v?id=3');
  });
});
