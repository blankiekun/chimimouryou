/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// Steam's Proton as a second runner for Windows games on Linux (games.js): which builds this
// computer's Steam has, read from its files (Steam needn't run), and the command Steam itself would
// run for one: the Steam Linux Runtime's container around the build's `proton` script. Everything
// the app knows about Valve's layout is in this file.

import { Buffer } from 'node:buffer';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Valve's text KeyValues (.vdf, .acf) as nested objects, keys in lower case. */
export function parseVdf(text) {
  const root = Object.create(null);
  const stack = [root];
  let key;
  for (const [, string, brace] of text
    .replace(/^\s*\/\/.*$/gm, '')
    .matchAll(/"((?:\\.|[^"\\])*)"|([{}])/g)) {
    if (brace === '}') {
      if (stack.length > 1) stack.pop();
    } else if (brace) {
      const child = Object.create(null);
      if (key !== undefined) stack.at(-1)[key] = child;
      stack.push(child);
    } else if (key === undefined) {
      key = string.replace(/\\(.)/g, '$1').toLowerCase();
      continue;
    } else stack.at(-1)[key] = string.replace(/\\(.)/g, '$1');
    key = undefined;
  }
  return root;
}

const readVdf = (file) => {
  try {
    return parseVdf(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};

/** The containers Proton builds ask for (toolmanifest.vdf `require_tool_appid`), to name a missing one. */
const runtimeNames = {
  4183110: 'Steam Linux Runtime 4.0',
  1628350: 'Steam Linux Runtime 3.0 (sniper)',
  1391110: 'Steam Linux Runtime 2.0 (soldier)'
};

const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
};

const unique = (list) => [...new Set(list.filter(Boolean))];

/** A Steam install's library folders, itself first: other drives (an SD card) are named in libraryfolders.vdf. */
function libraries(root) {
  const folders = readVdf(join(root, 'steamapps/libraryfolders.vdf')).libraryfolders ?? {};
  return unique([
    root,
    ...Object.entries(folders)
      // Old Steam: "1" "/path"; now "1" { "path" "/path" }.
      .filter(([key]) => /^\d+$/.test(key))
      .map(([, value]) => real(typeof value === 'string' ? value : `${value?.path ?? ''}`))
  ]);
}

/** The folders in `dir` that are a compatibility tool with a `proton` script. */
function toolsIn(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          existsSync(join(dir, entry.name, 'proton')) &&
          existsSync(join(dir, entry.name, 'toolmanifest.vdf'))
      )
      .map((entry) => ({ name: entry.name, path: join(dir, entry.name) }));
  } catch {
    return [];
  }
}

/** The installed folder of Steam app `id` (a runtime) holding the container's entry point. */
const runtimeDir = (libs, id) =>
  libs
    .map((library) => {
      const dir = readVdf(join(library, `steamapps/appmanifest_${id}.acf`)).appstate?.installdir;
      return typeof dir === 'string' && join(library, 'steamapps/common', dir);
    })
    .find((dir) => dir && existsSync(join(dir, '_v2-entry-point')));

/** Numbered Valve builds newest first, then Experimental, then custom builds newest first, then the rest. */
function rank({ name, custom }) {
  const version = /^Proton (\d+)\.(\d+)/.exec(name);
  if (custom) return [2, 0, 0];
  if (version) return [0, -version[1], -version[2]];
  return [name === 'Proton - Experimental' ? 1 : 3, 0, 0];
}

/**
 * The Proton builds of this computer's Steam (`home`: the user's home folder), those that can run
 * first and the one Automatic takes at the top: `{ name, path, root (its Steam install), runtime
 * (the container's folder) }`, or `needs` (the runtime to install in Steam) in place of `runtime`.
 * Builds from before the container (Proton 5.0 and older) are left out.
 */
export function findProton(home = homedir()) {
  const roots = unique(
    [
      '.steam/root',
      '.steam/steam',
      '.local/share/Steam',
      // Flatpak Steam
      '.var/app/com.valvesoftware.Steam/.local/share/Steam'
    ].map((path) => real(join(home, path)))
  );
  const seen = new Set();
  return roots
    .flatMap((root) => {
      const libs = libraries(root);
      return [
        ...libs.flatMap((library) => toolsIn(join(library, 'steamapps/common'))),
        ...toolsIn(join(root, 'compatibilitytools.d')).map((tool) => ({ ...tool, custom: true }))
      ].flatMap((tool) => {
        const id = readVdf(join(tool.path, 'toolmanifest.vdf')).manifest?.require_tool_appid;
        if (typeof id !== 'string' || seen.has(tool.path)) return [];
        seen.add(tool.path);
        const runtime = runtimeDir(libs, id);
        return [
          {
            ...tool,
            root,
            runtime,
            needs: runtime ? undefined : (runtimeNames[id] ?? `Steam tool ${id}`)
          }
        ];
      });
    })
    .map((build) => ({ build, order: [build.runtime ? 0 : 1, ...rank(build)] }))
    .sort(
      (a, b) =>
        a.order.map((value, index) => value - b.order[index]).find(Boolean) ||
        b.build.name.localeCompare(a.build.name, 'en', { numeric: true })
    )
    .map(({ build: { name, path, root, runtime, needs } }) => ({
      name,
      path,
      root,
      runtime,
      needs
    }));
}

/**
 * What Steam runs for a Windows program [command, args]: the runtime's entry point, then the
 * build's `proton <verb>`. `run` makes or upgrades the prefix first and starts the program through
 * Proton's steam.exe (a new console: its output is lost); `runinprefix` is plain `wine <args>` with
 * our stdin and stdout, in a prefix that exists.
 */
export const protonCommand = (build, verb, args) => [
  join(build.runtime, '_v2-entry-point'),
  ['--verb=waitforexitandrun', '--', join(build.path, 'proton'), verb, ...args]
];

/**
 * Proton's env for a game: `data` is its compat-data folder (the prefix is its `pfx/`), `shared`
 * the folders the container must show the game besides the home folder.
 */
export const protonEnv = (build, data, shared) => ({
  ...process.env,
  STEAM_COMPAT_DATA_PATH: data,
  // proton reads it unguarded when it makes the prefix.
  STEAM_COMPAT_CLIENT_INSTALL_PATH: build.root,
  STEAM_COMPAT_TOOL_PATHS: `${build.path}:${build.runtime}`,
  // What Steam sets for a non-Steam game.
  STEAM_COMPAT_APP_ID: '0',
  STEAM_COMPAT_MOUNTS: shared.join(':'),
  // The container hands the program /dev/null as stdin without it: hook codes go in on stdin.
  PRESSURE_VESSEL_DEVEL: '1',
  LANG: 'ja_JP.UTF-8',
  LC_ALL: 'ja_JP.UTF-8',
  // proton sets LC_ALL from this one and drops LC_ALL without it; the container makes the locale.
  HOST_LC_ALL: 'ja_JP.UTF-8',
  TZ: 'Asia/Tokyo'
});

/**
 * Wine font replacements, as a .reg file: Proton ships MS Gothic, MS PGothic and MS UI Gothic but
 * no Mincho, Meiryo or Yu fonts, and a game asking for one would get a font with no Japanese.
 */
export const fontReplacements = Buffer.from(
  `\ufeffWindows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Software\\Wine\\Fonts\\Replacements]\r\n${[
    [
      'MS Gothic',
      'MS Mincho',
      'ＭＳ 明朝',
      'Meiryo',
      'メイリオ',
      'Yu Gothic',
      '游ゴシック',
      'Yu Mincho',
      '游明朝'
    ],
    ['MS PGothic', 'MS PMincho', 'ＭＳ Ｐ明朝'],
    ['MS UI Gothic', 'Meiryo UI', 'Yu Gothic UI']
  ]
    .flatMap(([font, ...missing]) => missing.map((name) => `"${name}"="${font}"\r\n`))
    .join('')}`,
  'utf16le'
);
