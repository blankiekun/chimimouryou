/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Caches the service worker owns carry this prefix. The origin may be shared with other sites
 * and the page keeps its own caches (user fonts, kept VN games), so the worker only ever
 * deletes names it made. Not part of upstream.
 */
export const swCachePrefix = 'chimi:';

/** Names older workers used before the prefix (SvelteKit's version is Date.now()). */
const legacyCacheName = /^(?:(?:build|other):\d+|vn-engine|ui-font)$/;

/** The caches an activating worker deletes: its own from older builds, never anyone else's. */
export function staleServiceWorkerCaches(names: string[], keep: string[]) {
  return names.filter(
    (name) => !keep.includes(name) && (name.startsWith(swCachePrefix) || legacyCacheName.test(name))
  );
}
