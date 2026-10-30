# Contributing

How to change this fork. See `ARCHITECTURE.md` for how the pieces fit together,
`docs/INSTALL.md` for running it and `docs/CODEMAP.md` for a dense map of the code.

## Ground rules

- Avoid editing upstream files when a new file will do, so merging upstream
  (`git fetch upstream && git merge upstream/main`) stays easy.
- The project is GPL-3.0-or-later (README → License). New modules start with the license header ESLint requires
  (still the BSD one: it is GPL-compatible and keeps upstream merges simple; code ported from GPL projects such as
  Yomitan keeps its own GPL header and is exempted in `eslint.config.js`), then a short
  comment saying what the module is for and "Not part of upstream":

  ```ts
  /**
   * @license BSD-3-Clause
   * Copyright (c) 2026, ッツ Reader Authors
   * All rights reserved.
   */

  /**
   * What this module does and why. Not part of upstream.
   */
  ```

- New components use runes (`$props`, `$state`, `$derived`; `section-head.svelte` is the example).
  Existing ones stay in Svelte 4 syntax (`export let`, `$:`, stores with `$`) until converted;
  `routes/b/+page.svelte` stays legacy for now. Svelte picks the mode per component, so don't mix
  the two in one file. RxJS `BehaviorSubject` stores for settings (`writable*LocalStorageSubject`).
- Colours come from theme CSS variables (`var(--surface-strong-color)`,
  `var(--reader-panel-bg)`, …), never fixed values.
- Commit messages: `fix: …`, `feat: …`, `refactor: …`, `test: …`, `docs: …`,
  `style: …`. One logical change per commit; bug fixes don't include refactors.
- Don't edit `CHANGELOG.md` in pull requests: it is written when a version is released, from the
  squashed commit titles since the last tag, so make the PR title say what a reader or server
  operator would notice.
- New UI strings go in both `lib/i18n/en.ts` and `lib/i18n/ja.ts` (whole sentences
  with `{param}`s), used as `$t$('key')` in components and `tr('key')` elsewhere.
- Never put API keys, passwords or other secrets in the repository, in shared
  rows (the signed-out account `''`, series, book details), in URLs or in log/error messages
  (`redactSecret` in `data/ai-settings.ts`).

## Commands

Front end (Node 24; pnpm 10 comes from `packageManager` via `corepack enable`):

```sh
pnpm install
cd apps/web && pnpm test && pnpm check   # Vitest; svelte-check (13 known errors)
pnpm exec playwright install --only-shell chromium && pnpm test:browser   # browser tests
cd ../.. && npx eslint .                 # clean
cd apps/web && pnpm dev                  # dev server; the server side needs the Docker stack
```

Without Node on the machine, run the same in a container from the repository root:

```sh
docker run --rm -e HUSKY=0 -v "$PWD":/src -w /src node:24-slim sh -c \
  'corepack enable && pnpm install --frozen-lockfile && cd apps/web && pnpm svelte-kit sync && pnpm test && pnpm check'
```

Python tests (catalog builder, account and import services, frequency list). The difficulty
scripts import [yurigana](https://github.com/blankiekun/yurigana); install the pinned release
first (its Sudachi dependencies are only needed for the tests that skip without them):

```sh
pip install --no-deps "$(grep '^yurigana' engine/requirements.txt)"
python3 -m unittest discover -s engine/tests
python3 -m unittest discover -s server/tests
```

Run the whole thing: `docker compose up -d --build` (see `docs/INSTALL.md`).

## Pull requests

`main` only changes through pull requests (ruleset "protect main"): its six CI
checks must pass, nothing is force-pushed or deleted, and branches are deleted
once merged.

1. `git switch -c fix/short-name origin/main`, commit, `git push -u origin HEAD`.
2. `gh pr create --fill`: the title becomes the squashed commit's message, so
   write it like one (`fix(vn): …`). Fill in the template's checklist.
3. When CI is green, **Squash and merge** (`gh pr merge --squash`).
4. Upstream syncs are the exception: `git switch -c sync/upstream origin/main &&
git merge upstream/main`, open a PR and merge it with **Create a merge
   commit** (`gh pr merge --merge`). Squashing it would lose upstream's history,
   and every later sync would conflict again.

## CI and releases

- `.github/workflows/ci.yml` runs on every pull request and on `main`: ESLint, unit
  tests and a production build of the front end; the Python tests and an nginx
  config render; the compose files and a build of all four images.
- `.github/workflows/release.yml` publishes the images for amd64 and arm64 to
  GitHub's container registry when a version tag is pushed:

  ```sh
  git tag -a v1.2.0 -m v1.2.0 && git push origin v1.2.0
  ```

  gives `ghcr.io/<owner>/<repository>-{web,services,import,difficulty}` tagged
  `1.2.0`, `1.2` and `latest` (pre-releases like `v1.2.0-rc1` don't move
  `latest`). First write the version's `CHANGELOG.md` section from the commits since the last tag
  (`git log --oneline <last tag>..main`): what readers and server operators notice, grouped
  under Added / Changed / Fixed / Security, and commit it. The first
  publish creates private packages: make them public in the repository's
  Packages settings.

- Check workflow changes with `actionlint` (e.g. `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint .github/workflows/*.yml`).

## Testing expectations

- Unit tests sit next to the module (`foo.ts` → `foo.test.ts`) and use Vitest with
  jsdom. Python tests live in `server/tests/` (the difficulty engine's in `engine/tests/`) and use `unittest`.
- Browser tests (`foo.browser.test.ts`, `pnpm test:browser`, `vitest.browser.config.js`) run in
  headless Chromium (Vitest browser mode, Playwright), apart from `pnpm test`. Write one only for
  what jsdom can't do: layout and positions (where the reader lands, what is on screen), vertical
  text, `::highlight` and other rendering. They use the real IndexedDB, no `fake-indexeddb`; see
  `routes/b/bookmark-restore.browser.test.ts`, which mounts the whole `/b` page.
- A bug fix comes with a test that fails before the fix.
- Before refactoring code without tests, add tests that pin its current behaviour.
- Svelte compiles with `immutable: true`: a store or variable only updates when
  it gets a new object, so `set = new Set([...set, x])`, not `set.add(x)`.
- Patterns to copy:
  - Components: mount with `new Component({ target, props })`, click, then
    `vi.waitFor` (see `reader-panel.test.ts`). Modules reading
    `window.matchMedia` need a stub (see `account-settings-sync.test.ts`).
  - IndexedDB: `import 'fake-indexeddb/auto'` (see `annotations.test.ts`).
  - Network: `vi.stubGlobal('fetch', vi.fn(...))` and assert on what was sent
    (see `account-settings-sync.test.ts`, `tts.test.ts`).
  - Signed-in state: `vi.mock('$lib/data/account', …)` with a hoisted user.
  - The storage handlers import each other: import
    `$lib/data/storage/storage-handler-factory` before a handler, or mock
    `server-handler` (see `kanji-seen.test.ts`).
  - The v1 API: `fakeApi` in `data/test-utils/fake-api.ts` (see
    `server-handler.test.ts`).
- `pnpm check` has 13 errors that predate the fork; only new ones matter.
- Reader changes also need a manual check with a book open (paginated and
  continuous modes): the browser tests cover only reopening at the bookmark.

## Adding things

**A setting** - add a store with `writable*LocalStorageSubject` (in
`data/store.ts`, or `data/ai-settings.ts` for AI), a control in the relevant
`components/settings/` component inside a `SettingsItemGroup` (so search finds
it), and, to sync it with accounts, the store in `sharedSettings` or
`readerSettings` in `data/account-settings-sync.ts`. A secret also goes in
`secretSettings`, so it is removed when the account changes.

**A reader feature** - put the logic in `lib/data/` or `lib/functions/` as plain
TypeScript with tests, the UI in `components/book-reader/`, and keep the glue in
`routes/b/+page.svelte` small. Positions are character counts
(`text-positions.ts`), never DOM offsets.

**A plugin** - for optional reader features, add a module to `lib/plugins/`
and list it in `plugins/index.ts`: companion tabs, selection-toolbar actions,
Listen modes, `onPositionSettled` work and a settings component. Plugins start
off; hosts read `activePlugins$`, so nothing runs until a reader turns it on.

**A per-reader file for Calibre books** - a sync file (`data/sync-files.ts`)
maps to a row kind in `server-handler.ts` (`bookDocs` per book, `accountDocs` at
the root, used by `readSyncFile`/`writeSyncFile`), and the server must allow that
kind: the `book_docs`/`account_docs` check in `api/apidb.py` and the `docs/(…)`
route in `api/service.py` (plus `migrate.py`'s map if old folders hold it).

**A server endpoint** - add a route to the service's `ROUTES` (accounts) or
`do_GET`/`do_POST` (difficulty), proxy it in `nginx-ebook-reader.conf.template` if it
needs a new location (with an `auth_request` check; new `${…}` placeholders go in
`render-nginx.sh`'s list), add a test in `server/tests/`, and rebuild the
stack. Account POST routes get the HTTPS and Origin checks automatically.

**A configuration option** - read it from the environment in the service (or
`render-nginx.sh` for nginx), pass it through `docker-compose.yml`, document it in
`.env.example` and `docs/CONFIGURATION.md`, and keep the default safe.

## Example: a typical change

Adding a "Copy" button to the Ask AI answer:

1. `git switch -c feat/copy-button origin/main && git status` - a branch, starting clean.
2. If the logic is more than a line, add it to a module in `lib/data/` or
   `lib/functions/` with a test.
3. Add the button in `components/book-reader/ask-ai-panel.svelte`, styled with
   theme variables.
4. Run `pnpm test`, `pnpm check` (still 13 errors) and `npx eslint .` (clean).
5. Rebuild and restart the stack, then open a book on the HTTPS address, select
   text, ask, and try the button. Check `/version.txt`.
6. Commit (`feat: copy button for Ask AI answers`)
   and open a pull request (see Pull requests).
