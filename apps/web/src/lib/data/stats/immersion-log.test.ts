/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/data/account/account', () => ({
  accountReady: async () => null,
  currentAccount: () => null
}));

import { readerDb } from '$lib/data/reader-db';
import { isTrackerPaused$ } from '$lib/components/book-reader/book-reading-tracker/book-reading-tracker';
import {
  addImmersionEntry,
  addImmersionTime,
  deleteImmersionEntry,
  entriesBetween,
  immersionLog$,
  isImmersionEntry,
  mergeImmersion,
  sameImmersion,
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

  it('keeps the newest copy of each entry, and a removal over any live copy', () => {
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
      a: entry('a', 4, { deleted: true }),
      b: entry('b', 2, { deleted: true }),
      c: entry('c', 3, { deleted: true }),
      d: entry('d', 1)
    });
  });

  it('lets a removal win over a newer live copy, and keeps the larger automatic counts', () => {
    const auto = (modified: number, extra: Partial<ImmersionEntry> = {}) =>
      entry('listen:x', modified, { source: 'listen', ...extra });

    expect(
      mergeImmersion({ x: auto(9, { seconds: 7260 }) }, { x: auto(2, { deleted: true }) }).x
    ).toEqual(auto(2, { deleted: true }));
    expect(
      mergeImmersion({ x: auto(9, { seconds: 60 }) }, { x: auto(2, { seconds: 7200 }) }).x
    ).toEqual(auto(9, { seconds: 7200 }));
    expect(sameImmersion({ x: auto(9, { seconds: 60 }) }, { x: auto(9, { seconds: 7200 }) })).toBe(
      false
    );
  });

  it('starts a new automatic entry after a removal', async () => {
    const day = new Date(2026, 9, 21, 12);

    await addImmersionTime('hook', 'vn', 'ゲーム', 30, 100, day);
    await deleteImmersionEntry(Object.keys(immersionLog$.getValue())[0]);
    await addImmersionTime('hook', 'vn', 'ゲーム', 5, 1, day);
    await addImmersionTime('hook', 'vn', 'ゲーム', 5, 1, day);

    expect(entriesBetween(immersionLog$.getValue(), '2026-10-21', '2026-10-21')).toMatchObject([
      { seconds: 10, characters: 2 }
    ]);
    expect(Object.keys(immersionLog$.getValue())).toHaveLength(2);
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

  it('skips buffering and time the reader counts, and writes when the page hides', async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 21, 12), toFake: ['Date'] });

    const audio = document.createElement('audio');
    const at = (minutes: number) => vi.setSystemTime(new Date(2026, 9, 21, 12, minutes));

    Object.defineProperty(audio, 'paused', { value: false, configurable: true });
    const stop = trackListening(audio, () => '本');

    at(1);
    audio.dispatchEvent(new Event('waiting'));
    at(3);
    audio.dispatchEvent(new Event('playing'));
    at(4);
    isTrackerPaused$.next(false);
    at(10);
    isTrackerPaused$.next(true);
    at(11);
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() =>
      expect(Object.values(immersionLog$.getValue())).toMatchObject([{ seconds: 180 }])
    );
    stop();
  });
});
