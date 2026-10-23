# Configuration reference

Everything that can be configured, by where it is set. Most installs only touch
the first table (`.env` for `docker-compose.yml`, see [INSTALL.md](INSTALL.md)).
Per-person settings such as AI keys, the voice and the AI models are not here:
each reader enters them in Settings → AI, and they sync with their account.

## `.env` (Docker Compose)

| Variable                    | Default                   | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LIBRARY_PATH`              | required                  | The Calibre library (the folder with `metadata.db`). Mounted read-only into the web server; the catalog and import services write to it (`cover.jpg` for books without a cover, new books).                                                                                                                                                                                                                                                                                                          |
| `DATA_PATH`                 | `./data`                  | Everything the server stores: `sync/` (shared processed books and signed-out progress), `accounts/` (per-account data, including synced AI keys), `state/` (account database, catalog, import queue, difficulty results). Back it up; keep it off shares others can read.                                                                                                                                                                                                                            |
| `VN_PATH`                   | `DATA_PATH/vn`            | Visual novels: one unpacked ONScripter game per folder (the folder holding `0.txt`, `00.txt` or `nscript.dat`, or one level above it). The folder name is the title; a `cover.jpg`/`.png`/`.webp` or `icon.png` in it is the cover. Read-only for the web server and catalog; the import service unpacks uploaded game ZIPs into it. Served to signed-in readers at `/calibre/vn/` and listed in the catalog. The player fetches each file when the game opens it, so games aren't downloaded whole. |
| `SYNC_PATH`                 | `DATA_PATH/sync`          | The shared sync folder, if it should live elsewhere (e.g. next to the library on a NAS); account data stays in `DATA_PATH`. Mounted read-only in `account` and `difficulty` (readings files are made from the processed books in it).                                                                                                                                                                                                                                                                |
| `PUID`, `PGID`              | `1000`                    | User and group the containers run as. Must be able to read the library (and write to it for covers and imports) and own `DATA_PATH`.                                                                                                                                                                                                                                                                                                                                                                 |
| `HTTP_PORT`                 | `8080`                    | Host port of the web server (plain HTTP). Put an HTTPS reverse proxy in front of it.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `PUBLIC_HTTPS_URL`          | empty                     | The HTTPS address, if people also use a plain-HTTP address with a different name: the HTTP page links there to sign in. Build-time (`docker compose build web` after changing).                                                                                                                                                                                                                                                                                                                      |
| `REAL_IP_FROM`              | empty                     | Addresses of your reverse proxy (space-separated, CIDR allowed). nginx then takes the client address from `X-Forwarded-For`, so `TRUSTED_NETWORKS` and sign-in throttling see real visitors. Only these addresses may report HTTPS with `X-Forwarded-Proto`, so behind a TLS-terminating proxy sign-in needs it.                                                                                                                                                                                     |
| `TRUSTED_NETWORKS`          | empty                     | Signed-out visitors from these networks may read the library and save to the shared sync folder (e.g. `10.0.0.0/8 192.168.0.0/16 100.64.0.0/10 fc00::/7` for LAN and Tailscale). Empty: everything needs an account. Don't add Docker's `172.16.0.0/12` (see [INSTALL.md](INSTALL.md#https)).                                                                                                                                                                                                        |
| `PUBLIC_READS`              | `0`                       | `1`: anyone who can reach the server may browse and download the library without an account.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `AUDIOBOOKSHELF_URL`        | empty                     | Your Audiobookshelf server (e.g. `http://192.0.2.10:13378` or `http://host/audiobookshelf`) for the Audiobookshelf plugin. nginx forwards only its API and sign-in, at `/audiobookshelf/`, to signed-in readers, so the browser needs no CORS or HTTPS on it.                                                                                                                                                                                                                                        |
| `CORS_ORIGINS`              | empty                     | Server connect: the standalone app at these origins (space-separated, exact, `https://` with no path, e.g. `https://read.example`) may sign in to this server and read and sync its library. Empty: off, and the server sends no CORS headers. See [Server connect](#server-connect-cors_origins).                                                                                                                                                                                                   |
| `ALLOW_HTTP_ACCOUNTS`       | `0`                       | `1`: signing in (and so managing accounts and adding books) also works on plain HTTP, with a warning in the app. Passwords, sessions and synced settings then cross the network unencrypted.                                                                                                                                                                                                                                                                                                         |
| `MIN_FREE_MB`               | `1024`                    | Uploads to the sync folders are refused while the data disk has less free space.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `CATALOG_INTERVAL`          | `600`                     | Seconds between checks of `metadata.db`; the catalog is rebuilt only when it changed.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `DIFFICULTY_WORKERS`        | `2`                       | Processes for difficulty estimates (`difficulty` profile), about 0.5-1 GB of RAM each.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `IMAGE_PREFIX`, `IMAGE_TAG` | `ebook-reader`, `local`   | Image names: `<prefix>-{web,services,import,difficulty}:<tag>`. The defaults are built locally (`--build`); for published images use `ghcr.io/<owner>/<repository>` and a version or `latest`, then `docker compose pull`.                                                                                                                                                                                                                                                                           |
| `UPDATE_REPO`               | `blankiekun/chimimouryou` | GitHub repository the admin panel's updater (`ebook-update`, deploy.sh installs) checks and installs from: its latest release, or the newest commit on `main`.                                                                                                                                                                                                                                                                                                                                       |
| `COMPOSE_PROFILES`          | empty                     | Optional services to run: `import` (adding books to Calibre), `difficulty` (difficulty estimates), `mokuro` (manga text), e.g. `import,difficulty`. Same as passing `--profile`.                                                                                                                                                                                                                                                                                                                     |

## Build-time settings of the app (`VITE_*`)

Read when the app is built (`pnpm build`, or the `web` image). Docker Compose
passes only `VITE_HTTPS_URL` (from `PUBLIC_HTTPS_URL`) and the version; for the
others, add them as build arguments in `docker/web.Dockerfile` or build the app
yourself.

| Variable                                                         | Default                     | What it does                                                                                                                                                          |
| ---------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_HTTPS_URL`                                                 | the current host over HTTPS | Where the plain-HTTP page sends people to sign in.                                                                                                                    |
| `VITE_DEFAULT_STORAGE_SOURCE`                                    | `calibre`                   | Library source on first visit. Builds without the server (static hosting, `docker-compose.static.yml`) use `browser`, the only build with the Browser library source. |
| `VITE_GDRIVE_CLIENT_ID`, `VITE_GDRIVE_CLIENT_SECRET`             | empty                       | Google Drive sync (upstream feature); needs your own OAuth client.                                                                                                    |
| `VITE_ONEDRIVE_CLIENT_ID`, `VITE_ONEDRIVE_CLIENT_SECRET`         | empty                       | OneDrive sync (upstream feature).                                                                                                                                     |
| `VITE_GDRIVE_*_ENDPOINT`, `VITE_GDRIVE_SCOPE`, `VITE_ONEDRIVE_*` | Google's / Microsoft's      | OAuth endpoints and scopes; rarely changed.                                                                                                                           |
| `VITE_STORAGE_ROOT_NAME`                                         | `ttu-reader-data`           | Root folder name in synced storage. Changing it hides existing synced data.                                                                                           |
| `VITE_EDITION`                                                   | empty                       | `standalone` builds the web app without a server (docs/INSTALL.md → Standalone web app); implies `VITE_DEFAULT_STORAGE_SOURCE=browser`.                               |
| `VITE_BASE_PATH`                                                 | the current origin          | The site's address for canonical links and the preview image, e.g. `https://reader.example.org`.                                                                      |
| `VITE_PAGE_PATH`                                                 | empty                       | Sub-path the app is served under, e.g. `/reader`.                                                                                                                     |
| `VITE_CLEAR_ON_RELOAD`                                           | off                         | Clears the console on reload (development).                                                                                                                           |

## Web server (nginx template)

`scripts/calibre/render-nginx.sh` fills in `nginx-ebook-reader.conf.template`.
The web container runs it at start with these defaults. Server-level extras (TLS, resolver,
real-IP settings) go in `/etc/nginx/ebook-reader.d/*.conf`.

| Variable                                                                 | Default (Docker)                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `WEB_ROOT`                                                               | `/srv/www` (the built app)                                                  |
| `LIBRARY_DIR`                                                            | `/library`                                                                  |
| `VN_DIR`                                                                 | `/vn` (`VN_PATH`)                                                           |
| `SYNC_DIR`                                                               | `/data/sync`                                                                |
| `ACCOUNT_DATA_DIR`                                                       | `/data/accounts`                                                            |
| `CATALOG_FILE`                                                           | `/data/state/catalog/catalog.json`                                          |
| `THUMB_DIR`                                                              | `/data/state/catalog/thumbs` (library card thumbnails)                      |
| `DIFFICULTY_FILE`                                                        | `/data/state/difficulty/difficulty.json`                                    |
| `ACCOUNT_UPSTREAM`                                                       | `account:8766`                                                              |
| `IMPORT_UPSTREAM`                                                        | `import:8767`                                                               |
| `DIFFICULTY_UPSTREAM`                                                    | `difficulty:8765`                                                           |
| `MOKURO_UPSTREAM`                                                        | `mokuro:8768`                                                               |
| `ENGINE_DIR`                                                             | `/data/state/engine` (a visual novel engine installed from the admin panel) |
| `MOKURO_DIR`                                                             | `/data/state/mokuro` (served as `/calibre/mokuro/<id>.json`)                |
| `TRUSTED_NETWORKS`, `PUBLIC_READS`, `AUDIOBOOKSHELF_URL`, `CORS_ORIGINS` | as in `.env`                                                                |
| `INTERNAL_TOKEN_FILE`                                                    | `/data/state/internal-token`                                                |

The web container also reads `PUID`, `PGID` and `REAL_IP_FROM` (above).

## Server connect (`CORS_ORIGINS`)

The standalone app (the reader without a server, served from its own address) can connect to
a server that lists its origin in `CORS_ORIGINS`. It signs in with a username and password
and gets a token (`POST /account/api/token`), sent as `Authorization: Bearer` on every
request instead of the sign-in cookie, which browsers don't send to other sites.

- Off by default. With `CORS_ORIGINS` empty nothing changes: no CORS headers, and the server
  issues no tokens and ignores bearer tokens.
- The server must have HTTPS, a real certificate included (e.g. Tailscale's, see
  [INSTALL.md](INSTALL.md#https)): tokens are only issued and accepted over HTTPS, and an HTTPS
  app can't call an `http://` server anyway (mixed content).
- Only the reader's own paths answer other origins (the library, catalog, sync folders,
  difficulty, readings, manga text, import and the account API). Admin tools don't: a token
  never counts as an admin, so admins manage the server from its own address.
- A request from another origin counts only with its token: never the cookie, and never
  `TRUSTED_NETWORKS` (an allowed site could otherwise write to the shared sync folder for
  any visitor on your network).
- Tokens expire like sign-ins (30 days unused, 180 days at most). Readers see theirs in
  `GET /account/api/tokens` and sign them out with `POST /account/api/tokens/revoke`; admins
  see everyone's from the server's own page. Changing a password signs out all of them.
- List only origins you trust like the server itself: any page on that origin can act as
  any reader who signed in there. Never list a shared host (e.g. `https://<user>.github.io`
  without a custom domain).
- Chrome 142 and later ask the reader for permission (Local Network Access) when a public
  site calls a server at a private address such as `192.168.x.x`; allow it once per site.

## Python services

Set by the services image (`docker/services.Dockerfile`); the defaults in the
code are the same container paths.

| Variable                         | Docker value                                                                          | Used by                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `CALIBRE_LIBRARY`                | `/library`                                                                            | import, difficulty                                                                   |
| `VN_DIR`                         | `/vn` (`VN_PATH`)                                                                     | catalog, import (unpacks game ZIPs there)                                            |
| `SHARED_SYNC_DIR`                | `/data/sync`                                                                          | account (free-space check)                                                           |
| `ACCOUNT_STATE_DIR`              | `/data/state/account` (`accounts.db`)                                                 | account                                                                              |
| `ACCOUNT_DATA_DIR`               | `/data/accounts` (must match nginx's `ACCOUNT_DATA_DIR`)                              | account                                                                              |
| `ACCOUNT_HOST`, `ACCOUNT_PORT`   | `0.0.0.0`, `8766`                                                                     | account                                                                              |
| `ALLOW_HTTP_ACCOUNTS`            | `0`                                                                                   | account, import, difficulty, mokuro                                                  |
| `CORS_ORIGINS`                   | as in `.env`                                                                          | account, import, difficulty, mokuro                                                  |
| `MIN_FREE_MB`                    | `1024`                                                                                | account                                                                              |
| `CATALOG_OUTPUT`                 | `/data/state/catalog/catalog.json`                                                    | import (rebuilds the catalog after adding books)                                     |
| `CATALOG_BUILDER`                | `/usr/local/bin/build-calibre-catalog`                                                | import                                                                               |
| `CALIBREDB`                      | `calibredb`                                                                           | import                                                                               |
| `IMPORT_STATE_DIR`               | `/data/state/import` (queue, `jobs.json`)                                             | import                                                                               |
| `IMPORT_HOST`, `IMPORT_PORT`     | `0.0.0.0`, `8767`                                                                     | import                                                                               |
| `CALIBRE_WRITE_LOCK`             | `/data/state/import/calibre-write.lock`                                               | import, `assign-series.py`                                                           |
| `CALIBRE_BACKUP_DIR`             | `/data/state/import/backups` (last 5 `metadata.db` copies)                            | `assign-series.py --apply`                                                           |
| `CALIBRE_DEBUG`, `ASSIGN_SERIES` | `calibre-debug`, `/app/assign-series.py`                                              | import (admin panel → Tools → Series)                                                |
| `INTERNAL_TOKEN_FILE`            | `/data/state/internal-token` (made by the web container)                              | web (nginx sends it), account, import, difficulty (only answer requests carrying it) |
| `UPDATE_STATE_DIR`               | `/data/state/update` (`request.json`, `status.json`, `engine-status.json`, `updater`) | account, `ebook-update` on the host                                                  |
| `CALIBRE_CATALOG`                | `/data/state/catalog/catalog.json`                                                    | difficulty                                                                           |
| `JITEN_STATE_DIR`                | `/data/state/difficulty` (results, `frequency-dictionary.zip`)                        | difficulty                                                                           |
| `JITEN_FREQUENCY_DICTIONARY`     | `JITEN_STATE_DIR/frequency-dictionary.zip`, bundled if missing                        | difficulty                                                                           |
| `JITEN_WORKERS`                  | `DIFFICULTY_WORKERS`                                                                  | difficulty                                                                           |
| `JITEN_HOST`, `JITEN_PORT`       | `0.0.0.0`, `8765`                                                                     | difficulty                                                                           |
| `SYNC_DIR`                       | `/data/sync` (read-only; `ttu-reader-data/<title>/bookdata_*.zip`)                    | difficulty (readings files)                                                          |
| `MOKURO_STATE_DIR`               | `/data/state/mokuro` (`<id>.json` per manga, `models/`, `work/`)                      | mokuro                                                                               |
| `MOKURO_HOST`, `MOKURO_PORT`     | `0.0.0.0`, `8768`                                                                     | mokuro                                                                               |
| `MOKURO_BIN`                     | `/opt/mokuro/bin/mokuro` (without it, only uploads)                                   | mokuro                                                                               |

Readings files: with the `difficulty` profile and the frequency list installed, the service
also makes a readings file per book (`state/difficulty/readings/<id>.json.gz`, about 1 KB per
1,000 characters; [docs/READINGS.md](READINGS.md#readings-files)) from the processed book a
reader uploaded to the shared sync folder. Anyone who may use that folder can ask for one
(`POST /calibre/difficulty/api/readings/<id>`, answered `ready`, `queued` or `unavailable`)
and fetch it (`GET` on the same address); nginx allows 6 requests a minute per address (burst
10). They are made one at a time in a process of their own (about 300 MB while there is work,
under a second per novel), never waiting behind an estimate job; at most 100 wait, and a book
whose `staticdata.json` is over 30 MB is skipped.

The reading engine's tables and the frequency list are built once into
`state/difficulty/reader.ygp` and `frequency.ygp` (about 80 MB and 25 MB, ~25 s, again when
yurigana, the frequency list or the term dictionaries change); every worker maps those files
instead of building its own copy, so workers share them and start at once (an estimate worker
uses about 500 MB while scoring a novel).

Term dictionaries (optional, bring your own): admins can add Yomitan term dictionaries in the
admin panel (Tools → difficulty estimates → Add term dictionary; `POST /calibre/difficulty/api/terms?name=<file name>`,
admins only, up to 256 MB, refused with fewer than 1,000 usable terms with kanji). They are kept in
`state/difficulty/term-dictionaries/` and read by yurigana (`Reader(terms=...)`) for words the frequency
list and JMdict both lack (coined compounds, names, words Sudachi doesn't know), in word lists and readings
files from the next job on; readings files made before become stale. Estimates made before keep their word
lists until redone. Each large dictionary costs every worker about 20 s at start and under 100 MB.
JMnedict (a Yomitan name dictionary, recognised by its title) is read as a name dictionary
instead (`Reader(names=...)`): names it reads only one way (姫路 ひめじ) count as sure readings in readings
files; it changes no reading. Removing one (`POST …/terms/remove`) works the same way.

The catalog builder takes the library and the output file as arguments:
`build-calibre-catalog <library> <catalog.json> [<vn folder>] [--force]`.

Word lists read ambiguous words (柄: がら, つか or え) with a small model learned from books'
furigana ([yurigana](https://github.com/blankiekun/yurigana)). The image ships a small one (42 words) trained on Aozora Bunko and Tatoeba; a model
built from your own library (`state/difficulty/reading-model.json.gz`, about 400 words for
19,000 books) is used first when you build one (optional; until then the shipped one is used):

    docker compose exec difficulty /opt/venv/bin/python -m yurigana.reading_context build

It reads the whole library with `DIFFICULTY_WORKERS` processes: for 19,000 books about
25 minutes of mining on 3 and 3 minutes of training, up to about 3 GB of RAM, with its working
files (about 0.85 GB) in `state/difficulty/reading-model-scratch/` until it is done. Run it
when the server is idle (no estimates running). It prints how it scored on held-out authors.
The next estimates use it; no restart is needed. Run it again after adding many books. The
model holds word statistics from your books: keep it on the server (it is in `DATA_PATH`,
not in git).

## Accounts

Not configuration files but commands, in the `account` container
(`docker compose exec account ebook-account …`):

| Command                                     |                                                             |
| ------------------------------------------- | ----------------------------------------------------------- |
| `add NAME [--admin]`                        | Create an account (asks for a password, 8+ characters).     |
| `passwd NAME`                               | New password; signs out its sessions.                       |
| `admin NAME on\|off`                        | Make or unmake an admin (the last admin can't be removed).  |
| `permissions NAME import,series,difficulty` | What a non-admin may do besides reading (`''` for nothing). |
| `remove NAME`                               | Delete the account; its data folder stays.                  |
| `list`                                      | Accounts, ids, creation dates and rights.                   |

Admins can do the same in the admin panel (Settings → Account → Open admin panel).
