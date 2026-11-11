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
// window (Wine's coordinates vs X's); it doesn't follow a moved window; it doesn't show the line
// /hook shows when it opens; hovering its text doesn't open the lookup popup (the shape
// lets no pointer through); a click on the game off the text doesn't reach the game or lands in
// the overlay; it stays up while the game is minimized or doesn't come back once it's restored;
// its X window isn't override-redirect (a window manager would stack it under a fullscreen game,
// and gamescope would not paint it over one); it doesn't cover the game gone fullscreen, take
// lookups there (also after a click on the fullscreen game: Wine then grabs the pointer, and the
// overlay gets no motion, unless the game started with its overlay on), let clicks through, or follow it back to a window; Invisible shows any
// of the line or its background, paints its glyphs when a lookup selects a word, or takes no
// lookup; the screen read puts the line anywhere but on the glyphs the game drew (windowed and
// fullscreen); Off leaves the overlay
// open; Settings → Desktop games doesn't keep a game's mode.
// Artifacts: overlay.png (Band's popup over the game), fullscreen.png, invisible-screen.png and invisible-fullscreen.png (the popup on the game's own text),
// controls-hook.png, controls-settings.png.
// Needs the OCR models in the build: VN_OCR_OUT=../web/build/vn/ocr ../../scripts/vn-ocr/fetch.sh

/* global document, window, localStorage, getComputedStyle -- used inside page.evaluate */
import { execFileSync, spawn } from 'node:child_process';
import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
    // testvn: a line per click only, a window tall enough for the popup, and for the screen read
    // a text box as a VN's: a name over the hooked line, glyphs of a size the line spotter reads, full-width characters.
    TESTVN_BOX: '44',
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

  step('Import → Installed game; opening it plays it natively');
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
  // Band before the game's first start: a game that starts with its overlay on runs without
  // Wine's pointer grab (the fullscreen lookup after a click, below, needs it).
  await page.goto('http://127.0.0.1:41917/settings');
  await page.locator('.settings-nav-area-button', { hasText: 'Desktop games' }).click();
  await page
    .getByRole('radiogroup', { name: 'Text overlay over the game' })
    .getByRole('radio', { name: 'Band' })
    .click();
  await page.getByRole('radio', { name: 'Band', checked: true }).waitFor({ timeout: 10_000 });
  await page.goto(`http://127.0.0.1:41917/v?id=${id}`);
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

  step('Overlay on: it sits on the game’s window and shows the line shown now');
  clickGame(0.5, 0.3);
  const newest = await until('a line on /hook', async () =>
    (await lineCount()) ? page.locator('.hook-text li').last().textContent() : undefined
  );
  // Off and on again while the game runs: Off says the pointer grab comes back at the next start.
  await page.getByRole('radio', { name: 'Off' }).click();
  await until('no overlay window', async () => !(await overlayWindow()));
  await page.getByText('confines the pointer again from its next start').waitFor({ timeout: 5000 });
  await page.getByRole('radio', { name: 'Band' }).click();
  xdo('windowactivate', '--sync', xid);
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

  step('Its X window is override-redirect: no window manager stacks it');
  const overlayXid = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('/hook/overlay'))
      .getNativeWindowHandle()
      .readUInt32LE(0)
  );
  const xinfo = execFileSync('xwininfo', ['-id', overlayXid, '-all']).toString();
  if (!/Override Redirect State: yes/.test(xinfo)) fail(`not override-redirect:\n${xinfo}`);

  step('It follows the moved window');
  xdo('windowmove', '--sync', xid, 200, 150);
  await until('the overlay at the moved window', async () => {
    const win = await overlayWindow();
    const at = geometry(xid);
    seen = JSON.stringify({ overlay: win, game: at });
    return at.x !== 0 && win?.visible && same(win.bounds, at);
  });

  await overlay.evaluate(() => {
    window.e2eDowns = 0;
    window.e2eMoves = 0;
    document.addEventListener('mousedown', () => (window.e2eDowns += 1), true);
    document.addEventListener('mousemove', () => (window.e2eMoves += 1), true);
  });
  /** 台 of the line's 台詞 in the overlay's shown text: its box in the overlay's window. */
  const wordBox = () =>
    overlay.evaluate(() => {
      for (const span of document.querySelectorAll('.hook-text span')) {
        const at = span.textContent.indexOf('台詞');
        if (at < 0 || !span.getClientRects().length) continue;
        // Invisible's rows have one element per character.
        const cells = span.querySelectorAll('i');
        const node = cells.length ? cells[at].firstChild : span.firstChild;
        const from = cells.length ? 0 : at;
        const range = document.createRange();
        range.setStart(node, from);
        range.setEnd(node, from + 1);
        const { x, y, width, height } = range.getBoundingClientRect();
        return { x, y, width, height };
      }
      return undefined;
    });
  /** Hover over 台詞, no key, opens the lookup popup; `shot` keeps the screen. */
  async function lookup(shot) {
    const word = await until('台詞 in the overlay', async () => {
      seen = await overlay.evaluate(() => document.querySelector('.ov-root')?.outerHTML);
      return wordBox();
    });
    const { bounds } = await overlayWindow();
    const x = Math.round(bounds.x + word.x + word.width / 2);
    const y = Math.round(bounds.y + word.y + word.height / 2);
    xdo('mousemove', x - 3, y);
    try {
      await wait(100);
      xdo('mousemove', x, y);
      await overlay
        .locator('.ttu-dict', { hasText: 'lines of a play' })
        .waitFor({ timeout: 10_000 });
    } catch (error) {
      // What the overlay was and saw, for the failure.
      const moves = await overlay.evaluate(() => window.e2eMoves);
      const under = xdo('getmouselocation');
      const rects = await overlay.evaluate(() =>
        [...document.querySelectorAll('.hook-text span')].flatMap((span) =>
          [...span.getClientRects()].map(({ x, y, width, height }) => [x, y, width, height])
        )
      );
      const state = JSON.stringify({ window: await overlayWindow(), word, moves, under, rects });
      throw new Error(`no lookup popup for ${shot}: ${state}`, { cause: error });
    }
    await wait(300);
    execFileSync('import', ['-window', 'root', join(root, shot)]);
  }
  /** A click on the game off the text advances it; the overlay gets no click, the popup closes. */
  async function advance() {
    const before = await lineCount();
    const downs = await overlay.evaluate(() => window.e2eDowns);
    // Away from the popup first (its grace ends), then the game right of its own text.
    const at = geometry(xid);
    xdo('mousemove', at.x + Math.round(at.width * 0.8), at.y + Math.round(at.height * 0.2));
    await wait(600);
    clickGame(0.8, 0.5);
    await until('a new line after the click', async () => (await lineCount()) > before);
    const got = (await overlay.evaluate(() => window.e2eDowns)) - downs;
    if (got) fail(`the overlay got ${got} mousedown(s)`);
    await until('the popup closed after the game moved on', async () =>
      overlay.locator('.ttu-dict').isHidden()
    );
  }
  /** The game's window at `place` (the screen, or its window's) with the overlay on it. */
  const overGame = (what, place) =>
    until(what, async () => {
      const win = await overlayWindow();
      const at = geometry(xid);
      seen = JSON.stringify({ overlay: win, game: at, wanted: place });
      return win?.visible && same(win.bounds, at) && same(at, place);
    });

  step('Hover over 台詞 opens the lookup popup');
  await lookup('overlay.png');

  step('A click on the game off the text advances it; the overlay gets no click');
  await advance();

  step('The game goes fullscreen: the overlay covers it, lookups and clicks work');
  const [width, height] = xdo('getdisplaygeometry').split(' ').map(Number);
  const screenSize = { x: 0, y: 0, width, height };
  const windowed = geometry(xid);
  // A right click is testvn's fullscreen switch.
  const toggleFullscreen = () => {
    const at = geometry(xid);
    xdo('mousemove', at.x + 30, at.y + Math.round(at.height * 0.5));
    xdo('click', 3);
  };
  toggleFullscreen();
  await overGame('the overlay over the fullscreen game', screenSize);
  await lookup('fullscreen.png');
  await advance();
  // Again after a click on the fullscreen game: the pointer must still reach the text.
  await lookup('fullscreen.png');
  await advance();

  step('Back to a window: the overlay follows');
  toggleFullscreen();
  await overGame('the overlay over the windowed game', windowed);
  await lookup('windowed-again.png');
  await advance();

  await page.getByRole('radio', { name: 'Invisible' }).click();
  const look = () =>
    overlay.evaluate(() => {
      const span = [...document.querySelectorAll('.hook-text span')].find(
        (item) => item.getClientRects().length
      );
      const style = span && getComputedStyle(span);
      return (
        style && {
          color: style.color,
          background: style.backgroundColor,
          // A lookup selects its word: our glyphs must not show over the game's then.
          selected: getComputedStyle(span, '::selection').color,
          rows: !!span.closest('.ov-rows')
        }
      );
    });
  /**
   * Where the game drew the caption (DrawTextExW at 20,120 of its window), from the screen: the
   * non-background pixels' box in that band, in the game window's coordinates.
   */
  const drawnCaption = () => {
    const at = geometry(xid);
    const shot = join(root, 'caption.png');
    execFileSync('import', ['-window', 'root', shot]);
    const [w, h, x, y] = execFileSync('convert', [
      shot,
      '-crop',
      `${Math.min(at.width, 700)}x70+${at.x}+${at.y + 105}`,
      '+repage',
      '-fuzz',
      '25%',
      '-trim',
      '-format',
      '%w %h %X %Y',
      'info:'
    ])
      .toString()
      .split(' ')
      .map(Number);
    return { x, y: y + 105, width: w, height: h };
  };
  /**
   * The screen-read row lies on the drawn caption: its start within a third of a character, its
   * end too or up to a character past the ink (the 。 cell's blank half), and its height (the
   * read's box, taller than the ink) holding the glyphs without being twice them.
   */
  const onCaption = (what) =>
    until(
      what,
      async () => {
        const row = await overlay.evaluate(() => {
          const span = document.querySelector('.ov-rows span');
          if (!span) return undefined;
          const { x, y, width, height } = span.getBoundingClientRect();
          return { x, y, width, height, text: span.textContent };
        });
        if (!row) return false;
        const drawn = drawnCaption();
        seen = JSON.stringify({ row, drawn });
        const slack = drawn.height / 3;
        return (
          Math.abs(row.x - drawn.x) <= slack &&
          row.x + row.width >= drawn.x + drawn.width - slack &&
          row.x + row.width <= drawn.x + drawn.width + drawn.height &&
          row.y <= drawn.y + slack &&
          row.y + row.height >= drawn.y + drawn.height - slack &&
          row.height <= 2 * drawn.height
        );
      },
      60_000
    );

  step('Invisible, screen read: the line lies on the glyphs the game drew');
  await onCaption('the row on the drawn caption');
  if ((await look())?.color !== 'rgba(0, 0, 0, 0)') fail('the screen-read row is visible');
  await lookup('invisible-screen.png');
  await page
    .locator('.hook-settings', { has: page.locator('.ov-controls') })
    .screenshot({ path: join(root, 'controls-hook.png') });
  await advance();
  await onCaption('the next line on its drawn caption');

  step('Fullscreen while Invisible: read again for the new size');
  toggleFullscreen();
  await overGame('the overlay over the fullscreen game', screenSize);
  await onCaption('the row on the caption of the fullscreen game');
  await lookup('invisible-fullscreen.png');
  // Plain hover keeps the popup up until a click: else drawnCaption would read it.
  await advance();
  toggleFullscreen();
  await overGame('the overlay over the windowed game', windowed);
  await onCaption('the row on the caption back in the window');

  step('Hidden while the game is minimized');
  xdo('windowminimize', '--sync', xid);
  await until('the overlay hidden', async () => !(await overlayWindow())?.visible);

  step('Back over the game once it is restored');
  // _NET_ACTIVE_WINDOW: openbox de-iconifies the frame, as a taskbar click does.
  xdo('windowactivate', xid);
  await until('the overlay over the restored game', async () => {
    const win = await overlayWindow();
    const at = geometry(xid);
    seen = JSON.stringify({ overlay: win, game: at });
    return win?.visible && same(win.bounds, at);
  });

  step('Off closes the overlay');
  await page.getByRole('radio', { name: 'Off' }).click();
  await until('no overlay window', async () => !(await overlayWindow()));

  step('Settings → Desktop games keeps the mode per game');
  await page.goto('http://127.0.0.1:41917/settings');
  await page.locator('.settings-nav-area-button', { hasText: 'Desktop games' }).click();
  const perGame = page.getByRole('radiogroup', { name: 'Text overlay over the game' });
  await perGame.getByRole('radio', { name: 'Invisible' }).click();
  await page.reload();
  await page.locator('.settings-nav-area-button', { hasText: 'Desktop games' }).click();
  await page.getByRole('radio', { name: 'Invisible', checked: true }).waitFor({ timeout: 10_000 });
  await page.getByRole('radio', { name: 'Invisible', checked: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(root, 'controls-settings.png') });
  console.log(`OK (screenshots in ${root})`);
} catch (error) {
  execFileSync('import', ['-window', 'root', join(root, 'failed.png')]);
  // The X stacking order (top first), for an overlay that is there but not seen.
  writeFileSync(join(root, 'failed-tree.txt'), execFileSync('xwininfo', ['-root', '-tree']));
  throw error;
} finally {
  // Wine's processes can keep Playwright's close waiting.
  await Promise.race([app.close().catch(() => {}), wait(10_000)]);
  // An app that didn't close in time would keep this script (and port 41917) alive.
  app.process().kill('SIGKILL');
  wm.kill();
  compositor.kill();
  // The game outlives the app (as it should); its Wine processes would keep this script alive.
  const prefixes = execFileSync('find', [config, '-maxdepth', '3', '-name', 'wine-prefixes'])
    .toString()
    .split('\n')
    .filter(Boolean)
    .flatMap((dir) => readdirSync(dir).map((name) => join(dir, name)));
  for (const prefix of prefixes)
    execFileSync('wineserver', ['-k'], { env: { ...process.env, WINEPREFIX: prefix } });
  // The Wine prefix (~1.5 GB) and the app's profile.
  await wait(2000);
  rmSync(config, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
