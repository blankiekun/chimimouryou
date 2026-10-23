/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { asksBeforeVnUpload, StorageKey } from '$lib/data/storage/storage-types';
import { findVnRoot } from '$lib/data/vn';

/** A visual novel about to go to a cloud provider: its name (file name or title) and bytes */
export interface VnUpload {
  name: string;
  size: number;
}

/** Resolves true to upload, false to keep the games on this device */
export type AskVnUpload = (games: VnUpload[], target: StorageKey) => Promise<boolean>;

/**
 * The names of the games to keep on this device instead of uploading them to `target`: none
 * unless it is a cloud provider and the reader chose "Keep on this device" when asked.
 */
export async function vnsKeptOnDevice(target: StorageKey, games: VnUpload[], ask: AskVnUpload) {
  if (!asksBeforeVnUpload(target) || !games.length || (await ask(games, target))) {
    return new Set<string>();
  }

  return new Set(games.map((game) => game.name));
}

/** The ZIP/CBZ files that hold a visual novel, from their file lists only */
export async function vnZipFiles(files: File[]) {
  const games: File[] = [];

  for (const file of files) {
    if (!/\.(?:cbz|zip)$/i.test(file.name)) continue;

    const reader = new ZipReader(new BlobReader(file));

    try {
      const entries = await reader.getEntries();

      if (findVnRoot(entries.filter((e) => !e.directory).map((e) => e.filename)) !== undefined) {
        games.push(file);
      }
    } catch {
      // Not a readable zip: the import reports it.
    } finally {
      await reader.close();
    }
  }

  return games;
}

export function formatBytes(size: number) {
  return size >= 1024 ** 3
    ? `${(size / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(1, Math.round(size / 1024 ** 2))} MB`;
}

export function vnUploadQuestion(games: VnUpload[], target: StorageKey) {
  const where = target === StorageKey.ONEDRIVE ? 'OneDrive' : 'Google Drive';
  const total = games.reduce((sum, game) => sum + game.size, 0);
  const what =
    games.length === 1
      ? `${games[0].name} is ${formatBytes(total)}`
      : `These games (${games.map((game) => `${game.name}, ${formatBytes(game.size)}`).join('; ')}) are ${formatBytes(total)} in all`;

  return {
    dialogHeader:
      games.length === 1 ? `Upload this game to ${where}?` : `Upload these games to ${where}?`,
    dialogMessage: `${what}. Uploading takes a while and uses that much of your ${where} space; you can keep ${games.length === 1 ? 'it' : 'them'} on this device only.`
  };
}
