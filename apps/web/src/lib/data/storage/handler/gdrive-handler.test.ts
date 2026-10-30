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

describe('GDriveStorageHandler.deleteBookData', () => {
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
