/* global console, document, indexedDB, process, setTimeout, window, localStorage, navigator, getComputedStyle, DOMException, IDBObjectStore, URL -- Node, and the page inside evaluate */
// Two tabs sharing settings and highlights, full storage, restoring a backup into a fresh browser and
// failed listings, on a standalone build (VITE_EDITION=standalone pnpm build) in real Chromium.
// node apps/web/scripts/sync-tabs.e2e.mjs <apps/web> <build dir> <epub titled 猫のテスト, sync-e2e-book.py> [t51,t52,...]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const [, , webDir, root, epub] = process.argv;
const { chromium } = createRequire(join(webDir, 'package.json'))('playwright');

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const files = [
    join(root, path),
    `${join(root, path)}.html`,
    join(root, path, 'index.html'),
    join(root, '404.html')
  ];
  const file = files.find((f) => existsSync(f) && statSync(f).isFile());
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const ANNOTATIONS = 'ttu-annotations';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fresh(ls = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true
  });
  await context.addInitScript((ls) => {
    if (!localStorage.getItem('__seeded')) {
      localStorage.setItem('__seeded', '1');
      localStorage.setItem('storageChosen', '1');
      for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
    }
  }, ls);
  return context;
}

const idb = (page, store, key, name = 'books') =>
  page.evaluate(
    ([store, key, name]) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(store);
          const r =
            key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
          r.onsuccess = () => {
            db.close();
            resolve(r.result);
          };
          r.onerror = () => reject(r.error);
        };
      }),
    [store, key, name]
  );

async function importBook(page) {
  await page.goto(`${base}/manage`);
  await page.waitForLoadState('networkidle');
  await page.locator('input[type=file][accept*="epub"]').first().setInputFiles(epub);
  await page.getByText('猫のテスト').first().waitFor({ timeout: 30000 });
}

async function openReader(page) {
  if (page.url() === 'about:blank') await page.goto(`${base}/version.txt`);
  const [{ id }] = await idb(page, 'data');
  await page.goto(`${base}/b?id=${id}`);
  await page.waitForSelector('.book-content p', { timeout: 30000 });
  await sleep(1500);
}

async function addHighlight(page, paragraph) {
  const box = await page.evaluate((n) => {
    const p = document.querySelectorAll('.book-content p')[n];
    const r = document.createRange();
    r.selectNodeContents(p);
    const { left, top, width, height } = r.getClientRects()[0];
    return { left, top, width, height };
  }, paragraph);
  const x = box.left + box.width / 2;
  await page.mouse.move(x, box.top + 2);
  await page.mouse.down();
  await page.mouse.move(x, box.top + box.height - 2, { steps: 6 });
  await page.mouse.up();
  await sleep(500);
  await page.locator('.color-dot').first().click();
  await sleep(600);
}

async function t52() {
  const context = await fresh();
  const a = await context.newPage();
  await importBook(a);
  await openReader(a);
  console.log('  a open');
  const b = await context.newPage();
  for (const [n, p] of [
    ['a', a],
    ['b', b]
  ]) {
    p.on('crash', () => console.log('  crash', n));
    p.on('close', () => console.log('  close', n));
    p.on('dialog', (d) => {
      console.log('  dialog', n, d.message());
      d.dismiss();
    });
    p.on('console', (m) => console.log('  ' + n + ':', m.text().slice(0, 160)));
    p.on('pageerror', (e) => console.log('  ' + n + ' err:', e.message));
  }
  await openReader(b);
  console.log('  b open');
  await addHighlight(b, 2);
  console.log(
    '  b highlighted',
    JSON.stringify(
      (await idb(b, 'annotations', undefined, ANNOTATIONS)).map((r) => r.highlights.length)
    )
  );
  await b.goto(`${base}/version.txt`);
  await a.bringToFront();
  await addHighlight(a, 4);
  await sleep(500);
  const [{ highlights }] = await idb(a, 'annotations', undefined, ANNOTATIONS);
  check(
    '52 tab A save keeps tab B highlight',
    highlights.length === 2,
    `stored ${highlights.length}`
  );
  await context.close();
}

async function t51() {
  const context = await fresh();
  const a = await context.newPage();
  await a.goto(`${base}/settings`);
  await a.waitForLoadState('networkidle');
  const b = await context.newPage();
  await b.goto(`${base}/settings`);
  await b.waitForLoadState('networkidle');
  // The store's value in memory: the theme is what the tab paints.
  const paint = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const before = await paint(a);
  await b.evaluate(() => localStorage.setItem('theme', 'chimi-dark'));
  await sleep(600);
  const after = await paint(a);
  check(
    "51 another tab's value reaches this tab's store",
    before !== after,
    `${before} -> ${after}`
  );
  // An invalid value must not reach the store.
  await b.evaluate(() => localStorage.setItem('theme', '{"bad":1'));
  await sleep(300);
  check(
    '51 refresh records no change time',
    !(await a.evaluate(
      () => JSON.parse(localStorage.getItem('accountSettingsModified') || '{}').theme
    ))
  );
  await context.close();
}

async function t53() {
  const context = await fresh();
  const a = await context.newPage();
  await importBook(a);
  await context.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'bookmark' && window.__full)
        throw new DOMException('full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  const errors = [];
  a.on('pageerror', (e) => errors.push(e.message));
  await openReader(a);
  await a.evaluate(() => {
    window.__full = true;
  });
  await a.keyboard.press('b');
  await sleep(500);
  let visible = await a.locator('section.toast').count();
  if (!visible) {
    await a.mouse.move(640, 5);
    await sleep(300);
  }
  await a.evaluate(() => {
    const save = [...document.querySelectorAll('button')].find((b) =>
      /bookmark/i.test(b.title + b.ariaLabel + b.textContent)
    );
    save?.click();
  });
  await sleep(800);
  visible = await a.locator('section.toast').count();
  check('53 notice shows when the write fails', visible === 1);
  check('53 no unhandled rejection', !errors.length, errors.join('|'));
  await a.locator('section.toast .toast-close').click();
  await a.keyboard.press('b');
  await sleep(500);
  check('53 one message only', (await a.locator('section.toast').count()) === 0);
  await context.close();
}

async function t54() {
  const source = await fresh();
  const a = await source.newPage();
  await importBook(a);
  await openReader(a);
  // A place to back up.
  const [{ id }] = await idb(a, 'data');
  await a.evaluate(
    (id) =>
      new Promise((resolve) => {
        const open = indexedDB.open('books');
        open.onsuccess = () => {
          const tx = open.result.transaction('bookmark', 'readwrite');
          tx.objectStore('bookmark').put({
            dataId: id,
            exploredCharCount: 500,
            progress: 0.2,
            lastBookmarkModified: Date.now()
          });
          tx.oncomplete = resolve;
        };
      }),
    id
  );
  await a.goto(`${base}/settings#sync-backup`);
  await a
    .getByRole('button', { name: 'Export', exact: true })
    .first()
    .click({ timeout: 20000 })
    .catch(() => {});
  const download = await a.waitForEvent('download', { timeout: 20000 }).catch(() => undefined);
  if (!download) {
    check('54 export made a zip', false);
    await source.close();
    return;
  }
  const zip = join(tmpdir(), `backup-${Date.now()}.zip`);
  await download.saveAs(zip);

  const target = await fresh();
  const b = await target.newPage();
  b.on('console', (m) => console.log('  b:', m.text().slice(0, 200)));
  b.on('pageerror', (e) => console.log('  b err:', e.message));
  await b.goto(`${base}/settings#sync-backup`);
  await b.getByRole('button', { name: 'Choose file' }).first().waitFor({ timeout: 20000 });
  await b.locator('input[type=file][accept=".zip,application/zip"]').last().setInputFiles(zip);
  await b.waitForSelector('.backup-message', { timeout: 20000 });
  const message = await b.locator('.backup-message').textContent();
  check(
    '54 fresh browser is told places were dropped',
    /Import the books first.*1 place not restored/.test(message),
    message
  );

  // Book present: the same restore reports success.
  await importBook(b);
  await b.goto(`${base}/settings#sync-backup`);
  await b.getByRole('button', { name: 'Choose file' }).first().waitFor({ timeout: 20000 });
  await b.locator('input[type=file][accept=".zip,application/zip"]').last().setInputFiles(zip);
  await b.waitForSelector('.backup-message', { timeout: 20000 });
  const ok = await b.locator('.backup-message').textContent();
  const places = await idb(b, 'bookmark');
  check(
    '54 with the book it restores and says so',
    ok.includes('Backup restored') && places.length === 1,
    `${ok} places=${places.length}`
  );
  await source.close();
  await target.close();
}

async function t55() {
  for (const [name, status, staysOn] of [
    ['503', 503, true],
    ['403', 403, false]
  ]) {
    const context = await fresh({
      serverBase: 'http://server.test',
      serverToken: 'x',
      lastStorageSource: 'calibre'
    });
    await context.route('http://server.test/**', (route) =>
      route.fulfill({
        status,
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
        body: '{}'
      })
    );
    const page = await context.newPage();
    await page.goto(`${base}/manage`);
    await sleep(3000);
    const source = await page.evaluate(() => localStorage.getItem('lastStorageSource'));
    check(
      `55 a ${name} listing ${staysOn ? 'keeps' : 'leaves'} the source`,
      (source === 'calibre') === staysOn,
      source
    );
    await context.close();
  }

  // Drive with no signal: the library stays on Drive, and coming back online lists it again.
  const context = await fresh({ lastStorageSource: 'gdrive' });
  await context.addInitScript(() =>
    Object.defineProperty(navigator, 'onLine', { get: () => !window.__offline, configurable: true })
  );
  await context.addInitScript(() => {
    window.__offline = true;
  });
  const page = await context.newPage();
  await page.goto(`${base}/manage`);
  await sleep(3000);
  const source = await page.evaluate(() => localStorage.getItem('lastStorageSource'));
  check('55 Drive with no signal keeps the source', source === 'gdrive', source);
  check('55 the error is shown', (await page.locator('text=Sign in to Drive again').count()) > 0);
  await context.close();
}

const only = process.argv[5]?.split(',');
for (const [name, test] of Object.entries({ t51, t52, t53, t54, t55 })) {
  if (only && !only.includes(name)) continue;
  await test().catch((error) => check(`${name} ran`, false, error.message));
}
await browser.close();
server.close();
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
