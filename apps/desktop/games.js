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
  writeFileSync
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { userInfo } from 'node:os';

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
function loadStore(file) {
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

/** `Z:\…` for a Linux path, as Wine's Z: drive maps the root. */
const winePath = (path) => `Z:${path.replaceAll('/', '\\')}`;

/**
 * Registers the games IPC. `hookDir` holds chimihook and LunaHook; `isApp(event)` says whether
 * the sender is one of the app's own pages.
 */
export function registerGames({ app, dialog, ipcMain, BrowserWindow, hookDir, isApp }) {
  const storeFile = join(app.getPath('userData'), 'native-games.json');
  const prefixes = join(app.getPath('userData'), 'wine-prefixes');
  const fontDir = join(app.getPath('userData'), 'wine-fonts');
  const platform = process.platform;
  let store = loadStore(storeFile);
  /** Folders picked and waiting for the page's confirmation, by id. */
  const picks = new Map();
  /** The game running now: one at a time. Its messages are kept for /hook to replay. */
  let session;

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

  async function startLinux(folder, game, gameExe) {
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
    return spawn('wine', [winePath(join(hookDir, 'chimihook.exe')), winePath(gameExe)], {
      cwd: game.installDir,
      env
    });
  }

  async function launch(event, folder) {
    if (platform !== 'win32' && platform !== 'linux') return { status: 'unsupported' };
    if (!existsSync(join(hookDir, 'chimihook.exe'))) return { status: 'unsupported' };
    if (session?.running) return { status: 'running', title: session.title };
    const game = Object.hasOwn(store.games, folder) ? store.games[folder] : undefined;
    if (!game) return { status: 'missing' };
    const gameExe = join(game.installDir, game.exe);
    if (!existsSync(gameExe)) return { status: 'gone', path: game.installDir };

    session = { folder, title: game.title, sender: event.sender, messages: [], running: true };
    const current = session;
    let child;
    try {
      child =
        platform === 'win32'
          ? spawn(join(hookDir, 'chimihook.exe'), ['--locale', gameExe], {
              cwd: game.installDir,
              windowsHide: true
            })
          : await startLinux(folder, game, gameExe);
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
          if (
            ['text', 'thread', 'inject', 'connect', 'disconnect', 'error', 'exit'].includes(
              message.type
            )
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
      games: {
        ...store.games,
        [folder]: {
          title: String(title).slice(0, 200),
          installDir: picked.dir,
          exe,
          linkedAt: Date.now()
        }
      }
    };
    save();
    return { status: 'ok', exe };
  }

  handle('games-launch', launch);
  handle('games-pick', pick);
  handle('games-link', link);
  handle('games-forget', (event, folder) => {
    const games = { ...store.games };
    delete games[folder];
    store = { games };
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
      return { folder, ...game, present };
    })
  }));
  handle('games-session', (event) => {
    if (!session) return undefined;
    // /hook (re)opened: lines go to it from now on.
    session.sender = event.sender;
    return { folder: session.folder, running: session.running, messages: session.messages };
  });
}
