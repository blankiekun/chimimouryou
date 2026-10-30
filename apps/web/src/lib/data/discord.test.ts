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
import { socialSession$ } from './social-account';
import { fakeApi } from './test-utils/fake-api';

const fetchMock = vi.fn();
// One API for the file: server-api.ts keeps the catalog and the mirror per page load.
const api = fakeApi();

api.addBook({ id: 1, calibreId: 101, title: 'A' });
// fetchMock stands for the hub, AniList and the status relay; /api/v1/ goes to the fake server.
const dispatch = (url: string, init?: RequestInit) =>
  String(url).startsWith('/api/v1/') ? api.fetch(url, init) : fetchMock(url, init);
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

describe('discord automatic covers', () => {
  const searches = () =>
    fetchMock.mock.calls.filter(([url]) => /anilist|vndb/.test(String(url))).length;
  const read = async (title: string) => {
    discordActivity({ kind: 'book', title, position: 1, characters: 100 });
    await settle();
  };

  beforeEach(async () => {
    await import('$lib/data/social');
    vi.stubGlobal('fetch', dispatch);
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }));
    resetSender();
    discordOptions$.next({ hideTitles: false });
    discordActivities$.next({
      book: { name: 'Reading {title}', details: '', state: '', largeImage: 'cover' }
    });
    enabledPlugins$.next(['discord']);
  });

  afterEach(async () => {
    enabledPlugins$.next([]);
    resetSender();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    window.localStorage.clear();
    (await import('$lib/data/social')).hiddenBooks$.next([]);
  });

  it('searches for a book without details, and remembers the miss', async () => {
    await read('Ｒｅ：ゼロから始める異世界生活 1');
    await vi.waitFor(() => expect(searches()).toBe(1));
    await settle();
    discordActivity({ kind: 'book', title: 'Ｒｅ：ゼロから始める異世界生活 1', position: 2 });
    await settle();
    await settle();
    expect(searches()).toBe(1);
  });

  it('never searches with a logo, Hide titles, a hidden book or the plugin off', async () => {
    const { bookKey, hiddenBooks$ } = await import('$lib/data/social');

    discordActivities$.next({
      book: { name: 'Reading {title}', details: '', state: '', largeImage: 'logo' }
    });
    await read('A');
    resetSender(); // the open book would be searched when the template changes
    discordActivities$.next({
      book: { name: 'Reading {title}', details: '', state: '', largeImage: 'cover' }
    });
    discordOptions$.next({ hideTitles: true });
    await read('B');
    resetSender();
    discordOptions$.next({ hideTitles: false });
    hiddenBooks$.next([bookKey('C')]);
    await read('C');
    enabledPlugins$.next([]);
    await read('D');
    expect(searches()).toBe(0);
  });

  describe('from the hub', () => {
    const hubCovers = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/cover')).length;
    const largeImage = () => {
      const put = fetchMock.mock.calls
        .filter(([url, init]) => String(url).endsWith('/v1/activity') && init.method === 'PUT')
        .at(-1);
      return put && JSON.parse(put[1].body).assets?.large_image;
    };
    let picked = '';

    beforeEach(async () => {
      picked = '';
      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/v1/cover?key=')) {
          return new Response(JSON.stringify({ cover: '0123456789abcdef' }), { status: 200 });
        }
        return new Response(null, { status: url.endsWith('/v1/activity') ? 204 : 404 });
      });
      (await import('./book-metadata')).loadBookMetadata(true).catch(() => {});
      socialSession$.next({ token: 't', me: { id: 'a', share: {} } as never });
      enabledPlugins$.next(['discord', 'social']);
    });

    afterEach(() => socialSession$.next(null));

    it('uses a cover picked in Find details, else the hub thumbnail, else the matched one', async () => {
      window.localStorage.setItem(
        'discordCoverMatches',
        JSON.stringify({ A: { cover: 'https://s4.anilist.co/file/a.jpg' } })
      );
      await read('A');
      expect(largeImage()).toBe(
        'https://chimi-hub.blankiekun.workers.dev/v1/cover/0123456789abcdef'
      );

      resetSender();
      enabledPlugins$.next(['discord']);
      await read('A');
      expect(largeImage()).toBe('https://s4.anilist.co/file/a.jpg');

      resetSender();
      picked = 'https://s4.anilist.co/file/picked.jpg';
      api.setRow('metadata', {
        book: api.bookId('A'),
        modified: 1,
        data: { source: 'anilist', url: 'https://anilist.co/manga/1', cover: picked }
      });
      (await import('./book-metadata')).loadBookMetadata(true).catch(() => {});
      enabledPlugins$.next(['discord', 'social']);
      fetchMock.mockClear();
      await read('A');
      expect(largeImage()).toBe(picked);
      expect(hubCovers()).toBe(0);
      expect(searches()).toBe(0);
    });

    it("asks the hub only signed in, with social on and for a book that isn't private", async () => {
      const { bookKey, hiddenBooks$ } = await import('$lib/data/social');

      socialSession$.next(null);
      await read('A');
      resetSender();
      socialSession$.next({ token: 't', me: { id: 'a', share: {} } as never });
      enabledPlugins$.next(['discord']);
      await read('B');
      resetSender();
      enabledPlugins$.next(['discord', 'social']);
      hiddenBooks$.next([bookKey('C')]);
      await read('C');
      resetSender();
      discordOptions$.next({ hideTitles: true });
      await read('D');
      resetSender();
      enabledPlugins$.next(['social']);
      discordOptions$.next({ hideTitles: false });
      await read('E');
      expect(hubCovers()).toBe(0);

      resetSender();
      enabledPlugins$.next(['discord', 'social']);
      await read('F');
      expect(hubCovers()).toBe(1);
    });
  });
});

describe('discord hub relay', () => {
  const hubCalls = () =>
    fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/v1/presence'))
      .map(([, init]) => {
        if (init.method !== 'PUT') return init.method;
        const body = JSON.parse(init.body);
        return `PUT ${body.kind} ${body.activity.name} ttl ${body.ttl}`;
      });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    resetSender();
    socialSession$.next({ token: 't', me: { id: 'a', share: {} } as never });
    discordOptions$.next({ awayMinutes: 7, relay: true });
    discordActivities$.next({
      book: { name: 'Reading {title}', details: '', state: '', largeImage: 'logo' },
      idle: { show: true, name: 'In the library', details: '', state: '' }
    });
    enabledPlugins$.next(['discord', 'social']);
    fetchMock.mockClear();
  });

  afterEach(() => {
    enabledPlugins$.next([]);
    socialSession$.next(null);
    resetSender();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('sends a change with its kind and ttl at once, then at most once a minute', async () => {
    discordActivity({ kind: 'book', title: 'A', position: 1, characters: 100 });
    await settle();
    expect(hubCalls()).toEqual(['PUT book Reading A ttl 7']);

    discordActivity({ kind: 'book', title: 'B', position: 1, characters: 100 });
    await settle();
    vi.advanceTimersByTime(15_000);
    await settle();
    expect(hubCalls()).toEqual(['PUT book Reading A ttl 7']);

    vi.advanceTimersByTime(45_000);
    expect(hubCalls()).toEqual(['PUT book Reading A ttl 7', 'PUT book Reading B ttl 7']);
  });

  it('refreshes an unchanged status on a page turn only near its end, no timer', async () => {
    discordActivity({ kind: 'book', title: 'A', position: 1, characters: 100 });
    await settle();

    // Within ttl - 2 min a page turn sends nothing.
    vi.advanceTimersByTime(4 * 60_000);
    discordActivity({ kind: 'book', title: 'A', position: 2, characters: 100 });
    await settle();
    expect(hubCalls()).toHaveLength(1);

    // Later, with no page turn, nothing either.
    vi.advanceTimersByTime(60_000 + 1);
    await settle();
    expect(hubCalls()).toHaveLength(1);

    discordActivity({ kind: 'book', title: 'A', position: 3, characters: 100 });
    await settle();
    expect(hubCalls()).toEqual(['PUT book Reading A ttl 7', 'PUT book Reading A ttl 7']);
  });

  it('clamps the ttl to 5-30 minutes', async () => {
    discordOptions$.next({ awayMinutes: 240, relay: true });
    discordActivity({ kind: 'book', title: 'A', position: 1, characters: 100 });
    await settle();
    expect(hubCalls()).toEqual(['PUT book Reading A ttl 30']);
  });

  it('deletes when away shows nothing, and when the switch goes off', async () => {
    discordOptions$.next({ awayMinutes: 7, awayIdle: false, relay: true });
    discordActivity({ kind: 'book', title: 'A', position: 1, characters: 100 });
    await settle();
    vi.advanceTimersByTime(7 * 60_000);
    await settle();
    expect(hubCalls()).toEqual(['PUT book Reading A ttl 7', 'DELETE']);

    discordActivity({ kind: 'book', title: 'A', position: 2, characters: 100 });
    await settle();
    discordOptions$.next({ awayMinutes: 7, awayIdle: false, relay: false });
    await settle();
    expect(hubCalls()).toEqual([
      'PUT book Reading A ttl 7',
      'DELETE',
      'PUT book Reading A ttl 7',
      'DELETE'
    ]);
    discordActivity({ kind: 'book', title: 'B', position: 1, characters: 100 });
    await settle();
    vi.advanceTimersByTime(60_000);
    expect(hubCalls()).toHaveLength(4);
  });

  it('sends nothing to the hub with the switch, social or the account off', async () => {
    for (const off of [
      () => discordOptions$.next({ relay: false }),
      () => enabledPlugins$.next(['discord']),
      () => socialSession$.next(null)
    ]) {
      resetSender();
      off();
      discordActivity({ kind: 'book', title: 'A', position: 1, characters: 100 });
      await settle();
      vi.advanceTimersByTime(60_000);
      await settle();
    }
    expect(hubCalls()).toEqual([]);
    // The add-on still got the status.
    expect(fetchMock).toHaveBeenCalled();
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
