/* global console, document, indexedDB, process, setTimeout, localStorage, Event -- Node, and the page inside evaluate */
// Sync status and statistics gaps on Drive: browser contexts on a fake Drive (Playwright routes on Google's API).
// Builds: VITE_GDRIVE_CLIENT_ID=e2e VITE_GDRIVE_CLIENT_SECRET=e2e pnpm build, one of them with VITE_EDITION=standalone.
// node scripts/sync-found.e2e.mjs <apps/web> <standalone build> <server build> <epub titled 猫のテスト> <screenshot dir> [scenario]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const [, , webDir, standaloneRoot, serverRoot, epub, shots, only] = process.argv;
const { chromium } = createRequire(join(webDir, 'package.json'))('playwright');
const TITLE = '猫のテスト';
const DAY = 864e5;
const TOKEN_KEY = 'oauthRefreshToken:ttu-gdrive-default';

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
      join(root, '404.html'),
      join(root, 'index.html')
    ].find((f) => existsSync(f) && statSync(f).isFile());
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  }).listen(0);
  return `http://127.0.0.1:${server.address().port}`;
}

const STANDALONE = serve(standaloneRoot);
const SERVER = serve(serverRoot);
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The part of Drive's API the handler uses, in memory. */
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
    const boundary = request.headers()['content-type'].split('boundary=')[1];
    const parts = request
      .postDataBuffer()
      .toString('utf8')
      .split(`--${boundary}`)
      .slice(1, -1)
      .map((part) => part.slice(part.indexOf('\r\n\r\n') + 4, -2));
    return { metadata: JSON.parse(parts[0]), content: parts[1] ?? '' };
  };
  const state = {
    refreshError: '',
    failUploads: false,
    failAll: false,
    failDownloads: false,
    loseUploadAnswer: false
  };

  async function handle(route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const id = url.pathname.match(/files\/([^/]+)$/)?.[1];

    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.hostname === 'oauth2.googleapis.com') {
      if (state.refreshError) {
        return route.fulfill({
          status: 401,
          headers,
          body: JSON.stringify({ error: state.refreshError })
        });
      }
      return json(route, { access_token: 'e2e', expires_in: 3600, scope: 'drive.file' });
    }
    if (state.failAll || (state.failUploads && url.pathname.startsWith('/upload/'))) {
      return route.fulfill({ status: 403, headers, body: '{"error":{"message":"refused"}}' });
    }
    if (url.pathname.startsWith('/upload/')) {
      const { metadata, content } = multipart(request);
      const file = id ? files.get(id) : add(metadata.name, metadata.parents[0], content);
      file.name = metadata.name;
      file.content = content;
      if (state.loseUploadAnswer && metadata.name.startsWith('statistics_')) {
        return route.fulfill({ status: 500, headers, body: '{"error":{"message":"lost"}}' });
      }
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
    if (id) {
      if (state.failDownloads && files.get(id)?.name.startsWith('statistics_')) {
        return route.fulfill({ status: 500, headers, body: '{"error":{"message":"no"}}' });
      }
      return route.fulfill({ status: 200, headers, body: files.get(id)?.content ?? '' });
    }
    return json(route, { files: list(url.searchParams.get('q')) });
  }

  const folder = (name, parent) =>
    [...files.values()].find((f) => f.folder && f.name === name && f.parents[0] === parent) ||
    add(name, parent, '', true);
  const bookFolder = () => folder(TITLE, folder('ttu-reader-data', 'root').id);
  const newest = () =>
    [...files.values()]
      .filter((f) => f.parents[0] === bookFolder().id && f.name.startsWith('statistics_'))
      .sort((a, b) => +b.name.split('_')[3] - +a.name.split('_')[3])[0];

  return {
    handle,
    state,
    /** What another device's upload leaves: one statistics file with these rows. */
    writeDays(rows) {
      const time = Math.max(...rows.map((r) => r.lastStatisticModified));
      const old = newest();
      if (old) files.delete(old.id);
      add(
        `statistics_1_6_${time}_0_0_0_0_0_0_0_0_0_0_0_0_na.json`,
        bookFolder().id,
        JSON.stringify(rows)
      );
    },
    statisticsFiles: () =>
      [...files.values()].filter(
        (f) => f.parents[0] === bookFolder().id && f.name.startsWith('statistics_')
      ).length,
    days() {
      const file = newest();
      return {
        time: file ? +file.name.split('_')[3] : 0,
        rows: new Map(JSON.parse(file?.content || '[]').map((r) => [r.dateKey, r]))
      };
    }
  };
}

const stat = (dateKey, modified, chars = 100, readingTime = 60) => ({
  title: TITLE,
  dateKey,
  charactersRead: chars,
  readingTime,
  minReadingSpeed: 100,
  altMinReadingSpeed: 100,
  lastReadingSpeed: 100,
  maxReadingSpeed: 100,
  lastStatisticModified: modified
});

async function device(
  drive,
  { base = STANDALONE, tracker = false, viewport = { width: 1400, height: 900 }, ls = {} } = {}
) {
  const context = await browser.newContext({ viewport });
  await context.route(/^https:\/\/(www\.googleapis|oauth2\.googleapis)\.com\//, drive.handle);
  await context.addInitScript(
    (seed) => {
      if (localStorage.getItem('__seeded')) return;
      localStorage.setItem('__seeded', '1');
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    },
    {
      storageChosen: '1',
      [TOKEN_KEY]: 'e2e',
      autoReplication: 'all',
      syncTarget: 'ttu-gdrive-default',
      trackerStartOnOpen: tracker ? '1' : '0',
      lastStatisticsTab: 'Summary',
      lastStatisticsRangeTemplate: 'Custom',
      lastStatisticsStartDate: '2020-01-01',
      lastStatisticsEndDate: '2036-12-31',
      lastPrimaryReadingDataAggregationMode: 'None',
      confirmStatisticsDeletion: '0',
      ...ls
    }
  );
  const page = await context.newPage();
  await page.goto(`${base}/manage`);
  await page.waitForLoadState('networkidle');
  return { context, page, base };
}

async function importBook({ page }) {
  await page.locator('input[type=file][accept*="epub"]').first().setInputFiles(epub);
  await page.getByText(TITLE).first().waitFor({ timeout: 30000 });
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

async function openBook({ page, base }) {
  const [{ id }] = await idb(page, 'data');
  await page.goto(`${base}/b?id=${id}`);
  await page.waitForSelector('.book-content p', { timeout: 40000 });
  await sleep(3000);
}

const setVisible = (page, visible) =>
  page.evaluate((visible) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (visible ? 'visible' : 'hidden')
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);

/** Reads with the tracker on, then hides the page, which saves and uploads. */
async function readAndUpload({ page }) {
  await sleep(3000);
  await page.keyboard.press('ArrowLeft');
  await sleep(3000);
  await page.keyboard.press('p');
  await sleep(1500);
  await setVisible(page, false);
  await sleep(3000);
  await setVisible(page, true);
}

const dayPattern = (day) =>
  new RegExp(`${day}|${+day.slice(5, 7)}/${+day.slice(8)}/|${day.slice(5, 7)}/${day.slice(8)}/`);
const dayRow = (page, day) => page.locator('tr', { hasText: dayPattern(day) });

async function openStatistics({ page, base }) {
  await page.goto(`${base}/statistics`);
  await sleep(2500);
}

const todayOf = (page) =>
  page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
const localRow = async (page, day) =>
  (await idb(page, 'statistic')).find((r) => r.title === TITLE && r.dateKey === day);
const waiting = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('syncWaiting') || '[]'));

const D1 = '2026-03-01';
const D2 = '2026-03-02';
const D3 = '2026-03-03';

// A client ID that changed: the token must go, the library and its way back stay.
async function deadToken() {
  const drive = fakeDrive();
  drive.state.refreshError = 'invalid_client';
  const dev = await device(drive, {
    viewport: { width: 390, height: 844 },
    ls: { lastStorageSource: 'gdrive' }
  });
  const { page } = dev;
  await sleep(1500);
  check(
    'dead token: deleted',
    !(await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY))
  );
  check(
    'dead token: Drive stays the source',
    (await page.evaluate(() => localStorage.getItem('lastStorageSource'))) === 'gdrive'
  );
  check(
    'dead token: the header asks',
    await page.getByRole('button', { name: 'Sign in to Drive again' }).isVisible()
  );
  check(
    'dead token: the library says why',
    await page.getByRole('heading', { name: 'Sign in to see your Drive library' }).isVisible()
  );
  check('dead token: no error dialog', !(await page.getByText('An Error occured').count()));
  await page.screenshot({ path: join(shots, 'dead-token-phone.png') });
  await dev.context.close();
}

// A refused send on a phone: the reason, not only the two words.
async function failedReason() {
  const drive = fakeDrive();
  const dev = await device(drive, { viewport: { width: 390, height: 844 } });
  const { page, base } = dev;
  await importBook(dev);
  await holdDays(dev, [stat(D1, Date.now())]);
  drive.state.failUploads = true;
  await page.evaluate((entry) => {
    localStorage.setItem('syncWaiting', JSON.stringify([entry]));
    localStorage.setItem('lastStorageSource', 'gdrive');
  }, `ttu-gdrive-default\tstatistic\t${TITLE}`);
  await page.goto(`${base}/manage`);
  const button = page.getByRole('button', { name: 'Sync failed' });
  await button.waitFor({ timeout: 20000 });
  check('failed: a button, not a link away', true);
  await page.screenshot({ path: join(shots, 'failed-header-phone.png') });
  await button.click();
  const reason = await page
    .locator('p', { hasText: /\S/ })
    .filter({ hasText: /403|refused|Status/ })
    .first()
    .textContent({ timeout: 5000 })
    .catch(() => '');
  check('failed: the reason shows on tap', !!reason, reason);
  await page.screenshot({ path: join(shots, 'failed-dialog-phone.png') });
  await dev.context.close();
}

// Docker with a Drive source had no indicator at all.
async function dockerDrive() {
  const drive = fakeDrive();
  const dev = await device(drive, {
    base: SERVER,
    ls: { lastStorageSource: 'gdrive', syncLastSync: String(Date.now()) }
  });
  await sleep(1500);
  check(
    'docker drive: header shows the status',
    await dev.page.getByRole('link', { name: /^Synced / }).isVisible()
  );
  await dev.page.screenshot({ path: join(shots, 'docker-drive.png') });
  await dev.context.close();
}

// A deletion with no way through waits in the list; days pulled by a correction show at once.
async function corrections() {
  const drive = fakeDrive();
  const now = Date.now();
  const dev = await device(drive);
  const { page } = dev;
  await importBook(dev);
  await holdDays(dev, [stat(D1, now - 3 * DAY), stat(D2, now - 2 * DAY)]);
  drive.writeDays([stat(D1, now - 3 * DAY), stat(D2, now - 2 * DAY), stat(D3, now - DAY)]);

  await openStatistics(dev);
  await dayRow(page, D1).first().getByRole('button', { name: 'Delete' }).click({ timeout: 15000 });
  await sleep(3500);
  check(
    'correction: a day pulled by it shows without a reload',
    (await dayRow(page, D3).count()) > 0
  );

  drive.state.failAll = true;
  await dayRow(page, D2).first().getByRole('button', { name: 'Delete' }).click({ timeout: 15000 });
  await sleep(3500);
  await page
    .getByRole('button', { name: 'Close' })
    .click({ timeout: 3000 })
    .catch(() => {});
  check(
    'correction: failed one is queued',
    (await waiting(page)).includes(`ttu-gdrive-default\tstatistic\t${TITLE}`)
  );

  drive.state.failAll = false;
  const before = drive.days().time;
  await setVisible(page, false);
  await setVisible(page, true);
  await sleep(4000);
  check('correction: the list empties once sent', !(await waiting(page)).length);
  check('correction: it reached Drive', drive.days().time > before);
  await dev.context.close();
}

// Pulled a row from a device with a fast clock: reading here must still upload.
async function futureRow() {
  const drive = fakeDrive();
  const future = Date.now() + DAY;
  const dev = await device(drive, { tracker: true });
  await importBook(dev);
  const today = await todayOf(dev.page);
  drive.writeDays([stat(D1, future)]);
  await openBook(dev);
  await readAndUpload(dev);
  const { time, rows } = drive.days();
  check('future row: the file time rose above it', time > future, `${time - future}`);
  check('future row: the reading got there', rows.get(today)?.readingTime > 0);
  await dev.context.close();
}

// Hidden for 15 s while another device read: this tab must take their count before its next save.
async function shortReturn() {
  const drive = fakeDrive();
  const dev = await device(drive, { tracker: true });
  const { page } = dev;
  await importBook(dev);
  const today = await todayOf(page);
  await openBook(dev);
  await readAndUpload(dev);
  await setVisible(page, false);
  await sleep(500);
  drive.writeDays([stat(today, Date.now(), 5000, 600)]);
  await sleep(14000);
  await setVisible(page, true);
  await sleep(4000);
  const row = await localRow(page, today);
  check('short return: took the other device', row?.readingTime >= 600, `${row?.readingTime}`);
  await dev.context.close();
}

// Every day deleted, today's among them: opening the book must not write over today's deletion.
async function zeroRow() {
  const drive = fakeDrive();
  const dev = await device(drive);
  await importBook(dev);
  const today = await todayOf(dev.page);
  const gone = {
    ...stat(today, Date.now(), 0, 0),
    minReadingSpeed: 0,
    altMinReadingSpeed: 0,
    lastReadingSpeed: 0,
    maxReadingSpeed: 0,
    deleted: true
  };
  await holdDays(dev, [gone]);
  await openBook(dev);
  const row = await localRow(dev.page, today);
  check('zero row: the deletion stands', row?.deleted === true, JSON.stringify(row));
  check('zero row: same time', row?.lastStatisticModified === gone.lastStatisticModified);
  await dev.context.close();
}

/*
 * Tracker baseline: before each statistics upload the tab reads today's row and, when another device
 * wrote it since this tab last synced, sends theirs plus what this tab read since. Ways it could fail:
 * - double counting: the same seconds added at every upload, or after an upload reported as failed;
 * - a failed read: the tab's reading lost, or added twice once reads work again;
 * - midnight: yesterday's count carried into today, or today's other device dropped;
 * - offline: reading done meanwhile lost, or the other device's count lost on the way back;
 * - a deleted day: the deletion ignored (their old count comes back) or this tab's new reading lost;
 * - a manual correction elsewhere: the corrected count replaced by this tab's higher one.
 */
const sumNear = (actual, expected, slack = 15) => actual >= expected && actual <= expected + slack;

// The tab reads, with an upload every time this is called. Reader's own 60 s wait is skipped by
// hiding the page, which saves and uploads at once; the tab that stays visible uses the same path.
async function upload({ page }) {
  await sleep(2500);
  await setVisible(page, false);
  await sleep(2500);
  await setVisible(page, true);
  await sleep(500);
}

async function readingTab(drive) {
  const dev = await device(drive, { tracker: true });

  await importBook(dev);

  const today = await todayOf(dev.page);

  await openBook(dev);
  await upload(dev);

  return { dev, today };
}

const driveRow = (drive, today) => drive.days().rows.get(today);

// Failure this proves fixed: a tab that returns within 10 s replaced the other device's count.
async function baselineOtherDevice() {
  const drive = fakeDrive();
  const { dev, today } = await readingTab(drive);

  // Their row already holds what this tab sent (they pulled it): only the reading since is added.
  drive.writeDays([stat(today, Date.now(), 5000, 600)]);
  await upload(dev);

  const row = driveRow(drive, today);

  check(
    'baseline: their 600 s stay on Drive, plus the reading since',
    row.readingTime > 600 && row.readingTime <= 620,
    `${row.readingTime}`
  );
  check('baseline: their characters stay', row.charactersRead >= 5000, `${row.charactersRead}`);

  const here = await localRow(dev.page, today);

  check('baseline: the tab has the sum too', here.readingTime >= row.readingTime);

  // Double counting: more uploads with nobody else writing only add this tab's own seconds.
  const before = row.readingTime;
  const started = Date.now();

  await upload(dev);
  await upload(dev);

  const after = driveRow(drive, today).readingTime;
  const elapsed = (Date.now() - started) / 1000;

  check(
    'baseline: later uploads add only the time since',
    sumNear(after, before, elapsed + 5),
    `${before} -> ${after} in ${elapsed} s`
  );
  check('baseline: no second file', drive.statisticsFiles() === 1);
  await dev.context.close();
}

// Two real tabs in two browsers, both reading: neither overwrites the other, nobody counts twice.
async function baselineTwoDevices() {
  const drive = fakeDrive();
  const one = await readingTab(drive);
  const other = await device(drive, { tracker: true });

  await importBook(other);
  await openBook(other);

  const started = Date.now();

  await upload(other);
  await upload(one.dev);
  await upload(other);
  await upload(one.dev);

  const seconds = (Date.now() - started) / 1000;
  const row = driveRow(drive, one.today);

  // Both tabs tick all the time: at most twice the elapsed time plus what the first had before.
  check(
    'two devices: the row holds both',
    row.readingTime >= seconds * 1.5 && row.readingTime <= seconds * 2 + 30,
    `${row.readingTime} s in ${seconds} s`
  );
  await one.dev.context.close();
  await other.context.close();
}

// A refused upload that reached Drive anyway: the next read sees this tab's own row.
async function baselineLostAnswer() {
  const drive = fakeDrive();
  const { dev, today } = await readingTab(drive);

  drive.state.loseUploadAnswer = true;
  await upload(dev);
  drive.state.loseUploadAnswer = false;

  const landed = driveRow(drive, today).readingTime;
  const started = Date.now();

  await upload(dev);

  const after = driveRow(drive, today).readingTime;
  const elapsed = (Date.now() - started) / 1000;

  check(
    'lost answer: not counted twice',
    sumNear(after, landed, elapsed + 5),
    `${landed} -> ${after} in ${elapsed} s`
  );
  await dev.context.close();
}

// Reads and uploads refused for a while (offline, Drive down), and another device writes meanwhile.
async function baselineOffline() {
  const drive = fakeDrive();
  const { dev, today } = await readingTab(drive);

  drive.state.failAll = true;
  await upload(dev);
  await upload(dev);

  const waited = (await localRow(dev.page, today)).readingTime;

  check('offline: reading kept here', waited > 0, `${waited}`);

  const synced = driveRow(drive, today).readingTime;

  drive.writeDays([stat(today, Date.now(), 5000, 600)]);
  drive.state.failAll = false;
  await upload(dev);

  const row = driveRow(drive, today);

  check(
    'offline: theirs plus what this tab read while away',
    row.readingTime >= 600 + waited - synced && row.readingTime <= 600 + waited + 30,
    `${row.readingTime}, waited ${waited}, synced ${synced}`
  );
  await dev.context.close();
}

// Only the read fails, once: nothing lost and nothing added twice.
async function baselineFailedRead() {
  const drive = fakeDrive();
  const { dev, today } = await readingTab(drive);

  drive.state.failDownloads = true;
  await upload(dev);
  drive.state.failDownloads = false;

  const here = (await localRow(dev.page, today)).readingTime;

  await upload(dev);

  const row = driveRow(drive, today);

  check(
    'failed read: the reading gets there once',
    row.readingTime >= here && row.readingTime <= here + 20,
    `${row.readingTime}, here ${here}`
  );
  await dev.context.close();
}

// Another device deleted today: this tab's reading since stays, the old count doesn't come back.
async function baselineDeleted() {
  const drive = fakeDrive();
  const { dev, today } = await readingTab(drive);
  const old = driveRow(drive, today).readingTime;

  drive.writeDays([
    {
      ...stat(today, Date.now(), 0, 0),
      minReadingSpeed: 0,
      altMinReadingSpeed: 0,
      lastReadingSpeed: 0,
      maxReadingSpeed: 0,
      deleted: true
    }
  ]);

  const started = Date.now();

  await upload(dev);

  const row = driveRow(drive, today);
  const elapsed = (Date.now() - started) / 1000;

  check(
    'deleted day: only the reading since',
    row.readingTime > 0 && row.readingTime <= elapsed + 5,
    `${row.readingTime} (was ${old}) in ${elapsed} s`
  );
  check('deleted day: no longer marked deleted', !row.deleted);
  await dev.context.close();
}

// A correction on another device (down from what this tab holds) stands.
async function baselineCorrection() {
  const drive = fakeDrive();
  const { dev, today } = await readingTab(drive);

  await upload(dev);

  drive.writeDays([stat(today, Date.now(), 7, 2)]);

  const started = Date.now();

  await upload(dev);

  const row = driveRow(drive, today);
  const elapsed = (Date.now() - started) / 1000;

  check(
    'correction: their 2 s plus the reading since',
    row.readingTime >= 2 && row.readingTime <= 2 + elapsed + 5,
    `${row.readingTime} in ${elapsed} s`
  );
  await dev.context.close();
}

// The day changes under an open tab: today starts from the other device's today, not from yesterday.
async function baselineMidnight() {
  const drive = fakeDrive();
  const dev = await device(drive, { tracker: true });
  const { context, page } = dev;

  await importBook(dev);

  const now = new Date();
  const lateEvening = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 40);

  await context.clock.install({ time: lateEvening });
  await openBook(dev);

  const yesterday = await todayOf(page);

  await upload(dev);

  const before = driveRow(drive, yesterday).readingTime;
  const nextDay = new Date(lateEvening.getTime() + 60_000);

  await context.clock.setSystemTime(nextDay);
  await sleep(1500);

  const today = await todayOf(page);

  check('midnight: the day did change', today !== yesterday, `${yesterday} -> ${today}`);
  drive.writeDays([
    { ...driveRow(drive, yesterday) },
    stat(today, nextDay.getTime() + 500, 5000, 600)
  ]);
  await upload(dev);

  const row = driveRow(drive, today);

  check(
    "midnight: today is theirs plus this tab's since",
    // The clock's jump counts as reading: the 40 s after midnight of the 60 s jumped, then real time.
    row.readingTime >= 640 && row.readingTime <= 640 + 20,
    `${row.readingTime}`
  );
  check(
    'midnight: yesterday stays',
    driveRow(drive, yesterday).readingTime >= before,
    `${before} -> ${driveRow(drive, yesterday).readingTime}`
  );
  await dev.context.close();
}

// Failures only: a settings write refused (on page load, this browser's settings are new to Drive)
// shows in the header, with its reason on tap. Highlights and words go through the same call.
async function failuresOnly() {
  const drive = fakeDrive();

  drive.state.failUploads = true;

  const dev = await device(drive, {
    ls: { lastStorageSource: 'gdrive', syncLastSync: String(Date.now()), theme: 'dark-theme' }
  });
  const { page } = dev;
  const button = page.getByRole('button', { name: 'Sync failed' });

  await button.waitFor({ timeout: 20000 });
  await button.click();

  const reason = await page
    .locator('p', { hasText: /403|refused/ })
    .first()
    .textContent({ timeout: 5000 })
    .catch(() => '');

  check('failures only: the reason shows', !!reason, reason);
  await page.screenshot({ path: join(shots, 'failures-only.png') });
  await dev.context.close();
}

const scenarios = {
  baselineOtherDevice,
  baselineTwoDevices,
  baselineLostAnswer,
  baselineOffline,
  baselineFailedRead,
  baselineDeleted,
  baselineCorrection,
  baselineMidnight,
  failuresOnly,
  deadToken,
  failedReason,
  dockerDrive,
  corrections,
  futureRow,
  shortReturn,
  zeroRow
};

for (const [name, run] of Object.entries(scenarios)) {
  if (only && only !== name) continue;
  console.log(`# ${name}`);
  await run().catch((error) => check(`${name} ran`, false, error.message));
}

await browser.close();
console.log(`${results.filter(Boolean).length} of ${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
