/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The standalone engine with the real browser library (fake-indexeddb) and the fake sites
 * (serve.py). Ways it could fail, each checked below:
 * - added volumes land under another title, outside the work's series, or not at all
 * - a new chapter makes a second book instead of replacing the open volume, or the replace drops
 *   the reader's place in it (the bookmark): the brief's "progress survives a same-title replace"
 * - an update fetches full volumes again, or adds nothing when the site has new chapters
 * - the timer checks paused follows, checks before Check every has passed, or on mobile data with
 *   Wi-Fi only on (without saying why); Check now must run anyway
 * - a failed job starts over instead of going on from the failed chapter
 * - the free-space gate lets an add through that doesn't fit
 */

import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure } from '@zip.js/zip.js';
import { database } from '$lib/data/store';
import { startFakeSites } from './fake-sites';
import * as local from './local-sources';
import { syncSourcesWith } from './sources-sync';
import { sourcesWifiOnly$ } from './sources-settings';

configure({ useWebWorkers: false });

let sites: Awaited<ReturnType<typeof startFakeSites>>;
const set = (query: string) => fetch(`${sites.base}/fake-set?${query}`);

beforeAll(async () => {
  sites = await startFakeSites();
});
afterAll(() => sites.stop());
beforeEach(() => {
  vi.unstubAllGlobals();
  sourcesWifiOnly$.next(true);
});

const book = (title: string) => database.getDataByTitle(title);

/** Runs queued jobs to the end. */
async function settle() {
  await local.runQueued();
}

describe('local sources', () => {
  it('adds volumes as books in the series and replaces the open one in place', async () => {
    await set('work=n0003cc&chapters=60');
    const work = await local.lookUpWork('https://ncode.syosetu.com/n0003cc/');
    expect(work.volumes.map((v) => [v.number, v.first, v.last])).toEqual([
      [1, 1, 50],
      [2, 51, 60]
    ]);
    await local.addVolumes(work.id, [1, 2]);
    await settle();
    const vol1 = await book(`${work.title} 1`);
    const vol2 = await book(`${work.title} 2`);
    expect([vol1?.series, vol1?.seriesIndex, vol2?.seriesIndex]).toEqual([work.title, 1, 2]);
    expect((await local.getWork(work.id)).volumes.every((v) => v.inLibrary)).toBe(true);

    // The reader is somewhere in Vol. 2.
    await database.putBookmark({ dataId: vol2!.id, exploredCharCount: 1234, progress: 0.5 } as any);

    await local.followWork(work.id);
    await settle();
    expect((await local.getFollowing()).follows[0].state).toBe('current');
    await set('work=n0003cc&chapters=62');
    await local.checkNow(work.id);
    await settle();
    const replaced = await book(`${work.title} 2`);
    expect(replaced?.id).toBe(vol2!.id);
    expect(replaced!.elementHtml.length).toBeGreaterThan(vol2!.elementHtml.length);
    expect((await database.getBookmark(vol2!.id))?.exploredCharCount).toBe(1234);
    // Vol. 1 was full: never rewritten.
    expect((await book(`${work.title} 1`))?.lastBookModified).toBe(vol1!.lastBookModified);
    const follow = (await local.getFollowing()).follows.find((f) => f.workId === work.id);
    expect(follow).toMatchObject({ state: 'new' });
    expect(follow?.detail).toContain('2 new chapters, added to Vol. 2');

    // Nothing new: nothing rewritten.
    await local.checkNow(work.id);
    await settle();
    expect((await book(`${work.title} 2`))?.lastBookModified).toBe(replaced!.lastBookModified);
    expect((await local.getFollowing()).follows[0].state).toBe('current');
  });

  it('checks due follows only, and waits for Wi-Fi unless asked', async () => {
    await set('work=n0005ee&chapters=3');
    const work = await local.lookUpWork('https://ncode.syosetu.com/n0005ee/');
    await local.followWork(work.id, true);
    const jobs = async () =>
      (await local.getQueue()).jobs.filter(
        (j) => j.workId === work.id && j.kind === 'update' && j.state === 'queued'
      );
    await local.queueDueChecks(Date.now());
    expect(await jobs()).toEqual([]);

    await local.followWork(work.id, false);
    await settle();
    // Following a work with nothing here fetches all of it.
    const first = (await local.getFollowing()).follows.find((f) => f.workId === work.id)!;
    expect(first.state).toBe('new');
    await set('work=n0005ee&chapters=4');
    // An hour later is not due yet.
    await local.queueDueChecks(Date.now() + 3600 * 1000);
    expect(await jobs()).toHaveLength(0);

    // Due, but on mobile data with Wi-Fi only: the follow says so and nothing is fetched.
    vi.stubGlobal('navigator', { ...navigator, connection: { type: 'cellular' } });
    const later = Date.now() + 7 * 3600 * 1000;
    await local.queueDueChecks(later);
    expect(await jobs()).toHaveLength(0);
    expect((await local.getFollowing()).follows.find((f) => f.workId === work.id)?.state).toBe(
      'wifi'
    );
    // Check now runs anyway.
    await local.checkNow(work.id);
    await settle();
    const follow = (await local.getFollowing()).follows.find((f) => f.workId === work.id);
    expect(follow?.detail).toContain('1 new chapter');
  });

  it('goes on from the failed chapter', async () => {
    await set('work=n0004dd&chapters=3');
    const work = await local.lookUpWork('https://ncode.syosetu.com/n0004dd/');
    const real = globalThis.fetch;
    const asked: string[] = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      asked.push(String(url));
      if (String(url).endsWith('/n0004dd/2/') && asked.filter((u) => u === url).length === 1) {
        return Promise.resolve(new Response('down', { status: 500 }));
      }
      return real(url, init);
    });
    await local.addVolumes(work.id, [1]);
    await settle();
    const [failed] = (await local.getQueue()).jobs.filter((j) => j.workId === work.id);
    expect([failed.state, failed.failedAt]).toEqual(['failed', 2]);
    await local.retryJob(failed.id);
    await settle();
    expect((await local.getQueue()).jobs.find((j) => j.id === failed.id)?.state).toBe('done');
    const chapters = asked.filter((u) => /\/n0004dd\/\d+\/$/.test(u));
    expect(chapters.filter((u) => u.endsWith('/1/'))).toHaveLength(1);
    expect(chapters.filter((u) => u.endsWith('/2/'))).toHaveLength(2);
    expect(await book(`${work.title} 1`)).toBeTruthy();
  });

  it('refuses an add that does not fit in the free space', async () => {
    await set('work=n0006ff&chapters=120');
    const work = await local.lookUpWork('https://ncode.syosetu.com/n0006ff/');
    vi.stubGlobal('navigator', {
      ...navigator,
      storage: { estimate: () => Promise.resolve({ quota: 1_000_000, usage: 900_000 }) }
    });
    const space = await local.spaceFor(work, [1, 2, 3]);
    expect(space.fits).toBe(false);
    await expect(local.addVolumes(work.id, [1, 2, 3])).rejects.toThrow(/space/);
  });
});

/**
 * sources.json: follows shared through the reader's sync folder, each run by one device. The
 * other device is the file (written here as it would write it). Ways it could fail:
 * - a follow made on another device doesn't show here, or this device checks it too (two
 *   devices fetching the same work)
 * - an unfollow made here comes back at the next sync, or the running device never hears of it
 * - a pause made on another device isn't applied by the device that runs the follow
 * - the same work followed on both devices before a sync keeps two runners
 * - another device's OPDS follow lands on this device's server with the same number
 * - a sync without changes writes the file again
 */
describe('sources.json', () => {
  const me = 'dev-here';
  let file: { text: string; version: string } | undefined;
  let writes = 0;
  const store = {
    readSyncFile: async () => file,
    writeSyncFile: async (_: string, text: string) => {
      writes += 1;
      file = { text, version: String(writes) };
    }
  };
  const entries = () => JSON.parse(file!.text).follows as any[];
  const remote = (follows: object[]) => {
    file = { text: JSON.stringify({ follows }), version: 'r' };
  };
  const other = {
    device: 'dev-desktop',
    deviceName: 'the desktop app',
    siteName: 'Syosetu',
    paused: false
  };

  beforeEach(() => {
    localStorage.setItem('sourcesDevice', me);
  });

  it('lists a follow of another device without checking it, and shares its own', async () => {
    await set('work=n0007gg&chapters=3');
    const mine = await local.lookUpWork('https://ncode.syosetu.com/n0007gg/');
    await local.followWork(mine.id);
    await settle();
    remote([
      {
        ...other,
        key: 'syosetu n0008hh',
        site: 'syosetu',
        workKey: 'n0008hh',
        url: 'https://ncode.syosetu.com/n0008hh/',
        title: 'Remote work',
        modified: Date.now()
      }
    ]);
    await syncSourcesWith(store);

    expect(entries().map((e) => [e.workKey, e.device])).toEqual(
      expect.arrayContaining([
        ['n0007gg', me],
        ['n0008hh', 'dev-desktop']
      ])
    );
    const listed = (await local.getFollowing()).follows.find((f) => f.title === 'Remote work');
    expect(listed?.elsewhere).toBe('the desktop app');

    const asked: string[] = [];
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      asked.push(String(url));
      return real(url, init);
    });
    await local.checkNow();
    await settle();
    expect(asked.some((u) => u.includes('n0008hh'))).toBe(false);

    // Nothing changed since: the file isn't written again.
    const before = writes;
    await syncSourcesWith(store);
    expect(writes).toBe(before);
  });

  it('keeps an unfollow, and applies a pause from another device', async () => {
    await set('work=n0009ii&chapters=3');
    const work = await local.lookUpWork('https://ncode.syosetu.com/n0009ii/');
    await local.followWork(work.id);
    await syncSourcesWith(store);
    // Paused on the other device a moment later.
    remote(
      entries().map((e) =>
        e.workKey === 'n0009ii' ? { ...e, paused: true, modified: e.modified + 1 } : e
      )
    );
    await syncSourcesWith(store);
    expect((await local.getWork(work.id)).paused).toBe(true);

    await local.unfollowWork(work.id);
    await syncSourcesWith(store);
    expect(entries().find((e) => e.workKey === 'n0009ii')?.deleted).toBe(true);
    await syncSourcesWith(store);
    expect((await local.getWork(work.id)).following).toBe(false);
  });

  it('hands a work followed on both devices to the newer follow', async () => {
    await set('work=n0010jj&chapters=3');
    const work = await local.lookUpWork('https://ncode.syosetu.com/n0010jj/');
    await local.followWork(work.id);
    remote([
      {
        ...other,
        key: 'syosetu n0010jj',
        site: 'syosetu',
        workKey: 'n0010jj',
        url: work.url,
        title: work.title,
        modified: Date.now() + 1000
      }
    ]);
    await syncSourcesWith(store);
    const follow = (await local.getFollowing()).follows.find((f) => f.workId === work.id);
    expect(follow?.elsewhere).toBe('the desktop app');
  });

  it("leaves another device's OPDS follows off this device's servers", async () => {
    remote([
      {
        ...other,
        key: 'dev-desktop opds:1 /series/1',
        site: 'opds:1',
        siteName: 'Komga',
        workKey: '/series/1',
        url: 'http://komga.invalid/series/1',
        title: 'Server work',
        modified: Date.now()
      }
    ]);
    await syncSourcesWith(store);
    // Listed for Unfollow only (owner s64), never bound to this device's server 1.
    expect(
      (await local.getFollowing()).follows.find((f) => f.title === 'Server work')
    ).toMatchObject({ workId: 0, shared: 'dev-desktop opds:1 /series/1' });
    // Kept in the file for the device that runs it.
    expect(entries().some((e) => e.title === 'Server work')).toBe(true);
  });
});
