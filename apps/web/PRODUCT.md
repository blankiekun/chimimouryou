# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Japanese learners** (intermediate and up) reading native material from their own library: novels, manga and ONScripter visual novels, usually with Yomitan open for lookups. They read on desktops and phones, often for long sessions, in vertical or horizontal text.
- **A household sharing one server**: several readers on one self-hosted install, each with their own account, progress, highlights and known words.
- **The owner as admin**: manages accounts, permissions, imports, difficulty estimates, series and updates from the admin panel.

## Product Purpose

chimimouryou is a self-hosted reader for a Calibre library, built for learners. It is a fork of ッツ Ebook Reader (ttu-ttu/ebook-reader): the reading view and its Yomitan support are upstream's; the fork adds the server, accounts, sync and the learner tools. Success is a learner opening the app, finding the next thing worth reading at their level, reading it with lookups and mining, and seeing their progress grow, without their data leaving their server.

## Positioning

One self-hosted place where a learner's whole library (books, manga, visual novels) is read, measured (difficulty estimates, known-word coverage, words met, Read next) and mined (Anki), with the data on their own server. Upstream ッツ reads files but has no library or server; Komga/Kavita serve libraries but know nothing about learning Japanese; jiten.moe measures difficulty but doesn't hold your books or your reading.

## Operating Context

- Runs in the browser against a Docker stack on a home server or VPS; Calibre's `metadata.db` is the library of record, and books added in the app go into Calibre.
- Readers sign in (HTTPS, or HTTP on a single machine); reader data syncs per account; the library works offline from cached books.
- Lookups come from Yomitan in the reader's own browser; mining goes to Anki through AnkiConnect.
- AI helpers (Ask AI, Story so far, Lorebook, AI voice) use the reader's own OpenRouter/ElevenLabs keys, stored per browser.

## Capabilities and Constraints

- Static SvelteKit app (no server-side rendering at runtime); Python services for accounts, import, catalog, difficulty and manga text.
- Reading: vertical and horizontal text, paginated and continuous modes, furigana styles (including Known and generated furigana), highlights and notes, search, audiobooks and AI voice.
- Learner tools: difficulty estimates (chimi-difficulty), known-word coverage, New words, words met, Read next, statistics, Anki mining.
- Library: Home (dashboard, Continue reading, Read next, My books) and Store (books or series), book pages with details from AniList/VNDB/Jiten.
- Must stay Yomitan-friendly: the book DOM is never modified for highlights; VN text is laid out as real text over the canvas.
- Strict CSP: no inline scripts or `on*=` attributes.
- Themes colour the whole app through CSS variables; components never use fixed colours.
- UI language is English or Japanese (`en.ts`/`ja.ts`); AI prompts have both languages too.
- Separate reader settings for phones and larger screens.
- Plugins (AI, Audiobookshelf) are off by default; the core must work without them.
- Internal names from before the rename (`ebook-reader`, `ttu-reader-data`, `ttu_session`) stay for existing installs.

## Brand Commitments

- Name: chimimouryou (lowercase). Credit upstream ッツ Ebook Reader as the origin of the reader.
- Voice in docs and UI: plain, factual, short sentences; no marketing superlatives.

## Evidence on Hand

- README screenshots: `assets/readme/screenshots/` (reader, home, store, series, details, companion, ask AI, search, manga, themes, admin, phone home). They show books from the maintainer's own library; titles belong to their publishers.
- Docs: `README.md`, `docs/INSTALL.md`, `docs/CONFIGURATION.md`, `ARCHITECTURE.md`, `docs/READINGS.md`, `CHANGELOG.md`.
- No testimonials, user counts, press or benchmarks exist; don't invent them.

## Product Principles

1. **Reading comes first.** Learner tools surround the book; they never get in the way of reading or of Yomitan.
2. **The reader's data is theirs.** Everything stays on their server; secrets never reach shared files, URLs or errors.
3. **Measure, don't nag.** Difficulty, coverage and progress inform choices; nothing runs or pops up without being asked (recaps, estimates).
4. **One library, every format.** Books, manga and visual novels share one library, one sync and one set of learner tools.
5. **Works for a household.** Accounts, permissions and per-reader data make one server serve several readers.

## Accessibility & Inclusion

- Built-in themes must pass WCAG AA (`themes.test.ts`).
- Bilingual UI (English/Japanese) and Japanese text rendering (vertical text, ruby) are first-class.
- Phones and touch are fully supported, including the reader's gestures.
