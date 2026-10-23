/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Syncs AI settings, themes and reader settings to the signed-in account
 * (settings.json in the account's WebDAV folder), or while signed out to the
 * root of the library's Google Drive, OneDrive or folder source, without the
 * API keys (sync-files.ts). Reader settings are kept
 * separately for phones and larger screens, e.g. one column on the phone and
 * two on the desktop. Each setting keeps the time it was last changed in this
 * browser, and the newer value wins per setting. Not part of upstream.
 */

import { BehaviorSubject, map, merge, skip, type Subscription } from 'rxjs';
import { mangaSeriesModes$ } from '$lib/data/manga';
import { uiLanguage$ } from '$lib/i18n';
import type { AccountUser } from '$lib/data/account';
import { readerSyncStore, syncJsonFile } from '$lib/data/sync-files';
import {
  aiLanguage$,
  aiPromptOverrides$,
  askAiDefaultPreset$,
  askAiPresets$,
  askAiReaderNote$,
  openRouterApiKey$,
  openRouterModel$,
  openRouterRecapModel$,
  lorebookAutoInterval$,
  elevenLabsApiKey$,
  elevenLabsModel$,
  ttsPlaybackRate$,
  ttsVoiceId$
} from '$lib/data/ai-settings';
import { homeBookTitles$, homeRemovedTitles$ } from '$lib/data/library-home';
import { logger } from '$lib/data/logger';
import { enabledPlugins$ } from '$lib/plugins/plugin-settings';
import { audiobookshelfToken$ } from '$lib/data/audiobookshelf';
import {
  autoBookmark$,
  autoBookmarkTime$,
  autoPositionOnResize$,
  avoidPageBreak$,
  confirmClose$,
  customReadingPointEnabled$,
  disableWheelNavigation$,
  enableFontVPAL$,
  enableReaderWakeLock$,
  enableTapEdgeToFlip$,
  enableTextJustification$,
  enableTextWrapPretty$,
  enableVerticalFontKerning$,
  firstDimensionMargin$,
  fontFamilyGroupOne$,
  fontFamilyGroupTwo$,
  fontSize$,
  fontWeight$,
  furiganaStyle$,
  hideFurigana$,
  generatedFurigana$,
  hideSpoilerImage$,
  hideSpoilerImageMode$,
  lineHeight$,
  manualBookmark$,
  pageColumns$,
  prioritizeReaderStyles$,
  secondDimensionMaxValue$,
  selectionToBookmarkEnabled$,
  showCharacterCounter$,
  showFooterChapterCharacterCounter$,
  showFooterChapterPercentage$,
  showPercentage$,
  swipeThreshold$,
  textIndentation$,
  textMarginMode$,
  textMarginValue$,
  theme$,
  verticalTextOrientation$,
  viewMode$,
  writingMode$,
  readerProfile,
  type ReaderProfile
} from '$lib/data/store';
import {
  customAppThemes$,
  darkTheme$,
  followSystemTheme$,
  replacedOldDefaultTheme
} from '$lib/data/theme/theme-store';

interface SettingsDocument {
  version: 1;
  values: Record<string, unknown>;
  /** Setting key → time it was last changed */
  modified: Record<string, number>;
}

type Store = BehaviorSubject<any>;

/** localStorage key → store, shared by all devices. Add a store here to sync it. */
const sharedSettings: Record<string, Store> = {
  theme: theme$,
  darkTheme: darkTheme$,
  followSystemTheme: followSystemTheme$,
  customAppThemes: customAppThemes$,
  openRouterApiKey: openRouterApiKey$,
  openRouterModel: openRouterModel$,
  openRouterRecapModel: openRouterRecapModel$,
  lorebookAutoInterval: lorebookAutoInterval$,
  aiLanguage: aiLanguage$,
  aiPromptOverrides: aiPromptOverrides$,
  uiLanguage: uiLanguage$,
  enabledPlugins: enabledPlugins$,
  audiobookshelfToken: audiobookshelfToken$,
  homeBookTitles: homeBookTitles$,
  homeRemovedTitles: homeRemovedTitles$,
  mangaSeriesModes: mangaSeriesModes$,
  askAiPresets: askAiPresets$,
  askAiDefaultPreset: askAiDefaultPreset$,
  askAiReaderNote: askAiReaderNote$,
  elevenLabsApiKey: elevenLabsApiKey$,
  elevenLabsModel: elevenLabsModel$,
  ttsVoiceId: ttsVoiceId$,
  ttsPlaybackRate: ttsPlaybackRate$
};

/**
 * API keys among sharedSettings. They belong to the account: they are removed
 * from the browser when it signs out (or the session expires) or another account
 * signs in, so they are never used by, shown to or uploaded for someone else.
 */
const secretSettings = ['openRouterApiKey', 'elevenLabsApiKey', 'audiobookshelfToken'];

/** Settings → Reader: localStorage key → store, synced per reader profile. */
const readerSettings: Record<string, Store> = {
  fontFamilyGroupOne: fontFamilyGroupOne$,
  fontFamilyGroupTwo: fontFamilyGroupTwo$,
  fontWeight: fontWeight$,
  fontSize: fontSize$,
  lineHeight: lineHeight$,
  textIndentation: textIndentation$,
  textMarginMode: textMarginMode$,
  textMarginValue: textMarginValue$,
  enableTextJustification: enableTextJustification$,
  enableTextWrapPretty: enableTextWrapPretty$,
  prioritizeReaderStyles: prioritizeReaderStyles$,
  writingMode: writingMode$,
  verticalTextOrientation: verticalTextOrientation$,
  enableVerticalFontKerning: enableVerticalFontKerning$,
  enableFontVPAL: enableFontVPAL$,
  hideFurigana: hideFurigana$,
  generatedFurigana: generatedFurigana$,
  furiganaStyle: furiganaStyle$,
  viewMode: viewMode$,
  pageColumns: pageColumns$,
  firstDimensionMargin: firstDimensionMargin$,
  secondDimensionMaxValue: secondDimensionMaxValue$,
  avoidPageBreak: avoidPageBreak$,
  hideSpoilerImage: hideSpoilerImage$,
  hideSpoilerImageMode: hideSpoilerImageMode$,
  showCharacterCounter: showCharacterCounter$,
  showPercentage: showPercentage$,
  showFooterChapterCharacterCounter: showFooterChapterCharacterCounter$,
  showFooterChapterPercentage: showFooterChapterPercentage$,
  manualBookmark: manualBookmark$,
  autoBookmark: autoBookmark$,
  autoBookmarkTime: autoBookmarkTime$,
  selectionToBookmarkEnabled: selectionToBookmarkEnabled$,
  customReadingPointEnabled: customReadingPointEnabled$,
  autoPositionOnResize: autoPositionOnResize$,
  swipeThreshold: swipeThreshold$,
  disableWheelNavigation: disableWheelNavigation$,
  enableTapEdgeToFlip: enableTapEdgeToFlip$,
  enableReaderWakeLock: enableReaderWakeLock$,
  confirmClose: confirmClose$
};

export { readerProfile, type ReaderProfile } from '$lib/data/store';

interface SyncEntry {
  /** Key in settings.json (and in the change times) */
  key: string;
  /** Key of the store in localStorage */
  storageKey: string;
  store: Store;
}

function syncEntries(profile: ReaderProfile): SyncEntry[] {
  const entries = (settings: Record<string, Store>, prefix = '') =>
    Object.entries(settings).map(([storageKey, store]) => ({
      key: `${prefix}${storageKey}`,
      storageKey,
      store
    }));

  return [...entries(sharedSettings), ...entries(readerSettings, `reader.${profile}.`)];
}

export type SettingsSyncState =
  | { state: 'off' }
  | { state: 'syncing' }
  | { state: 'synced'; at: number }
  | { state: 'error'; message: string };

export const settingsSyncState$ = new BehaviorSubject<SettingsSyncState>({ state: 'off' });

const changeTimesKey = 'accountSettingsModified';
/** Account whose settings this browser holds (its change times and API keys). */
const ownerKey = 'accountSettingsOwner';
const uploadDelayMs = 1500;
const refreshOnFocusAfterMs = 60_000;

let entries: SyncEntry[] = [];
let signedIn = false;
let changeSubscription: Subscription | undefined;
let applyingRemote = false;
let uploadTimer: ReturnType<typeof setTimeout> | undefined;
let lastSynced = 0;
let queue = Promise.resolve();

function readChangeTimes(): Record<string, number> {
  try {
    return JSON.parse(window.localStorage.getItem(changeTimesKey) || '{}');
  } catch {
    return {};
  }
}

function writeChangeTimes(times: Record<string, number>) {
  window.localStorage.setItem(changeTimesKey, JSON.stringify(times));
}

function applyRemoteValue(store: Store, value: unknown) {
  if (JSON.stringify(store.getValue()) === JSON.stringify(value)) {
    return;
  }

  applyingRemote = true;
  store.next(value);
  applyingRemote = false;
}

/**
 * Applies settings that are newer in the account, and uploads settings that are
 * newer here (or were set before signing in and are missing from the account).
 */
async function syncOnce() {
  const store = await readerSyncStore(signedIn);

  if (!store) {
    settingsSyncState$.next({ state: 'off' });
    return;
  }

  settingsSyncState$.next({ state: 'syncing' });

  // keepalive: finishes even if the tab is closed right after a change.
  await syncJsonFile<Partial<SettingsDocument>>(
    store,
    'settings.json',
    undefined,
    mergeSettings,
    true
  );

  lastSynced = Date.now();
  settingsSyncState$.next({ state: 'synced', at: lastSynced });
}

/** Applies the newer remote settings; resolves the file to upload when this browser has newer ones. */
async function mergeSettings(file: Partial<SettingsDocument> | undefined) {
  const remote: SettingsDocument = {
    version: 1,
    values: file?.values ?? {},
    modified: file?.modified ?? {}
  };
  const localTimes = readChangeTimes();
  let changedRemote = false;

  entries.forEach(({ key, storageKey, store }) => {
    const remoteTime = remote.modified[key] || 0;
    const localTime = localTimes[key] || 0;
    const newDefault = replacedOldDefaultTheme(key, remote.values[key], remoteTime);

    if (newDefault) {
      remote.values[key] = newDefault;
      remote.modified[key] = Date.now();
      changedRemote = true;
    }

    if (key in remote.values && (newDefault || remoteTime >= localTime)) {
      applyRemoteValue(store, remote.values[key]);
      localTimes[key] = remote.modified[key];
    } else if (localTime > remoteTime || window.localStorage.getItem(storageKey) !== null) {
      remote.values[key] = store.getValue();
      remote.modified[key] = localTime || Date.now();
      localTimes[key] = remote.modified[key];
      changedRemote = true;
    }
  });

  writeChangeTimes(localTimes);

  return changedRemote ? remote : undefined;
}

/** Queues a sync; runs never overlap. */
export function syncAccountSettings(): Promise<void> {
  queue = queue.then(() =>
    syncOnce().catch((error: Error & { status?: number }) => {
      const message = error.status === 401 ? 'Sign-in expired' : error.message;

      logger.warn(`Settings sync failed: ${message}`);
      settingsSyncState$.next({ state: 'error', message });
    })
  );

  return queue;
}

function scheduleUpload() {
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(() => {
    uploadTimer = undefined;
    syncAccountSettings();
  }, uploadDelayMs);
}

function onFocus() {
  if (Date.now() - lastSynced > refreshOnFocusAfterMs) {
    syncAccountSettings();
  }
}

/** Uploads pending changes right away when the tab is hidden (it may be closed). */
function onVisibilityChange() {
  if (document.visibilityState === 'hidden' && uploadTimer) {
    clearTimeout(uploadTimer);
    uploadTimer = undefined;
    syncAccountSettings();
  }
}

/**
 * Forgets the previous account's API keys and change times when the browser is
 * signed out or another account signs in. Keys typed while signed out belong to
 * nobody, so the account that signs in next doesn't adopt them either.
 */
function releasePreviousOwner(user: AccountUser | null) {
  const owner = window.localStorage.getItem(ownerKey);

  if (user ? owner !== user.id : owner) {
    secretSettings.forEach((key) => {
      sharedSettings[key].next('');
      window.localStorage.removeItem(key);
    });
    window.localStorage.removeItem(changeTimesKey);
    window.localStorage.removeItem(ownerKey);
  }

  if (user) {
    window.localStorage.setItem(ownerKey, user.id);
  }
}

/**
 * Called once per page load with the session state. With null (signed out or
 * expired) it releases the previous account's API keys and syncs with the
 * library's cloud or folder, if it has one.
 */
export function startSettingsSync(user: AccountUser | null) {
  stopSettingsSync();
  releasePreviousOwner(user);

  signedIn = !!user;
  // API keys only go to the account: a cloud or folder may be shared or read by other apps.
  entries = syncEntries(readerProfile()).filter(
    ({ key }) => signedIn || !secretSettings.includes(key)
  );
  changeSubscription = merge(
    ...entries.map(({ key, store }) =>
      store.pipe(
        skip(1),
        map(() => key)
      )
    )
  ).subscribe((key) => {
    if (!applyingRemote) {
      writeChangeTimes({ ...readChangeTimes(), [key]: Date.now() });
      scheduleUpload();
    }
  });

  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibilityChange);
  syncAccountSettings();
}

function stopSettingsSync() {
  changeSubscription?.unsubscribe();
  changeSubscription = undefined;
  clearTimeout(uploadTimer);
  uploadTimer = undefined;
  window.removeEventListener('focus', onFocus);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  settingsSyncState$.next({ state: 'off' });
}
