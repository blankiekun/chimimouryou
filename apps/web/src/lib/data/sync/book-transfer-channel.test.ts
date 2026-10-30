/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  HIGH_WATER,
  TransferError,
  confirm,
  packBook,
  receiveBlob,
  sendBlob,
  unpackBook,
  type TransferChannel
} from '$lib/data/sync/book-transfer-channel';
import { mangaElementHtml } from '$lib/data/manga/manga';

// jsdom's Blob has no arrayBuffer() or text(); browsers do.
function read<T>(blob: Blob, how: 'readAsArrayBuffer' | 'readAsText') {
  return new Promise<T>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result as T);
    reader.onerror = () => reject(reader.error);
    reader[how](blob);
  });
}
Blob.prototype.arrayBuffer ??= function (this: Blob) {
  return read<ArrayBuffer>(this, 'readAsArrayBuffer');
};
Blob.prototype.text ??= function (this: Blob) {
  return read<string>(this, 'readAsText');
};

type Listener = (event?: { data: unknown }) => void;

/** Two connected fake data channels: what one sends arrives at the other, asynchronously. */
function channelPair(tamper?: (bytes: Uint8Array) => void) {
  const make = () => {
    const listeners: Record<string, Listener[]> = {};
    const channel = {
      readyState: 'open',
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      binaryType: 'blob',
      sent: 0,
      peer: undefined as unknown as {
        readyState: string;
        emit(type: string, event?: { data: unknown }): void;
      },
      send(data: string | ArrayBufferView) {
        const payload = typeof data === 'string' ? data : (data as Uint8Array).slice().buffer;

        if (typeof payload !== 'string') {
          channel.sent += 1;
          if (channel.sent === 2) tamper?.(new Uint8Array(payload));
          // Backpressure: queued bytes drain on the next tick.
          channel.bufferedAmount += payload.byteLength;
        }
        setTimeout(() => {
          if (typeof payload !== 'string') {
            channel.bufferedAmount -= payload.byteLength;
            if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) {
              channel.emit('bufferedamountlow');
            }
          }
          channel.peer.emit('message', { data: payload });
        });
      },
      addEventListener(type: string, listener: Listener, options?: { once: boolean }) {
        const wrapped: Listener = options?.once
          ? (event) => {
              listeners[type] = listeners[type].filter((one) => one !== wrapped);
              listener(event);
            }
          : listener;

        (listeners[type] ??= []).push(wrapped);
      },
      emit(type: string, event?: { data: unknown }) {
        [...(listeners[type] ?? [])].forEach((listener) => listener(event));
      },
      close() {
        channel.readyState = 'closed';
        channel.peer.readyState = 'closed';
        setTimeout(() => {
          channel.emit('close');
          channel.peer.emit('close');
        });
      }
    };

    return channel;
  };
  const a = make();
  const b = make();

  a.peer = b;
  b.peer = a;
  return [a, b] as const;
}

const as = (channel: unknown) => channel as TransferChannel;

const book = {
  title: '坊っちゃん',
  styleSheet: 'p { margin: 0 }',
  elementHtml:
    '<p onclick="alert(1)">親譲りの無鉄砲で<img src="ttu:a.png"></p><script>x()</script>',
  blobs: { 'a.png': new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) },
  coverImage: new Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' }),
  hasThumb: true,
  characters: 8,
  sections: [],
  lastBookModified: 1,
  lastBookOpen: 2
};

describe('book transfer channel', () => {
  it('packs and unpacks a book, sanitizing its HTML', async () => {
    const unpacked = await unpackBook(packBook(book), 5);

    expect(unpacked.title).toBe('坊っちゃん');
    expect(unpacked.elementHtml).toBe('<p>親譲りの無鉄砲で<img src="ttu:a.png"></p>');
    expect(unpacked.characters).toBe(8);
    expect(unpacked.lastBookModified).toBe(5);
    expect([...new Uint8Array(await unpacked.blobs['a.png'].arrayBuffer())]).toEqual([1, 2, 3]);
    expect(unpacked.blobs['a.png'].type).toBe('image/png');
    expect([...new Uint8Array(await unpacked.coverImage!.arrayBuffer())]).toEqual([9, 9]);
  });

  it('carries the series and drops malformed ones', async () => {
    expect(
      await unpackBook(packBook({ ...book, series: ' 坊っちゃん ', seriesIndex: 2 }))
    ).toMatchObject({ series: '坊っちゃん', seriesIndex: 2 });

    const forged = await unpackBook(
      packBook({ ...book, series: 3, seriesIndex: '2' } as unknown as typeof book)
    );

    expect(forged.series).toBeUndefined();
    expect(forged.seriesIndex).toBeUndefined();
  });

  it('keeps a manga record as it is and refuses broken packs and visual novels', async () => {
    const manga = { ...book, elementHtml: mangaElementHtml(['a & b.png']), coverImage: undefined };
    const unpacked = await unpackBook(packBook(manga));

    expect(unpacked.elementHtml).toBe(manga.elementHtml);
    expect(unpacked.coverImage).toBeUndefined();

    const packed = packBook(book);

    await expect(unpackBook(packed.slice(0, packed.size - 1))).rejects.toThrow(TransferError);
    await expect(unpackBook(new Blob(['nope']))).rejects.toThrow(TransferError);
    await expect(unpackBook(packBook({ ...book, elementHtml: '<!--ttu-vn-->{}' }))).rejects.toThrow(
      TransferError
    );
  });

  it('sends in chunks with backpressure; the receiver checks size and SHA-256, then confirms', async () => {
    const [sender, receiver] = channelPair();
    const data = new Blob([new Uint8Array(300_000).map((_, i) => i % 251)]);
    const sent: number[] = [];
    const received: number[] = [];
    const arrived = receiveBlob(as(receiver), data.size, (bytes) => received.push(bytes));
    const done = sendBlob(as(sender), data, (bytes) => sent.push(bytes), 16_384);
    const blob = await arrived;

    expect(sender.sent).toBe(Math.ceil(data.size / 16_384));
    expect(sent.at(-1)).toBe(data.size);
    expect(received.at(-1)).toBe(data.size);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array(await data.arrayBuffer())
    );

    confirm(as(receiver));
    await expect(done).resolves.toBeUndefined();
  });

  it('refuses a damaged copy and tells the sender', async () => {
    const [sender, receiver] = channelPair((bytes) => (bytes[0] ^= 1));
    const data = new Blob([new Uint8Array(50_000)]);
    const arrived = receiveBlob(as(receiver), data.size, () => {});
    const done = sendBlob(as(sender), data, () => {}, 16_384);

    await expect(arrived).rejects.toMatchObject({ reason: 'checksum' });
    await expect(done).rejects.toMatchObject({ reason: 'checksum' });
  });

  it('refuses more bytes than announced', async () => {
    const [sender, receiver] = channelPair();
    const arrived = receiveBlob(as(receiver), 10, () => {});
    const done = sendBlob(as(sender), new Blob([new Uint8Array(100)]), () => {});

    await expect(arrived).rejects.toMatchObject({ reason: 'size' });
    await expect(done).rejects.toMatchObject({ reason: 'size' });
  });

  it('fails both sides when the channel closes', async () => {
    const [sender, receiver] = channelPair();
    const arrived = receiveBlob(as(receiver), 1_000_000, () => {});
    const done = sendBlob(as(sender), new Blob([new Uint8Array(1_000_000)]), () => {}, 16_384);

    receiver.close();
    await expect(arrived).rejects.toMatchObject({ reason: 'closed' });
    await expect(done).rejects.toMatchObject({ reason: 'closed' });
  });

  it('stops queueing past the high-water mark until the channel drains', async () => {
    // Fake timers also drive jsdom's FileReader (setImmediate), so a sender that kept reading
    // would send within the advance below, however slow the machine.
    vi.useFakeTimers();
    const chunk = 1024 * 1024;
    const lows: (() => void)[] = [];
    const messages: ((event: { data: unknown }) => void)[] = [];
    let most = 0;
    let bytes = 0;
    // Never drains by itself: only when the test says so.
    const channel = {
      readyState: 'open',
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      binaryType: 'arraybuffer',
      send(data: string | Uint8Array) {
        if (typeof data === 'string') {
          setTimeout(() => messages.forEach((listener) => listener({ data: '{"t":"done"}' })));
          return;
        }
        channel.bufferedAmount += data.byteLength;
        bytes += data.byteLength;
        most = Math.max(most, channel.bufferedAmount);
      },
      addEventListener(type: string, listener: () => void) {
        if (type === 'bufferedamountlow') lows.push(listener);
        if (type === 'message') messages.push(listener);
      }
    };
    const size = 10 * chunk;
    const done = sendBlob(as(channel), new Blob([new Uint8Array(size)]), () => {}, chunk);

    let waits = 0;

    while (bytes < size) {
      await vi.waitFor(() => expect(lows.length === 1 || bytes === size).toBe(true));
      if (!lows.length) break;
      // The sender is waiting: nothing more is queued past the mark until it drains.
      await vi.advanceTimersByTimeAsync(20);
      expect(channel.bufferedAmount).toBe(HIGH_WATER + chunk);
      waits += 1;
      channel.bufferedAmount = 0;
      lows.shift()!();
    }
    await expect(done).resolves.toBeUndefined();
    expect(channel.bufferedAmountLowThreshold).toBe(HIGH_WATER / 4);
    expect(most).toBe(HIGH_WATER + chunk);
    expect(waits).toBe(1);
    vi.useRealTimers();
  });
});
