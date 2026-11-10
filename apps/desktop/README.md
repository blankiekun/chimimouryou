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

Servers always allow the app's origin (`http://127.0.0.1:41917`; older servers need it in
`CORS_ORIGINS`, docs/CONFIGURATION.md → Server connect). The server must use HTTPS.

## Run it

From this folder, after `pnpm install` at the repository root:

```sh
pnpm run fetch      # Electron's binary, Yomitan's Chrome build and LunaHook (pinned, sha256-checked;
                    # LunaHook's helper needs mingw-w64: gcc-mingw-w64-x86-64 and -i686)
pnpm run build:web  # the standalone web build in ../web/build
VN_OCR_OUT=../web/build/vn/ocr ../../scripts/vn-ocr/fetch.sh  # the screen-text models (~15 MB), for
                    # the overlay's Invisible mode; without them it uses the manual area
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
  continue in the browser and the sign-in waits 10 minutes instead of 45 seconds. It also exposes
  `chimiDesktop.fetch` for Sources (`transport.ts`): `main.js` `sourcesFetch` (`ipcMain.handle`,
  app pages only) fetches with Electron's `net.fetch`, http(s) only, a browser user agent (Electron's
  without `Electron/…`), redirects followed one by one (net.fetch's `url` is wrong; headers dropped
  on another origin), a size cap; per-host pacing stays in the page. Sites without CORS work here.
- Windows games play natively (Linux and Windows builds; `games.js`). A library VN record with
  `engine: 'vnbox'` (or one added with Import → Installed game, no browser files) starts natively
  as soon as it is opened: `/v` goes straight to `/hook?native=<book id>` (More → Play natively
  does the same), which asks for its folder when it isn't linked here. The app ships no VNBox, so `/v` never
  starts it here and Import has no Windows game entry (its player would wait on "Downloading…"). `main.js` keeps where each game is
  installed in `<userData>/native-games.json` (`{folder → title, installDir, exe, linkedAt}`, by the
  record's `folder`, never synced), written only after its own `dialog.showOpenDialog`: a page names
  a game by its record and can't hand main a path to run. A game not linked here, or whose folder or
  program is gone, gets the folder picker again (Cancel keeps the old entry); the page shows the
  folder's programs (`listPrograms`: the record's program first, setup tools last) and links the one
  picked by its index. Settings → Desktop games lists the entries (Change folder, Forget) and Wine's
  status. One game at a time: `chimihook.exe <game>` (`native/chimihook.c`, GPL-3.0-or-later) loads
  LunaHost64.dll, starts the game, injects LunaHook (32-bit games through `inject32.exe`) and prints
  JSON lines; main forwards `text`/`thread`/`inject`/`error`/`exit` to the page that started it
  (`native-hook` IPC, `chimiDesktop.games.onHook`) and keeps them for `/hook` to replay
  (`games-session`). Windows starts the game through Locale Remulator (`--locale`: `LRProc.exe`
  with LRConfig.xml's "Run in Japanese" profile; the helper then finds the game's process by its
  path), so Shift JIS games work on any system locale. Linux uses the Wine on `PATH` with
  `LANG/LC_ALL=ja_JP.UTF-8`, `TZ=Asia/Tokyo`, one prefix per game in `<userData>/wine-prefixes/<folder>`
  (made on first start: `wineboot`, the home-folder links replaced with folders so saves stay in the
  prefix, `winetricks -q fakejapanese` when winetricks is there, its font files moved to
  `<userData>/wine-fonts/` and linked), or Steam's Proton (the Proton entry below). `scripts/fetch-lunahook.sh` fetches LunaHook, Locale
  Remulator and the MSVC runtime from LunaTranslator's pinned release zip (sha256) and builds the
  helper with mingw-w64 into `lunahook/` (not on macOS). Saves sync with VNBox through the record's
  `vnsaves.json` (same names and merge): `/hook` fetches it and passes it to `games-launch`, which
  writes the newer files before the game starts (never over or through a link); when the game
  closes the page open (the root layout's watcher, and `/hook`) reads the save files with
  `games-saves` and merges them in (20 MB cap). VNBox's
  prefix user `username` maps to the game's prefix user on Linux and to the user's AppData,
  Documents, Saved Games and ProgramData on Windows, where only the game's save folders are used:
  those its synced saves name or its first run made, both confirmed on `/hook` before anything is
  written or read there. Files in the install folder count as saves when new or changed since it
  was linked (a size and time manifest in `native-games.json`) or already synced. Main never trusts
  the page's names: `isSafeSaveName` (games.js) refuses, on both writing and reading, anything
  outside VNBox's save folders, temp/cache folders, a `Microsoft` folder under AppData or
  ProgramData, runnable or loadable files (`.exe`, `.dll`, `.bat`…, `game/` included), 8.3 short
  names and parts ending in a dot or space. Anki: `game-media.js` keeps the game's sound (Linux: its own
  PulseAudio/PipeWire null sink looped back to the speakers, recorded with `parec`; Windows:
  `chimihook --audio`, the game's process tree into a named pipe) and screenshots of its window
  (`desktopCapturer`; none on native Wayland, where every capture asks to share the screen,
  so there only with the overlay on) in memory, and `/hook` fills a mined note's empty picture/audio fields with
  its line's (`games-mark`, `games-media`). Beyond auto hooks: /hook's "Add hook code…" sends an
  H-code or R-code to `games-hook-code`, which checks its shape (`isHookCode`: 500 at most, one line,
  no control characters) before writing `insert <code>` to the helper's stdin
  (`Luna_InsertHookCode`); its thread is picked and saved like any other, and a saved code no thread
  matched 5 s after injection is inserted again. A launcher (no window of its own while a process it
  started has one, or it exits with one running) hands over to that process (`follow` in
  chimihook.c). "Attach to running game…" (`games-windows`, `games-attach`): main runs
  `chimihook --list` (Linux: in the game's prefix if it has one, else Wine's default prefix), keeps
  the list, and the page picks by index; `--attach <pid>` then hooks it as the linked game's session
  (Linux records the whole system's sound: the game isn't on the app's sink). "Launch only (I hook
  with my own tool)" (`launchOnly` in `native-games.json`, `games-options`) starts the game with
  `--no-hook`: no LunaHook, /hook takes lines from its WebSocket and numbers each through
  `games-stamp` for its Anki media. `e2e/native-vn.e2e.mjs` runs the whole flow
  under Wine with a test VN (`xvfb-run -a node e2e/native-vn.e2e.mjs`; not in CI).
  Overlay (`overlay.js`, Windows and X11): with a game's "Text overlay over the game" set to Band
  or Invisible (`/hook`, or per game in Settings → Desktop games), a
  transparent, frameless, unfocusable, always-on-top window on `/hook/overlay` takes the game
  window's place (the helper's `window` message: rect, foreground, minimized, every 0.1 s) and
  shows `/hook`'s newest line (a `BroadcastChannel`) in the text box area: a bottom band by
  default, moved and resized with Adjust area, kept per game in `native-games.json` with the
  game's mode (`overlayMode`, `overlayPlace`; `overlay` there holds the text size and opacity,
  Settings → Desktop games). Windows: clicks go
  through with mouse moves forwarded, so hover looks up and clicks still reach the game. X11:
  `forward` is Windows/macOS only, so the window's shape is the text's line boxes and an open
  popup (the whole window while the pointer is over a popup, or over the text while Yomitan is
  loaded, since its popup can't be measured): clicks off the text reach the game, a click on the
  text doesn't. Without a compositor the shape shows an opaque strip, and Yomitan's popup turns the
  window black; the built-in popup works. Hidden while the game is minimized or not in front. On
  a Wayland session the app starts on X11 (`--ozone-platform=x11`) while the overlay is on (a
  change takes a restart). `e2e/overlay.e2e.mjs` checks it under Xvfb with openbox and xcompmgr
  (`apt install openbox xcompmgr xdotool`); Windows is compile-only.
  Invisible: the line is drawn transparent with no background over the game's own text, so the
  game looks untouched and hovering or tapping its text looks words up (built-in popup or
  Yomitan). Placing, per game: "Screen read" (default) captures the game's window once the line
  has settled, finds the line in it (`readVnScreen`, the screen-text models in `web/vn/ocr/`,
  GPL-3.0-or-later and non-commercial, see NOTICE) and lays each row on its glyphs; when under
  half the line is found, the text is vertical, the window can't be captured or the models are
  missing, and always with "Manual area", the text flows in the adjusted area at the overlay's
  text size (fit both to the game's text box). The first read of a session loads the models (a
  few seconds). What the read doesn't place: glyphs of about 20 px or less, a line that starts 9
  characters or more into the dialogue on the screen; and half-width characters shift the rest of
  their row (rows are full-width cells, as `/v`'s). A lookup tints its word on the game's text. A click on the text itself still doesn't reach the game on X11: advance with a
  click anywhere else, or a key.
  Fullscreen: the overlay follows the game's window, so a game that goes fullscreen by its own
  setting (or back) keeps it; the app never makes a game fullscreen. Its X window is
  override-redirect, which no window manager stacks, so a fullscreen game's layer doesn't cover
  it (checked with openbox in the E2E; KWin not run).
  Wine's pointer grab: Wine confines the pointer to a fullscreen game from the first click in it
  (an X pointer grab, on a single monitor; always under gamescope), and the overlay's text would
  get no pointer from then on. So a game whose overlay is Band or Invisible starts with
  `GrabPointer=N` (`HKCU\Software\Wine\X11 Driver`) in its Wine or Proton prefix, and such a
  game can't confine the pointer; a game set to Off gets Wine's default back at its next start.
  `games.js` `pointerGrab` runs `reg` only when that changes (the marker `.chimi-nograb` in the
  prefix), so a mode changed while the game runs counts from the game's next start (the control
  says so). Run with Wine in the E2E; the Proton prefix has not been run.
  Steam Deck: Desktop Mode is plain X11 (KDE), as above. Game Mode (gamescope) is built from
  gamescope's source and has not been run on a Deck: gamescope paints an override-redirect window
  of the same Steam app as the focused game over it, scaled with the game, and the pointer and
  touch reach it by the same X shape; the keyboard focus should stay with the game. For that the
  app must be started from Steam (a non-Steam game) and start the game itself, so both share one
  app id. Nothing in the code is specific to gamescope. On SteamOS games start with Steam's
  Proton (the Proton entry below).
  Shortcuts (`hotkeys.js`, Electron `globalShortcut`): while a game runs and its `/hook` window is
  open, Ctrl+Shift+M puts the newest line (with its screenshot and sound) on the last Anki card
  (`native-hotkey` to `/hook`, which says how it went in a desktop notification) and Ctrl+Shift+H
  brings `/hook` to the front, back to the game's `/hook` if the window went elsewhere (pressed
  with the app in front, it minimizes it). Registered at launch or rejoin, unregistered when the
  game exits, its page closes or the app quits, so they never take keys otherwise; changed or
  cleared in Settings → Desktop games (`hotkeys` in `native-games.json`, `games-hotkeys`). On a
  native Wayland session they work only with the overlay on (the app then runs on X11).
- Proton (Linux, `proton.js`; for a Steam Deck, which has no system Wine): Settings → Desktop games
  → "Runs games with" picks Automatic (Wine when `wine --version` works, else Proton), Wine, or a
  Proton build, with the same choice per game (`runner` in `native-games.json`: `'auto'`, `'wine'`
  or `{ proton: <build's folder> }`, never synced). Builds are read from Steam's files (Steam
  needn't run): the installs in `~/.steam/root`, `~/.local/share/Steam` and Flatpak Steam's folder,
  their libraries from `steamapps/libraryfolders.vdf` (SD cards included), every
  `steamapps/common/*` and `compatibilitytools.d/*` folder with a `proton` script and a
  `toolmanifest.vdf`, and the container that file asks for (`require_tool_appid` →
  `appmanifest_<id>.acf` → its folder with `_v2-entry-point`). Automatic takes the newest numbered
  Valve build whose container is installed, then Experimental, then the newest custom build; with
  the container missing the app names it ("Steam Linux Runtime 4.0", in Steam's Library → Tools).
  The app runs what Steam runs, with no other program:
  `<runtime>/_v2-entry-point --verb=waitforexitandrun -- <build>/proton <verb> …` with
  `STEAM_COMPAT_DATA_PATH=<userData>/proton-prefixes/<folder>` (the prefix is its `pfx/`, the user
  `steamuser`), `STEAM_COMPAT_CLIENT_INSTALL_PATH`, `STEAM_COMPAT_TOOL_PATHS`,
  `STEAM_COMPAT_APP_ID=0`, `STEAM_COMPAT_MOUNTS` (the game's folder, the helper's, the prefix),
  `LANG/LC_ALL/HOST_LC_ALL=ja_JP.UTF-8` (proton takes `LC_ALL` from `HOST_LC_ALL`; the container
  generates the locale, so the system needs none), `TZ=Asia/Tokyo` and `PRESSURE_VESSEL_DEVEL=1`
  (the container otherwise gives the helper no stdin, where hook codes go). First start, or a
  changed build: `proton run wineboot --init` makes or upgrades the prefix, the user folder links
  become folders, and one `reg import` adds Wine font replacements for the Japanese fonts Proton
  lacks (MS Mincho, Meiryo, Yu Gothic, Yu Mincho and their Japanese names → MS Gothic; the P and UI
  ones → MS PGothic, MS UI Gothic), so Mincho text shows in Gothic; no winetricks, no download.
  The helper then runs with `proton runinprefix` (plain `wine`, our stdin and stdout; `run` would
  start it through Proton's `steam.exe` in a new console and lose its lines), for launch, `--list`
  and `--attach` alike; Attach lists only games in the app's own prefix (one Steam started is in
  Steam's). A packaged app copies the helper's folder to `<userData>/hook/` first (an AppImage's
  mount may not be visible in the container). Saves map to `pfx/drive_c/users/steamuser` and
  `pfx/drive_c/ProgramData`; a game that last ran with the other runner (`ranWith`) gets its saves
  copied into the new prefix before it starts, by the rules synced saves are written with (never
  over a newer file, never through a link, `isSafeSaveName`); both prefixes stay. Sound, the X
  window id, the overlay's window messages, shortcuts and exit handling are the Wine path's.
  Not supported: the app itself started inside a Steam runtime container. Untested on real
  hardware: nothing here has run Valve's Proton or container; `E2E_RUNNER=proton xvfb-run -a node
e2e/native-vn.e2e.mjs` runs the whole flow through this path with stand-in scripts in front of
  Wine, and `docs/QA.md` (Steam Deck) lists what to try on a Deck.
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

## Updating LunaHook

Set the new LunaTranslator tag and the sha256 of its `LunaTranslator_x64.zip` in
`scripts/fetch-lunahook.sh` (the helper uses LunaHost's C API, `Luna_Start` and friends), run it,
and run `e2e/native-vn.e2e.mjs`.

## Updating Yomitan

Set the new tag and the sha256 of its `yomitan-chrome.zip` in `scripts/fetch-yomitan.sh`, run
`pnpm run fetch`, and check a lookup in the reader and in a visual novel.
