/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import '$lib/data/storage/storage-handler-factory';
import { installWay } from '$lib/data/install-app';
import { needsFirstRun } from '$lib/data/standalone-storage';
import { StorageKey } from '$lib/data/storage/storage-types';
import { syncEnded, syncState$, syncView, type SyncState } from '$lib/data/sync-status';

const idle: SyncState = { running: undefined, lastSync: 0, failed: false, waiting: [], errors: [] };
const now = 1_000_000_000;

describe('syncView', () => {
  it('shows nothing while books stay on this device', () => {
    const view = syncView({ ...idle, failed: true }, StorageKey.BROWSER, true, true, now);
    expect(view.kind).toBe('none');
  });

  it('counts a running sync', () => {
    const state = { ...idle, running: { done: 2, total: 12 } };
    expect(syncView(state, StorageKey.GDRIVE, true, true, now)).toMatchObject({
      kind: 'syncing',
      text: 'Syncing 3 of 12'
    });
  });

  it('counts changes waiting while offline', () => {
    const state = {
      ...idle,
      waiting: ['a\tbookmark', 'b\tbookmark', 'c\tstatistic', 'd\tbookmark']
    };
    expect(syncView(state, StorageKey.GDRIVE, false, true, now)).toMatchObject({
      kind: 'offline',
      text: 'Offline · 4 changes waiting'
    });
  });

  it('asks to sign in to Drive again before reporting failures', () => {
    expect(syncView({ ...idle, failed: true }, StorageKey.GDRIVE, true, false, now)).toMatchObject({
      kind: 'signin',
      text: 'Sign in to Drive again'
    });
    expect(syncView({ ...idle, failed: true }, StorageKey.FS, true, true, now)).toMatchObject({
      kind: 'failed',
      text: 'Sync failed'
    });
  });

  it('says when the last sync was', () => {
    const state = { ...idle, lastSync: now - 2 * 60_000 };
    expect(syncView(state, StorageKey.GDRIVE, true, true, now)).toMatchObject({
      kind: 'synced',
      text: 'Synced 2 min ago'
    });
    expect(syncView(idle, StorageKey.GDRIVE, true, true, now).kind).toBe('none');
  });
});

describe('syncEnded', () => {
  it('keeps failed changes waiting and clears them on the next success', () => {
    syncState$.next(idle);
    syncEnded(['Book\tbookmark'], 'Network error', 'Book', now);
    expect(syncState$.getValue()).toMatchObject({ failed: true, waiting: ['Book\tbookmark'] });
    expect(syncState$.getValue().errors[0]).toMatchObject({
      what: 'Book',
      detail: 'Network error'
    });

    syncEnded(['Book\tbookmark'], '', 'Book', now + 1);
    expect(syncState$.getValue()).toMatchObject({ failed: false, waiting: [], lastSync: now + 1 });
  });
});

describe('first run', () => {
  it('runs once, in the standalone edition only', () => {
    expect(needsFirstRun(true, false)).toBe(true);
    expect(needsFirstRun(true, true)).toBe(false);
    expect(needsFirstRun(false, false)).toBe(false);
  });
});

describe('installWay', () => {
  const chromeAndroid =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
  const firefoxAndroid = 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0';
  const iphoneSafari =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const iphoneChrome =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1';
  const ipad =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

  it('offers the browser prompt when there is one', () => {
    expect(installWay(chromeAndroid, 5, true, false)).toBe('prompt');
  });

  it('explains Firefox on Android and Safari on iOS', () => {
    expect(installWay(firefoxAndroid, 5, false, false)).toBe('firefox-android');
    expect(installWay(iphoneSafari, 5, false, false)).toBe('ios');
    expect(installWay(ipad, 5, false, false)).toBe('ios');
  });

  it('says nothing where it cannot help, or once installed', () => {
    expect(installWay(iphoneChrome, 5, false, false)).toBe('none');
    expect(installWay(ipad, 0, false, false)).toBe('none');
    expect(installWay(chromeAndroid, 5, true, true)).toBe('installed');
  });
});
