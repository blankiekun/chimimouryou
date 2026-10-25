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
import { mergePlacementResults, placementResults$ } from '$lib/data/placement';
import { mergeRankState, readingRank$ } from '$lib/data/reading-rank';
import { uiLanguage$ } from '$lib/i18n';
import type { AccountUser } from '$lib/data/account';
import { readerSyncStore, syncJsonFile } from '$lib/data/sync-files';
import {
  aiConnectionKeys$,
  aiConnections$,
  aiFeatures$,
  aiLanguage$,
  aiPromptOverrides$,
  askAiDefaultPreset$,
  askAiPresets$,
  askAiReaderNote$,
  lorebookAutoInterval$,
  ttsPlaybackRate$,
  ttsVoiceId$
} from '$lib/data/ai-settings';
import { mergeConnectionKeys, mergeConnections } from '$lib/data/ai-connections';
import {
  homeBookTitles$,
  homeRemovedTitles$,
  mergeHomeRemovals,
  mergeHomeTitles
} from '$lib/data/library-home';
import { logger } from '$lib/data/logger';
import { enabledPlugins$ } from '$lib/plugins/plugin-settings';
import { audiobookshelfToken$ } from '$lib/data/audiobookshelf';
import { socialSession$ } from '$lib/data/social-account';
import { communityWorks$ } from '$lib/data/community';
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
  unknownWordUnderline$,
  chapterPrimer$,
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
  /** entrySettings key → entry id → time it was last changed, negative when deleted */
  entryModified?: Record<string, EntryTimes>;
}

type EntryTimes = Record<string, number>;

type Store = BehaviorSubject<any>;

/** localStorage key → store, shared by all devices. Add a store here to sync it. */
const sharedSettings: Record<string, Store> = {
  theme: theme$,
  darkTheme: darkTheme$,
  followSystemTheme: followSystemTheme$,
  customAppThemes: customAppThemes$,
  aiConnections: aiConnections$,
  aiConnectionKeys: aiConnectionKeys$,
  aiFeatures: aiFeatures$,
  lorebookAutoInterval: lorebookAutoInterval$,
  aiLanguage: aiLanguage$,
  aiPromptOverrides: aiPromptOverrides$,
  uiLanguage: uiLanguage$,
  enabledPlugins: enabledPlugins$,
  audiobookshelfToken: audiobookshelfToken$,
  socialSession: socialSession$,
  // Books matched to their Community work: the other devices mark their lines on open too.
  communityWorks: communityWorks$,
  homeBookTitles: homeBookTitles$,
  homeRemovedTitles: homeRemovedTitles$,
  // The cutoff and its length follow from the results.
  placementResults: placementResults$,
  readingRank: readingRank$,
  mangaSeriesModes: mangaSeriesModes$,
  askAiPresets: askAiPresets$,
  askAiDefaultPreset: askAiDefaultPreset$,
  askAiReaderNote: askAiReaderNote$,
  ttsVoiceId: ttsVoiceId$,
  ttsPlaybackRate: ttsPlaybackRate$
};

/**
 * API keys among sharedSettings. They belong to the account: they are removed
 * from the browser when it signs out (or the session expires) or another account
 * signs in, so they are never used by, shown to or uploaded for someone else.
 */
const secretSettings = [
  'aiConnectionKeys',
  'audiobookshelfToken',
  // The hub sign-in: other browsers of the server account are signed in to the hub too.
  'socialSession'
];

/**
 * Settings merged with the account's copy instead of replaced by the newer one, so two devices'
 * changes both survive. They also get both sides' values of every setting from before the merge.
 */
const mergedSettings: Record<
  string,
  (
    local: any,
    remote: any,
    localValues: Record<string, any>,
    remoteValues: Record<string, any>
  ) => unknown
> = {
  aiConnections: mergeConnections,
  aiConnectionKeys: (local, remote, localValues, remoteValues) =>
    mergeConnectionKeys(local, remote, localValues.aiConnections, remoteValues.aiConnections),
  homeBookTitles: (local, remote, localValues, remoteValues) =>
    mergeHomeTitles(local, remote, localValues.homeRemovedTitles, remoteValues.homeRemovedTitles),
  homeRemovedTitles: mergeHomeRemovals,
  placementResults: mergePlacementResults,
  readingRank: mergeRankState
};

const asRecord = {
  toMap: (value: Record<string, unknown> = {}) => value,
  fromMap: (map: Record<string, unknown>) => map
};

/**
 * Settings merged per entry (theme id, preset id, series): each entry's newest change wins, a
 * deletion too, so two devices editing different entries keep both. Changes are timed in
 * `recordEntryChanges`.
 */
const entrySettings: Record<
  string,
  { toMap: (value: any) => Record<string, unknown>; fromMap: (map: Record<string, any>) => unknown }
> = {
  customAppThemes: asRecord,
  mangaSeriesModes: asRecord,
  communityWorks: asRecord,
  askAiPresets: {
    toMap: (presets: { id: string }[] = []) =>
      Object.fromEntries(presets.map((preset) => [preset.id, preset])),
    fromMap: (map) => Object.values(map)
  }
};

/**
 * Per-entry merge: the side with the entry's newer change (|time|) supplies it, or its deletion
 * (negative time). Entries from before times were kept (0) are kept from either side, the
 * account's copy first.
 */
export function mergeEntries(
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  localTimes: EntryTimes = {},
  remoteTimes: EntryTimes = {}
) {
  const merged: Record<string, unknown> = {};
  const times: EntryTimes = {};

  new Set([
    ...Object.keys(local),
    ...Object.keys(remote),
    ...Object.keys(localTimes),
    ...Object.keys(remoteTimes)
  ]).forEach((id) => {
    const localTime = localTimes[id] ?? 0;
    const remoteTime = remoteTimes[id] ?? 0;
    // A tie goes to a deletion, then to the account's copy.
    const useLocal =
      Math.abs(localTime) > Math.abs(remoteTime) ||
      (Math.abs(localTime) === Math.abs(remoteTime) &&
        (localTime < 0 !== remoteTime < 0 ? localTime < 0 : !(id in remote)));
    const time = useLocal ? localTime : remoteTime;
    const side = useLocal ? local : remote;

    if (time) times[id] = time;
    if (time >= 0 && id in side) merged[id] = side[id];
  });

  return { merged, times };
}

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
  unknownWordUnderline: unknownWordUnderline$,
  chapterPrimer: chapterPrimer$,
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
const entryTimesKey = 'accountSettingsEntryModified';
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
/** entrySettings' last values, to see which entries a change touched. */
let entryValues: Record<string, Record<string, unknown>> = {};

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

function readEntryTimes(): Record<string, EntryTimes> {
  try {
    return JSON.parse(window.localStorage.getItem(entryTimesKey) || '{}');
  } catch {
    return {};
  }
}

/** Times the entries of an entrySettings value that changed here (deleted: negative). */
function recordEntryChanges(key: string, value: unknown) {
  const previous = entryValues[key] ?? {};
  const next = entrySettings[key].toMap(value);
  const now = Date.now();
  const all = readEntryTimes();
  const times = { ...all[key] };

  new Set([...Object.keys(previous), ...Object.keys(next)]).forEach((id) => {
    if (JSON.stringify(previous[id]) !== JSON.stringify(next[id])) {
      times[id] = id in next ? now : -now;
    }
  });
  entryValues[key] = next;
  window.localStorage.setItem(entryTimesKey, JSON.stringify({ ...all, [key]: times }));
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
const oldAiSettings = [
  'openRouterApiKey',
  'openRouterModel',
  'openRouterRecapModel',
  'elevenLabsApiKey',
  'elevenLabsModel'
];

async function mergeSettings(file: Partial<SettingsDocument> | undefined) {
  const remote: SettingsDocument = {
    version: 1,
    values: file?.values ?? {},
    modified: file?.modified ?? {},
    entryModified: file?.entryModified ?? {}
  };
  const localTimes = readChangeTimes();
  const localEntryTimes = readEntryTimes();
  const remoteEntryTimes = { ...remote.entryModified };
  const localValues = Object.fromEntries(entries.map(({ key, store }) => [key, store.getValue()]));
  const remoteValues = { ...remote.values };
  let changedRemote = false;

  // Settings from before AI connections (#129): an old API key must not stay in the account's copy.
  oldAiSettings.forEach((key) => {
    if (key in remote.values || key in remote.modified) {
      delete remote.values[key];
      delete remote.modified[key];
      changedRemote = true;
    }
  });

  entries.forEach(({ key, storageKey, store }) => {
    const remoteTime = remote.modified[key] || 0;
    const localTime = localTimes[key] || 0;
    const newDefault = replacedOldDefaultTheme(key, remote.values[key], remoteTime);

    if (newDefault) {
      remote.values[key] = newDefault;
      remote.modified[key] = Date.now();
      changedRemote = true;
    }

    const merge = mergedSettings[key];
    const entrySetting = entrySettings[key];

    if (entrySetting && key in remote.values) {
      const { merged, times } = mergeEntries(
        entrySetting.toMap(store.getValue()),
        entrySetting.toMap(remote.values[key]),
        localEntryTimes[key],
        remoteEntryTimes[key]
      );
      const value = entrySetting.fromMap(merged);

      applyRemoteValue(store, value);

      if (
        JSON.stringify(value) !== JSON.stringify(remote.values[key]) ||
        JSON.stringify(times) !== JSON.stringify(remoteEntryTimes[key] ?? {})
      ) {
        remote.values[key] = value;
        remote.modified[key] = Date.now();
        remoteEntryTimes[key] = times;
        changedRemote = true;
      }

      localEntryTimes[key] = times;
      localTimes[key] = remote.modified[key];
    } else if (merge && key in remote.values) {
      const merged = merge(store.getValue(), remote.values[key], localValues, remoteValues);

      applyRemoteValue(store, merged);

      if (JSON.stringify(merged) !== JSON.stringify(remote.values[key])) {
        remote.values[key] = merged;
        remote.modified[key] = Date.now();
        changedRemote = true;
      }

      localTimes[key] = remote.modified[key];
    } else if (key in remote.values && (newDefault || remoteTime >= localTime)) {
      applyRemoteValue(store, remote.values[key]);
      localTimes[key] = remote.modified[key];
    } else if (localTime > remoteTime || window.localStorage.getItem(storageKey) !== null) {
      remote.values[key] = store.getValue();
      remote.modified[key] = localTime || Date.now();
      if (entrySettings[key]) remoteEntryTimes[key] = localEntryTimes[key] ?? {};
      localTimes[key] = remote.modified[key];
      changedRemote = true;
    }
  });

  writeChangeTimes(localTimes);
  window.localStorage.setItem(entryTimesKey, JSON.stringify(localEntryTimes));

  return changedRemote ? { ...remote, entryModified: remoteEntryTimes } : undefined;
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
      const store = sharedSettings[key];
      const value = store.getValue();

      store.next(key === 'socialSession' ? null : typeof value === 'string' ? '' : {});
      window.localStorage.removeItem(key);
    });
    window.localStorage.removeItem(changeTimesKey);
    window.localStorage.removeItem(entryTimesKey);
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
  entryValues = Object.fromEntries(
    Object.entries(entrySettings).map(([key, { toMap }]) => [
      key,
      toMap(sharedSettings[key].getValue())
    ])
  );
  changeSubscription = merge(
    ...entries.map(({ key, store }) =>
      store.pipe(
        skip(1),
        map((value) => [key, value] as const)
      )
    )
  ).subscribe(([key, value]) => {
    if (entrySettings[key]) {
      if (applyingRemote) entryValues[key] = entrySettings[key].toMap(value);
      else recordEntryChanges(key, value);
    }

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
