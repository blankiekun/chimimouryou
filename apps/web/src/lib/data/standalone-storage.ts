/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Where the standalone edition keeps books (first run, Settings → Sync): this browser, Google
 * Drive (the default GDrive source, signed in through storage-oauth-manager) or a folder (the FS
 * source). Not part of upstream.
 */

import { gDriveRefreshEndpoint, gDriveRevokeEndpoint, pagePath } from '$lib/data/env';
import { writableBooleanLocalStorageSubject } from '$lib/data/internal/writable-boolean-local-storage-subject';
import { BaseStorageHandler } from '$lib/data/storage/handler/base-handler';
import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
import { StorageOAuthManager, storageOAuthTokens } from '$lib/data/storage/storage-oauth-manager';
import { StorageKey, StorageSourceDefault } from '$lib/data/storage/storage-types';
import { isStorageSourceAvailable, storageSource$ } from '$lib/data/storage/storage-view';
import {
  autoReplication$,
  cacheStorageData$,
  database,
  fsStorageSource$,
  gDriveStorageSource$
} from '$lib/data/store';
import { storage } from '$lib/data/window/navigator/storage';
import { AutoReplicationType } from '$lib/functions/replication/replication-options';
import { writableSubject } from '$lib/functions/svelte/store';

/** The first run's choice was made (the storage itself is `storageSource$`). */
export const storageChosen$ = writableBooleanLocalStorageSubject()('storageChosen', false);

export function needsFirstRun(isStandalone: boolean, chosen: boolean) {
  return isStandalone && !chosen;
}

/** Asks the browser not to evict books (Safari deletes data of sites unused for 7 days). */
export function persistStorage() {
  storage.persist().catch(() => {});
}

export function driveAvailable(window: Window) {
  return !!isStorageSourceAvailable(StorageKey.GDRIVE, gDriveStorageSource$.getValue(), window);
}

export function folderAvailable(window: Window) {
  return 'showDirectoryPicker' in window;
}

function driveSourceName() {
  return gDriveStorageSource$.getValue() || StorageSourceDefault.GDRIVE_DEFAULT;
}

/** A Drive token that hasn't expired: the next sync needs no sign-in. */
export function driveSignedIn(now = Date.now()) {
  const token = storageOAuthTokens.get(driveSourceName());
  return !!token && token.expiration > now;
}

/** The signed-in Google account, for the Storage row; empty when unknown. */
export const driveEmail$ = writableSubject('');

async function loadDriveEmail() {
  const token = storageOAuthTokens.get(driveSourceName());
  if (!token) return;
  const response = await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
    { headers: { Authorization: `Bearer ${token.accessToken}` } }
  ).catch(() => undefined);
  const about = response?.ok ? await response.json().catch(() => undefined) : undefined;
  driveEmail$.next(about?.user?.emailAddress || '');
}

/**
 * Signs in to Drive from a click (the pop-up must open in the click itself).
 * Resolves 'blocked' when the browser refused the pop-up, an error message, or ''.
 */
export async function signInToDrive(window: Window): Promise<string> {
  if (driveSignedIn()) return '';

  const popup = StorageOAuthManager.createWindow(
    `${pagePath}/auth?ttu-init-wait=1`,
    'auth',
    Math.min(Math.max(window.innerWidth, 300), 560),
    Math.min(Math.max(window.innerHeight, 300), 560),
    window
  );
  if (!popup) return 'blocked';

  try {
    await new StorageOAuthManager(StorageKey.GDRIVE, gDriveRefreshEndpoint).getToken(
      window,
      driveSourceName(),
      true,
      popup
    );
  } catch (error: any) {
    return error.message || 'Sign-in failed';
  }

  await loadDriveEmail();
  return '';
}

export function signOutOfDrive(window: Window) {
  const name = driveSourceName();
  const token = storageOAuthTokens.get(name);
  if (token) StorageOAuthManager.revokeToken(gDriveRevokeEndpoint, token.accessToken);
  storageOAuthTokens.delete(name);
  driveEmail$.next('');
  getStorageHandler(window, StorageKey.GDRIVE).clearData();
}

const folderSourceName = 'Folder';

/** Lets the reader pick a folder and makes it the FS source; resolves its name, or '' if cancelled. */
export async function pickFolder(window: Window): Promise<string> {
  let parent: FileSystemDirectoryHandle;

  try {
    parent = await (window as any).showDirectoryPicker({
      id: 'ttu-reader-root',
      mode: 'readwrite'
    });
  } catch (error: any) {
    if (error.name === 'AbortError') return '';
    throw error;
  }

  const directoryHandle = await parent.getDirectoryHandle(BaseStorageHandler.rootName, {
    create: true
  });
  const existing = await (await database.db).get('storageSource', folderSourceName);

  await database.saveStorageSource(
    {
      name: folderSourceName,
      type: StorageKey.FS,
      storedInManager: false,
      encryptionDisabled: true,
      data: { directoryHandle, fsPath: `${parent.name}/${BaseStorageHandler.rootName}` },
      lastSourceModified: Date.now()
    },
    existing ? folderSourceName : '',
    false,
    true
  );
  getStorageHandler(window, StorageKey.FS).clearData();

  return parent.name;
}

export function folderChosen() {
  return !!fsStorageSource$.getValue();
}

/** Makes `key` the library's source; Drive and folders sync as you read. */
export function chooseStorage(window: Window, key: StorageKey) {
  if (key !== storageSource$.getValue()) {
    if (!cacheStorageData$.getValue()) getStorageHandler(window, key).clearData();
    storageSource$.next(key);
  }
  if (key !== StorageKey.BROWSER && autoReplication$.getValue() === AutoReplicationType.Off) {
    autoReplication$.next(AutoReplicationType.All);
  }
  persistStorage();
}
