/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export enum StorageKey {
  BACKUP = 'backup',
  BROWSER = 'browser',
  CALIBRE = 'calibre',
  FS = 'fs',
  GDRIVE = 'gdrive'
}

/**
 * Google Drive, where a visual novel's game files (often gigabytes) take long and use the
 * reader's space: ask before uploading one (`vn-upload.ts`). Calibre and folders just store it.
 */
export function asksBeforeVnUpload(type: StorageKey) {
  return type === StorageKey.GDRIVE;
}

export enum StorageDataType {
  DATA = 'data',
  PROGRESS = 'bookmark',
  STATISTICS = 'statistic',
  READING_GOALS = 'readingGoal',
  AUDIOBOOK = 'audioBook',
  SUBTITLE = 'subtitle'
}

export enum StorageSourceDefault {
  GDRIVE_DEFAULT = 'ttu-gdrive-default',
  CALIBRE_DEFAULT = 'ttu-calibre-default'
}

export enum InternalStorageSources {
  INTERNAL_DEFAULT = 'ttu-internal-source',
  INTERNAL_BROWSER = 'ttu-internal-browser',
  INTERNAL_ZIP = 'ttu-internal-zip'
}

export const internalStorageSourceName = new Set<string>([
  InternalStorageSources.INTERNAL_DEFAULT,
  InternalStorageSources.INTERNAL_BROWSER,
  InternalStorageSources.INTERNAL_ZIP
]);

export const defaultStorageSources = [
  { name: StorageSourceDefault.GDRIVE_DEFAULT, type: StorageKey.GDRIVE }
];
