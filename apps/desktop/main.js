/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// chimimouryou's desktop shell: the standalone build served from a fixed loopback origin, with an
// unmodified Yomitan loaded as a Chrome extension (it is a separate GPL-3.0 program, see About).

import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  net,
  screen,
  session,
  shell
} from 'electron';
import { Blob } from 'node:buffer';
import { execFile } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs';
import { BlockList } from 'node:net';
import { release } from 'node:os';
import { join } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  cancelBrowserSignIn,
  finishBrowserSignIn,
  isSignInUrl,
  startBrowserSignIn
} from './oauth.js';
import { loadStore, registerGames, startPage } from './games.js';
import { handleJiten } from './jiten.js';
import { registerMihon } from './mihon.js';
import { serve } from './serve.js';
import { checkForUpdates } from './updater.js';

// Fixed: browser storage, the service worker, AnkiConnect's CORS check (its default
// webCorsOriginList admits http://127.0.0.1:<any port>) and OAuth redirects all key on the origin.
// http://127.0.0.1 is a secure context, and Yomitan's content scripts only match http(s) and file.
const port = 41917;
const origin = `http://127.0.0.1:${port}`;
/** The main frame only: a source extension's sandboxed frame has an app URL too. */
const isApp = (event) =>
  event.senderFrame === event.sender.mainFrame && !!event.senderFrame?.url.startsWith(`${origin}/`);
const FETCH_SILENCE_MS = 60 * 1000;
const FETCH_PUBLIC_TOTAL_MS = 2 * 60 * 1000;

const resource = (name, devPath) =>
  app.isPackaged ? join(process.resourcesPath, name) : join(import.meta.dirname, devPath);
const webDir = resource('web', '../web/build');
const yomitanDir = resource('yomitan', 'yomitan');
const hookDir = resource('lunahook', 'lunahook');
const mihonDir = resource('mihon-host', '../mihon-host/desktop/build/install/desktop/lib');
const electronDir = app.isPackaged
  ? join(process.resourcesPath, '..')
  : join(import.meta.dirname, 'node_modules/electron/dist');

let mainWindow;

// Steam Deck's Game Mode has no terminal: what goes wrong with a game is in this file too, for
// Settings → Desktop games' Copy diagnostics. About 1 MB, then it becomes main.old.log.
// Never tokens, keys or a game's text lines; no URLs (an /auth URL holds a sign-in code).
const logDir = join(app.getPath('userData'), 'logs');
const logFile = join(logDir, 'main.log');
const oldLogFile = join(logDir, 'main.old.log');
function log(text) {
  console.warn(text);
  try {
    mkdirSync(logDir, { recursive: true });
    if ((statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > 1_000_000)
      renameSync(logFile, oldLogFile);
    appendFileSync(logFile, `${new Date().toISOString()} ${text}\n`);
  } catch {
    // A log that can't be written stops nothing.
  }
}
process.on('uncaughtExceptionMonitor', (error, origin) =>
  log(`${origin}: ${error?.stack ?? error}`)
);
process.on('unhandledRejection', (reason) => log(`unhandledRejection: ${reason?.stack ?? reason}`));

/** How the app runs here, for the log and diagnostics: Wayland or X11, and whether Steam started it. */
const sessionInfo = () =>
  [
    `XDG_SESSION_TYPE=${process.env.XDG_SESSION_TYPE ?? ''}`,
    `WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY ?? ''}`,
    `DISPLAY=${process.env.DISPLAY ?? ''}`,
    `ozone-platform=${app.commandLine.getSwitchValue('ozone-platform')}`,
    `SteamAppId=${process.env.SteamAppId ?? ''}`,
    `SteamDeck=${process.env.SteamDeck ?? ''}`
  ].join(' ');
log(
  `start: chimimouryou ${app.getVersion()}, ${process.platform} ${release()} ${process.arch}, ${sessionInfo()}, args: ${process.argv.slice(1).join(' ')}`
);

// The game overlay needs window positions, which Wayland doesn't give: while it's on, the app runs
// on X11 (XWayland, where Wine's games are too). Read at start, so a change takes a restart.
// Electron picks the platform before this file runs, so appendSwitch would only reach the child
// processes (an X11 GPU process under a Wayland browser crashes and no window shows): this process
// replaces itself. Not app.relaunch: its helper runs from the AppImage's mount, which goes away
// when this process exits; with exec the process lives on, so the mount does too.
if (
  process.platform === 'linux' &&
  (process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY)
) {
  // Chromium's screen capture asks the Wayland portal (a share dialog per shot) whenever
  // XDG_SESSION_TYPE says wayland, whatever platform the app runs on; on X11 it captures directly.
  if (app.commandLine.getSwitchValue('ozone-platform') === 'x11')
    process.env.XDG_SESSION_TYPE = 'x11';
  else if (
    process.env.DISPLAY &&
    loadStore(join(app.getPath('userData'), 'native-games.json')).overlay?.on === true
  ) {
    log('restarting on X11 (XWayland) for the game overlay');
    process.execve(
      process.execPath,
      [process.execPath, ...process.argv.slice(1), '--ozone-platform=x11'],
      { ...process.env, XDG_SESSION_TYPE: 'x11' }
    );
  }
}

/** The file: URLs the About window links to (licences): the only local files a window may open. */
const aboutFiles = new Set();

/** The app's own windows (not extension pages or About) learn they run in the desktop app. */
const appPreferences = { preload: join(import.meta.dirname, 'preload.cjs') };

/**
 * Links that leave the app open in the system browser; same-origin windows (OAuth's /auth popup) stay
 * in, and the popup's sign-in page opens in the browser too, waiting for its redirect (oauth.js).
 */
function keepExternalLinksOut(contents) {
  contents.on('did-create-window', (window) => keepExternalLinksOut(window.webContents));
  contents.on('destroyed', () => cancelBrowserSignIn(contents));
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${origin}/`))
      return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: appPreferences } };
    if (/^https?:/.test(url)) shell.openExternal(url);
    else if (aboutFiles.has(url)) shell.openPath(fileURLToPath(url));
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith(`${origin}/`)) return;
    event.preventDefault();
    if (contents.getURL().startsWith(`${origin}/auth?`) && isSignInUrl(url, origin))
      shell.openExternal(startBrowserSignIn(url, contents));
    else if (/^https?:/.test(url)) shell.openExternal(url);
  });
}

/** The browser's redirect back from a sign-in: hands the code to the waiting /auth popup. */
function handleSignInRedirect(url, res) {
  if (url.pathname !== '/auth' || !url.searchParams.has('state')) return false;
  const page = (status, text) =>
    res
      .writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer'
      })
      .end(
        `<!doctype html><meta charset="utf-8"><title>chimimouryou</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:48px;color:#222;background:#fff}
@media (prefers-color-scheme:dark){body{color:#eee;background:#222}}</style><p>${text}</p>`
      );
  const result = finishBrowserSignIn(url.searchParams);
  const popup = result && !result.popup.isDestroyed() ? result.popup : undefined;
  if (!popup) {
    page(400, 'chimimouryou isn’t waiting for this sign-in. Start it again from the app.');
  } else if (result.code) {
    // A same-origin navigation from inside the popup keeps window.opener, which holds the PKCE verifier.
    const next = `/auth?code=${encodeURIComponent(result.code)}`;
    popup.executeJavaScript(`location.replace(${JSON.stringify(next)})`);
    mainWindow?.focus();
    page(200, 'Signed in. You can close this tab and go back to chimimouryou.');
  } else {
    BrowserWindow.fromWebContents(popup)?.close();
    page(200, 'Sign-in was cancelled. You can close this tab.');
  }
  return true;
}

const readText = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
};
const readVersion = (dir) => readText(join(dir, 'yomitan-version.txt'));

/**
 * An unpacked extension's ID comes from its path, and Yomitan's settings and dictionaries live
 * under that ID. The bundled copy moves (AppImage mounts, updates), so load a copy at a fixed path.
 */
function stableYomitanDir() {
  const dir = join(app.getPath('userData'), 'yomitan');
  const version = readVersion(yomitanDir);
  if (readVersion(dir) !== version) {
    rmSync(dir, { recursive: true, force: true });
    // The version file last, so an interrupted copy is redone.
    const versionFile = 'yomitan-version.txt';
    cpSync(yomitanDir, dir, { recursive: true, filter: (src) => !src.endsWith(versionFile) });
    cpSync(join(yomitanDir, versionFile), join(dir, versionFile));
  }
  return dir;
}

async function loadYomitan() {
  if (!readVersion(yomitanDir)) return undefined;
  for (const type of ['service-worker', 'frame']) {
    session.defaultSession.registerPreloadScript({
      type,
      filePath: join(import.meta.dirname, 'yomitan-shim.cjs')
    });
  }
  try {
    return await session.defaultSession.extensions.loadExtension(stableYomitanDir(), {
      allowFileAccess: true
    });
  } catch (error) {
    log(`Yomitan failed to load: ${error.stack}`);
    return undefined;
  }
}

/** A window's crashes and failed loads go to the log (the game overlay's above all). */
function logErrors(contents, name) {
  contents.on('render-process-gone', (_event, { reason, exitCode }) =>
    log(`${name} window: renderer gone (${reason}, ${exitCode})`)
  );
  contents.on('did-fail-load', (_event, code, description, _url, mainFrame) =>
    // -3: a navigation that another one replaced
    mainFrame && code !== -3
      ? log(`${name} window: load failed (${code} ${description})`)
      : undefined
  );
  contents.on('preload-error', (_event, _path, error) =>
    log(`${name} window: preload failed: ${error.stack}`)
  );
}

/** Whether a program runs here (pactl, parec: Anki clips' sound on Linux). */
const hasProgram = (name) =>
  new Promise((resolve) =>
    execFile(name, ['--version'], { timeout: 10_000 }, (error) => resolve(!error))
  );

const tailLines = (file) => {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

/** Settings → Desktop games' Copy diagnostics: this computer, the session, and the log's end. */
async function diagnostics() {
  const osName = /^PRETTY_NAME="?(.*?)"?$/m.exec(readText('/etc/os-release') ?? '')?.[1];
  return {
    version: app.getVersion(),
    os: [osName, `${process.platform} ${release()} ${process.arch}`].filter(Boolean).join(', '),
    session: sessionInfo(),
    pactl: process.platform === 'linux' ? await hasProgram('pactl') : undefined,
    parec: process.platform === 'linux' ? await hasProgram('parec') : undefined,
    log: [...tailLines(oldLogFile), ...tailLines(logFile)].slice(-200)
  };
}

function openWindow(url, options = {}, webPreferences = {}) {
  const window = new BrowserWindow({ width: 1000, height: 800, ...options, webPreferences });
  keepExternalLinksOut(window.webContents);
  window.loadURL(url);
  return window;
}

/** Games played natively: chimihook, LunaHook and Locale Remulator, when bundled (not on macOS). */
function lunahookAbout(link, file) {
  let tag;
  try {
    tag = readFileSync(join(hookDir, 'lunahook-version.txt'), 'utf8').trim();
  } catch {
    return '';
  }
  const licence = (name) => link(file(join(hookDir, 'licenses', name)), 'licence text');
  return `<p><b>LunaHook</b> (from LunaTranslator ${tag}, which includes Textractor), the text hook for
games played natively, is bundled unmodified as a separate program under the GNU General Public License
version 3 (${licence('LICENSE.LunaTranslator')}; Textractor: ${licence('LICENSE.Artikash.Textractor')};
MinHook: ${licence('LICENSE.TsudaKageyu.minhook')}). Its complete corresponding source is the release tag
${link(`https://github.com/HIllya51/LunaTranslator/tree/${tag}`, `HIllya51/LunaTranslator ${tag}`)}.
The program that runs it, chimihook, is GPL-3.0-or-later; its source is apps/desktop/native in this
app's repository. On Windows games start through <b>Locale Remulator</b> 1.6.0, unmodified, under the GNU
Lesser General Public License version 3 (${licence('LICENSE.InWILL.Locale_Remulator')}; source:
${link('https://github.com/InWILL/Locale_Remulator/tree/v1.6.0', 'InWILL/Locale_Remulator v1.6.0')}),
with Microsoft's Visual C++ runtime DLLs.</p>`;
}

function aboutHtml(yomitan) {
  const file = (path) => {
    const url = pathToFileURL(path).href;
    aboutFiles.add(url);
    return url;
  };
  const link = (href, text) => `<a href="${href}" target="_blank">${text}</a>`;
  const yomitanVersion = yomitan?.version ?? 'not bundled';
  return `<!doctype html><meta charset="utf-8"><title>About chimimouryou</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#222;background:#fff}
@media (prefers-color-scheme:dark){body{color:#eee;background:#222}a{color:#9cf}}h1{font-size:20px}</style>
<h1>chimimouryou ${app.getVersion()}</h1>
<p>A reader for Japanese books. BSD 3-Clause licence
(${link(file(resource('LICENSE', '../../LICENSE')), 'LICENSE')}, ${link(file(resource('NOTICE', '../../NOTICE')), 'NOTICE')});
source: ${link('https://github.com/blankiekun/chimimouryou', 'github.com/blankiekun/chimimouryou')}.</p>
<p><b>Yomitan ${yomitanVersion}</b>, bundled unmodified as a separate program, is licensed under the GNU
General Public License version 3 (${yomitan ? link(file(join(yomitanDir, 'LICENSE')), 'licence text') : 'GPL-3.0'}).
Its complete corresponding source is the release tag
${link(`https://github.com/yomidevs/yomitan/tree/${yomitanVersion}`, `yomidevs/yomitan ${yomitanVersion}`)}.</p>
${lunahookAbout(link, file)}
<p>The visual novel player is CONscripter, GPL-2.0
(${link('https://github.com/blankiekun/CONscripter', 'github.com/blankiekun/CONscripter')}; see NOTICE).</p>
<p>Electron ${process.versions.electron} (MIT) with Chromium ${process.versions.chrome}
(${link(file(join(electronDir, 'LICENSES.chromium.html')), 'Chromium licences')}).</p>`;
}

// What an extension's request may not reach, as the server's fetch proxy and Mihon's Guard.kt.
// A BlockList judges v4-mapped IPv6 addresses by these IPv4 rules too.
const notPublic = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3]
])
  notPublic.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8]
])
  notPublic.addSubnet(address, prefix, 'ipv6');

async function refuseNonPublic(url) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  // shortcut: DNS rebinding stays possible, Chromium resolves again for the request itself (this shares
  // its host cache, which only narrows the gap); closing it needs a check on the connected address.
  const { endpoints } = await session.defaultSession.resolveHost(host).catch(() => {
    throw new Error(`${host} could not be resolved`);
  });
  if (!endpoints.length) throw new Error(`${host} could not be resolved`);
  for (const { address } of endpoints) {
    if (notPublic.check(address, address.includes(':') ? 'ipv6' : 'ipv4'))
      throw new Error(`${host} is not a public address`);
  }
}

/**
 * Sources' fetch for the app's pages (transport.ts): http(s) only, a browser user agent, redirects
 * followed here so the page sees the final address (net.fetch's `url` is wrong), the size capped.
 * Pacing per host stays in transport.ts, as in a browser.
 */
async function sourcesFetch(
  event,
  url,
  { headers = {}, maxBytes = 20 * 1024 * 1024, publicOnly = false } = {}
) {
  if (!isApp(event)) throw new Error('Not the app');
  const agent = session.defaultSession.getUserAgent().replace(/ (Electron|chimimouryou)\/\S+/g, '');
  // A silence limit, not a total one: a 300 MB volume on a slow line has to finish. Firing after
  // the answer is harmless.
  // eslint-disable-next-line no-undef -- a global only: no node: module exports it
  const controller = new AbortController();
  let stall;
  const alive = () => {
    clearTimeout(stall);
    stall = setTimeout(() => controller.abort(), FETCH_SILENCE_MS);
  };
  // An extension's request also has a total limit (as Mihon's callTimeout): a site dripping bytes
  // is never silent. A reader's own server keeps the silence limit alone.
  if (publicOnly) setTimeout(() => controller.abort(), FETCH_PUBLIC_TOTAL_MS);
  for (let hop = 0; hop < 10; hop += 1) {
    if (!/^https?:\/\//.test(url)) throw new Error('Only http and https');
    if (publicOnly) await refuseNonPublic(url);
    alive();
    const response = await net.fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': agent, ...headers },
      redirect: 'manual',
      cache: 'no-store',
      // net.fetch sends the session's cookies by default; a site never gets the app's.
      credentials: 'omit'
    });
    const location = response.headers.get('Location');
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, url);
      // A cookie or password never goes on to another origin.
      if (next.origin !== new URL(url).origin) headers = {};
      url = next.href;
      continue;
    }
    const answer = {
      status: response.status,
      url,
      type: response.headers.get('Content-Type') || '',
      retryAfter: response.headers.get('Retry-After') || '',
      range: response.headers.get('Content-Range') || ''
    };
    // Abort: leaving the body unread doesn't close the connection.
    const tooBig = () => (controller.abort(), { ...answer, tooBig: true });
    if (Number(response.headers.get('Content-Length') || 0) > maxBytes) return tooBig();
    const chunks = [];
    let received = 0;
    for await (const chunk of response.body ?? []) {
      alive();
      received += chunk.byteLength;
      if (received > maxBytes) return tooBig();
      chunks.push(chunk);
    }
    return { ...answer, body: await new Blob(chunks).arrayBuffer() };
  }
  throw new Error('Too many redirects');
}

function setMenu(yomitan) {
  const extensionPage = (page, title) => () =>
    openWindow(`${yomitan.url}${page}`, { title, parent: mainWindow });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      {
        label: 'Yomitan',
        submenu: [
          {
            label: 'Settings',
            enabled: !!yomitan,
            click: extensionPage('settings.html', 'Yomitan settings')
          },
          {
            label: 'Search',
            enabled: !!yomitan,
            click: extensionPage('search.html', 'Yomitan search')
          }
        ]
      },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          {
            label: 'About chimimouryou',
            click: () =>
              openWindow(`data:text/html;charset=utf-8,${encodeURIComponent(aboutHtml(yomitan))}`, {
                width: 560,
                height: 480,
                parent: mainWindow
              })
          }
        ]
      }
    ])
  );
}

if (!app.requestSingleInstanceLock()) {
  // Another instance owns the port and the profile.
  app.quit();
} else {
  // A second start (another Steam shortcut's `--game=`) opens its game here.
  app.on('second-instance', (_event, argv) => {
    const page = startPage(origin, argv);
    if (page) log(`second start: ${argv.find((arg) => arg.startsWith('--game='))}`);
    if (page) mainWindow?.loadURL(page);
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    if (!existsSync(join(webDir, 'index.html'))) {
      dialog.showErrorBox('chimimouryou', `The reader isn't built: ${webDir} has no index.html.`);
      app.quit();
      return;
    }
    try {
      await serve(
        webDir,
        port,
        (url, res, req) => handleSignInRedirect(url, res) || handleJiten(url, res, req)
      );
    } catch (error) {
      dialog.showErrorBox('chimimouryou', `Port ${port} on 127.0.0.1 is taken: ${error.message}`);
      app.quit();
      return;
    }
    ipcMain.handle('sources-fetch', sourcesFetch);
    // Settings → Desktop games: Copy diagnostics, Open log folder.
    ipcMain.handle('games-diagnostics', (event) => {
      if (!isApp(event)) throw new Error('Not the app');
      return diagnostics();
    });
    ipcMain.handle('games-open-logs', async (event) => {
      if (!isApp(event)) throw new Error('Not the app');
      mkdirSync(logDir, { recursive: true });
      return shell.openPath(logDir);
    });
    registerMihon({
      app,
      ipcMain,
      net,
      hostDir: mihonDir,
      // The E2E's hosts file and trust store (e2e/mihon.e2e.mjs); unset in normal use.
      jvmArgs: (process.env.CHIMI_MIHON_JVM_ARGS || '').split(' ').filter(Boolean),
      isApp
    });
    registerGames({
      app,
      dialog,
      ipcMain,
      BrowserWindow,
      desktopCapturer,
      globalShortcut,
      screen,
      hookDir,
      overlayUrl: `${origin}/hook/overlay`,
      preload: appPreferences.preload,
      prepare: (contents) => {
        keepExternalLinksOut(contents);
        logErrors(contents, 'overlay');
      },
      isApp,
      log
    });
    const yomitan = await loadYomitan();
    setMenu(yomitan);
    // `--game=<folder>` (a Steam shortcut's launch options) starts straight into that game.
    mainWindow = openWindow(
      startPage(origin, process.argv) ?? `${origin}/`,
      { width: 1200, height: 900, title: 'chimimouryou' },
      appPreferences
    );
    logErrors(mainWindow.webContents, 'main');
    checkForUpdates(mainWindow);
  });
}
