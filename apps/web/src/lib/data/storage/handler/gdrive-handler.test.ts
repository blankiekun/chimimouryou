/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

const { GDriveStorageHandler } = await import('./gdrive-handler');

const MiB = 1024 * 1024;

function full(status: number, headers: Record<string, string> = {}, response: unknown = null) {
  return { status, response, header: (name: string) => headers[name] ?? null };
}

describe('GDriveStorageHandler.upload', () => {
  it('sends large files as a resumable upload in chunks, resuming after a short 308', async () => {
    const handler = new GDriveStorageHandler(window);
    const calls: { url: string; options: any }[] = [];
    let chunk = 0;

    const request = vi.fn(async (url: string, options: any) => {
      calls.push({ url, options });

      if (url.includes('uploadType=resumable')) return full(200, { Location: 'https://session' });

      chunk += 1;

      // The second chunk only half arrives.
      if (chunk === 1) return full(308, { Range: `bytes=0-${8 * MiB - 1}` });
      if (chunk === 2) return full(308, { Range: `bytes=0-${12 * MiB - 1}` });

      return full(200, {}, { id: 'f1', name: 'bookdata_x.zip' });
    });

    (handler as any).request = request;

    const response = await (handler as any).upload(
      'folder',
      'bookdata_x.zip',
      [],
      undefined,
      new Blob([new Uint8Array(20 * MiB)], { type: 'application/zip' })
    );

    expect(response).toEqual({ id: 'f1', name: 'bookdata_x.zip' });
    expect(calls[0].options.method).toBe('POST');
    expect(JSON.parse(calls[0].options.body)).toEqual({
      name: 'bookdata_x.zip',
      parents: ['folder']
    });
    expect(calls[0].options.headers['X-Upload-Content-Length']).toBe(`${20 * MiB}`);

    const ranges = calls.slice(1).map((call) => call.options.headers['Content-Range']);

    expect(ranges).toEqual([
      `bytes 0-${8 * MiB - 1}/${20 * MiB}`,
      `bytes ${8 * MiB}-${16 * MiB - 1}/${20 * MiB}`,
      `bytes ${12 * MiB}-${20 * MiB - 1}/${20 * MiB}`
    ]);
    expect(calls.slice(1).every((call) => call.url === 'https://session')).toBe(true);
    expect(calls[3].options.body.size).toBe(8 * MiB);
  });

  it('keeps multipart for small files', async () => {
    const handler = new GDriveStorageHandler(window);
    const request = vi.fn(async () => ({ id: 'f2', name: 'progress.json' }));

    (handler as any).request = request;

    await (handler as any).upload('folder', 'progress.json', [], undefined, new Blob(['{}']));

    expect(request).toHaveBeenCalledTimes(1);
    expect((request.mock.calls[0] as any[])[0]).toContain('uploadType=multipart');
  });
});

describe('GDriveStorageHandler listings', () => {
  // Bug: a folder's listing stopped at Drive's first page, losing the newest progress file.
  it("reads a book folder's second page", async () => {
    const handler = new GDriveStorageHandler(window) as any;

    // Like Drive: only the requested fields come back, the page token included.
    handler.request = vi.fn(async (url: string) => {
      const params = new URL(url).searchParams;
      const paged = params.get('fields')!.includes('nextPageToken');

      if (params.get('pageToken') === 'page2') {
        return { files: [{ id: 'p2', name: 'progress_6_6_2000_0.5.json', parents: ['folder'] }] };
      }

      return {
        files: [{ id: 'b1', name: 'bookdata_6_6_1_1_1.zip', parents: ['folder'] }],
        ...(paged ? { nextPageToken: 'page2' } : {})
      };
    });
    handler.currentContext = { title: '本' };

    const files = await handler.getExternalFiles('folder');

    expect(files.map((file: { id: string }) => file.id)).toEqual(['b1', 'p2']);
  });
});

describe('GDriveStorageHandler.deleteBookData', () => {
  // Bug: the book came back from the folder a second device had made for it.
  it('deletes every folder of a book that has two', async () => {
    const handler = new GDriveStorageHandler(window) as any;
    const executeDelete = vi.fn(async () => {});

    Object.assign(handler, { storageSourceName: 'two-folders', rootId: 'root', executeDelete });
    handler.request = vi.fn(async (url: string) => {
      const query = new URL(url).searchParams.get('q')!;

      return query.includes("'root' in parents")
        ? {
            files: [
              { id: 'old', name: '本' },
              { id: 'new', name: '本' }
            ]
          }
        : { files: [{ id: 'b1', name: 'bookdata_6_6_1_1_1.zip', parents: ['old'] }] };
    });

    await handler.getBookList();
    await handler.deleteBookData(['本'], new AbortController().signal, false);

    expect(executeDelete.mock.calls.map(([id]: any) => id).sort()).toEqual(['new', 'old']);
  });

  it('also deletes the browser copy of a game kept on this device', async () => {
    const { database } = await import('$lib/data/store');
    const { vnElementHtml } = await import('$lib/data/vn/vn');
    const db = await database.db;
    const book = { styleSheet: '', blobs: {}, coverImage: '', hasThumb: false, sections: [] };
    const game = { ...book, elementHtml: vnElementHtml({ encoding: 'sjis', files: [] } as any) };

    await db.add('data', { ...game, title: 'ゲーム', storageSource: 'drive' } as any);
    await db.add('data', { ...game, title: '他所', storageSource: 'other' } as any);
    await db.add('data', {
      ...book,
      title: '本',
      elementHtml: '<p>x</p>',
      storageSource: 'drive'
    } as any);

    const handler = new GDriveStorageHandler(window);
    const executeDelete = vi.fn(async () => {});

    Object.assign(handler as any, {
      storageSourceName: 'drive',
      rootId: 'root',
      executeDelete,
      dataListFetched: true
    });
    await (handler as any).addDeviceVns();

    const { error, deleted } = await handler.deleteBookData(
      ['ゲーム', '他所', '本'],
      new AbortController().signal,
      false
    );

    expect(error).toBe('');
    expect(deleted).toHaveLength(1);
    expect(executeDelete).not.toHaveBeenCalled();
    expect(await database.getDataByTitle('ゲーム')).toBeUndefined();
    // Another source's game and a cached book stay.
    expect(await database.getDataByTitle('他所')).toBeDefined();
    expect(await database.getDataByTitle('本')).toBeDefined();
  });
});

describe('GDriveStorageHandler.sendProgressNow', () => {
  const place = { dataId: 1, progress: 0.5, lastBookmarkModified: 2000 } as any;
  const oldName = 'progress_6_6_1000_0.25.json';
  // jsdom's Blob has no text().
  const read = (blob: Blob) =>
    new Promise<string>((resolve) => {
      const reader = new FileReader();

      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blob);
    });

  async function setUp(
    files: { id: string; name: string }[] | null = [{ id: 'p1', name: oldName }],
    expiration = Date.now() + 60000
  ) {
    const { storageOAuthTokens } = await import('$lib/data/storage/storage-oauth-manager');
    const handler = new GDriveStorageHandler(window) as any;

    storageOAuthTokens.set('drive', { accessToken: 'live', scope: 'x', expiration });
    Object.assign(handler, { storageSourceName: 'drive', rootId: 'root', dataListFetched: true });
    handler.currentContext = { title: '本' };
    handler.titleToId.set('本', 'folder');
    if (files) handler.titleToFiles.set('本', files);
    // The normal sync's network step: XMLHttpRequest, which jsdom can't take to Drive.
    handler.request = vi.fn(async (_url: string, options: any) => ({
      id: 'p1',
      name: JSON.parse(await read(options.body.get('resource'))).name
    }));

    return handler;
  }

  // Bugs: other devices read a stale name, or the request dies with the page.
  it('renames the file along with its content, in one request that outlives the page', async () => {
    const handler = await setUp();
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}'));

    vi.stubGlobal('fetch', fetch);
    await handler.sendProgressNow('本', place);
    vi.unstubAllGlobals();

    const [url, init] = fetch.mock.calls[0];
    const body = init.body as FormData;

    expect(url).toBe('https://www.googleapis.com/upload/drive/v3/files/p1?uploadType=multipart');
    expect(init).toMatchObject({ method: 'PATCH', keepalive: true });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer live');

    const { name } = JSON.parse(await read(body.get('resource') as Blob));

    expect(name).toMatch(/^progress_\d+_\d+_2000_0\.5\.json$/);
    expect(JSON.parse(body.get('file') as string)).toEqual(place);
    // Bug: the normal sync sends it all over again, or the list still shows the old place.
    expect(await handler.isProgressPresentAndUpToDate(name)).toBe(true);
    expect(handler.titleToBookCard.get('本')).toMatchObject({
      progress: 0.5,
      lastBookmarkModified: 2000
    });
  });

  // Bug: the next sync, seeing a stale list, POSTs a second progress_ file beside the first.
  it('leaves one progress file: the sync after it updates the same file', async () => {
    const handler = await setUp();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}'))
    );
    await handler.sendProgressNow('本', place);
    vi.unstubAllGlobals();
    await handler.saveProgress({ ...place, lastBookmarkModified: 3000 });

    expect(handler.request).toHaveBeenCalledTimes(1);
    expect(handler.request.mock.calls[0][0]).toContain('/files/p1?');
    expect(handler.request.mock.calls[0][1].method).toBe('PATCH');
    expect(handler.titleToFiles.get('本')).toHaveLength(1);
  });

  // Bug: a failed send marks the place as saved, and the normal sync never sends it.
  it.each([
    ['a 503', async () => new Response('', { status: 503 })],
    ['no network', async () => Promise.reject(new TypeError('Failed to fetch'))]
  ])('leaves the place to the normal sync after %s', async (_name, answer) => {
    const handler = await setUp();

    vi.stubGlobal('fetch', vi.fn(answer));
    await expect(handler.sendProgressNow('本', place)).resolves.toBeUndefined();
    vi.unstubAllGlobals();

    expect(handler.titleToFiles.get('本')[0].name).toBe(oldName);
    expect(await handler.isProgressPresentAndUpToDate('progress_6_6_2000_0.5.json')).toBe(false);
  });

  // Bugs: a lookup or token renewal the phone kills halfway; a duplicate file from a blind create;
  // a stale tab overwriting the newer place this list already knows about.
  it.each([
    ['the file list is not known', null, 60000],
    ['the book has no progress file yet', [{ id: 'b1', name: 'bookdata_6_6_1_1_1.zip' }], 60000],
    ['the token has expired', [{ id: 'p1', name: oldName }], -1000],
    [
      'the file already holds a newer place',
      [{ id: 'p1', name: 'progress_6_6_9000_0.9.json' }],
      60000
    ]
  ])('sends nothing when %s', async (_name, files, expiresIn) => {
    const handler = await setUp(files, Date.now() + expiresIn);
    const fetch = vi.fn(async () => new Response('{}'));

    vi.stubGlobal('fetch', fetch);
    await handler.sendProgressNow('本', place);
    vi.unstubAllGlobals();

    expect(fetch).not.toHaveBeenCalled();
    expect(handler.request).not.toHaveBeenCalled();
  });
});
