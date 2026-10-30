/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { firstValueFrom, toArray } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  addGeneratedRuby,
  deleteCachedReadings,
  generatedReadings$,
  placeAfterRerender,
  prefetchReadings,
  type ReadingsFile
} from './generated-furigana';
import { generatedFurigana$ } from '../store';
import { readerDb } from '../reader-db';

vi.mock('$lib/data/remote/calibre', () => ({
  difficultyApiUrl: '/api/',
  loadCalibreCatalog: () =>
    Promise.resolve([
      { id: 7, title: 'Book' },
      { id: 8, title: 'Other' }
    ])
}));

const html = '<div><p>三本の木を<ruby>見<rt>み</rt></ruby>た。行った。</p></div>';

describe('addGeneratedRuby', () => {
  it('wraps glossed kanji runs, a counter span over its tokens', () => {
    // Counts: 三0 本1 の2 木3 を4 見5 た6 行7 っ8 た9 (。 isn't counted): 10.
    const readings: ReadingsFile = {
      characters: 10,
      glosses: [
        [[0, 2, '三本', 'さんぼん']],
        [[0, 1, '三', 'さん']],
        [[0, 1, '木', 'き']],
        [[0, 1, '行', 'い']]
      ],
      occ: [0, 0, 0, 0, 1, 1, 1, 2, -1, 2, 3, 2, 4, 4, 3]
    };

    expect(addGeneratedRuby(html, readings)).toBe(
      '<div><p><ruby class="ttu-gen-ruby">三本<rt>さんぼん</rt></ruby>の' +
        '<ruby class="ttu-gen-ruby">木<rt>き</rt></ruby>を<ruby>見<rt>み</rt></ruby>た。' +
        '<ruby class="ttu-gen-ruby">行<rt>い</rt></ruby>った。</p></div>'
    );
  });

  it('leaves the book alone when the counts differ', () => {
    expect(addGeneratedRuby(html, { characters: 11, glosses: [], occ: [] })).toBe(html);
  });

  it('skips a gloss whose base text differs', () => {
    const readings: ReadingsFile = {
      characters: 10,
      glosses: [[[0, 1, '林', 'はやし']]],
      occ: [3, 0, 0]
    };

    expect(addGeneratedRuby(html, readings)).toBe(html);
  });
});

describe('generatedReadings$', () => {
  const file = (characters: number): ReadingsFile => ({ characters, glosses: [], occ: [] });
  const serve = (get: () => Response) =>
    vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST' ? new Response(JSON.stringify({ status: 'ready' })) : get()
      )
    );

  it('keeps the file in the browser and asks for it again only when it changed', async () => {
    const fetchMock = serve(
      () => new Response(JSON.stringify(file(1)), { headers: { ETag: '"a"' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await firstValueFrom(generatedReadings$('Book').pipe(toArray()))).toEqual([file(1)]);
    await vi.waitFor(async () =>
      expect(await (await readerDb()).get('readings', 'Book')).toEqual({
        title: 'Book',
        etag: '"a"',
        file: file(1)
      })
    );

    const unchanged = serve(() => new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', unchanged);

    expect(await firstValueFrom(generatedReadings$('Book').pipe(toArray()))).toEqual([file(1)]);
    expect(unchanged.mock.calls[1][1]?.headers).toEqual({ 'If-None-Match': '"a"' });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline')))
    );
    expect(await firstValueFrom(generatedReadings$('Book').pipe(toArray()))).toEqual([file(1)]);

    // Rewritten on the server with the same readings (a newer bookdata name): nothing to re-render.
    vi.stubGlobal(
      'fetch',
      serve(
        () =>
          new Response(JSON.stringify({ ...file(1), bookdata: 'bookdata_2.zip' }), {
            headers: { ETag: '"a2"' }
          })
      )
    );
    expect(await firstValueFrom(generatedReadings$('Book').pipe(toArray()))).toEqual([file(1)]);

    vi.stubGlobal(
      'fetch',
      serve(() => new Response(JSON.stringify(file(2)), { headers: { ETag: '"b"' } }))
    );
    expect(await firstValueFrom(generatedReadings$('Book').pipe(toArray()))).toEqual([
      { ...file(1), bookdata: 'bookdata_2.zip' },
      file(2)
    ]);
    // The new file is kept before it is deleted, so the delete isn't overtaken by that write.
    await vi.waitFor(async () =>
      expect((await (await readerDb()).get('readings', 'Book'))?.etag).toBe('"b"')
    );
    await deleteCachedReadings('Book');
    expect(await (await readerDb()).get('readings', 'Book')).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe('prefetchReadings', () => {
  it('keeps the books not kept yet, only while generated furigana are on', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? new Response(JSON.stringify({ status: 'ready' }))
          : new Response(JSON.stringify({ characters: 3, glosses: [], occ: [] }), {
              headers: { ETag: '"o"' }
            })
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const db = await readerDb();

    await db.put('readings', {
      title: 'Book',
      etag: '"a"',
      file: { characters: 1, glosses: [], occ: [] }
    });
    generatedFurigana$.next(false);
    await prefetchReadings(['Book', 'Other'], 0);
    expect(fetchMock).not.toHaveBeenCalled();

    generatedFurigana$.next(true);
    await prefetchReadings(['Book', 'Other'], 0);
    await vi.waitFor(async () => expect((await db.get('readings', 'Other'))?.etag).toBe('"o"'));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/readings/8',
      '/api/readings/8'
    ]);
    generatedFurigana$.next(false);
    vi.unstubAllGlobals();
  });
});

describe('placeAfterRerender', () => {
  const saved = { exploredCharCount: 120 };
  const current = { exploredCharCount: 100 };

  it('keeps the bookmark while it is on screen, so a mid-page bookmark stays mid-page', () => {
    expect(placeAfterRerender(saved, current, true)).toBe(saved);
  });

  it('keeps the bookmark when the reader has not reached it yet', () => {
    expect(placeAfterRerender(saved, { exploredCharCount: 0 }, false)).toBe(saved);
  });

  it('follows the reader once it turned away from the bookmark', () => {
    expect(placeAfterRerender(saved, current, false)).toBe(current);
    expect(placeAfterRerender(undefined, current, false)).toBe(current);
  });
});
