/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { BlobWriter, Uint8ArrayWriter, type Entry } from '@zip.js/zip.js';
import type { LoadData } from '../types';
import { getMimeTypeFromName } from '../htmlz/extract-htmlz';
import { analyzeScripts, encodePath, isScriptPath, vnElementHtml } from '$lib/data/vn';
import { serverFetch } from '$lib/data/server';
import { throwIfAborted } from '$lib/functions/replication/replication-error';
import { reportBytes } from '$lib/functions/replication/replication-progress';

/**
 * An ONScripter game from a zip as a book: every file under `root` is a blob, keyed by
 * its path inside the game folder. characters is the script's text, for progress.
 * shortcut: holds the whole game in memory while importing (like manga); stream entries
 * into IndexedDB one by one if large games fail to import on phones.
 */
export default async function loadVn(
  name: string,
  entries: Entry[],
  root: string,
  lastBookModified: number,
  cancelSignal?: AbortSignal
): Promise<LoadData> {
  const blobs: Record<string, Blob> = {};
  const scripts: { path: string; bytes: Uint8Array }[] = [];
  const files = entries.filter(
    (entry) =>
      !entry.directory &&
      entry.getData &&
      entry.filename.startsWith(root) &&
      !entry.filename.includes('__MACOSX/') &&
      !entry.filename.split('/').pop()!.startsWith('.')
  );
  const total = files.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  let done = 0;

  // Bytes extracted, for the import's label; cancelling stops between files.
  reportBytes('reading', 0, total);

  for (const entry of files) {
    throwIfAborted(cancelSignal);

    const path = entry.filename.slice(root.length);

    blobs[path] = await entry.getData!(new BlobWriter());
    reportBytes('reading', (done += entry.uncompressedSize), total);

    if (isScriptPath(path)) {
      scripts.push({ path, bytes: await entry.getData!(new Uint8ArrayWriter()) });
    }
  }

  return vnBook(name.replace(/\.(?:cbz|zip)$/i, ''), blobs, scripts, lastBookModified);
}

/**
 * A game folder picked or dropped as files (`vnFolders` in vn-upload.ts): the files are the
 * blobs as they are, keyed by their path inside the game folder.
 */
export async function loadVnFiles(
  title: string,
  files: Record<string, Blob>,
  lastBookModified: number
): Promise<LoadData> {
  const scripts = await Promise.all(
    Object.keys(files)
      .filter(isScriptPath)
      .map(async (path) => ({ path, bytes: new Uint8Array(await files[path].arrayBuffer()) }))
  );

  return vnBook(title, files, scripts, lastBookModified);
}

function vnBook(
  title: string,
  blobs: Record<string, Blob>,
  scripts: { path: string; bytes: Uint8Array }[],
  lastBookModified: number
): LoadData {
  const cover = Object.keys(blobs).find(
    (path) => !path.includes('/') && /(?:cover|icon).*\.(?:jpe?g|png|webp)$/i.test(path)
  );
  const { encoding, characters } = analyzeScripts(scripts);

  return {
    title,
    styleSheet: '',
    elementHtml: vnElementHtml({ encoding, files: Object.keys(blobs) }),
    blobs,
    coverImage: cover
      ? new Blob([blobs[cover]], { type: getMimeTypeFromName(cover) || '' })
      : undefined,
    hasThumb: !!cover,
    characters,
    lastBookModified,
    lastBookOpen: 0
  };
}

async function fetchOk(url: string) {
  const response = await serverFetch(url, { cache: 'no-cache' });

  if (!response.ok) throw new Error(`${decodeURI(url)}: HTTP ${response.status}`);

  return response;
}

/** Every file under a folder URL, through nginx's JSON directory listings. */
async function listFiles(base: string, prefix = ''): Promise<{ path: string; size: number }[]> {
  const entries: { name: string; type: string; size?: number }[] = await (
    await fetchOk(`${base}${encodePath(prefix)}`)
  ).json();
  const files: { path: string; size: number }[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.type === 'directory')
      files.push(...(await listFiles(base, `${prefix}${entry.name}/`)));
    else files.push({ path: `${prefix}${entry.name}`, size: entry.size || 0 });
  }

  return files;
}

/** Total bytes of a game folder on the server. */
export async function vnFolderSize(base: string) {
  return (await listFiles(base)).reduce((sum, file) => sum + file.size, 0);
}

/**
 * A game kept unpacked on the server (VN_PATH): only the file list and the script are
 * read here; the player fetches the other files when the engine opens them.
 * shortcut: the file list is taken when the game is first opened; files added to the
 * folder later are only seen after removing the game from the browser.
 */
export async function loadVnFolder(
  title: string,
  base: string,
  lastBookModified: number
): Promise<LoadData> {
  const files = (await listFiles(base)).map((file) => file.path);
  const scripts = await Promise.all(
    files.filter(isScriptPath).map(async (path) => ({
      path,
      bytes: new Uint8Array(await (await fetchOk(`${base}${encodePath(path)}`)).arrayBuffer())
    }))
  );
  const { encoding, characters } = analyzeScripts(scripts);

  return {
    title,
    styleSheet: '',
    elementHtml: vnElementHtml({ encoding, files, base }),
    blobs: {},
    coverImage: undefined,
    hasThumb: false,
    characters,
    lastBookModified,
    lastBookOpen: 0
  };
}
