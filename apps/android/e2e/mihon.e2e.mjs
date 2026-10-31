/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// End-to-end check of Mihon extensions in the Android app (`github` flavor, MihonHostPlugin.kt) on a
// real phone over adb: keiyoushi's real Rawkuma apk (server/tests/fixtures/sources/mihon/, signed
// with keiyoushi's key) against the invented rawkuma.net of server/tests/fixtures/sources/mihon.py,
// the same fixture as the desktop E2E (apps/desktop/e2e/mihon.e2e.mjs). The phone reaches that
// file's https proxy through `adb reverse` and the phone's global proxy setting (restored at the
// end); debug builds trust user-installed CAs (src/debug), so the phone needs the proxy's test CA
// once: the script pushes it to Downloads and waits while you install it. Not in CI (needs a
// phone, python3 and openssl; JDK 21 and the Android SDK unless APK= is given).
//
//   cd apps/android && node e2e/mihon.e2e.mjs
//     APK=<path>     an already built github debug APK instead of building one
//     E2E_RESET=1    the app is already on the phone: reinstall it and CLEAR ITS DATA (its books)
//     E2E_DIR=<dir>  keeps the test CA there (default ~/.cache/chimimouryou-mihon-e2e)
//
// It fails when: the APK doesn't install or the WebView can't be reached; the repository whose
// signing key isn't the apk's still installs (no "isn’t signed with its repository’s key"); the
// real index.pb isn't read, or the apk isn't downloaded, signer-checked, pinned and loaded with
// DelegateLastClassLoader, or its source id doesn't match the index's; Popular doesn't list the
// fixture's series; the work page doesn't show its 2 chapters; following it doesn't put one CBZ
// with all 6 pages, in chapter order, into the library (pages read as files through
// convertFileSrc); a page crosses into the app (any page error).

/* global indexedDB, localStorage -- used inside page.evaluate */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const android = join(import.meta.dirname, '..');
const { _android } = createRequire(join(android, '../web/package.json'))('playwright');
const fixture = join(android, '../../server/tests/fixtures/sources/mihon.py');
const tls = join(process.env.E2E_DIR ?? join(homedir(), '.cache/chimimouryou-mihon-e2e'), 'tls');
const pkg = 'moe.blankie.chimireader';
const origin = 'https://chimimouryou.localhost';
const timeout = 300_000;

const step = (text) => console.log(`- ${text}`);
const fail = (text) => {
  throw new Error(text);
};
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const ask = (question) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, () => {
      rl.close();
      resolve();
    });
  });

const devices = adb('devices')
  .split('\n')
  .slice(1)
  .filter((line) => /\tdevice$/.test(line));
if (devices.length !== 1)
  fail(`Connect exactly one phone with USB debugging (adb sees ${devices.length})`);

const installed = adb('shell', 'pm', 'list', 'packages', pkg)
  .split('\n')
  .some((line) => line.trim() === `package:${pkg}`);
if (installed && process.env.E2E_RESET !== '1') {
  fail(
    `${pkg} is already on this phone. The run adds a repository and a book to it: rerun with ` +
      'E2E_RESET=1 to reinstall it and clear its data (its books are deleted), or uninstall it first.'
  );
}

let apk = process.env.APK;
if (!apk) {
  step('Building the standalone web build and the github debug APK');
  run('pnpm', ['run', 'build:web'], android);
  run('pnpm', ['run', 'sync'], android);
  run('./gradlew', ['--no-daemon', 'assembleGithubDebug'], join(android, 'android'));
  apk = join(android, 'android/app/build/outputs/apk/github/debug/app-github-debug.apk');
}
step(`Installing ${apk}`);
try {
  adb('install', '-r', apk);
} catch (error) {
  fail(
    `adb install failed (${String(error.stderr || error.message).trim()}). A release install is ` +
      'signed with another key: this debug APK can only replace it after an uninstall, which deletes its books.'
  );
}
if (installed) adb('shell', 'pm', 'clear', pkg);

const freshCa = !existsSync(join(tls, 'ca.key'));
mkdirSync(tls, { recursive: true });
const proxy = spawn('python3', [fixture, tls], { stdio: ['ignore', 'pipe', 'inherit'] });
let port = '';
const cleanUp = () => {
  for (const args of [
    ['shell', 'settings', 'put', 'global', 'http_proxy', ':0'],
    ['shell', 'settings', 'delete', 'global', 'http_proxy'],
    ...(port ? [['reverse', '--remove', `tcp:${port}`]] : [])
  ]) {
    try {
      adb(...args);
    } catch {
      // Best effort: the next one still runs.
    }
  }
  proxy.kill();
};
process.on('exit', cleanUp);
port = await new Promise((resolve, reject) => {
  proxy.once('exit', (code) => reject(new Error(`mihon.py exited (${code})`)));
  createInterface({ input: proxy.stdout }).once('line', (line) => resolve(line.split(' ')[1]));
});

if (freshCa) {
  adb('push', join(tls, 'ca.pem'), '/sdcard/Download/chimimouryou-e2e-ca.crt');
  await ask(
    "A new test CA is in the phone's Downloads (chimimouryou-e2e-ca.crt, valid 7 days). Install it: " +
      'Settings → Security & privacy → More security settings → Encryption & credentials → Install a ' +
      'certificate → CA certificate. Press Enter when done. '
  );
}

// The phone's own 127.0.0.1:<port> is the proxy here; the app reads the proxy when it starts.
adb('reverse', `tcp:${port}`, `tcp:${port}`);
adb('shell', 'settings', 'put', 'global', 'http_proxy', `127.0.0.1:${port}`);
// mihonTestHosts (debug builds only) lets the host's guard reach that loopback proxy.
adb(
  'shell',
  'am',
  'start',
  '-S',
  '-W',
  '-n',
  `${pkg}/.MainActivity`,
  '--es',
  'mihonTestHosts',
  '127.0.0.1'
);

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

const [device] = await _android.devices({ omitDriverInstall: true });
let page;
const errors = [];
try {
  const webView = await device.webView({ pkg }, { timeout: 60_000 });
  page = await webView.page();
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.setDefaultTimeout(timeout);
  await page.evaluate(() => localStorage.setItem('storageChosen', '1'));

  step('A repository whose signing key is not the apk’s: the apk is refused');
  await page.goto(`${origin}/sources/add?type=repo`);
  await page.getByLabel('Repository address').fill('https://repo.example/mihon/untrusted/index.pb');
  await page.getByRole('button', { name: 'Look up' }).click();
  await page.getByRole('switch', { name: 'Rawkuma' }).click();
  await page.getByRole('button', { name: 'Add repository with 1 source' }).click();
  await page.getByText('isn’t signed with its repository’s key').waitFor();

  step('Sources → Add a source → the real repository index.pb');
  await page.goto(`${origin}/sources/add?type=repo`);
  await page.getByLabel('Repository address').fill('https://repo.example/mihon/index.pb');
  await page.getByRole('button', { name: 'Look up' }).click();
  await page.getByRole('switch', { name: 'Rawkuma' }).click();
  await page.getByRole('button', { name: 'Add repository with 1 source' }).click();

  step('Browse Rawkuma: the host loads the apk and lists Popular');
  await page.waitForURL(/\/sources\/browse\?ext=/);
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
  if (errors.length) fail(`page errors:\n${[...new Set(errors)].join('\n')}`);
  console.log(`ok: ${found[0].title}, ${names.length} pages`);
} catch (error) {
  const shot = join(tls, '..', 'failed.png');
  await page?.screenshot({ path: shot }).catch(() => undefined);
  console.error(`failed (screenshot ${shot}; logcat: adb logcat -d | grep -i mihon)`);
  throw error;
} finally {
  await device.close();
  cleanUp();
  console.log(
    "The phone's proxy setting is restored. Remove the test CA when you are done testing: Encryption & " +
      'credentials → User credentials (or Trusted credentials → User).'
  );
}
