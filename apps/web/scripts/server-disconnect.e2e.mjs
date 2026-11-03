/* global console, indexedDB, process, localStorage -- Node, and the page inside evaluate */
// Standalone Disconnect with changes waiting: a built standalone on a fake server (Playwright routes).
// Build: VITE_EDITION=standalone pnpm build
// node scripts/server-disconnect.e2e.mjs <apps/web> <standalone build> <screenshot dir>
//
// It fails when: Disconnect drops waiting changes with no question (the bug this replaces); declining
// the question removes or changes anything, or leaves the button dead; accepting leaves the device
// connected or the reader's data or the waiting changes behind; with
// nothing waiting the question appears anyway, or the token isn't revoked on the server.
// (Another target's waiting changes staying is reader-data-owner.test.ts's.)
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const [, , webDir, root, shots] = process.argv;
const { chromium } = createRequire(join(webDir, 'package.json'))('playwright');
const SERVER = 'https://server.example';
const TITLE = '猫のテスト';
const FOR_SERVER = `ttu-calibre-default\tprogress\t${TITLE}`;

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};
const app = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = [
    join(root, path),
    `${join(root, path)}.html`,
    join(root, path, 'index.html'),
    join(root, 'index.html')
  ].find((f) => existsSync(f) && statSync(f).isFile());
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(0);
const origin = `http://127.0.0.1:${app.address().port}`;

mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${ok ? '' : detail}`);
};

/** A device connected to the fake server, as reader u1, holding one day of `TITLE`'s statistics. */
async function connected(waiting) {
  const context = await browser.newContext();
  const revoked = [];
  await context.route(`${SERVER}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (status, body) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
        body: JSON.stringify(body)
      });
    if (route.request().method() === 'OPTIONS') return json(204, {});
    if (pathname === '/account/api/me')
      return json(200, { user: { id: 'u1', username: 'reader' } });
    if (pathname === '/api/v1/version') return json(200, { api: 1 });
    if (pathname.endsWith('/token/revoke')) {
      revoked.push(pathname);
      return json(200, {});
    }
    // Nothing else works, so waiting changes can't be sent.
    return json(503, { error: 'down' });
  });
  await context.addInitScript(
    ([server]) => {
      if (localStorage.getItem('e2eSeeded')) return;
      localStorage.setItem('e2eSeeded', '1');
      localStorage.setItem('storageChosen', '1');
      localStorage.setItem('serverBase', server);
      localStorage.setItem('serverToken', 'token');
      localStorage.setItem('readerDataOwner', 'u1');
    },
    [SERVER]
  );
  const page = await context.newPage();
  const questions = [];
  let answer = 'dismiss';
  page.on('dialog', async (dialog) => {
    questions.push(dialog.message());
    await dialog[answer]();
  });
  await page.goto(`${origin}/settings#sync-server`);
  await page.getByRole('button', { name: 'Disconnect' }).waitFor();
  // The catalog this browser cached names the titles to forget. The waiting list comes after the book:
  // the app's start drops changes for books it doesn't hold.
  await page.evaluate(
    ([server, title, list]) =>
      Promise.all([
        new Promise((resolve, reject) => {
          const open = indexedDB.open('chimi-server', 1);
          open.onupgradeneeded = () => open.result.createObjectStore('cache');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction('cache', 'readwrite');
            tx.objectStore('cache').put({ rev: 1, books: [{ title }] }, `catalog:${server}`);
            tx.oncomplete = () => resolve();
          };
        }),
        new Promise((resolve, reject) => {
          const open = indexedDB.open('books');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction(['statistic', 'data'], 'readwrite');
            tx.objectStore('statistic').put({ title, dateKey: '2026-11-03', readingTime: 60 });
            tx.objectStore('data').put({
              title,
              storageSource: 'ttu-calibre-default',
              sections: []
            });
            tx.oncomplete = () =>
              resolve(localStorage.setItem('syncWaiting', JSON.stringify(list)));
          };
        })
      ]),
    [SERVER, TITLE, waiting]
  );
  return {
    context,
    page,
    questions,
    revoked,
    answering: (value) => {
      answer = value;
    }
  };
}

const state = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('books');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const days = open.result.transaction('statistic').objectStore('statistic').getAllKeys();
          days.onsuccess = () =>
            resolve({
              token: localStorage.getItem('serverToken'),
              waiting: JSON.parse(localStorage.getItem('syncWaiting') || '[]'),
              days: days.result.length
            });
        };
      })
  );

const disconnect = (page) => page.getByRole('button', { name: 'Disconnect' }).click();

try {
  // Offline, changes waiting: asked; declining changes nothing; accepting leaves.
  {
    const { context, page, questions, answering } = await connected([FOR_SERVER]);
    await context.setOffline(true);
    await disconnect(page);
    await page.waitForTimeout(3000);
    check('offline with changes waiting: a question', questions.length === 1, `${questions}`);
    check(
      'the question says they will be lost',
      /lost/.test(questions[0] ?? ''),
      `${questions[0]}`
    );
    await page.screenshot({ path: join(shots, 'offline-declined.png') });

    const declined = await state(page).catch((error) => ({ error: error.message }));
    check(
      'declined: token, waiting changes and data all stay',
      declined.token === 'token' && declined.waiting?.join() === FOR_SERVER && declined.days === 1,
      JSON.stringify(declined)
    );

    if (questions.length) {
      answering('accept');
      await disconnect(page);
      // Its reload fails while offline: the state is read after coming back.
      await page.waitForTimeout(3000);
      check('declined: the button still works', questions.length === 2, `${questions}`);
      await context.setOffline(false);
      await page.goto(`${origin}/settings#sync-server`);
      await page.getByRole('button', { name: 'Connect', exact: true }).waitFor();
      const accepted = await state(page);
      check(
        'accepted: disconnected, the data and the waiting changes gone',
        accepted.token === null && !accepted.waiting.length && accepted.days === 0,
        JSON.stringify(accepted)
      );
      await page.screenshot({ path: join(shots, 'offline-accepted.png') });
    }
    await context.close();
  }

  // Online, nothing waiting: no question, the token is revoked, the data goes.
  {
    const { context, page, questions, revoked } = await connected([]);
    await disconnect(page);
    await page.getByRole('button', { name: 'Connect', exact: true }).waitFor();
    const left = await state(page);
    check('nothing waiting: no question', !questions.length, `${questions}`);
    check('nothing waiting: the token is revoked', revoked.length === 1, `${revoked}`);
    check(
      'nothing waiting: disconnected and the data gone',
      left.token === null && left.days === 0,
      JSON.stringify(left)
    );
    await context.close();
  }
} finally {
  await browser.close();
  app.close();
}

console.log(failed ? `${failed} failed` : `all passed; screenshots in ${shots}`);
process.exit(failed ? 1 : 0);
