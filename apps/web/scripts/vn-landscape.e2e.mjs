/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// End-to-end check of /v turning a phone to landscape (lib/data/vn/vn-landscape.ts, android-bars.ts)
// with a real CONscripter game and, with VNBOX=1, the test VN in the real VNBox. Chromium's phone
// emulation can't turn a screen: the script stubs `screen.orientation.lock`, resizes the viewport as
// the phone would, and for the app stubs Capacitor's native bridge. No phone, Safari or APK runs
// here. Not in CI (a dev server, Chromium; VNBox needs scripts/vnbox/build.sh, mingw and 2.5 GB free).
//
//   cd apps/web && VITE_EDITION=standalone pnpm exec vite dev --port 5188 &
//   BASE_URL=http://localhost:5188 node scripts/vn-landscape.e2e.mjs    (OUT=<dir> for the shots)
//
// It fails when: the first tap on the game doesn't lock and enter full screen, or doesn't reach the
// game; a later tap enters full screen again after the reader left it; a refused or missing lock
// throws, leaves full screen on, or shows no note; the note stays in landscape or after Dismiss;
// leaving /v keeps the lock or full screen; a landscape phone, tablet or desktop is touched; the app
// uses the browser's way, or doesn't lock on /v and unlock on leaving, or locks a tablet; the game
// or its overlay doesn't fit the frame after turning; VNBox restarts because of the turn.

/* global Buffer, console, document, navigator, process, screen, setTimeout, window, atob, localStorage, Blob */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:5188';
const out = process.env.OUT ?? join(tmpdir(), 'chimi-vn-landscape-e2e');
const title = 'Landscape test';
const script = `*define
game
*start
一行目です。\\
二行目です。\\
三行目です。\\
四行目です。\\
五行目です。\\
goto *start
`;
const portrait = { width: 390, height: 844 };
const sideways = { width: 844, height: 390 };
const phone = { hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const note = 'Turn your phone sideways.';

const step = (text) => console.log(`- ${text}`);
const fail = (text) => {
  throw new Error(text);
};
const expect = (ok, text) => ok || fail(text);

mkdirSync(out, { recursive: true });

async function waitFor(check, text, timeout = 30_000) {
  const end = Date.now() + timeout;

  while (Date.now() < end) {
    const value = await check();

    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail(text);
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

/** A page in its own storage; `lock`: 'ok', 'refuse', 'none' (iPhone Safari), or real if unset. */
async function open(options, { lock, native } = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();

  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  await context.addInitScript(
    ({ lock, native }) => {
      // Before the game's own listeners, which can stop the event: what a tap sends the game.
      window.gameMouseDowns = 0;
      window.addEventListener('mousedown', () => (window.gameMouseDowns += 1), true);

      const count = (name) =>
        localStorage.setItem(name, String(Number(localStorage.getItem(name) ?? 0) + 1));

      if (lock && window === window.top) {
        const proto = Object.getPrototypeOf(screen.orientation);

        if (lock === 'none') {
          delete proto.lock;
          delete proto.unlock;
          Object.defineProperty(document, 'fullscreenEnabled', { value: false });
          Element.prototype.requestFullscreen = undefined;
        } else {
          proto.lock = async (to) => {
            count(`lock-${to}`);
            if (lock === 'refuse') throw new DOMException('refused', 'NotSupportedError');
          };
          proto.unlock = () => count('unlock');
        }
      }
      if (native) {
        window.androidBridge = { postMessage() {} };
        window.Capacitor = {
          PluginHeaders: [
            {
              name: 'LandscapeLock',
              methods: [
                { name: 'lock', rtype: 'promise' },
                { name: 'unlock', rtype: 'promise' }
              ]
            }
          ],
          nativePromise: async (plugin, method) => {
            if (window === window.top) count(`native-${method}`);
          }
        };
      }
    },
    { lock, native }
  );
  return page;
}

const counted = (page, name) =>
  page.evaluate((name) => Number(localStorage.getItem(name) ?? 0), name);
const fullscreen = (page) => page.evaluate(() => !!document.fullscreenElement);
const noteShown = (page) => page.getByText(note).isVisible();
const gameFrame = (page) =>
  page.frames().find((frame) => /\/vn\/(player|vnbox)\.html/.test(frame.url()));
const pageText = async (page) =>
  (await gameFrame(page)?.evaluate(() => document.getElementById('page-text').textContent)) ?? '';

/** The game box, the frame and the overlay's scale, all in the frame's pixels. */
const fit = (page) =>
  gameFrame(page).evaluate(() => {
    const canvas = window.screenCanvas?.() ?? document.getElementById('canvas');
    const box = canvas.getBoundingClientRect();
    const overlay = document.getElementById('overlay');

    return {
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      frameWidth: window.innerWidth,
      frameHeight: window.innerHeight,
      overlayWidth: overlay.getBoundingClientRect().width,
      scale: Number(overlay.style.getPropertyValue('--scale')),
      gameWidth: window.g_screen_width
    };
  });

function expectFits(size, what) {
  expect(
    size.left >= -1 &&
      size.top >= -1 &&
      size.right <= size.frameWidth + 1 &&
      size.bottom <= size.frameHeight + 1 &&
      size.right - size.left > 100,
    `${what}: the game doesn't fit its frame: ${JSON.stringify(size)}`
  );
  expect(
    Math.abs(size.scale * size.gameWidth - (size.right - size.left)) < 2,
    `${what}: the overlay doesn't scale with the game: ${JSON.stringify(size)}`
  );
}

/** Adds the small CONscripter game, opens it and waits for its first line. */
async function openGame(page) {
  await page.goto(`${base}/manage`);
  const id = await page.evaluate(
    async ({ title, script }) => {
      const { loadVnFiles } = await import('/src/lib/functions/file-loaders/vn/load-vn.ts');
      const { database } = await import('/src/lib/data/store.ts');
      const book = await loadVnFiles(title, { '0.txt': new Blob([script]) }, Date.now());

      await database.upsertData(book, 'overwrite');
      return (await database.getDataByTitle(title)).id;
    },
    { title, script }
  );

  await page.goto(`${base}/v?id=${id}`);
  await waitFor(
    async () => (await pageText(page).catch(() => '')).includes('一行目'),
    'no first line'
  );
}

/** A tap on the middle of the game, as a finger makes it. */
async function tapGame(page) {
  const box = await page.locator('iframe').boundingBox();

  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function tapAdvances(page, what) {
  const before = await pageText(page);

  await tapGame(page);
  await waitFor(
    async () => (await pageText(page)) !== before,
    `${what}: the tap didn't reach the game (still "${before}")`,
    5000
  );
}

/** The phone turning: Playwright's setViewportSize refuses a full-screen window. */
async function turn(page, size) {
  // Kept open: closing the session undoes its override.
  page.turnSession ??= await page.context().newCDPSession(page);
  await page.turnSession.send('Emulation.setDeviceMetricsOverride', {
    ...size,
    screenWidth: size.width,
    screenHeight: size.height,
    deviceScaleFactor: phone.deviceScaleFactor,
    mobile: true,
    screenOrientation:
      size.width > size.height
        ? { type: 'landscapePrimary', angle: 90 }
        : { type: 'portraitPrimary', angle: 0 }
  });
}

/** Through CDP once turned: page.screenshot puts Playwright's own viewport back. */
async function shot(page, what) {
  const path = join(out, `${what}.png`);

  if (!page.turnSession) return page.screenshot({ path });
  const { data } = await page.turnSession.send('Page.captureScreenshot');

  writeFileSync(path, Buffer.from(data, 'base64'));
}

async function close(page, what) {
  expect(!page.errors.length, `${what}: page errors: ${page.errors.join('; ')}`);
  await page.context().close();
}

try {
  step('phone in portrait, lock works: the first tap turns it and reaches the game');
  let page = await open({ ...phone, viewport: portrait, screen: portrait }, { lock: 'ok' });
  await openGame(page);
  expect(!(await fullscreen(page)), 'full screen before any tap');
  await tapAdvances(page, 'first tap');
  await waitFor(() => fullscreen(page), 'first tap: no full screen');
  expect((await counted(page, 'lock-landscape')) === 1, 'first tap: no lock');
  expect(!(await noteShown(page)), 'note shown although the lock worked');
  await shot(page, '1-tapped-portrait');
  await turn(page, sideways);
  await waitFor(() => fit(page).then((size) => size.frameWidth > size.frameHeight), 'no turn');
  await new Promise((resolve) => setTimeout(resolve, 500));
  expectFits(await fit(page), 'CONscripter after turning');
  await shot(page, '2-turned');
  await tapAdvances(page, 'tap after turning');
  expect((await counted(page, 'lock-landscape')) === 1, 'a second tap locked again');

  step('the reader leaves full screen: no tap enters it again');
  await page.evaluate(() => document.exitFullscreen());
  await waitFor(async () => !(await fullscreen(page)), "didn't leave full screen");
  await turn(page, portrait);
  await tapAdvances(page, 'tap after leaving full screen');
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(!(await fullscreen(page)), 'entered full screen again after the reader left it');
  expect((await counted(page, 'lock-landscape')) === 1, 'locked again after the reader left');

  step('leaving /v unlocks and leaves full screen');
  await page.evaluate(() => document.documentElement.requestFullscreen().catch(() => {}));
  await page.locator('button[title="Back"]').click();
  await waitFor(() => page.url().includes('/manage'), "didn't leave /v");
  const isolated = await page.evaluate(() => window.crossOriginIsolated);
  await new Promise((resolve) => setTimeout(resolve, 500));
  // An isolated /v leaves by a full page load, which ends both by itself.
  expect(isolated || (await counted(page, 'unlock')) === 1, 'left /v still locked');
  expect(!(await fullscreen(page)), 'left /v still in full screen');
  await close(page, 'lock works');

  step('the game restarts before the first tap (Saves sheet): the new frame still turns once');
  page = await open({ ...phone, viewport: portrait, screen: portrait }, { lock: 'ok' });
  await openGame(page);
  await page.locator('button[title="More"]').tap();
  await page.getByRole('button', { name: 'Saves' }).tap();
  await page.locator('iframe').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: /close/i }).first().tap();
  await waitFor(
    async () => (await pageText(page).catch(() => '')).includes('一行目'),
    'no restart'
  );
  await tapAdvances(page, 'first tap after a restart');
  await waitFor(() => fullscreen(page), 'restart: no full screen');
  expect((await counted(page, 'lock-landscape')) === 1, 'restart: no lock');
  await close(page, 'restart');

  step('lock refused: the game stays in the page, the note shows and goes in landscape');
  page = await open({ ...phone, viewport: portrait, screen: portrait }, { lock: 'refuse' });
  await openGame(page);
  await tapAdvances(page, 'refused');
  await waitFor(() => noteShown(page), 'refused: no note');
  await waitFor(async () => !(await fullscreen(page)), 'refused: full screen stayed on');
  await shot(page, '3-note');
  await turn(page, sideways);
  await waitFor(async () => !(await noteShown(page)), 'note stayed in landscape');
  await turn(page, portrait);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(!(await noteShown(page)), 'note came back after landscape');
  await tapAdvances(page, 'second tap after a refusal');
  expect((await counted(page, 'lock-landscape')) === 1, 'refused: asked twice');
  await close(page, 'refused');

  step('no lock or full screen (iPhone Safari): the note shows and Dismiss closes it');
  page = await open({ ...phone, viewport: portrait, screen: portrait }, { lock: 'none' });
  await openGame(page);
  await tapAdvances(page, 'unsupported');
  await waitFor(() => noteShown(page), 'unsupported: no note');
  await page.getByRole('button', { name: 'Dismiss' }).tap();
  await waitFor(async () => !(await noteShown(page)), "Dismiss didn't close the note");
  await tapAdvances(page, 'tap after Dismiss');
  expect(!(await noteShown(page)), 'note came back after Dismiss');
  await close(page, 'unsupported');

  for (const [what, options] of [
    ['a phone already in landscape', { ...phone, viewport: sideways, screen: sideways }],
    [
      'a tablet',
      {
        ...phone,
        viewport: { width: 820, height: 1180 },
        screen: { width: 820, height: 1180 }
      }
    ],
    ['a desktop', { viewport: { width: 500, height: 800 }, screen: { width: 1920, height: 1080 } }]
  ]) {
    step(`${what}: nothing changes`);
    page = await open(options, { lock: 'ok' });
    await openGame(page);
    if (options.hasTouch) await tapAdvances(page, what);
    else await page.locator('iframe').click();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(!(await fullscreen(page)), `${what}: entered full screen`);
    expect((await counted(page, 'lock-landscape')) === 0, `${what}: locked`);
    expect(!(await noteShown(page)), `${what}: note shown`);
    await close(page, what);
  }

  step('the app (stubbed bridge): /v locks without full screen, leaving unlocks, tablets stay');
  page = await open(
    { ...phone, viewport: portrait, screen: portrait },
    { lock: 'ok', native: true }
  );
  await openGame(page);
  await waitFor(async () => (await counted(page, 'native-lock')) === 1, 'app: /v did not lock');
  await tapAdvances(page, 'app');
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(!(await fullscreen(page)), 'app: entered full screen');
  expect((await counted(page, 'lock-landscape')) === 0, 'app: used the browser lock');
  expect(!(await noteShown(page)), 'app: note shown');
  await page.locator('button[title="Back"]').click();
  await waitFor(
    async () => (await counted(page, 'native-unlock')) === 1,
    'app: leaving /v kept it'
  );
  await close(page, 'app');
  page = await open(
    { ...phone, viewport: { width: 820, height: 1180 }, screen: { width: 820, height: 1180 } },
    { native: true }
  );
  await openGame(page);
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect((await counted(page, 'native-lock')) === 0, 'app: a tablet locked');
  await close(page, 'app tablet');

  if (process.env.VNBOX) {
    step('VNBox: a tap while it loads turns the phone; the test VN fits and takes taps');
    const available = Number(
      /MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))[1]
    );

    expect(available > 2.5 * 1024 * 1024, 'Wine needs 2.5 GB free');
    const work = mkdtempSync(join(tmpdir(), 'vn-landscape-e2e-'));

    execFileSync('i686-w64-mingw32-gcc', [
      '-municode',
      '-mwindows',
      '-O2',
      '-s',
      '-o',
      join(work, 'testvn.exe'),
      join(import.meta.dirname, '../../desktop/e2e/testvn.c'),
      '-lole32',
      '-luuid',
      '-lwinmm'
    ]);
    writeFileSync(
      join(work, 'scenes.txt'),
      ['一行目', '二行目', '三行目'].map((text) => `-1 0 once click 0 ${text}\n`).join('')
    );
    page = await open({ ...phone, viewport: portrait, screen: portrait }, { lock: 'ok' });
    await page.goto(`${base}/manage`);
    const files = Object.fromEntries(
      ['testvn.exe', 'scenes.txt'].map((name) => [
        name,
        readFileSync(join(work, name)).toString('base64')
      ])
    );
    const id = await page.evaluate(
      async ({ title, files }) => {
        const { windowsGameBook, windowsGameFolder } = await import(
          '/src/lib/data/vn/windows-game.ts'
        );
        const { database } = await import('/src/lib/data/store.ts');
        const root = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('vnbox', { create: true });
        const folder = await root.getDirectoryHandle(windowsGameFolder(title), { create: true });

        for (const [name, data] of Object.entries(files)) {
          const writable = await (
            await folder.getFileHandle(name, { create: true })
          ).createWritable();

          await writable.write(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
          await writable.close();
        }
        await database.upsertData(
          windowsGameBook(title, 'testvn.exe', undefined, undefined),
          'overwrite'
        );
        return (await database.getDataByTitle(title)).id;
      },
      { title, files }
    );

    await page.goto(`${base}/v?id=${id}`);
    await waitFor(() => gameFrame(page)?.url(), 'no VNBox frame', 60_000);
    await page.locator('iframe').waitFor();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await tapGame(page);
    await waitFor(() => fullscreen(page), 'VNBox: no full screen');
    expect((await counted(page, 'lock-landscape')) === 1, 'VNBox: no lock');
    await turn(page, sideways);
    // Started: the start guard's mark was set, and has stayed cleared for 15 s (testvn's window
    // restarts VNBox once to keep its size, which marks it again).
    let marked = false;
    let clearSince = 0;

    await waitFor(
      async () => {
        const starting = await page.evaluate(() => localStorage.getItem('ttu-vn-starting'));

        if (starting) {
          marked = true;
          clearSince = 0;
        } else if (marked && !clearSince) clearSince = Date.now();
        return clearSince && Date.now() - clearSince > 15_000;
      },
      "VNBox didn't start after turning",
      300_000
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
    expectFits(await fit(page), 'VNBox after turning');
    await shot(page, '4-vnbox-landscape');
    const startedUrl = gameFrame(page).url();
    const inputs = () => gameFrame(page).evaluate(() => window.gameMouseDowns);
    const before = await inputs();

    await tapGame(page);
    await waitFor(
      async () => (await inputs()) === before + 1,
      "VNBox: a tap didn't reach the game",
      5000
    );
    await turn(page, portrait);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expectFits(await fit(page), 'VNBox back in portrait');
    await shot(page, '5-vnbox-portrait');
    expect(gameFrame(page).url() === startedUrl, 'VNBox: the frame restarted because of the turn');
    await close(page, 'VNBox');
    rmSync(work, { recursive: true, force: true });
  }

  console.log('OK');
} finally {
  await browser.close();
}
