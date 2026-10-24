/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Compresses and inflates a collection pack's row blocks (collection-store.ts) for the dictionary
 * worker: Compression/DecompressionStream run on their caller's thread, so a few of these share
 * an import's blocks and a lookup's. Not part of upstream.
 */

import { codec } from './pack-codec';

self.onmessage = async ({ data: { id, format, blocks } }) => {
  // One at a time: the streams share this thread, and interleaving them is slower.
  const results: Uint8Array[] = [];
  try {
    for (const block of blocks) results.push(await codec(format, block));
  } catch (error) {
    self.postMessage({ id, error: String(error) });
    return;
  }
  self.postMessage({ id, blocks: results }, { transfer: results.map((block) => block.buffer) });
};
