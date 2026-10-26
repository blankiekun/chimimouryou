/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Windows visual novels, played in VNBox (static/vn/vnbox/, scripts/vnbox/build.sh): the game
 * folder is copied into this browser's origin private file system (OPFS `vnbox/<folder>`),
 * which VNBox reads lazily (`lazy=opfs:`), and the game is a book record in this browser
 * like an ONScripter game, with `engine: 'vnbox'` in its VnInfo and no blobs. Nothing is
 * uploaded anywhere. Not upstream.
 */

import { pagePath } from '$lib/data/env';
import { hashPage, vnElementHtml, type VnInfo } from '$lib/data/vn';
import type { LoadData } from '$lib/functions/file-loaders/types';

const opfsRoot = 'vnbox';

/** Why this browser can't play Windows games, or undefined when it can. */
export function windowsGameBlocker(win: Window = window): 'phone' | 'browser' | undefined {
  // Games want a mouse, a big screen and GBs of memory: phones and tablets are parked.
  if (!win.matchMedia?.('(any-pointer: fine)').matches) return 'phone';
  // VNBox's jitJspi build suspends WebAssembly on file reads (JSPI) and reads games from OPFS.
  if (!('Suspending' in WebAssembly) || !win.navigator.storage?.getDirectory) return 'browser';

  return undefined;
}

export const windowsGameBlockerText = {
  phone: 'Windows games play on a computer with a mouse. Open this game on a desktop browser.',
  browser:
    'Windows games need a browser with WebAssembly JSPI, such as Chrome or Edge 137 or newer.'
};

/** The game's OPFS folder name: ASCII, from its title (VNBox keys its saves by it). */
export function windowsGameFolder(title: string) {
  return `g${hashPage(title)}`;
}

const notGames =
  /(?:^|[\\/])(?:setup|install|uninst|unins\d*|config|vcredist|dxsetup|dotnet)[^\\/]*$/i;

/**
 * The folder's programs (.exe), the likeliest game first: setup, uninstall and config tools
 * last, then the shallowest, then the largest.
 */
export function windowsPrograms(files: Record<string, { size: number }>) {
  return Object.keys(files)
    .filter((path) => /\.exe$/i.test(path))
    .sort(
      (a, b) =>
        Number(notGames.test(a)) - Number(notGames.test(b)) ||
        a.split('/').length - b.split('/').length ||
        files[b].size - files[a].size ||
        a.localeCompare(b)
    );
}

/**
 * Copies a picked folder's files (path inside the game folder → file) into OPFS. Files already
 * there with the same size are kept, so a cancelled copy resumes.
 */
export async function copyWindowsGame(
  folder: string,
  files: Record<string, File>,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal
) {
  const root = await (
    await navigator.storage.getDirectory()
  ).getDirectoryHandle(opfsRoot, {
    create: true
  });
  const game = await root.getDirectoryHandle(folder, { create: true });
  const total = Object.values(files).reduce((sum, file) => sum + file.size, 0);
  let done = 0;

  onProgress(0, total);

  for (const [path, file] of Object.entries(files)) {
    signal?.throwIfAborted();

    const parts = path.split('/');
    let dir = game;

    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }

    const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });

    if ((await handle.getFile()).size !== file.size) {
      await file.stream().pipeTo(await handle.createWritable(), { signal });
    }

    done += file.size;
    onProgress(done, total);
  }
}

/** Whether the game's files are in this browser (another device, or cleared site data: not). */
export async function hasWindowsGame(folder: string) {
  try {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(opfsRoot);

    await root.getDirectoryHandle(folder);
    return true;
  } catch {
    return false;
  }
}

/**
 * Frees a deleted game's files. Its Wine prefix and saves stay in VNBox's IndexedDB, so adding
 * the game again keeps them.
 */
export async function deleteWindowsGame(folder: string) {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(opfsRoot);

  await root.removeEntry(folder, { recursive: true });
}

/** The game as a book record for this browser's library. */
export function windowsGameBook(
  title: string,
  exe: string,
  hook: string | undefined,
  cover: Blob | undefined
): LoadData {
  const info: VnInfo = {
    encoding: 'sjis',
    files: [],
    engine: 'vnbox',
    folder: windowsGameFolder(title),
    exe,
    ...(hook && { hook })
  };

  return {
    title,
    styleSheet: '',
    elementHtml: vnElementHtml(info),
    blobs: {},
    coverImage: cover,
    hasThumb: !!cover,
    // Unknown: the hook only sees what is shown, so there is no total for a percentage.
    characters: 0,
    lastBookModified: Date.now(),
    lastBookOpen: 0
  };
}

/**
 * The VNBox player's address: VNBox reads its settings from the URL when its scripts load
 * (boxedwine-shell.js; frida-compat.js fetches `frida`), so they go into the frame's address.
 * Japanese locale for Shift JIS games, and no Wine Mono/Gecko installs.
 */
export function vnboxPlayerUrl(info: VnInfo, hookUrl?: string) {
  const params = [
    'root=TinyCore15Wine11.0-web',
    'rootBase=vnbox',
    'overlay=jp.zip',
    'overlayBase=vnbox',
    `lazy=${encodeURIComponent(`opfs:${opfsRoot}/${info.folder}`)}`,
    `p=${encodeURIComponent(info.exe ?? '')}`,
    // VNBox's own syntax: a quoted key:value, the quotes as %22.
    'env=%22LC_ALL:ja_JP.UTF-8%22',
    'wine-override=[nomono]',
    // VNBox defaults to 11025 Hz.
    'audioFreq=44100',
    ...(hookUrl ? [`frida=${encodeURIComponent(hookUrl)}`] : [])
  ];

  return `${pagePath}/vn/vnbox.html?${params.join('&')}`;
}
