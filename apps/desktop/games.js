/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Windows games played natively: where each library game is installed on this computer, and its
// launch through chimihook (lunahook/, a separate GPL-3.0 program; scripts/fetch-lunahook.sh) with
// its text lines sent to the page that started it. Windows starts the game through Locale
// Remulator; Linux through the user's Wine, one prefix per game.
//
// Install paths live only in <userData>/native-games.json, written only after main's own folder
// dialog: a page names a game by its record's folder and never hands main a path to run.

import { Buffer } from 'node:buffer';
import { execFile, spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { gameMedia } from './game-media.js';
import { gameOverlay, overlaySettings } from './overlay.js';

/** Programs listed last when a folder is picked: setup and settings tools, not the game. */
const toolPattern =
  /^(setup|install|uninst|unins\d*|config|configure|settings?|update|updater|patch|vcredist|dxsetup|dotnet|directx)/i;

/** How a folder or title compares: NFKC, lower case, letters and digits only. */
const nameKey = (text) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

/**
 * The .exe files in `dir` and one level down (people pick the parent folder), as paths relative to
 * it with `/`: the record's program first (case-insensitive, as Windows; its path, else its name),
 * then the rest by name with setup tools last.
 */
export function listPrograms(dir, wanted = '') {
  const found = [];
  const scan = (folder, depth) => {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory() && depth === 0) scan(path, 1);
      else if (entry.isFile() && /\.exe$/i.test(entry.name))
        found.push(relative(dir, path).split('\\').join('/'));
    }
  };
  scan(dir, 0);
  const want = wanted.toLowerCase().replaceAll('\\', '/');
  const wantName = want.split('/').pop();
  const rank = (path) => {
    const lower = path.toLowerCase();
    if (want && lower === want) return 0;
    if (want && lower.split('/').pop() === wantName) return 1;
    return toolPattern.test(lower.split('/').pop()) ? 3 : 2;
  };
  const programs = found.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, 200);
  return { programs, match: programs.length && want && rank(programs[0]) < 2 ? 0 : -1 };
}

/** A folder named unlike the game: neither name holds the other. */
export function nameDiffers(folderName, title) {
  const a = nameKey(folderName);
  const b = nameKey(title);
  return !!a && !!b && !a.includes(b) && !b.includes(a);
}

/** The stored install path of each game, by its record's folder. */
export function loadStore(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value.games === 'object' ? value : { games: {} };
  } catch {
    return { games: {} };
  }
}

const run = (command, args, options = {}) =>
  new Promise((resolve) =>
    execFile(command, args, { timeout: 600_000, ...options }, (error, stdout) =>
      resolve(error ? undefined : stdout.toString())
    )
  );

/** Wine: its version, and whether this system has the Japanese UTF-8 locale it runs games in. */
async function wineStatus() {
  const version = (await run('wine', ['--version'], { timeout: 10_000 }))?.trim();
  const locales = (await run('locale', ['-a'], { timeout: 10_000 })) ?? '';
  const winetricks = !!(await run('winetricks', ['--version'], { timeout: 10_000 }));
  return {
    version: version || undefined,
    japaneseLocale: /^ja_JP\.utf-?8$/im.test(locales),
    winetricks
  };
}

/** VNBox's prefix user (vn-save-store.ts vnSaveAreas: `home/username/.wine`): saves sync under it. */
const userKey = 'wine/drive_c/users/username/';

/** A synced name's path parts below its root, or undefined when it could leave it. */
const keyParts = (rest) => {
  const parts = rest.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..' && !/[\\:\0]/.test(part))
    ? parts
    : undefined;
};

/** vn-save-store.ts isWindowsSaveKey's save folders, ported: main can't trust the page's check. */
const userFolders =
  /^wine\/drive_c\/(?:users\/[^/]+\/(?:AppData|Documents|Saved Games)|ProgramData(?=\/(?!Microsoft\/)))\/(.+)$/i;
const notSaves = /^(?:temp|tmp)$|cache/i;
/** Windows' own folders: Startup and Start Menu are in AppData/Roaming/Microsoft. */
const systemFolders = /^wine\/drive_c\/(?:users\/[^/]+\/AppData\/[^/]+|ProgramData)\/microsoft\//i;
/** Files Windows or a game runs or loads (Windows drops trailing dots and spaces). */
const runnable =
  /\.(?:exe|dll|asi|ocx|sys|cpl|scr|com|bat|cmd|ps1|vbs|js|jse|wsf|msi|lnk|url|reg|hta|inf|pif)[. ]*$/i;

/**
 * Whether main may write or read a synced name: isWindowsSaveKey's rules plus no Microsoft
 * folder, no runnable file, no 8.3 short name (`MICROS~1` reaches Microsoft) and no part ending
 * in a dot or space (Windows drops them: `Microsoft.`, `.. `).
 */
export function isSafeSaveName(name) {
  const parts = typeof name === 'string' ? keyParts(name) : undefined;
  if (
    !parts ||
    parts.length < 2 ||
    runnable.test(name) ||
    parts.some((part) => /~\d|[. ]$/.test(part))
  )
    return false;
  if (parts[0] === 'game') return true;
  const inUser = userFolders.exec(name)?.[1];
  return (
    !!inUser && !systemFolders.test(name) && !inUser.split('/').some((part) => notSaves.test(part))
  );
}

/**
 * The files under `dir` as `{ path (relative, '/'), modified (ms), size }`. Links are never
 * followed: a prefix folder linked into the real home isn't the game's.
 */
function walkFiles(dir, prefix = '') {
  let entries;
  try {
    entries = readdirSync(join(dir, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return walkFiles(dir, path);
    if (!entry.isFile()) return [];
    const stat = statSync(join(dir, path));
    return [{ path, modified: Math.floor(stat.mtimeMs), size: stat.size }];
  });
}

/** The install folder's files when it was linked: files new or changed since are the game's saves. */
const manifestOf = (dir) =>
  Object.fromEntries(walkFiles(dir).map((file) => [file.path, `${file.size}:${file.modified}`]));

/** `Z:\…` for a Linux path, as Wine's Z: drive maps the root. */
const winePath = (path) => `Z:${path.replaceAll('/', '\\')}`;

/**
 * Registers the games IPC. `hookDir` holds chimihook and LunaHook; `isApp(event)` says whether
 * the sender is one of the app's own pages.
 */
export function registerGames({
  app,
  dialog,
  ipcMain,
  BrowserWindow,
  desktopCapturer,
  screen,
  hookDir,
  overlayUrl,
  preload,
  prepare,
  isApp
}) {
  const storeFile = join(app.getPath('userData'), 'native-games.json');
  const prefixes = join(app.getPath('userData'), 'wine-prefixes');
  const fontDir = join(app.getPath('userData'), 'wine-fonts');
  const platform = process.platform;
  let store = loadStore(storeFile);
  /** Folders picked and waiting for the page's confirmation, by id. */
  const picks = new Map();
  /** The game running now: one at a time. Its messages are kept for /hook to replay. */
  let session;
  /** Its sound and screenshots, for Anki (game-media.js). */
  const media = gameMedia({ desktopCapturer, platform });
  app.on('will-quit', () => media.stop());
  /** The text overlay over the game (overlay.js), while it runs, /hook is open and it's on. */
  const overlay = gameOverlay({
    BrowserWindow,
    screen,
    url: overlayUrl,
    preload,
    prepare,
    platform
  });
  // Wayland gives no window positions: main.js starts the app on X11 (XWayland) while it's on.
  const noX11 =
    platform === 'linux' &&
    (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY) &&
    app.commandLine.getSwitchValue('ozone-platform') !== 'x11';
  const overlayOn = () =>
    overlaySettings(store.overlay).on && (platform === 'win32' || platform === 'linux') && !noX11;
  /** Opens or closes the overlay to match the game, /hook and the setting. */
  const syncOverlay = () => {
    const wanted = session?.running && !session.sender.isDestroyed() && overlayOn();
    if (!wanted) overlay.close();
    else if (!overlay.webContents) {
      const { folder } = session;
      overlay.open(store.games[folder]?.overlay, overlaySettings(store.overlay), (area) =>
        update(folder, { overlay: area })
      );
      if (session.window) overlay.window(session.window);
    }
  };
  /** /hook's page closing takes the overlay with it (its lines come from there). */
  const watchSender = (sender) => sender.once('destroyed', () => setTimeout(syncOverlay));

  const save = () => {
    writeFileSync(storeFile, JSON.stringify(store, null, 2));
  };

  const handle = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!isApp(event)) throw new Error('Not the app');
      return fn(event, ...args);
    });

  // A child's late lines go to its own session, never to a game started after it.
  const send = (message, target = session) => {
    if (!target) return;
    target.messages.push(message);
    if (target.messages.length > 500) target.messages.splice(0, target.messages.length - 400);
    if (!target.sender.isDestroyed()) target.sender.send('native-hook', message);
  };

  const status = (text) => send({ type: 'status', text });

  const update = (folder, changes) => {
    store = {
      ...store,
      games: { ...store.games, [folder]: { ...store.games[folder], ...changes } }
    };
    save();
  };

  /**
   * Where synced save names live on this computer, as [name prefix, folder]: on Linux the game's
   * own prefix (its user folders and ProgramData), on Windows the user's own folders, of which
   * only the game's save folders (`saveFolders`) are read or written.
   */
  const saveRoots = (folder, game) =>
    platform === 'win32'
      ? [
          [`${userKey}AppData/`, join(homedir(), 'AppData')],
          [`${userKey}Documents/`, app.getPath('documents')],
          [`${userKey}Saved Games/`, join(homedir(), 'Saved Games')],
          ['wine/drive_c/ProgramData/', process.env.ProgramData ?? 'C:\\ProgramData'],
          ['game/', game.installDir]
        ]
      : [
          [userKey, join(prefixes, folder, 'drive_c/users', userInfo().username)],
          ['wine/drive_c/ProgramData/', join(prefixes, folder, 'drive_c/ProgramData')],
          ['game/', game.installDir]
        ];

  /** A synced name's root folder and path parts below it, or undefined. */
  const locate = (folder, game, name) => {
    const [prefix, dir] = saveRoots(folder, game).find(([start]) => name.startsWith(start)) ?? [];
    const parts = prefix && keyParts(name.slice(prefix.length));
    return parts && { dir, parts };
  };

  /** A Windows save folder, as a name: `…/AppData/<Roaming|Local|LocalLow>/<name>`, `…/Documents/<name>`… */
  const topFolder = (name) =>
    /^(wine\/drive_c\/(?:users\/username\/(?:AppData\/[^/]+|Documents|Saved Games)|ProgramData)\/[^/]+)\//.exec(
      name
    )?.[1];

  /** The folders a game may make its save folder in on Windows, watched on its first run. */
  const watchedParents = () =>
    [
      ['AppData/Roaming', join(homedir(), 'AppData/Roaming')],
      ['AppData/Local', join(homedir(), 'AppData/Local')],
      ['AppData/LocalLow', join(homedir(), 'AppData/LocalLow')],
      ['Documents', app.getPath('documents')],
      ['Saved Games', join(homedir(), 'Saved Games')]
    ]
      .map(([name, dir]) => [`${userKey}${name}/`, dir])
      .concat([['wine/drive_c/ProgramData/', process.env.ProgramData ?? 'C:\\ProgramData']]);

  /** The folders in watchedParents with their modified times. */
  const topFolders = () =>
    Object.fromEntries(
      watchedParents().flatMap(([prefix, dir]) => {
        try {
          return readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => [prefix + entry.name, statSync(join(dir, entry.name)).mtimeMs]);
        } catch {
          return [];
        }
      })
    );

  /**
   * Writes synced save files newer than this computer's (the game not running), as VNBox's
   * writeWindowsSaves: the synced time kept, never over a folder or link, never through a link.
   */
  function writeSaves(folder, game, saves) {
    const saveFolders = new Set(game.saveFolders);
    const pending = new Set(game.pending);
    const saveNames = new Set(game.saveNames);
    for (const [name, file] of Object.entries(saves ?? {})) {
      const at = isSafeSaveName(name) && locate(folder, game, name);
      if (!at || typeof file?.data !== 'string' || !Number.isFinite(file.modified)) continue;
      if (name.startsWith('game/')) saveNames.add(name);
      else if (platform === 'win32') {
        // Only into a folder of this game's, confirmed on /hook: a synced name never adds one.
        const top = topFolder(name);
        if (!top || game.refused?.includes(top)) continue;
        if (!saveFolders.has(top)) {
          pending.add(top);
          continue;
        }
      }
      const target = join(at.dir, ...at.parts);
      const blocked = at.parts.some((_, index) => {
        try {
          const stat = lstatSync(join(at.dir, ...at.parts.slice(0, index + 1)));
          return index < at.parts.length - 1
            ? !stat.isDirectory()
            : !stat.isFile() || Math.floor(stat.mtimeMs) >= file.modified;
        } catch {
          return false;
        }
      });
      if (blocked) continue;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(file.data, 'base64'));
      utimesSync(target, new Date(), new Date(file.modified));
    }
    update(folder, { pending: pending.size ? [...pending] : undefined, saveNames: [...saveNames] });
  }

  /**
   * This computer's save files of a game as synced names: on Linux everything in its prefix's user
   * folders and ProgramData (the page keeps isWindowsSaveKey's), on Windows its save folders;
   * from the install folder, files new or changed since it was linked and those already synced.
   */
  function listSaves(folder, game) {
    const roots =
      platform === 'win32'
        ? (game.saveFolders ?? []).flatMap((top) => {
            const at = locate(folder, game, top);
            return at ? [[`${top}/`, join(at.dir, ...at.parts)]] : [];
          })
        : saveRoots(folder, game).filter(([prefix]) => prefix !== 'game/');
    const known = new Set(game.saveNames);
    const manifest = game.manifest ?? {};
    // Named as synced, so a folder outside the save rules (browser profiles, Microsoft's) never goes up.
    return [
      ...roots.flatMap(([prefix, dir]) =>
        walkFiles(dir).map((file) => ({
          ...file,
          name: prefix + file.path,
          full: join(dir, file.path)
        }))
      ),
      ...walkFiles(game.installDir)
        .map((file) => ({
          ...file,
          name: `game/${file.path}`,
          full: join(game.installDir, file.path)
        }))
        .filter(
          (file) => known.has(file.name) || manifest[file.path] !== `${file.size}:${file.modified}`
        )
    ].filter((file) => isSafeSaveName(file.name));
  }

  /**
   * A new prefix for a game: Wine's first start without the Mono/Gecko prompts, the user folders
   * Wine links into the real home made plain folders (saves stay in the prefix), and the Japanese
   * fonts (winetricks fakejapanese) with the font files linked to one shared copy.
   */
  async function makePrefix(prefix, env) {
    mkdirSync(prefix, { recursive: true });
    status('Setting up Wine for this game (first start only, about a minute)…');
    await run('wine', ['wineboot', '-i'], { env });
    await run('wineserver', ['-w'], { env });
    const user = join(prefix, 'drive_c/users', userInfo().username);
    for (const name of existsSync(user) ? readdirSync(user) : []) {
      const path = join(user, name);
      if (lstatSync(path).isSymbolicLink()) {
        rmSync(path);
        mkdirSync(path);
      }
    }
    if ((await wineStatus()).winetricks) {
      status('Adding Japanese fonts…');
      await run('winetricks', ['-q', 'fakejapanese'], { env });
      const fonts = join(prefix, 'drive_c/windows/Fonts');
      mkdirSync(fontDir, { recursive: true });
      for (const name of readdirSync(fonts)) {
        const path = join(fonts, name);
        const shared = join(fontDir, name);
        const stat = lstatSync(path);
        // Wine's own fonts are links already; winetricks copies its fonts into every prefix.
        if (!stat.isFile() || stat.size < 1_000_000) continue;
        if (!existsSync(shared)) renameSync(path, shared);
        else rmSync(path);
        symlinkSync(shared, path);
      }
    }
    writeFileSync(join(prefix, '.chimi-ready'), '');
  }

  async function startLinux(folder, game, gameExe, saves) {
    const wine = await wineStatus();
    if (!wine.version) {
      return {
        status: 'error',
        message: 'Wine isn’t installed: install it to play this game here.'
      };
    }
    const prefix = join(prefixes, folder);
    const env = {
      ...process.env,
      WINEPREFIX: prefix,
      WINEARCH: 'win64',
      WINEDEBUG: '-all',
      WINEDLLOVERRIDES: 'mscoree,mshtml=',
      LANG: 'ja_JP.UTF-8',
      LC_ALL: 'ja_JP.UTF-8',
      TZ: 'Asia/Tokyo'
    };
    if (!existsSync(join(prefix, '.chimi-ready'))) await makePrefix(prefix, env);
    writeSaves(folder, game, saves);
    const audio = await media.start(env);
    send({ type: 'audio', mode: audio.mode });
    return spawn('wine', [winePath(join(hookDir, 'chimihook.exe')), winePath(gameExe)], {
      cwd: game.installDir,
      env: { ...env, ...audio.env }
    });
  }

  /** Starts a game; `saves`: the synced vnsaves.json entries, written in before it starts. */
  async function launch(event, folder, saves) {
    if (platform !== 'win32' && platform !== 'linux') return { status: 'unsupported' };
    if (!existsSync(join(hookDir, 'chimihook.exe'))) return { status: 'unsupported' };
    if (session?.running) return { status: 'running', title: session.title };
    const game = Object.hasOwn(store.games, folder) ? store.games[folder] : undefined;
    if (!game) return { status: 'missing' };
    const gameExe = join(game.installDir, game.exe);
    if (!existsSync(gameExe)) return { status: 'gone', path: game.installDir };

    // Links from before save sync: saves made until now count as the game's own files.
    if (!game.manifest) update(folder, { manifest: manifestOf(game.installDir) });

    session = { folder, title: game.title, sender: event.sender, messages: [], running: true };
    const current = session;
    watchSender(event.sender);
    syncOverlay();
    let child;
    try {
      if (platform === 'win32') {
        writeSaves(folder, store.games[folder], saves);
        // shortcut: a folder's time changes when entries are added, not when a file in it is
        // rewritten, so a game whose save folder exists before its first run here is missed;
        // upgrade to watching file times if games turn up like that.
        if (!store.games[folder].saveFolders?.length && !game.watched) current.watch = topFolders();
      }
      child =
        platform === 'win32'
          ? spawn(
              join(hookDir, 'chimihook.exe'),
              ['--locale', ...(await media.start()).args, gameExe],
              {
                cwd: game.installDir,
                windowsHide: true
              }
            )
          : await startLinux(folder, store.games[folder], gameExe, saves);
    } catch (error) {
      current.running = false;
      return { status: 'error', message: error.message };
    }
    if (!child.pid && child.status) {
      current.running = false;
      return child;
    }
    let rest = '';
    let exited = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop();
      for (const line of lines) {
        // LunaHost prints a stray non-JSON line or two.
        if (!line.startsWith('{')) continue;
        try {
          const message = JSON.parse(line);
          if (message.type === 'exit') {
            exited = true;
            current.running = false;
          }
          // Text lines get the number and arrival time /hook asks for their Anki media by.
          if (message.type === 'text') Object.assign(message, media.stamp());
          // Clicks and keys in the game: where each line's sound starts.
          if (message.type === 'input') media.input();
          if (message.type === 'window') {
            current.window = message;
            media.window(message);
            if (session === current) overlay.window(message);
          } else if (
            [
              'text',
              'thread',
              'inject',
              'connect',
              'disconnect',
              'error',
              'audio',
              'exit'
            ].includes(message.type)
          )
            send(message, current);
        } catch {
          // A cut line: skipped
        }
      }
    });
    child.stderr.on('data', (chunk) => console.warn(`chimihook: ${chunk}`));
    child.on('error', (error) => send({ type: 'error', message: error.message }, current));
    // 'exit', not 'close': Wine's own processes (wineserver, services) can keep stdout open.
    child.on('exit', () => {
      current.running = false;
      // Not a later game's recording.
      if (session === current) {
        media.stop();
        overlay.close();
      }
      if (current.watch) {
        const before = current.watch;
        const pending = Object.entries(topFolders())
          .filter(
            ([name, time]) =>
              !(time <= before[name]) &&
              isSafeSaveName(`${name}/x`) &&
              !store.games[folder].refused?.includes(name)
          )
          .map(([name]) => name);
        const all = [...new Set([...(store.games[folder].pending ?? []), ...pending])];
        update(folder, { pending: all.length ? all : undefined });
      }
      // The last lines may still be in the pipe.
      setTimeout(() => !exited && send({ type: 'exit' }, current), 1000);
    });
    current.child = child;
    return { status: 'started' };
  }

  async function pick(event, { title = '', exe = '', gone } = {}) {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const name = String(title).slice(0, 200);
    const result = await dialog.showOpenDialog(window, {
      title: gone
        ? `${name} isn’t at ${gone} any more. Where is it now?`
        : `Where is ${name || 'the game'} installed on this computer?`,
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { status: 'cancelled' };
    const dir = result.filePaths[0];
    const { programs, match } = listPrograms(dir, String(exe));
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    picks.set(id, { dir, programs });
    const shown = match >= 0 ? join(dir, dirname(programs[match])) : dir;
    return {
      status: 'picked',
      id,
      dir,
      folderName: basename(dir),
      programs,
      match,
      nameDiffers: !!name && nameDiffers(basename(shown), name)
    };
  }

  /** Keeps a picked folder and the program chosen in it (by its index) for a game's record. */
  function link(event, id, index, folder, title) {
    const picked = picks.get(id);
    const exe = picked?.programs[index];
    if (!exe || typeof folder !== 'string' || !/^[\w-]{1,100}$/.test(folder))
      return { status: 'error', message: 'That folder pick has expired: choose it again.' };
    picks.delete(id);
    store = {
      ...store,
      games: {
        ...store.games,
        [folder]: {
          // Save folders and synced names stay with the game when it moves.
          ...store.games[folder],
          title: String(title).slice(0, 200),
          installDir: picked.dir,
          exe,
          linkedAt: Date.now(),
          manifest: manifestOf(picked.dir)
        }
      }
    };
    save();
    return { status: 'ok', exe };
  }

  handle('games-launch', launch);
  // The page merges these into vnsaves.json: first names, times and sizes (and, on Windows, the
  // folders the game's first run wrote, to confirm), then the contents of the names it keeps.
  handle('games-saves', (event, folder, names) => {
    const game = Object.hasOwn(store.games, folder) ? store.games[folder] : undefined;
    if (!game || (session?.running && session.folder === folder)) return undefined;
    const files = listSaves(folder, game);
    if (!Array.isArray(names)) {
      return {
        files: files.map(({ name, modified, size }) => ({ name, modified, size })),
        pending: game.pending?.length ? game.pending : undefined
      };
    }
    const wanted = new Set(names);
    return Object.fromEntries(
      files
        .filter((file) => wanted.has(file.name))
        .map((file) => [
          file.name,
          { modified: file.modified, data: readFileSync(file.full).toString('base64') }
        ])
    );
  });
  // Windows: the folders the first run wrote are (keep) or aren't this game's saves; asked once.
  handle('games-save-folders', (event, folder, keep) => {
    const game = Object.hasOwn(store.games, folder) ? store.games[folder] : undefined;
    if (!game) return;
    update(folder, {
      saveFolders: [
        ...new Set([...(game.saveFolders ?? []), ...(keep ? (game.pending ?? []) : [])])
      ],
      refused: keep ? game.refused : [...(game.refused ?? []), ...(game.pending ?? [])],
      pending: undefined,
      watched: true
    });
  });
  // /hook shows a line (its screenshot is taken), and a note mined from one wants its media.
  handle('games-mark', (event, seq) => Number.isInteger(seq) && media.mark(seq));
  handle('games-media', (event, seq, want) =>
    Number.isInteger(seq)
      ? media.media(seq, { picture: !!want?.picture, audio: !!want?.audio })
      : { mode: media.mode }
  );
  handle('games-pick', pick);
  handle('games-link', link);
  handle('games-forget', (event, folder) => {
    const games = { ...store.games };
    delete games[folder];
    store = { ...store, games };
    save();
  });
  handle('games-list', async () => ({
    platform,
    hook: existsSync(join(hookDir, 'chimihook.exe')),
    wine: platform === 'linux' ? await wineStatus() : undefined,
    running: session?.running ? session.folder : undefined,
    games: Object.entries(store.games).map(([folder, game]) => {
      let present = false;
      try {
        present = statSync(join(game.installDir, game.exe)).isFile();
      } catch {
        // Gone: drive unplugged, moved or uninstalled
      }
      const { title, installDir, exe, linkedAt } = game;
      return { folder, title, installDir, exe, linkedAt, present };
    })
  }));
  handle('games-session', (event) => {
    if (!session) return undefined;
    // /hook (re)opened: lines go to it from now on.
    session.sender = event.sender;
    watchSender(event.sender);
    syncOverlay();
    return { folder: session.folder, running: session.running, messages: session.messages };
  });

  // The overlay: its settings (/hook, Settings → Desktop games), Adjust mode (/hook), and from the
  // overlay page itself its rects and adjusted area.
  handle('overlay-settings', (event, changes) => {
    if (changes && typeof changes === 'object') {
      const { on, fontSize, opacity } = { ...overlaySettings(store.overlay), ...changes };
      store = { ...store, overlay: overlaySettings({ on, fontSize, opacity }) };
      save();
      overlay.settings(store.overlay);
      syncOverlay();
    }
    // On Wayland it starts with the next start of the app.
    return {
      ...overlaySettings(store.overlay),
      restart: noX11 && overlaySettings(store.overlay).on
    };
  });
  handle('overlay-edit', (event, on) => overlay.edit(on));
  const fromOverlay = (event) => event.sender === overlay.webContents;
  handle(
    'overlay-rects',
    (event, rects, solid) => fromOverlay(event) && overlay.rects(rects, solid)
  );
  handle('overlay-area', (event, area) => fromOverlay(event) && overlay.area(area));
}
