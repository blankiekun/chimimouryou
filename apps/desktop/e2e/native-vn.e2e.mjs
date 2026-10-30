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

/* global indexedDB, localStorage -- used inside page.evaluate */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
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

const step = (text) => console.log(`- ${text}`);
const fail = (text) => {
  throw new Error(text);
};

rmSync(root, { recursive: true, force: true });
mkdirSync(gameDir, { recursive: true });
mkdirSync(config, { recursive: true });
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
  env: { ...process.env, XDG_CONFIG_HOME: config }
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
  await page.locator('.nt-row.nt-current', { hasText: 'DrawTextW' }).waitFor();
  await page
    .locator('.hook-text li', { hasText: '何でも薄暗いじめじめした所で泣いていた。' })
    .waitFor();
  await page.getByText('The game has closed.').waitFor();
  await page.screenshot({ path: join(root, 'hook.png') });
  console.log(`OK (screenshot ${join(root, 'hook.png')})`);
} catch (error) {
  await page.screenshot({ path: join(root, 'failed.png') });
  throw error;
} finally {
  await app.close();
}
