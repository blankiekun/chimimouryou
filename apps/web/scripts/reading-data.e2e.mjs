/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// End-to-end check that reading data survives loading, reopening and other devices, against a real
// server stack with a seeded library (each scenario is a fresh browser profile, the "other device"
// is a row written through the API). The log it prints is the artifact. Not in CI (needs a stack).
//
//   BASE_URL=http://host:port E2E_USER=reader E2E_PASSWORD=... node scripts/reading-data.e2e.mjs
//   (ONLY=place|completion|today|older to run one group)
//
// It fails when:
// - place: hiding the page or pressing the bookmark key while the saved place isn't back yet sends a
//   place (continuous and paginated); the place isn't back once loading ends; a real return to the
//   book's start isn't saved;
// - completion: reopening a finished book the same day drops the finished flag from today's row;
// - today: a tab that was hidden over a minute overwrites what another device read today, or loses
//   what it read itself (MERGE and REPLACE);
// - older: a day only this browser holds, older than the server's newest, never reaches the server
//   (MERGE), or an upload deletes the server's other days (REPLACE).

/* global console, document, indexedDB, process, setTimeout, window, MutationObserver -- Node, and the page inside evaluate */
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:8090';
const user = process.env.E2E_USER ?? 'reader';
const password = process.env.E2E_PASSWORD ?? '';
const only = process.env.ONLY;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const check = (ok, text) => {
  results.push(!!ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
};
const until = async (read, timeout = 30_000) => {
  for (const end = Date.now() + timeout; ; await sleep(500)) {
    const value = await read();
    if (value || Date.now() > end) return value;
  }
};

const browser = await chromium.launch({
  args: [`--unsafely-treat-insecure-origin-as-secure=${base}`]
});

/** Before the app runs: `window.holdOnBookText = true` stops animation frames the moment book text is in the page. */
function holdFrames() {
  const frame = window.requestAnimationFrame.bind(window);
  const held = [];
  let holding = false;
  window.requestAnimationFrame = (callback) => {
    if (holding) {
      held.push(callback);
      return 0;
    }
    return frame(callback);
  };
  window.releaseFrames = () => {
    holding = false;
    held.splice(0).forEach(frame);
  };
  window.framesHeld = () => holding;
  new MutationObserver(() => {
    if (
      window.holdOnBookText &&
      document.querySelector('.book-content')?.textContent.length > 100
    ) {
      window.holdOnBookText = false;
      holding = true;
    }
  }).observe(document, { childList: true, subtree: true });
}

async function device(settings = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const sent = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && /\/progress$/.test(request.url())) {
      sent.push(JSON.parse(request.postData()).data.exploredCharCount);
    }
  });
  page.on('pageerror', (error) => console.log(`pageerror: ${error.message}`));
  await page.addInitScript(holdFrames);
  await page.goto(`${base}/version.txt`);
  await page.evaluate(
    (all) => {
      Object.entries(all).forEach(([key, value]) => window.localStorage.setItem(key, value));
    },
    { libraryTab: 'store', ...settings }
  );
  const status = await page.evaluate(
    ([username, secret]) =>
      window
        .fetch('/account/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password: secret })
        })
        .then((response) => response.status),
    [user, password]
  );
  if (status !== 200) throw new Error(`login failed: ${status}`);
  return { context, page, sent };
}

const api = (page, path, method = 'GET', body = undefined) =>
  page.evaluate(
    async ([url, verb, data]) => {
      const response = await window.fetch(url, {
        method: verb,
        headers: { 'Content-Type': 'application/json' },
        body: data ? JSON.stringify(data) : undefined
      });
      if (!response.ok) throw new Error(`${verb} ${url}: ${response.status}`);
      return response.json();
    },
    [`/api/v1/${path}`, method, body]
  );

async function bookId(page, title) {
  const { books } = await api(page, `books?q=${encodeURIComponent(title)}&limit=5`);
  const book = books.find((entry) => entry.title === title);
  if (!book) throw new Error(`no book ${title}`);
  return book.id;
}

const dayRow = (page, id, dateKey) =>
  api(page, 'sync?since=0').then(({ statistics }) =>
    statistics.find((row) => row.book === id && row.dateKey === dateKey)
  );
const placeRow = (page, id) =>
  api(page, 'sync?since=0').then(({ progress }) => progress.find((row) => row.book === id));

const statistic = (title, dateKey, readingTime, charactersRead, modified, extra = {}) => ({
  title,
  dateKey,
  readingTime,
  charactersRead,
  minReadingSpeed: 0,
  altMinReadingSpeed: 0,
  lastReadingSpeed: 0,
  maxReadingSpeed: 0,
  lastStatisticModified: modified,
  ...extra
});
const putDay = (page, id, row) =>
  api(page, `books/${id}/statistics/${row.dateKey}`, 'PUT', {
    modified: row.lastStatisticModified,
    data: row
  });

const todayKey = (page) =>
  page.evaluate(() => {
    const now = new Date();
    const pad = (value) => `${value}`.padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  });

/** What the browser's database holds for the book's day. */
const localDay = (page, title, dateKey) =>
  page.evaluate(
    ([bookTitle, key]) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('books');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result
            .transaction('statistic')
            .objectStore('statistic')
            .get([bookTitle, key]);
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            open.result.close();
            resolve(get.result);
          };
        };
      }),
    [title, dateKey]
  );

const putLocalDay = (page, row) =>
  page.evaluate(
    (data) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('books');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(['statistic', 'lastModified'], 'readwrite');
          tx.objectStore('statistic').put(data);
          tx.objectStore('lastModified').put({
            title: data.title,
            dataType: 'statistic',
            lastModifiedValue: data.lastStatisticModified
          });
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    row
  );

/** The app's own view of visibility: a real hidden page can't be driven or screenshotted. */
const setVisibility = (page, state) =>
  page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { value, configurable: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
  }, state);

async function openBook(page, title, hold = false) {
  await page.goto(`${base}/manage`);
  if (hold) await page.evaluate(() => (window.holdOnBookText = true));
  await page.locator('.library-card-main', { hasText: title }).first().click({ timeout: 30_000 });
  await page.locator('.details-actions .app-button-primary').first().click({ timeout: 30_000 });
  await page.waitForURL(/\/b\?/, { timeout: 30_000 });
}

/** The place in the reader's own words: the header's percent isn't exact, the saved count is. */
const settled = async (page) => {
  await page.waitForFunction(
    () => document.querySelector('.book-content')?.textContent.length > 100,
    null,
    {
      timeout: 60_000
    }
  );
  await sleep(3000);
};

async function place(viewMode) {
  console.log(`\nplace, ${viewMode}`);
  const title = viewMode === 'paginated' ? 'こころ' : '坊っちゃん';
  const { context, page, sent } = await device({ viewMode, autoBookmarkTime: '1' });
  const id = await bookId(page, title);
  const saved = 20_000;
  const modified = Date.now();

  await api(page, `books/${id}/progress`, 'PUT', {
    modified,
    progress: 0.2,
    data: { dataId: id, exploredCharCount: saved, progress: 0.2, lastBookmarkModified: modified }
  });

  await openBook(page, title, true);
  await until(() => page.evaluate(() => window.framesHeld()), 60_000);
  check(await page.evaluate(() => window.framesHeld()), 'the page is held with book text in it');

  await page.keyboard.press('b');
  await setVisibility(page, 'hidden');
  await sleep(2000);
  await setVisibility(page, 'visible');
  await sleep(1500);
  let row = await placeRow(page, id);
  check(
    row.modified === modified,
    `no place sent while loading (server's count ${row.data.exploredCharCount})`
  );
  check(
    sent.every((count) => count > saved / 2),
    `no near-start PUT while loading (${sent.join(', ') || 'none'})`
  );

  await page.evaluate(() => window.releaseFrames());
  await sleep(5000);
  await setVisibility(page, 'hidden');
  await sleep(3000);
  row = await placeRow(page, id);
  check(
    Math.abs(row.data.exploredCharCount - saved) < 2000,
    `the place came back and hiding keeps it (${row.data.exploredCharCount})`
  );
  await setVisibility(page, 'visible');

  // A real return to the start, by the reader's own moves.
  if (viewMode === 'paginated') {
    const low = 1500;
    const when = Date.now();
    await api(page, `books/${id}/progress`, 'PUT', {
      modified: when,
      progress: 0.01,
      data: { dataId: id, exploredCharCount: low, progress: 0.01, lastBookmarkModified: when }
    });
    await page.close();
    const again = await context.newPage();
    await again.goto(`${base}/manage`);
    await again
      .locator('.library-card-main', { hasText: title })
      .first()
      .click({ timeout: 30_000 });
    await again.locator('.details-actions .app-button-primary').first().click({ timeout: 30_000 });
    await settled(again);
    for (let round = 0; round < 15 && row.data.exploredCharCount >= 100; round += 1) {
      for (let turn = 0; turn < 5; turn += 1) {
        await again.keyboard.press('ArrowRight');
        await sleep(500);
      }
      await sleep(2000);
      await setVisibility(again, 'hidden');
      await sleep(2000);
      await setVisibility(again, 'visible');
      row = await placeRow(again, id);
      console.log(`     paged back to ${row.data.exploredCharCount}`);
    }
    check(
      row.data.exploredCharCount < 100,
      `paging back to the start is saved (${row.data.exploredCharCount})`
    );
  } else {
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(2500);
    await setVisibility(page, 'hidden');
    await sleep(3000);
    row = await placeRow(page, id);
    check(
      row.data.exploredCharCount < 100,
      `scrolling back to the start is saved (${row.data.exploredCharCount})`
    );
  }
  await context.close();
}

async function completion() {
  console.log('\ncompletion');
  const title = '走れメロス';
  const { context, page } = await device();
  const id = await bookId(page, title);
  const key = await todayKey(page);
  const completedData = { dateKey: key, charactersRead: 1, readingTime: 1 };

  await putDay(
    page,
    id,
    statistic(title, key, 100, 1000, Date.now(), { completedBook: 1, completedData })
  );
  await openBook(page, title);
  await settled(page);
  await sleep(14_000); // past the tracker's first save (every 10 s)
  const row = await localDay(page, title, key);
  check(row?.readingTime > 100, `the tracker is counting (${row?.readingTime} s)`);
  check(
    row?.completedBook === 1 && !!row?.completedData,
    'today stays finished after the tracker writes it'
  );
  await setVisibility(page, 'hidden');
  const server = await until(async () => {
    const stored = await dayRow(page, id, key);
    return stored?.data.readingTime > 100 ? stored : undefined;
  });
  check(server?.data.completedBook === 1, 'the server keeps the flag');
  await context.close();
}

async function today(mode) {
  console.log(`\ntoday, ${mode}`);
  const title = mode === 'merge' ? '三四郎' : '銀河鉄道の夜';
  const { context, page } = await device({ statisticsMergeMode: mode });
  const id = await bookId(page, title);
  const key = await todayKey(page);

  await openBook(page, title);
  await settled(page);
  await sleep(14_000);
  const before = (await localDay(page, title, key))?.readingTime ?? 0;
  await setVisibility(page, 'hidden');
  await sleep(5000);
  // The other device reads meanwhile: 20 minutes more than this tab knows.
  const planted = before + 1200;
  await putDay(page, id, statistic(title, key, planted, 5000, Date.now()));
  await sleep(58_000);
  await setVisibility(page, 'visible');
  await sleep(16_000);
  const local = await localDay(page, title, key);
  check(
    local?.readingTime >= planted,
    `this tab took the other device's time (${before} -> ${local?.readingTime})`
  );
  check(local?.charactersRead >= 5000, `and its characters (${local?.charactersRead})`);
  await setVisibility(page, 'hidden');
  const server = await until(async () => {
    const stored = await dayRow(page, id, key);
    return stored?.data.readingTime > planted ? stored : undefined;
  });
  check(
    server?.data.readingTime > planted,
    `the server has both devices' time (${server?.data.readingTime})`
  );
  await context.close();
}

async function older(mode) {
  console.log(`\nolder, ${mode}`);
  const title = mode === 'merge' ? '人間失格' : '坊っちゃん';
  // No tracker: its own new row would hide what's tested.
  const { context, page } = await device({
    statisticsMergeMode: mode,
    trackerStartOnOpen: 'false'
  });
  const id = await bookId(page, title);
  const run = Date.now() % 28;
  const monday = `2021-01-${`${run + 1}`.padStart(2, '0')}`;
  const tuesday = `2021-02-${`${run + 1}`.padStart(2, '0')}`;
  const now = Date.now();

  // A first open makes the database and copies the book, then this browser "reads offline".
  await openBook(page, title);
  await settled(page);
  await page.goto(`${base}/manage`);
  await putLocalDay(page, statistic(title, monday, 600, 1000, now - 86_400_000));
  await putDay(page, id, statistic(title, tuesday, 300, 500, now));
  await openBook(page, title);
  await settled(page);
  const local = await localDay(page, title, monday);
  await setVisibility(page, 'hidden');
  await sleep(6000);
  const onServer = await dayRow(page, id, monday);
  const other = await dayRow(page, id, tuesday);

  if (mode === 'merge') {
    check(!!local, 'the pull keeps the day only this browser has');
    check(
      onServer?.data.readingTime === 600,
      `that day reached the server (${onServer?.data.readingTime})`
    );
  } else {
    check(!local, "REPLACE: the pull takes the server's list");
    check(!onServer, 'REPLACE: nothing older was uploaded');
  }
  check(other?.data.readingTime === 300 && !other.deleted, "the server's newer day is untouched");
  await context.close();
}

const groups = {
  place: async () => {
    await place('continuous');
    await place('paginated');
  },
  completion,
  today: () => Promise.all([today('merge'), today('replace')]),
  older: async () => {
    await older('merge');
    await older('replace');
  }
};

try {
  for (const [name, run] of Object.entries(groups)) {
    if (!only || only === name) await run();
  }
} finally {
  await browser.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
