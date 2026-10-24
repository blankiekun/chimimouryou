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
  const results = await Promise.all(blocks.map((block: Uint8Array) => codec(format, block)));
  self.postMessage(
    { id, blocks: results },
    { transfer: results.map((block: Uint8Array) => block.buffer) }
  );
};
