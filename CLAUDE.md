# CLAUDE.md

chimimouryou: a fork of [ttu-ttu/ebook-reader](https://github.com/ttu-ttu/ebook-reader) (ッツ Ebook Reader), a browser-based EPUB/HTMLZ reader aimed at Japanese text, extended into a self-hosted reader for a Calibre library: accounts, sync, highlights, AI helpers, manga, visual novels, a dictionary, difficulty estimates, social. It runs on any server with Docker (`docker-compose.yml`, guide in `docs/INSTALL.md`).

The details of a particular deployment (hosts, addresses, how it is deployed and rolled back) are in `CLAUDE.local.md` when present; it is not in git.

**Code map:** `docs/CODEMAP.md` describes every feature that isn't upstream's: its files, stores, sync files, server endpoints and gotchas. Read the entry for a feature before changing it, before writing a brief about it, or when a file's role is unclear.

## Repository layout

- pnpm workspace: the only web app is `apps/web`, a SvelteKit app built with `@sveltejs/adapter-static`. The output is purely static; there is no server-side code at runtime.
- `apps/desktop`: an Electron shell around the standalone build with Yomitan loaded; never part of the Docker images.
- `apps/web/src/routes/`: pages. `b/` is the reader (`b/+page.svelte` is large), `m/` manga, `v/` visual novels, plus `manage/` (library), `settings/`, `statistics/`, `words/`, `friends/`, `admin/` and `auth/`.
- `apps/web/src/lib/components/`: UI components (`book-reader/` is the reading view, `settings/` the settings UI). `lib/data/`: stores, settings and storage/database code; books live in the browser (IndexedDB), synced with the server (Calibre source) or GDrive/OneDrive. `lib/functions/`: parsing, file loaders and utilities. `lib/plugins/`: built-in plugins (`ai`, `audiobookshelf`, `social`). `lib/vendor/yomitan/`: vendored Yomitan (GPL-3.0, ESLint-ignored, keep upstream's style).
- `scripts/calibre/`: the server side: nginx template, catalog builder and Python services (accounts, import, difficulty, mokuro) with their tests.
- `docker/`, `docker-compose.yml`: the Docker install. `scripts/deploy.sh` deploys the working tree to a server; `deploy/` holds the server commands, Pages workflow, social hub (Cloudflare Worker) and examples.
- Standalone edition (`VITE_EDITION=standalone`, `standalone` in `lib/data/env.ts`): the same app without a server, published to GitHub Pages. Gate server features in `lib/` and hide their UI; it must send no request to `/calibre/` or `/account/` (`standalone.test.ts`).
- Styling: Tailwind 3 + SCSS.

## Git workflow

- The fork's branch is `main` on GitHub; upstream is the `upstream` remote. Internal names (`ebook-reader` compose project, `/opt/ebook-reader`, `ttu-reader-data` sync root, `ttu_session` cookies) predate the name and stay: changing them would break existing installs.
- `main` only changes through pull requests with green CI (CONTRIBUTING.md → Pull requests): branch from `origin/main`, push, `gh pr create`, squash-merge. Never push to `main` directly.
- To pull upstream updates: a `sync/upstream` branch with `git merge upstream/main`, merged with a merge commit (`gh pr merge --merge`), never squashed.
- Commit with clear messages (`feat:`, `fix:`, `docs:` …) so changes are easy to rebase or merge against upstream.
- CHANGELOG.md is written at release time from the squashed commit titles; PRs leave it alone.

## Rules that hold everywhere

- Security: `kit.csp` (hash mode) allows only the site's own scripts, so boot code goes in `static/`, with no inline scripts or `on*=` attributes. Book HTML goes through `parseBookHtml`/`sanitizeBookElement` (`file-loaders/utils/sanitize-book-html.ts`). API keys and tokens stay out of shared files, URLs and error messages (`redactSecret`); secret settings are listed in `account-settings-sync.ts`.
- Privacy: nothing goes to the social hub before sign-up or while the `social` plugin is off (`standalone.test.ts`), except anonymous GETs of public Community posts (feed, threads, thread, covers; no token), sent only when the reader opens the Community tab or a line deep link. Reading tables or word rows built from copyrighted books stay on the machine that made them, never in git.
- Design: "Study Book" (`apps/web/DESIGN.md`) is the default UI: flat, square 2px corners, one green spot colour, English UI text. Components use theme colours only: CSS variables or the Tailwind colours mapped to them in `tailwind.config.cjs` (`themes.test.ts` checks every built-in theme for WCAG AA).
- Settings that should follow the account go in `sharedSettings` (`account-settings-sync.ts`).
- Jiten's API is for personal projects and small-scale research only; the server never calls it.
- A yurigana bump that changes readings needs a `WORDS_VERSION` bump (difficulty service).

## Commands and tests

- Front end (Node 24, pnpm 10 from `packageManager`): `pnpm test` (Vitest + jsdom, `src/**/*.test.ts`), `pnpm test:browser` (`*.browser.test.ts` in headless Chromium, for layout/positions/vertical text/`::highlight`; needs `pnpm exec playwright install --only-shell chromium`) and `pnpm check` (svelte-check) in `apps/web`, `npx eslint .` from the repo root. Without Node installed, run them in a `node:24-slim` container (CONTRIBUTING.md).
- Python tests: `python3 -m unittest discover -s scripts/calibre/tests` (standard library plus yurigana: `pip install --no-deps` its line of `jiten/requirements.txt`, or put its source on `PYTHONPATH`).
- Baseline: tests all pass, ESLint is clean, `pnpm check` has 13 pre-existing errors (`skipLibCheck` hides the libraries' own). Keep it that way.
- When dependencies change, regenerate `pnpm-lock.yaml` with pnpm 10 (`pnpm install --no-frozen-lockfile`; `CI=true` forces frozen mode); image builds use `--frozen-lockfile`.
- Svelte 5: new components use runes; existing ones stay legacy (Svelte 4 syntax) until converted, `routes/b/+page.svelte` included. `runes` isn't forced, so Svelte picks per component. Legacy components compile with `immutable: true` (the `sveltekit({...})` options in `apps/web/vite.config.js`; SvelteKit 3 has no `svelte.config.js`): assign new objects/arrays/Sets, never mutate and reassign the same one, or nothing re-renders. `$lib` stays through the `alias` option; `page` comes from `$lib/data/page-store` (a store over `$app/state`), since `$app/stores` is gone.
- Test patterns: component tests mount with `new Component({ target, props })` (`compatibility.componentApi: 4` under Vitest only; Vitest uses Svelte's browser build, see `reader-panel.test.ts`), `fake-indexeddb/auto` for IndexedDB, `vi.stubGlobal('fetch', …)`, `vi.mock('$lib/data/account', …)` for signed-in state. Storage handlers import each other in a cycle: import `storage-handler-factory` first or mock `calibre-handler`. Components that pull in `account-settings-sync` need it mocked (`settings-account.test.ts`).
- CI (`.github/workflows/ci.yml`): ESLint, `pnpm test`, build, Python tests, compose check and all five image builds (on pull requests only when image inputs change: `docker/`, compose files, `scripts/calibre/`, package manifests, lockfile, workflows; main and tags always). Releases (`release.yml`): tag `v*` → images for amd64/arm64 on GHCR, used via `IMAGE_PREFIX`/`IMAGE_TAG`.
- Docs: README.md (overview), docs/INSTALL.md and docs/CONFIGURATION.md (running it, every setting), docs/CODEMAP.md (features), ARCHITECTURE.md (design, data flow, tech debt), CONTRIBUTING.md (conventions, how to add things), docs/QA.md (manual test plan), docs/READINGS.md (how word lists read words, Known furigana).

## Fragile areas

- `routes/b/+page.svelte`: huge; the reader extras' glue lives inline. Keep new logic in `lib/` modules with tests and verify with a real book in both view modes.
- Sync file names carry metadata (`bookdata_*`, `progress_*`, upstream's `BaseStorageHandler`); renaming or adding prefixes affects every device.
- Book titles are identities (folder names). Changing how `build-catalog.py` makes titles unique orphans synced data.
- `scripts/deploy.sh`: the server-side steps are single-quoted `bash -c '…'` strings run through `run`; a single quote inside one ends it early. Over SSH they are re-quoted with `printf %q`, so keep them plain bash.
- `local/` and `CLAUDE.local.md` are gitignored and hold one deployment's settings; never commit them.
- The nginx template is rendered with `envsubst` limited to its own `${…}` names (`render-nginx.sh`); new placeholders must be added to that list, and nginx's own `$variables` must stay unbraced or unlisted.

## Verifying changes

After deploying, check that the pages load (`/`, `/manage`, `/settings`, `/version.txt`) over HTTP and HTTPS, and that `/version.txt` shows the commit.
For UI changes, verify the relevant route in a browser if possible. Reader changes need an actual book loaded, which is stored per browser.
