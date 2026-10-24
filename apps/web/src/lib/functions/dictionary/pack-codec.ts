/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Deflate-raw for collection packs' row blocks (collection-store.ts), with the platform's
 * Compression/DecompressionStream. Those run on their caller's thread (~0.1-0.3 ms a block,
 * mostly per call), so batches are shared among a few workers (pack-codec.worker.ts). Not part
 * of upstream.
 */

export type Format = 'compress' | 'inflate';

export async function codec(format: Format, block: Uint8Array) {
  const stream =
    format === 'compress'
      ? new CompressionStream('deflate-raw')
      : new DecompressionStream('deflate-raw');
  const body = new Response(block as BlobPart).body!.pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

type Waiting = [(blocks: Uint8Array[]) => void, (error: unknown) => void];

let workers: Worker[] | undefined;
const waiting = new Map<number, Waiting>();
let nextId = 0;

function pool() {
  if (workers) return workers;
  workers = [];
  // jsdom (the tests) has no workers: everything runs here.
  if (typeof Worker === 'undefined') return workers;
  const count = Math.min(8, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
  for (let i = 0; i < count; i++) {
    const worker = new Worker(new URL('./pack-codec.worker.ts', import.meta.url), {
      type: 'module'
    });
    worker.onmessage = ({ data: { id, blocks, error } }) => {
      const [resolve, reject] = waiting.get(id)!;
      waiting.delete(id);
      if (error) reject(new Error(error));
      else resolve(blocks);
    };
    worker.onerror = (event) => {
      for (const [, reject] of waiting.values()) reject(new Error(event.message));
      waiting.clear();
    };
    workers.push(worker);
  }
  return workers;
}

/** Compresses or inflates blocks (their buffers are transferred), in order. */
export async function codecAll(format: Format, blocks: Uint8Array[]): Promise<Uint8Array[]> {
  const all = pool();
  // A few blocks cost less here than a round trip.
  if (!all.length || blocks.length < 4) {
    return Promise.all(blocks.map((block) => codec(format, block)));
  }
  const share = Math.ceil(blocks.length / all.length);
  const parts = await Promise.all(
    all.map((worker, i) => {
      const part = blocks.slice(i * share, (i + 1) * share);
      if (!part.length) return [];
      const id = nextId++;
      return new Promise<Uint8Array[]>((resolve, reject) => {
        waiting.set(id, [resolve, reject]);
        worker.postMessage(
          { id, format, blocks: part },
          part.map((block) => block.buffer)
        );
      });
    })
  );
  return parts.flat();
}
