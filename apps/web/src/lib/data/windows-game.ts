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
 * Copies a picked folder's files (path inside the game folder → file) into OPFS, a few at a
 * time. Files already there with the same size are kept, so a cancelled copy resumes; a file
 * cut off by the abort is discarded by its writable. Progress is reported when the whole
 * percent changes or every 100 ms, and once at the end.
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
  // Promises, so files copied in parallel share one getDirectoryHandle per folder.
  const dirs = new Map([['', Promise.resolve(game)]]);
  const dirOf = (path: string): Promise<FileSystemDirectoryHandle> => {
    let dir = dirs.get(path);

    if (!dir) {
      const cut = path.lastIndexOf('/');

      dir = dirOf(path.slice(0, Math.max(cut, 0))).then((parent) =>
        parent.getDirectoryHandle(path.slice(cut + 1), { create: true })
      );
      dirs.set(path, dir);
    }

    return dir;
  };
  const queue = Object.entries(files);
  let next = 0;
  let done = 0;
  let percent = 0;
  let reported = Date.now();

  onProgress(0, total);

  async function worker() {
    try {
      while (next < queue.length) {
        signal?.throwIfAborted();

        const [path, file] = queue[next++];
        const cut = path.lastIndexOf('/');
        const dir = await dirOf(path.slice(0, Math.max(cut, 0)));
        const handle = await dir.getFileHandle(path.slice(cut + 1), { create: true });

        if ((await handle.getFile()).size !== file.size) {
          await file.stream().pipeTo(await handle.createWritable(), { signal });
        }

        done += file.size;

        const now = Date.now();
        const whole = Math.floor((done * 100) / (total || 1));

        if (whole !== percent || now - reported >= 100) {
          percent = whole;
          reported = now;
          onProgress(done, total);
        }
      }
    } catch (error) {
      // The other workers stop after their current file.
      next = queue.length;
      throw error;
    }
  }

  // Settled, so nothing is still writing when a failed copy returns.
  const failed = (await Promise.allSettled(Array.from({ length: 6 }, worker))).find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );

  if (failed) throw failed.reason;
  onProgress(done, total);
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
  cover: Blob | undefined,
  hookFile?: string
): LoadData {
  const info: VnInfo = {
    encoding: 'sjis',
    files: [],
    engine: 'vnbox',
    folder: windowsGameFolder(title),
    exe,
    ...(hook && { hook }),
    ...(hookFile && { hookFile })
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
/**
 * hookUrl: a blob: URL of a chosen script, made by the embedding page (VNBox loads only
 * same-origin blob: or /vn/ scripts); else a bundled script by its path from vnbox.html.
 */
export function vnboxPlayerUrl(info: VnInfo, hookUrl?: string) {
  const frida = hookUrl ?? (info.hookFile && `${hookBase}/${encodeURIComponent(info.hookFile)}`);
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
    // The MS Japanese font names (ＭＳ ゴシック…) as jp.zip's IPA fonts: without them titles
    // show tofu, and games that check the font they got (最果てのイマ) stop.
    'registry=jpfonts',
    // VNBox defaults to 11025 Hz.
    'audioFreq=44100',
    // The game's window fills VNBox's screen, which takes its size: no title bar or desktop.
    'fitWindow=true',
    ...(frida ? [`frida=${encodeURIComponent(frida)}`] : [])
  ];

  return `${pagePath}/vn/vnbox.html?${params.join('&')}`;
}

/** The bundled dc00 scripts (scripts/vnbox/build.sh), relative to vnbox.html. */
const hookBase = 'vnbox/hooks';

/** A bundled dc00 script: hook-index.mjs's index.json */
export interface HookScript {
  file: string;
  name: string;
  exes: string[];
}

/** The bundled scripts, or none when the build has no VNBox (pnpm dev without build.sh). */
export async function hookScripts(): Promise<HookScript[]> {
  try {
    const response = await fetch(`${pagePath}/vn/${hookBase}/index.json`);

    return response.ok ? await response.json() : [];
  } catch {
    return [];
  }
}

/** Games whose program names no script and whose title isn't the script's (hand-kept). */
const knownHooks: Record<string, string> = {
  '信天翁航海録.exe': 'PC_Albatross_Koukairoku.js'
};

/** Program names too common to say which game it is. */
const genericPrograms = /^(?:game|start|launcher|main|play|run|setup|app|player)\d*$/;

const hookKey = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

/** A script's names: each part of its @name ("Romaji (日本語)", "A / B") and its file name. */
function scriptKeys(script: HookScript) {
  const file = script.file.replace(/^PC_(?:Steam_|DMM_)?|\.js$/g, '');

  return [...script.name.split(/[/()（）]/), file].map(hookKey).filter((key) => key.length >= 3);
}

/**
 * The script for a game, or undefined: the hand-kept table, then a script that names the
 * program, then the best name match with the program's name, the folder's or the title.
 */
export function hookSuggestion(
  scripts: HookScript[],
  game: { exe: string; names: string[] }
): string | undefined {
  const program = game.exe.split(/[\\/]/).pop() ?? '';
  const known = knownHooks[program];

  if (known && scripts.some((script) => script.file === known)) return known;

  const byProgram = scripts.find((script) =>
    script.exes.some((exe) => exe.toLowerCase() === program.toLowerCase())
  );

  if (byProgram) return byProgram.file;

  const stem = hookKey(program.replace(/\.exe$/i, ''));
  const names = [...(genericPrograms.test(stem) ? [] : [stem]), ...game.names.map(hookKey)].filter(
    (name) => name.length >= 3
  );
  let best: { file: string; score: number } | undefined;

  for (const script of scripts) {
    for (const key of scriptKeys(script)) {
      for (const name of names) {
        // Equal names win; else the longer the shared name, the better (5+ characters, or 3+
        // in Japanese, where a word is a few characters).
        const short = Math.min(key.length, name.length);
        const enough = short >= (/[\u3040-\u9fff]/.test(key) ? 3 : 5);
        const score =
          key === name ? 1000 : enough && (key.includes(name) || name.includes(key)) ? short : 0;

        if (score && (!best || score > best.score)) best = { file: script.file, score };
      }
    }
  }

  return best?.file;
}

/** The scripts whose name or file name has the query in it. */
export function searchHookScripts(scripts: HookScript[], query: string) {
  const wanted = hookKey(query);

  return wanted
    ? scripts.filter((script) => hookKey(`${script.name} ${script.file}`).includes(wanted))
    : scripts;
}
