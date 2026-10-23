# chimimouryou desktop

The standalone edition (`VITE_EDITION=standalone`) in an Electron window, with
[Yomitan](https://github.com/yomidevs/yomitan) built in.

## Download

Every release (`v*` tag) attaches the installers to its GitHub release
(https://github.com/blankiekun/chimimouryou/releases/latest): an AppImage (Linux x64),
`chimimouryou-Setup-<version>.exe` (Windows x64) and a universal dmg (macOS, Apple silicon and
Intel). They aren't code-signed yet (the dmg is only ad-hoc signed):

- Windows: SmartScreen says "Windows protected your PC". Click "More info", then "Run anyway".
- macOS: Gatekeeper refuses to open it ("Apple could not verify…"). Drag it to Applications, try
  to open it once, then System Settings → Privacy & Security → "Open Anyway" (or run
  `xattr -dr com.apple.quarantine /Applications/chimimouryou.app`).
- Linux: make the AppImage executable (`chmod +x`); it needs FUSE 2 (`libfuse2`/`libfuse2t64`).

## Updates

Installed builds check GitHub's latest release once per start (`updater.js`, electron-updater). On
Windows and in the AppImage the new version downloads in the background and the app offers "Restart
to update"; it never restarts or installs by itself, and "Later" offers it again next start. macOS
updates need a signed app, so there the app only says a new version is out and opens its release
page. Runs from source (`pnpm start`) never check.

## Connecting to a server

Server connect needs the server to list the app's origin: add `http://127.0.0.1:41917` to its
`CORS_ORIGINS` (docs/CONFIGURATION.md → Server connect). The server must use HTTPS.

## Run it

From this folder, after `pnpm install` at the repository root:

```sh
pnpm run fetch      # Electron's binary and Yomitan's Chrome build (pinned, sha256-checked)
pnpm run build:web  # the standalone web build in ../web/build
pnpm start
pnpm run dist       # optional: an installer for this platform in dist/
```

`fetch` and `build:web` are bash scripts (on Windows, run them from Git Bash or WSL).
pnpm doesn't run Electron's install script (it isn't in `allowBuilds`), so the
root install stays light for the web app and its Docker image; `fetch` downloads it.

## How it works

- `main.js` serves the web build from `http://127.0.0.1:41917` (`serve.js`, files resolved like
  GitHub Pages: `/auth` is `auth.html`, anything else `404.html`). A fixed loopback origin keeps
  IndexedDB, localStorage and the service worker between runs (the port is part of the origin),
  is a secure context, matches Yomitan's content scripts (they don't run on custom schemes), and
  AnkiConnect's default `webCorsOriginList` (`http://localhost`) already admits
  `http://127.0.0.1:<port>` and `chrome-extension://` origins, so mining needs no Anki setup.
  A second start focuses the running window; if another program holds the port, it says so.
- Yomitan is loaded unmodified with `session.extensions.loadExtension`. An unpacked extension's ID
  comes from its folder, and Yomitan's settings and dictionaries are stored under that ID, so it is
  copied to `<userData>/yomitan` (once per Yomitan version) and loaded from there.
- `yomitan-shim.cjs` is a preload for extension pages and service workers: Electron has no
  `chrome.permissions`, which Yomitan's backend reads on start. It reports the manifest's
  permissions. Electron has no `chrome.tabs.create` either, so Yomitan's welcome page doesn't open on
  first start; menu → Yomitan → Settings opens its settings (import dictionaries there).
- Links to other sites open in the system browser; windows on the app's origin (the cloud sign-in
  popup) open in the app.
- Google Drive sign-in continues in the system browser, since Google refuses sign-in inside
  embedded browsers (RFC 8252 loopback redirect, `oauth.js`). The `/auth` popup builds the consent
  URL as on the web; `main.js` stops its navigation, adds a random `state` and opens it with
  `shell.openExternal`. Google redirects the browser to `http://127.0.0.1:41917/auth?code=…&state=…`;
  `serve.js` hands that request to `main.js`, which accepts only the waiting state, once, and sends
  the code to the popup (`location.replace('/auth?code=…')`, same origin, so `window.opener` and its
  PKCE verifier stay), which exchanges it like the web build. The browser tab only gets a "signed in"
  page. `preload.cjs` exposes `window.chimiDesktop` to the app's windows: `/auth` then says to
  continue in the browser and the sign-in waits 10 minutes instead of 45 seconds.
- Help → About lists the licences (Yomitan is GPL-3.0, a separate program; its source is the
  release tag named there).

## Release builds

`.github/workflows/release.yml` builds the standalone edition once (with Yomitan), packages it on
GitHub's Linux, Windows and macOS runners with the tag's version (`--publish never`), and attaches the
installers and electron-updater's `latest*.yml` to the tag's release (making the release if it doesn't
exist yet). CI packages an unpacked Linux build when `apps/desktop` changes.

## Google Drive client

`build:web` takes `VITE_GDRIVE_CLIENT_ID` and `VITE_GDRIVE_CLIENT_SECRET` from the environment, like
the Pages build; the release workflow reads them from this repository's secrets of the same names
(the Pages build reads them from the site repository's). Use the same Google Cloud OAuth client as the web build (Web application type) and add
`http://127.0.0.1:41917/auth` to its Authorized redirect URIs: Google exempts loopback addresses from
its https and no-IP rules, and keeping one client lets the app see the Drive files the web build made
(the `drive.file` scope only shows files made by the app itself).

## Updating Yomitan

Set the new tag and the sha256 of its `yomitan-chrome.zip` in `scripts/fetch-yomitan.sh`, run
`pnpm run fetch`, and check a lookup in the reader and in a visual novel.
