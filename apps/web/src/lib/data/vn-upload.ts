/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BlobReader, BlobWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
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

/** An unpacked game among picked or dropped files: its folder's name, bytes and files by path */
export interface VnFolder {
  name: string;
  size: number;
  files: Record<string, File>;
}

/** Where a picked or dropped file sits: its folder path (webkitRelativePath, or set by getEntryFiles) */
const relativePath = (file: File) => file.webkitRelativePath || file.name;

/**
 * The game folders among picked or dropped files (a folder holding a script, findVnRoot), each
 * one game with its files keyed by their path inside it, and the files outside any game.
 */
export function vnFolders(files: File[]) {
  const roots = files
    .map((file) => relativePath(file))
    .filter((path) => findVnRoot([path]) !== undefined)
    .map((path) => path.slice(0, path.lastIndexOf('/') + 1))
    // A game needs a folder to be named after; a loose script stays a file.
    .filter((root) => root)
    .sort((a, b) => a.length - b.length)
    .filter((root, index, sorted) => !sorted.slice(0, index).some((r) => root.startsWith(r)));
  const games: VnFolder[] = roots.map((root) => ({
    name: root.slice(0, -1).split('/').pop()!,
    size: 0,
    files: {}
  }));
  const rest: File[] = [];

  for (const file of files) {
    const path = relativePath(file);
    const at = roots.findIndex((root) => path.startsWith(root));

    if (at < 0) {
      rest.push(file);
      continue;
    }

    const inner = path.slice(roots[at].length);

    if (!inner.split('/').some((part) => part.startsWith('.') || part === '__MACOSX')) {
      games[at].files[inner] = file;
      games[at].size += file.size;
    }
  }

  return { games, rest };
}

/**
 * A game folder as a stored ZIP (no compression), for the Calibre import, which takes ZIPs.
 * shortcut: builds the whole ZIP in memory; stream it to the upload if big games fail.
 */
export async function zipVnFolder(game: VnFolder) {
  const writer = new ZipWriter(new BlobWriter('application/zip'));

  for (const [path, file] of Object.entries(game.files)) {
    await writer.add(`${game.name}/${path}`, new BlobReader(file), { level: 0 });
  }

  return new File([await writer.close()], `${game.name}.zip`, { type: 'application/zip' });
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
