/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// End-to-end check of the reading rank's steps (reading-rank-row.svelte) with seeded statistics:
// 90 reading days of 12,000 counted characters, a word test of 12,000 words and an old-shape
// `readingRank` {tier: 5} as an older app version leaves it. Screenshots of Statistics (desktop)
// and Profile (phone), the row closed and opened, light and dark, plus the closed row
// at 320 px, 1024 px and 1600 px, are the artifact. Not in CI (a dev server, Chromium).
//
//   cd apps/web && VITE_EDITION=standalone pnpm exec vite dev --port 5182 &
//   BASE_URL=http://localhost:5182 node scripts/rank.e2e.mjs        (OUT=<dir> for the shots)
//
// It fails when: the old tier isn't read as 英雄 III (a lower step, or the old "5 英雄" badge);
// `readingRankStep` isn't written as step 13, or the old tier is rewritten as anything but 5; a
// lower old tier (an older device) or unmet books pull the step down, or the tier is left below 5; the closed row lacks the next step's estimate
// ("勇者 I in about 3 months": characters at 12,000 a day are the slowest) or any of the four
// tracks; the nearest track isn't Days; the opened sheet lacks a requirement's have/need and
// estimate or the current step's row in the table; a track's label and figures overlap; the
// page has errors.

/* global console, document, indexedDB, localStorage, process -- Node, and the page inside page.evaluate */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:5182';
const out = process.env.OUT ?? join(tmpdir(), 'chimi-rank-e2e');

mkdirSync(out, { recursive: true });

const step = (text) => console.log(`- ${text}`);
const fail = (text) => {
  throw new Error(text);
};
const expect = (ok, text) => ok || fail(text);

/** 90 days of reading up to today, 12,000 characters in 20 minutes each (all counted). */
const seedStatistics = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('books');

        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('statistic', 'readwrite');
          const store = tx.objectStore('statistic');
          const key = (date) =>
            `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;

          for (let i = 0; i < 90; i += 1) {
            const date = new Date();

            date.setDate(date.getDate() - i);
            store.put({
              title: 'Seeded book',
              dateKey: key(date),
              charactersRead: 12_000,
              readingTime: 1200,
              minReadingSpeed: 600,
              altMinReadingSpeed: 600,
              lastReadingSpeed: 600,
              maxReadingSpeed: 600,
              lastStatisticModified: Date.now()
            });
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      })
  );

const stored = (page, key) =>
  page.evaluate((name) => JSON.parse(localStorage.getItem(name) ?? 'null'), key);

async function run(name, path, options, widths = []) {
  const browser = await chromium.launch();
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  const rank = page.locator('details.rank').first();
  const shot = (what) => rank.screenshot({ path: join(out, `${name}-${what}.png`) });

  page.on('pageerror', (error) => errors.push(error.message));

  try {
    step(`${name}: seed an older app's tier 5, a word test and 90 reading days`);
    await page.goto(`${base}${path}`);
    await page.waitForLoadState('networkidle');
    await page.evaluate((now) => {
      localStorage.setItem('readingRank', JSON.stringify({ tier: 5, at: now - 30 * 86_400_000 }));
      localStorage.removeItem('readingRankStep');
      // Past the standalone first run (where books live).
      localStorage.setItem('storageChosen', '1');
      localStorage.setItem(
        'placementResults',
        JSON.stringify([
          { mode: 'yesno', date: now - 60 * 86_400_000, cutoff: 12_000, length: 40, words: 12_000 }
        ])
      );
    }, Date.now());
    await seedStatistics(page);

    step(`${name}: the old tier reads as 英雄 III with the next step's estimate`);
    await page.reload();
    await rank.waitFor();
    const summary = rank.locator('summary');

    await summary.getByText('勇者 I in about 3 months').waitFor({ timeout: 30_000 });
    expect(
      (await rank.locator('summary .rank-badge').innerText()).replace(/\s+/g, ' ') === '英雄 III',
      `${name}: badge ${await rank.locator('summary .rank-badge').innerText()}`
    );
    expect(
      JSON.stringify((await stored(page, 'readingRankStep'))?.step) === '13',
      `${name}: readingRankStep ${JSON.stringify(await stored(page, 'readingRankStep'))}`
    );
    expect((await stored(page, 'readingRank'))?.tier === 5, `${name}: the old tier changed`);
    for (const label of ['Characters', 'Words', 'Days', 'Books']) {
      await summary.locator('.rank-track-label', { hasText: label }).waitFor();
    }
    expect(
      (await summary.locator('.rank-track-near .rank-track-label').innerText()) === 'Days',
      `${name}: the nearest track isn't Days`
    );

    step(`${name}: no track's label runs into its figures`);
    const overlaps = await page.evaluate(
      () =>
        [...document.querySelectorAll('summary .rank-track-head')].filter((head) => {
          const [label, value] = [...head.children].map((child) => child.getBoundingClientRect());

          return label.top === value.top && label.right > value.left;
        }).length
    );
    expect(overlaps === 0, `${name}: ${overlaps} tracks overlap`);
    await shot('closed');

    step(`${name}: opened, each requirement with its estimate, and the step table`);
    await summary.click();
    for (const line of [
      'Characters read: 1,080,000 of 2,100,000 · about 3 months',
      'Words known: 12,000 of 11,400',
      'Reading days: 90 of 120 · about 4 weeks',
      'Books at level 7.2+ with 95% known: 0 of 3 · 3 more books'
    ]) {
      await rank.locator('.rank-reqs li', { hasText: line }).waitFor({ timeout: 5000 });
    }
    expect(
      (await rank.locator('.rank-table tr[aria-current] th').innerText()).includes('III'),
      `${name}: the current row isn't 英雄 III`
    );
    expect(
      (await rank.locator('.rank-table tbody tr').count()) === 19,
      `${name}: the table hasn't 19 steps`
    );
    await shot('open');

    step(`${name}: an older app's lower tier and the missing books don't pull the step down`);
    await page.evaluate(() => {
      localStorage.setItem('readingRank', JSON.stringify({ tier: 3, at: 0 }));
    });
    await page.reload();
    await rank
      .locator('summary')
      .getByText('勇者 I in about 3 months')
      .waitFor({ timeout: 30_000 });
    expect(
      (await rank.locator('summary .rank-badge').innerText()).replace(/\s+/g, ' ') === '英雄 III',
      `${name}: dropped to ${await rank.locator('summary .rank-badge').innerText()}`
    );
    expect((await stored(page, 'readingRank'))?.tier === 5, `${name}: the old tier stayed low`);

    step(`${name}: dark`);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await rank
      .locator('summary')
      .getByText('勇者 I in about 3 months')
      .waitFor({ timeout: 30_000 });
    await shot('closed-dark');
    await rank.locator('summary').click();
    await shot('open-dark');
    await page.screenshot({ path: join(out, `${name}-page-dark.png`), fullPage: true });

    for (const width of widths) {
      await page.emulateMedia({ colorScheme: 'light' });
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await rank
        .locator('summary')
        .getByText('勇者 I in about 3 months')
        .waitFor({ timeout: 30_000 });
      await shot(`closed-${width}`);
    }
    expect(!errors.length, `${name}: page errors:\n${errors.join('\n')}`);
    console.log(`ok: ${name}`);
  } catch (error) {
    await page.screenshot({ path: join(out, `${name}-failed.png`) }).catch(() => undefined);
    throw error;
  } finally {
    await browser.close();
  }
}

await run(
  'statistics',
  '/statistics',
  { viewport: { width: 1280, height: 900 } },
  [320, 1024, 1600]
);
await run('profile', '/profile', {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
});
console.log(`shots in ${out}`);
