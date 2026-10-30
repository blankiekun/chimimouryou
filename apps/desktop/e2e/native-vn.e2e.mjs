/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// End-to-end check of games played natively (games.js, /hook?native=), Linux with Wine: the real
// app, the real helper and LunaHook, a tiny test VN (testvn.c, 32-bit) drawing a line every 1.5 s.
// Only the OS folder dialog is answered by the test. Not in CI (needs Wine, mingw, a display).
//
//   cd apps/desktop && pnpm run fetch && pnpm run build:web
//   xvfb-run -a node e2e/native-vn.e2e.mjs        (E2E_DIR=<dir> keeps the run's files there)
//
// It fails when: the record isn't written by Import → Installed game; the folder dialog's program
// list misses the game or puts setup tools first; the helper, Wine prefix or LunaHook injection
// doesn't start; lines don't reach /hook's thread list; a picked thread's lines don't reach the
// text list or the pick isn't saved on the record; a moved game isn't asked for again.
// Save sync (the record syncs to a folder, the page's private one, as VNBox's would): the run's saves
// don't reach vnsaves.json under VNBox's names (`wine/drive_c/users/username/…`, `game/…`) or carry
// the wrong contents; files outside isWindowsSaveKey's folders (temp, cache, windows/) are pushed;
// the prefix's Documents still leads into the home folder; a newer save in vnsaves.json (as VNBox
// writes it) isn't where the game reads it at the next start, or its time isn't kept; saves over
// the 20 MB cap are pushed or the page doesn't say so.

/* global indexedDB, localStorage, navigator -- used inside page.evaluate */
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
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
  '-luuid'
]);
// A setup tool beside it: listed after the game.
copyFileSync(join(gameDir, 'testvn.exe'), join(gameDir, 'setup.exe'));

const app = await _electron.launch({
  executablePath: join(desktop, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', desktop],
  // Electron's userData follows XDG_CONFIG_HOME on Linux: a fresh profile, Wine prefixes included.
  // winetricks' downloads stay in the real cache.
  env: {
    ...process.env,
    XDG_CONFIG_HOME: config,
    HOME: home,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache')
  }
});
const pickFolder = (dir) =>
  app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
  }, dir);

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
  await page.evaluate(() => localStorage.setItem('storageChosen', '1'));
  await page.goto('http://127.0.0.1:41917/manage');

  step('Import → Installed game');
  await pickFolder(gameDir);
  await page.getByTitle('Import books').click();
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
  await useSyncFolder(page);

  step('/v → Play natively → /hook, first start makes the Wine prefix');
  await page.goto(`http://127.0.0.1:41917/v?id=${book.id}`);
  await page.getByRole('button', { name: 'Play natively' }).click();
  await page.waitForURL(/\/hook\?native=/);
  const drawText = page.locator('.nt-row', { hasText: 'DrawTextW' });
  await drawText.waitFor();
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
  await vnsaves(
    page,
    JSON.stringify({
      ...synced,
      [appData]: { modified: fromVnbox, data: Buffer.from('from VNBox\n').toString('base64') },
      [gameSave]: { modified: fromVnbox, data: Buffer.from('from VNBox game\n').toString('base64') }
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
  await page.screenshot({ path: join(root, 'hook.png') });
  console.log(`OK (screenshot ${join(root, 'hook.png')})`);
} catch (error) {
  await page.screenshot({ path: join(root, 'failed.png') });
  throw error;
} finally {
  await app.close();
}
