/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Settings → Sources (standalone): how followed works update on this device. They follow the
 * account (sharedSettings, owner s58).
 */

import { writableBooleanLocalStorageSubject } from '$lib/data/internal/writable-boolean-local-storage-subject';
import { writableNumberLocalStorageSubject } from '$lib/data/internal/writable-number-local-storage-subject';
import { bool, finite } from '$lib/data/setting-parsers';

export const sourcesAutoUpdate$ = writableBooleanLocalStorageSubject()(
  'sourcesAutoUpdate',
  true,
  bool
);
/** Hours between two checks of a followed work */
export const sourcesCheckHours$ = writableNumberLocalStorageSubject()(
  'sourcesCheckHours',
  6,
  finite
);
export const sourcesWifiOnly$ = writableBooleanLocalStorageSubject()('sourcesWifiOnly', true, bool);

/** wifi, mobile (cellular) or unknown (the browser can't tell, e.g. Safari and Firefox). */
export function connection(): 'wifi' | 'mobile' | 'unknown' {
  const type = (navigator as Navigator & { connection?: { type?: string } }).connection?.type;
  if (!type) return 'unknown';
  return type === 'cellular' ? 'mobile' : 'wifi';
}

/** Server edition: set while this device follows an extension's work (local-sources.ts). */
export const DEVICE_FOLLOWS = 'sourcesDeviceFollows';

export function hasDeviceFollows() {
  try {
    return !!localStorage.getItem(DEVICE_FOLLOWS);
  } catch {
    return false;
  }
}
