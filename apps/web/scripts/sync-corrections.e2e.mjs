/* global console, indexedDB, process, setTimeout, window, localStorage, DOMException, IDBObjectStore, fetch, dispatchEvent, Event -- Node, and the page inside evaluate */
// Statistics and goals corrections, tabs and full storage against a running server with the seeded test
// library; two browser contexts are two devices. It writes to the `reader` account: never a real server.
// E2E_PASSWORD=... node apps/web/scripts/sync-corrections.e2e.mjs <apps/web> <server url> [t50,t51,t53]
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [, , webDir, base, only] = process.argv;
const { chromium } = createRequire(join(webDir, 'package.json'))('playwright');
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function device(ls = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/version.txt`);
  const status = await page.evaluate((ls) => {
    Object.entries(ls).forEach(([k, v]) => localStorage.setItem(k, v));
    return fetch('/account/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'reader', password: process.env.E2E_PASSWORD })
    }).then((r) => r.status);
  }, ls);
  if (status !== 200) throw new Error(`login ${status}`);
  page.on('pageerror', (e) => console.log('  pageerror', e.message));
  return { context, page };
}

const api = (page, method, path, body) =>
  page.evaluate(
    ([method, path, body]) =>
      fetch(`/api/v1/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body && JSON.stringify(body)
      }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => undefined) })),
    [method, path, body]
  );

const idbAll = (page, store) =>
  page.evaluate(
    (store) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('books');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const r = open.result.transaction(store).objectStore(store).getAll();
          r.onsuccess = () => {
            open.result.close();
            resolve(r.result);
          };
        };
      }),
    store
  );

const stat = (title, dateKey, modified, chars = 100) => ({
  title,
  dateKey,
  charactersRead: chars,
  readingTime: 60,
  minReadingSpeed: 100,
  altMinReadingSpeed: 100,
  lastReadingSpeed: 100,
  maxReadingSpeed: 100,
  lastStatisticModified: modified
});

async function findBook(page) {
  const { json } = await api(page, 'GET', 'catalog?since=0');
  const book = json.books.find((b) => b.title.includes('走れメロス'));
  if (!book) throw new Error(`no book; ${json.books.length} books`);
  return book;
}

const rowsOf = async (page, table, bookId) => {
  const { json } = await api(page, 'GET', 'sync?since=0');
  return (json[table] || json.rows?.[table] || []).filter(
    (r) => bookId === undefined || r.book === bookId
  );
};

async function openBook(page, title) {
  await page.evaluate(() => localStorage.setItem('libraryTab', 'store'));
  await page.goto(`${base}/manage`);
  await page.locator('.library-card-main', { hasText: title }).first().click({ timeout: 40000 });
  await page.locator('.details-actions .app-button-primary').first().click({ timeout: 20000 });
  await page.waitForSelector('.book-content', { timeout: 40000 });
  await sleep(2500);
}

async function t50() {
  const a = await device({
    lastStatisticsTab: 'Summary',
    lastStatisticsRangeTemplate: 'Custom',
    lastStatisticsStartDate: '2026-01-01',
    lastStatisticsEndDate: '2026-12-31',
    lastPrimaryReadingDataAggregationMode: 'None',
    confirmStatisticsDeletion: '0'
  });
  const book = await findBook(a.page);
  const title = book.title;
  const now = Date.now();
  // Fresh days each run: an earlier run's tombstones are newer than rows seeded in the past.
  const minute = Math.floor(now / 60000);
  const month = String(1 + (Math.floor(minute / 20) % 9)).padStart(2, '0');
  const day = (n) => String(1 + (minute % 20) + n).padStart(2, '0');
  const days = [0, 1, 2, 3].map((n) => `2026-${month}-${day(n)}`);
  for (const day of days.slice(0, 3)) {
    await api(a.page, 'PUT', `books/${book.id}/statistics/${day}`, {
      modified: now - 2000,
      data: stat(title, day, now - 2000)
    });
  }
  await openBook(a.page, title);
  const local = (await idbAll(a.page, 'statistic'))
    .filter((s) => s.title === title)
    .map((s) => s.dateKey);
  check(
    '50 setup: this device pulled the days',
    days.slice(0, 3).every((d) => local.includes(d)),
    local.join()
  );

  // Another device writes a day this one never received, and lets this one's time be as new.
  await api(a.page, 'PUT', `books/${book.id}/statistics/${days[3]}`, {
    modified: now - 1000,
    data: stat(title, days[3], now - 1000)
  });

  await a.page.goto(`${base}/statistics`);
  await sleep(2500);
  const row = a.page
    .locator('tr', { hasText: new RegExp(`${days[0]}|${month}[-/]${day(0)}`) })
    .first();
  await row.getByRole('button', { name: 'Delete' }).click({ timeout: 15000 });
  await sleep(3000);

  const rows = await rowsOf(a.page, 'statistics', book.id);
  const state = Object.fromEntries(
    rows.map((r) => [r.dateKey || r.key, r.deleted ? 'gone' : 'live'])
  );
  check('50 deleted day is gone on the server', state[days[0]] === 'gone', JSON.stringify(state));
  check(
    '50 other days stay, including one this device had not received',
    state[days[1]] === 'live' && state[days[2]] === 'live' && state[days[3]] === 'live',
    JSON.stringify(state)
  );
  const after = (await idbAll(a.page, 'statistic'))
    .filter((s) => s.title === title)
    .map((s) => s.dateKey);
  check(
    "50 this device now has the other device's day",
    after.includes(days[3]) && !after.includes(days[0]),
    after.join()
  );

  // A second device with a stale copy can't bring it back on the server: open the book there.
  const b = await device();
  await openBook(b.page, title);
  const seen = (await idbAll(b.page, 'statistic'))
    .filter((s) => s.title === title)
    .map((s) => s.dateKey);
  check("50 a new device doesn't get the deleted day", !seen.includes(days[0]), seen.join());
  await b.context.close();

  // Edit a day: reaches the server although nothing else would send it.
  await a.page.reload();
  await sleep(2500);
  const edit = a.page
    .locator('tr', { hasText: new RegExp(`${days[1]}|${month}[-/]${day(1)}`) })
    .first();
  await edit.getByRole('button', { name: 'Edit' }).click({ timeout: 15000 });
  await sleep(300);
  const editing = a.page.locator('tr:has(input[type=number])').first();
  await editing.locator('input[type=number]').first().fill('4242');
  await editing.locator('input[type=number]').last().fill('4242');
  await editing.getByRole('button', { name: 'Save' }).click();
  await sleep(500);
  await a.page
    .locator('.app-button-primary, button', { hasText: /^(OK|Ok|Confirm|Yes)$/ })
    .first()
    .click({ timeout: 5000 })
    .catch(() => {});
  await sleep(3000);
  const edited = (await rowsOf(a.page, 'statistics', book.id)).find(
    (r) => (r.dateKey || r.key) === days[1]
  );
  check(
    '50 edit reached the server',
    JSON.stringify(edited?.data).includes('4242'),
    JSON.stringify(edited?.data)?.slice(0, 120)
  );
  const modified = (await idbAll(a.page, 'lastModified')).find(
    (m) => m.title === title && m.dataType === 'statistic'
  );
  console.log('  lastModified', JSON.stringify(modified));

  // A goal deleted here: gone on the server; another device's goal stays.
  const goal = (start, end, modified) => ({
    goalStartDate: start,
    goalEndDate: end,
    goalOriginalEndDate: end,
    timeGoal: 60,
    characterGoal: 100,
    goalFrequency: 'Daily',
    lastGoalModified: modified
  });
  for (const row of await rowsOf(a.page, 'goals'))
    if (!row.deleted)
      await api(a.page, 'DELETE', `goals/${row.goalStart}`, { modified: Date.now() });
  const goals = [`2024-${month}-${day(0)}`, `2024-${month}-${day(5)}`];
  await api(a.page, 'PUT', `goals/${goals[0]}`, {
    modified: now - 2000,
    data: goal(goals[0], `2024-${month}-${day(1)}`, now - 2000)
  });
  await a.page.goto(`${base}/settings#tracking-goals`);
  await sleep(1500);
  await openBook(a.page, title);
  await api(a.page, 'PUT', `goals/${goals[1]}`, {
    modified: now - 1000,
    data: goal(goals[1], `2024-${month}-${day(6)}`, now - 1000)
  });
  await a.page.goto(`${base}/settings#tracking-goals`);
  await sleep(3000);
  await a.page.getByText('Reading Goal History').click();
  const del = a.page.locator('button[title="Delete Reading Goal"]:visible').first();
  await del.click({ timeout: 10000 });
  await sleep(500);
  await a.page
    .locator('button', { hasText: /^(Confirm|OK|Ok|Yes)$/ })
    .first()
    .click({ timeout: 8000 });
  await sleep(3000);
  const goalRows = await rowsOf(a.page, 'goals');
  const goalState = Object.fromEntries(
    goalRows.map((r) => [r.goalStart ?? r.key, r.deleted ? 'gone' : 'live'])
  );
  check(
    '50 goal: the deleted one is gone, the other stays',
    goalState[goals[0]] === 'gone' && goalState[goals[1]] === 'live',
    JSON.stringify(goalState)
  );
  for (const start of goals)
    await api(a.page, 'DELETE', `goals/${start}`, { modified: Date.now() });

  // Clean up the account's rows.
  for (const day of days)
    await api(a.page, 'DELETE', `books/${book.id}/statistics/${day}`, { modified: Date.now() });
  await a.context.close();
}

async function t51() {
  const { context, page: a } = await device();
  await a.goto(`${base}/settings#reader-text`);
  await sleep(2500);
  const b = await context.newPage();
  await b.goto(`${base}/settings#reader-text`);
  await sleep(2500);
  const size = String(20 + (Date.now() % 40));
  const input = b.locator('.settings-item:has-text("Font size") input[type=number]').first();
  await input.fill(size);
  await input.blur();
  await sleep(2500);
  // Tab A takes focus and syncs; a stale value would go up with B's newer time.
  await a.bringToFront();
  await a.evaluate(() => window.dispatchEvent(new Event('focus')));
  await a.evaluate(() => dispatchEvent(new Event('focus')));
  await sleep(4000);
  const shown = await a
    .locator('.settings-item:has-text("Font size") input[type=number]')
    .first()
    .inputValue();
  check("51 tab A shows tab B's font size", shown === size, `${shown} vs ${size}`);
  const inB = await b
    .locator('.settings-item:has-text("Font size") input[type=number]')
    .first()
    .inputValue();
  check('51 tab B keeps its font size after A synced', inB === size, inB);
  await context.close();
}

async function t53() {
  const { context, page } = await device();
  const book = await findBook(page);
  await openBook(page, book.title);
  const puts = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && /\/progress$/.test(r.url())) puts.push(r.postData());
  });
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'bookmark') throw new DOMException('full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await sleep(1000);
  await page.keyboard.press('b');
  await sleep(1500);
  check('53 notice shows', (await page.locator('section.toast').count()) === 1);
  check(
    '53 the place still reached the server',
    puts.length > 0,
    `${puts.length} PUTs: ${puts[0]?.slice(0, 80)}`
  );
  await context.close();
}

for (const [name, test] of Object.entries({ t50, t51, t53 })) {
  if (only && !only.split(',').includes(name)) continue;
  await test().catch((error) => check(`${name} ran`, false, error.message.slice(0, 400)));
}
await browser.close();
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
