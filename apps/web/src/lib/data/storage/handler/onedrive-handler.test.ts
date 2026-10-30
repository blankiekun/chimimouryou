/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

const { OneDriveStorageHandler } = await import('./onedrive-handler');

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
