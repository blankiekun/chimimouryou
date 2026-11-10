/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// End-to-end check of games played natively (games.js, /hook?native=), Linux with Wine: the real
// app, the real helper and LunaHook, a tiny test VN (testvn.c, 32-bit) drawing a line every 1.5 s.
// Only the OS folder dialog is answered by the test. Not in CI (needs Wine, mingw, a display, and
// PulseAudio's pulseaudio, pactl and parec: the test runs its own PulseAudio with a null sink;
// x11-utils' xwininfo and xprop stand in for a window manager).
//
//   cd apps/desktop && pnpm run fetch && pnpm run build:web
//   xvfb-run -a node e2e/native-vn.e2e.mjs        (E2E_DIR=<dir> keeps the run's files there;
//                                                 PULSE_MODULES=<dir> for a PulseAudio not installed;
//                                                 E2E_APP=<squashfs-root>/chimimouryou runs a packaged
//                                                 build: `pnpm run dist`, then --appimage-extract)
//
//   E2E_RUNNER=proton xvfb-run -a node e2e/native-vn.e2e.mjs
// runs all of it through the app's Proton path instead (proton.js): a made-up Steam folder in the
// test's home with a "Proton 10.0" and its runtime, both small scripts in front of this computer's
// Wine that keep the real ones' rules the app depends on (the container's entry point drops stdin
// without PRESSURE_VESSEL_DEVEL=1; proton refuses to start without its compat-data path, takes
// LC_ALL from HOST_LC_ALL only, makes the prefix only on `run`, whose program's output is lost,
// and names the user `steamuser`). Valve's own Proton and container aren't run. It also fails
// when: Settings doesn't offer the build or the game doesn't start with it; the prefix isn't under
// proton-prefixes/<folder>/pfx with its saves under `steamuser`; the font replacements aren't in
// its registry; a game switched to Wine doesn't find its Proton saves in the Wine prefix with
// their times, gets files outside the save folders, or has a newer file there overwritten.
//
// It fails when: Import offers Windows game (VNBox, which the app doesn't ship: its player waits on
// "Downloading…" for good); a game opened from the library doesn't go to /hook and start in Wine
// (/v starts VNBox, or waits on a click), or, not linked here, doesn't ask for its folder and then
// start; the record isn't
// written by Import → Installed game; the folder dialog's program
// list misses the game or puts setup tools first; the helper, Wine prefix or LunaHook injection
// doesn't start; lines don't reach /hook's thread list; a picked thread's lines don't reach the
// text list or the pick isn't saved on the record; a moved game isn't asked for again.
// Save sync (the record syncs to a folder, the page's private one, as VNBox's would): the run's saves
// don't reach vnsaves.json under VNBox's names (`wine/drive_c/users/username/…`, `game/…`) or carry
// the wrong contents; files outside isWindowsSaveKey's folders (temp, cache, windows/) are pushed;
// the prefix's Documents still leads into the home folder; a newer save in vnsaves.json (as VNBox
// writes it) isn't where the game reads it at the next start, or its time isn't kept; a synced
// Startup .bat or game/*.dll is written; saves over the 20 MB cap are pushed or the page doesn't
// say so; a game closed after leaving /hook pushes nothing. Closed with no /hook open (the root
// layout's watcher, which knows no /hook session after a full page load): on /v nothing is pushed
// without a next start; with no page loaded, nothing at the next page load (Back, reload); a later
// page load or a /hook that heard the exit too writes vnsaves.json again; a failed push isn't logged,
// or isn't retried at the next start. Anki (a fake AnkiConnect): a note mined from a line after the game closed gets no picture,
// or one of another line (each step has its own background colour), or no sound, or another line's
// (each step's speech carries its own pilot tone), or other programs' sound (a tone playing on the
// speakers throughout). Beyond auto hooks: a game whose text no auto hook sees (testvn's hidden mode)
// gets no lines from a hook code typed on /hook, a code carrying a second command reaches the
// helper, or the saved code isn't inserted again at the next start; a launcher's game
// (launcher.exe starts testvn.exe and exits) isn't hooked or its session ends with the launcher;
// Launch only loads LunaHook, or its WebSocket lines don't show or get no Anki number; a game
// started outside the app can't be picked from Attach's list and hooked.

/* global indexedDB, localStorage, navigator, window -- used inside page.evaluate */
import { Buffer } from 'node:buffer';
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

const desktop = join(import.meta.dirname, '..');
// Playwright is the web app's (browser tests); no copy of it here.
const { _electron } = createRequire(join(desktop, '../web/package.json'))('playwright');
const root = process.env.E2E_DIR ?? mkdtempSync(join(tmpdir(), 'chimi-native-'));
const config = join(root, 'config');
const games = join(root, 'games');
const gameDir = join(games, 'Test VN');
const title = 'テストVN';
const timeout = 180_000;
// A home of its own: Wine links the prefix's Documents and Desktop into it unless they're replaced.
const home = join(root, 'home');

const step = (text) => console.log(`- ${text}`);
const fail = (text) => {
  throw new Error(text);
};

rmSync(root, { recursive: true, force: true });
mkdirSync(gameDir, { recursive: true });
mkdirSync(config, { recursive: true });
mkdirSync(join(home, 'Documents'), { recursive: true });
mkdirSync(join(home, 'Desktop'), { recursive: true });
// E2E_RUNNER=proton: Steam's folders as proton.js reads them, with stand-ins for the two programs.
// E2E_STEAM=<a Steam folder with a real Proton and its runtime> is used in their place.
const proton = process.env.E2E_RUNNER === 'proton';
if (proton && process.env.E2E_STEAM) {
  mkdirSync(join(home, '.local/share'), { recursive: true });
  symlinkSync(process.env.E2E_STEAM, join(home, '.local/share/Steam'));
} else if (proton) {
  const steamapps = join(home, '.local/share/Steam/steamapps');
  const files = {
    'appmanifest_1628350.acf': `"AppState"\n{\n\t"appid"\t\t"1628350"\n\t"installdir"\t\t"SteamLinuxRuntime_sniper"\n}\n`,
    'common/Proton 10.0/toolmanifest.vdf': `"manifest"\n{\n\t"version"\t"2"\n\t"commandline"\t"/proton %verb%"\n\t"require_tool_appid"\t"1628350"\n}\n`,
    'common/Proton 10.0/version': '1 proton-10.0-e2e\n',
    // The container: the command after "--", with no stdin unless developer mode is on.
    'common/SteamLinuxRuntime_sniper/_v2-entry-point': `#!/bin/sh
while [ "$#" -gt 0 ] && [ "$1" != -- ]; do shift; done
shift
[ "\${PRESSURE_VESSEL_DEVEL:-}" = 1 ] || exec </dev/null
exec "$@"
`,
    'common/Proton 10.0/proton': `#!/bin/sh
[ -n "\${STEAM_COMPAT_DATA_PATH:-}" ] || { echo 'No compat data path?' >&2; exit 1; }
export WINEPREFIX="$STEAM_COMPAT_DATA_PATH/pfx" WINEARCH=win64
export WINEDEBUG=-all WINEDLLOVERRIDES='mscoree,mshtml='
if [ -n "\${HOST_LC_ALL:-}" ]; then export LC_ALL="$HOST_LC_ALL"; else unset LC_ALL; fi
verb=$1
shift
case $verb in
  run)
    # setup_prefix reads it unguarded; steam.exe gives the program a new console.
    : "\${STEAM_COMPAT_CLIENT_INSTALL_PATH:?}"
    mkdir -p "$WINEPREFIX"
    wineboot -i && wineserver -w
    # Proton's user is steamuser whoever runs it; plain Wine names it after the Unix user, so that
    # name leads to the real folder (the app never reads through a link).
    users=$WINEPREFIX/drive_c/users
    [ -d "$users/steamuser" ] || { mv "$users/$(id -un)" "$users/steamuser" && ln -s steamuser "$users/$(id -un)"; }
    wine "$@" >/dev/null 2>&1
    ;;
  runinprefix)
    [ -d "$WINEPREFIX/drive_c" ] || { echo 'No prefix' >&2; exit 1; }
    exec wine "$@"
    ;;
  *)
    echo 'Need a verb.' >&2
    exit 1
    ;;
esac
`
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(steamapps, path, '..'), { recursive: true });
    writeFileSync(join(steamapps, path), text, { mode: 0o755 });
  }
}
execFileSync('i686-w64-mingw32-gcc', [
  '-municode',
  '-mwindows',
  '-O2',
  '-s',
  '-o',
  join(gameDir, 'testvn.exe'),
  join(import.meta.dirname, 'testvn.c'),
  '-lole32',
  '-luuid',
  '-lwinmm'
]);
// The speech its steps play (testvn.c): the app's clips keep only voices.
mkdirSync(join(gameDir, 'voices'));
copyFileSync(join(import.meta.dirname, 'voices/voice8.wav'), join(gameDir, 'voices/voice8.wav'));
// A setup tool beside it: listed after the game.
copyFileSync(join(gameDir, 'testvn.exe'), join(gameDir, 'setup.exe'));

// Our own PulseAudio: one null sink as the speakers.
const pulseDir = join(root, 'pulse');
mkdirSync(pulseDir);
writeFileSync(
  join(pulseDir, 'default.pa'),
  `load-module module-native-protocol-unix socket=${pulseDir}/native auth-anonymous=1
load-module module-null-sink sink_name=speakers
set-default-sink speakers
`
);
const pulseEnv = {
  ...process.env,
  HOME: home,
  PULSE_RUNTIME_PATH: pulseDir,
  PULSE_STATE_PATH: pulseDir,
  PULSE_SERVER: `unix:${pulseDir}/native`
};
const pulse = spawn(
  'pulseaudio',
  [
    '-n',
    '--daemonize=no',
    '--exit-idle-time=-1',
    ...(process.env.PULSE_MODULES ? [`--dl-search-path=${process.env.PULSE_MODULES}`] : []),
    '-F',
    join(pulseDir, 'default.pa')
  ],
  { env: pulseEnv, stdio: 'ignore' }
);
// Every way out stops it (a failed start, a throw before the try, Ctrl+C): a leftover one keeps
// the D-Bus name org.PulseAudio1, and the next run's then doesn't start.
process.on('exit', () => pulse.kill());
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));
for (let tries = 0; !existsSync(join(pulseDir, 'native')); tries += 1) {
  if (tries > 50) fail('PulseAudio didn’t start (pulseaudio and pulseaudio-utils needed)');
  await new Promise((resolve) => setTimeout(resolve, 100));
}
// A fake AnkiConnect: notes the test adds, and what the app writes into them.
const anki = { notes: [], updates: [] };
const otherHz = 3000;
let otherSound;
const ankiServer = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    const { action, params } = body ? JSON.parse(body) : {};
    let result = null;
    if (action === 'findNotes') result = anki.notes.map((note) => note.noteId);
    else if (action === 'notesInfo')
      result = anki.notes.filter((note) => params.notes.includes(note.noteId));
    else if (action === 'updateNoteFields') anki.updates.push(params.note);
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    response.end(JSON.stringify({ result, error: null }));
  });
});
await new Promise((resolve) => ankiServer.listen(0, '127.0.0.1', resolve));
// A texthooker WebSocket (Textractor's role) for Launch only: text frames to /hook, nothing read.
const sockets = [];
const wsServer = createServer();
wsServer.on('upgrade', (request, socket) => {
  const accept = createHash('sha1')
    .update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.on('error', () => {});
  sockets.push(socket);
});
await new Promise((resolve) => wsServer.listen(0, '127.0.0.1', resolve));

const app = await _electron.launch({
  executablePath: process.env.E2E_APP ?? join(desktop, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', ...(process.env.E2E_APP ? [] : [desktop])],
  // Electron's userData follows XDG_CONFIG_HOME on Linux: a fresh profile, Wine prefixes included.
  // winetricks' downloads stay in the real cache.
  env: {
    ...process.env,
    XDG_CONFIG_HOME: config,
    HOME: home,
    PULSE_SERVER: pulseEnv.PULSE_SERVER,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache')
  }
});
const pickFolder = (dir) =>
  app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
  }, dir);

/**
 * Xvfb has no window manager, and screen capture (desktopCapturer) lists only windows one manages:
 * the game's windows get the WM_STATE a window manager would set.
 */
const manageGameWindows = () => {
  for (const line of execFileSync('xwininfo', ['-root', '-tree']).toString().split('\n'))
    if (line.includes('("testvn.exe"'))
      execFileSync('xprop', [
        '-id',
        line.trim().split(' ')[0],
        '-f',
        'WM_STATE',
        '32c',
        '-set',
        'WM_STATE',
        '1'
      ]);
};

/** The game's record from the books database. */
const record = (page) =>
  page.evaluate(
    (wanted) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('books');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction('data').objectStore('data').getAll();
          request.onsuccess = () => resolve(request.result.find((book) => book.title === wanted));
        };
      }),
    title
  );

/** The record's sync folder: the page's private folder (OPFS), a folder storage source. */
const useSyncFolder = (page) =>
  page.evaluate(async (wanted) => {
    const folder = await navigator.storage.getDirectory();
    await folder.getDirectoryHandle(wanted, { create: true });
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('books');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['storageSource', 'data'], 'readwrite');
      tx.objectStore('storageSource').put({
        name: 'E2E folder',
        type: 'fs',
        data: { directoryHandle: folder },
        storedInManager: true,
        encryptionDisabled: true,
        lastSourceModified: Date.now()
      });
      const books = tx.objectStore('data');
      const all = books.getAll();
      all.onsuccess = () =>
        books.put({
          ...all.result.find((book) => book.title === wanted),
          storageSource: 'E2E folder'
        });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, title);

/** vnsaves.json in the sync folder (its text), or writes it. */
const vnsaves = (page, text) =>
  page.evaluate(
    async ([wanted, next]) => {
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle(wanted);
      if (next === undefined) {
        const file = await folder.getFileHandle('vnsaves.json').catch(() => undefined);
        return file ? (await file.getFile()).text() : undefined;
      }
      const writer = await (
        await folder.getFileHandle('vnsaves.json', { create: true })
      ).createWritable();
      await writer.write(next);
      await writer.close();
    },
    [title, text]
  );

/** When vnsaves.json was last written. */
const vnsavesWritten = (page) =>
  page.evaluate(async (wanted) => {
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle(wanted);
    return (await (await folder.getFileHandle('vnsaves.json')).getFile()).lastModified;
  }, title);

/** A record /v keeps open in the app (an ONScripter one; its files don't matter here): its id. */
const addOtherVn = (page) =>
  page.evaluate(async (wanted) => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('books');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise((resolve, reject) => {
      const store = db.transaction('data', 'readwrite').objectStore('data');
      const all = store.getAll();
      all.onsuccess = () => {
        const game = { ...all.result.find((book) => book.title === wanted) };
        delete game.id;
        const added = store.add({
          ...game,
          title: `${wanted} on /v`,
          elementHtml: `<!--ttu-vn-->${JSON.stringify({ encoding: 'sjis', files: [] })}`,
          storageSource: undefined
        });
        added.onsuccess = () => resolve(added.result);
        added.onerror = () => reject(added.error);
      };
    });
  }, title);

const removeBook = (page, id) =>
  page.evaluate(async (wanted) => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('books');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise((resolve, reject) => {
      const removed = db.transaction('data', 'readwrite').objectStore('data').delete(wanted);
      removed.onsuccess = () => resolve();
      removed.onerror = () => reject(removed.error);
    });
  }, id);

/** vnsaves.json once it has `name` with a time after `after`. */
async function syncedSave(page, name, after = 0) {
  for (let tries = 0; tries < 60; tries += 1) {
    const text = await vnsaves(page);
    const saves = text ? JSON.parse(text) : {};
    if (saves[name]?.modified > after) return saves;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(`vnsaves.json has no ${name} after ${after}: ${await vnsaves(page)}`);
}

const appData = 'wine/drive_c/users/username/AppData/Roaming/TestVN/save1.dat';
const expected = [
  appData,
  'wine/drive_c/users/username/Documents/TestVN/save1.dat',
  'wine/drive_c/users/username/Saved Games/TestVN/save1.dat',
  'game/savedata/save1.dat'
];
const decode = (file) => Buffer.from(file.data, 'base64').toString();
/** Names VNBox may sync (vn-save-store.ts isWindowsSaveKey, which the page applies). */
const saveName =
  /^(?:game\/.+|wine\/drive_c\/(?:users\/username\/(?:AppData|Documents|Saved Games)|ProgramData)\/.+)$/;
const checkNames = (saves) => {
  const names = Object.keys(saves);
  const missing = expected.filter((name) => !names.includes(name));
  if (missing.length) fail(`not synced: ${missing}`);
  const wrong = names.filter((name) => !saveName.test(name) || /\/(temp|tmp)\/|cache/i.test(name));
  if (wrong.length) fail(`synced though not saves: ${wrong}`);
};

async function waitForNoGame() {
  for (let tries = 0; tries < 120; tries += 1) {
    try {
      execFileSync('pgrep', ['-f', 'testvn.exe'], { stdio: 'ignore' });
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail('the game didn’t close');
}

const page = await app.firstWindow();
try {
  page.setDefaultTimeout(timeout);
  await page.waitForLoadState('load');
  await page.evaluate(
    ([port, wsPort]) => {
      localStorage.setItem('storageChosen', '1');
      localStorage.setItem('ankiEnabled', '1');
      localStorage.setItem('ankiConnectUrl', `http://127.0.0.1:${port}`);
      localStorage.setItem('hookSocketUrl', `ws://127.0.0.1:${wsPort}`);
    },
    [ankiServer.address().port, wsServer.address().port]
  );
  await page.goto('http://127.0.0.1:41917/manage');

  step('Import → Installed game');
  await pickFolder(gameDir);
  await page.getByTitle('Import books').click();
  if (await page.getByRole('button', { name: 'Windows game…' }).count())
    fail('Import offers Windows game, which needs VNBox');
  await page.getByRole('button', { name: 'Installed game…' }).click();
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  const programs = await page.locator('.ng-program span:first-of-type').allTextContents();
  if (programs.join() !== 'testvn.exe,setup.exe') fail(`programs listed: ${programs}`);
  await page.locator('.ng-program', { hasText: 'testvn.exe' }).click();
  await page.locator('.ng-field input').fill(title);
  await page.getByRole('button', { name: 'Add game' }).click();
  await page.locator('.ng').waitFor({ state: 'detached' });
  const book = await record(page);
  if (!book?.elementHtml.includes('"exe":"testvn.exe"')) fail('no record with the program');

  step('Not linked on this computer (Settings → Forget), opened from the library: folder dialog');
  await page.goto('http://127.0.0.1:41917/settings');
  await page.getByRole('button', { name: 'Forget' }).click();
  await page.getByText('No games linked yet.').waitFor();
  if (proton) {
    // Automatic is Wine here (it's installed): the build is picked as a reader would.
    // After Automatic and Wine: the first build found.
    await page.getByLabel('Runs games with').selectOption({ index: 2 });
    await page.getByText(', from Steam').waitFor();
  }
  await page.goto('http://127.0.0.1:41917/manage');
  await page.locator(`.cover-card-main[title="${title}"]`).click();
  await page.getByText('Read', { exact: true }).click();
  await page.waitForURL(/\/hook\?native=/);
  if (page.frames().some((frame) => frame.url().includes('vnbox.html'))) fail('/v started VNBox');
  if (await page.getByRole('button', { name: 'Add the game files' }).count())
    fail('offers copying the game into the browser');

  step('Folder picked: /hook, the game starts in Wine, first start makes the prefix');
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await page.getByRole('button', { name: 'Link and play' }).click();
  const drawText = page.locator('.nt-row', { hasText: 'DrawTextW' });
  await drawText.waitFor();
  // Wine runs the game: pgrep exits non-zero (throws) without a testvn.exe process.
  execFileSync('pgrep', ['-f', 'testvn.exe']);
  await drawText.click();
  await page
    .locator('.hook-text li', { hasText: '何でも薄暗いじめじめした所で泣いていた。' })
    .waitFor();
  const lines = await page.locator('.hook-text li').allTextContents();
  if (lines.some((line) => !line.includes('何でも薄暗い')))
    fail(`lines from other threads: ${lines}`);
  await page.getByText('The game has closed.').waitFor();
  const saved = JSON.parse((await record(page)).elementHtml.replace('<!--ttu-vn-->', ''));
  if (!saved.nativeHook?.hookcode.includes('DrawTextW'))
    fail(`hook not saved: ${saved.nativeHook}`);
  // The library's open rewrites the record (prepareBookForReading): its sync folder from here on.
  await useSyncFolder(page);
  await page.getByRole('button', { name: 'Start the game' }).click();
  await page.locator('.nt-row').first().waitFor();
  await page.getByText('The game has closed.').waitFor();

  step('Closed: its saves are in vnsaves.json under VNBox’s names');
  let synced = await syncedSave(page, appData);
  checkNames(synced);
  if (decode(synced[appData]) !== 'step=10\n') fail(`save contents: ${decode(synced[appData])}`);
  if (existsSync(join(home, 'Documents/TestVN'))) fail('the save went into the home folder');
  const userData = readdirSync(config)
    .map((name) => join(config, name))
    .find((path) => existsSync(join(path, proton ? 'proton-prefixes' : 'wine-prefixes')));
  if (!userData) fail(`no ${proton ? 'Proton' : 'Wine'} prefix was made`);
  const winePrefix = join(userData, 'wine-prefixes', saved.folder);
  if (proton && existsSync(winePrefix)) fail('a Wine prefix was made for a game on Proton');
  const prefix = proton ? join(userData, 'proton-prefixes', saved.folder, 'pfx') : winePrefix;
  const user = join(prefix, 'drive_c/users', proton ? 'steamuser' : userInfo().username);
  // Not saves: the next push must leave them out.
  for (const junk of ['AppData/Local/Temp/junk.dat', 'AppData/Local/TestVN/cache/junk.dat']) {
    mkdirSync(join(user, junk, '..'), { recursive: true });
    writeFileSync(join(user, junk), 'junk');
  }
  writeFileSync(join(prefix, 'drive_c/windows/junk.dat'), 'junk');

  step('A newer save from VNBox is where the game reads it at the next start');
  const fromVnbox = Date.now();
  const gameSave = 'game/savedata/save1.dat';
  // Runnable names a synced file (or a bad page) could plant: main must never write them.
  const startup = 'AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/x.bat';
  const planted = Buffer.from('planted').toString('base64');
  await vnsaves(
    page,
    JSON.stringify({
      ...synced,
      [appData]: { modified: fromVnbox, data: Buffer.from('from VNBox\n').toString('base64') },
      [gameSave]: {
        modified: fromVnbox,
        data: Buffer.from('from VNBox game\n').toString('base64')
      },
      [`wine/drive_c/users/username/${startup}`]: { modified: fromVnbox, data: planted },
      'game/d3d9.dll': { modified: fromVnbox, data: planted }
    })
  );

  step('The game moved: asked again, then lines come on the saved thread');
  const moved = join(games, 'Test VN moved');
  renameSync(gameDir, moved);
  await pickFolder(moved);
  // The same line again would count as a repeat of the last one.
  await page.getByRole('button', { name: 'Clear lines' }).click();
  await page.getByRole('button', { name: 'Start the game' }).click();
  await page.getByText(/isn’t at .*Test VN any more/).waitFor();
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  if (!(await page.locator('.ng-program input').first().isChecked()))
    fail('the record’s program isn’t pre-selected');
  await page.getByRole('button', { name: 'Link and play' }).click();
  await page.locator('.nt-row').first().waitFor();
  // Read before the game's own save (its 5th line).
  for (const [file, text] of [
    [join(user, 'AppData/Roaming/TestVN/save1.dat'), 'from VNBox\n'],
    [join(moved, 'savedata/save1.dat'), 'from VNBox game\n']
  ]) {
    if (readFileSync(file, 'utf8') !== text) fail(`${file} wasn’t pulled: ${readFileSync(file)}`);
    if (Math.floor(statSync(file).mtimeMs) !== fromVnbox) fail(`${file} lost the synced time`);
  }
  for (const file of [join(user, startup), join(moved, 'd3d9.dll')])
    if (existsSync(file)) fail(`a blocked name was written: ${file}`);
  await page.locator('.nt-row.nt-current', { hasText: 'DrawTextW' }).waitFor();
  await page
    .locator('.hook-text li', { hasText: '何でも薄暗いじめじめした所で泣いていた。' })
    .waitFor();
  await page.getByText('The game has closed.').waitFor();
  synced = await syncedSave(page, appData, fromVnbox);
  checkNames(synced);
  if (decode(synced[appData]) !== 'step=10\n') fail(`save contents: ${decode(synced[appData])}`);
  if (decode(synced[gameSave]) !== 'step=10\n') fail(`game save: ${decode(synced[gameSave])}`);

  step('/hook left while the game runs: its saves still go up when it closes');
  const pushedAt = JSON.parse(await vnsaves(page))[appData].modified;
  await page.getByRole('button', { name: 'Start the game' }).click();
  await page.getByText('Playing.').waitFor();
  // The app's own link: page.goto would load in full, which a real click in the app doesn't.
  await page.locator('a[href$="/manage"]').first().click();
  await page.waitForURL(/\/manage/);
  await syncedSave(page, appData, pushedAt);
  await page.goBack();
  await page.locator('.nt-row').first().waitFor();
  await page.getByText('The game has closed.').waitFor();

  step('Closed on /v, after a full page load: its saves go up with no next start');
  const hookUrl = page.url();
  const otherVn = await addOtherVn(page);
  await page.goto(hookUrl);
  await page.getByText('Playing.').waitFor();
  const onV = Date.now();
  await page.goto(new URL(`/v?id=${otherVn}`, hookUrl).href);
  await page.locator('.vn-page').waitFor();
  await waitForNoGame();
  if (new URL(page.url()).pathname !== '/v') fail(`not on /v: ${page.url()}`);
  await syncedSave(page, appData, onV);

  step('A page load after that writes nothing again');
  const written = await vnsavesWritten(page);
  await page.reload();
  await page.locator('.vn-page').waitFor();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  if ((await vnsavesWritten(page)) !== written) fail('pushed again on a page load');

  step('Closed with no page loaded: its saves go up at the next page load');
  await page.goto(hookUrl);
  await page.getByText('Playing.').waitFor();
  const noPage = Date.now();
  await page.goto('about:blank');
  await waitForNoGame();
  await page.goto(new URL('/statistics', hookUrl).href);
  await syncedSave(page, appData, noPage);

  step('/hook open hears the exit too: one write');
  await page.goto(hookUrl);
  await page.getByText('The game has closed.').waitFor();
  await page.evaluate(() => {
    const proto = globalThis.FileSystemFileHandle.prototype;
    const real = proto.createWritable;
    globalThis.vnsavesWrites = 0;
    proto.createWritable = function (...args) {
      if (this.name === 'vnsaves.json') globalThis.vnsavesWrites += 1;
      return real.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Start the game' }).click();
  await page.getByText('Playing.').waitFor();
  await page.getByText('The game has closed.').waitFor();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const writes = await page.evaluate(() => globalThis.vnsavesWrites);
  if (writes !== 1) fail(`/hook and the watcher wrote vnsaves.json ${writes} times`);

  step('A failed push is logged and goes at the next start');
  const warnings = [];
  const onConsole = (message) => warnings.push(message.text());
  page.on('console', onConsole);
  const failedAt = Date.now();
  await page.evaluate(() => {
    const proto = globalThis.FileSystemFileHandle.prototype;
    const real = proto.createWritable;
    proto.createWritable = () => Promise.reject(new Error('E2E: no writing'));
    globalThis.restoreWrites = () => (proto.createWritable = real);
  });
  await page.getByRole('button', { name: 'Start the game' }).click();
  await page.getByText('Playing.').waitFor();
  await page.getByText('The game has closed.').waitFor();
  for (let tries = 0; !warnings.some((text) => text.includes('save sync failed')); tries += 1) {
    if (tries > 40) fail('the failed push wasn’t logged');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  page.off('console', onConsole);
  if (JSON.parse(await vnsaves(page))[appData].modified > failedAt)
    fail('the push that should fail went through: this step tests nothing');
  await page.evaluate(() => globalThis.restoreWrites());
  await page.getByRole('button', { name: 'Start the game' }).click();
  await syncedSave(page, appData, failedAt);
  await page.getByText('The game has closed.').waitFor();
  await removeBook(page, otherVn);

  step('Saves over the 20 MB cap: nothing pushed, the page says so');
  writeFileSync(join(user, 'AppData/Roaming/TestVN/big.dat'), Buffer.alloc(21 * 1024 * 1024));
  const before = await vnsaves(page);
  await page.getByRole('button', { name: 'Start the game' }).click();
  await page.locator('.nt-row').first().waitFor();
  await page.getByText('The game has closed.').waitFor();
  await page.getByText(/over the .* that sync\. They stay on this computer\./).waitFor();
  if ((await vnsaves(page)) !== before) fail('saves over the cap were pushed');

  step('Anki: a note mined from a line gets that line’s screenshot and sound');
  // Another program's tone on the speakers while the game plays: never in the clips.
  const other = Buffer.alloc(24000 * 2 * 60);
  for (let i = 0; i < other.length / 2; i += 1)
    other.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * otherHz * i) / 24000)), i * 2);
  writeFileSync(join(pulseDir, 'other.raw'), other);
  otherSound = spawn(
    'pacat',
    ['--raw', '--format=s16le', '--rate=24000', '--channels=1', join(pulseDir, 'other.raw')],
    { env: pulseEnv, stdio: 'ignore' }
  );
  await page.getByRole('button', { name: 'Start the game' }).click();
  await page.locator('.nt-row', { hasText: 'DrawTextExW' }).click();
  manageGameWindows();
  // testvn.c: step 8's caption, background and pilot tone.
  const mined = '第8場面の台詞です。';
  const colors = [
    [255, 255, 255],
    [255, 80, 80],
    [80, 200, 80],
    [80, 80, 255],
    [240, 200, 40],
    [200, 60, 200],
    [40, 200, 220],
    [250, 140, 30],
    [140, 90, 40],
    [120, 120, 120],
    [30, 30, 30],
    [255, 180, 200]
  ];
  const stepHz = (step) => 4000 + 150 * step;
  await page.locator('.hook-text li', { hasText: mined }).waitFor();
  await page.getByText('The game has closed.').waitFor();
  await page.getByText('Anki clips record this game’s sound.').waitFor();
  anki.notes.push({
    noteId: Date.now(),
    modelName: 'Basic',
    fields: {
      Sentence: { value: mined, order: 0 },
      SentenceAudio: { value: '', order: 1 },
      Picture: { value: '', order: 2 }
    }
  });
  for (let tries = 0; !anki.updates.length; tries += 1) {
    if (tries > 40) fail('the note got no media');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const update = anki.updates[0];
  if (
    !update.picture?.[0]?.filename.endsWith('.jpg') ||
    !update.audio?.[0]?.filename.endsWith('.wav')
  )
    fail(`media: ${JSON.stringify(update, (key, value) => (key === 'data' ? '…' : value))}`);
  // The picture's background, near the bottom right corner (away from the text).
  const pixel = await app.evaluate(({ nativeImage }, data) => {
    const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap(); // BGRA
    const at = ((height - 15) * width + (width - 15)) * 4;
    return [bitmap[at + 2], bitmap[at + 1], bitmap[at]];
  }, update.picture[0].data);
  const distance = (color) => color.reduce((sum, value, i) => sum + (value - pixel[i]) ** 2, 0);
  const shown = colors.indexOf(colors.toSorted((a, b) => distance(a) - distance(b))[0]);
  if (shown !== 8) fail(`the picture shows step ${shown} (pixel ${pixel}), not 8`);
  // The sound: step 8's pilot tone, louder than its neighbours' and the other program's tone.
  const wav = Buffer.from(update.audio[0].data, 'base64');
  const rate = wav.readUInt32LE(24);
  const samples = new Int16Array(
    wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length)
  );
  const power = (hz) => {
    const k = 2 * Math.cos((2 * Math.PI * hz) / rate);
    let [s1, s2] = [0, 0];
    for (const value of samples) [s1, s2] = [value + k * s1 - s2, s1];
    return (s1 * s1 + s2 * s2 - k * s1 * s2) / samples.length ** 2;
  };
  const powers = Object.fromEntries(
    [stepHz(7), stepHz(8), stepHz(9), otherHz].map((hz) => [hz, Math.round(power(hz))])
  );
  const loudest = Object.entries(powers).toSorted((a, b) => b[1] - a[1])[0][0];
  if (+loudest !== stepHz(8) || powers[otherHz] * 50 > powers[stepHz(8)])
    fail(
      `the clip (${(samples.length / rate).toFixed(2)} s) isn’t step 8’s tone alone: ${JSON.stringify(powers)}`
    );
  writeFileSync(join(root, 'anki.jpeg'), Buffer.from(update.picture[0].data, 'base64'));
  writeFileSync(join(root, 'anki.wav'), wav);
  console.log(
    `  clip ${(samples.length / rate).toFixed(2)} s, tone powers ${JSON.stringify(powers)}`
  );

  await page.screenshot({ path: join(root, 'hook.png') });
  otherSound.kill();
  const gameLine = page.locator('.hook-text li', { hasText: /第\d+場面の台詞です。/ });

  step(
    'A hook code: lines no auto hook finds come from the code typed on /hook, saved, and inserted again'
  );
  writeFileSync(join(moved, 'hidden.txt'), '');
  rmSync(join(moved, 'hookaddr.txt'), { force: true });
  await page.getByRole('button', { name: 'Clear lines' }).click();
  await page.getByRole('button', { name: 'Start the game' }).click();
  await page.getByText('Playing.').waitFor();
  const code = `HQ4@${readFileSync(join(moved, 'hookaddr.txt'), 'utf8')}:testvn.exe`;
  await page.getByRole('button', { name: 'Add hook code…' }).click();
  // Main refuses a second command on the same line.
  await page.locator('.nt-code input').fill(`${code}\u2028insert HS0@0:x.dll`);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText('That isn’t an H-code or R-code.').waitFor();
  await page.locator('.nt-code input').fill(code);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const coded = page.locator('.nt-row', { hasText: /場面の台詞です/ });
  await coded.click();
  await gameLine.first().waitFor();
  await page.getByText('The game has closed.').waitFor();
  const withCode = JSON.parse((await record(page)).elementHtml.replace('<!--ttu-vn-->', ''));
  if (!/^HQ4@/.test(withCode.nativeHook?.hookcode ?? ''))
    fail(`hook code not saved: ${JSON.stringify(withCode.nativeHook)}`);
  await page.getByRole('button', { name: 'Clear lines' }).click();
  await page.getByRole('button', { name: 'Start the game' }).click();
  await page.locator('.nt-row.nt-current', { hasText: /場面の台詞です/ }).waitFor();
  await gameLine.first().waitFor();
  await page.getByText('The game has closed.').waitFor();
  rmSync(join(moved, 'hidden.txt'));

  step('A launcher: the game it starts is hooked, and its exit ends the session');
  copyFileSync(join(moved, 'testvn.exe'), join(moved, 'launcher.exe'));
  const viaLauncher = join(games, 'Test VN launcher');
  renameSync(moved, viaLauncher);
  await pickFolder(viaLauncher);
  await page.getByRole('button', { name: 'Clear lines' }).click();
  await page.getByRole('button', { name: 'Start the game' }).click();
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await page.locator('.ng-program', { hasText: 'launcher.exe' }).click();
  await page.getByRole('button', { name: 'Link and play' }).click();
  await page.locator('.nt-row', { hasText: 'DrawTextExW' }).click();
  await gameLine.first().waitFor();
  await page.getByText('The game has closed.').waitFor();

  step('Launch only: no LunaHook, lines from the WebSocket, numbered for Anki');
  const socketLine = 'ソケットから来た行です。';
  const sendLine = (text) => {
    const body = Buffer.from(text);
    for (const socket of sockets)
      socket.write(Buffer.concat([Buffer.from([0x81, body.length]), body]));
  };
  await page.getByLabel('Launch only (I hook with my own tool)').check();
  await page.getByRole('button', { name: 'Start the game' }).click();
  await page.getByText('Playing: lines come from your own text hook.').waitFor();
  for (let tries = 0; !sockets.length; tries += 1) {
    if (tries > 40) fail('/hook didn’t connect to the WebSocket');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // The launcher starts it a moment after the WebSocket connects.
  for (let tries = 0; ; tries += 1) {
    try {
      execFileSync('pgrep', ['-f', 'testvn.exe'], { stdio: 'ignore' });
      break;
    } catch {
      if (tries > 60) fail('the game didn’t start in launch-only mode');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  sendLine(socketLine);
  await page.locator('.hook-text li', { hasText: socketLine }).waitFor();
  if (await page.locator('.nt-row').count()) fail('LunaHook threads in launch-only mode');
  await page.getByText('The game has closed.').waitFor();
  const socketSeq = await page.evaluate(
    () => JSON.parse(localStorage.getItem('hookLines') ?? '[]').at(-1)?.seq
  );
  if (!Number.isInteger(socketSeq)) fail(`the WebSocket line has no Anki number: ${socketSeq}`);
  await page.getByLabel('Launch only (I hook with my own tool)').uncheck();

  step('Attach: a game started outside the app, picked from the list, is hooked');
  const outside = spawn('wine', [join(viaLauncher, 'testvn.exe')], {
    cwd: viaLauncher,
    env: {
      ...process.env,
      HOME: home,
      WINEPREFIX: prefix,
      WINEDEBUG: '-all',
      LANG: 'ja_JP.UTF-8',
      TESTVN_MS: '3000'
    },
    stdio: 'ignore'
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await page.getByRole('button', { name: 'Clear lines' }).click();
  await page.getByRole('button', { name: 'Attach to running game…' }).click();
  await page.locator('.so-row', { hasText: 'testvn.exe' }).click();
  await page.locator('.nt-row', { hasText: 'DrawTextExW' }).click();
  await gameLine.first().waitFor();
  await page.getByText('The game has closed.').waitFor();
  outside.kill();
  await page.screenshot({ path: join(root, 'hook-attach.png') });

  if (proton) {
    step('Switched to Wine: the saves made under Proton are in the Wine prefix at its first start');
    await waitForNoGame();
    // Here, where waiting changes no step's timing: Wine writes the registry file when its
    // server ends, a few seconds after the game.
    const wanted = [
      '"MS Mincho"="MS Gothic"',
      // メイリオ, as Wine writes it.
      '"\\x30e1\\x30a4\\x30ea\\x30aa"="MS Gothic"'
    ];
    for (let tries = 0; ; tries += 1) {
      const registry = existsSync(join(prefix, 'user.reg'))
        ? readFileSync(join(prefix, 'user.reg'), 'utf8')
        : '';
      if (wanted.every((line) => registry.includes(line))) break;
      if (tries > 60) fail(`the prefix has no font replacements (${wanted})`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const saves = 'AppData/Roaming/TestVN';
    const wineUser = join(winePrefix, 'drive_c/users', userInfo().username);
    const carried = Date.now() - 86_400_000;
    writeFileSync(join(user, saves, 'carried.dat'), 'from Proton\n');
    utimesSync(join(user, saves, 'carried.dat'), new Date(), new Date(carried));
    writeFileSync(join(user, saves, 'kept.dat'), 'older, from Proton\n');
    utimesSync(join(user, saves, 'kept.dat'), new Date(), new Date(carried));
    // Already in the Wine prefix and newer: it stays.
    mkdirSync(join(wineUser, saves), { recursive: true });
    writeFileSync(join(wineUser, saves, 'kept.dat'), 'newer, in Wine\n');
    await page.evaluate((folder) => window.chimiDesktop.games.runner(folder, 'wine'), saved.folder);
    await page.getByRole('button', { name: 'Clear lines' }).click();
    await page.getByRole('button', { name: 'Start the game' }).click();
    // The last run's rows are still listed for a moment: this start's own status, then its game.
    await page.getByText('Playing.').waitFor();
    const read = (name) => readFileSync(join(wineUser, saves, name), 'utf8');
    if (
      !existsSync(join(wineUser, saves, 'carried.dat')) ||
      read('carried.dat') !== 'from Proton\n'
    )
      fail('the Proton save isn’t in the Wine prefix');
    if (Math.floor(statSync(join(wineUser, saves, 'carried.dat')).mtimeMs) !== carried)
      fail('the copied save lost its time');
    if (read('kept.dat') !== 'newer, in Wine\n')
      fail('a newer save in the Wine prefix was replaced');
    for (const junk of ['AppData/Local/Temp/junk.dat', 'AppData/Local/TestVN/cache/junk.dat'])
      if (existsSync(join(wineUser, junk))) fail(`copied though not a save: ${junk}`);
    await page.getByText('The game has closed.').waitFor();
  }

  console.log(`OK (screenshot ${join(root, 'hook.png')}, Anki media anki.jpeg and anki.wav)`);
} catch (error) {
  // First, in case closing the app hangs.
  console.log(`FAILED: ${error.message}`);
  await page.screenshot({ path: join(root, 'failed.png') });
  throw error;
} finally {
  await app.close();
  ankiServer.close();
  sockets.forEach((socket) => socket.destroy());
  wsServer.close();
  otherSound?.kill();
  pulse.kill();
}
