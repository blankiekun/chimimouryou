/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The worker is the boundary here (a real one needs models and a browser). Ways this can fail:
// - the worker's file is gone (redeploy): reads wait forever, or the next read still hangs;
// - a worker that never answers blocks every later read;
// - one bad read turns screen text off, or lasting failures stay silent, or a hooked game gets a
//   notice about a feature it doesn't rely on;
// - clicks faster than reads pile up in the worker, or leak the replaced frames.
class FakeWorker {
  static all: FakeWorker[] = [];
  posted: any[] = [];
  terminated = false;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;

  constructor() {
    FakeWorker.all.push(this);
  }

  postMessage(data: unknown) {
    this.posted.push(data);
  }

  terminate() {
    this.terminated = true;
  }

  answer(reply: object) {
    this.onmessage?.({ data: { id: this.posted.at(-1).id, ...reply } });
  }
}

const frame = () => ({ close: vi.fn() }) as unknown as ImageBitmap;
const flush = () => vi.advanceTimersByTimeAsync(0);
const line = {
  text: 'あ',
  tag: 0,
  box: [0, 0, 10, 10],
  chars: [{ text: 'あ', x0: 0, x1: 10 }]
};

describe('readVnScreen', () => {
  let ocr: typeof import('./vn-ocr');
  const last = () => FakeWorker.all.at(-1)!;

  beforeEach(async () => {
    vi.useFakeTimers();
    FakeWorker.all = [];
    vi.stubGlobal('Worker', FakeWorker);
    vi.resetModules();
    ocr = await import('./vn-ocr');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a worker file that fails to load ends the read, and the next read starts a new worker', async () => {
    const read = ocr.readVnScreen(frame());

    await flush();
    last().onerror?.({ message: '' });
    await expect(read).resolves.toBeUndefined();
    expect(last().terminated).toBe(true);

    const next = ocr.readVnScreen(frame());

    await flush();
    expect(FakeWorker.all).toHaveLength(2);
    last().answer({ lines: [line], ms: 1 });
    await expect(next).resolves.toMatchObject({ text: 'あ' });
  });

  it('a worker that never answers ends the read and turns it off with the reason', async () => {
    const read = ocr.readVnScreen(frame());

    await vi.advanceTimersByTimeAsync(4.9 * 60_000);
    expect(ocr.screenTextOff$.getValue()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0.2 * 60_000);
    await expect(read).resolves.toBeUndefined();
    expect(ocr.screenTextOff$.getValue()).toBeTruthy();
    expect(last().terminated).toBe(true);
  });

  it('one failed read leaves it on; three in a row turn it off and say why', async () => {
    const fail = async (message: string) => {
      const read = ocr.readVnScreen(frame());

      await flush();
      last().answer({ error: message });
      await read;
    };

    await fail('blip');
    await fail('blip');
    const good = ocr.readVnScreen(frame());

    await flush();
    last().answer({ lines: [line], ms: 1 });
    await good;
    await fail('one');
    await fail('two');
    expect(ocr.screenTextOff$.getValue()).toBeUndefined();
    await fail('models 404');
    expect(ocr.screenTextOff$.getValue()).toContain('models 404');

    const posted = last().posted.length;
    const after = frame();

    await expect(ocr.readVnScreen(after)).resolves.toBeUndefined();
    expect(after.close).toHaveBeenCalled();
    expect(last().posted).toHaveLength(posted);
  });

  it('a game placing hooked lines stays quiet until it reads its text from the screen', async () => {
    for (const error of ['a', 'b', 'reason']) {
      const read = ocr.readVnScreen(frame(), 'hooked');

      await flush();
      last().answer({ error });
      await read;
    }
    expect(ocr.screenTextOff$.getValue()).toBeUndefined();
    await ocr.readVnScreen(frame());
    expect(ocr.screenTextOff$.getValue()).toContain('reason');
  });

  it('keeps one read in flight and only the newest waiting, closing the replaced frames', async () => {
    const [first, second, third] = [frame(), frame(), frame()];
    const a = ocr.readVnScreen(first);
    const b = ocr.readVnScreen(second);
    const c = ocr.readVnScreen(third);

    await flush();
    expect(last().posted.map((data) => data.frame)).toEqual([first]);
    expect(second.close).toHaveBeenCalled();
    expect(third.close).not.toHaveBeenCalled();
    await expect(b).resolves.toBeUndefined();

    last().answer({ lines: [line], ms: 1 });
    await a;
    await flush();
    expect(last().posted.map((data) => data.frame)).toEqual([first, third]);
    last().answer({ lines: [line], ms: 2 });
    await expect(c).resolves.toMatchObject({ ms: 2 });
  });

  it('a read whose result can not be used does not block the reads after it', async () => {
    const bad = ocr.readVnScreen(frame());
    const rejected = expect(bad).rejects.toThrow();

    await flush();
    last().answer({ lines: [{ ...line, chars: [] }], ms: 1 });
    await rejected;

    const next = ocr.readVnScreen(frame());

    await flush();
    last().answer({ lines: [line], ms: 1 });
    await expect(next).resolves.toMatchObject({ text: 'あ' });
  });

  it('closing the player drops the waiting frame and ends its read', async () => {
    const waitingFrame = frame();
    const a = ocr.readVnScreen(frame());
    const b = ocr.readVnScreen(waitingFrame);

    await flush();
    ocr.stopVnOcr();
    await expect(a).resolves.toBeUndefined();
    await expect(b).resolves.toBeUndefined();
    expect(waitingFrame.close).toHaveBeenCalled();
  });
});
