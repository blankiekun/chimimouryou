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
