/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookCardProps } from '$lib/components/book-card/book-card-props';
import {
  applySeriesOverride,
  findSeriesBooks,
  guessSeriesName,
  inferSeries,
  mergeSeriesOverrides,
  parseSeriesOverrides,
  saveSeriesOverrides,
  seriesForTitle,
  withBrowserSeries
} from './series-overrides';

function card(title: string, series?: string): BookCardProps {
  return {
    id: 0,
    title,
    imagePath: '',
    characters: 0,
    lastBookModified: 0,
    lastBookOpen: 0,
    progress: 0,
    lastBookmarkModified: 0,
    isPlaceholder: false,
    series,
    seriesIndex: 1
  };
}

describe('guessSeriesName', () => {
  it.each([
    ['ソードアート・オンライン1 アインクラッド', 'ソードアート・オンライン'],
    ['とある魔術の禁書目録(3)', 'とある魔術の禁書目録'],
    ['ダンタリアンの書架１', 'ダンタリアンの書架'],
    ['狼と香辛料 第十二巻【電子特別版】', '狼と香辛料'],
    ['[著者] 本好きの下剋上 vol.2', '本好きの下剋上'],
    ['君の名は。', '君の名は。']
  ])('%s → %s', (title, name) => {
    expect(guessSeriesName(title)).toBe(name);
  });
});

describe('findSeriesBooks', () => {
  it('matches the name ignoring width, case and spaces', () => {
    const books = [card('ＳＡＯ　１'), card('sao 2'), card('別の本')];

    expect(findSeriesBooks(books, 'SAO').map((b) => b.title)).toEqual(['ＳＡＯ　１', 'sao 2']);
    expect(findSeriesBooks(books, ' ')).toEqual([]);
  });
});

describe('seriesForTitle', () => {
  it('picks the longest series named in the title', () => {
    const books = [card('a', '魔法'), card('b', '魔法科高校の劣等生'), card('c')];

    expect(seriesForTitle(books, '魔法科高校の劣等生 ５')).toBe('魔法科高校の劣等生');
    expect(seriesForTitle(books, '関係ない本')).toBe('');
  });
});

describe('parseSeriesOverrides and applySeriesOverride', () => {
  it('drops malformed entries', () => {
    expect(
      parseSeriesOverrides({
        ok: { series: ' S ', modified: 1 },
        bad: { series: 3, modified: 1 },
        long: { series: 'x'.repeat(201), modified: 1 }
      })
    ).toEqual({ ok: { series: 'S', modified: 1 } });
    expect(parseSeriesOverrides([1])).toEqual({});
  });

  it('sets or clears the series of a title', () => {
    const overrides = { a: { series: 'S', modified: 1 }, b: { series: '', modified: 1 } };

    expect(applySeriesOverride(card('a', 'Old'), overrides)).toMatchObject({
      series: 'S',
      seriesIndex: null
    });
    expect(applySeriesOverride(card('b', 'Old'), overrides).series).toBeUndefined();
    expect(applySeriesOverride(card('c', 'Old'), overrides).series).toBe('Old');
  });
});

describe('saveSeriesOverrides', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('merges changes into the latest server copy', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Response(null, { status: 201 })
        : new Response(JSON.stringify({ other: { series: 'X', modified: 1 } }))
    );

    vi.stubGlobal('fetch', fetchMock);

    const result = await saveSeriesOverrides({ mine: 'Y' });
    const put = fetchMock.mock.calls[1];

    expect(put[0]).toBe('/calibre/sync/series.json');
    expect(Object.keys(JSON.parse(put[1]!.body as string))).toEqual(['other', 'mine']);
    expect(result.mine.series).toBe('Y');
  });
});

describe('inferSeries', () => {
  it('groups two or more volumes by the name before their number', () => {
    const result = inferSeries([
      card('ダンタリアンの書架１'),
      card('ダンタリアンの書架２'),
      card('狼と香辛料 第十二巻'),
      card('b522apdm 1'),
      card('b522apdm 2')
    ]);

    expect(result.map((book) => [book.series, book.seriesIndex, book.seriesInferred])).toEqual([
      ['ダンタリアンの書架', 1, true],
      ['ダンタリアンの書架', 2, true],
      [undefined, 1, undefined],
      [undefined, 1, undefined],
      [undefined, 1, undefined]
    ]);
  });

  it('groups 上/中/下 volumes in that order, like split_volume', () => {
    const result = inferSeries([
      card('風の物語 下'),
      card('風の物語（上巻）'),
      card('風の物語 中')
    ]);

    expect(result.map((book) => [book.series, book.seriesIndex])).toEqual([
      ['風の物語', 3],
      ['風の物語', 1],
      ['風の物語', 2]
    ]);
  });

  it('adds a single volume to an existing series of that name and keeps given series', () => {
    expect(inferSeries([card('狼と香辛料 3')])[0].series).toBeUndefined();
    expect(inferSeries([card('abc物語 3'), card('別の本', 'ＡＢＣ物語')])).toMatchObject([
      { series: 'ＡＢＣ物語', seriesIndex: 3, seriesInferred: true },
      { series: 'ＡＢＣ物語', seriesIndex: 1 }
    ]);
  });
});

describe('browser series', () => {
  afterEach(() => localStorage.clear());

  it('merges by the newest change per title', () => {
    expect(
      mergeSeriesOverrides(
        { a: { series: 'A', modified: 2 }, b: { series: 'B', modified: 1 } },
        {
          a: { series: 'X', modified: 1 },
          b: { series: '', modified: 3 },
          c: { series: 'C', modified: 1 }
        }
      )
    ).toEqual({
      a: { series: 'A', modified: 2 },
      b: { series: '', modified: 3 },
      c: { series: 'C', modified: 1 }
    });
  });

  it('saves locally without a request and applies over the inferred series', async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal('fetch', fetchMock);
    await saveSeriesOverrides({ ダンタリアンの書架２: '', Other: 'Mine' }, true);

    const result = withBrowserSeries([
      card('ダンタリアンの書架１'),
      card('ダンタリアンの書架２'),
      card('Other')
    ]);

    expect(result.map((book) => book.series)).toEqual(['ダンタリアンの書架', undefined, 'Mine']);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
