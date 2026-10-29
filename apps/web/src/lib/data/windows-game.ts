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

import { hookCleaner, type HookCleanup } from '$lib/data/hook-cleanup';
import { pagePath } from '$lib/data/env';
import { hashPage, vnElementHtml, type VnInfo } from '$lib/data/vn';
import type { LoadData } from '$lib/functions/file-loaders/types';
import { BlobReader, WritableStreamWriter, ZipReader, type Entry } from '@zip.js/zip.js';

const opfsRoot = 'vnbox';

/** Why this browser can't play Windows games, or undefined when it can. */
export function windowsGameBlocker(win: Window = window): 'https' | 'browser' | undefined {
  // Phones and tablets play too (taps are the left button, /v adds Menu and Skip buttons).
  // OPFS exists only in secure contexts: a plain-HTTP install has none, whatever the browser.
  if (!win.isSecureContext) return 'https';
  // VNBox's jitJspi build suspends WebAssembly on file reads (JSPI) and reads games from OPFS.
  if (!('Suspending' in WebAssembly) || !win.navigator.storage?.getDirectory) return 'browser';

  return undefined;
}

export const windowsGameBlockerText = {
  https: 'Windows games need this site over HTTPS: browsers keep game files only for secure pages.',
  browser:
    'Windows games need a browser with WebAssembly JSPI, such as Chrome or Edge 137 or newer, or Firefox 153 or newer.'
};

/** About the root fs and jp.zip VNBox copies into OPFS on first start, on top of the game. */
export const vnboxZipsSize = 120 * 1024 ** 2;

/**
 * VNBox's error (lazyfs.js vnbox-error) as /v shows it: a full browser storage gets its fix,
 * since Firefox keeps a site to 10% of the disk until the site may store data persistently.
 */
export function vnboxErrorText(message: string) {
  return /quota/i.test(message)
    ? "This browser's storage for the site is full, so the game's files couldn't be copied. Allow the site to store data persistently when the browser asks (Firefox: the permission in the address bar), or free space by removing games you don't play, then open the game again."
    : `The player couldn't load its files: ${message}`;
}

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
  // A folder path (discs/<id>) is made a folder at a time.
  const game = await folder
    .split('/')
    .reduce(
      (dir, name) => dir.then((parent) => parent.getDirectoryHandle(name, { create: true })),
      Promise.resolve(root)
    );
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

/**
 * A ZIP of a game folder as the picked folder's files (path → file), for browsers that can't
 * pick folders (phones). Nothing is unpacked here: each file streams out of the ZIP when
 * copied (`stream()`), so a game of a few GB never sits in memory. A folder every file is in
 * (the zipped folder itself) is left out of the paths and named the game; `__MACOSX` and
 * hidden files are skipped. Names not marked UTF-8 are read as Shift JIS (Japanese Windows).
 */
export async function zipGameFiles(zip: File) {
  const entries = (
    await new ZipReader(new BlobReader(zip), { filenameEncoding: 'shift_jis' }).getEntries()
  ).filter(
    (entry) =>
      !entry.directory &&
      !entry.filename.split('/').some((part) => part.startsWith('.') || part === '__MACOSX')
  );
  const top = entries[0]?.filename.split('/')[0];
  const nested = !!top && entries.every((entry) => entry.filename.startsWith(`${top}/`));
  const files: Record<string, File> = {};

  for (const entry of entries) {
    files[nested ? entry.filename.slice(top.length + 1) : entry.filename] = zipEntryFile(entry);
  }

  return { name: nested ? top : zip.name.replace(/\.zip$/i, ''), files };
}

/** As much of a File as copying and reading programs need: name, size and stream(). */
function zipEntryFile(entry: Entry) {
  const stream = () => {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = new WritableStreamWriter(writable);

    // A broken entry errors the stream, or its reader would wait for good.
    entry.getData!(writer)
      .catch((error) =>
        (writer as unknown as { writer: WritableStreamDefaultWriter }).writer.abort(error)
      )
      .catch(() => {});
    return readable;
  };

  return {
    name: entry.filename.slice(entry.filename.lastIndexOf('/') + 1),
    size: entry.uncompressedSize,
    stream
  } as unknown as File;
}

/** A file's first `length` bytes, read from its stream (zipGameFiles' files have no slice). */
export async function readHead(file: File, length: number) {
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (size < length) {
    const { done, value } = await reader.read();

    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});

  const head = new Uint8Array(Math.min(size, length));

  chunks.reduce((at, chunk) => {
    head.set(chunk.subarray(0, head.length - at), at);
    return at + chunk.length;
  }, 0);
  return head;
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
 * Frees a deleted game's files, its disc images included (windows-install discFolder). Its Wine
 * prefix and saves stay in VNBox's IndexedDB, so adding the game again keeps them.
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
  hookFile?: string,
  discs?: string[]
): LoadData {
  const info: VnInfo = {
    encoding: 'sjis',
    files: [],
    engine: 'vnbox',
    folder: windowsGameFolder(title),
    exe,
    ...(hook && { hook }),
    ...(hookFile && { hookFile }),
    ...(discs?.length && { discs })
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
export function vnboxPlayerUrl(info: VnInfo, hookUrl?: string, tuning = '') {
  // Per path segment: LunaHook engine ports live in engines/, and VNBox refuses an encoded /.
  const hookPath = info.hookFile?.split('/').map(encodeURIComponent).join('/');
  const frida = hookUrl ?? (hookPath && `${hookBase}/${hookPath}`);
  // VNBox mounts the game folder there (boxedwine-shell.js appDirPrefix + its name).
  const gameDir = `C:\\files\\${info.folder}`;
  const params = [
    'root=TinyCore15Wine11.0-web',
    'rootBase=vnbox',
    'overlay=jp.zip',
    'overlayBase=vnbox',
    `lazy=${encodeURIComponent(`opfs:${opfsRoot}/${info.folder}`)}`,
    // A program in a subfolder: its full Windows path (a `cmd /c` chain reads `a/b.exe` as a
    // switch), run in its own folder as a shortcut would, so it finds its files.
    ...(info.exe?.includes('/')
      ? [
          `p=${encodeURIComponent(`${gameDir}\\${info.exe.replaceAll('/', '\\')}`)}`,
          `w=${encodeURIComponent(`${gameDir}\\${info.exe.slice(0, info.exe.lastIndexOf('/')).replaceAll('/', '\\')}`)}`
        ]
      : [`p=${encodeURIComponent(info.exe ?? '')}`]),
    // VNBox's own syntax: a quoted key:value, the quotes as %22.
    'env=%22LC_ALL:ja_JP.UTF-8%22',
    `wine-override=${encodeURIComponent(`[${wineOverrides}]`)}`,
    // The MS Japanese font names (ＭＳ ゴシック…) as jp.zip's IPA fonts: without them titles
    // show tofu, and games that check the font they got (最果てのイマ) stop.
    'registry=jpfonts',
    // VNBox defaults to 11025 Hz.
    'audioFreq=44100',
    // The game's window fills VNBox's screen, which takes its size: no title bar or desktop.
    'fitWindow=true',
    ...(frida ? [`frida=${encodeURIComponent(frida)}`] : []),
    // Read from OPFS on demand, disc 1 in the drive (VNBox after v0.2.0; the page swaps discs).
    ...(info.discs?.length
      ? [
          `cdrom=${encodeURIComponent(info.discs.map((disc) => `opfs:${opfsRoot}/${disc}`).join(';'))}`
        ]
      : [])
  ];

  // The tuning panel's `a=b&c=d`, as typed (VNBox reads raw values, e.g. env's %22). VNBox takes
  // the first `key=` in the address, so a tuned key replaces the default in place.
  for (const pair of tuning.replaceAll('#', '%23').split('&')) {
    const key = pair.split('=')[0];

    if (!key || lockedParams.has(key)) continue;

    const at = params.findIndex((param) => param.split('=')[0] === key);

    if (at < 0) params.push(pair);
    else params[at] = pair;
  }

  return `${pagePath}/vn/vnbox.html?${params.join('&')}`;
}

/** The game folder, program and hook: never tuned. */
const lockedParams = new Set(['lazy', 'p', 'frida', 'cdrom']);

const tuningKey = (folder: string) => `vnboxTuning:${folder}`;

/** A game's VNBox tuning (`a=b&c=d`), in this browser only, keyed by its folder like its saves. */
export function loadVnboxTuning(folder: string) {
  try {
    return localStorage.getItem(tuningKey(folder)) ?? '';
  } catch {
    return '';
  }
}

export function saveVnboxTuning(folder: string, tuning: string) {
  try {
    if (tuning) localStorage.setItem(tuningKey(folder), tuning);
    else localStorage.removeItem(tuningKey(folder));
  } catch {
    // Storage blocked: the restart runs with the defaults.
  }
}

/**
 * A game's Wine fixes from the Tuning sheet's Compatibility section, kept in its tuning as VNBox
 * address settings (`registry`, `wine-override`, `wine-env`, `reg`, `desktop`; VNBox #37 for the
 * last four and dll items). Players set them; nothing is guessed.
 */
export interface VnboxCompat {
  /** registry= preset: Wine's Direct3D renderer ('' = not set) */
  renderer: string;
  /** registry= preset: the Windows version Wine reports, win95…win10 ('' = not set) */
  version: string;
  /** false: quartz disabled, so DirectShow movies don't play (games often skip them) */
  movies: boolean;
  /** A Wine virtual desktop WIDTHxHEIGHT ('' = none) */
  desktop: string;
  dlls: { name: string; mode: 'n' | 'b' | '' }[];
  registry: { key: string; name: string; type: 'REG_SZ' | 'REG_DWORD'; value: string }[];
  env: { name: string; value: string }[];
}

/**
 * vnboxPlayerUrl's wine-override: no Mono/Gecko installs, and no crash debugger (a launcher that
 * faults as it hands over to its game would start winedbg, which is slow here and takes the screen).
 */
export const wineOverrides = ['nomono', 'winedbg.exe='];

export const compatKeys = new Set(['registry', 'wine-override', 'wine-env', 'reg', 'desktop']);
const versions = ['win95', 'win98', 'winme', 'win2k', 'winxp', 'win7', 'win10'];

// The same checks as VNBox's shell: values reach a `cmd /c reg add … &` chain and Wine's env.
export const validDesktop = (size: string) => /^\d{3,4}x\d{3,4}$/.test(size);
export const validDll = (dll: VnboxCompat['dlls'][number]) => /^[a-z0-9_.-]{1,64}$/i.test(dll.name);
export const validEnv = ({ name, value }: VnboxCompat['env'][number]) =>
  /^[A-Za-z_]\w{0,63}$/.test(name) &&
  name.toUpperCase() !== 'WINEDLLOVERRIDES' &&
  // eslint-disable-next-line no-control-regex
  !/[\x00-\x1f]/.test(value) &&
  value.length <= 1000;
export const validReg = ({ key, name, type, value }: VnboxCompat['registry'][number]) =>
  /^(HKCU|HKLM|HKEY_CURRENT_USER|HKEY_LOCAL_MACHINE)\\Software(\\[^\\]+)*$/i.test(key) &&
  // eslint-disable-next-line no-control-regex
  [key, name, value].every((field) => field.length <= 260 && !/["&|<>^%\x00-\x1f]/.test(field)) &&
  (type === 'REG_SZ' || /^(0x[0-9a-f]{1,8}|\d{1,10})$/i.test(value));

/** Reads the Compatibility settings back from a tuning's `a=b` pairs. */
export function compatFromTuning(pairs: string[]): VnboxCompat {
  const get = (key: string) => {
    const pair = pairs.find((p) => p.split('=')[0] === key);

    try {
      return pair ? decodeURIComponent(pair.slice(key.length + 1)) : '';
    } catch {
      return '';
    }
  };
  const lines = (key: string) => get(key).split('\n').filter(Boolean);
  const list = (key: string) =>
    get(key)
      .replace(/^\[|\]$/g, '')
      .split(',');
  const presets = list('registry');
  const overrides = list('wine-override').filter(
    (item) => item.includes('=') && !wineOverrides.includes(item)
  );

  return {
    renderer: presets.find((name) => name === 'gl' || name === 'gdi') ?? '',
    version: presets.find((name) => versions.includes(name)) ?? '',
    movies: !overrides.includes('quartz='),
    desktop: get('desktop'),
    dlls: overrides
      .filter((item) => item !== 'quartz=')
      .map((item) => {
        const [name, mode] = item.split('=');

        return { name, mode: mode === 'n' || mode === 'b' ? mode : '' };
      }),
    registry: lines('reg').map((line) => {
      const [key = '', name = '', type, value = ''] = line.split('\t');

      return { key, name, type: type === 'REG_DWORD' ? type : 'REG_SZ', value };
    }),
    env: lines('wine-env').map((line) => ({
      name: line.slice(0, Math.max(0, line.indexOf('='))),
      value: line.slice(line.indexOf('=') + 1)
    }))
  };
}

/**
 * The Compatibility settings as VNBox address settings (encoded: no `&`, `=` or `#` inside a
 * value), invalid rows left out. They replace vnboxPlayerUrl's `registry=jpfonts` and
 * `wineOverrides`, so both stay in.
 */
export function compatParams(compat: VnboxCompat): string[] {
  const presets = [compat.renderer, compat.version].filter(Boolean);
  const overrides = [
    ...(compat.movies ? [] : ['quartz=']),
    ...compat.dlls.filter(validDll).map((dll) => `${dll.name.toLowerCase()}=${dll.mode}`)
  ];
  const reg = compat.registry
    .filter(validReg)
    .map((row) => [row.key, row.name, row.type, row.value].join('\t'));
  const env = compat.env.filter(validEnv).map((row) => `${row.name}=${row.value}`);
  const param = (key: string, items: string[], join: string) =>
    items.length ? [`${key}=${encodeURIComponent(items.join(join))}`] : [];

  return [
    ...param('registry', presets.length ? ['jpfonts', ...presets] : [], ','),
    ...param('wine-override', overrides.length ? [...wineOverrides, ...overrides] : [], ','),
    ...param('wine-env', env.slice(0, 32), '\n'),
    ...param('reg', reg.slice(0, 64), '\n'),
    ...(validDesktop(compat.desktop) ? [`desktop=${compat.desktop}`] : [])
  ];
}

/** The screen VNBox starts at without a `resolution` (its StartUpArgs default). */
const startScreen = { width: 800, height: 600 };
/** The screen a capped game is started on once to get its size: room for 1920x1080 and a title bar. */
export const learnResolution = '1920x1200';

const withResolution = (tuning: string, resolution: string) =>
  [
    ...tuning.split('&').filter((pair) => pair && !pair.startsWith('resolution=')),
    `resolution=${resolution}`
  ].join('&');

/**
 * The game's tuning after VNBox's screen took the game window's size (fitWindow), or undefined to
 * keep it. Wine caps a new window at the screen plus its frame, so a game bigger than the 800x600
 * start comes out a few pixels over it, cut off (Muramasa, 1024x576: 806x576). Such a game is
 * started once on a big screen (`restart`), where the window gets its own size, which is then
 * kept as its resolution for the next start. Games that fit, and tuned sizes, are left alone.
 */
export function fittedTuning(
  tuning: string,
  width: number,
  height: number
): { tuning: string; restart: boolean } | undefined {
  const resolution = tuning
    .split('&')
    .find((pair) => pair.startsWith('resolution='))
    ?.slice(11);
  // Display mode changes (1024x768…) land far over the start; a capped window only its frame's width.
  const over = (size: number, start: number) => size > start && size <= start + 32;

  if (!resolution) {
    return over(width, startScreen.width) || over(height, startScreen.height)
      ? { tuning: withResolution(tuning, learnResolution), restart: true }
      : undefined;
  }
  // On the big screen: a splash window can come first, so only a size the start couldn't hold,
  // shaped like a game screen (a crash dialog or launcher strip can be 1777x400).
  if (
    resolution === learnResolution &&
    `${width}x${height}` !== learnResolution &&
    (width > startScreen.width || height > startScreen.height) &&
    width >= 640 &&
    height >= 480 &&
    width <= height * 2
  ) {
    return { tuning: withResolution(tuning, `${width}x${height}`), restart: false };
  }
  return undefined;
}

/** The bundled dc00 scripts (scripts/vnbox/build.sh), relative to vnbox.html. */
const hookBase = 'vnbox/hooks';

/** A bundled script: hook-index.mjs's index.json */
export interface HookScript {
  file: string;
  name: string;
  exes: string[];
  /**
   * A LunaHook engine port (scripts/vnbox/engines/): per engine its place in LunaHook's check
   * order and the game files it checks for, all of them or any one (CheckFile names: * and ?
   * wildcards, relative to the program's folder)
   */
  luna?: { order: number; all?: string[]; any?: string[] }[];
}

/** The bundled scripts, or none when the build has no VNBox (pnpm dev without build.sh). */
export async function hookScripts(): Promise<HookScript[]> {
  try {
    // Hosts cache /vn/vnbox/ for a day, but the index changes under the same name
    const response = await fetch(`${pagePath}/vn/${hookBase}/index.json`, { cache: 'no-cache' });

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
 * LunaHook's Util::CheckFile over the game's files: a name with * and ? wildcards, matched
 * case-insensitively against the files and folders in the program's folder (or below it, for a
 * name with a folder in it).
 */
export function lunaFileCheck(name: string, files: string[], exe: string) {
  const exeDir = exe.includes('/') ? exe.slice(0, exe.lastIndexOf('/') + 1) : '';
  const paths = new Set<string>();

  for (const file of files) {
    if (!file.startsWith(exeDir)) continue;

    const parts = file.slice(exeDir.length).split('/');

    parts.forEach((_, at) =>
      paths.add(
        parts
          .slice(0, at + 1)
          .join('/')
          .toLowerCase()
      )
    );
  }

  const spec = name.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
  const pattern = new RegExp(
    `^${spec
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replaceAll('*', '[^/]*')
      .replaceAll('?', '[^/]')}$`
  );

  return [...paths].some((path) => pattern.test(path));
}

/** The LunaHook engine first in LunaHook's order whose file checks pass, or undefined. */
function lunaSuggestion(scripts: HookScript[], files: string[], exe: string) {
  let best: { file: string; order: number } | undefined;

  for (const script of scripts) {
    for (const engine of script.luna ?? []) {
      const check = (name: string) => lunaFileCheck(name, files, exe);
      const passes = engine.all
        ? engine.all.every(check)
        : engine.any
          ? engine.any.some(check)
          : false;

      if (passes && (!best || engine.order < best.order))
        best = { file: script.file, order: engine.order };
    }
  }

  return best?.file;
}

/**
 * The script for a game, or undefined: the hand-kept table, then a script that names the
 * program, then the best name match with the program's name, the folder's or the title, then
 * the LunaHook engine whose file checks the game's files pass.
 */
export function hookSuggestion(
  scripts: HookScript[],
  game: { exe: string; names: string[]; files?: string[] }
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

  return best?.file ?? (game.files && lunaSuggestion(scripts, game.files, game.exe));
}

/** The scripts whose name or file name has the query in it. */
export function searchHookScripts(scripts: HookScript[], query: string) {
  const wanted = hookKey(query);

  return wanted
    ? scripts.filter((script) => hookKey(`${script.name} ${script.file}`).includes(wanted))
    : scripts;
}

/** A hook thread as vnbox.js keeps it (VNBox's boxedwineText(line, thread)). */
export interface HookThread {
  id: string;
  label?: string;
  kind: 'script' | 'hcode' | 'search';
  address?: string;
  module?: string;
  last?: string;
  count: number;
  /** The newest lines (up to 20), with the count of clicks and keys before each */
  recent: { text: string; click: number }[];
}

// Kana, kanji and Japanese punctuation (、。「」 and full-width forms)
const japaneseChar = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/u;

/**
 * Threads best first for picking the game's text: one line per click (char-by-char hooks send
 * many), mostly Japanese, few repeats (menus and redraws repeat) and longer than one character,
 * after the game's text cleanup (lines it drops don't count). score is 0-1.
 */
export function rankThreads(threads: HookThread[], cleanup: HookCleanup = {}) {
  return threads
    .map((thread) => {
      const clean = hookCleaner(cleanup);
      const lines = thread.recent
        .map((line) => ({ ...line, text: clean(line.text) }))
        .filter((line) => line.text);
      const share = (count: number) => (lines.length ? count / lines.length : 0);
      const chars = lines.flatMap((line) => [...line.text.replace(/\s/g, '')]);
      const score =
        share(new Set(lines.map((line) => line.click)).size) *
        (chars.length ? chars.filter((char) => japaneseChar.test(char)).length / chars.length : 0) *
        share(new Set(lines.map((line) => line.text)).size) *
        share(lines.filter((line) => [...line.text.trim()].length > 1).length);

      return { thread, score };
    })
    .sort((a, b) => b.score - a.score);
}

/** The game's saved hook for people: the script's @name, its file, or undefined for none. */
export function savedHookName(info: Pick<VnInfo, 'hook' | 'hookFile'>) {
  if (info.hook) return info.hook.match(/@name\s+(.+)/)?.[1].trim() || 'Chosen script';

  return info.hookFile;
}
