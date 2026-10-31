/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// End-to-end check of the game overlay (overlay.js, /hook/overlay) on Linux/X11 with Wine: the
// real app, helper and LunaHook, the test VN (testvn.c, a line per click), a real window manager
// (openbox) and compositor (xcompmgr). Pointer and keys go through xdotool (XTest), so the X server
// routes them by the overlay's input shape exactly as it does a mouse's. Not in CI.
//
//   apt install openbox xcompmgr xdotool x11-utils imagemagick   (and Wine, mingw-w64 as native-vn)
//   cd apps/desktop && pnpm run fetch && pnpm run build:web
//   xvfb-run -a -s '-screen 0 1280x900x24' node e2e/overlay.e2e.mjs   (E2E_DIR=<dir>: its folder;
//   the app's profile and Wine prefix there are deleted at the end, the screenshots kept)
//
// It fails when: the overlay doesn't open over the running game or doesn't sit on the game's
// window (Wine's coordinates vs X's); it doesn't follow a moved window; it doesn't show /hook's
// newest line; hovering its text with Shift doesn't open the lookup popup (the shape lets no
// pointer through); a click on the game off the text doesn't reach the game or lands in the
// overlay; it stays up while the game is minimized. Artifact: overlay.png (the popup over the game).

/* global document, window, localStorage -- used inside page.evaluate */
import { execFileSync, spawn } from 'node:child_process';
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const desktop = join(import.meta.dirname, '..');
const { _electron } = createRequire(join(desktop, '../web/package.json'))('playwright');
const root = process.env.E2E_DIR ?? mkdtempSync(join(tmpdir(), 'chimi-overlay-'));
const config = join(root, 'config');
const home = join(root, 'home');
const gameDir = join(root, 'games', 'Test VN');
const title = 'テストVN';

const step = (text) => console.log(`- ${text}`);
const fail = (text) => {
  throw new Error(text);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const xdo = (...args) =>
  execFileSync('xdotool', args.map(String), { timeout: 10_000 }).toString().trim();
/** `check`'s value once truthy; `seen` says what was there instead, for the failure. */
let seen = '';
async function until(what, check, ms = 15_000) {
  seen = '';
  for (const end = Date.now() + ms; Date.now() < end; await wait(200)) {
    const value = await check();
    if (value) return value;
  }
  fail(`timed out: ${what}${seen && ` (${seen})`}`);
}

rmSync(root, { recursive: true, force: true });
mkdirSync(gameDir, { recursive: true });
mkdirSync(join(home, 'Documents'), { recursive: true });
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

// A one-word Yomitan dictionary for the built-in lookup: 台詞 is in every step's caption.
const dict = join(root, 'dict');
mkdirSync(dict);
writeFileSync(join(dict, 'index.json'), JSON.stringify({ title: 'E2E', revision: '1', format: 3 }));
writeFileSync(
  join(dict, 'term_bank_1.json'),
  JSON.stringify([['台詞', 'せりふ', 'n', '', 0, ['lines of a play'], 1, '']])
);
execFileSync('zip', [
  '-q',
  '-j',
  join(root, 'e2e-dict.zip'),
  ...['index.json', 'term_bank_1.json'].map((name) => join(dict, name))
]);

const wm = spawn('openbox', [], { stdio: 'ignore' });
const compositor = spawn('xcompmgr', [], { stdio: 'ignore' });
await wait(1000);

const app = await _electron.launch({
  executablePath: join(desktop, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', desktop],
  env: {
    ...process.env,
    XDG_CONFIG_HOME: config,
    HOME: home,
    // No sound server: Anki media isn't tested here.
    PULSE_SERVER: 'unix:/nonexistent',
    // testvn: a line per click only, and a window tall enough for the popup.
    TESTVN_MS: '600000',
    TESTVN_HEIGHT: '600'
  }
});

// The app's own output, for a failed run.
const appLog = createWriteStream(join(root, 'app.log'));
app.process().stdout.pipe(appLog);
app.process().stderr.pipe(appLog);
app.process().on('exit', (code, signal) => console.log(`  (the app exited: ${code} ${signal})`));

/** The overlay's BrowserWindow: bounds and visibility. */
const overlayWindow = () =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('/hook/overlay')
    );
    return win && { bounds: win.getBounds(), visible: win.isVisible() };
  });
/** The game's X window (Wine's whole window): its place on the screen. */
// By Wine's window class: the app's /hook window carries the game's title too.
const gameXid = () => xdo('search', '--onlyvisible', '--class', 'testvn.exe').split('\n').at(-1);
const geometry = (xid) => {
  const info = execFileSync('xwininfo', ['-id', xid]).toString();
  const value = (name) => Number(new RegExp(`${name}:\\s+(-?\\d+)`).exec(info)[1]);
  return {
    x: value('Absolute upper-left X'),
    y: value('Absolute upper-left Y'),
    width: value('Width'),
    height: value('Height')
  };
};
const same = (a, b) => ['x', 'y', 'width', 'height'].every((key) => Math.abs(a[key] - b[key]) <= 2);

const page = await app.firstWindow();
await app.evaluate(({ app: electronApp, BrowserWindow }) => {
  const watch = (w) =>
    w.on('close', () => console.log('E2E-CLOSE', w.webContents.getURL(), new Error().stack));
  BrowserWindow.getAllWindows().forEach(watch);
  electronApp.on('browser-window-created', (_e, w) => watch(w));
  electronApp.on('before-quit', () => console.log('E2E-QUIT', new Error().stack));
});
let overlay;
try {
  page.setDefaultTimeout(180_000);
  await page.waitForLoadState('load');
  await page.evaluate(() => {
    localStorage.setItem('storageChosen', '1');
    localStorage.setItem('builtInLookups', '1');
  });

  step('A dictionary for the built-in lookup');
  await page.goto('http://127.0.0.1:41917/settings');
  await page.locator('.settings-nav-area-button', { hasText: 'Dictionary lookups' }).click();
  await page
    .locator('label', { hasText: 'Import dictionaries' })
    .locator('input')
    .setInputFiles({
      name: 'e2e-dict.zip',
      mimeType: 'application/zip',
      buffer: readFileSync(join(root, 'e2e-dict.zip'))
    });
  await page.getByText('E2E', { exact: true }).first().waitFor();

  step('Import → Installed game, Play natively');
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
  }, gameDir);
  await page.goto('http://127.0.0.1:41917/manage');
  await page.getByTitle('Import books').click();
  await page.getByRole('button', { name: 'Installed game…' }).click();
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await page.locator('.ng-program', { hasText: 'testvn.exe' }).click();
  await page.locator('.ng-field input').fill(title);
  await page.getByRole('button', { name: 'Add game' }).click();
  await page.locator('.ng').waitFor({ state: 'detached' });
  const id = await page.evaluate(
    (wanted) =>
      new Promise((resolve) => {
        const open = window.indexedDB.open('books');
        open.onsuccess = () => {
          const request = open.result.transaction('data').objectStore('data').getAll();
          request.onsuccess = () =>
            resolve(request.result.find((book) => book.title === wanted).id);
        };
      }),
    title
  );
  await page.goto(`http://127.0.0.1:41917/v?id=${id}`);
  await page.getByRole('button', { name: 'Play natively' }).click();
  await page.waitForURL(/\/hook\?native=/);

  step('The caption thread (a line per step) picked');
  const xid = await until(
    'the game window',
    () => {
      try {
        return gameXid();
      } catch {
        return undefined;
      }
    },
    180_000
  );
  const clickGame = (fx, fy) => {
    const at = geometry(xid);
    xdo('mousemove', Math.round(at.x + at.width * fx), Math.round(at.y + at.height * fy));
    xdo('click', 1);
  };
  const caption = page.locator('.nt-row', { hasText: 'DrawTextExW' });
  await until(
    'the DrawTextExW thread',
    async () => {
      clickGame(0.5, 0.3);
      await wait(1200);
      return caption.count();
    },
    60_000
  );
  await caption.first().click();
  const lineCount = () => page.locator('.hook-text li').count();

  step('Overlay on: it sits on the game’s window and shows the newest line');
  await page.getByLabel('Text overlay over the game').check();
  console.log('  checked');
  xdo('windowactivate', '--sync', xid);
  console.log('  activated');
  clickGame(0.5, 0.3);
  const newest = await until('a line on /hook', async () =>
    (await lineCount()) ? page.locator('.hook-text li').last().textContent() : undefined
  );
  overlay = await until('the overlay page', () =>
    app.windows().find((w) => w.url().includes('/hook/overlay'))
  );
  await until(`the overlay showing ${newest.trim()}`, async () =>
    (await overlay.locator('.hook-text span').textContent())?.includes(newest.trim())
  );
  await until('the overlay over the game', async () => {
    const win = await overlayWindow();
    seen = JSON.stringify({ overlay: win, game: geometry(xid) });
    return win?.visible && same(win.bounds, geometry(xid));
  });

  step('It follows the moved window');
  xdo('windowmove', '--sync', xid, 200, 150);
  await until('the overlay at the moved window', async () => {
    const win = await overlayWindow();
    const at = geometry(xid);
    seen = JSON.stringify({ overlay: win, game: at });
    return at.x !== 0 && win?.visible && same(win.bounds, at);
  });

  step('Shift + hover over 台詞 opens the lookup popup');
  await overlay.evaluate(() => {
    window.e2eDowns = 0;
    document.addEventListener('mousedown', () => (window.e2eDowns += 1), true);
  });
  const word = await overlay.evaluate(() => {
    const span = document.querySelector('.hook-text span');
    const node = span.firstChild;
    const range = document.createRange();
    const at = node.textContent.indexOf('台詞');
    range.setStart(node, at);
    range.setEnd(node, at + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  const { bounds } = await overlayWindow();
  xdo('mousemove', Math.round(bounds.x + word.x - 3), Math.round(bounds.y + word.y));
  xdo('keydown', 'shift');
  await wait(100);
  xdo('mousemove', Math.round(bounds.x + word.x), Math.round(bounds.y + word.y));
  await overlay.locator('.ttu-dict', { hasText: 'lines of a play' }).waitFor({ timeout: 10_000 });
  xdo('keyup', 'shift');
  await wait(300);
  execFileSync('import', ['-window', 'root', join(root, 'overlay.png')]);

  step('A click on the game off the text advances it; the overlay gets no click');
  const before = await lineCount();
  // Away from the popup first (its grace ends), then the game's upper part.
  const at = geometry(xid);
  xdo('mousemove', at.x + 20, at.y + Math.round(at.height * 0.2));
  await wait(600);
  clickGame(0.1, 0.2);
  await until('a new line after the click', async () => (await lineCount()) > before);
  const downs = await overlay.evaluate(() => window.e2eDowns);
  if (downs) fail(`the overlay got ${downs} mousedown(s)`);
  if (await overlay.locator('.ttu-dict').isVisible())
    fail('the popup stayed open after the game moved on');

  step('Hidden while the game is minimized');
  xdo('windowminimize', '--sync', xid);
  await until('the overlay hidden', async () => !(await overlayWindow())?.visible);
  // shortcut: not restored here: xdotool's windowmap under openbox maps the client while the frame
  // stays iconic (Wine then says shown); check restoring by hand from a taskbar.
  console.log(`OK (screenshot ${join(root, 'overlay.png')})`);
} catch (error) {
  execFileSync('import', ['-window', 'root', join(root, 'failed.png')]);
  throw error;
} finally {
  // Wine's processes can keep Playwright's close waiting.
  await Promise.race([app.close().catch(() => {}), wait(10_000)]);
  wm.kill();
  compositor.kill();
  // The Wine prefix (~1.5 GB) and the app's profile.
  await wait(2000);
  rmSync(config, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
