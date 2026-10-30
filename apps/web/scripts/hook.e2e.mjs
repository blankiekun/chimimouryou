/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// End-to-end check of the texthooker (/hook) over a fake WebSocket feed (Playwright's
// routeWebSocket: no tool runs), on a phone and a desktop, with screenshots as the artifact.
// Also /v's Hooks sheet, whose Text cleanup is the same editor. Not in CI (a dev server, Chromium).
//
//   cd apps/web && VITE_EDITION=standalone pnpm exec vite dev --port 5181 &
//   BASE_URL=http://localhost:5181 node scripts/hook.e2e.mjs        (OUT=<dir> for the shots)
//
// It fails when: tool lines don't reach the list or the immersion log; a repeat is counted;
// Pause lets a line into the log or the session, or doesn't show it; Resume doesn't count again;
// Select → Delete, Edit or Copy acts on the wrong lines, or Undo doesn't put them back in order;
// a replace rule doesn't clean a tool's line; the second address isn't listened to; Newest first
// doesn't put the newest on top; a preset doesn't bring its settings back; notes don't survive
// a reload; /v's Hooks sheet doesn't show the cleanup or doesn't save a filter on the game.

/* global console, indexedDB, navigator, process, setTimeout -- Node, and the page inside page.evaluate */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:5181';
const out = process.env.OUT ?? join(tmpdir(), 'chimi-hook-e2e');
const tool1 = 'ws://localhost:6677';
const tool2 = 'ws://localhost:9001';

mkdirSync(out, { recursive: true });

const step = (text) => console.log(`- ${text}`);
const fail = (text) => {
  throw new Error(text);
};
const expect = (ok, text) => ok || fail(text);

/** The immersion log's texthooker characters, from IndexedDB as the app wrote them */
const loggedCharacters = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('ttu-annotations');

        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('known').objectStore('known').get('immersion');

          get.onsuccess = () =>
            resolve(
              Object.values(get.result ?? {})
                .filter((entry) => entry.source === 'hook' && !entry.deleted)
                .reduce((sum, entry) => sum + entry.characters, 0)
            );
        };
      })
  );

const lineTexts = (page) => page.locator('.hook-text li').allInnerTexts();

async function waitFor(check, text, timeout = 10_000) {
  const end = Date.now() + timeout;

  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(text);
}

async function run(name, options) {
  const browser = await chromium.launch();
  const context = await browser.newContext(options);
  const sockets = { [tool1]: [], [tool2]: [] };

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  for (const url of [tool1, tool2]) {
    await context.routeWebSocket(url, (ws) => sockets[url].push(ws));
  }

  const page = await context.newPage();
  const errors = [];
  const send = async (url, text) => {
    await waitFor(() => sockets[url].length > 0, `${name}: nothing connected to ${url}`);
    sockets[url].at(-1).send(text);
  };
  const shot = (what) => page.screenshot({ path: join(out, `${name}-${what}.png`) });

  page.on('pageerror', (error) => errors.push(error.message));

  try {
    step(`${name}: tool lines reach the list and the log`);
    await page.goto(`${base}/hook`);
    await page
      .getByRole('status')
      .filter({ hasText: /^Connected$/ })
      .waitFor();
    await send(tool1, '吾輩は猫である。');
    await send(tool1, '{"sentence":"名前はまだ無い。"}');
    await send(tool1, '名前はまだ無い。');
    await waitFor(async () => (await lineTexts(page)).length === 2, `${name}: 2 lines expected`);
    await waitFor(async () => (await loggedCharacters(page)) === 14, `${name}: 14 chars logged`);

    step(`${name}: Pause shows lines but logs nothing`);
    await page.getByRole('button', { name: 'Pause' }).click();
    await send(tool1, 'どこで生れたかとんと見当がつかぬ。');
    await waitFor(async () => (await lineTexts(page)).length === 3, `${name}: paused line shown`);
    await page.waitForTimeout(500);
    expect((await loggedCharacters(page)) === 14, `${name}: a paused line was logged`);
    expect(
      (await page.locator('.point-box-figure').innerText()).startsWith('14'),
      `${name}: a paused line counted in the session`
    );
    await shot('paused');
    await page.getByRole('button', { name: 'Resume' }).click();
    await send(tool1, '何でも薄暗いじめじめした所で');
    await waitFor(async () => (await loggedCharacters(page)) === 28, `${name}: Resume counts`);

    step(`${name}: Select, Copy, Edit, Delete and Undo`);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.locator('.hook-text li', { hasText: '名前は' }).click();
    await page.locator('.hook-text li', { hasText: 'どこで' }).click();
    await page.getByRole('button', { name: 'Copy' }).click();
    expect(
      (await page.evaluate(() => navigator.clipboard.readText())) ===
        '名前はまだ無い。\nどこで生れたかとんと見当がつかぬ。',
      `${name}: Copy copied the wrong text`
    );
    await shot('select');
    await page.getByRole('button', { name: 'Delete' }).click();
    expect(
      (await lineTexts(page)).join('|') === '吾輩は猫である。|何でも薄暗いじめじめした所で',
      `${name}: Delete removed the wrong lines`
    );
    await page.locator('.hook-text li', { hasText: '吾輩' }).click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Line text').fill('吾輩は犬である。');
    await page.getByRole('button', { name: 'Save' }).click();
    expect((await lineTexts(page))[0] === '吾輩は犬である。', `${name}: Edit didn't save`);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    expect((await lineTexts(page))[0] === '吾輩は猫である。', `${name}: Undo didn't undo the edit`);
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(
      (await lineTexts(page)).length === 4 && (await lineTexts(page))[1] === '名前はまだ無い。',
      `${name}: Undo didn't put the deleted lines back in order`
    );
    expect((await loggedCharacters(page)) === 28, `${name}: an edit or delete changed the log`);

    step(`${name}: Settings: replace rule, second tool, Newest first, preset`);
    await page.getByRole('button', { name: 'Settings' }).click();
    const sheet = page.getByRole('dialog', { name: 'Settings' });
    // Brought into view first: Playwright's own scrolling stalls inside the fixed sheet on phones.
    const reveal = async (locator) => {
      await locator.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      return locator;
    };
    const switchFor = (title) => reveal(sheet.getByRole('switch', { name: title, exact: true }));

    await (await switchFor('Replace')).click();
    await (await reveal(sheet.getByRole('button', { name: 'Add rule' }))).click();
    await (await reveal(sheet.getByLabel('Pattern 1'))).fill('^【.+?】');
    await sheet.getByLabel('Pattern 1').press('Tab');
    const address2 = sheet.getByRole('combobox', { name: /WebSocket address/ });

    await (await reveal(address2)).fill(tool2);
    await address2.press('Tab');
    await sheet
      .getByRole('status')
      .filter({ hasText: /^Connected$/ })
      .waitFor();
    await (await switchFor('Newest line first')).click();
    await (await reveal(sheet.getByLabel('Preset name'))).fill('Two tools');
    await (await reveal(sheet.getByRole('button', { name: 'Save', exact: true }))).click();
    await shot('settings');
    await page.keyboard.press('Escape');
    await send(tool1, '【猫】「にゃあ」');
    await send(tool2, '二つ目の道具の行。');
    await waitFor(
      async () => (await lineTexts(page))[0] === '二つ目の道具の行。',
      `${name}: the second tool's line isn't on top`
    );
    expect((await lineTexts(page))[1] === '「にゃあ」', `${name}: the rule didn't clean the line`);
    await shot('lines');

    step(`${name}: a preset brings its settings back; notes survive a reload`);
    await page.getByRole('button', { name: 'Settings' }).click();
    await (await switchFor('Newest line first')).click();
    await (await reveal(sheet.getByRole('button', { name: 'Load' }))).click();
    expect(
      (await (await switchFor('Newest line first')).getAttribute('aria-checked')) === 'true',
      `${name}: the preset didn't bring Newest first back`
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Notes' }).click();
    await page.getByRole('textbox', { name: 'Notes' }).fill('猫の名前を考える');
    await page.reload();
    await page
      .getByRole('status')
      .filter({ hasText: /^Connected$/ })
      .waitFor();
    await page.getByRole('button', { name: 'Notes' }).click();
    expect(
      (await page.getByRole('textbox', { name: 'Notes' }).inputValue()) === '猫の名前を考える',
      `${name}: notes lost on reload`
    );
    await shot('notes');
    await page.keyboard.press('Escape');

    step(`${name}: /v's Hooks sheet shows the cleanup and saves it on the game`);
    const id = await page.evaluate(async () => {
      const { windowsGameBook, windowsGameFolder } = await import(
        '/src/lib/data/vn/windows-game.ts'
      );
      const { database } = await import('/src/lib/data/store.ts');
      const root = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('vnbox', {
        create: true
      });
      const folder = await root.getDirectoryHandle(windowsGameFolder('テストVN'), { create: true });

      await folder.getFileHandle('game.exe', { create: true });
      await database.upsertData(
        windowsGameBook('テストVN', 'game.exe', undefined, undefined),
        'overwrite'
      );
      return (await database.getDataByTitle('テストVN')).id;
    });

    await page.goto(`${base}/v?id=${id}`);
    // The bar is there before the page has loaded the game: More opens Hooks only after that.
    await waitFor(async () => {
      if (await page.getByRole('button', { name: 'Hooks' }).isVisible()) return true;
      await page.getByRole('button', { name: 'More' }).click();
      await page.waitForTimeout(500);
      return false;
    }, `${name}: /v's More has no Hooks`);
    await page.getByRole('button', { name: 'Hooks' }).click();
    const hooks = page.getByRole('dialog', { name: 'Hooks' });

    await hooks.getByText('Text cleanup').waitFor();
    const control = hooks.getByRole('switch', { name: 'Control characters', exact: true });

    await control.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await control.click();
    await shot('v-hooks');
    await waitFor(
      () =>
        page.evaluate(async (bookId) => {
          const { database } = await import('/src/lib/data/store.ts');
          const { vnInfo } = await import('/src/lib/data/vn/vn.ts');

          return vnInfo(await database.getData(bookId)).hookCleanup?.control === true;
        }, id),
      `${name}: /v's cleanup wasn't saved on the game`
    );

    expect(!errors.length, `${name}: page errors: ${errors.join('; ')}`);
    step(`${name}: passed`);
  } catch (error) {
    await shot('failure').catch(() => undefined);
    throw error;
  } finally {
    await browser.close();
  }
}

await run('phone', {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
});
await run('desktop', { viewport: { width: 1280, height: 860 } });
console.log(`Shots in ${out}`);
