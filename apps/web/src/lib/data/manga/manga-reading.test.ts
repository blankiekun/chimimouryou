/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// maxSecondsPerPage comes from vn-text, which opens the database through the store.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
import type { MokuroPage } from '$lib/data/manga/mokuro';
import { getDateKey } from '$lib/functions/statistic-util';
import { MangaReading } from './manga-reading';

const page = (text: string): MokuroPage => ({
  name: '',
  width: 1,
  height: 1,
  blocks: [{ box: [0, 0, 1, 1], vertical: true, fontSize: 1, lines: [text] }]
});
/** Page i has i + 1 characters, so a sum names the pages counted. */
const pages = (count: number) => Array.from({ length: count }, (_, i) => page('あ'.repeat(i + 1)));
const on = { statistics: true, startDayHours: 0 };
const start = new Date(2026, 0, 10, 12).getTime();
const day = getDateKey(0, new Date(start));

function reading(pageCount: number, opened: number, shown: number[], text = pages(pageCount)) {
  const statistics = new Map<string, BooksDbStatistic>();
  const result = new MangaReading('Manga', statistics, pageCount, opened, shown, start);

  result.setText(text, on, start);

  return { reading: result, statistics };
}

describe('MangaReading', () => {
  it('never counts pages before the opening page', () => {
    const { reading: r, statistics } = reading(10, 5, [5]);

    r.moved([6], on, start + 10_000);

    expect(statistics.get(day)?.charactersRead).toBe(6);
  });

  it('counts a page once', () => {
    const { reading: r, statistics } = reading(5, 0, [0]);

    r.moved([1], on, start + 1000);
    r.moved([0], on, start + 2000);
    r.moved([1], on, start + 3000);

    expect(statistics.get(day)?.charactersRead).toBe(1 + 2);
  });

  it('counts both pages of a spread when it is left', () => {
    const { reading: r, statistics } = reading(6, 0, [0, 1]);

    r.moved([2, 3], on, start + 1000);

    expect(statistics.get(day)?.charactersRead).toBe(1 + 2);
  });

  it('counts the last page on arrival', () => {
    const { reading: r, statistics } = reading(3, 1, [1]);

    r.moved([2], on, start + 1000);

    expect(statistics.get(day)?.charactersRead).toBe(2 + 3);
  });

  it('caps the time of a move at 120 s', () => {
    const { reading: r, statistics } = reading(5, 0, [0]);

    r.moved([1], on, start + 600_000);

    expect(statistics.get(day)?.readingTime).toBe(120);
  });

  it('adds time and no characters for pages without text', () => {
    const { reading: r, statistics } = reading(5, 0, [0], []);

    r.moved([1], on, start + 30_000);

    expect(statistics.get(day)).toMatchObject({ readingTime: 30, charactersRead: 0 });
  });

  it('writes no row with statistics off, but still advances upTo and keeps the text', () => {
    const { reading: r, statistics } = reading(5, 0, [0]);

    r.moved([1], { statistics: false, startDayHours: 0 }, start + 30_000);

    expect(statistics.size).toBe(0);
    expect(r.takeChanges()).toEqual({ text: 'あ', upTo: 1, days: [] });
  });

  it('puts the time on the new day after midnight', () => {
    const late = new Date(2026, 0, 10, 23, 59).getTime();
    const statistics = new Map<string, BooksDbStatistic>();
    const r = new MangaReading('Manga', statistics, 5, 0, [0], late - 60_000);

    r.moved([1], on, late);
    r.moved([2], on, late + 90_000);

    expect(statistics.get(getDateKey(0, new Date(late)))?.readingTime).toBe(60);
    expect(statistics.get(getDateKey(0, new Date(late + 90_000)))?.readingTime).toBe(90);
  });

  it('counts the time until a pause, and not the time away', () => {
    const { reading: r, statistics } = reading(5, 0, [0]);

    r.pause(on, start + 20_000);
    expect(statistics.get(day)).toMatchObject({ readingTime: 20, charactersRead: 0 });

    r.resume(start + 100_000);
    r.moved([1], on, start + 110_000);
    expect(statistics.get(day)).toMatchObject({ readingTime: 30, charactersRead: 1 });
  });

  it('adds no time for a move after a pause without a resume', () => {
    const { reading: r, statistics } = reading(5, 0, [0]);

    r.pause(on, start + 20_000);
    r.moved([1], on, start + 100_000);

    expect(statistics.get(day)?.readingTime).toBe(20);
  });

  it('gives upTo as the text before the furthest page read, pages before the opening included', () => {
    const { reading: r } = reading(10, 5, [5]);

    r.moved([6], on, start + 1000);

    expect(r.takeChanges()?.upTo).toBe(1 + 2 + 3 + 4 + 5 + 6);
  });

  it('has no changes when nothing changed, and gives put-back changes again', () => {
    const { reading: r } = reading(5, 0, [0]);

    expect(r.takeChanges()).toBeUndefined();

    r.moved([1], on, start + 5000);

    const changes = r.takeChanges()!;

    expect(changes.days).toHaveLength(1);
    expect(r.takeChanges()).toBeUndefined();

    r.putBack(changes);
    expect(r.takeChanges()).toEqual(changes);
  });

  it('counts pages left before the text came once it does, with no extra time', () => {
    const { reading: r, statistics } = reading(5, 0, [0], []);

    r.moved([1], on, start + 1000);
    expect(statistics.get(day)).toMatchObject({ readingTime: 1, charactersRead: 0 });

    r.setText(pages(5), on, start + 1500);
    expect(statistics.get(day)).toMatchObject({ readingTime: 1, charactersRead: 1 });

    r.moved([2], on, start + 2000);
    expect(statistics.get(day)).toMatchObject({ readingTime: 2, charactersRead: 1 + 2 });
    expect(r.takeChanges()?.text).toBe('あ' + 'ああ');

    // Counted once: the same text again adds nothing.
    r.setText(pages(5), on, start + 3000);
    expect(statistics.get(day)?.charactersRead).toBe(3);
  });

  it('stays paused when the shown pages change while hidden', () => {
    const { reading: r, statistics } = reading(5, 0, [0]);

    r.pause(on, start + 20_000);
    r.moved([1], on, start + 30_000);
    r.pause(on, start + 100_000);

    expect(statistics.get(day)?.readingTime).toBe(20);
  });

  it('does nothing when the same pages are shown again', () => {
    const { reading: r, statistics } = reading(5, 0, [0, 1]);

    r.moved([0, 1], on, start + 30_000);

    expect(statistics.size).toBe(0);
    expect(r.takeChanges()).toBeUndefined();

    r.moved([2, 3], on, start + 40_000);
    expect(statistics.get(day)).toMatchObject({ readingTime: 40, charactersRead: 1 + 2 });
  });
});
