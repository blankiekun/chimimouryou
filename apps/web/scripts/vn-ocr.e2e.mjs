/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// End-to-end check of the VN overlay's screen text (lib/data/vn/vn-ocr.ts, vita-vn-ocr's models) in
// the real VNBox: the test VN (apps/desktop/e2e/testvn.c, scene mode: lines drawn at y = 40 with a
// typewriter, advanced by clicks) runs in /v. Not in CI (a dev server, VNBox, mingw, Chromium, and
// > 2.5 GB of free memory for Wine in the browser).
//
//   scripts/vnbox/build.sh && scripts/vn-ocr/fetch.sh      (from the repo root)
//   cd apps/web && VITE_EDITION=standalone pnpm exec vite dev --port 5187 &
//   BASE_URL=http://localhost:5187 node scripts/vn-ocr.e2e.mjs        (OUT=<dir> for the shots)
//
// It fails when: a hooked line (the one on screen, sent as VNBox's hook would send it) stays at the
// fixed guess or isn't laid over the game's own line (within half a line of where testvn drew it,
// text = the hook's), or the pointer a third into each of the game's characters (cells from the
// line's ink) doesn't find that character in the overlay, which is what Yomitan scans; the Hooks sheet's "Text from: Screen" isn't saved on the game; in Screen mode
// a click doesn't bring the next line into the backlog with the game's text, or the overlay doesn't
// sit on it; the page has errors. Prints the worker's time per frame. Artifact: the shots, the
// overlay outlined over the game.

/* global console, document, navigator, process, setTimeout, atob, window, createImageBitmap, screenCanvas, keptLineList, lastScreenMs, g_screen_width, g_screen_height -- Node, and the page and VNBox frame inside evaluate */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:5187';
const out = process.env.OUT ?? join(tmpdir(), 'chimi-vn-ocr-e2e');
const title = 'テストVN OCR';
// testvn's scene mode: voice cut draw advance ms text
const scenes = [
  // Ink from the first character's left edge to the last one's right: the hover check's cells.
  '吾輩は猫である。名前はまだ無い',
  'どこで生れたかとんと見当がつかぬ。',
  '何でも薄暗いじめじめした所で泣いていた。'
];

const step = (text) => console.log(`- ${text}`);
const fail = (text) => {
  throw new Error(text);
};
const expect = (ok, text) => ok || fail(text);

const available = Number(/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))[1]);

expect(
  available > 2.5 * 1024 * 1024,
  `only ${Math.round(available / 1024)} MB free: Wine needs 2.5 GB`
);
mkdirSync(out, { recursive: true });

const work = mkdtempSync(join(tmpdir(), 'vn-ocr-e2e-'));

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
  scenes.map((text, i) => `-1 0 ${i ? 'type' : 'once'} click 0 ${text}\n`).join('')
);

async function waitFor(check, text, timeout = 10_000) {
  const end = Date.now() + timeout;

  while (Date.now() < end) {
    const value = await check();

    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(text);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
const shot = (what) => page.screenshot({ path: join(out, `${what}.png`) });

page.on('pageerror', (error) => errors.push(error.message));

try {
  step('the test VN is added as a Windows game');
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
      ).getDirectoryHandle('vnbox', {
        create: true
      });
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

  step('VNBox starts the game and its first line is read from the screen');
  await page.goto(`${base}/v?id=${id}`);
  const frame = () => page.frames().find((each) => each.url().includes('vnbox.html'));
  const read = () =>
    frame()
      ?.evaluate(async () => {
        if (!window.readScreen) return null;
        const result = await window.readScreen(await createImageBitmap(screenCanvas()));

        return result && { text: result.text, ms: result.ms };
      })
      .catch(() => null);

  await waitFor(
    async () => (await read())?.text.includes('名前はまだ無い'),
    'the game never showed its first line',
    300_000
  );
  const timings = [];

  for (let i = 0; i < 3; i += 1) timings.push((await read()).ms);

  step('a hooked line is laid over the game’s own line');
  const rows = () =>
    frame().evaluate(() =>
      [...document.querySelectorAll('#page-text div')].map((div) => ({
        text: div.textContent,
        x: (parseFloat(div.style.left) / 100) * g_screen_width,
        y: (parseFloat(div.style.top) / 100) * g_screen_height,
        height: g_screen_height
      }))
    );

  // The overlay's text drawn in green over the game's, for the shots.
  const showOverlay = () =>
    frame().evaluate(() =>
      document.querySelectorAll('#page-text div').forEach((div) => {
        div.style.color = 'rgba(15, 122, 92, 0.7)';
        div.style.outline = '1px solid #0f7a5c';
        // The present canvas has z-index 1: lift the overlay to see it.
        div.closest('#overlay').style.zIndex = 2;
      })
    );

  await frame().evaluate((line) => window.boxedwineText(line), scenes[0]);
  const guess = await rows();

  expect(
    guess[0]?.y > guess[0]?.height * 0.6,
    `the guess isn't at the bottom: ${JSON.stringify(guess)}`
  );
  const placed = await waitFor(async () => {
    const now = await rows();

    return now.length && now[0].y < now[0].height * 0.5 && now;
  }, 'the hooked line stayed at the fixed guess');

  // testvn draws 28 px MS Gothic at (20, 40): the box (text plus padding) starts a few px above.
  expect(
    placed.length === 1 && Math.abs(placed[0].y - 40) <= 14 && Math.abs(placed[0].x - 20) <= 14,
    `the line isn't over the game's: ${JSON.stringify(placed)}`
  );
  console.log(`  placed: ${JSON.stringify(placed)}`);
  // Yomitan's hover finds the line's text, and the text lies on the game's own line on screen.
  const onScreen = await frame().evaluate(() => {
    const div = document.querySelector('#page-text div');
    const rect = div.getBoundingClientRect();
    const game = screenCanvas().getBoundingClientRect();
    const at = document.elementFromPoint(rect.left + rect.width / 4, rect.top + rect.height / 2);

    return {
      hit: at === div,
      top: ((rect.top - game.top) / game.height) * screenCanvas().height,
      left: ((rect.left - game.left) / game.width) * screenCanvas().width
    };
  });

  console.log(`  on screen: ${JSON.stringify(onScreen)}`);
  expect(onScreen.hit, 'the line’s text isn’t what the pointer finds over it');
  expect(
    Math.abs(onScreen.top - 40) <= 14 && Math.abs(onScreen.left - 20) <= 14,
    'the line isn’t drawn over the game’s line'
  );
  // The game's own character cells, from the line's ink (testvn draws it at y = 40 on white).
  const found = await frame().evaluate(
    (count) => {
      const canvas = screenCanvas();
      const copy = document.createElement('canvas');

      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d');

      context.drawImage(canvas, 0, 0);
      const ink = context.getImageData(0, 40, canvas.width, 30).data;
      let left = Infinity;
      let right = -Infinity;

      for (let i = 0; i < ink.length; i += 4) {
        if (ink[i] + ink[i + 1] + ink[i + 2] > 384) continue;
        const x = (i / 4) % canvas.width;

        left = Math.min(left, x);
        right = Math.max(right, x);
      }
      const pitch = (right + 1 - left) / count;
      const game = canvas.getBoundingClientRect();
      const scale = game.width / canvas.width;

      return Array.from({ length: count }, (_, i) => {
        const range = document.caretRangeFromPoint(
          game.left + (left + pitch * (i + 0.3)) * scale,
          game.top + 54 * scale
        );
        const text = range?.startContainer.textContent ?? '';

        // A third into a character the caret falls just before it.
        return range ? text[range.startOffset] : '';
      });
    },
    [...scenes[0]].length
  );
  const missed = [...scenes[0]].filter((ch, i) => found[i] !== ch);

  console.log(`  characters under the pointer: ${found.join(' ')}`);
  expect(!missed.length, `hovering the game's characters misses ${missed.join('')}`);
  expect(placed[0].text === scenes[0], `the overlay's text isn't the hook's: ${placed[0].text}`);
  await showOverlay();
  await shot('hooked');

  step('Hooks → Text from: Screen is saved on the game');
  await waitFor(async () => {
    if (await page.getByRole('button', { name: 'Hooks' }).isVisible()) return true;
    await page.getByRole('button', { name: 'More' }).click();
    return false;
  }, '/v’s More has no Hooks');
  await page.getByRole('button', { name: 'Hooks' }).click();
  const sheet = page.getByRole('dialog', { name: 'Hooks' });

  await sheet.getByRole('radio', { name: 'Screen' }).click();
  await page.waitForTimeout(500);
  await shot('hooks-sheet');
  await waitFor(
    () =>
      page.evaluate(async (bookId) => {
        const { database } = await import('/src/lib/data/store.ts');
        const { vnInfo } = await import('/src/lib/data/vn/vn.ts');

        return vnInfo(await database.getData(bookId)).textFrom === 'screen';
      }, id),
    'Text from: Screen wasn’t saved on the game'
  );
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });

  step('in Screen mode a click brings the next line into the backlog');
  const box = await page.locator('iframe').boundingBox();
  const clickedAt = Date.now();

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 80 });
  const kept = await waitFor(
    async () => {
      const texts = await frame().evaluate(() => keptLineList().map((line) => line.text));

      return texts.at(-1) === scenes[1] && texts;
    },
    'the next line never reached the backlog from the screen',
    15_000
  );
  const screenRows = await rows();

  expect(
    screenRows.length === 1 && Math.abs(screenRows[0].y - 40) <= 14,
    `the screen line's overlay isn't over the game's: ${JSON.stringify(screenRows)}`
  );
  timings.push(await frame().evaluate(() => lastScreenMs));
  await showOverlay();
  await shot('screen');
  console.log(`  backlog: ${kept.join(' / ')} (click to backlog ${Date.now() - clickedAt} ms)`);

  expect(!errors.length, `page errors: ${errors.join('; ')}`);
  console.log(`  worker time per frame: ${timings.map((ms) => Math.round(ms)).join(', ')} ms`);
  step('passed');
} catch (error) {
  await shot('failure').catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
  console.log(`Shots in ${out}`);
}
