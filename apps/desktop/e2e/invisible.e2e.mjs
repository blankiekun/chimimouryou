/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// End-to-end check of the Invisible overlay on a Wayland session: the real app, helper and
// LunaHook, Wine under XWayland, the test VN in layout mode (testvn.c), which writes where it drew
// each character. Run it inside a Wayland compositor with XWayland, with WAYLAND_DISPLAY, DISPLAY
// and XDG_SESSION_TYPE=wayland set, and a session bus; not in CI. E2E_APP: a packaged binary
// instead of the dev Electron. E2E_PORTAL_LOG: a `dbus-monitor` log of the portal's ScreenCast.
// E2E_APPIMAGE: once the game is set up, the real AppImage takes over, started with no platform
// flag (the app must get itself onto X11), driven over a debugging port.
//
//   apt install weston xwayland xdotool x11-utils imagemagick   (and Wine, mingw-w64 as native-vn)
//   cd apps/desktop && pnpm run fetch && pnpm run build:web
//   VN_OCR_OUT=../web/build/vn/ocr ../../scripts/vn-ocr/fetch.sh
//   node e2e/invisible.e2e.mjs   (inside the session; E2E_DIR=<dir>: its folder)
//
// It fails when: a character of the line isn't on the glyph the game drew (at any of the layouts:
// text sizes, half-width and proportional characters, a name line above full-width digits, a line
// far into the text on screen, wrapped, vertical, white on dark); a line the game didn't draw shows
// anywhere, or /hook doesn't say why; hovering the text with no key doesn't open the lookup; the
// portal is asked for a screen share; Invisible offers an area or placement to adjust; after
// Band's Adjust, Done leaves the game without its clicks.
// Artifact: results.json, with each layout's worst distances.

/* global document, window, localStorage, NodeFilter -- used inside page.evaluate */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const desktop = join(import.meta.dirname, '..');
const { _electron, chromium } = createRequire(join(desktop, '../web/package.json'))('playwright');
const root = process.env.E2E_DIR ?? mkdtempSync(join(tmpdir(), 'chimi-invisible-'));
const config = join(root, 'config');
const home = join(root, 'home');
const gameDir = join(root, 'games', 'Test VN');
const title = 'テストVN';

const step = (text) => console.log(`- ${text}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const xdo = (...args) =>
  execFileSync('xdotool', args.map(String), { timeout: 10_000 }).toString().trim();
async function until(what, check, ms = 30_000) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(200)) {
    const value = await check();
    if (value) return value;
  }
  throw new Error(`timed out: ${what}`);
}

// "size x y kind font name text": see testvn.c. The sizes run from a small old game's to a big one.
const line = '吾輩は猫である。名前はまだ無い。';
const layouts = [
  // Before the hook is in: never measured.
  ['start', '32 20 330 h 0 - 始まりの台詞です。'],
  // The line the thread is picked on: it went by before the overlay was told, so never measured.
  ['thread', '32 20 330 h 0 - 準備の台詞です。'],
  ['size 44', '44 20 330 h 0 - 一番目の吾輩は猫である。'],
  ['size 32', '32 20 330 h 0 - 二番目の' + line],
  ['size 24', '24 20 330 h 0 - 三番目の' + line + 'どこで生れたか。'],
  ['size 20', '20 20 330 h 0 - 四番目の' + line + 'どこで生れたか。'],
  ['size 16', '16 20 330 h 0 - 五番目の' + line + 'どこで生れたか。'],
  ['half-width', '32 20 330 h 0 - AliceはGood12時に言ったOK。'],
  ['proportional', '32 20 330 h 1 - 吾輩はCatであるWhoが来たのです。'],
  ['full-width digits under a name', '32 20 330 h 0 太郎 第１２場面の台詞です。'],
  [
    'deep in the text',
    '30 20 330 h 0 - どこで生れたかとんと見当がつかぬ。|何でも薄暗い所で泣いていた事だけは記憶している。|そして猫は静かに歩き出した。'
  ],
  ['wrapped', '32 20 290 w 0 - 吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。'],
  ['vertical', '32 700 40 v 0 - 吾輩は猫である名前はまだ無い'],
  ['white on dark', '32 20 400 d 0 太郎 六番目の' + line]
];
const absent = '0 0 0 n 0 - これは画面にない台詞です。';
// After the measured ones: a line never drawn, then one for the lookup and one for Band.
const script = [
  ...layouts.map(([, spec]) => spec),
  absent,
  `40 20 330 h 0 - 第一場面の台詞です。`,
  `40 20 330 h 0 - 第二場面の台詞です。`,
  `40 20 330 h 0 - 第三場面の台詞です。`
];

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
writeFileSync(join(gameDir, 'layout.txt'), script.join('\n') + '\n');
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

const packaged = process.env.E2E_APP;
const app = await _electron.launch({
  executablePath: packaged ?? join(desktop, 'node_modules/electron/dist/electron'),
  // The flag a user could start it with by hand: with it, the capture must still skip the portal.
  args: ['--no-sandbox', '--ozone-platform=x11', ...(packaged ? [] : [desktop])],
  env: {
    ...process.env,
    XDG_CONFIG_HOME: config,
    HOME: home,
    PULSE_SERVER: 'unix:/nonexistent',
    TESTVN_MS: '600000',
    TESTVN_WIDTH: '820',
    TESTVN_HEIGHT: '520'
  }
});
const results = [];
const failures = [];
let page = await app.firstWindow();
let browser;
const appImage = process.env.E2E_APPIMAGE;
const unpacked = join(root, 'tmp');
try {
  page.setDefaultTimeout(180_000);
  await page.waitForLoadState('load');
  await page.evaluate(() => {
    localStorage.setItem('storageChosen', '1');
    localStorage.setItem('builtInLookups', '1');
  });
  step('A dictionary, the game, Invisible before its first start');
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
  await page.goto('http://127.0.0.1:41917/settings');
  await page.locator('.settings-nav-area-button', { hasText: 'Desktop games' }).click();
  await page
    .getByRole('radiogroup', { name: 'Text overlay over the game' })
    .getByRole('radio', { name: 'Invisible' })
    .click();
  await page.getByRole('radio', { name: 'Invisible', checked: true }).waitFor({ timeout: 10_000 });
  if (await page.getByRole('radio', { name: 'Manual area' }).count())
    failures.push('Settings still offers Manual area');
  if (appImage) {
    step('The AppImage, with no platform flag');
    await app.close();
    mkdirSync(unpacked);
    spawn(appImage, ['--no-sandbox', '--remote-debugging-port=9333'], {
      env: {
        ...process.env,
        XDG_CONFIG_HOME: config,
        HOME: home,
        PULSE_SERVER: 'unix:/nonexistent',
        APPIMAGE_EXTRACT_AND_RUN: '1',
        TMPDIR: unpacked,
        TESTVN_MS: '600000',
        TESTVN_WIDTH: '820',
        TESTVN_HEIGHT: '520'
      },
      stdio: 'ignore'
    });
    browser = await until(
      'the debugging port',
      () => chromium.connectOverCDP('http://127.0.0.1:9333').catch(() => undefined),
      120_000
    );
    page = await until('the app’s page', () =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((item) => item.url().startsWith('http://127.0.0.1:41917'))
    );
    page.setDefaultTimeout(180_000);
    await until('its window on X11', () => {
      try {
        return xdo('search', '--onlyvisible', '--class', 'chimimouryou');
      } catch {
        return undefined;
      }
    });
  }
  await page.goto(`http://127.0.0.1:41917/v?id=${id}`);
  await page.waitForURL(/\/hook\?native=/);

  step('The hook code for the game’s lines');
  const xid = await until(
    'the game window',
    () => {
      try {
        return xdo('search', '--onlyvisible', '--class', 'testvn.exe').split('\n').at(-1);
      } catch {
        return undefined;
      }
    },
    180_000
  );
  const geometry = () => {
    const info = execFileSync('xwininfo', ['-id', xid]).toString();
    const value = (name) => Number(new RegExp(`${name}:\\s+(-?\\d+)`).exec(info)[1]);
    return {
      x: value('Absolute upper-left X'),
      y: value('Absolute upper-left Y'),
      width: value('Width'),
      height: value('Height')
    };
  };
  const clickGame = () => {
    const at = geometry();
    xdo('windowfocus', xid);
    xdo('mousemove', at.x + at.width - 12, at.y + 12);
    xdo('click', 1);
  };
  await until('the hook address', () => existsSync(join(gameDir, 'hookaddr.txt')));
  const code = `HQ4@${readFileSync(join(gameDir, 'hookaddr.txt'), 'utf8')}:testvn.exe`;
  await page.getByRole('button', { name: 'Add hook code…' }).click();
  await page.locator('.nt-code input').fill(code);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  // The first screen's line went by before the hook: the next ones come through it.
  let at = 0;
  const coded = page.locator('.nt-row', { hasText: '準備の台詞' });
  await wait(3000);
  clickGame();
  at += 1;
  await coded.first().waitFor({ timeout: 30_000 });
  await coded.first().click();
  await wait(1000);
  clickGame();
  at += 1;
  if (await page.getByRole('radio', { name: 'Manual area' }).count())
    failures.push('/hook still offers Manual area');
  if (await page.getByRole('button', { name: /Adjust/ }).count())
    failures.push('/hook still offers Adjust for Invisible');
  const windows = () =>
    browser ? browser.contexts().flatMap((context) => context.pages()) : app.windows();
  const overlay = await until('the overlay page', () =>
    windows().find((w) => w.url().includes('/hook/overlay'))
  );
  const overlayBounds = () =>
    browser
      ? overlay.evaluate(() => ({
          bounds: {
            x: window.screenX,
            y: window.screenY,
            width: window.innerWidth,
            height: window.innerHeight
          },
          visible: document.visibilityState === 'visible'
        }))
      : app.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows().find((w) =>
            w.webContents.getURL().includes('/hook/overlay')
          );
          return win && { bounds: win.getBounds(), visible: win.isVisible() };
        });
  /** Every shown character of the overlay's text: its box in the page's px, and the page's scale. */
  const placed = () =>
    overlay.evaluate(() => {
      const chars = [];
      const roots = [...document.querySelectorAll('.hook-text')].filter(
        (el) => el.getClientRects().length
      );
      for (const el of roots) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          for (let i = 0; i < node.length; i += 1) {
            if (!node.data[i].trim()) continue;
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const { x, y, width, height } = range.getBoundingClientRect();
            const row = node.parentElement.closest('span').getBoundingClientRect();
            chars.push({ ch: node.data[i], x, y, width, height, rowY: row.y, rowH: row.height });
          }
        }
      }
      return { chars, dpr: window.devicePixelRatio };
    });
  const drawnFor = (index) =>
    readFileSync(join(gameDir, 'drawn.txt'), 'utf8')
      .split('\n')
      .map((row) => row.trim().split(' ').map(Number))
      .filter((row) => row[0] === index);
  const noteText = () =>
    page
      .locator('.ov-note')
      .first()
      .textContent({ timeout: 2000 })
      .then((text) => text.trim())
      .catch(() => '(no note)');
  const hooked = (spec) => spec.split(' ').slice(6).join(' ').split('|').at(-1);

  step('Each layout: every character on the glyph the game drew');
  for (; at < layouts.length; at += 1) {
    const [name, spec] = layouts[at];
    const size = Number(spec.split(' ')[0]);
    const vertical = spec.split(' ')[3] === 'v';
    const text = hooked(spec);
    let got;
    try {
      got = await until(
        `${name}: the line laid`,
        async () => {
          const now = await placed();
          return now.chars.map((c) => c.ch).join('') === text ? now : undefined;
        },
        40_000
      );
    } catch {
      const status = await noteText();
      const laid = (await placed()).chars.map((c) => c.ch).join('');
      results.push({ name, size, placed: false, status, laid });
      failures.push(`${name}: not laid (${status}; laid "${laid}")`);
      clickGame();
      await wait(1500);
      continue;
    }
    const { bounds } = await overlayBounds();
    const game = geometry();
    const truth = drawnFor(at);
    let along = 0;
    let across = 0;
    const offs = [];
    got.chars.forEach((char, i) => {
      const [, , x0, y0, x1, y1] = truth[i];
      const cx = (char.x + char.width / 2 + bounds.x) * got.dpr - game.x;
      const cy = (char.rowY + char.rowH / 2 + bounds.y) * got.dpr - game.y;
      const py = (char.y + char.height / 2 + bounds.y) * got.dpr - game.y;
      offs.push(Math.round(vertical ? py - (y0 + y1) / 2 : cx - (x0 + x1) / 2));
      along = Math.max(
        along,
        vertical ? Math.abs(py - (y0 + y1) / 2) : Math.abs(cx - (x0 + x1) / 2)
      );
      across = Math.max(
        across,
        vertical ? Math.abs(cx - (x0 + x1) / 2) : Math.abs(cy - (y0 + y1) / 2)
      );
    });
    const limit = Math.max(3, size / 4);
    const root = await overlay.evaluate(() => document.querySelector('.ov-root')?.className);
    results.push({
      name,
      size,
      placed: true,
      along,
      across,
      limit,
      dpr: got.dpr,
      offs,
      root,
      bounds,
      game
    });
    console.log(
      `  ${name}: worst ${along.toFixed(1)} px along, ${across.toFixed(1)} across (limit ${limit})`
    );
    if (along > limit || across > limit) failures.push(`${name}: off the glyphs`);
    clickGame();
    await until(`${name}: the next line`, async () => {
      const now = await placed();
      return now.chars.map((c) => c.ch).join('') !== text;
    });
  }

  step('A line the game didn’t draw shows nowhere, and /hook says so');
  await until('the reason on /hook', async () => /wasn.t found/.test(await noteText())).catch(() =>
    failures.push('no reason on /hook for a line that isn’t on the screen')
  );
  const shown = await placed();
  if (shown.chars.length) failures.push(`an undrawn line showed: ${shown.chars.length} characters`);
  clickGame();

  step('Hover with no key opens the lookup');
  const word = await until(
    '台詞 laid',
    async () => {
      const now = await placed();
      const index = now.chars
        .map((c) => c.ch)
        .join('')
        .indexOf('台詞');
      return index >= 0 ? now.chars[index] : undefined;
    },
    40_000
  ).catch(() => undefined);
  if (!word) failures.push('the lookup line wasn’t laid');
  else {
    const { bounds } = await overlayBounds();
    const { dpr } = await placed();
    const px = (v, o) => Math.round((v + o) * dpr);
    xdo(
      'mousemove',
      px(word.x + word.width / 2, bounds.x) - 3,
      px(word.rowY + word.rowH / 2, bounds.y)
    );
    await wait(100);
    xdo(
      'mousemove',
      px(word.x + word.width / 2, bounds.x),
      px(word.rowY + word.rowH / 2, bounds.y)
    );
    await overlay
      .locator('.ttu-dict', { hasText: 'lines of a play' })
      .waitFor({ timeout: 10_000 })
      .catch(() => failures.push('hover with no key opened no lookup'));
  }

  step('Band: Adjust, Done, and the game takes clicks again');
  const before = readFileSync(join(gameDir, 'drawn.txt'), 'utf8').length;
  await page.getByRole('radio', { name: 'Band' }).click();
  await page.getByRole('button', { name: /Adjust/ }).click();
  await until('Adjust’s Done', async () => overlay.locator('.ov-done').isVisible());
  const done = await overlay.locator('.ov-done').boundingBox();
  const { bounds } = await overlayBounds();
  const { dpr } = await placed();
  xdo(
    'mousemove',
    Math.round((done.x + done.width / 2 + bounds.x) * dpr),
    Math.round((done.y + done.height / 2 + bounds.y) * dpr)
  );
  await wait(200);
  xdo('click', 1);
  await until(
    'Adjust closed',
    async () => !(await overlay.locator('.ov-done').isVisible()),
    10_000
  ).catch(() => failures.push('Done left Adjust open'));
  await wait(500);
  clickGame();
  await until(
    'the game advanced after Done',
    () => readFileSync(join(gameDir, 'drawn.txt'), 'utf8').length > before,
    10_000
  ).catch(() => failures.push('the game took no click after Done'));

  const portal = process.env.E2E_PORTAL_LOG;
  if (portal) {
    const calls = readFileSync(portal, 'utf8').match(/member=(CreateSession|SelectSources|Start)/g);
    if (calls) failures.push(`the portal was asked to share the screen ${calls.length} times`);
    console.log(`  portal ScreenCast calls: ${calls?.length ?? 0}`);
  }
} catch (error) {
  failures.push(`stopped: ${error.message}`);
} finally {
  writeFileSync(join(root, 'results.json'), JSON.stringify({ results, failures }, null, 1));
  await Promise.race([app.close().catch(() => {}), wait(10_000)]);
  app.process().kill('SIGKILL');
  if (browser) spawn('pkill', ['-f', unpacked], { stdio: 'ignore' });
  spawn('wineserver', ['-k'], {
    env: { ...process.env, WINEPREFIX: join(config, 'chimimouryou/wine-prefixes') },
    stdio: 'ignore'
  });
  await wait(2000);
  rmSync(config, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  rmSync(unpacked, { recursive: true, force: true });
  console.log(failures.length ? `FAILED:\n${failures.join('\n')}` : `OK (results in ${root})`);
  process.exit(failures.length ? 1 : 0);
}
