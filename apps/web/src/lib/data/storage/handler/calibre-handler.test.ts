/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { StorageSourceDefault } from '$lib/data/storage/storage-types';
import { libraryBuilding$, libraryOffline$, librarySignInNeeded } from '$lib/data/store';

const account = vi.hoisted(() => ({ user: null as { id: string; username: string } | null }));

vi.mock('$lib/data/account', () => ({
  accountReady: async () => account.user,
  accountSyncUrl: '/account/sync/',
  currentAccount: () => account.user
}));

// Same order as the app: the factory first, because the handlers import each other.
await import('$lib/data/storage/storage-handler-factory');
const { CalibreStorageHandler } = await import('./calibre-handler');

describe('CalibreStorageHandler.syncFileUrl', () => {
  it('uses the shared folder while signed out', () => {
    account.user = null;

    expect(CalibreStorageHandler.syncFileUrl('本 1', 'annotations.json')).toBe(
      '/calibre/sync/ttu-reader-data/%E6%9C%AC%201/annotations.json'
    );
  });

  it("uses the account's folder while signed in", () => {
    account.user = { id: 'a', username: 'a' };

    expect(CalibreStorageHandler.syncFileUrl('本', 'annotations.json')).toBe(
      '/account/sync/ttu-reader-data/%E6%9C%AC/annotations.json'
    );
  });

  it('sanitizes titles like the folder names', () => {
    account.user = null;

    expect(CalibreStorageHandler.syncFileUrl('A/B?', 'x.json')).not.toContain('/B');
  });
});

describe('CalibreStorageHandler.getBookList', () => {
  it('skips account files of books no longer in the catalog or the shared folder', async () => {
    account.user = { id: 'a', username: 'a' };

    const json = (body: unknown) => new Response(JSON.stringify(body));
    const book = { id: 1, title: '本1', authors: '', series: '', seriesIndex: null, added: 0 };

    vi.stubGlobal('fetch', async (url: string) => {
      if (url === '/calibre/catalog.json') return json({ books: [{ ...book, cover: '' }] });
      if (url === '/calibre/difficulty.json') return json({ books: {} });
      if (url === '/calibre/sync/ttu-reader-data/') return json([]);
      if (url === '/account/sync/ttu-reader-data/') {
        return json([
          { name: '本1', type: 'directory' },
          { name: '古い', type: 'directory' }
        ]);
      }
      if (url.startsWith('/account/sync/ttu-reader-data/')) {
        return json([{ name: 'progress_1_6_100_0.5.json', type: 'file' }]);
      }
      return new Response('', { status: 404 });
    });

    const cards = await new CalibreStorageHandler(window).getBookList();

    expect(cards.map((card) => [card.title, card.progress])).toEqual([['本1', 0.5]]);
    vi.unstubAllGlobals();
  });
});

describe('library sign-in prompt', () => {
  // Offline in a fresh browser, checkSession has no cached user and reads as signed out.
  it('is not shown when the server is out of reach', async () => {
    account.user = null;
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });

    expect(await new CalibreStorageHandler(window).getBookList()).toEqual([]);
    expect(libraryOffline$.getValue()).toBe(true);
    expect(librarySignInNeeded(account.user, libraryOffline$.getValue())).toBe(false);
    vi.unstubAllGlobals();
  });

  it('is shown when the catalog answers 401 to a signed-out reader', async () => {
    account.user = null;
    vi.stubGlobal('fetch', async () => new Response('', { status: 401 }));

    expect(await new CalibreStorageHandler(window).getBookList()).toEqual([]);
    expect(libraryOffline$.getValue()).toBe(false);
    expect(librarySignInNeeded(account.user, libraryOffline$.getValue())).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('first catalog build', () => {
  it('lists no books while catalog.json is missing, then the catalog once it is there', async () => {
    account.user = { id: 'a', username: 'a' };
    let built = false;
    vi.stubGlobal('fetch', async (url: string) =>
      url === '/calibre/catalog.json' && !built
        ? new Response('', { status: 404 })
        : new Response(url === '/calibre/catalog.json' ? '{"books":[]}' : '[]')
    );
    const handler = new CalibreStorageHandler(window);

    expect(await handler.getBookList()).toEqual([]);
    expect(libraryBuilding$.getValue()).toBe(true);

    built = true;
    expect(await handler.getBookList()).toEqual([]);
    expect(libraryBuilding$.getValue()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('CalibreStorageHandler.listAccountTitles', () => {
  it("lists the account's book folders, none while signed out", async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url === '/account/sync/ttu-reader-data/'
        ? new Response(
            JSON.stringify([
              { name: '本1', type: 'directory' },
              { name: 'reading-goals_1_6_0.json', type: 'file' }
            ])
          )
        : new Response('[]')
    );

    account.user = { id: 'a', username: 'a' };
    expect(await new CalibreStorageHandler(window).listAccountTitles()).toEqual(['本1']);

    account.user = null;
    expect(await new CalibreStorageHandler(window).listAccountTitles()).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('CalibreStorageHandler sync errors', () => {
  const unauthorized = async () => new Response('', { status: 401 });

  it('asks a signed-out reader to sign in rather than saying the sign-in expired', async () => {
    account.user = null;
    vi.stubGlobal('fetch', unauthorized);

    await expect(
      new CalibreStorageHandler(window)['davRequest']('/calibre/sync/x', { method: 'MKCOL' })
    ).rejects.toThrow('needs an account');
    vi.unstubAllGlobals();
  });

  it('says the sign-in expired while signed in', async () => {
    account.user = { id: 'a', username: 'a' };
    vi.stubGlobal('fetch', unauthorized);

    await expect(
      new CalibreStorageHandler(window)['davRequest']('/account/sync/x', { method: 'MKCOL' })
    ).rejects.toThrow('has expired');
    vi.unstubAllGlobals();
  });

  it('lists an empty library, not a failure, while signed out where reads need an account', async () => {
    vi.stubGlobal('fetch', unauthorized);

    account.user = null;
    expect(await new CalibreStorageHandler(window).getBookList()).toEqual([]);

    account.user = { id: 'a', username: 'a' };
    await expect(new CalibreStorageHandler(window).getBookList()).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});

describe('CalibreStorageHandler offline', () => {
  it("lists this source's cached books when the server can't be reached", async () => {
    const { database, libraryOffline$ } = await import('$lib/data/store');
    const db = await database.db;
    const book = { styleSheet: '', blobs: {}, coverImage: '', hasThumb: false, sections: [] };
    const id = await db.add('data', {
      ...book,
      title: '手元',
      elementHtml: '<p>本</p>',
      characters: 3,
      storageSource: StorageSourceDefault.CALIBRE_DEFAULT
    } as any);

    await db.add('data', { ...book, title: '他', elementHtml: '<p>x</p>', characters: 1 } as any);
    await db.add('bookmark', { dataId: id, progress: '42.5%', lastBookmarkModified: 7 } as any);
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });

    const cards = await new CalibreStorageHandler(window).getBookList();

    expect(cards.map((card) => [card.title, card.progress, card.lastBookmarkModified])).toEqual([
      ['手元', 0.425, 7]
    ]);
    expect(libraryOffline$.getValue()).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('BaseStorageHandler.findFile', () => {
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

describe('CalibreStorageHandler processing a just-imported book', () => {
  it("dates the book data no earlier than the catalog's added, whatever the device clock", async () => {
    const added = Date.now() + 3_600_000;
    const book = {
      id: 1,
      title: '本',
      authors: '',
      series: '',
      format: 'TXT',
      file: 'a/b.txt',
      added
    };

    account.user = null;
    vi.stubGlobal('fetch', async (url: string) =>
      url === '/calibre/catalog.json'
        ? new Response(JSON.stringify({ books: [book] }))
        : new Response('本文')
    );

    const handler = new CalibreStorageHandler(window);
    const saved: number[] = [];

    handler['saveBook'] = async (data: { lastBookModified: number }) => {
      saved.push(data.lastBookModified);
    };
    handler['saveCover'] = async () => {};
    handler['saveLocally'] = async () => {};
    handler.startContext({ title: '本' } as never);
    await handler['processCalibreBook']();

    expect(saved).toEqual([added]);
    vi.unstubAllGlobals();
  });
});

describe('CalibreStorageHandler.saveProgress', () => {
  it('deletes older leftover progress files after saving, not statistics', async () => {
    const writes: string[] = [];
    const folder = '/calibre/sync/ttu-reader-data/%E6%9C%AC/';

    account.user = null;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init?.method) {
        writes.push(`${init.method} ${url.slice(folder.length)}`);
        return new Response('', { status: 201 });
      }
      return new Response(
        JSON.stringify(
          url === folder
            ? [
                'progress_1_6_100_0.1.json',
                'progress_1_6_300_0.3.json',
                'statistics_1_6_100_1.json',
                'statistics_1_6_300_1.json'
              ].map((name) => ({ name, type: 'file' }))
            : []
        )
      );
    });

    const handler = new CalibreStorageHandler(window);

    // Uploads go through XMLHttpRequest.
    handler['request'] = async (url: string, options: RequestInit = {}) => {
      writes.push(`${options.method} ${url.slice(folder.length)}`);
    };
    handler.startContext({ title: '本' } as never);
    await handler.saveProgress({ dataId: 1, lastBookmarkModified: 400, progress: 0.4 } as never);

    expect(writes.sort()).toEqual([
      'DELETE progress_1_6_100_0.1.json',
      'DELETE progress_1_6_300_0.3.json',
      'PUT progress_1_6_400_0.4.json'
    ]);
    vi.unstubAllGlobals();
  });
});

describe('CalibreStorageHandler while an expired account still owns the data', () => {
  it("keeps that reader's files out of the shared folder", async () => {
    const urls: string[] = [];

    account.user = null;
    window.localStorage.setItem('readerDataOwner', 'a');
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      urls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/calibre/catalog.json') {
        return new Response(
          JSON.stringify({
            books: [{ id: 1, title: '本1', authors: '', series: '', seriesIndex: null, added: 0 }]
          })
        );
      }
      if (url === '/calibre/difficulty.json') return new Response('{"books":{}}');
      if (url === '/calibre/sync/ttu-reader-data/') {
        return new Response(JSON.stringify([{ name: '本1', type: 'directory' }]));
      }
      if (url.startsWith('/calibre/sync/ttu-reader-data/')) {
        return new Response(JSON.stringify([{ name: 'progress_1_6_100_0.5.json', type: 'file' }]));
      }
      return new Response('', { status: 404 });
    });

    await expect(
      CalibreStorageHandler.writeSyncFile('annotations.json', '{}', { title: '本1' })
    ).rejects.toThrow('has expired');

    const handler = new CalibreStorageHandler(window);
    const cards = await handler.getBookList();

    expect(cards.map((card) => card.progress ?? 0)).toEqual([0]);
    await expect(
      handler['upload']('/calibre/sync/x/', 'progress_1_6_200_0.6.json', [], undefined, '{}')
    ).rejects.toThrow('has expired');
    expect(urls.filter((url) => !url.startsWith('GET'))).toEqual([]);

    window.localStorage.removeItem('readerDataOwner');
    vi.unstubAllGlobals();
  });
});
