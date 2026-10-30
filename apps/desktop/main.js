/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

// chimimouryou's desktop shell: the standalone build served from a fixed loopback origin, with an
// unmodified Yomitan loaded as a Chrome extension (it is a separate GPL-3.0 program, see About).

import { app, BrowserWindow, dialog, ipcMain, Menu, net, session, shell } from 'electron';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  cancelBrowserSignIn,
  finishBrowserSignIn,
  isSignInUrl,
  startBrowserSignIn
} from './oauth.js';
import { serve } from './serve.js';
import { checkForUpdates } from './updater.js';

// Fixed: browser storage, the service worker, AnkiConnect's CORS check (its default
// webCorsOriginList admits http://127.0.0.1:<any port>) and OAuth redirects all key on the origin.
// http://127.0.0.1 is a secure context, and Yomitan's content scripts only match http(s) and file.
const port = 41917;
const origin = `http://127.0.0.1:${port}`;

const resource = (name, devPath) =>
  app.isPackaged ? join(process.resourcesPath, name) : join(import.meta.dirname, devPath);
const webDir = resource('web', '../web/build');
const yomitanDir = resource('yomitan', 'yomitan');
const electronDir = app.isPackaged
  ? join(process.resourcesPath, '..')
  : join(import.meta.dirname, 'node_modules/electron/dist');

let mainWindow;

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

const readVersion = (dir) => {
  try {
    return readFileSync(join(dir, 'yomitan-version.txt'), 'utf8');
  } catch {
    return undefined;
  }
};

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
    console.error('Yomitan failed to load:', error);
    return undefined;
  }
}

function openWindow(url, options = {}, webPreferences = {}) {
  const window = new BrowserWindow({ width: 1000, height: 800, ...options, webPreferences });
  keepExternalLinksOut(window.webContents);
  window.loadURL(url);
  return window;
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
<p>The visual novel player is CONscripter, GPL-2.0
(${link('https://github.com/blankiekun/CONscripter', 'github.com/blankiekun/CONscripter')}; see NOTICE).</p>
<p>Electron ${process.versions.electron} (MIT) with Chromium ${process.versions.chrome}
(${link(file(join(electronDir, 'LICENSES.chromium.html')), 'Chromium licences')}).</p>`;
}

/**
 * Sources' fetch for the app's pages (transport.ts): http(s) only, a browser user agent, redirects
 * followed here so the page sees the final address (net.fetch's `url` is wrong), the size capped.
 * Pacing per host stays in transport.ts, as in a browser.
 */
async function sourcesFetch(event, url, { headers = {}, maxBytes = 20 * 1024 * 1024 } = {}) {
  if (!event.senderFrame?.url.startsWith(`${origin}/`)) throw new Error('Not the app');
  const agent = session.defaultSession.getUserAgent().replace(/ (Electron|chimimouryou)\/\S+/g, '');
  for (let hop = 0; hop < 10; hop += 1) {
    if (!/^https?:\/\//.test(url)) throw new Error('Only http and https');
    const response = await net.fetch(url, {
      headers: { 'User-Agent': agent, ...headers },
      redirect: 'manual',
      cache: 'no-store'
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
      retryAfter: response.headers.get('Retry-After') || ''
    };
    if (Number(response.headers.get('Content-Length') || 0) > maxBytes)
      return { ...answer, tooBig: true };
    const body = await response.arrayBuffer();
    return body.byteLength > maxBytes ? { ...answer, tooBig: true } : { ...answer, body };
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
  app.on('second-instance', () => {
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
      await serve(webDir, port, handleSignInRedirect);
    } catch (error) {
      dialog.showErrorBox('chimimouryou', `Port ${port} on 127.0.0.1 is taken: ${error.message}`);
      app.quit();
      return;
    }
    ipcMain.handle('sources-fetch', sourcesFetch);
    const yomitan = await loadYomitan();
    setMenu(yomitan);
    mainWindow = openWindow(
      `${origin}/`,
      { width: 1200, height: 900, title: 'chimimouryou' },
      appPreferences
    );
    checkForUpdates(mainWindow);
  });
}
