/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Sync status of the standalone edition (header slot and Settings → Sync → Status), fed by
 * `replicateData` whenever it copies between this browser and Google Drive, OneDrive or a folder.
 * Not part of upstream.
 */

import { writableSubject } from '$lib/functions/svelte/store';
import { StorageKey } from '$lib/data/storage/storage-types';

export interface SyncError {
  at: number;
  what: string;
  detail: string;
}

export interface SyncState {
  /** Books done and to do in the running sync */
  running: { done: number; total: number } | undefined;
  lastSync: number;
  /** The last sync failed */
  failed: boolean;
  /** `title\ttype` of changes whose upload failed and that the reader retries */
  waiting: string[];
  errors: SyncError[];
}

const lastSyncKey = 'syncLastSync';
const errorsKey = 'syncErrors';
const maxErrors = 5;

function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows: the status lasts for this visit.
  }
}

export const syncState$ = writableSubject<SyncState>({
  running: undefined,
  lastSync: typeof localStorage === 'undefined' ? 0 : read(lastSyncKey, 0),
  failed: false,
  waiting: [],
  errors: typeof localStorage === 'undefined' ? [] : read<SyncError[]>(errorsKey, [])
});

const remoteSources = new Set([StorageKey.GDRIVE, StorageKey.ONEDRIVE, StorageKey.FS]);

/** Copies between the browser and a Drive, OneDrive or folder are syncs; backups are not. */
export function isSyncBetween(source: StorageKey, target: StorageKey) {
  return (
    source !== StorageKey.BACKUP &&
    target !== StorageKey.BACKUP &&
    (remoteSources.has(source) || remoteSources.has(target))
  );
}

function update(change: Partial<SyncState>) {
  syncState$.next({ ...syncState$.getValue(), ...change });
}

export function syncStarted(total: number) {
  update({ running: { done: 0, total } });
}

export function syncStep() {
  const { running } = syncState$.getValue();
  if (running) update({ running: { ...running, done: Math.min(running.done + 1, running.total) } });
}

/** Ends a sync of `keys` (`title\ttype`): an error keeps them waiting and is listed. */
export function syncEnded(keys: string[], error: string, what: string, now = Date.now()) {
  const state = syncState$.getValue();
  const others = state.waiting.filter((key) => !keys.includes(key));

  if (!error) {
    write(lastSyncKey, now);
    update({ running: undefined, lastSync: now, failed: false, waiting: others });
    return;
  }

  const errors = [{ at: now, what, detail: error.slice(0, 300) }, ...state.errors].slice(
    0,
    maxErrors
  );
  write(errorsKey, errors);
  update({ running: undefined, failed: true, waiting: [...others, ...keys], errors });
}

export function formatAgo(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export type SyncView =
  | { kind: 'none' }
  | { kind: 'syncing'; text: string; done: number; total: number }
  | { kind: 'offline'; text: string }
  | { kind: 'signin'; text: string }
  | { kind: 'failed'; text: string }
  | { kind: 'synced'; text: string };

/** What the header shows (plan S3): nothing on this device, else the most pressing state. */
export function syncView(
  state: SyncState,
  source: StorageKey,
  online: boolean,
  signedIn: boolean,
  now = Date.now()
): SyncView {
  if (!remoteSources.has(source)) return { kind: 'none' };
  if (state.running) {
    const { done, total } = state.running;
    return {
      kind: 'syncing',
      text: `Syncing ${Math.min(done + 1, total)} of ${total}`,
      done,
      total
    };
  }
  if (!online && state.waiting.length) {
    const count = state.waiting.length;
    return {
      kind: 'offline',
      text: `Offline · ${count} ${count === 1 ? 'change' : 'changes'} waiting`
    };
  }
  if (!signedIn) {
    const place = source === StorageKey.ONEDRIVE ? 'OneDrive' : 'Drive';
    return { kind: 'signin', text: `Sign in to ${place} again` };
  }
  if (state.failed) return { kind: 'failed', text: 'Sync failed' };
  if (state.lastSync) return { kind: 'synced', text: `Synced ${formatAgo(now - state.lastSync)}` };
  return { kind: 'none' };
}
