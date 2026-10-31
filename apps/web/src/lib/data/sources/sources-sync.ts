/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** sources.json: this device's follows shared through the reader's sync folder (local-sources.ts). */

import { browser } from '$app/env';
import type { SyncFileStore } from '$lib/data/storage/handler/base-handler';
import { readerStore } from '$lib/data/sync/extras-sync';
import { syncJsonFile } from '$lib/data/sync/sync-files';
import { logger } from '$lib/data/logger';
import {
  all,
  db,
  deviceId,
  isExtension,
  markDeviceFollows,
  one,
  put,
  remove,
  sharedEntry,
  sharedKey,
  SITES,
  workFor,
  type SharedFollow,
  type WorkRow
} from './local-sources';

export const SHARED_FRESH_MS = 60 * 1000;
let sharedSyncedAt = 0;
let sharedQueue = Promise.resolve();

/** The newer entry; on a tie the unfollow, so both devices end the same. */
const newer = (a: SharedFollow, b?: SharedFollow) =>
  !b || a.modified > b.modified || (a.modified === b.modified && !!a.deleted && !b.deleted);

const sameShared = (a?: SharedFollow, b?: SharedFollow) =>
  !!a && !!b && a.modified === b.modified && !!a.deleted === !!b.deleted && a.device === b.device;

/** sources.json: malformed follows are dropped; undefined when `follows` isn't a list. */
export function parseSourcesFile(raw: any): { follows: SharedFollow[] } | undefined {
  if (!Array.isArray(raw?.follows)) return undefined;
  return {
    follows: raw.follows.filter(
      (f: any) =>
        ['key', 'site', 'workKey', 'url', 'title', 'device', 'deviceName'].every(
          (field) => typeof f?.[field] === 'string'
        ) && typeof f.modified === 'number'
    )
  };
}

/** Downloads unless synced within `fresh` ms. */
export function pullSources(fresh = SHARED_FRESH_MS) {
  if (browser && Date.now() - sharedSyncedAt >= fresh) syncSources();
}

export function syncSources(): Promise<void> {
  sharedQueue = sharedQueue.then(async () => {
    try {
      const store = await readerStore();
      if (store) await syncSourcesWith(store);
    } catch (error: any) {
      logger.warn(`Sources sync failed: ${error.message}`);
    }
  });
  return sharedQueue;
}

/**
 * Merges sources.json with this device's follows (the newer entry per work wins) and applies it:
 * another device's follows of the built-in sites are listed here and never checked here; its
 * server follows stay in the file only.
 */
export async function syncSourcesWith(store: SyncFileStore) {
  const me = deviceId();
  // Follows from before sources.json, or never shared.
  for (const follow of await all('follows')) {
    const work = await one('works', follow.work);
    if (work && !(await one('shared', sharedKey(follow.device ?? me, work.site, work.workKey)))) {
      await put('shared', await sharedEntry(work, follow));
    }
  }
  await syncJsonFile(store, 'sources.json', undefined, parseSourcesFile, async (file) => {
    const remote = new Map((file?.follows ?? []).map((f) => [f.key, f]));
    const merged = new Map((await all('shared')).map((f) => [f.key, f]));
    for (const entry of remote.values()) {
      if (newer(entry, merged.get(entry.key))) {
        merged.set(entry.key, entry);
        await put('shared', entry);
      }
    }
    for (const entry of merged.values()) {
      if (entry.site.startsWith('opds:') && entry.device !== me) continue;
      // Built-in sites and extensions name a work alike on every device (a server's numbers don't).
      const work =
        (entry.site in SITES || isExtension(entry.site)) && !entry.deleted
          ? await workFor(entry.site, entry.workKey, entry.url)
          : ((await (await db()).getFromIndex('works', 'key', [entry.site, entry.workKey])) as
              | WorkRow
              | undefined);
      if (!work) continue;
      if (!work.title) await put('works', { ...work, title: entry.title });
      const follow = await one('follows', work.id);
      if (entry.deleted) {
        if (follow && follow.modified <= entry.modified) await remove('follows', work.id);
      } else if (!follow || follow.modified < entry.modified) {
        const device = entry.device === me ? undefined : entry.device;
        await put('follows', {
          state: '',
          detail: '',
          lastCheck: null,
          nextCheck: null,
          ...follow,
          // Taken over by another device (or released): this device's last result no longer applies.
          ...(follow && follow.device !== device && { state: '', detail: '' }),
          work: work.id,
          paused: entry.paused,
          modified: entry.modified,
          device,
          deviceName: entry.device === me ? undefined : entry.deviceName,
          siteName: entry.siteName
        });
      }
    }
    await markDeviceFollows();
    const changed = [...merged.values()].some((f) => !sameShared(f, remote.get(f.key)));
    return changed ? { follows: [...merged.values()] } : undefined;
  });
  sharedSyncedAt = Date.now();
}
