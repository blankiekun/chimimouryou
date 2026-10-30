# Architecture

This describes the parts this fork adds and how they connect to upstream's
ッツ Ebook Reader. Upstream's own design is only covered where the fork depends
on it. Running it: [docs/INSTALL.md](docs/INSTALL.md); every setting:
[docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Overview

```
Browser (static SvelteKit app, apps/web)
 ├─ IndexedDB: books, bookmarks, statistics (upstream "books" DB)
 │             highlights, recaps, lorebooks, audiobooks, kanji seen (ttu-annotations, data/reader-db.ts)
 ├─ localStorage: settings, API keys, theme, settings-sync change times
 └─ fetch ─────────────────────────────────────────────┐
                                                        ▼
nginx: the `web` container (server/nginx-ebook-reader.conf.template)
 ├─ /                       static build (the app)
 ├─ /api/v1/…               → `api` container (api:8769): catalog, reading data, text copies,
 │                            game records; DATA_PATH/state/api/library.db
 ├─ /calibre/library/…      book files + cover.jpg, read-only (Calibre library)
 ├─ /calibre/vn/…           unpacked visual novels (VN_PATH), read-only, JSON listings
 ├─ /account/api/…          → `account` container (account:8766)
 ├─ /calibre/import/api/…   → `import` container (import:8767, optional), writes the library
 ├─ /calibre/difficulty/…   → `difficulty` container (difficulty:8765, optional)
 ├─ /calibre/mokuro/…       → manga text files; `api/` → `mokuro` container (mokuro:8768, optional)
 ├─ /audiobookshelf/…       → AUDIOBOOKSHELF_URL (API and sign-in only, optional)
 └─ /jiten/…                → jiten.moe search and deck lengths (Find details, signed in)

Every location except the app itself is checked by auth_request against the
account service: reads need an account, a trusted network (TRUSTED_NETWORKS) or
PUBLIC_READS; writes to /api/v1/ need an account or a trusted network (signed
out: the shared account ''); /calibre/import/, difficulty jobs and series, book
details and cover writes need an admin or the import/
difficulty/series permission (auth/shared/writes, auth/import,
auth/difficulty/writes, auth/series/writes).

Browser → https://openrouter.ai directly (Ask AI, Story so far, Lorebook)
Browser → https://api.elevenlabs.io directly (AI voice)
Browser → AniList / VNDB directly (Find details), huggingface.co (Whisper models),
          AnkiConnect on the reader's machine, api.github.com (update checks)
```

The app is static; its storage API is the `api` service (`server/api/`), which
keeps every account's reading data as rows in one SQLite database. The `catalog`
container (build-catalog.py) fills its books and still writes `catalog.json` as
the internal input of the difficulty, mokuro and import services. The Python services are small HTTP servers behind nginx, each
in its own container (bound to localhost with a host-network setup such as
`deploy/examples/tailscale-https`). Accounts
and the catalog use only the standard library (plus Pillow for covers); import
needs Calibre, difficulty needs Sudachi and ONNX Runtime.

## Frontend modules (apps/web/src/lib)

| Area           | Files                                                                                                                                                                                                                  | Notes                                                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calibre source | `data/calibre.ts`, `data/server-api.ts`, `data/server-rows.ts`, `data/storage/handler/server-handler.ts`                                                                                                               | A storage handler like upstream's GDrive/OneDrive ones, backed by the catalog and the account's rows (`/api/v1`).                                                                                   |
| Accounts       | `data/account.ts`, `data/account-settings-sync.ts`, `components/settings/settings-{account,admin}.svelte`                                                                                                              | Session check, sign-in, settings sync to `settings.json`, admin panel and permissions.                                                                                                              |
| Book safety    | `functions/file-loaders/utils/sanitize-book-html.ts`, `vite.config.js` (`csp`)                                                                                                                                         | Book HTML parsed inert and cleaned; CSP allows only the site's own scripts.                                                                                                                         |
| Manga          | `data/manga.ts`, `functions/file-loaders/cbz/load-cbz.ts`, `routes/m/+page.svelte`                                                                                                                                     | CBZ/ZIP as ordinary book records; page index as the bookmark.                                                                                                                                       |
| Visual novels  | `data/vn.ts`, `functions/file-loaders/vn/load-vn.ts`, `routes/v/+page.svelte`, `static/vn/` (engine + `player.js`), `scripts/conscripter/`                                                                             | ONScripter games as book records (zip blobs, or a `VN_PATH` folder fetched file by file); CONscripter in an iframe sends each page's text and where it was drawn, laid over the canvas for Yomitan. |
| Highlights     | `data/annotations.ts`, `functions/book-text/text-positions.ts`, `functions/book-text/css-highlights.ts`, `components/book-reader/{selection-toolbar,highlight-editor,annotations-panel}.svelte`                        | Anchored by character counts, drawn with the CSS Custom Highlight API.                                                                                                                              |
| Search         | `functions/book-text/book-search.ts`, `components/book-reader/book-search-panel.svelte`                                                                                                                                | Paragraph index without furigana; results are character counts.                                                                                                                                     |
| AI             | `data/ai-settings.ts`, `data/ask-ai.ts`, `data/recap.ts`, `components/book-reader/{ask-ai-panel,recap-panel}.svelte`                                                                                                   | OpenRouter chat completions, streamed.                                                                                                                                                              |
| Listen         | `data/tts.ts`, `data/tts-audio-cache.ts`, `data/audiobook.ts`, `functions/tts/extract-reading-text.ts`, `functions/audiobook/subtitles.ts`, `components/book-reader/{listen-panel,tts-player,audiobook-player}.svelte` | AI voice from ElevenLabs with timestamps; audiobooks matched to the text by their subtitles.                                                                                                        |
| Lorebook       | `data/lorebook.ts`, `components/book-reader/{lorebook-panel,reader-panel}.svelte`                                                                                                                                      | Incremental from `processedUpTo`; recap model.                                                                                                                                                      |
| Home tab       | `data/library-home.ts`, `data/learner-stats.ts`, `data/kanji-seen.ts`, `components/book-card/{learner-dashboard,series-results}.svelte`                                                                                | Home/Store tabs, learner stats, series "Add all".                                                                                                                                                   |
| Themes         | `data/theme/*`, `components/theme/theme-style.svelte`, `components/settings/settings-theme*.svelte`                                                                                                                    | Every colour is a CSS variable (`theme-tokens.ts`); see `themes.md`.                                                                                                                                |
| Library        | `components/book-card/library-{sort,filters}.ts`, `continue-reading-shelf.svelte`, `difficulty-*.svelte`                                                                                                               | Sorting, filters, series and difficulty.                                                                                                                                                            |
| Settings page  | `routes/settings/+page.svelte`, `components/settings/settings-sections.ts`                                                                                                                                             | Sidebar sections; search over `SettingsItemGroup`s.                                                                                                                                                 |
| Plugins        | `plugins/index.ts`, `plugins/plugin-settings.ts`, `plugins/{ai,audiobookshelf}.ts`, `components/settings/settings-plugins.svelte`                                                                                      | Built-in modules (off by default) that add companion tabs, toolbar actions, Listen modes and settings.                                                                                              |
| Audiobookshelf | `data/audiobookshelf.ts`, `components/book-reader/audiobookshelf-player.svelte`                                                                                                                                        | Finds the book's audiobook on an ABS server through nginx's `/audiobookshelf/`; subtitles drive the highlight.                                                                                      |
| Anki           | `data/anki.ts`, `components/anki-watcher.svelte`, `components/settings/settings-anki.svelte`                                                                                                                           | Polls AnkiConnect and fills audio/picture fields of new notes; for VNs, only notes whose sentence is a recent line (`vnLineFor`).                                                                   |
| Whisper        | `data/whisper.ts`, `functions/audiobook/whisper.worker.ts`, `functions/audiobook/whisper-audio.ts`                                                                                                                     | Subtitles for audiobooks made in the browser (transformers.js).                                                                                                                                     |
| Offline        | `data/offline-books.ts`, `cachedBookList` in `server-handler.ts`                                                                                                                                                       | Home books downloaded in the background; the cached list when the server can't be reached.                                                                                                          |
| Book page      | `components/book-card/book-details.svelte`, `data/book-metadata.ts`, `data/series-overrides.ts`                                                                                                                        | Details layer over `/manage` (shallow routing); AniList/VNDB/Jiten lookups and reader-made series saved as shared rows.                                                                             |
| Admin panel    | `routes/admin/+page.svelte`, `components/admin/*`, `data/app-update.ts`                                                                                                                                                | Accounts, updates, engine, catalog, series and difficulty tools.                                                                                                                                    |
| Reader page    | `routes/b/+page.svelte`                                                                                                                                                                                                | Upstream's reader plus the glue for all reader extras.                                                                                                                                              |

## Data flow

### Opening a Calibre book

1. The library lists the catalog (`GET /api/v1/catalog`, cached in IndexedDB
   `chimi-server` and fetched as a delta since its `rev`) with this account's
   progress from the sync mirror: `ServerStorageHandler.getBookList`.
2. On first open, `prepareBookForReading` downloads the EPUB/HTMLZ/TXT from
   `/calibre/library/`, processes it in the browser with upstream's loaders and
   caches the book in IndexedDB. Every device processes the book itself; only a
   gzipped text copy (no images) goes to `PUT /api/v1/books/{id}/text`, for
   readings files and estimates (not for manga or game folders).
3. Later opens use the IndexedDB copy unless it is older than the book's `added`
   time in the catalog (`getBook`).
4. Progress and statistics sync like upstream's cloud sources. For Calibre books
   sync is always on, regardless of the auto-replication setting.

Upstream stores metadata in **file names**:
`bookdata_<exporter>_<db>_<characters>_<lastModified>_<lastOpen>.zip`,
`progress_<exporter>_<db>_<lastBookmarkModified>_<progress>.json`, and so on
(`BaseStorageHandler.getBookMetadata`/`getProgressMetadata`). The replicator asks
each handler `getRecentModified(kind)` and `isUpToDate(kind, modified)`; the base
defaults parse those names (Drive, OneDrive, folders), the server handler reads
rows instead.

### Reading data on the server

`lib/data/server-api.ts` keeps a mirror of `GET /api/v1/sync?since=rev` per server
and account (`''` signed out on a trusted network) in IndexedDB `chimi-server`.
Progress, statistics per day, reading goals, highlights, book docs (recaps,
lorebook, VN saves, audiobook position, subtitles), account docs (settings, kanji,
words, immersion), series, book details and Windows game records are rows keyed by
account and the server's book id (`bookId`). Windows games have no book id: their
progress, statistics and VN saves are game docs keyed by account and game name, each
the whole file their sync folder held. Each write is one row with its
`modified` time; the server refuses an older one with 409 and the stored row, which
goes into the mirror. Extra sync files (`data/sync-files.ts`) keep their names and
map to rows in `ServerStorageHandler.readSyncFile`/`writeSyncFile`; a write over
rows that changed since they were read throws `SyncConflictError`.

Browser caches are scoped to the account too:

- Highlights of synced books record their owner in IndexedDB; a cache from another
  sign-in state is ignored (`AnnotationsController.load`).
- The sync mirrors of other readers are dropped when the browser's reader
  changes (`dropSyncMirrors`, called by `releaseReaderData`).
- Settings sync records the owning account in localStorage
  (`accountSettingsOwner`); tokens and change times are dropped on sign-out,
  session expiry or an account switch (`releasePreviousOwner`).

### Settings sync

`settings.json` holds `values` and per-key `modified` times. On each sync the
newer side wins per key; settings set before signing in are uploaded if the
account lacks them. Reader settings are stored as `reader.<phone|desktop>.<key>`
so phones and larger screens keep separate styles. Syncs are queued so they
never overlap; changes upload after 1.5 s or when the tab is hidden.

### Highlights

A highlight is `{ start, end }` in character counts, the same counting as
bookmarks (`get-character-count.ts`), so it survives re-rendering, font changes
and pagination. `getTextSegments` maps counts to DOM text nodes;
`BookmarkManager.getRenderedStartCount()` gives the offset of the rendered
section in paginated mode. `annotations.json` is merged per highlight (newest
`modified` wins; deletions are kept as tombstones).

### Server services

- **Catalog** (`build-catalog.py`, every `CATALOG_INTERVAL` seconds when
  `metadata.db` changed): reads a _copy_ of `metadata.db`, picks the best format
  per book, lists manga archives, extracts missing covers into the library (as
  the library owner), infers series from volume numbers, and fills `library.db`'s
  books with unique titles that stay put (a new same-title book gets ` (author)`).
- **API** (`api/service.py`): `/api/v1` over `state/api/library.db`: the catalog,
  search, the sync delta and row writes, text copies, covers and game records.
  `api/migrate.py` copies the old WebDAV sync folders in once (deploy hook).
- **Accounts** (`account/service.py`): scrypt passwords, throttled sign-in,
  sessions in SQLite, admins and per-account permissions, the `auth_request`
  answers (with `X-Account-Id`) for every protected location, and a free-disk
  guard for uploads.
- **Import** (`import/service.py`): a queue that adds uploaded files to Calibre
  with `calibredb add`, one at a time, then rebuilds the catalog; the only writer
  of `metadata.db`.
- **Difficulty** (`jiten/service.py`): on demand only; worker pools run Sudachi
  and the fast core (`core.py`: V98, shown on a 1-10 scale, and a log-rank histogram);
  results in `state/difficulty/difficulty.json`,
  each book's kanji counts in `state/difficulty/kanji/` (`GET kanji/ID`, for each
  reader's own kanji coverage, compared in the browser with the kanji they met) and its
  2,000 most frequent words with frequency ranks in `state/difficulty/words/` (`GET words/ID`,
  made on first request by a worker of its own).
  How those words get their readings (yurigana's `Reader`: book ruby, context rules, a reading model, defaults, Sudachi):
  [docs/READINGS.md](docs/READINGS.md); the engine is the
  [yurigana](https://github.com/blankiekun/yurigana) package (pinned tag, in the difficulty
  image's requirements and `apps/web/package.json`).

## Key design decisions

| Decision                                                              | Why                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static app + a small API service                                      | Upstream is a static app with GDrive/OneDrive sync; rows with `modified` times let devices merge per row and refuse stale writes (409), which file renames over WebDAV could not.                                                                                                                                                                 |
| Books are processed on each device; only a text copy is uploaded      | Upstream's loaders run in the browser and the Calibre file is already on the server; the server only needs the text (readings files, estimates).                                                                                                                                                                                                  |
| Character-count anchors for highlights, CSS Highlight API for drawing | Counts are already how bookmarks work, and they don't change with layout. Wrapping text in `<mark>` would change the DOM that pagination and counting depend on.                                                                                                                                                                                  |
| Python standard library services                                      | Nothing to install or update for accounts and the catalog; the attack surface is small.                                                                                                                                                                                                                                                           |
| Account data in `DATA_PATH`, apart from the library                   | Libraries often sit on shared storage that other machines or containers mount; account rows hold `settings.json` with API keys.                                                                                                                                                                                                                   |
| AI keys in the browser only, not synced                               | The AI features call providers from the browser; there is no server to hold the keys. Keys never sync (owner 2026-10-29): each device enters its own, and the account copy older builds left is removed on the next settings sync. A key is bound to its connection's provider and base URL, so a synced endpoint change can't send it elsewhere. |
| Docker as the only install path                                       | The access rules are the security boundary; one install keeps one copy of them, tested in CI.                                                                                                                                                                                                                                                     |
| Sanitizer plus CSP for book HTML                                      | Book HTML comes from whatever is in Calibre or a friend sends; cleaning it stops script, the CSP catches anything the cleaner misses.                                                                                                                                                                                                             |
| Catalog titles made unique                                            | Upstream identifies books by title (IndexedDB, folder names); the server keys rows by book id, and titles stay put once given.                                                                                                                                                                                                                    |

## Known limitations and tech debt

- **Trusted networks share one reader.** Signed-out readers from
  `TRUSTED_NETWORKS` read and write the shared account `''`'s rows and can upload
  text copies; set it empty when that isn't wanted.
- **Old sync folders.** `DATA_PATH/sync` and `accounts/<id>/ttu-reader-data/` stay after the
  migration until the release after deletes them.
- **No quotas.** Any account can fill the disk up to `MIN_FREE_MB`.
- **Book CSS is applied as-is.** It can restyle the page, though not run script.
- **No built-in backups.** Back up `DATA_PATH` (and the Calibre library).
- **`routes/b/+page.svelte`** is still the most fragile file to change. The fork's
  glue lives in `lib/` (highlights, search match and the line read aloud in
  `HighlightPainter`, readings in `analysis-tools.ts`, plugin hooks in
  `ReaderHooksSession`, panel helpers in `reader-panel.ts`); upstream's replication,
  open/down-sync, tracker and dialogs are still inline.
- **Ask AI context** clones the book DOM up to the selection to get the text
  before it, which is slow on very long books in continuous mode.
- **svelte-check** reports 13 errors that predate the fork (Svelte 4/5 types,
  `dialog-template.svelte`, FS Access types). ESLint's Svelte config only matches
  root-level files, so `.svelte` files are not linted (upstream config).
- Read aloud starts from the beginning of the paragraph containing the position.
- The AI voice highlight is per phrase (split at 。、 and quotes), from
  ElevenLabs' character timestamps; if they don't line up with the text, the
  whole chunk is highlighted.
- Audiobooks are per browser (not synced); kanji seen sync per account, signed-in only. Highlighting
  the line being read walks the rendered text on every line change, which costs
  more in continuous mode on very long books.
