/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Windows games played natively: where each library game is installed on this computer, and its
// launch through chimihook (lunahook/, a separate GPL-3.0 program; scripts/fetch-lunahook.sh) with
// its text lines sent to the page that started it. Windows starts the game through Locale
// Remulator; Linux through the user's Wine or Steam's Proton (proton.js), one prefix per game.
//
// Install paths live only in <userData>/native-games.json, written only after main's own folder
// dialog: a page names a game by its record's folder and never hands main a path to run.

import { Buffer } from 'node:buffer';
import { execFile, spawn } from 'node:child_process';
import {
  cpSync,
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
import { gameHotkeys, hotkeySettings } from './hotkeys.js';
import { gameOverlay, overlayMode, overlaySettings } from './overlay.js';
import { findProton, fontReplacements, protonCommand, protonEnv } from './proton.js';

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
/**
 * Files Windows or a game runs or loads (Windows drops trailing dots and spaces), engines' scripts
 * too (Ren'Py, Python, Lua, Java, Kirikiri): `game/game/x.rpy` would run on launch. Also what they
 * load by themselves from the game's folder: archives (`patch.xp3`, `.rpa`), Python modules and
 * Windows' side files (`game.exe.config`, `.manifest`, `.local`).
 */
const runnable =
  /\.(?:exe|dll|asi|ocx|sys|cpl|scr|com|bat|cmd|ps1|vbs|js|jse|wsf|msi|lnk|url|reg|hta|inf|pif|rpy|rpyc|rpym|rpymc|py|pyc|lua|jar|tjs|ks|xp3|rpa|rpyb|pyd|pyo|so|dylib|config|manifest|local)[. ]*$/i;

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

/** Line breaks and other control characters: a hook code is one line of the helper's stdin. */
const hookCodeChars = '[^\\0-\\x1f\\x7f\\u2028\\u2029]';
const hookCodeShape = new RegExp(`^/?[HR]${hookCodeChars}*@${hookCodeChars}+$`);

/** A hook code main may hand the helper: an H-code's or R-code's shape, on one line, 500 at most. */
export const isHookCode = (code) =>
  typeof code === 'string' && code.length <= 500 && hookCodeShape.test(code);

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

/** Writes the store to its file. */
function save(ctx) {
  writeFileSync(ctx.storeFile, JSON.stringify(ctx.store, null, 2));
}

// A child's late lines go to its own session, never to a game started after it.
function send(ctx, message, target = ctx.session) {
  if (!target) return;
  target.messages.push(message);
  if (target.messages.length > 500) target.messages.splice(0, target.messages.length - 400);
  if (!target.sender.isDestroyed()) target.sender.send('native-hook', message);
}

const status = (ctx, text) => send(ctx, { type: 'status', text });

function update(ctx, folder, changes) {
  const { store } = ctx;
  ctx.store = {
    ...store,
    games: { ...store.games, [folder]: { ...store.games[folder], ...changes } }
  };
  save(ctx);
}

/** A game's overlay: its mode, and where Invisible puts the text (a screen read, or the area). */
const gameOverlayOf = (game) => ({
  mode: overlayMode(game?.overlayMode),
  place: game?.overlayPlace === 'area' ? 'area' : 'screen'
});

/** What the overlay window is told: the shared look and the game's mode and placing. */
const overlayFor = ({ store }, folder) => ({
  ...overlaySettings(store.overlay),
  ...gameOverlayOf(store.games[folder])
});

const overlayOn = ({ store, platform, noX11, session }) =>
  gameOverlayOf(store.games[session?.folder]).mode !== 'off' &&
  (platform === 'win32' || platform === 'linux') &&
  !noX11;

/** Opens or closes the overlay to match the game, /hook and the setting; the shortcuts too. */
function syncOverlay(ctx) {
  const { session, store, overlay } = ctx;
  ctx.hotkeys.sync(session, hotkeySettings(store.hotkeys));
  const wanted = session?.running && !session.sender.isDestroyed() && overlayOn(ctx);
  if (!wanted) overlay.close();
  else if (!overlay.webContents) {
    const { folder } = session;
    overlay.open(store.games[folder]?.overlay, overlayFor(ctx, folder), (area) =>
      update(ctx, folder, { overlay: area })
    );
    if (session.window) overlay.window(session.window);
  } else overlay.settings(overlayFor(ctx, session.folder));
}

/** /hook's page closing takes the overlay with it (its lines come from there). */
const watchSender = (ctx, sender) =>
  sender.once('destroyed', () => setTimeout(() => syncOverlay(ctx)));

/** A game's Proton compat-data folder holds its prefix as `pfx`; its user is always `steamuser`. */
const protonUser = 'steamuser';

/**
 * A game's prefix on Linux and its user's folder there: the one of the runner it last ran with
 * (`ranWith`; Wine for games from before Proton), where its saves are.
 */
const linuxPrefix = ({ prefixes, protonData }, folder, game) => {
  const proton = game.ranWith === 'proton';
  const dir = proton ? join(protonData, folder, 'pfx') : join(prefixes, folder);
  return { dir, user: join(dir, 'drive_c/users', proton ? protonUser : userInfo().username) };
};

/**
 * Where synced save names live on this computer, as [name prefix, folder]: on Linux the game's
 * own prefix (its user folders and ProgramData), on Windows the user's own folders, of which
 * only the game's save folders (`saveFolders`) are read or written.
 */
const saveRoots = (ctx, folder, game) =>
  ctx.platform === 'win32'
    ? [
        [`${userKey}AppData/`, join(homedir(), 'AppData')],
        [`${userKey}Documents/`, ctx.app.getPath('documents')],
        [`${userKey}Saved Games/`, join(homedir(), 'Saved Games')],
        ['wine/drive_c/ProgramData/', process.env.ProgramData ?? 'C:\\ProgramData'],
        ['game/', game.installDir]
      ]
    : [
        [userKey, linuxPrefix(ctx, folder, game).user],
        [
          'wine/drive_c/ProgramData/',
          join(linuxPrefix(ctx, folder, game).dir, 'drive_c/ProgramData')
        ],
        ['game/', game.installDir]
      ];

/** A synced name's root folder and path parts below it, or undefined. */
const locate = (ctx, folder, game, name) => {
  const [prefix, dir] =
    saveRoots(ctx, folder, game).find(([start]) => name.startsWith(start)) ?? [];
  const parts = prefix && keyParts(name.slice(prefix.length));
  return parts && { dir, parts };
};

/** A Windows save folder, as a name: `…/AppData/<Roaming|Local|LocalLow>/<name>`, `…/Documents/<name>`… */
const topFolder = (name) =>
  /^(wine\/drive_c\/(?:users\/username\/(?:AppData\/[^/]+|Documents|Saved Games)|ProgramData)\/[^/]+)\//.exec(
    name
  )?.[1];

/** The folders a game may make its save folder in on Windows, watched on its first run. */
const watchedParents = (app) =>
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
const topFolders = (app) =>
  Object.fromEntries(
    watchedParents(app).flatMap(([prefix, dir]) => {
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
function writeSaves(ctx, folder, game, saves) {
  const { platform } = ctx;
  const saveFolders = new Set(game.saveFolders);
  const pending = new Set(game.pending);
  const saveNames = new Set(game.saveNames);
  for (const [name, file] of Object.entries(saves ?? {})) {
    const at = isSafeSaveName(name) && locate(ctx, folder, game, name);
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
  update(ctx, folder, {
    pending: pending.size ? [...pending] : undefined,
    saveNames: [...saveNames]
  });
}

/**
 * This computer's save files of a game as synced names: on Linux everything in its prefix's user
 * folders and ProgramData (the page keeps isWindowsSaveKey's), on Windows its save folders;
 * from the install folder, files new or changed since it was linked and those already synced.
 */
function listSaves(ctx, folder, game) {
  const roots =
    ctx.platform === 'win32'
      ? (game.saveFolders ?? []).flatMap((top) => {
          const at = locate(ctx, folder, game, top);
          return at ? [[`${top}/`, join(at.dir, ...at.parts)]] : [];
        })
      : saveRoots(ctx, folder, game).filter(([prefix]) => prefix !== 'game/');
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

/** The user folders Wine links into the real home become plain folders: saves stay in the prefix. */
function plainUserFolders(user) {
  for (const name of existsSync(user) ? readdirSync(user) : []) {
    const path = join(user, name);
    if (lstatSync(path).isSymbolicLink()) {
      rmSync(path);
      mkdirSync(path);
    }
  }
}

/**
 * A new prefix for a game: Wine's first start without the Mono/Gecko prompts, the user folders
 * Wine links into the real home made plain folders (saves stay in the prefix), and the Japanese
 * fonts (winetricks fakejapanese) with the font files linked to one shared copy.
 */
async function makePrefix(ctx, prefix, env) {
  const { fontDir } = ctx;
  mkdirSync(prefix, { recursive: true });
  status(ctx, 'Setting up Wine for this game (first start only, about a minute)…');
  await run('wine', ['wineboot', '-i'], { env });
  await run('wineserver', ['-w'], { env });
  plainUserFolders(join(prefix, 'drive_c/users', userInfo().username));
  if ((await wineStatus()).winetricks) {
    status(ctx, 'Adding Japanese fonts…');
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

/** Wine's env for a game: its own prefix (or, without one, the user's default prefix). */
const wineEnv = (prefix) => ({
  ...process.env,
  ...(prefix ? { WINEPREFIX: prefix, WINEARCH: 'win64' } : {}),
  WINEDEBUG: '-all',
  WINEDLLOVERRIDES: 'mscoree,mshtml=',
  LANG: 'ja_JP.UTF-8',
  LC_ALL: 'ja_JP.UTF-8',
  TZ: 'Asia/Tokyo'
});

const noWine = {
  status: 'error',
  message: 'Wine isn’t installed: install it to play this game here.'
};

const readText = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};

/**
 * The helper's folder for Proton: a packaged app's files are in the AppImage's mount, which
 * Steam's container may not show, so a copy in the app's own folder (as Yomitan's in main.js).
 */
function protonHookDir({ app, hookDir }) {
  if (!app.isPackaged) return hookDir;
  const dir = join(app.getPath('userData'), 'hook');
  const stamp = join(dir, 'app-version.txt');
  if (readText(stamp) !== app.getVersion()) {
    rmSync(dir, { recursive: true, force: true });
    cpSync(hookDir, dir, { recursive: true });
    // Last, so an interrupted copy is redone.
    writeFileSync(stamp, app.getVersion());
  }
  return dir;
}

/**
 * A game's Proton prefix, made or upgraded when it's new or its build changed: `proton run` sets
 * it up before starting anything (here Wine's own wineboot, which ends at once), then the user
 * folder links become folders and the Japanese fonts Proton lacks get replacements.
 */
async function makeProtonPrefix(ctx, { build, data, env }) {
  const ready = join(data, '.chimi-ready');
  const stamp = `${build.path}\n${readText(join(build.path, 'version')) ?? ''}`;
  if (readText(ready) === stamp) return;
  mkdirSync(data, { recursive: true });
  status(
    ctx,
    existsSync(ready)
      ? `Updating this game’s prefix for ${build.name}…`
      : `Setting up ${build.name} for this game (first start only, about a minute)…`
  );
  await run(...protonCommand(build, 'run', ['wineboot', '--init']), { env });
  if (!existsSync(join(data, 'pfx/drive_c')))
    throw new Error(`${build.name} couldn’t set up this game’s prefix.`);
  plainUserFolders(join(data, 'pfx/drive_c/users', protonUser));
  const fonts = join(data, 'chimi-fonts.reg');
  writeFileSync(fonts, fontReplacements);
  await run(...protonCommand(build, 'runinprefix', ['reg.exe', 'import', winePath(fonts)]), {
    env
  });
  writeFileSync(ready, stamp);
}

/**
 * Which runner a game starts with on Linux: its own setting, else the app's (`runner` in the
 * store: 'auto', 'wine' or `{ proton: <build's folder> }`). Automatic is the system's Wine when
 * there is one, else the newest Proton that can run. `{ kind }`, or the error to show.
 */
async function pickRunner(ctx, game) {
  const want = game?.runner ?? ctx.store.runner ?? 'auto';
  const wine = typeof want === 'string' && (await wineStatus()).version;
  if (want === 'wine' || wine) return wine ? { kind: 'wine' } : noWine;
  const builds = findProton();
  const build = want === 'auto' ? builds[0] : builds.find((found) => found.path === want?.proton);
  const error = (message) => ({ status: 'error', message });
  if (!build)
    return error(
      want === 'auto'
        ? 'Neither Wine nor Proton was found: install Wine, or a Proton in Steam (Library → Tools).'
        : 'The chosen Proton build isn’t installed any more: pick another in Settings → Desktop games.'
    );
  if (!build.runtime)
    return error(`${build.name} runs in “${build.needs}”: install it in Steam (Library → Tools).`);
  return { kind: 'proton', build };
}

/** Settings' list: the Proton builds found, the app's runner setting and what it starts games with. */
async function runners(ctx) {
  const picked = await pickRunner(ctx);
  return {
    proton: findProton().map(({ name, path, needs }) => ({ name, path, needs })),
    runner: ctx.store.runner ?? 'auto',
    runs: picked.status
      ? { error: picked.message }
      : { kind: picked.kind, name: picked.build?.name }
  };
}

/**
 * How a game runs on Linux, or the error to show: its `env`, the helper's folder, `argv(args)` =
 * [command, args] starting a Windows program, whether its prefix is `ready`, and `prepare()`
 * making it.
 */
async function linuxRunner(ctx, folder, game) {
  const picked = await pickRunner(ctx, game);
  if (picked.status) return picked;
  if (picked.kind === 'wine') {
    const prefix = join(ctx.prefixes, folder);
    const env = wineEnv(prefix);
    const ready = () => existsSync(join(prefix, '.chimi-ready'));
    return {
      kind: 'wine',
      dir: prefix,
      env,
      hookDir: ctx.hookDir,
      argv: (args) => ['wine', args],
      ready: ready(),
      prepare: async () => ready() || (await makePrefix(ctx, prefix, env))
    };
  }
  const { build } = picked;
  const data = join(ctx.protonData, folder);
  const hookDir = protonHookDir(ctx);
  const env = protonEnv(build, data, [game.installDir, hookDir, data]);
  return {
    kind: 'proton',
    dir: data,
    env,
    hookDir,
    argv: (args) => protonCommand(build, 'runinprefix', args),
    ready: existsSync(join(data, '.chimi-ready')),
    prepare: () => makeProtonPrefix(ctx, { build, data, env })
  };
}

/**
 * A game that last ran with the other runner: its saves there are copied into this runner's
 * prefix before it starts, by writeSaves' rules (never over a newer file, never through a link,
 * safe names only), so switching strands none.
 */
function carrySaves(ctx, folder, kind) {
  const game = ctx.store.games[folder];
  if ((game.ranWith ?? 'wine') === kind) return;
  // shortcut: the files pass through memory as synced saves do; copy file to file if a game
  // turns up keeping hundreds of MB in its save folders.
  const saves = Object.fromEntries(
    listSaves(ctx, folder, game)
      .filter((file) => !file.name.startsWith('game/'))
      .map((file) => [
        file.name,
        { modified: file.modified, data: readFileSync(file.full).toString('base64') }
      ])
  );
  update(ctx, folder, { ranWith: kind });
  writeSaves(ctx, folder, ctx.store.games[folder], saves);
}

/**
 * Wine grabs the pointer for a fullscreen game at its first click (always, under gamescope), and
 * the overlay's text gets no pointer from then on. So a game whose overlay isn't Off runs with
 * `GrabPointer=N` in its prefix (it can't confine the cursor then), and gets Wine's default back
 * once it's Off. A marker in the prefix says which is set: `reg` runs only when that changes.
 * Returns whether the grab is off.
 */
async function pointerGrab(runner, game) {
  const marker = join(runner.dir, '.chimi-nograb');
  const off = gameOverlayOf(game).mode !== 'off';
  if (off === existsSync(marker)) return off;
  const key = 'HKCU\\Software\\Wine\\X11 Driver';
  const [command, args] = runner.argv(
    off
      ? ['reg.exe', 'add', key, '/v', 'GrabPointer', '/d', 'N', '/f']
      : ['reg.exe', 'delete', key, '/v', 'GrabPointer', '/f']
  );
  // A failed reg leaves the marker as it was: tried again at the next start.
  if ((await run(command, args, { env: runner.env })) === undefined) return !off;
  if (off) writeFileSync(marker, '');
  else rmSync(marker);
  return off;
}

async function startLinux(ctx, folder, gameExe, saves) {
  const { media } = ctx;
  const game = ctx.store.games[folder];
  const runner = await linuxRunner(ctx, folder, game);
  if (runner.status) return runner;
  await runner.prepare();
  ctx.session.grabOff = await pointerGrab(runner, game);
  carrySaves(ctx, folder, runner.kind);
  writeSaves(ctx, folder, ctx.store.games[folder], saves);
  const audio = await media.start(runner.env);
  send(ctx, { type: 'audio', mode: audio.mode });
  const [command, args] = runner.argv([
    winePath(join(runner.hookDir, 'chimihook.exe')),
    ...(game.launchOnly ? ['--no-hook'] : []),
    winePath(gameExe)
  ]);
  return spawn(command, args, { cwd: game.installDir, env: { ...runner.env, ...audio.env } });
}

/** Starts a game; `saves`: the synced vnsaves.json entries, written in before it starts. */
async function launch(ctx, event, folder, saves) {
  const { platform, hookDir, media, app } = ctx;
  if (platform !== 'win32' && platform !== 'linux') return { status: 'unsupported' };
  if (!existsSync(join(hookDir, 'chimihook.exe'))) return { status: 'unsupported' };
  if (ctx.session?.running) return { status: 'running', title: ctx.session.title };
  const game = Object.hasOwn(ctx.store.games, folder) ? ctx.store.games[folder] : undefined;
  if (!game) return { status: 'missing' };
  const gameExe = join(game.installDir, game.exe);
  if (!existsSync(gameExe)) return { status: 'gone', path: game.installDir };

  // Links from before save sync: saves made until now count as the game's own files.
  if (!game.manifest) update(ctx, folder, { manifest: manifestOf(game.installDir) });

  ctx.session = {
    folder,
    title: game.title,
    sender: event.sender,
    messages: [],
    running: true,
    launchOnly: !!game.launchOnly
  };
  const current = ctx.session;
  watchSender(ctx, event.sender);
  syncOverlay(ctx);
  let child;
  try {
    if (platform === 'win32') {
      writeSaves(ctx, folder, ctx.store.games[folder], saves);
      // shortcut: a folder's time changes when entries are added, not when a file in it is
      // rewritten, so a game whose save folder exists before its first run here is missed;
      // upgrade to watching file times if games turn up like that.
      if (!ctx.store.games[folder].saveFolders?.length && !game.watched)
        current.watch = topFolders(app);
    }
    child =
      platform === 'win32'
        ? spawn(
            join(hookDir, 'chimihook.exe'),
            [
              '--locale',
              ...(game.launchOnly ? ['--no-hook'] : []),
              ...(await media.start()).args,
              gameExe
            ],
            {
              cwd: game.installDir,
              windowsHide: true
            }
          )
        : await startLinux(ctx, folder, gameExe, saves);
  } catch (error) {
    current.running = false;
    syncOverlay(ctx);
    return { status: 'error', message: error.message };
  }
  if (!child.pid && child.status) {
    current.running = false;
    syncOverlay(ctx);
    return child;
  }
  watchHelper(ctx, current, child);
  return { status: 'started' };
}

/** The helper's messages go to the session's page; its end stops the recording and the overlay. */
function watchHelper(ctx, current, child) {
  const { media, overlay, app } = ctx;
  const { folder } = current;
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
          if (ctx.session === current) overlay.window(message);
        } else if (
          [
            'text',
            'thread',
            'inject',
            'hookcode',
            'connect',
            'disconnect',
            'error',
            'audio',
            'exit'
          ].includes(message.type)
        )
          send(ctx, message, current);
      } catch {
        // A cut line: skipped
      }
    }
  });
  child.stderr.on('data', (chunk) => console.warn(`chimihook: ${chunk}`));
  const ended = () => {
    current.running = false;
    // Not a later game's recording.
    if (ctx.session === current) {
      media.stop();
      syncOverlay(ctx);
    }
    // Forgotten while it ran: no record to add folders to, and none made again.
    if (current.watch && ctx.store.games[folder]) {
      const before = current.watch;
      const pending = Object.entries(topFolders(app))
        .filter(
          ([name, time]) =>
            !(time <= before[name]) &&
            isSafeSaveName(`${name}/x`) &&
            !ctx.store.games[folder].refused?.includes(name)
        )
        .map(([name]) => name);
      const all = [...new Set([...(ctx.store.games[folder].pending ?? []), ...pending])];
      update(ctx, folder, { pending: all.length ? all : undefined });
    }
  };
  child.on('error', (error) => {
    // A spawn that failed never fires 'exit'. Its exit goes first, so /hook keeps showing the error.
    if (!child.pid) {
      exited = true;
      ended();
      send(ctx, { type: 'exit' }, current);
    }
    send(ctx, { type: 'error', message: error.message }, current);
  });
  // 'exit', not 'close': Wine's own processes (wineserver, services) can keep stdout open.
  child.on('exit', () => {
    ended();
    // The last lines may still be in the pipe.
    setTimeout(() => !exited && send(ctx, { type: 'exit' }, current), 1000);
  });
  // Hook codes go in on stdin (games-hook-code); a helper gone before a write is no crash.
  child.stdin?.on('error', () => {});
  current.child = child;
}

/**
 * The processes with a window (Linux: in the game's prefix when it has one, else Wine's default),
 * for Attach; kept so the page picks one by its index and never names a process itself.
 */
async function listWindows(ctx, folder) {
  const { platform, hookDir } = ctx;
  if ((platform !== 'win32' && platform !== 'linux') || !existsSync(join(hookDir, 'chimihook.exe')))
    return { status: 'unsupported' };
  if (!Object.hasOwn(ctx.store.games, folder)) return { status: 'missing' };
  const runner =
    platform === 'linux' ? await linuxRunner(ctx, folder, ctx.store.games[folder]) : {};
  if (runner.status) return runner;
  // Proton has no default prefix: a game Steam itself started is in Steam's, not the app's.
  if (runner.kind === 'proton' && !runner.ready)
    return {
      status: 'error',
      message: 'With Proton, only a game started from here can be attached to: start it here once.'
    };
  const env = runner.kind === 'wine' && !runner.ready ? wineEnv() : runner.env;
  const exe = join(runner.hookDir ?? hookDir, 'chimihook.exe');
  const argv = runner.argv;
  const out =
    platform === 'win32'
      ? await run(exe, ['--list'], { timeout: 15_000, windowsHide: true })
      : await run(...argv([winePath(exe), '--list']), { env, timeout: 60_000 });
  let list = [];
  try {
    list = JSON.parse(out.split('\n').find((line) => line.startsWith('{"type":"windows"'))).list;
  } catch {
    return { status: 'error', message: 'The running programs couldn’t be listed.' };
  }
  ctx.windows = { folder, env, list, exe, argv };
  return {
    status: 'ok',
    windows: list.map(({ title, exe: path }) => ({ title, exe: path.split(/[\\/]/).pop() }))
  };
}

/** Hooks the game picked from listWindows (by index): a session of `folder`'s, as if started here. */
async function attach(ctx, event, folder, index) {
  const { platform, media } = ctx;
  const picked = ctx.windows?.folder === folder ? ctx.windows.list[index] : undefined;
  if (!Number.isInteger(index) || !picked)
    return { status: 'error', message: 'That list has expired: open it again.' };
  if (ctx.session?.running) return { status: 'running', title: ctx.session.title };
  const game = Object.hasOwn(ctx.store.games, folder) ? ctx.store.games[folder] : undefined;
  if (!game) return { status: 'missing' };
  const { env, exe, argv } = ctx.windows;
  ctx.windows = undefined;
  ctx.session = { folder, title: game.title, sender: event.sender, messages: [], running: true };
  const current = ctx.session;
  watchSender(ctx, event.sender);
  syncOverlay(ctx);
  const pid = String(picked.pid);
  let child;
  try {
    // Linux: already playing on the default sound output, so the whole system's sound.
    const audio = await media.start(env, { ownSink: false });
    if (platform !== 'win32') send(ctx, { type: 'audio', mode: audio.mode });
    child =
      platform === 'win32'
        ? spawn(exe, [...audio.args, '--attach', pid], { windowsHide: true })
        : spawn(...argv([winePath(exe), '--attach', pid]), { env });
  } catch (error) {
    current.running = false;
    syncOverlay(ctx);
    return { status: 'error', message: error.message };
  }
  watchHelper(ctx, current, child);
  return { status: 'started' };
}

async function pick({ BrowserWindow, dialog, picks }, event, { title = '', exe = '', gone } = {}) {
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
function link(ctx, event, id, index, folder, title) {
  const { picks, store } = ctx;
  const picked = picks.get(id);
  const exe = picked?.programs[index];
  if (!exe || typeof folder !== 'string' || !/^[\w-]{1,100}$/.test(folder))
    return { status: 'error', message: 'That folder pick has expired: choose it again.' };
  picks.delete(id);
  ctx.store = {
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
  save(ctx);
  return { status: 'ok', exe };
}

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
  globalShortcut,
  screen,
  hookDir,
  overlayUrl,
  preload,
  prepare,
  isApp
}) {
  const storeFile = join(app.getPath('userData'), 'native-games.json');
  const platform = process.platform;
  // Wayland gives no window positions: main.js starts the app on X11 (XWayland) while it's on.
  const noX11 =
    platform === 'linux' &&
    (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY) &&
    app.commandLine.getSwitchValue('ozone-platform') !== 'x11';
  /** What the functions above share: this app's folders, the store and the running game. */
  const ctx = {
    app,
    dialog,
    BrowserWindow,
    hookDir,
    platform,
    storeFile,
    prefixes: join(app.getPath('userData'), 'wine-prefixes'),
    /** Proton's compat-data folders, one per game (its prefix is `pfx` inside). */
    protonData: join(app.getPath('userData'), 'proton-prefixes'),
    fontDir: join(app.getPath('userData'), 'wine-fonts'),
    store: loadStore(storeFile),
    /** Folders picked and waiting for the page's confirmation, by id. */
    picks: new Map(),
    /** The game running now: one at a time. Its messages are kept for /hook to replay. */
    session: undefined,
    /** Its sound and screenshots, for Anki (game-media.js). */
    // Native Wayland captures only through the portal, which asks to share the screen at every
    // shot (and can't pick the game's X window): no screenshots there, they work with the overlay on.
    media: gameMedia({ desktopCapturer: noX11 ? undefined : desktopCapturer, platform }),
    /** The text overlay over the game (overlay.js), while it runs, /hook is open and it's on. */
    overlay: gameOverlay({
      BrowserWindow,
      screen,
      url: overlayUrl,
      preload,
      prepare,
      platform
    }),
    /** Global shortcuts while a game runs (hotkeys.js) */
    hotkeys: gameHotkeys({ globalShortcut, BrowserWindow }),
    noX11
  };
  // Before per-game modes the overlay was on or off for every game: on becomes Band for each.
  if (
    ctx.store.overlay?.on === true &&
    !Object.values(ctx.store.games).some((game) => game.overlayMode)
  )
    ctx.store = {
      ...ctx.store,
      games: Object.fromEntries(
        Object.entries(ctx.store.games).map(([folder, game]) => [
          folder,
          { ...game, overlayMode: 'band' }
        ])
      )
    };
  const { media, overlay } = ctx;
  app.on('will-quit', () => {
    media.stop();
    ctx.hotkeys.sync();
  });

  const handle = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!isApp(event)) throw new Error('Not the app');
      return fn(event, ...args);
    });

  handle('games-launch', (event, folder, saves) => launch(ctx, event, folder, saves));
  // The page merges these into vnsaves.json: first names, times and sizes (and, on Windows, the
  // folders the game's first run wrote, to confirm), then the contents of the names it keeps.
  handle('games-saves', (event, folder, names) => {
    const { store, session } = ctx;
    const game = Object.hasOwn(store.games, folder) ? store.games[folder] : undefined;
    if (!game || (session?.running && session.folder === folder)) return undefined;
    const files = listSaves(ctx, folder, game);
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
    const { store } = ctx;
    const game = Object.hasOwn(store.games, folder) ? store.games[folder] : undefined;
    if (!game) return;
    update(ctx, folder, {
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
  handle('games-pick', (event, options) => pick(ctx, event, options));
  handle('games-link', (event, id, index, folder, title) =>
    link(ctx, event, id, index, folder, title)
  );
  handle('games-forget', (event, folder) => {
    const games = { ...ctx.store.games };
    delete games[folder];
    ctx.store = { ...ctx.store, games };
    save(ctx);
  });
  handle('games-list', async () => ({
    platform,
    hook: existsSync(join(hookDir, 'chimihook.exe')),
    wine: platform === 'linux' ? await wineStatus() : undefined,
    ...(platform === 'linux' ? await runners(ctx) : {}),
    running: ctx.session?.running ? ctx.session.folder : undefined,
    games: Object.entries(ctx.store.games).map(([folder, game]) => {
      let present = false;
      try {
        present = statSync(join(game.installDir, game.exe)).isFile();
      } catch {
        // Gone: drive unplugged, moved or uninstalled
      }
      const { title, installDir, exe, linkedAt, runner } = game;
      const overlay = gameOverlayOf(game);
      return { folder, title, installDir, exe, linkedAt, present, runner, overlay };
    })
  }));
  // Linux: what starts the games (Settings → Desktop games), for all (`folder` null) or one game
  // (null `runner`: as the others). A Proton build is named by its folder, and only one found.
  handle('games-runner', (event, folder, runner) => {
    const build =
      typeof runner?.proton === 'string' &&
      findProton().some((found) => found.path === runner.proton);
    if (!build && runner !== 'auto' && runner !== 'wine' && (runner != null || folder == null))
      return;
    const value = build ? { proton: runner.proton } : (runner ?? undefined);
    if (folder == null) {
      ctx.store = { ...ctx.store, runner: value };
      save(ctx);
    } else if (Object.hasOwn(ctx.store.games, folder)) update(ctx, folder, { runner: value });
  });
  handle('games-session', (event, folder) => {
    const { session } = ctx;
    if (!session) return undefined;
    // This game's /hook (re)opened: lines go to it from now on. Another game's page gets none.
    if (session.folder === folder) {
      session.sender = event.sender;
      watchSender(ctx, event.sender);
      syncOverlay(ctx);
    }
    return { folder: session.folder, running: session.running, messages: session.messages };
  });
  // Per game, never synced: start it without LunaHook (the reader's own hook sends the lines).
  handle('games-options', (event, folder, changes) => {
    if (!Object.hasOwn(ctx.store.games, folder)) return undefined;
    if (typeof changes?.launchOnly === 'boolean')
      update(ctx, folder, { launchOnly: changes.launchOnly || undefined });
    return { launchOnly: !!ctx.store.games[folder].launchOnly };
  });
  // A hook code typed on /hook, checked here: it becomes one line of the helper's stdin.
  handle('games-hook-code', (event, code) => {
    const { session } = ctx;
    if (!isHookCode(code)) return { status: 'error', message: 'That isn’t an H-code or R-code.' };
    if (!session?.running || session.launchOnly || !session.child?.stdin?.writable)
      return { status: 'error', message: 'The game isn’t running with the built-in hook.' };
    session.child.stdin.write(`insert ${code}\n`);
    return { status: 'ok' };
  });
  // Launch only: a line from the reader's own hook gets a number for its Anki media too.
  handle('games-stamp', () =>
    ctx.session?.running && ctx.session.launchOnly ? media.stamp() : undefined
  );
  handle('games-windows', (event, folder) => listWindows(ctx, folder));
  handle('games-attach', (event, folder, index) => attach(ctx, event, folder, index));

  // The overlay: its settings (/hook, Settings → Desktop games), Adjust mode (/hook), and from the
  // overlay page itself its rects and adjusted area.
  // `mode` and `place` are one game's (`changes.folder`, else the running game's).
  handle('overlay-settings', (event, changes) => {
    const folder = typeof changes?.folder === 'string' ? changes.folder : ctx.session?.folder;
    if (changes && typeof changes === 'object') {
      let { games } = ctx.store;
      if (games[folder] && (changes.mode !== undefined || changes.place !== undefined)) {
        const { mode, place } = { ...gameOverlayOf(games[folder]), ...changes };
        const overlayPlace = place === 'area' ? 'area' : 'screen';
        games = {
          ...games,
          [folder]: { ...games[folder], overlayMode: overlayMode(mode), overlayPlace }
        };
      }
      const { fontSize, opacity } = { ...overlaySettings(ctx.store.overlay), ...changes };
      // `on`: some game uses the overlay, which main.js reads at start (X11 on a Wayland session).
      const on = Object.values(games).some((game) => gameOverlayOf(game).mode !== 'off');
      ctx.store = { ...ctx.store, games, overlay: overlaySettings({ on, fontSize, opacity }) };
      save(ctx);
      syncOverlay(ctx);
    }
    // On Wayland it starts with the next start of the app; Wine's pointer grab (pointerGrab) is
    // set when the game starts.
    const state = overlayFor(ctx, folder);
    const { session } = ctx;
    return {
      ...state,
      restart: noX11 && overlaySettings(ctx.store.overlay).on,
      nextStart:
        !!session?.running &&
        session.folder === folder &&
        session.grabOff !== undefined &&
        session.grabOff !== (state.mode !== 'off')
    };
  });
  handle('overlay-edit', (event, on) => overlay.edit(on));
  // The shortcuts (Settings → Desktop games): `failed` names those another program holds now.
  handle('games-hotkeys', (event, changes) => {
    const failed = [];
    if (changes && typeof changes === 'object') {
      ctx.store = { ...ctx.store, hotkeys: hotkeySettings({ ...ctx.store.hotkeys, ...changes }) };
      save(ctx);
      failed.push(...ctx.hotkeys.sync(ctx.session, hotkeySettings(ctx.store.hotkeys)));
    }
    return { ...hotkeySettings(ctx.store.hotkeys), failed };
  });
  const fromOverlay = (event) => event.sender === overlay.webContents;
  handle(
    'overlay-rects',
    (event, rects, solid) => fromOverlay(event) && overlay.rects(rects, solid)
  );
  handle('overlay-area', (event, area) => fromOverlay(event) && overlay.area(area));
  // The game's window now, for the overlay page's screen read (Invisible).
  handle('overlay-frame', (event) => (fromOverlay(event) ? media.frame() : undefined));
}
