/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, type FakeApi } from '$lib/data/test-utils/fake-api';

let user: { id: string } | null = null;

vi.mock('$lib/data/account', () => ({ accountReady: async () => user }));

let api: FakeApi;

async function load() {
  vi.resetModules();
  return import('$lib/data/server-api');
}

beforeEach(() => {
  user = null;
  vi.stubGlobal('indexedDB', new IDBFactory());
  api = fakeApi({ account: () => user?.id ?? '' });
  vi.stubGlobal('fetch', api.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiVersion', () => {
  // Bug: syncing with a pre-v1 server (or a newer API) would write to routes that are gone or
  // mean something else; it must stop with a message the reader can act on.
  it('refuses an old or newer server with its own message', async () => {
    api = fakeApi({ api: null });
    vi.stubGlobal('fetch', api.fetch);
    let { apiVersion } = await load();

    await expect(apiVersion()).rejects.toMatchObject({
      status: 426,
      message: 'This server is older than the app: it needs the /api/v1 update.'
    });

    api = fakeApi({ api: 2 });
    vi.stubGlobal('fetch', api.fetch);
    ({ apiVersion } = await load());
    await expect(apiVersion()).rejects.toThrow(
      'This server is newer than the app: update the app.'
    );
    expect(api.requests).toEqual(['GET /api/v1/version']);
  });
});

describe('catalog', () => {
  // Bugs: a delta that dropped unchanged books, kept deleted ones, or mixed up the Calibre id
  // (estimates, readings, mokuro) with books.id (v1 paths).
  it('fetches only changes after the first load, and keeps the Calibre id as id', async () => {
    api.addBook({ id: 1, calibreId: 501, title: 'A', added: 10 });
    api.addBook({ id: 2, calibreId: 502, title: 'B', added: 20 });
    let { catalog } = await load();

    expect((await catalog()).map((book) => [book.id, book.bookId, book.title])).toEqual([
      [502, 2, 'B'],
      [501, 1, 'A']
    ]);

    api.addBook({ id: 2, calibreId: 502, title: 'B', deleted: true });
    api.addBook({ id: 3, calibreId: 503, title: 'C', added: 30 });
    ({ catalog } = await load());

    expect((await catalog()).map((book) => book.title)).toEqual(['C', 'A']);
    expect(api.requests).toEqual(['GET /api/v1/catalog?since=0', 'GET /api/v1/catalog?since=2']);
  });

  // Bug: after the server's database is made again its rev starts low, so a delta from the old
  // rev returns nothing and the cache would keep stale books forever.
  it('starts over when the server rev went back', async () => {
    api.addBook({ id: 1, calibreId: 501, title: 'Old' });
    api.addBook({ id: 2, calibreId: 502, title: 'Old 2' });
    let { catalog } = await load();

    await catalog();
    api.reset();
    api.addBook({ id: 9, calibreId: 509, title: 'New' });
    ({ catalog } = await load());
    // reset() kept the old books at rev 0: only the full list (since=0) shows them as live.
    expect((await catalog()).map((book) => book.title).sort()).toEqual(['New', 'Old', 'Old 2']);
    expect(api.requests.slice(-2)).toEqual([
      'GET /api/v1/catalog?since=2',
      'GET /api/v1/catalog?since=0'
    ]);
  });

  // Bug: a 404 (first build running) turned into an empty library instead of "being built".
  it('keeps the HTTP status of a failure', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":"x"}', { status: 404 }));
    const { catalog } = await load();

    await expect(catalog()).rejects.toMatchObject({ status: 404 });
  });
});

describe('syncMirror', () => {
  // Bug: on a shared browser the next reader would see (and sync into) the last one's rows.
  it('keeps each account apart and drops the others', async () => {
    user = { id: 'a' };
    api.setRow('progress', { book: 1, data: { a: 1 }, modified: 5 }, 'a');
    let server = await load();

    expect((await server.syncMirror()).progress).toHaveLength(1);

    user = { id: 'b' };
    server = await load();
    expect((await server.syncMirror()).progress).toEqual([]);
    await server.dropSyncMirrors('b');

    // A's mirror is gone from IndexedDB too: offline, signed in as A again, nothing is left.
    user = { id: 'a' };
    server = await load();
    expect((await server.syncMirror(false)).progress).toEqual([]);
  });

  // Bug: a /sync answer computed before a write landed would put the older row back over the
  // written one, and the next upload check would send it again.
  it('never lets an older delta row replace a newer written one', async () => {
    const server = await load();

    api.setRow('progress', { book: 1, data: { v: 1 }, modified: 1 });
    await server.syncMirror();
    // The delta is computed now (rev 1 → row v1), the write lands before it is merged.
    const stale = { rev: 1, progress: [{ book: 1, data: { v: 1 }, modified: 1, rev: 1 }] };
    let release: () => void = () => {};

    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url).includes('/sync')) {
        await new Promise<void>((resolve) => (release = resolve));
        return new Response(JSON.stringify(stale));
      }
      return api.fetch(url, init);
    });
    const pending = server.syncMirror();

    await server.putRow('books/1/progress', { modified: 2, data: { v: 2 }, progress: 0 });
    release();
    expect((await pending).progress.map((row) => row.data)).toEqual([{ v: 2 }]);
  });
});

describe('putRow', () => {
  // Bug: a 409 thrown as an error (the reader sees a failed sync for a row that is simply newer
  // elsewhere), or the newer row not kept, so the next check uploads the older one again.
  it('returns the server row on 409 and keeps it in the mirror', async () => {
    const server = await load();

    api.setRow('progress', { book: 1, data: { v: 'server' }, modified: 20 });

    const result = await server.putRow('books/1/progress', { modified: 10, data: { v: 'mine' } });

    expect(result).toMatchObject({ ok: false, row: { modified: 20 } });
    expect((await server.syncMirror(false)).progress).toMatchObject([
      { book: 1, modified: 20, data: { v: 'server' } }
    ]);
    // Equal modified is already there: no conflict, nothing to retry.
    expect(await server.putRow('books/1/progress', { modified: 20, data: {} })).toMatchObject({
      ok: true
    });
  });
});
