/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, type FakeApi } from '$lib/data/test-utils/fake-api';
import { StorageDataType, StorageKey, StorageSourceDefault } from '$lib/data/storage/storage-types';
import { MergeMode } from '$lib/data/merge-mode';
import { ReplicationSaveBehavior } from '$lib/functions/replication/replication-options';

const account = vi.hoisted(() => ({ user: null as { id: string; username: string } | null }));

vi.mock('$lib/data/account/account', () => ({
  accountReady: async () => account.user,
  currentAccount: () => account.user
}));

type Imports = typeof import('./server-handler') &
  typeof import('./browser-handler') &
  typeof import('$lib/data/store') &
  typeof import('$lib/functions/replication/replicator') &
  typeof import('$lib/data/vn/windows-game') &
  typeof import('$lib/data/remote/server-rows');

let ServerStorageHandler: Imports['ServerStorageHandler'];
let BrowserStorageHandler: Imports['BrowserStorageHandler'];
let calibreReceivedBooks$: Imports['calibreReceivedBooks$'];
let database: Imports['database'];
let libraryBuilding$: Imports['libraryBuilding$'];
let libraryOffline$: Imports['libraryOffline$'];
let librarySignInNeeded: Imports['librarySignInNeeded'];
let replicateData: Imports['replicateData'];
let windowsGameBook: Imports['windowsGameBook'];
let writeSyncFile: Imports['writeSyncFile'];

/** Fresh modules and IndexedDB per test: the catalog cache and the mirror live in both. */
async function loadModules() {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  ({ ServerStorageHandler, calibreReceivedBooks$ } = await import('./server-handler'));
  ({ BrowserStorageHandler } = await import('./browser-handler'));
  ({ database, libraryBuilding$, libraryOffline$, librarySignInNeeded } = await import(
    '$lib/data/store'
  ));
  ({ replicateData } = await import('$lib/functions/replication/replicator'));
  ({ windowsGameBook } = await import('$lib/data/vn/windows-game'));
  ({ writeSyncFile } = await import('$lib/data/remote/server-rows'));
  (await import('@zip.js/zip.js')).configure({ useWebWorkers: false });
}

/** jsdom's Blob has neither arrayBuffer() nor stream(). */
function bytes(blob: Blob) {
  return new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}

let api: FakeApi;

function handler(mode = MergeMode.MERGE, cache = false) {
  const server = new ServerStorageHandler(window);

  server.updateSettings(window, true, ReplicationSaveBehavior.NewOnly, mode, mode, cache, false);
  return server;
}

function browser(mode = MergeMode.MERGE) {
  const local = new BrowserStorageHandler(window, StorageKey.BROWSER);

  local.updateSettings(window, true, ReplicationSaveBehavior.NewOnly, mode, mode);
  return local;
}

/** A Calibre book processed in this browser, with a bookmark. */
async function localBook(title: string, bookmark?: { progress: number; modified: number }) {
  await database.upsertData(
    {
      title,
      styleSheet: '',
      elementHtml: '<p>本文</p>',
      blobs: {},
      coverImage: '',
      hasThumb: true,
      characters: 2,
      sections: [],
      lastBookModified: 1,
      lastBookOpen: 1,
      storageSource: StorageSourceDefault.CALIBRE_DEFAULT
    },
    ReplicationSaveBehavior.Overwrite,
    false,
    false
  );
  const id = (await database.getDataByTitle(title))!.id;

  if (bookmark) {
    await database.putBookmark({
      dataId: id,
      exploredCharCount: 1,
      progress: bookmark.progress,
      lastBookmarkModified: bookmark.modified
    } as never);
  }
  return id;
}

const day = (dateKey: string, modified: number) => ({
  title: 'こころ',
  dateKey,
  charactersRead: 10,
  readingTime: 60,
  minReadingSpeed: 0,
  altMinReadingSpeed: 0,
  lastReadingSpeed: 0,
  maxReadingSpeed: 0,
  lastStatisticModified: modified
});

beforeEach(async () => {
  await loadModules();
  account.user = { id: 'a', username: 'a' };
  window.localStorage.clear();
  window.localStorage.setItem('readerDataOwner', 'a');
  api = fakeApi({ account: () => account.user?.id ?? '' });
  api.addBook({ id: 7, calibreId: 107, title: 'こころ', added: 5 });
  vi.stubGlobal('fetch', api.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getBookList', () => {
  // Bugs: a request per title (the old WebDAV listing), or progress read from another book.
  it('builds the cards from the catalog and one sync request', async () => {
    api.addBook({ id: 8, calibreId: 108, title: '坊っちゃん', added: 6 });
    api.setRow('progress', { book: 7, data: {}, progress: 0.4, modified: 50 });

    const cards = await handler().getBookList();
    const card = cards.find((entry) => entry.title === 'こころ')!;

    expect(card).toMatchObject({ progress: 0.4, lastBookmarkModified: 50, lastBookOpen: 50 });
    expect(card.calibreId).toBe(107);
    expect(cards.find((entry) => entry.title === '坊っちゃん')!.progress).toBe(0);
    expect(api.requests.filter((request) => request.includes('/api/'))).toEqual([
      'GET /api/v1/version',
      'GET /api/v1/catalog?since=0',
      'GET /api/v1/sync?since=0'
    ]);
  });

  // Bug: offline, a fresh browser reads as signed out; the library must not ask to sign in.
  it("lists this source's cached books when the server can't be reached", async () => {
    await localBook('こころ', { progress: 0.3, modified: 9 });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    account.user = null;

    const cards = await handler().getBookList();

    expect(cards.map((card) => [card.title, card.progress])).toEqual([['こころ', 0.3]]);
    expect(libraryOffline$.getValue()).toBe(true);
    expect(librarySignInNeeded(account.user, libraryOffline$.getValue())).toBe(false);
  });

  // Bugs: a 401 for a signed-out reader shown as a failure (the source switches to the
  // browser), or the first build's 404 shown as an empty library forever.
  // Also: a signed-in 401 (expired session) listing nothing instead of saying so, and the
  // library staying on "building" after the first build is done.
  it('asks to sign in on 401 and waits for the first build on 404', async () => {
    account.user = null;
    libraryOffline$.next(true);
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));
    expect(await handler().getBookList()).toEqual([]);
    expect(libraryOffline$.getValue()).toBe(false);
    expect(librarySignInNeeded(account.user, libraryOffline$.getValue())).toBe(true);

    account.user = { id: 'a', username: 'a' };
    vi.stubGlobal('fetch', async (url: string) =>
      /\/catalog|\/sync/.test(url) ? new Response('{}', { status: 401 }) : api.fetch(url)
    );
    await expect(handler().getBookList()).rejects.toThrow('Your sign-in has expired');

    account.user = { id: 'a', username: 'a' };
    vi.stubGlobal('fetch', async (url: string) =>
      url.includes('/catalog') ? new Response('{}', { status: 404 }) : api.fetch(url)
    );
    expect(await handler().getBookList()).toEqual([]);
    expect(libraryBuilding$.getValue()).toBe(true);

    vi.stubGlobal('fetch', (url: string) => api.fetch(url));
    await handler().getBookList();
    expect(libraryBuilding$.getValue()).toBe(false);
  });

  // Bug: a book a friend sent (not in the catalog) vanished from the library after a reload.
  it('keeps books friends sent', async () => {
    await localBook('走れメロス (from Aki)');
    calibreReceivedBooks$.next(['走れメロス (from Aki)']);

    expect((await handler().getBookList()).map((card) => card.title)).toContain(
      '走れメロス (from Aki)'
    );
    calibreReceivedBooks$.next([]);
  });
});

describe('progress', () => {
  // Bug: the replicator compared the wrong times (or none) and either sent nothing, sent
  // every time, or never took a newer position from another device.
  it('goes up when newer here and comes down when newer on the server', async () => {
    await localBook('こころ', { progress: 0.2, modified: 100 });
    const context = [{ title: 'こころ' }];

    await replicateData(browser(), handler(), false, context, [StorageDataType.PROGRESS]);
    expect(api.rowsOf('progress')).toMatchObject([{ book: 7, modified: 100, progress: 0.2 }]);

    // Up to date: nothing sent again.
    const writes = api.requests.filter((request) => request.startsWith('PUT')).length;

    await replicateData(browser(), handler(), false, context, [StorageDataType.PROGRESS]);
    expect(api.requests.filter((request) => request.startsWith('PUT'))).toHaveLength(writes);

    api.setRow('progress', {
      book: 7,
      progress: 0.6,
      modified: 200,
      data: { dataId: 0, exploredCharCount: 5, progress: 0.6, lastBookmarkModified: 200 }
    });
    await replicateData(handler(), browser(), false, context, [StorageDataType.PROGRESS]);
    const id = (await database.getDataByTitle('こころ'))!.id;

    expect(await database.getBookmark(id)).toMatchObject({ lastBookmarkModified: 200 });
  });

  // Bug: a 409 (the server's row newer than the mirror knew) shown as a failed sync or retried
  // forever; it must take the server's row instead.
  it('takes the server row on 409 without an error', async () => {
    const server = handler(MergeMode.MERGE, true);

    server.startContext({ title: 'こころ' });
    await server.getBookList();
    api.setRow('progress', { book: 7, data: { lastBookmarkModified: 300 }, modified: 300 });

    await server.saveProgress({ progress: 0.1, lastBookmarkModified: 250 } as never);
    expect(await server.getRecentModified(StorageDataType.PROGRESS)).toBe(300);
  });
});

describe('audiobook position', () => {
  // Bug: positions saved but not read back (wrong doc kind, or no modified time for the
  // replicator) never reached the other device, or were re-sent on every sync.
  it('goes up as a book doc and comes down when newer on the server', async () => {
    await localBook('こころ');
    await database.putAudioBook({
      title: 'こころ',
      playbackPosition: 42,
      lastAudioBookModified: 100
    });
    const context = [{ title: 'こころ' }];

    await replicateData(browser(), handler(), false, context, [StorageDataType.AUDIOBOOK]);
    expect(api.rowsOf('bookDocs')).toMatchObject([
      { book: 7, kind: 'audiobook', modified: 100, data: { playbackPosition: 42 } }
    ]);

    const writes = api.requests.filter((request) => request.startsWith('PUT')).length;

    await replicateData(browser(), handler(), false, context, [StorageDataType.AUDIOBOOK]);
    expect(api.requests.filter((request) => request.startsWith('PUT'))).toHaveLength(writes);

    api.setRow('bookDocs', {
      book: 7,
      kind: 'audiobook',
      modified: 200,
      data: { title: 'こころ', playbackPosition: 90, lastAudioBookModified: 200 }
    });
    await replicateData(handler(), browser(), false, context, [StorageDataType.AUDIOBOOK]);

    expect(await database.getAudioBook('こころ')).toMatchObject({ playbackPosition: 90 });
  });
});

describe('statistics', () => {
  async function upload(mode: MergeMode, days: ReturnType<typeof day>[]) {
    const server = handler(mode);

    server.startContext({ title: 'こころ' });
    await server.saveStatistics(days as never, 0);
  }

  // Bug (Review Focus 5): MERGE deleting the server's days the browser lacks, so another
  // device's reading vanished.
  it('MERGE writes only newer days and deletes none', async () => {
    api.setRow('statistics', {
      book: 7,
      dateKey: '2026-01-01',
      data: day('2026-01-01', 10),
      modified: 10
    });
    api.setRow('statistics', {
      book: 7,
      dateKey: '2026-01-02',
      data: day('2026-01-02', 20),
      modified: 20
    });

    await upload(MergeMode.MERGE, [day('2026-01-02', 30)]);

    expect(api.requests.filter((request) => !request.startsWith('GET'))).toEqual([
      'PUT /api/v1/books/7/statistics/2026-01-02'
    ]);
    expect(api.rowsOf('statistics').every((row) => !row.deleted)).toBe(true);
  });

  // Bug: REPLACE, the only way a deleted day reaches the server, leaving the day there.
  it('REPLACE deletes the days missing from the list', async () => {
    api.setRow('statistics', {
      book: 7,
      dateKey: '2026-01-01',
      data: day('2026-01-01', 10),
      modified: 10
    });

    await upload(MergeMode.REPLACE, [day('2026-01-02', 30)]);

    expect(api.rowsOf('statistics').map((row) => [row.dateKey, row.deleted])).toEqual([
      ['2026-01-01', true],
      ['2026-01-02', false]
    ]);
    // The deleted day still counts for the newest time, so other devices take the deletion.
    const server = handler(MergeMode.REPLACE);

    server.startContext({ title: 'こころ' });
    expect((await server.getStatistics()).statistics?.map((entry) => entry.dateKey)).toEqual([
      '2026-01-02'
    ]);
  });

  // Bug: goals keyed by the wrong field, so REPLACE deleted the goal it had just written.
  it('REPLACE of the reading goals deletes only the removed goal', async () => {
    const goal = (goalStartDate: string, lastGoalModified: number) => ({
      goalStartDate,
      lastGoalModified,
      timeGoal: 1,
      characterGoal: 1,
      goalFrequency: 'daily',
      goalEndDate: '',
      goalOriginalEndDate: ''
    });

    api.setRow('goals', { goalStart: '2026-01-01', data: goal('2026-01-01', 5), modified: 5 });
    await handler(MergeMode.REPLACE).saveReadingGoals([goal('2026-02-01', 9)] as never, 9);

    expect(api.rowsOf('goals').map((row) => [row.goalStart, row.deleted])).toEqual([
      ['2026-01-01', true],
      ['2026-02-01', false]
    ]);
  });
});

describe('saveBook', () => {
  const book = (extra: object) => ({
    title: 'こころ',
    styleSheet: 'p{}',
    elementHtml: '<p>本文</p>',
    blobs: { 'a.png': new Blob(['x']) },
    coverImage: new Blob(['c']),
    hasThumb: true,
    characters: 2,
    sections: [{ reference: 's', charactersWeight: 1 }],
    lastBookModified: 1,
    lastBookOpen: 1,
    ...extra
  });

  // Bugs: images or the cover sent with the text (the old 100 MB uploads), or manga and game
  // folders uploaded although each device loads them from the library.
  it('sends a Calibre book as gzipped text only, nothing for manga or game folders', async () => {
    const server = handler();

    server.startContext({ title: 'こころ' });
    await server.saveBook(book({}) as never);
    await server.saveBook(book({ elementHtml: '<!--ttu-manga-->["1.jpg"]' }) as never);
    await server.saveBook(book({ elementHtml: '<!--ttu-vn-->{"engine":"onscripter"}' }) as never);

    const gzip = api.files.get('books/7/text')!;
    const text = await new Response(
      new Response(await bytes(gzip)).body!.pipeThrough(new DecompressionStream('gzip'))
    ).json();

    expect(text).toEqual({
      elementHtml: '<p>本文</p>',
      sections: [{ reference: 's', charactersWeight: 1 }],
      styleSheet: 'p{}'
    });
    expect(api.requests.filter((request) => request.startsWith('PUT'))).toHaveLength(1);
  });

  // Bug: a signed-out reader sending the text PUT, which gets a 401 and uses up the address's
  // readings rate limit (nginx limits before auth).
  it('sends no text copy when signed out', async () => {
    account.user = null;
    const server = handler();

    server.startContext({ title: 'こころ' });
    await server.saveBook(book({}) as never);

    expect(api.requests.filter((request) => request.startsWith('PUT'))).toEqual([]);
  });
});

describe('a Windows game record', () => {
  const record = () => windowsGameBook('信天翁', 'game.exe', undefined, undefined);

  // Bugs: a reader's game record written to the shared '' account, or not removable, or
  // listed for nobody.
  it("is the account's own: written, listed, read back and deleted", async () => {
    const server = handler();

    server.startContext({ title: '信天翁' });
    await server.saveBook({ ...record(), lastBookModified: 40 } as never);
    expect(api.rowsOf('games')).toMatchObject([{ name: '信天翁', modified: 40 }]);

    const lister = handler();

    expect((await lister.getBookList()).map((card) => card.title)).toContain('信天翁');

    const reader = handler();

    reader.startContext({ title: '信天翁' });
    expect((await reader.getBook()) as { title: string }).toMatchObject({ title: '信天翁' });

    await reader.deleteBookData(['信天翁'], new AbortController().signal);
    expect(api.rowsOf('games')).toMatchObject([{ name: '信天翁', deleted: true }]);
  });

  it('is not sent while signed out', async () => {
    account.user = null;
    window.localStorage.setItem('readerDataOwner', '');
    const server = handler();

    server.startContext({ title: '信天翁' });
    await server.saveBook(record() as never);
    expect(api.requests.filter((request) => request.startsWith('PUT'))).toEqual([]);
  });
});

describe("a Windows game's details", () => {
  const title = '信天翁';
  const vndb = {
    source: 'vndb',
    url: 'https://vndb.org/v1',
    title: 'アルバトロス',
    description: 'Text',
    cover: 'https://t.vndb.org/cv/01/1.jpg',
    genres: [],
    released: '2001',
    score: 80
  } as const;
  const gameCard = (cards: { title: string }[]) => cards.find((card) => card.title === title)!;

  async function localGame() {
    await database.upsertData(
      {
        ...windowsGameBook(title, 'game.exe', undefined, undefined),
        lastBookModified: 40,
        storageSource: StorageSourceDefault.CALIBRE_DEFAULT
      } as never,
      ReplicationSaveBehavior.Overwrite,
      false,
      false
    );
    return (await database.getDataByTitle(title))!;
  }

  async function pick() {
    const { saveBookMetadata } = await import('$lib/data/library/book-metadata');

    await saveBookMetadata(title, vndb as never);
  }

  async function shownOn(cards: Promise<{ title: string }[]>, isCalibre: boolean) {
    const { loadBookDetails } = await import('$lib/data/library/book-details');
    const card = gameCard(await cards);

    expect(card).toMatchObject({ imagePath: vndb.cover, displayTitle: vndb.title });
    expect((await loadBookDetails(card as never, 'vn', isCalibre)).metadata).toMatchObject({
      url: vndb.url,
      description: vndb.description
    });
  }

  // Bugs: a game has no Calibre id, so a pick was thrown away and its card and page lost it after a
  // reload; one device's pick missing on the next; a pick re-uploading the whole game record.
  it('on the server: a game doc, listed and shown on every device', async () => {
    const server = handler();

    server.startContext({ title });
    await server.saveBook(await localGame());
    await pick();
    expect(api.rowsOf('gameDocs')).toMatchObject([
      { name: title, kind: 'metadata', data: { url: vndb.url } }
    ]);
    expect(api.rowsOf('games')).toMatchObject([{ modified: 40 }]);

    // Another device (fresh modules and IndexedDB): only the server has them.
    await loadModules();
    await shownOn(handler().getBookList(), true);
  });

  // Bugs: details kept only where they were picked (no newer lastBookModified, or lost in the
  // record's zip), or a damaged entry in a synced record shown.
  it('without the server: on the record, which syncs with it', async () => {
    await localGame();
    await pick();

    const stored = (await database.getDataByTitle(title))!;

    expect(stored.lastBookModified).toBeGreaterThan(40);
    expect(api.rowsOf('gameDocs')).toEqual([]);
    await shownOn(browser().getBookList(), false);

    // The record's round trip as its zip (as Drive, OneDrive and folders keep it): up, then down on
    // a fresh device.
    const server = handler();

    server.startContext({ title });
    await server.saveBook(stored);
    await loadModules();

    const reader = handler();

    reader.startContext({ title });
    await reader.getBook();
    await shownOn(browser().getBookList(), false);
  });
});

describe('while an expired session still owns the data', () => {
  // Bug: a signed-out browser holding account A's data writing it into (or showing) the shared
  // '' rows every signed-out reader sees.
  it('neither shows nor writes personal rows', async () => {
    account.user = null;
    api.setRow('progress', { book: 7, data: {}, progress: 0.9, modified: 9 }, '');

    const server = handler();

    expect((await server.getBookList()).find((card) => card.title === 'こころ')!.progress).toBe(0);
    server.startContext({ title: 'こころ' });
    await expect(
      server.saveProgress({ progress: 0.1, lastBookmarkModified: 10 } as never)
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      writeSyncFile('annotations.json', '{"highlights":[]}', {
        title: 'こころ'
      })
    ).rejects.toMatchObject({ status: 401 });
    expect(api.requests.filter((request) => request.startsWith('PUT'))).toEqual([]);
  });
});

describe('opening a book offline', () => {
  // Bug: opening a book asked the server for the sync state first, so a book cached in this
  // browser failed with "Failed to fetch" when the server was out of reach.
  it('opens the copy cached in this browser', async () => {
    const id = await localBook('こころ');

    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const server = handler();

    server.startContext({ title: 'こころ' });
    expect(await server.prepareBookForReading()).toBe(id);
  });
});

describe('processing a just-imported book', () => {
  // Bug: a device clock behind the server's dated the copy before `added`, so every open took it
  // for the old version and processed the book again.
  it("dates the local copy no earlier than the catalog's added", async () => {
    const added = Date.now() + 3_600_000;

    api.addBook({ id: 9, calibreId: 109, title: '本', format: 'TXT', file: 'a/b.txt', added });
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) =>
      url.startsWith('/calibre/library/') ? new Response('本文') : api.fetch(url, init)
    );
    const server = handler();

    server.startContext({ title: '本' });
    await server.prepareBookForReading();
    expect((await database.getDataByTitle('本'))!.lastBookModified).toBe(added);
  });
});

describe('BaseStorageHandler.findFile', () => {
  // Bug: a leftover older progress or statistics file read instead of the newest.
  it('reads the newest progress/statistics file when an older one was left behind', async () => {
    const { BaseStorageHandler } = await import('./base-handler');
    const files = [
      { name: 'bookdata_1_6_100_1_1.zip' },
      { name: 'progress_1_6_1761000000000_0.2.json' },
      { name: 'progress_1_6_1761000500000_0.4.json' },
      { name: 'statistics_1_6_1761000500000_9.json' },
      { name: 'statistics_1_6_1761000000000_5.json' }
    ];

    expect(BaseStorageHandler.findFile(files, 'progress_')?.name).toContain('_0.4.');
    expect(BaseStorageHandler.findFile(files, 'statistics_')?.name).toContain('_9.');
    expect(BaseStorageHandler.findFile(files, 'bookdata_')).toBe(files[0]);
    expect(BaseStorageHandler.findFile(files, 'cover_')).toBeUndefined();
  });
});
