/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWorker, WORKER_SILENCE_MS } from './analysis-tools';

/** A worker that never answers unless the test sends a message for it */
function silentWorker() {
  return {
    onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    onerror: undefined as unknown,
    postMessage: vi.fn(),
    terminate: vi.fn()
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the analysis workers watchdog', () => {
  it('stops a worker that never answers', async () => {
    vi.useFakeTimers();

    const worker = silentWorker();
    const result = runWorker(worker as unknown as Worker, {}, () => undefined);
    const failed = expect(result).rejects.toThrow('stopped answering');

    await vi.advanceTimersByTimeAsync(WORKER_SILENCE_MS);
    await failed;
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('waits while the worker keeps sending progress', async () => {
    vi.useFakeTimers();

    const worker = silentWorker();
    const result = runWorker<{ type: string }>(worker as unknown as Worker, {}, (message) =>
      message.type === 'done' ? message : undefined
    );

    for (let step = 0; step < 3; step += 1) {
      await vi.advanceTimersByTimeAsync(WORKER_SILENCE_MS - 1000);
      worker.onmessage!({ data: { type: 'alive' } });
    }

    worker.onmessage!({ data: { type: 'done' } });
    await expect(result).resolves.toEqual({ type: 'done' });
    expect(worker.terminate).toHaveBeenCalled();
  });
});
