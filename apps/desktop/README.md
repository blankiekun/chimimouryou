# chimimouryou desktop

The standalone edition (`VITE_EDITION=standalone`) in an Electron window, with
[Yomitan](https://github.com/yomidevs/yomitan) built in. Early: no installer
signing or auto-updates yet.

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
- Help → About lists the licences (Yomitan is GPL-3.0, a separate program; its source is the
  release tag named there).

## Updating Yomitan

Set the new tag and the sha256 of its `yomitan-chrome.zip` in `scripts/fetch-yomitan.sh`, run
`pnpm run fetch`, and check a lookup in the reader and in a visual novel.
