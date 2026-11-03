/* global console, document, process, setTimeout, localStorage, URL, Image, window, Buffer, getComputedStyle -- Node, and the page inside evaluate */
// Drive covers through Drive's API, on a fake Drive (Playwright routes on Google's API). What could go wrong:
// - a cover still asks an image host, or the CSP still allows or blocks the wrong thing;
// - opening a big library fires a request per book, or more than a few at once;
// - blob URLs pile up as a long library scrolls by;
// - a dead token opens a sign-in or an error, or a token lands in a URL;
// - a missing cover looks different from a coverless book.
// Build: VITE_GDRIVE_CLIENT_ID=e2e VITE_GDRIVE_CLIENT_SECRET=e2e pnpm build (add VITE_EDITION=standalone for the other edition)
// node scripts/drive-covers.e2e.mjs <apps/web> <build> <screenshot dir>
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const [, , webDir, root, shots] = process.argv;
const { chromium } = createRequire(join(webDir, 'package.json'))('playwright');
const BOOKS = 600;
const CAP = 4;
const ROOT_ID = 'root-folder';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC',
  'base64'
);
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
  const file = [
    join(root, path),
    `${join(root, path)}.html`,
    join(root, path, 'index.html'),
    join(root, '404.html'),
    join(root, 'index.html')
  ].find((f) => existsSync(f) && statSync(f).isFile());
  res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** books: a list of { title, cover: 'ok' | 'missing' | 'none' } */
async function open(books, { expiresIn = 3600 } = {}) {
  const log = { media: 0, peak: 0, active: 0, noAuth: 0, tokenInUrl: 0, imageHost: 0 };
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*'
  };
  const json = (route, body) =>
    route.fulfill({
      status: 200,
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  const files = (query) => {
    const parents = [...query.matchAll(/'([^']+)' in parents/g)].map((m) => m[1]);

    if (query.includes('name = "ttu-reader-data"')) {
      return [{ id: ROOT_ID, name: 'ttu-reader-data' }];
    }
    if (parents.includes(ROOT_ID)) {
      return query.includes("mimeType='application/vnd.google-apps.folder'")
        ? books.map((book, i) => ({ id: `t${i}`, name: book.title }))
        : [];
    }
    return books.flatMap((book, i) =>
      parents.includes(`t${i}`)
        ? [
            { id: `b${i}`, name: 'bookdata_1_6_1700000000000_0_1000.json', parents: [`t${i}`] },
            ...(book.cover === 'none'
              ? []
              : [
                  {
                    id: `c${i}`,
                    name: 'cover_1_6.png',
                    parents: [`t${i}`],
                    thumbnailLink: `https://lh3.googleusercontent.com/${i}=s220`
                  }
                ])
          ]
        : []
    );
  };

  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const pages = [];
  context.on('page', (page) => pages.push(page));
  await context.route(/googleusercontent\.com/, (route) => {
    log.imageHost += 1;
    return route.abort();
  });
  await context.route(/^https:\/\/(www\.googleapis|oauth2\.googleapis)\.com\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.hostname === 'oauth2.googleapis.com') {
      return json(route, { access_token: 'e2e', expires_in: expiresIn, scope: 'drive.file' });
    }
    if (/access_token|e2e/.test(url.search)) log.tokenInUrl += 1;

    const id = url.pathname.match(/files\/([^/]+)$/)?.[1];

    if (!id) return json(route, { files: files(url.searchParams.get('q')) });
    if (!id.startsWith('c')) return route.fulfill({ status: 404, headers });
    log.media += 1;
    log.active += 1;
    log.peak = Math.max(log.peak, log.active);
    if (request.headers().authorization !== 'Bearer e2e') log.noAuth += 1;
    await sleep(40);
    log.active -= 1;
    return books[+id.slice(1)].cover === 'ok'
      ? route.fulfill({
          status: 200,
          headers: { ...headers, 'content-type': 'image/png' },
          body: PNG
        })
      : route.fulfill({ status: 404, headers, body: '{"error":{"message":"not found"}}' });
  });
  await context.addInitScript(() => {
    if (!localStorage.getItem('__seeded')) {
      localStorage.setItem('__seeded', '1');
      localStorage.setItem('storageChosen', '1');
      localStorage.setItem('oauthRefreshToken:ttu-gdrive-default', 'e2e');
      localStorage.setItem('lastStorageSource', 'gdrive');
    }
    window.__csp = [];
    window.__revoked = 0;
    document.addEventListener('securitypolicyviolation', (event) =>
      window.__csp.push(`${event.effectiveDirective} ${event.blockedURI}`)
    );
    const revoke = URL.revokeObjectURL.bind(URL);

    URL.revokeObjectURL = (url) => {
      window.__revoked += 1;
      revoke(url);
    };
  });

  const page = await context.newPage();

  await page.goto(`${BASE}/manage`);
  // The library's tab: Library in the standalone, Store in the server edition.
  await page
    .getByText(/^(Library|Store)$/)
    .first()
    .click();
  await page
    .locator('img.book-cover')
    .first()
    .waitFor({ state: 'attached', timeout: 15000 })
    .catch(async (error) => {
      await page.screenshot({ path: join(shots, 'no-library.png') });
      throw error;
    });
  await sleep(1500);
  return { context, page, log, pages };
}

const shown = (page) =>
  page
    .locator('img.book-cover')
    .evaluateAll(
      (imgs) => imgs.filter((img) => img.src.startsWith('blob:') && img.naturalWidth > 0).length
    );

const many = Array.from({ length: BOOKS }, (_, i) => ({
  title: `本${String(i).padStart(3, '0')}`,
  cover: 'ok'
}));

// A big library: covers show from the API, a few at a time, only near the screen.
{
  const { context, page, log } = await open(many);
  const first = log.media;

  check('covers: show as blobs', (await shown(page)) > 0, `${await shown(page)} shown`);
  check('covers: only near the screen', first > 0 && first < BOOKS / 4, `${first} of ${BOOKS}`);
  await page.screenshot({ path: join(shots, 'covers.png') });

  // Past the blob cache's 300, whichever element scrolls.
  await page.evaluate(async () => {
    const scrollers = [...document.querySelectorAll('*')].filter(
      (el) => el.scrollHeight > el.clientHeight + 200
    );

    for (let y = 0; y < 60000; y += 500) {
      scrollers.forEach((el) => {
        el.scrollTop = y;
      });
      await new Promise((r) => setTimeout(r, 40));
    }
  });
  await sleep(6000);
  check('covers: scrolling loads more', log.media > first, `${log.media} requests`);
  check('covers: at most a few at once', log.peak > 0 && log.peak <= CAP, `peak ${log.peak}`);
  check('covers: sent with the token', log.noAuth === 0);
  check('covers: no token in a URL', log.tokenInUrl === 0);
  check('covers: no request to the image host', log.imageHost === 0);

  const revoked = await page.evaluate(() => window.__revoked);

  check(
    'covers: blob URLs dropped are revoked',
    log.media > 300 && revoked >= log.media - 300,
    `${log.media} loaded, ${revoked} revoked`
  );

  const csp = await page.evaluate(() =>
    document.querySelector('meta[http-equiv="content-security-policy"]')?.getAttribute('content')
  );

  check('csp: applied', /img-src/.test(csp || ''));
  check('csp: no Google image host', !/googleusercontent/.test(csp || ''));
  check('csp: no violation from covers', !(await page.evaluate(() => window.__csp.length)));
  // The control: this page's CSP does refuse an image from that host.
  await page.evaluate(() => {
    new Image().src = 'https://lh3.googleusercontent.com/control';
  });
  await sleep(300);
  check(
    'csp: refuses the image host',
    (await page.evaluate(() => window.__csp.join())).includes('googleusercontent') &&
      log.imageHost === 0
  );
  await context.close();
}

// A missing cover looks like a coverless book, with no message.
{
  const { context, page, log } = await open([
    { title: 'ある', cover: 'ok' },
    { title: 'ない', cover: 'none' },
    { title: 'きえた', cover: 'missing' }
  ]);

  await sleep(1000);
  check('missing: the good one shows', (await shown(page)) === 1);
  check('missing: asked once each', log.media === 2, `${log.media}`);
  check('missing: no error dialog', !(await page.getByText('An Error occured').count()));
  // An image that never loaded would otherwise paint its alt text and broken icon over the placeholder.
  check(
    'missing: nothing painted over the placeholder',
    await page
      .locator('img.book-cover')
      .evaluateAll((imgs) =>
        imgs.every((img) => img.naturalWidth > 0 || getComputedStyle(img).opacity === '0')
      )
  );
  await page.screenshot({ path: join(shots, 'missing.png') });
  await context.close();
}

// A token past its time: covers stay quiet, even right after a click.
{
  // Renewed tokens count as expired 600 s early (storage-oauth-manager.ts), so the list works and no token is live.
  const { context, page, log, pages } = await open(many.slice(0, 20), { expiresIn: 600 });

  await page.mouse.click(700, 5);
  await page.evaluate(() => window.scrollTo(0, 400));
  await sleep(1500);
  check('expired: the library lists', (await page.locator('img.book-cover').count()) > 0);
  check('expired: no cover request', log.media === 0, `${log.media}`);
  check('expired: no sign-in pop-up', pages.length === 1, `${pages.length} pages`);
  check('expired: no error dialog', !(await page.getByText('An Error occured').count()));
  await page.screenshot({ path: join(shots, 'expired.png') });
  await context.close();
}

await browser.close();
server.close();
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
