/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enabledPlugins$ } from '$lib/plugins/plugin-settings';
import { nowPlaying$, type NowPlaying } from '$lib/data/audio/now-playing';
import { discordActivities$, discordOptions$, defaultTemplate } from './discord-settings';
import { discordActivity, resetSender } from './discord';
import { buildActivity } from './discord-template';

const times = { now: 1_000_000 };

describe('Listening activity', () => {
  it('is type 2 for listen, also when private; other kinds have no type', () => {
    const template = { ...defaultTemplate('listen'), name: '{title}' };

    expect(buildActivity(template, { title: 'Book' }, { times, kind: 'listen' })).toMatchObject({
      type: 2,
      name: 'Book'
    });
    expect(
      buildActivity(template, { title: 'Book' }, { times, kind: 'listen', private: true })
    ).toMatchObject({ type: 2, name: 'an audiobook' });
    expect(buildActivity(template, { title: 'Book' }, { times, kind: 'book' })).not.toHaveProperty(
      'type'
    );
    expect(
      buildActivity(template, { title: 'Book' }, { times, kind: 'book', private: true })
    ).not.toHaveProperty('type');
  });
});

const fetchMock = vi.fn();
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
const puts = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init.method === 'PUT')
    .map(([, init]) => {
      const { name, type } = JSON.parse(init.body);

      return type ? `${type} ${name}` : name;
    });
const player = (playing: boolean, source?: 'audiobookshelf'): NowPlaying => ({
  playing,
  text: '',
  time: '',
  rate: 1,
  rates: [1],
  toggle: () => {},
  step: () => {},
  setRate: () => {},
  source
});

describe('discord sender while Audiobookshelf plays', () => {
  beforeAll(async () => {
    await import('$lib/data/social/social');
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    resetSender();
    nowPlaying$.next(undefined);
    discordOptions$.next({ awayMinutes: 1 });
    discordActivities$.next({
      book: {
        name: 'Reading {title}',
        details: '',
        state: '',
        largeImage: 'logo',
        timestamp: 'none'
      },
      listen: { name: '{title}', details: '', state: '', largeImage: 'logo', timestamp: 'none' }
    });
    enabledPlugins$.next(['discord']);
    fetchMock.mockClear();
  });

  afterEach(() => {
    enabledPlugins$.next([]);
    nowPlaying$.next(undefined);
    resetSender();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('reports listen while ABS plays, book after it stops, and stays past the away time', async () => {
    discordActivity({ kind: 'book', title: 'Book', position: 1, characters: 100 });
    await settle();
    // Another player (local audiobook) is not Listening.
    nowPlaying$.next(player(true));
    await settle();
    nowPlaying$.next(player(true, 'audiobookshelf'));
    await settle();
    vi.advanceTimersByTime(15_000);
    await settle();
    expect(puts()).toEqual(['Reading Book', '2 Book']);

    // No Away while listening.
    vi.advanceTimersByTime(5 * 60_000);
    await settle();
    expect(puts().at(-1)).toEqual('2 Book');

    nowPlaying$.next(player(false, 'audiobookshelf'));
    await settle();
    vi.advanceTimersByTime(15_000);
    await settle();
    expect(puts().at(-1)).toEqual('Reading Book');
  });

  it('shows the book activity with the Listening activity off', async () => {
    discordActivities$.next({
      ...discordActivities$.getValue(),
      listen: { ...discordActivities$.getValue().listen, show: false }
    });
    discordActivity({ kind: 'book', title: 'Book', position: 1, characters: 100 });
    nowPlaying$.next(player(true, 'audiobookshelf'));
    await settle();
    vi.advanceTimersByTime(15_000);
    await settle();
    expect(puts()).toEqual(['Reading Book']);
  });
});
