/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Sync status (header slot, and the standalone's Settings → Sync → Status), fed by `replicateData`
 * whenever it copies between this browser and Google Drive, OneDrive or a folder, or sends to the
 * server. Not part of upstream.
 */

import { writableSubject } from '$lib/functions/svelte/store';
import { StorageKey, type StorageDataType } from '$lib/data/storage/storage-types';

export interface SyncError {
  at: number;
  what: string;
  detail: string;
}

export interface SyncState {
  /** Books done and to do in the running sync */
  running: { done: number; total: number } | undefined;
  lastSync: number;
  /** What the last successful sync covered: a title, "N books" or "Library" */
  lastWhat: string;
  /** The last sync failed */
  failed: boolean;
  /**
   * `waitingEntry`s of changes not sent yet: queued by the reader or failed. Saved, so they outlive
   * the page; retried at app start, on `online` and on return (`retryWaitingChanges`).
   */
  waiting: string[];
  errors: SyncError[];
}

const lastSyncKey = 'syncLastSync';
const lastWhatKey = 'syncLastWhat';
const errorsKey = 'syncErrors';
const waitingKey = 'syncWaiting';
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
  lastWhat: typeof localStorage === 'undefined' ? '' : read(lastWhatKey, ''),
  failed: false,
  waiting: typeof localStorage === 'undefined' ? [] : read<string[]>(waitingKey, []),
  errors: typeof localStorage === 'undefined' ? [] : read<SyncError[]>(errorsKey, [])
});

const remoteSources = new Set([StorageKey.GDRIVE, StorageKey.ONEDRIVE, StorageKey.FS]);

/**
 * Copies between the browser and a Drive, OneDrive or folder are syncs; backups are not. With the
 * server only sends count: a download offline reads the stored mirror and would claim "Synced".
 */
export function isSyncBetween(source: StorageKey, target: StorageKey) {
  return (
    source !== StorageKey.BACKUP &&
    target !== StorageKey.BACKUP &&
    (remoteSources.has(source) || remoteSources.has(target) || target === StorageKey.CALIBRE)
  );
}

export const waitingEntry = (source: string, type: StorageDataType, title: string) =>
  `${source}\t${type}\t${title}`;

export function parseWaitingEntry(entry: string) {
  const [source, type, ...title] = entry.split('\t');

  return { source, type: type as StorageDataType, title: title.join('\t') };
}

function update(change: Partial<SyncState>) {
  syncState$.next({ ...syncState$.getValue(), ...change });
}

/** The list as saved: another tab may have changed it. */
export function waitingChanges() {
  const waiting = read(waitingKey, syncState$.getValue().waiting);

  update({ waiting });

  return waiting;
}

function setWaiting(waiting: string[]) {
  write(waitingKey, waiting);
  update({ waiting });
}

/** A change the reader will send soon: if the page dies first, the list still has it. */
export function syncQueued(entry: string) {
  const waiting = waitingChanges();

  if (!waiting.includes(entry)) setWaiting([...waiting, entry]);
}

export function dropWaiting(entries: string[]) {
  setWaiting(waitingChanges().filter((entry) => !entries.includes(entry)));
}

/**
 * One upload at a time across tabs and the reader, so a retry never races a send of the same file.
 * shortcut: plain http has no Web Locks, so tabs can race there; a retry of what's sent is a no-op.
 */
export function syncLocked<T>(run: () => Promise<T>) {
  return navigator.locks ? navigator.locks.request('syncUpload', run) : run();
}

export function syncStarted(total: number) {
  update({ running: { done: 0, total } });
}

export function syncStep() {
  const { running } = syncState$.getValue();
  if (running) update({ running: { ...running, done: Math.min(running.done + 1, running.total) } });
}

/** Ends a sync of `keys` (`waitingEntry`s): an error keeps them waiting and is listed. */
export function syncEnded(keys: string[], error: string, what: string, now = Date.now()) {
  const others = waitingChanges().filter((key) => !keys.includes(key));

  if (!error) {
    write(lastSyncKey, now);
    write(lastWhatKey, what);
    setWaiting(others);
    update({ running: undefined, lastSync: now, lastWhat: what, failed: false });
    return;
  }

  recordSyncError(what, error, now);
  setWaiting([...others, ...keys]);
  update({ running: undefined, failed: true });
}

/** Lists an error in Settings → Sync → Status (also an unreadable synced file, sync-files.ts). */
export function recordSyncError(what: string, detail: string, now = Date.now()) {
  const errors = [
    { at: now, what, detail: detail.slice(0, 300) },
    ...syncState$.getValue().errors
  ].slice(0, maxErrors);

  write(errorsKey, errors);
  update({ errors });
}

/**
 * A write outside `replicateData` (highlights, words, settings) failed: listed, and the header says
 * so until the next finished sync. They report only failures. Offline isn't one: they retry.
 */
export function syncFileFailed(what: string, detail: string) {
  if (navigator.onLine === false) return;

  recordSyncError(what, detail);
  update({ failed: true });
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
  | { kind: 'waiting'; text: string }
  | { kind: 'synced'; text: string };

/** What the header shows (plan S3): nothing on this device, else the most pressing state. */
export function syncView(
  state: SyncState,
  source: StorageKey,
  online: boolean,
  signedIn: boolean,
  now = Date.now()
): SyncView {
  if (!remoteSources.has(source) && source !== StorageKey.CALIBRE) return { kind: 'none' };
  if (state.running) {
    const { done, total } = state.running;
    return {
      kind: 'syncing',
      text: `Syncing ${Math.min(done + 1, total)} of ${total}`,
      done,
      total
    };
  }
  const count = state.waiting.length;
  const waiting = `${count} ${count === 1 ? 'change' : 'changes'} waiting`;
  if (!online && count) return { kind: 'offline', text: `Offline · ${waiting}` };
  if (!signedIn) {
    const place = source === StorageKey.ONEDRIVE ? 'OneDrive' : 'Drive';
    return { kind: 'signin', text: `Sign in to ${place} again` };
  }
  if (state.failed) return { kind: 'failed', text: 'Sync failed' };
  if (count) return { kind: 'waiting', text: waiting };
  if (state.lastSync) return { kind: 'synced', text: `Synced ${formatAgo(now - state.lastSync)}` };
  return { kind: 'none' };
}
