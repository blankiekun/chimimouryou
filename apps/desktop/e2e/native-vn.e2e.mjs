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
// say so. Anki (a fake AnkiConnect): a note mined from a line after the game closed gets no picture,
// or one of another line (each step has its own background colour), or no sound, or another line's
// (each step its own tone), or other programs' sound (a tone playing on the speakers throughout).

/* global indexedDB, localStorage, navigator -- used inside page.evaluate */
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
  writeFileSync
} from 'node:fs';
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

const page = await app.firstWindow();
try {
  page.setDefaultTimeout(timeout);
  await page.waitForLoadState('load');
  await page.evaluate((port) => {
    localStorage.setItem('storageChosen', '1');
    localStorage.setItem('ankiEnabled', '1');
    localStorage.setItem('ankiConnectUrl', `http://127.0.0.1:${port}`);
    // Its steps' sound is tones, not voices: the whole window (line-audio.e2e.mjs checks Voice only).
    localStorage.setItem('ankiVnVoiceOnly', '0');
  }, ankiServer.address().port);
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
  const prefixes = readdirSync(config)
    .map((name) => join(config, name, 'wine-prefixes'))
    .find((path) => existsSync(path));
  const prefix = join(prefixes, saved.folder);
  const user = join(prefix, 'drive_c/users', userInfo().username);
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
  // testvn.c: step 8's caption, background and tone.
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
  const stepHz = (step) => 400 + 80 * step;
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
  // The sound: step 8's tone, louder than its neighbours' and the other program's.
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
  console.log(`OK (screenshot ${join(root, 'hook.png')}, Anki media anki.jpeg and anki.wav)`);
} catch (error) {
  await page.screenshot({ path: join(root, 'failed.png') });
  throw error;
} finally {
  await app.close();
  ankiServer.close();
  otherSound?.kill();
  pulse.kill();
}
