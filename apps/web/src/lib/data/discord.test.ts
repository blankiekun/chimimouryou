/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enabledPlugins$ } from '$lib/plugins/plugin-settings';
import { discordActivities$, discordOptions$ } from './discord-settings';
import { discordActivity, formatDuration, readingValues, resetSender } from './discord';

const fetchMock = vi.fn();
// Real ticks for the dynamic imports and promises; only timers and the clock are fake.
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
const calls = () =>
  fetchMock.mock.calls.map(([, init]) =>
    init.method === 'PUT' ? `PUT ${JSON.parse(init.body).name}` : init.method
  );

describe('discord sender', () => {
  beforeAll(async () => {
    await import('$lib/data/social');
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    resetSender();
    discordOptions$.next({ awayMinutes: 1 });
    discordActivities$.next({
      book: {
        name: 'Reading {title}',
        details: '',
        state: '',
        largeImage: 'logo',
        timestamp: 'none'
      },
      idle: { show: true, name: 'In the library', details: '', state: '' }
    });
    enabledPlugins$.next(['discord']);
    fetchMock.mockClear();
  });

  afterEach(() => {
    enabledPlugins$.next([]);
    resetSender();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('sends the first change at once, then at most every 15 s, the newest winning', async () => {
    discordActivity({ kind: 'book', title: 'A', position: 1, characters: 100 });
    await settle();
    expect(calls()).toEqual(['PUT Reading A']);

    // The same text again is no change.
    discordActivity({ kind: 'book', title: 'A', position: 2, characters: 100 });
    await settle();
    discordActivity({ kind: 'book', title: 'B', position: 1, characters: 100 });
    await settle();
    discordActivity({ kind: 'book', title: 'C', position: 1, characters: 100 });
    await settle();
    expect(calls()).toEqual(['PUT Reading A']);

    vi.advanceTimersByTime(15_000);
    expect(calls()).toEqual(['PUT Reading A', 'PUT Reading C']);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:41918/v1/activity');
  });

  it('shows the library activity after the away time, and the book again on a page turn', async () => {
    discordActivity({ kind: 'book', title: 'A', position: 1, characters: 100 });
    await settle();
    vi.advanceTimersByTime(60_000);
    await settle();
    expect(calls()).toEqual(['PUT Reading A', 'PUT In the library']);

    discordActivity({ kind: 'book', title: 'A', position: 5, characters: 100 });
    await settle();
    vi.advanceTimersByTime(15_000);
    expect(calls()).toEqual(['PUT Reading A', 'PUT In the library', 'PUT Reading A']);
  });

  it('clears the status when away with Show nothing', async () => {
    discordOptions$.next({ awayMinutes: 1, awayIdle: false });
    discordActivity({ kind: 'book', title: 'A', position: 1, characters: 100 });
    await settle();
    vi.advanceTimersByTime(60_000);
    await settle();
    expect(calls()).toEqual(['PUT Reading A', 'DELETE']);
  });

  it('clears on leaving unless the next page reports at once', async () => {
    discordActivity({ kind: 'book', title: 'A', position: 1, characters: 100 });
    await settle();
    discordActivity(undefined);
    discordActivity({ kind: 'idle' });
    await settle();
    vi.advanceTimersByTime(15_000);
    expect(calls()).toEqual(['PUT Reading A', 'PUT In the library']);

    discordActivity(undefined);
    vi.advanceTimersByTime(2_000);
    expect(calls()).toEqual(['PUT Reading A', 'PUT In the library', 'DELETE']);
  });

  it('sends nothing with the plugin or Show my status off, and clears when switched off', async () => {
    enabledPlugins$.next([]);
    discordActivity({ kind: 'book', title: 'A', position: 1, characters: 100 });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    enabledPlugins$.next(['discord']);
    await settle();
    expect(calls()).toEqual(['PUT Reading A']);

    discordOptions$.next({ show: false });
    await settle();
    expect(calls()).toEqual(['PUT Reading A', 'DELETE']);
    discordActivity({ kind: 'book', title: 'B', position: 1, characters: 100 });
    await settle();
    vi.advanceTimersByTime(60_000);
    expect(calls()).toEqual(['PUT Reading A', 'DELETE']);
  });

  it('keeps the last status while a template has an unknown variable', async () => {
    discordActivity({ kind: 'book', title: 'A', position: 1, characters: 100 });
    await settle();
    discordActivities$.next({
      ...discordActivities$.getValue(),
      book: { name: 'Reading {titel}', details: '', state: '', largeImage: 'logo' }
    });
    await settle();
    vi.advanceTimersByTime(15_000);
    expect(calls()).toEqual(['PUT Reading A']);
  });
});

describe('readingValues', () => {
  it('fills in a book from its position, chapters and the day', () => {
    const sections = [
      {
        reference: 'a',
        label: '一',
        charactersWeight: 1,
        startCharacter: 0,
        characters: 100,
        progress: 100
      },
      {
        reference: 'b',
        label: '二',
        charactersWeight: 1,
        startCharacter: 100,
        characters: 100,
        progress: 50
      }
    ];
    const { values, times } = readingValues(
      { kind: 'book', title: '本 3', position: 150, characters: 400, sections },
      { stats: { charsToday: 4820, timeToday: 1920, speed: 9040, streak: 12 }, difficulty: 3.14 },
      { now: 0 }
    );

    expect(values).toMatchObject({
      title: '本 3',
      volume: 'Vol. 3',
      chapter: '二',
      chapterNumber: '2',
      chapterCount: '2',
      percent: '37%',
      charsRead: '150',
      charsToday: '4,820',
      timeToday: '32 min',
      speed: '9,040',
      streak: '12 days',
      difficulty: '3.1',
      kind: 'Book'
    });
    expect(Math.round(times.chapterLeft!)).toBe(20);
    expect(Math.round(times.bookLeft!)).toBe(100);
  });

  it('counts manga in pages', () => {
    const { values } = readingValues(
      { kind: 'manga', title: 'M', page: 48, pageCount: 200 },
      {},
      { now: 0 }
    );

    expect(values).toMatchObject({ page: '48', pageCount: '200', percent: '24%', charsRead: '' });
  });

  it('formats durations', () => {
    expect(formatDuration(20)).toBe('');
    expect(formatDuration(1920)).toBe('32 min');
    expect(formatDuration(34800)).toBe('9 h 40 min');
    expect(formatDuration(7200)).toBe('2 h');
  });
});
