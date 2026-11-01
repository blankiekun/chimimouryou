/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * A cache of blob: URLs that keeps the last `max` used and revokes the rest, so a long scroll
 * through thousands of covers doesn't keep every image in memory. Not part of upstream.
 */
export function blobUrlCache(max: number) {
  const urls = new Map<string, Promise<string>>();

  return (key: string, load: () => Promise<Blob>) => {
    const cached = urls.get(key);
    if (cached) {
      // Most recently used last, so the oldest goes first.
      urls.delete(key);
      urls.set(key, cached);
      return cached;
    }
    const loading = load().then((blob) => URL.createObjectURL(blob));
    loading.catch(() => urls.get(key) === loading && urls.delete(key));
    urls.set(key, loading);
    if (urls.size > max) {
      const [oldest, url] = urls.entries().next().value!;
      urls.delete(oldest);
      url.then(URL.revokeObjectURL, () => undefined);
    }
    return loading;
  };
}
