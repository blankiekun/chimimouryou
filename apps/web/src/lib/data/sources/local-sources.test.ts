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
