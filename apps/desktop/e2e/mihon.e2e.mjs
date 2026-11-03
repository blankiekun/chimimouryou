/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// End-to-end check of Mihon extensions (mihon.js, apps/mihon-host): the real app, the real host and
// keiyoushi's real Rawkuma jar, against the invented rawkuma.net of
// server/tests/fixtures/sources/mihon.py. That file runs an https proxy the app and the host both
// go through: rawkuma.net and repo.example end there (a test CA the JVM trusts through
// CHIMI_MIHON_JVM_ARGS; Electron runs with --ignore-certificate-errors), anything else is tunnelled,
// so Turn on really downloads the pinned Java runtime (about 50 MB). Not in CI (needs a display,
// python3 and openssl; the host's jars from `./gradlew :desktop:installDist` in apps/mihon-host).
//
//   cd apps/desktop && pnpm run fetch && pnpm run build:web
//   xvfb-run -a node e2e/mihon.e2e.mjs        (E2E_DIR=<dir> keeps the run's files there)
//
// It fails when: Settings has no Mihon section or Turn on doesn't end in a runtime that passed its
// pin; the index.pb isn't read (no Rawkuma, or not runnable); the jar isn't downloaded, pinned or
// loaded into the host, or its source id doesn't match the index's (the host's ids against
// mihon-index.ts' 64-bit strings); Popular doesn't list the fixture's series (the nonce form and
// advanced_search, then wp-json); the work page doesn't show its chapters (memo / chapter_list);
// following it doesn't put one CBZ with all 6 pages, in chapter order, into the library; a page
// crosses into the app (any page error); a failed Update (the jar is gone) changes the pin or
// removes the old jar, or the source stops listing; a good Update leaves anything but the new jar
// under its own hash, or the running host (which loaded the old jar) stops answering; removing a
// repository deletes a jar another repository still holds, or leaves its jar behind once none does,
// or the host running that jar stops answering; an extension's fetch (refuseNonPublic) reaches a
// private address, a name that doesn't resolve, or refuses a public address.

/* global indexedDB, localStorage, window -- used inside page.evaluate */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const desktop = join(import.meta.dirname, '..');
const { _electron } = createRequire(join(desktop, '../web/package.json'))('playwright');
const fixture = join(desktop, '../../server/tests/fixtures/sources/mihon.py');
const root = process.env.E2E_DIR ?? mkdtempSync(join(tmpdir(), 'chimi-mihon-'));
const tls = join(root, 'tls');
const timeout = 300_000;
const origin = 'http://127.0.0.1:41917';

const step = (text) => console.log(`- ${text}`);
const fail = (text) => {
  throw new Error(text);
};

// The JVM and Electron together: don't start on a machine that's already short.
const available = Number(/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))[1]);
if (available < 2.5 * 1024 * 1024) fail(`MemAvailable ${Math.round(available / 1024)} MB < 2.5 GB`);

// The app serves its pages on a fixed port: another copy running (another E2E) hangs the launch.
const busy = await new Promise((resolve) =>
  connect(41917, '127.0.0.1')
    .once('connect', function () {
      this.destroy();
      resolve(true);
    })
    .once('error', () => resolve(false))
);
if (busy) fail('Port 41917 is in use: another copy of the app (or E2E) is running');

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

const proxy = spawn('python3', [fixture, tls], { stdio: ['ignore', 'pipe', 'inherit'] });
process.on('exit', () => proxy.kill());
const port = await new Promise((resolve, reject) => {
  proxy.once('exit', (code) => reject(new Error(`mihon.py exited (${code})`)));
  createInterface({ input: proxy.stdout }).once('line', (line) => resolve(line.split(' ')[1]));
});

const app = await _electron.launch({
  executablePath: join(desktop, 'node_modules/electron/dist/electron'),
  args: [
    '--no-sandbox',
    desktop,
    `--proxy-server=http://127.0.0.1:${port}`,
    '--ignore-certificate-errors'
  ],
  env: {
    ...process.env,
    XDG_CONFIG_HOME: join(root, 'config'),
    // mihon.py's own proxy for the host, its CA as the trust store; 127.0.0.1 is the proxy's address.
    CHIMI_MIHON_JVM_ARGS: [
      '-Dhttps.proxyHost=127.0.0.1',
      `-Dhttps.proxyPort=${port}`,
      '-Dmihon.testHosts=127.0.0.1',
      `-Djavax.net.ssl.trustStore=${join(tls, 'ca.p12')}`,
      '-Djavax.net.ssl.trustStoreType=PKCS12',
      '-Djavax.net.ssl.trustStorePassword=chimi-e2e'
    ].join(' ')
  }
});

/** The library's books whose title starts with `prefix`, with their page names. */
const books = (page, prefix) =>
  page.evaluate(
    (wanted) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('books');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction('data').objectStore('data').getAll();
          request.onsuccess = () =>
            resolve(
              request.result
                .filter((book) => book.title?.startsWith(wanted))
                .map((book) => ({ title: book.title, pages: Object.keys(book.blobs ?? {}).sort() }))
            );
        };
      }),
    prefix
  );

const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (error) => errors.push(error.stack || error.message));
try {
  page.setDefaultTimeout(timeout);
  await page.waitForLoadState('load');
  await page.evaluate(() => localStorage.setItem('storageChosen', '1'));

  step('Settings → Mihon extensions → Turn on (downloads the pinned Java runtime)');
  await page.goto(`${origin}/settings`);
  // For a look at the section (Study Book): the warning before Turn on.
  await page.getByText('Add only repositories you trust').waitFor();
  await page.locator('#general-mihon').screenshot({ path: join(root, 'settings-mihon.png') });
  await page.getByRole('button', { name: 'Turn on' }).click();
  await page.getByRole('button', { name: 'Remove' }).waitFor();
  await page.locator('#general-mihon').screenshot({ path: join(root, 'settings-mihon-on.png') });

  step('Sources → Add a source → repository index.pb');
  await page.goto(`${origin}/sources/add?type=repo`);
  await page.getByLabel('Repository address').fill('https://repo.example/mihon/index.pb');
  await page.getByRole('button', { name: 'Look up' }).click();
  await page.getByRole('switch', { name: 'Rawkuma' }).click();
  await page.getByRole('button', { name: 'Add repository with 1 source' }).click();

  step('Browse Rawkuma: the host loads the jar and lists Popular');
  await page.waitForURL(/\/sources\/browse\?ext=/);
  const browse = page.url();
  await page.getByRole('link', { name: 'Fixture Manga' }).first().click();

  step('The work: its chapters, then Follow');
  await page.waitForURL(/\/sources\/work/);
  await page.getByText('2 chapters').first().waitFor();
  await page.getByRole('switch', { name: 'Follow' }).click();

  step('One CBZ of both chapters in the library');
  let found = [];
  for (let tries = 0; tries < 120 && !found.length; tries += 1) {
    found = await books(page, 'Fixture Manga');
    if (!found.length) await page.waitForTimeout(1000);
  }
  if (found.length !== 1) fail(`books: ${JSON.stringify(found)}`);
  const expected = ['0001-0001', '0001-0002', '0001-0003', '0002-0001', '0002-0002', '0002-0003'];
  const names = found[0].pages.map((name) => name.replace(/\.png$/, ''));
  if (JSON.stringify(names) !== JSON.stringify(expected))
    fail(`${found[0].title} has pages ${found[0].pages}`);

  const ext = join(await app.evaluate(({ app: main }) => main.getPath('userData')), 'mihon/ext');
  const jars = () => readdirSync(ext);
  const [first, ...more] = jars();
  if (more.length) fail(`jars before Update: ${jars()}`);
  // The index says the row is behind, so Update is offered.
  const repoId = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('chimi-sources');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const rows = open.result.transaction('extensions', 'readwrite').objectStore('extensions');
          const all = rows.getAll();
          all.onsuccess = () => {
            const [row] = all.result;
            rows.put({ ...row, version: '1.6.42' }).onsuccess = () => resolve(row.repo);
          };
        };
      })
  );
  const stillLists = async () => {
    await page.goto(browse);
    await page.getByRole('link', { name: 'Fixture Manga' }).first().waitFor();
  };

  step('Update fails (the jar is gone): the old jar stays and the source still lists');
  writeFileSync(join(tls, 'jar-missing'), '');
  await page.goto(`${origin}/sources/add?repo=${repoId}`);
  const update = page.getByRole('button', { name: 'Update to v1.6.43' });
  await update.click();
  await page.getByText('HTTP 404').waitFor();
  if (jars().join() !== first) fail(`jars after a failed Update: ${jars()}`);
  await stillLists();

  step('Update: only the new jar is left, and the host that loaded the old one still answers');
  rmSync(join(tls, 'jar-missing'));
  writeFileSync(join(tls, 'jar-updated'), '');
  await page.goto(`${origin}/sources/add?repo=${repoId}`);
  await update.click();
  // Named "Updating…" meanwhile.
  await page.getByRole('button', { name: /^Updat/ }).waitFor({ state: 'detached' });
  const [jar, ...others] = jars();
  if (others.length || jar === first) fail(`jars after Update: ${jars()}`);
  const hash = createHash('sha256')
    .update(readFileSync(join(ext, jar)))
    .digest('hex');
  if (`${hash}.jar` !== jar) fail(`${jar} doesn't match its hash ${hash}`);
  await stillLists();

  step('Removing: a repository that shares the jar keeps it, and the last one takes it');
  const repos = () =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('chimi-sources');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const all = open.result.transaction('repos').objectStore('repos').getAll();
            all.onsuccess = () => resolve(all.result.map((repo) => repo.id));
          };
        })
    );
  const remove = async (id) => {
    await page.goto(`${origin}/sources/add?repo=${id}`);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Remove repository' }).click();
    await page.waitForURL(/\/sources\/?$/);
  };
  const addRepository = async (address) => {
    await page.goto(`${origin}/sources/add?type=repo`);
    await page.getByLabel('Repository address').fill(address);
    await page.getByRole('button', { name: 'Look up' }).click();
    await page.getByRole('switch', { name: 'Rawkuma' }).click();
    await page.getByRole('button', { name: 'Add repository with 1 source' }).click();
    await page.waitForURL(/\/sources\/browse\?ext=/);
    await page.getByRole('link', { name: 'Fixture Manga' }).first().waitFor();
    return page.url();
  };
  // The same jars under another address (its key differs, which only Android checks).
  const mirror = await addRepository('https://repo.example/mihon/untrusted/index.pb');
  if (jars().join() !== jar) fail(`jars with two repositories: ${jars()}`);
  await remove(repoId);
  if (jars().join() !== jar) fail(`jars after removing one of two repositories: ${jars()}`);
  await page.goto(mirror);
  await page.getByRole('link', { name: 'Fixture Manga' }).first().waitFor();
  await remove((await repos())[0]);
  if (jars().length) fail(`jars after removing the last repository: ${jars()}`);

  step('The host that had the jar open still works: the repository comes back');
  await addRepository('https://repo.example/mihon/index.pb');
  if (jars().join() !== jar) fail(`jars after adding it back: ${jars()}`);

  step(
    'An extension’s fetch: refused for private addresses and failed lookups, not for public ones'
  );
  const publicFetch = (url) =>
    page.evaluate(
      (target) =>
        window.chimiDesktop.fetch(target, { publicOnly: true }).then(
          () => 'answered',
          (error) => error.message
        ),
      url
    );
  for (const url of [
    'http://127.0.0.1:9/',
    'http://localhost:9/',
    'http://10.0.0.1:9/',
    'http://192.168.0.1:9/',
    'http://[::1]:9/',
    'http://[fd00::1]:9/',
    'http://[::ffff:10.0.0.1]:9/'
  ]) {
    const answer = await publicFetch(url);
    if (!answer.includes('is not a public address')) fail(`${url}: ${answer}`);
  }
  const unknown = await publicFetch('https://no-such-host.invalid/');
  if (!unknown.includes('could not be resolved')) fail(`no-such-host.invalid: ${unknown}`);
  for (const url of [
    'https://example.com/',
    'https://1.1.1.1/',
    'https://[2606:4700:4700::1111]/'
  ]) {
    const answer = await publicFetch(url);
    if (/is not a public address|could not be resolved/.test(answer)) fail(`${url}: ${answer}`);
  }

  if (errors.length) fail(`page errors:\n${[...new Set(errors)].join('\n')}`);
  console.log(`ok: ${found[0].title}, ${names.length} pages`);
} catch (error) {
  await page.screenshot({ path: join(root, 'failed.png') }).catch(() => undefined);
  console.error(`failed (screenshot ${join(root, 'failed.png')})`);
  throw error;
} finally {
  await app.close();
  // Its pipe would keep this process running.
  proxy.kill();
}
