/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const catalog = vi.hoisted(() => ({ fails: false }));

vi.mock('$lib/data/remote/calibre', () => ({
  loadCalibreCatalog: async () => {
    if (catalog.fails) throw new Error('HTTP 401');
    return [{ title: 'Calibre' }];
  }
}));

// The sync itself isn't under test: it leaves whatever it couldn't send on the waiting list.
vi.mock('$lib/data/storage/reader-storage', () => ({ retryWaitingChanges: async () => {} }));

const { database } = await import('$lib/data/store');
const { readerDb } = await import('$lib/data/reader-db');
const { releaseReaderData, signOutAndRelease } = await import(
  '$lib/data/account/reader-data-owner'
);
const { dropWaiting, syncQueued, waitingChanges } = await import('$lib/data/sync/sync-status');

async function seed() {
  const db = await database.db;
  for (const [id, title] of [
    [1, 'Calibre'],
    [2, 'Local']
  ] as const) {
    await db.put('data', { id, title } as any);
    await db.put('bookmark', { dataId: id } as any);
    await db.put('statistic', { title, dateKey: '2026-10-12' } as any);
    await db.put('lastModified', { title, dataType: 'statistic', lastModifiedValue: 1 } as any);
  }
  await db.put('readingGoal', { goalStartDate: '2026-10-01', goalEndDate: '' } as any);
  await (await readerDb()).put('kanji', { title: 'Local', upTo: 1, counts: { 人: 1 } });
}

const kanjiCount = async () => (await readerDb()).count('kanji');

async function counts() {
  const db = await database.db;
  return Promise.all(
    (['data', 'bookmark', 'statistic', 'lastModified', 'readingGoal'] as const).map((store) =>
      db.count(store)
    )
  );
}

const user = (id: string) => ({ id, username: id });

describe('releaseReaderData', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    catalog.fails = false;
    await seed();
  });

  it('adopts data from before owners were recorded and keeps it for the same reader', async () => {
    await releaseReaderData(user('a'));
    await releaseReaderData(user('a'));
    expect(await counts()).toEqual([2, 2, 2, 2, 1]);
    expect(await kanjiCount()).toBe(1);
  });

  it("clears Calibre books' progress, statistics and goals for another reader", async () => {
    await releaseReaderData(user('a'));
    await releaseReaderData(user('b'));
    expect(await counts()).toEqual([2, 1, 1, 1, 0]);
    expect(await kanjiCount()).toBe(0);
    const db = await database.db;
    expect(await db.get('bookmark', 2)).toMatchObject({ dataId: 2 });
    expect(await db.get('statistic', ['Local', '2026-10-12'])).toMatchObject({ title: 'Local' });
  });

  it('forgets the known words read from Anki for another reader', async () => {
    await releaseReaderData(user('a'));
    await (await readerDb()).put('known', { words: ['猫'], read: 1 }, 'words');
    await releaseReaderData(user('a'));
    expect(await (await readerDb()).count('known')).toBe(1);
    await releaseReaderData(user('b'));
    expect(await (await readerDb()).count('known')).toBe(0);
  });

  it('treats signing out as another reader', async () => {
    await releaseReaderData(user('a'));
    await releaseReaderData(null, true);
    expect(await counts()).toEqual([2, 1, 1, 1, 0]);
  });

  it('keeps everything when the session merely expired, or the catalog cannot be read', async () => {
    await releaseReaderData(user('a'));
    await (await readerDb()).put('known', { words: ['猫'], read: 1 }, 'words');
    await releaseReaderData(null);
    expect(window.localStorage.getItem('readerDataOwner')).toBe('a');
    catalog.fails = true;
    await expect(releaseReaderData(user('b'))).rejects.toThrow();
    expect(await counts()).toEqual([2, 2, 2, 2, 1]);
    expect(await (await readerDb()).count('known')).toBe(1);
    expect(await kanjiCount()).toBe(1);
  });
});

// Each of these catches a sign-out that loses reading data, or one that keeps it after really signing out.
describe('signOutAndRelease', () => {
  const untouched = [2, 2, 2, 2, 1];

  beforeEach(async () => {
    window.localStorage.clear();
    dropWaiting(waitingChanges());
    catalog.fails = false;
    await seed();
    await releaseReaderData(user('a'));
  });

  it('reads the catalog while signed in, then clears only after the sign-out', async () => {
    let countsAtSignOut: number[] = [];

    await signOutAndRelease(async () => {
      countsAtSignOut = await counts();
      // The server stops answering this reader as soon as the session is gone.
      catalog.fails = true;
    });
    expect(countsAtSignOut).toEqual(untouched);
    expect(await counts()).toEqual([2, 1, 1, 1, 0]);
    expect(window.localStorage.getItem('readerDataOwner')).toBe('');
  });

  it('clears nothing when the sign-out fails (offline)', async () => {
    await expect(
      signOutAndRelease(async () => {
        throw new TypeError('Failed to fetch');
      })
    ).rejects.toThrow();
    expect(await counts()).toEqual(untouched);
    expect(window.localStorage.getItem('readerDataOwner')).toBe('a');
  });

  it('stays signed in while changes for the server are still unsent', async () => {
    const end = vi.fn(async () => {});

    syncQueued('ttu-calibre-default\tstatistic\tCalibre');
    await expect(signOutAndRelease(end)).rejects.toThrow();
    expect(end).not.toHaveBeenCalled();
    expect(await counts()).toEqual(untouched);
  });

  it("isn't held up by another sync target's waiting changes, which it doesn't clear", async () => {
    const end = vi.fn(async () => {});

    syncQueued('ttu-gdrive-default\tstatistic\tLocal');
    await signOutAndRelease(end);
    expect(end).toHaveBeenCalled();
  });

  it('signs out but keeps the data when the catalog cannot be read', async () => {
    const end = vi.fn(async () => {});

    catalog.fails = true;
    await signOutAndRelease(end);
    expect(end).toHaveBeenCalled();
    expect(await counts()).toEqual(untouched);
    expect(window.localStorage.getItem('readerDataOwner')).toBe('a');
  });
});
