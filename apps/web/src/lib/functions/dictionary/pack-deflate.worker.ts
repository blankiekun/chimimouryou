/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Compresses a collection pack's row blocks (collection-store.ts) off the importing worker:
 * CompressionStream runs on its caller's thread at ~50-90 MB/s, slower than the import parses.
 * Not part of upstream.
 */

self.onmessage = async ({
  data: { id, block }
}: MessageEvent<{ id: number; block: Uint8Array }>) => {
  const body = new Response(block).body!.pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = await new Response(body).arrayBuffer();
  self.postMessage({ id, bytes }, { transfer: [bytes] });
};
