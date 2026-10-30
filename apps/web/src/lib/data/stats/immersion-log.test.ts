/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/data/account', () => ({
  accountReady: async () => null,
  accountSyncUrl: '/account/sync/',
  currentAccount: () => null
}));

import { readerDb } from '$lib/data/reader-db';
import {
  addImmersionEntry,
  addImmersionTime,
  deleteImmersionEntry,
  entriesBetween,
  immersionLog$,
  isImmersionEntry,
  mergeImmersion,
  totalsByType,
  trackListening,
  type ImmersionEntry
} from './immersion-log';

const entry = (id: string, modified: number, extra: Partial<ImmersionEntry> = {}) =>
  ({
    id,
    type: 'anime',
    title: '',
    day: '2026-10-20',
    seconds: 60,
    characters: 0,
    source: 'manual',
    modified,
    ...extra
  }) as ImmersionEntry;

describe('immersion log', () => {
  afterEach(async () => {
    vi.useRealTimers();
    window.localStorage.clear();
    await (await readerDb()).delete('known', 'immersion');
  });

  it('keeps the newest copy of each entry, removals included', () => {
    expect(
      mergeImmersion(
        { a: entry('a', 5), b: entry('b', 1), c: entry('c', 3, { deleted: true }) },
        {
          a: entry('a', 4, { deleted: true }),
          b: entry('b', 2, { deleted: true }),
          d: entry('d', 1)
        }
      )
    ).toEqual({
      a: entry('a', 5),
      b: entry('b', 2, { deleted: true }),
      c: entry('c', 3, { deleted: true }),
      d: entry('d', 1)
    });
  });

  it('checks entries from other devices', () => {
    expect(isImmersionEntry(entry('a', 1))).toBe(true);
    expect(isImmersionEntry({ ...entry('a', 1), day: 'yesterday' })).toBe(false);
    expect(isImmersionEntry({ ...entry('a', 1), seconds: -5 })).toBe(false);
    expect(isImmersionEntry({ ...entry('a', 1), source: 'hub' })).toBe(false);
  });

  it('adds up automatic time per day and title, and adds and removes manual entries', async () => {
    const day = new Date(2026, 9, 21, 12);

    await addImmersionTime('hook', 'vn', 'ゲーム', 30, 100, day);
    await addImmersionTime('hook', 'vn', 'ゲーム', 45, 50, day);
    await addImmersionTime('hook', 'vn', '別のゲーム', 10, 5, day);
    await addImmersionEntry({
      type: 'podcast',
      title: '',
      day: '2026-10-21',
      seconds: 600,
      characters: 0
    });

    const entries = entriesBetween(immersionLog$.getValue(), '2026-10-21', '2026-10-21');

    expect(entries).toHaveLength(3);
    expect(totalsByType(entries)).toEqual([
      { type: 'podcast', seconds: 600, characters: 0 },
      { type: 'vn', seconds: 85, characters: 155 }
    ]);

    const podcast = entries.find((item) => item.type === 'podcast')!;

    await deleteImmersionEntry(podcast.id);
    expect(entriesBetween(immersionLog$.getValue(), '2026-10-21', '2026-10-21')).toHaveLength(2);
    expect(((await (await readerDb()).get('known', 'immersion')) as any)[podcast.id].deleted).toBe(
      true
    );
    expect(entriesBetween(immersionLog$.getValue(), '2026-10-22', '2026-10-30')).toEqual([]);
  });

  it('logs play time of an audio element at pause', async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 21, 12), toFake: ['Date'] });

    const audio = document.createElement('audio');

    Object.defineProperty(audio, 'paused', { value: true, configurable: true });
    const stop = trackListening(audio, () => '本');

    audio.dispatchEvent(new Event('playing'));
    vi.setSystemTime(new Date(2026, 9, 21, 12, 2));
    audio.dispatchEvent(new Event('pause'));
    stop();
    await vi.waitFor(() =>
      expect(Object.values(immersionLog$.getValue())).toMatchObject([
        { type: 'listening', title: '本', source: 'listen', seconds: 120 }
      ])
    );
  });
});
