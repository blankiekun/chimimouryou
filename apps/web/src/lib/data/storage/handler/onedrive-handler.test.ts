/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storageOAuthTokens } from '$lib/data/storage/storage-oauth-manager';
import { OneDriveStorageHandler } from '$lib/data/storage/handler/onedrive-handler';

// The ways sending on hide could lose or corrupt a place: two requests where the page dies between
// them, a rename that lands without its content, a partly failed batch taken for sent (the normal
// sync would then skip the file), and a send of an older place over a newer one.
describe('OneDriveStorageHandler.sendProgressNow', () => {
  const place = { dataId: 1, progress: 0.5, lastBookmarkModified: 2000 } as any;
  const oldName = 'progress_6_6_1000_0.25.json';

  function setUp(name = oldName) {
    const handler = new OneDriveStorageHandler(window) as any;

    storageOAuthTokens.set('onedrive', {
      accessToken: 'live',
      scope: 'x',
      expiration: Date.now() + 60000
    });
    handler.storageSourceName = 'onedrive';
    handler.titleToFiles.set('本', [{ id: 'p1', name }]);

    return { handler, file: handler.titleToFiles.get('本')[0] };
  }

  function graph(statuses: Record<string, number>) {
    const fetchStub = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Response(
          JSON.stringify({
            responses: JSON.parse(init.body as string).requests.map(({ id }: any) => ({
              id,
              status: statuses[id]
            }))
          })
        )
    );

    vi.stubGlobal('fetch', fetchStub);

    return fetchStub;
  }

  beforeEach(() => storageOAuthTokens.clear());

  it('sends content then name in one request that outlives the page', async () => {
    const { handler, file } = setUp();
    const fetchStub = graph({ content: 200, name: 200 });

    await handler.sendProgressNow('本', place);

    expect(fetchStub).toHaveBeenCalledTimes(1);

    const [url, init] = fetchStub.mock.calls[0];
    const [content, rename] = JSON.parse(init.body as string).requests;

    expect(url).toMatch(/\$batch$/);
    expect(init.keepalive).toBe(true);
    expect(content.url).toBe('/me/drive/items/p1/content');
    expect(content.body.lastBookmarkModified).toBe(2000);
    expect(rename.dependsOn).toEqual([content.id]);
    expect(file.name).toBe(rename.body.name);
    expect(file.name).toContain('_2000_');
  });

  it('keeps the old name when the batch answers 200 but a request failed', async () => {
    const { handler, file } = setUp();

    graph({ content: 200, name: 423 });

    await expect(handler.sendProgressNow('本', place)).resolves.toBeUndefined();
    expect(file.name).toBe(oldName);
  });

  it('never sends a place older than the file holds', async () => {
    const { handler } = setUp('progress_6_6_3000_0.25.json');
    const fetchStub = graph({ content: 200, name: 200 });

    await handler.sendProgressNow('本', place);

    expect(fetchStub).not.toHaveBeenCalled();
  });
});

const MiB = 1024 * 1024;

function full(status: number, response: unknown) {
  return { status, response, header: () => null };
}

describe('OneDriveStorageHandler upload sessions', () => {
  it('sends files over 60 MiB in 10 MiB slices, resuming from nextExpectedRanges', async () => {
    const handler = new OneDriveStorageHandler(window);
    const size = 64 * MiB;
    const ranges: string[] = [];
    let call = 0;

    (handler as any).request = vi.fn(async (_url: string, options: any) => {
      call += 1;
      ranges.push(options.headers?.['Content-Range'] ?? 'status');

      if (call === 2) throw new Error('network');
      // The status after the failure: only half of the second slice arrived.
      if (call === 3) return full(200, { nextExpectedRanges: [`${15 * MiB}-`] });

      const [, end] = options.headers['Content-Range'].match(/-(\d+)\//)!;

      return Number(end) + 1 === size
        ? full(201, { id: 'f1', name: 'bookdata_x.zip' })
        : full(202, { nextExpectedRanges: [`${Number(end) + 1}-`] });
    });
    vi.useFakeTimers();

    const upload = (handler as any).uploadToSession(
      'https://session',
      new Blob([new Uint8Array(size)]),
      0.8
    );

    await vi.runAllTimersAsync();
    vi.useRealTimers();

    expect(await upload).toEqual({ id: 'f1', name: 'bookdata_x.zip' });
    expect(ranges).toEqual([
      `bytes 0-${10 * MiB - 1}/${size}`,
      `bytes ${10 * MiB}-${20 * MiB - 1}/${size}`,
      'status',
      `bytes ${15 * MiB}-${25 * MiB - 1}/${size}`,
      `bytes ${25 * MiB}-${35 * MiB - 1}/${size}`,
      `bytes ${35 * MiB}-${45 * MiB - 1}/${size}`,
      `bytes ${45 * MiB}-${55 * MiB - 1}/${size}`,
      `bytes ${55 * MiB}-${size - 1}/${size}`
    ]);
  });

  it('sends smaller files in one request', async () => {
    const handler = new OneDriveStorageHandler(window);
    const request = vi.fn(async () => full(201, { id: 'f2', name: 'p.json' }));

    (handler as any).request = request;

    expect(await (handler as any).uploadToSession('https://s', new Blob(['{}']), 1)).toEqual({
      id: 'f2',
      name: 'p.json'
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect((request.mock.calls[0] as any[])[1].headers['Content-Range']).toBe('bytes 0-1/2');
  });
});
