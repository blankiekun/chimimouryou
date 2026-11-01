/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** An extra sync file (`sync-files.ts`) and the version it was read at. */
export interface SyncedFile {
  text: string;
  version: string;
}

export interface SyncFileOptions {
  /** The book folder to write in; the root folder when missing */
  title?: string;
  /** The version read before ('' = there was none): the write fails with SyncConflictError if it changed since */
  version?: string;
  /** Finish the upload even if the tab closes (small files only) */
  keepalive?: boolean;
}

/** Reads and writes extra JSON files beside the book data. Not part of upstream. */
export interface SyncFileStore {
  readSyncFile(name: string, title?: string): Promise<SyncedFile | undefined>;
  writeSyncFile(name: string, text: string, options?: SyncFileOptions): Promise<void>;
}

export class SyncConflictError extends Error {
  constructor() {
    super('The file was changed by another device');
  }
}
