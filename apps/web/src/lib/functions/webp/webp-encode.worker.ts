/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * WebP for browsers whose canvas can't encode it (Safari): libwebp in wasm (@jsquash/webp), in a
 * worker because the page's CSP doesn't allow compiling wasm. Tries each quality until one fits.
 * Not part of upstream.
 */

import encode from '@jsquash/webp/encode';

export interface WebpRequest {
  image: ImageData;
  qualities: number[];
  maxBytes: number;
}

self.onmessage = async ({ data }: MessageEvent<WebpRequest>) => {
  try {
    for (const quality of data.qualities) {
      const buffer = await encode(data.image, { quality: quality * 100 });

      if (buffer.byteLength <= data.maxBytes) {
        self.postMessage(buffer, { transfer: [buffer] });
        return;
      }
    }
  } catch {
    // falls through to null: the caller treats it like an image that doesn't fit
  }
  self.postMessage(null);
};
