/* global console, document, indexedDB, process, setTimeout, window, localStorage, Event -- Node, and the page inside evaluate */
// Deleted statistics days and goals on Drive: browser contexts are devices sharing a fake Drive (Playwright
// routes on Google's API), an old client is a real build of the commit before the change. Standalone builds
// made with VITE_EDITION=standalone VITE_GDRIVE_CLIENT_ID=e2e VITE_GDRIVE_CLIENT_SECRET=e2e pnpm build.
// node apps/web/scripts/sync-deleted-days.e2e.mjs <apps/web> <new build> <old build> <epub titled 猫のテスト, sync-e2e-book.py> [newest,older,...]
// With E2E_SERVER=<test server url> and E2E_PASSWORD, `server` also copies to a real server's `reader` account.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const [, , webDir, newRoot, oldRoot, epub, only] = process.argv;
const { chromium } = createRequire(join(webDir, 'package.json'))('playwright');
const TITLE = '猫のテスト';
const DAY = 864e5;

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function serve(root) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = [
      join(root, path),
      `${join(root, path)}.html`,
      join(root, path, 'index.html'),
      join(root, '404.html')
    ].find((f) => existsSync(f) && statSync(f).isFile());
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  }).listen(0);
  return `http://127.0.0.1:${server.address().port}`;
}

const NEW = serve(newRoot);
const OLD = serve(oldRoot);
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The part of Drive's API the handler uses, in memory; one per test, shared by its devices. */
function fakeDrive() {
  const files = new Map();
  let next = 1;
  const add = (name, parent, content, folder = false) => {
    const id = `f${(next += 1)}`;
    const file = { id, name, parents: [parent], content, folder, version: '1' };
    files.set(id, file);
    return file;
  };
  const list = (q) => {
    const parents = [...q.matchAll(/'([^']+)' in parents/g)].map((m) => m[1]);
    const name = q.match(/name\s*=\s*["']([^"']+)["']/)?.[1];
    return [...files.values()].filter(
      (f) =>
        parents.includes(f.parents[0]) &&
        (name === undefined || f.name === name) &&
        (!q.includes("mimeType = 'application/vnd.google-apps.folder'") &&
        !q.includes("mimeType='application/vnd.google-apps.folder'")
          ? !q.includes('mimeType!=') || !f.folder
          : f.folder)
    );
  };
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
    'content-type': 'application/json'
  };
  const json = (route, body) =>
    route.fulfill({ status: 200, headers, body: JSON.stringify(body ?? {}) });
  const multipart = (request) => {
    const type = request.headers()['content-type'];
    const boundary = type.split('boundary=')[1];
    const parts = request
      .postDataBuffer()
      .toString('utf8')
      .split(`--${boundary}`)
      .slice(1, -1)
      .map((part) => part.slice(part.indexOf('\r\n\r\n') + 4, -2));
    return { metadata: JSON.parse(parts[0]), content: parts[1] ?? '' };
  };

  async function handle(route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const id = url.pathname.match(/files\/([^/]+)$/)?.[1];

    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.hostname === 'oauth2.googleapis.com') {
      return json(route, { access_token: 'e2e', expires_in: 3600, scope: 'drive.file' });
    }
    if (url.pathname.startsWith('/upload/')) {
      const { metadata, content } = multipart(request);
      const file = id ? files.get(id) : add(metadata.name, metadata.parents[0], content);
      file.name = metadata.name;
      file.content = content;
      return json(route, { id: file.id, name: file.name, parents: file.parents });
    }
    if (method === 'DELETE') {
      files.delete(id);
      return route.fulfill({ status: 204, headers });
    }
    if (method === 'POST') {
      const { name, parents } = JSON.parse(request.postData());
      return json(route, { id: add(name, parents[0], '', true).id });
    }
    if (id) return route.fulfill({ status: 200, headers, body: files.get(id)?.content ?? '' });
    return json(route, { files: list(url.searchParams.get('q')) });
  }

  const folder = (name, parent) =>
    [...files.values()].find((f) => f.folder && f.name === name && f.parents[0] === parent) ||
    add(name, parent, '', true);
  const root = () => folder('ttu-reader-data', 'root');
  const bookFolder = (title) => folder(title, root().id);
  const newest = (parent, prefix) =>
    [...files.values()]
      .filter((f) => f.parents[0] === parent && f.name.startsWith(prefix))
      .sort((a, b) => +b.name.split('_')[3] - +a.name.split('_')[3])[0];

  return {
    handle,
    seedDays(title, rows) {
      const time = Math.max(...rows.map((r) => r.lastStatisticModified));
      add(
        `statistics_1_6_${time}_0_0_0_0_0_0_0_0_0_0_0_0_na.json`,
        bookFolder(title).id,
        JSON.stringify(rows)
      );
    },
    seedGoals(rows) {
      const time = Math.max(...rows.map((r) => r.lastGoalModified));
      add(`ttu-user-goals_1_6_${time}.json`, root().id, JSON.stringify(rows));
    },
    days(title) {
      const file = newest(bookFolder(title).id, 'statistics_');
      return {
        time: file ? +file.name.split('_')[3] : 0,
        rows: new Map(JSON.parse(file?.content || '[]').map((r) => [r.dateKey, r]))
      };
    },
    goals() {
      const file = newest(root().id, 'ttu-user-goals_');
      return {
        time: file ? parseInt(file.name.split('_')[3], 10) : 0,
        rows: new Map(JSON.parse(file?.content || '[]').map((r) => [r.goalStartDate, r]))
      };
    }
  };
}

const stat = (dateKey, modified, chars = 100) => ({
  title: TITLE,
  dateKey,
  charactersRead: chars,
  readingTime: 60,
  minReadingSpeed: 100,
  altMinReadingSpeed: 100,
  lastReadingSpeed: 100,
  maxReadingSpeed: 100,
  lastStatisticModified: modified
});
const tombstone = (dateKey, modified) => ({
  ...stat(dateKey, modified, 0),
  readingTime: 0,
  minReadingSpeed: 0,
  altMinReadingSpeed: 0,
  lastReadingSpeed: 0,
  maxReadingSpeed: 0,
  deleted: true
});
const goal = (start, end, modified) => ({
  goalStartDate: start,
  goalEndDate: end,
  goalOriginalEndDate: end,
  timeGoal: 3600,
  characterGoal: 1000,
  goalFrequency: 'daily',
  lastGoalModified: modified
});
const isGone = (row) => row?.deleted === true && !row.readingTime && !row.charactersRead;

async function device(drive, { base = NEW, skew = 0, tracker = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.route(/^https:\/\/(www\.googleapis|oauth2\.googleapis)\.com\//, drive.handle);
  await context.addInitScript(
    ({ ls, skew }) => {
      if (skew) {
        const Real = Date;
        const now = () => Real.now() + skew;
        window.Date = class extends Real {
          constructor(...args) {
            if (args.length) super(...args);
            else super(now());
          }
          static now() {
            return now();
          }
        };
      }
      if (localStorage.getItem('__seeded')) return;
      localStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
    },
    {
      skew,
      ls: {
        storageChosen: '1',
        'oauthRefreshToken:ttu-gdrive-default': 'e2e',
        autoReplication: 'all',
        syncTarget: 'ttu-gdrive-default',
        trackerStartOnOpen: tracker ? '1' : '0',
        lastStatisticsRangeTemplate: 'Custom',
        lastStatisticsStartDate: '2020-01-01',
        lastStatisticsEndDate: '2036-12-31',
        lastPrimaryReadingDataAggregationMode: 'None',
        confirmStatisticsDeletion: '0'
      }
    }
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/manage`);
  await page.waitForLoadState('networkidle');
  await page.locator('input[type=file][accept*="epub"]').first().setInputFiles(epub);
  await page.getByText(TITLE).first().waitFor({ timeout: 30000 });
  return { context, page, base, errors };
}

const idb = (page, store) =>
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

const idbPut = (page, store, rows) =>
  page.evaluate(
    ([store, rows]) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('books');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(store, 'readwrite');
          rows.forEach((row) => tx.objectStore(store).put(row));
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [store, rows]
  );

/** Gives this device its own copy of the days, as an earlier sync would have. */
async function holdDays(dev, rows) {
  await idbPut(dev.page, 'statistic', rows);
  await idbPut(dev.page, 'lastModified', [
    {
      title: TITLE,
      dataType: 'statistic',
      lastModifiedValue: Math.max(...rows.map((r) => r.lastStatisticModified))
    }
  ]);
}

/** Opening a book pulls its statistics and the goals from the source. */
async function openBook({ page, base }) {
  const [{ id }] = await idb(page, 'data');
  await page.goto(`${base}/b?id=${id}`);
  await page.waitForSelector('.book-content p', { timeout: 40000 });
  await sleep(3000);
}

/** Reads for a few seconds with the tracker on, then hides the page: the reader saves and uploads. */
async function readAndUpload({ page }) {
  await sleep(3000);
  await page.keyboard.press('ArrowLeft');
  await sleep(3000);
  await page.keyboard.press('ArrowLeft');
  await sleep(2000);
  // Pausing the tracker saves its numbers; hiding the page then uploads without the 60 s wait.
  await page.keyboard.press('p');
  await sleep(1500);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(3000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible'
    });
  });
}

const dayShown = async ({ page, base }, day) => {
  await page.goto(`${base}/statistics`);
  await sleep(2500);
  return page.locator('tr', { hasText: dayPattern(day) }).count();
};
const dayPattern = (day) =>
  new RegExp(`${day}|${+day.slice(5, 7)}/${+day.slice(8)}/|${day.slice(5, 7)}/${day.slice(8)}/`);

async function deleteDay({ page, base }, day) {
  await page.goto(`${base}/statistics`);
  await sleep(2500);
  await page
    .locator('tr', { hasText: dayPattern(day) })
    .first()
    .getByRole('button', { name: 'Delete' })
    .click({ timeout: 15000 });
  await sleep(3500);
}

const todayOf = (page) =>
  page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
const localRow = async (page, day) =>
  (await idb(page, 'statistic')).find((r) => r.title === TITLE && r.dateKey === day);

const D1 = '2026-03-01';
const D2 = '2026-03-02';
const D3 = '2026-03-03';

async function newest() {
  const drive = fakeDrive();
  const now = Date.now();
  const rows = [stat(D1, now - 5 * DAY), stat(D2, now - DAY)];
  drive.seedDays(TITLE, rows);
  const [a, b] = [await device(drive), await device(drive, { tracker: true })];
  await holdDays(a, rows);
  await holdDays(b, rows);
  await deleteDay(a, D2);
  const { time, rows: file } = drive.days(TITLE);
  check('newest: the file time rose above the day', time > now - DAY, `${time}`);
  check('newest: Drive holds a flagged row', isGone(file.get(D2)), JSON.stringify(file.get(D2)));
  check('newest: the other day stays', file.get(D1)?.charactersRead === 100);
  check('newest: the deleter stops showing it', !(await dayShown(a, D2)));
  await openBook(b);
  check('newest: the stale device took it', isGone(await localRow(b.page, D2)));
  check('newest: and stops showing it', !(await dayShown(b, D2)));
  await openBook(b);
  await readAndUpload(b);
  check('newest: its upload leaves it deleted', isGone(drive.days(TITLE).rows.get(D2)));
  check(
    'newest: that upload did happen',
    drive.days(TITLE).rows.get(await todayOf(b.page))?.readingTime > 0
  );
  await a.context.close();
  await b.context.close();
}

async function older() {
  const drive = fakeDrive();
  const now = Date.now();
  const rows = [stat(D1, now - 5 * DAY), stat(D2, now - DAY)];
  drive.seedDays(TITLE, rows);
  const [a, b] = [await device(drive), await device(drive, { tracker: true })];
  await holdDays(a, rows);
  await holdDays(b, rows);
  await deleteDay(a, D1);
  check('older: the file time rose', drive.days(TITLE).time > now - DAY);
  await openBook(b);
  check('older: the stale device took it', isGone(await localRow(b.page, D1)));
  await readAndUpload(b);
  const file = drive.days(TITLE).rows;
  check('older: the upload neither raises nor revives it', isGone(file.get(D1)));
  check('older: and keeps the other day', file.get(D2)?.charactersRead === 100);
  check('older: that upload did happen', file.get(await todayOf(b.page))?.readingTime > 0);
  await a.context.close();
  await b.context.close();
}

async function oldClient() {
  const drive = fakeDrive();
  const now = Date.now();
  const rows = [stat(D1, now - 5 * DAY), stat(D2, now - DAY)];
  drive.seedDays(TITLE, rows);
  const a = await device(drive);
  const old = await device(drive, { base: OLD, tracker: true });
  await holdDays(a, rows);
  await holdDays(old, rows);
  await deleteDay(a, D2);
  await openBook(old);
  const row = await localRow(old.page, D2);
  check('old client: the day became zeros', row?.charactersRead === 0 && row?.readingTime === 0);
  await readAndUpload(old);
  const file = drive.days(TITLE).rows;
  check(
    'old client: its upload keeps the deletion',
    isGone(file.get(D2)),
    JSON.stringify(file.get(D2))
  );
  check('old client: and the other day', file.get(D1)?.charactersRead === 100);
  check('old client: that upload did happen', file.get(await todayOf(old.page))?.readingTime > 0);
  await dayShown(old, D1);
  check('old client: no page errors', !old.errors.length, old.errors.join(' | '));
  await openBook(a);
  check('old client: the new device still hides the day', !(await dayShown(a, D2)));

  // The old client reads on a deleted day: it keeps the flag on a row with numbers, which must count.
  const today = await todayOf(old.page);
  await holdDays(a, [stat(today, Date.now() - 1000)]);
  await deleteDay(a, today);
  await openBook(old);
  await readAndUpload(old);
  const again = drive.days(TITLE).rows.get(today);
  check(
    'old client: reading the day again gives it numbers',
    again?.readingTime > 0,
    JSON.stringify(again)
  );
  await openBook(a);
  check('old client: the new device shows it again', (await dayShown(a, today)) > 0);
  await a.context.close();
  await old.context.close();
}

async function readAgain() {
  const drive = fakeDrive();
  const a = await device(drive, { tracker: true });
  const b = await device(drive);
  const today = await todayOf(a.page);
  await holdDays(a, [stat(today, Date.now() - 1000)]);
  await deleteDay(a, today);
  const stamp = drive.days(TITLE).rows.get(today)?.lastStatisticModified;
  check('read again: deleted first', isGone(drive.days(TITLE).rows.get(today)));
  await openBook(a);
  await readAndUpload(a);
  const row = drive.days(TITLE).rows.get(today);
  check(
    'read again: the day came back',
    row?.readingTime > 0 && row?.lastStatisticModified > stamp,
    JSON.stringify(row)
  );
  check('read again: shown here', (await dayShown(a, today)) > 0);
  await openBook(b);
  check('read again: and on the other device', (await localRow(b.page, today))?.readingTime > 0);
  await a.context.close();
  await b.context.close();
}

async function skewed() {
  const now = Date.now();
  const hour = 36e5;

  // A row from a clock a day ahead: a right clock's deletion must still beat it.
  const ahead = fakeDrive();

  ahead.seedDays(TITLE, [stat(D1, now + DAY), stat(D2, now - DAY)]);
  const a = await device(ahead);
  await holdDays(a, [stat(D1, now + DAY), stat(D2, now - DAY)]);
  await deleteDay(a, D1);
  const future = ahead.days(TITLE).rows.get(D1);
  check(
    'clock: deletion beats a future-dated row',
    isGone(future) && future.lastStatisticModified > now + DAY
  );
  await a.context.close();

  // A slow clock reads on today after a right clock's deletion: its row must still beat the tombstone.
  const drive = fakeDrive();
  drive.seedDays(TITLE, [stat(D3, now - DAY)]); // So opening the book needs no first-read row.
  const b = await device(drive);
  const slow = await device(drive, { skew: -2 * hour, tracker: true });
  const today = await todayOf(b.page);
  await holdDays(b, [stat(today, now - 1000)]);
  await deleteDay(b, today);
  const stamp = drive.days(TITLE).rows.get(today).lastStatisticModified;
  await openBook(slow);
  check('clock: the slow device took the deletion', isGone(await localRow(slow.page, today)));
  await readAndUpload(slow);
  const row = drive.days(TITLE).rows.get(today);
  check(
    'clock: a slow clock reading again beats the tombstone',
    row?.readingTime > 0 && row.lastStatisticModified > stamp,
    JSON.stringify(row)
  );

  // A slow clock deletes a row stamped by a right clock.
  const c = await device(drive, { skew: -2 * hour });
  await holdDays(c, [stat(D2, now - 1000)]);
  await deleteDay(c, D2);
  const late = drive.days(TITLE).rows.get(D2);
  check(
    'clock: a slow deleter still beats what it saw',
    isGone(late) && late.lastStatisticModified > now - 1000
  );
  await b.context.close();
  await slow.context.close();
  await c.context.close();
}

async function deleteAll() {
  const drive = fakeDrive();
  const now = Date.now();
  const rows = [stat(D1, now - 3 * DAY), stat(D2, now - 2 * DAY), stat(D3, now - DAY)];
  drive.seedDays(TITLE, rows);
  const [a, b] = [await device(drive), await device(drive)];
  await holdDays(a, rows);
  await holdDays(b, rows);
  await a.page.evaluate(() => localStorage.setItem('libraryTab', 'store'));
  await a.page.goto(`${a.base}/manage`);
  await a.page.waitForLoadState('networkidle');
  await a.page.getByRole('button', { name: 'Select', exact: true }).click({ timeout: 15000 });
  await a.page.getByText(TITLE).first().click();
  await a.page.getByRole('button', { name: 'Delete statistics for selected books' }).click();
  await sleep(3500);
  const file = drive.days(TITLE);
  check(
    'delete all: every day is flagged',
    [D1, D2, D3].every((d) => isGone(file.rows.get(d))),
    `${file.rows.size} rows`
  );
  check('delete all: the file time rose', file.time > now - DAY);
  check('delete all: nothing shows here', !(await dayShown(a, D1)));
  await openBook(b);
  check('delete all: the stale device took it', isGone(await localRow(b.page, D3)));
  check('delete all: nothing shows there', !(await dayShown(b, D3)));
  await a.context.close();
  await b.context.close();
}

async function goals() {
  const drive = fakeDrive();
  const now = Date.now();
  const closed = goal('2025-01-01', '2025-01-31', now - 5 * DAY);
  const kept = goal('2025-03-01', '2025-03-31', now - 4 * DAY);
  const rows = [closed, kept];
  drive.seedGoals(rows);
  const [a, b] = [await device(drive), await device(drive)];
  const old = await device(drive, { base: OLD });
  for (const dev of [a, b, old]) {
    await idbPut(dev.page, 'readingGoal', rows);
    await dev.page.evaluate(
      (time) => localStorage.setItem('lastReadingGoalsModified', time),
      `${now - 4 * DAY}`
    );
  }
  await a.page.goto(`${a.base}/settings#tracking-goals`);
  await sleep(2500);
  await a.page.getByText('Reading Goal History').click();
  await a.page
    .locator('button[title="Delete Reading Goal"]:visible')
    .first()
    .click({ timeout: 10000 });
  await sleep(500);
  await a.page
    .locator('button', { hasText: /^(Confirm|OK|Ok|Yes)$/ })
    .first()
    .click({ timeout: 8000 });
  await sleep(3500);
  const file = drive.goals();
  const gone = [...file.rows.values()].filter((r) => r.deleted);
  check(
    'goals: one deletion in the file',
    gone.length === 1,
    JSON.stringify([...file.rows.values()])
  );
  check('goals: the file time rose', file.time > now - 4 * DAY, `${file.time}`);
  const start = gone[0]?.goalStartDate;
  await openBook(b);
  const held = (await idb(b.page, 'readingGoal')).find((r) => r.goalStartDate === start);
  check('goals: the stale device took it', held?.deleted === true, JSON.stringify(held));
  await b.page.goto(`${b.base}/settings#tracking-goals`);
  await sleep(2500);
  await b.page.getByText('Reading Goal History').click();
  check(
    'goals: the history shows only the kept one',
    (await b.page.locator('button[title="Delete Reading Goal"]:visible').count()) === 1
  );
  await openBook(old);
  const oldHeld = (await idb(old.page, 'readingGoal')).find((r) => r.goalStartDate === start);
  check(
    'goals: the old client took it',
    oldHeld && !oldHeld.timeGoal && !oldHeld.characterGoal,
    JSON.stringify(oldHeld)
  );
  check('goals: no page errors on the old client', !old.errors.length, old.errors.join(' | '));
  await a.context.close();
  await b.context.close();
  await old.context.close();
}

async function expiry() {
  const drive = fakeDrive();
  const now = Date.now();
  const rows = [tombstone(D1, now - 400 * DAY), tombstone(D2, now - 30 * DAY), stat(D3, now - DAY)];
  drive.seedDays(TITLE, rows);
  const a = await device(drive, { tracker: true });
  await openBook(a);
  await readAndUpload(a);
  const file = drive.days(TITLE).rows;
  check('expiry: a tombstone over a year old is gone', !file.has(D1));
  check('expiry: a month-old one stays', isGone(file.get(D2)));
  check('expiry: live days stay', file.get(D3)?.charactersRead === 100);

  // A device stale for longer than that brings the day back: the old days' behaviour, nothing worse.
  const stale = await device(drive, { tracker: true });
  await holdDays(stale, [stat(D1, now - 500 * DAY)]);
  await openBook(stale);
  await readAndUpload(stale);
  check(
    'expiry: a longer-stale device brings its day back',
    drive.days(TITLE).rows.get(D1)?.charactersRead === 100
  );
  await a.context.close();
  await stale.context.close();
}

/** A flagged row pulled from Drive, then copied to a real server through the reader: a tombstone there. */
async function server() {
  const base = process.env.E2E_SERVER;
  if (!base) {
    console.log('SKIP server: no E2E_SERVER');
    return;
  }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/version.txt`);
  const status = await page.evaluate(
    (password) =>
      window
        .fetch('/account/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'reader', password })
        })
        .then((r) => r.status),
    process.env.E2E_PASSWORD
  );
  if (status !== 200) throw new Error(`login ${status}`);
  const api = (method, path, body) =>
    page.evaluate(
      ([method, path, body]) =>
        window
          .fetch(`/api/v1/${path}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body && JSON.stringify(body)
          })
          .then(async (r) => ({ status: r.status, json: await r.json().catch(() => undefined) })),
      [method, path, body]
    );
  const { json } = await api('GET', 'catalog?since=0');
  const book = json.books.find((b) => b.title.includes('走れメロス'));
  const title = book.title;
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const day = `2025-${String(1 + (minute % 12)).padStart(2, '0')}-${String(1 + (minute % 28)).padStart(2, '0')}`;
  const live = { ...stat(day, now - 5000), title };
  await api('PUT', `books/${book.id}/statistics/${day}`, { modified: now - 5000, data: live });
  await page.evaluate(() => localStorage.setItem('libraryTab', 'store'));
  await page.goto(`${base}/manage`);
  await page.locator('.library-card-main', { hasText: title }).first().click({ timeout: 40000 });
  await page.locator('.details-actions .app-button-primary').first().click({ timeout: 20000 });
  await page.waitForSelector('.book-content', { timeout: 40000 });
  await sleep(3000);
  // As a pull from Drive leaves it: a flagged row in the browser, newer than the server's.
  await idbPut(page, 'statistic', [{ ...tombstone(day, now - 1000), title }]);
  await idbPut(page, 'lastModified', [
    { title, dataType: 'statistic', lastModifiedValue: now - 1000 }
  ]);
  await page.reload();
  await page.waitForSelector('.book-content', { timeout: 40000 });
  await readAndUpload({ page });
  await sleep(2000);
  const { json: sync } = await api('GET', 'sync?since=0');
  const row = (sync.statistics || sync.rows?.statistics || []).find(
    (r) => r.book === book.id && (r.dateKey || r.key) === day
  );
  check('server: the flagged row is a tombstone there', row?.deleted === true, JSON.stringify(row));
  await api('DELETE', `books/${book.id}/statistics/${day}`, { modified: Date.now() });
  await context.close();
}

const tests = { newest, older, oldClient, readAgain, skewed, deleteAll, goals, expiry, server };
for (const [name, test] of Object.entries(tests)) {
  if (only && !only.split(',').includes(name)) continue;
  await test().catch((error) => check(`${name} ran`, false, error.message.slice(0, 500)));
}
await browser.close();
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
