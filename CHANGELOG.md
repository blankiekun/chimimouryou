# Changelog

chimimouryou is a fork of [ッツ Ebook Reader](https://github.com/ttu-ttu/ebook-reader);
upstream's own changes are not listed here. Add an entry under "Unreleased" for
anything a reader or a server operator would notice.

## Unreleased

### Security

- Only admins can import the frequency list for difficulty estimates (the `difficulty`
  permission no longer can). The server refuses lists with fewer than 50,000 words, and
  a list replacing an installed one whose readings for the 5,000 most frequent words agree
  with it on less than 95% needs a confirmation that shows the share.

### Added

- Reader: generated furigana (Settings → Reader, next to Hide furigana): words
  the book gives no furigana get yurigana's reading from the difficulty service, in a colour
  leaning towards the theme's accent. Calibre books only; the server prepares a book the first time
  (they appear when ready). Hide/hover furigana styles apply to them too.
  Each book's furigana are kept in the browser, so the book opens with them at once (offline too)
  and they are only downloaded again when the server's copy changes; a book being prepared is asked for
  again after 3 s rather than 15 s. The server prepares a book in ~3 s, and reuses a book's furigana when it is processed
  again with the same text (another device, or deleted and reopened). Home's books get their furigana
  in the background, and a book's page asks for them, so books usually open with them already there.
- Reader: generated furigana also go over names (and other words) the book gives ruby once and
  leaves bare elsewhere, with the book's own reading. Readings files are made again on the next request.
- Reader: a "Hover" furigana style (hidden, shown while the pointer is over a word; tap toggles on
  touch screens) and a "Furigana on hover" switch in the reader's quick settings (palette icon).
- Difficulty estimates: admins can add Yomitan term dictionaries of their own (admin panel → Tools,
  difficulty estimates). Word lists and readings files then read words the frequency list lacks
  (coined compounds, names, words the tokenizer doesn't know) from them. None is
  bundled; without one nothing changes.
- Difficulty estimates: an uploaded JMnedict is read as a name dictionary (yurigana 0.5.1): names
  it reads only one way (姫路 ひめじ) are sure readings in readings files. Before, it gave nothing.

### Changed

- yurigana 0.5.7: 川 after a name is voiced (メコン川 がわ) and names a book rubies in large kana
  (佳樹《かじゆ》) are read with small kana (かじゅ). Word lists are redone (`WORDS_VERSION` 15) and
  readings files made again on request.
- Generated furigana: every word with a reading gets it, not only the ones yurigana is
  sure of (defaults, dictionary readings and counter spans too). Readings files are redone.
- Difficulty service: the reading engine's tables and the frequency list are built once into
  `state/difficulty/reader.ygp` and `frequency.ygp` and shared by every worker, so workers
  start at once and use about 750 MB less each (an estimate worker ~500 MB instead of ~1.25 GB).
  Estimates count marker expressions from an index of the book's words rather than scanning
  it once per expression (~2 s less per novel).
- yurigana 0.5.3: readings for word lists and generated furigana (the top reading of 118 more
  words shown, voiced tails after a noun, 血肉 ちにく) and about 40% faster reading. Word lists
  are redone (`WORDS_VERSION` 12) and readings files made again on request. The readings worker
  now stops 2 minutes after its last book rather than 10.
- yurigana 0.5.5: readings for word lists and generated furigana: glued compounds from a
  shipped table, the top reading of 226 more words shown, casual spellings (ながーい, ふいんき) no
  longer hide a word, and context rules for 何, 方, 様, 上, 子, 一, 間, 前, 頭 and 今日. Word lists
  are redone (`WORDS_VERSION` 13) and readings files made again on request (`READINGS_VERSION` 6).
- yurigana 0.5.6: names a book rubies and uses as names (honorifics, speaker tags) are read the
  book's way through the whole book, more two-reading words read from context (抱く, 間, 札, 描く,
  止める, 側, 空く, 家, 方, 何, 主 …), 辛い no longer shown as つらい where it means spicy, and better
  verb forms in word lists (入れる, 通っ, 行っ). Word lists are redone (`WORDS_VERSION` 14) and readings
  files made again on request (`READINGS_VERSION` 7).

- Japanese UI: reworded strings throughout (595 of 973) to read more naturally.

### Fixed

- Cancelling a difficulty job stops it within a second instead of after the books in progress
  finish, and the panel shows "cancelling…" until it has stopped.
- Word lists and readings files: 行っ on a going cue (学校へ行った) reads いっ, not おこなっ (yurigana
  0.5.1). "Books without an estimate" redoes the word lists (`WORDS_VERSION` 11).

- Word lists of difficulty estimates read words like readings files do (yurigana's whole
  reader): 私 わたし, 言う いう, 一回 いっかい, 三百 さんびゃく, 鶏肉 とりにく, and conjugated
  words (買って かう). "Books without an estimate" redoes the word lists (`WORDS_VERSION` 8);
  the difficulty scores are unchanged. Estimates take about 0.9 s longer per book.
- Words met, known words and coverage: a word list the server failed to send (restart,
  sign-in) is retried instead of treated as missing; books read before kanji were recorded
  count from their synced progress; a finished book counts as read through; a word met only
  conjugated (no reading) is one word with its reading; noise words no longer count on Home;
  Anki fields with Yomitan furigana, several words (`<br>`, 、, ・ …), a leading 〜 or a
  trailing する (勉強する also covers 勉強) are read right; cached coverages are redone
  when a book is re-estimated. Marks are by word, not reading (unless the book reads it two
  ways), so new word lists keep them; "Mark known" in the reader also offers conjugated
  selections. The book page says "at least N%" and tells the words new in its list from the
  rarely used ones past it, and the 95% sentence says it counts by frequency rank.

### Documentation

- The README is ordered for whoever sets the server up: what it is, setup, then "How you
  read with it" (Yomitan → Anki → next book by difficulty), the features (learner ones
  first) and the credits last.
- docs/LEARNING.md, a guide for learners: Yomitan and dictionaries, its secure container
  and the tracker's dictionary detection, AnkiConnect and the card fields, furigana, manga
  text and reading a book's difficulty and kanji met. Linked from Home and Settings → Anki.

### Server

- The difficulty service uses SudachiDict-core instead of SudachiDict-full (yurigana's new default): the image is
  about 130 MB smaller and each worker uses about 100 MB less RAM. With it comes yurigana 0.3.0,
  which reads more hard words right (開く あく after 穴, 描く かく after a picture, 四つ よっつ,
  三日月 みかづき…) and splits some compounds differently (word lists version 9, readings
  files version 3: run "Books without an estimate" once to redo the lists).
  Difficulty scores move by at most 0.05 (0.01 on average), so existing estimates are kept.
- Word lists version 7: words met only conjugated get a reading (the form's reading in the
  book, else Sudachi's), one form and reading from different dictionary words is one row
  (ある, もの, よう), particles and auxiliaries (です, ます, らしい, ながら…) are left out by
  part of speech, and each row carries a 5th column, the lemma, so spelling variants
  (分かる/わかる/判る) match Anki words and marks. Run "Books without an estimate" once
  (admin panel → Tools) to redo the lists; it also adds the word totals to estimates that
  lack them.
- yurigana v0.2.0 (pinned in the difficulty image and the web app). Word lists (version 7)
  get its context rules for more words with two readings (表 主 抱く 家 側 傍 間 後 方 留まる …)
  and count a voiced reading the list lacks for its unvoiced one (この箱 ばこ: はこ). Readings
  files (version 2) also get its numbers with counters (三本 さんぼん), rendaku and default
  readings, carry a name's ruby to its later bare occurrences without adding furigana for it,
  and gloss 来た as き.
- Readings files: with the `difficulty` profile, the service makes a file per book with every
  kanji word's reading in context and the furigana the reader may add, in the reader's own
  character positions (`POST`/`GET /calibre/difficulty/api/readings/<id>`, for every reader who
  may use the shared sync folder, rate-limited). It reads the processed book in the shared sync
  folder, which the `difficulty` service now mounts read-only (`SYNC_PATH`). Nothing in the
  reader uses them yet (docs/READINGS.md → Readings files).
- The readings in context (the book's ruby, context rules, the reading model and its tools)
  and the "Known" furigana check moved to their own package,
  [yurigana](https://github.com/blankiekun/yurigana) (v0.1.1, pinned), which the difficulty
  image and the web app install. Word lists read exactly as before; the command that builds
  a server's own reading model is now `python -m yurigana.reading_context build`.
- Recommended server sizes per profile (docs/INSTALL.md → Server size). The `difficulty`
  and `mokuro` services get a lower CPU share (`cpu_shares: 512`) in `docker-compose.yml`
  itself, not only in the Tailscale example.
- Deprecated: the `adjusted` field of `/calibre/difficulty.json`. It has been a copy of
  `difficulty` since chimi-difficulty and the app no longer reads it; the release after
  this one stops writing it. Scripts reading it should use `difficulty`.
- Difficulty estimates also save each book's 2,000 most frequent words with their frequency
  rank (`state/difficulty/words/`, about 20 KB per book; `GET /calibre/difficulty/api/words/<id>`),
  for word lists on the book page. "Books without an estimate" redoes existing estimates once
  to add them.
- Word lists keep a word's readings apart: 他 read ほか and 他 read た are two rows, each with
  its own count and frequency rank (before, the first occurrence's reading counted for all).
  "Books without an estimate" redoes word lists made before this once (`words` in
  `difficulty.json`). The difficulty scores don't change.
- Word lists take a word's reading from the book's own furigana when it gives an ordinary
  reading: 人気 with ひとけ above it counts as ひとけ, not にんき. Flavour readings (マジ over
  本気, そら over 宇宙) are ignored. "Books without an estimate" redoes word lists once;
  the difficulty scores don't change.
- Word lists use more of the book's furigana (about 79% of it instead of 32%): furigana over
  the kanji of an inflected word (行《い》った counts as 行く read いく, 上手《うま》く as うまい),
  furigana set kanji by kanji (人《ひと》気《け》), and older books' large kana (いつしよ is
  いっしょ). "Books without an estimate" redoes word lists once; the difficulty scores don't
  change.
- Without furigana, word lists read about 30 ambiguous words from the words around them:
  人気がない is ひとけ, 今日の社会 こんにち, 舞台の上手 かみて, 金を貸す かね, and 明日 is あした
  except in formal phrases (明日の日本). "Books without an estimate" redoes word lists once;
  the difficulty scores don't change.
- 人気がない in word lists is only ひとけ with a place or absence word around it (周囲に人気がない,
  人気がない場所); この店は人気がない and 人気のない奴 stay にんき. "Books without an estimate"
  redoes word lists once; the difficulty scores don't change.
- Where no rule applies, a small model learned from books' furigana reads ambiguous words
  from the words around them (柄 がら/つか/え, 踵 かかと/きびす, 何 なに/なん). The one that
  ships is trained on Aozora Bunko's public-domain works and half of Tatoeba's reviewed
  sentences (CC BY 2.0 FR), and keeps only the 42 words it reads no worse than before on the
  other half. A server can build its
  own from its library, which suits modern books better (`docker compose exec difficulty
/opt/venv/bin/python -m yurigana.reading_context build`, about half an hour for
  19,000 books; see docs/CONFIGURATION.md). "Books without an estimate" redoes word lists
  once; the difficulty scores don't change.
- Estimates store `uniqueWords` and `tokens` in `/calibre/difficulty.json`: the book's
  different words and their occurrences, without particles, numbers and lone kana, for the
  reader's word coverage. Only new estimates have them; nothing is redone.

### Library

- Mark words known or ignored by hand: ✓ and ✕ on each of a book page's New words and
  "Mark all shown known", and "Mark known" in the reader's selection toolbar when the
  selection is a word of the book's list. Both count as known in coverage, New words, Read
  next and Home's Words known, with or without Anki. Settings → Anki → Known Words lists them
  to search and unmark. Synced as `words.json` in the account folder while signed in.
- Words known over time: the Statistics page has a "Words known" chart and Home's Words
  known tile shows "+N this month". Both are estimates rebuilt from the characters read
  each day and the books' word lists (words met 8 times); Anki's words count only in
  today's total. Computed in the browser and cached; nothing new is synced.
- Home's "Kanji met" is replaced by **Words met** and **Words known**: the words of the
  Calibre books you have read (from the server's word lists and how far you got, so past
  reading counts; text skipped by a jump and particles don't), known once met 8 times or
  mature in Anki. Kanji are still recorded.
- Word coverage replaces Anki-only known words: a book's page says how many different words
  it uses and how much of its text you already know ("N different words, X% of its words
  already known (M new)"), with known meaning met 8 times or mature in Anki, so it works
  without Anki. "Words to study first" becomes **New words**: those you don't know yet,
  frequent in the book and rare in general first, with Copy and the CSV of the same list.
  Difficulty details on selected books, the Store's "Known words" sort and Read next use
  the same coverage. New estimates count the words past the book's 2,000 most frequent
  as unknown; older ones count only those 2,000, and the page says so.
- Japanese interface (Settings → General → Language · 言語, English by default, synced with
  the account), separate from the AI's language. This release translates the header, Home,
  the book page (difficulty bands and badge included), the settings page's sidebar,
  Settings → Anki and → AI (with the key setup guide), the rest of the settings (reader,
  tracking, data, account, themes, plugins, Audiobookshelf; the theme editor's colour names
  and the storage source dialogs stay English), the library (the Store's toolbar, filters and
  sorting, select mode, the difficulty dialog, Make series and the manga text row) and the
  reader (header and menus, dialogs, table of contents, tracker, highlights, search, Listen,
  Ask AI, Story so far and Lorebook); the rest of the app follows.
- A book's page lists the new kanji: the 30 most frequent kanji in the book you haven't
  met yet, with a button that copies them.
- The difficulty badge's tooltip says what the band means for a learner, and that the
  likely range holds the true score for about 8 books in 10.
- Home has a "Read next" shelf: the next unread volume of each series you have started, then
  unread books within ±0.3 of the median difficulty of your last 3 finished books, those with
  the most known words from Anki first (otherwise the closest in difficulty). Hidden until a
  finished book has a difficulty estimate.
- The book page lists "Words to study first": words the book uses often that are outside the
  most common words needed for 95% of it (`words95`), by count in the book, with a CSV
  download (word, reading, count, frequency rank) for Anki. Shown once the book has an
  estimate with a word list.
- Known words from Anki (Settings → Anki → Known Words, off by default): the words of a deck's
  mature cards (interval of 21 days or more, read through AnkiConnect at most once a day) are
  marked ✓ in the book page's "Words to study first", which says how many of them you know
  (by written form, an estimate). The Store gets a "Known words" sort by the share of those
  words' occurrences you know, for the books where it was worked out (pages opened, Home's
  books); the rest come last. Kept in this browser only and forgotten when another account signs in.
- Deleting books in the Calibre library (select mode → Delete) now removes them from the
  library for admins, after a confirmation: books go to Calibre's recycle bin
  (`calibredb remove`), visual novel folders are deleted, and the catalog is rebuilt
  (`POST /calibre/import/api/remove`, admins only). For other accounts, Delete still
  removes only the synced data. The import service empties Calibre's recycle bin of books
  deleted more than 14 days ago once a day (Calibre itself only does so when the library
  is opened).
- Kanji met now sync between devices for signed-in readers (`kanji.json` in the account's
  folder; each book keeps its newest record, counts are not added). Signing in as another
  reader or signing out clears them from the browser; they come back on sign-in.

### Reader

- New "Known" furigana style (Settings → Reader → Hide furigana style): furigana is hidden
  over words whose kanji you have all met at least 10 times while reading (synced with your
  account), and shown everywhere else; click a word to show it. Only plain hiragana
  readings are hidden: katakana or kanji furigana and unusual readings the author chose
  (マジ over 本気, そら over 宇宙) always show, as do special readings such as きょう over
  今日 and kanji outside 常用/人名用. Kanji met count from the next time a book is opened.
- A "Grammar" Ask AI preset (AI plugin): it goes through the grammar points and
  conjugations of the selection with their dictionary forms. Preset lists you have already
  saved are kept as they are; Settings → AI → "Reset to defaults" adds it to them.

### Manga

- Manga text with [mokuro](https://github.com/kha-white/mokuro): the manga reader lays the
  text of each speech bubble over the page, under the pointer or always (reader settings →
  Page text), so Yomitan can look it up. A book's page shows whether a volume has text;
  accounts with the `import` permission make it on the server ("Make text on the server",
  one volume at a time, about 5 s a page on a CPU) or upload a `.mokuro` file made on
  another computer. Server operators: the optional `mokuro` compose profile (a 2 GB image;
  the models, about 450 MB, go to `DATA_PATH/state/mokuro/models/`), text in
  `state/mokuro/<id>.json`, served as `/calibre/mokuro/<id>.json`.

- Opening a Calibre manga for the first time is much faster: its pages are no longer
  re-zipped and uploaded to the sync folder (a 100 MB volume uploaded 100 MB before it
  opened); each device loads the CBZ from the library instead.

- The manga reader works more like Mihon: pinch, double tap or Ctrl+wheel to zoom, and drag
  a zoomed page around; swipes drag the page along with the finger; scale types (fit screen,
  width, height, original size, smart fit); two-page spreads on screens wider than tall (the
  cover and wide pages stand alone, Shift fixes pairs that are off by one); and a settings
  sheet (gear in the menu) for these, the background (black, gray, white or matched to the
  page), double tap to zoom, keeping the screen on and the page number. Full screen is in the
  menu. The next few pages are decoded ahead, so turning is instant.
- Volumes of a series follow each other, as chapters do in Mihon: turning past the last page
  shows what you finished and the next volume, and turning again (or its button) opens it,
  downloading it first if needed; the same at the first page for the volume before. The menu
  has buttons for both, and the vertical strip ends with the next volume.
- Each series keeps its own reading mode (right to left, left to right or vertical), synced with
  your account, so a webtoon series stays vertical on every device; books outside a series
  open in the last mode chosen.
- Tap zones as in Mihon (settings sheet → Tap zones): L shape, Kindle, Edge, Sides or off, and
  inverted horizontally, vertically or both. By default the sides turn pages and, in the
  vertical strip, taps on the bottom or right scroll down most of a screen and the top or left
  scroll back up (the strip only showed the menu before).

### Visual novels

- Installing a new CONscripter release from the admin panel (Tools → Visual novel engine)
  now only downloads its web build from GitHub into `DATA_PATH/state/engine/`, which nginx
  serves ahead of the built-in engine: no copy of the app, no build, no restart. The
  web container drops it again once an app update ships the same or a newer engine.
  Browsers fetch the engine network-first (kept for offline play) instead of precaching it.
- Game sound no longer hiccups in Firefox (CONscripter v0.25.1 queues its audio ahead instead
  of filling it at the last moment on a busy page).
- CONscripter v0.30.0. Movies play in the player as in CONscripter's own web page: movies
  shown as pictures (which stopped the game before), `mpeghold` prompts, sound with a muted
  fallback when the browser blocks it, the video at the game's size, and Enter, Space or
  Escape to skip a skippable one. The script's `language` command sets the text layer's
  language.

### Fixes

- Switching the interface language while searching the settings (Ctrl+F) runs the search
  again on the translated texts, instead of leaving the earlier matches shown.

## v3.6.0 (2026-10-15)

### Visual novels

- Anki mining checks that a new card's sentence is from the game: the player keeps the last
  500 lines with their voice files (the newest 30 also with their screenshot and sound), and
  the card gets those of the line its Sentence field came from, even when the line has moved
  on by the time the card is noticed. Backlogs can be mined too, the built-in one and
  script-drawn ones: the card gets the line's voice and its screenshot from when it was shown,
  or the backlog's screen for older lines. Cards whose sentence isn't from the game (mined in
  another tab, for example) are left alone.

## v3.5.0 (2026-10-15)

### Visual novels

- Vertical text (e.g. Muramasa) is laid out as columns in the Yomitan overlay
  (`writing-mode: vertical-rl`), so lookups span several characters and the popup opens
  beside the column instead of over it.
- Synced saves (`vnsaves.json`) record the CONscripter version that wrote them. Opening a
  game whose saves come from a newer engine than the server's shows a notice: saves should
  be backward compatible, but an admin can update the engine if one doesn't load.
- CONscripter v0.23.0, which renames its web interface from ONScripter-yuri's `onsyuri*`
  names to `cons*` (`consText`, `g_cons_module`, `cons()`…); the player uses the new names,
  so it needs v0.23.0 or later, and `scripts/conscripter/build.sh` (and the admin panel's
  engine install) refuses older releases. Servers on v3.4.0 or older refuse v0.23.0 the
  same way, so update chimimouryou to get the new engine. Also new in the engine: sprite
  motions keep moving during a screen effect, arrows turn in vertical text, `openurl`,
  `strspoutline`, and global variables (unlocks) are saved at any wait, so auto mode
  keeps them.
- CONscripter v0.19.0. Anki cards get the line's voice file instead of a live recording
  (also for backlog pages; voices inside `.nsa` archives are still recorded), text the game
  has as read before (its kidoku data, also from other devices) no longer counts again,
  Yomitan's scan keys stop auto mode, and the header has toggles for the game's furigana
  and instant text.

### Documentation

- The README has a Features section with new screenshots (Home, Store, a book's page,
  search, highlights, Ask AI, manga, themes, the admin panel) instead of the reader controls
  reference, which stays in upstream's README.
- ARCHITECTURE, CONTRIBUTING, CONFIGURATION and QA brought up to date (plugins,
  Audiobookshelf, Anki, Whisper, offline reading, the book page, visual novel settings).

### Fixes

- Admin panel → Tools → Visual novel engine showed the old version after an install (the
  browser's offline copy answered the version check) and offered to install it again.

## v3.4.0 (2026-10-13)

### Updates

- A page left open across an update reloads itself once when it can no longer load parts
  of the old version, instead of showing a network error until a hard reload.
- Offline, or away from the server's network: the library lists the books already
  downloaded to the browser (with a note and a retry link, retried by itself when the
  connection returns) instead of an error and an empty library, and those books open
  from the browser copy instead of failing to load. Progress made meanwhile uploads
  once the server can be reached again.
- Books on Home (My books and Continue reading, not visual novels) are downloaded to the
  browser in the background while the library is open, so they can be read offline
  without opening them first.

### Visual novels

- Game files kept in the browser for games no longer in the library (removed from the
  server's folder, or deleted on another device) are deleted when the library loads.
- A game's length and difficulty estimate no longer count the name and voice tags at the
  start of lines (`[name|voice/v123.ogg]`) or colour and text size codes; voiced games
  were counted up to half again too long. Games processed before keep their old length
  until processed again; estimate them again for the difficulty.

## v3.3.0 (2026-10-13)

### Setup

- The README starts with a setup guide: a new or an existing Calibre library, on your own
  computer (HTTP sign-in on localhost) or on a server behind HTTPS.
- Signed out where the library needs an account, the library asks you to sign in instead
  of showing "Calibre catalog unavailable (HTTP 401)" and switching to browser storage.
- The plain-HTTP warning in Settings → Account is not shown on localhost, where nothing
  crosses a network.
- The Browser library source is gone from server builds (only the reader-only static build
  has it); a saved Browser choice moves to Calibre. Books stay cached in the browser as
  before.

### Visual novel engine updates

- Admin panel → Tools → Visual novel engine can install a new CONscripter release: the
  server's updater downloads it and rebuilds only the web container. App updates keep an
  engine installed this way when it is newer than the one in the commit.
- Server: `admin/update` also takes `{"engine": "<tag>"}` (only CONscripter's latest
  release is installed).

### Visual novel lookups in backlogs

- Yomitan works in visual novel backlogs: the engine's own and those a game's script draws
  (CONscripter 0.12.0 sends the text of `strsp` sprites whenever the game waits for input),
  and in script menus drawn the same way.
- The text box can be scanned again right after closing a backlog or menu that hid the text
  window, instead of only after the next click.

### Whisper subtitles

- The audiobook and Audiobookshelf players can make their own subtitles: Whisper runs in
  the browser (WebGPU when available, much slower without) and the result is matched to
  the book like a loaded SRT, and can be downloaded. The model (Base, Small or Large v3
  Turbo) downloads once from Hugging Face. Keep the tab open while it works.
- Server: nginx serves `.mjs` files as JavaScript (Whisper's runtime needs it).

## v3.2.0 (2026-10-13)

### Plugins

- Settings → General → Plugins switches optional features on or off for your account;
  every plugin starts off. The AI tools (Ask AI, Story so far, Lorebook, the AI voice
  and the ElevenLabs fallback for Anki cards) are now the "AI tools" plugin: switch it
  on to get them back; while off, their buttons, tabs and settings are hidden.
- New Audiobookshelf plugin: Listen → Audiobookshelf finds the book's audiobook on
  your Audiobookshelf server and streams it, keeping the listening position there
  (a single file out of a folder of several books keeps it in the browser). Books are
  matched by series name and volume, so titles with tags like (MFブックス) and
  audiobooks stored as one folder of volumes are found. With subtitles (an SRT or VTT
  stored next to the audio in Audiobookshelf, or loaded with the CC button) the line
  being read is highlighted, as in the audiobook mode. Sign in
  under Settings → Audiobookshelf. Server: set `AUDIOBOOKSHELF_URL`; nginx forwards
  only Audiobookshelf's API and sign-in, at `/audiobookshelf/`, to signed-in readers.

### Updates

- Admin panel → Tools → Updates has two channels: Stable (the default) updates to
  the latest release, Bleeding edge to the newest commit on main. Server: the
  updater accepts either; deploy.sh's `version.txt` now always names the commit.

### Visual novel engine

- The visual novel player runs CONscripter v0.10.0, taken from its own web release
  (`scripts/conscripter/build.sh` downloads the latest one; our text hook is now part of
  CONscripter). Admin panel → Tools → Visual novel engine shows the installed and the
  latest release.

### Security fixes (AUDIT.md)

- Server: the account, import and difficulty services only answer nginx, which
  sends them a secret (`X-Internal-Token`) that the web container keeps in
  `DATA_PATH/state/internal-token`; their ports are no longer an open back door
  for other processes on the host. Rebuild and restart all containers together.
- Server: the Series and Catalog tools in the admin panel are admin-only in the import
  service itself; an account with only the import permission could reach them
  through a URL nginx didn't match exactly.
- Server: the shared sync folder itself can no longer be deleted or written over
  WebDAV (one DELETE removed every book's data), and nginx's upload folder in it
  (`.tmp`) is no longer reachable. Deleting a book's own folder still works.
- Server: WebDAV MOVEs in the shared sync folder may only rename a file within its
  folder, so a MOVE can no longer write `series.json` or `metadata.json` without the
  series permission.
- Server: a damaged ZIP no longer stops the import queue for good; the file fails
  and the next one is added.
- Server: imports stop below `MIN_FREE_MB` like other uploads (uploads still in
  progress count), and a failed upload no longer leaves a partial file behind.
- Difficulty: uploading the frequency list no longer hangs until nginx times out
  with a 504.
- Accounts: when another account (or nobody) uses the browser, the previous reader's
  progress, statistics and reading goals for Calibre books are removed from it, so
  they are no longer shown to or synced into the next account. They come back from
  the server at the next sign-in.
- Accounts: AI keys typed while signed out are removed when an account signs in,
  instead of being saved to that account.
- Reader: the page only loads images from the server and the cover sites "Find
  details" uses, and fonts and stylesheets from the server, so a book's CSS can no
  longer reach outside hosts.
- Reader: a recap or lorebook update saved while its sync was fetching the server
  copy is no longer overwritten by that sync.
- Server: the sign-in rate limit can no longer be skipped with a trailing slash
  (`/account/api/login/`).
- Server: nginx only believes `X-Forwarded-Proto` from the addresses in
  `REAL_IP_FROM`. **Upgrading:** behind a reverse proxy that terminates HTTPS, set
  `REAL_IP_FROM` (docs/INSTALL.md → HTTPS) or signing in stops working.
- Difficulty: estimate, cancel and frequency list requests must come from the
  reader's own page (Origin check), like imports. Restart the stack with the new
  compose file (the difficulty service now reads `ALLOW_HTTP_ACCOUNTS`).

### Library

- Home and Store are in the top bar in place of "Library"; the logo opens Home.
- Removing a book from Home also takes it off Continue reading until it is read again
  (the shelf has a remove button too).
- The Store sidebar drops the Series and Tags filters (search still finds tags), and
  Books/Series is hidden while the Visual novels filter is on.
- Length filters count books not opened yet when they have a difficulty estimate, and
  100k–300k is split into 100k–150k, 150k–200k and 200k–300k.
- Visual novels can get difficulty estimates, from their scripts. Server: the
  difficulty container mounts `VN_PATH` at `/vn` (read-only).

### Book pages

- Clicking a book in the Store or a cover on Home opens its page instead of reading or
  selecting it: length (with reading time at your speed), progress, difficulty and kanji
  met, publisher, dates, tags and the other books of its series. "Resume" and "Read"
  open the book; a long press or right-click still selects.
- "Find details" on the page searches AniList (books, manga) or VNDB (visual novels)
  and saves the description, genres, score and optionally the cover for everyone
  (`/calibre/sync/metadata.json`). It needs the series permission, now called "Edit
  series and details". Server: the nginx template has a new location for that file.
- "Find details" can also search Jiten (novels, manga, visual novels), with its covers.
  Server: nginx proxies the searches at `/jiten/search` (Jiten's API only allows its own
  site), limited to 20 a minute per address; it needs outbound HTTPS from the web container.
- Details from VNDB replace a visual novel's folder name with its title on the page and
  in the library.

### Visual novels (ONScripter)

- Games from the server's VN folder over 10 MB offer to keep their files in the browser
  (Cache API, HTTPS only) so they start quickly next time; large files show a loading bar.
  The kept files are deleted with the game or when it is removed from Home. Game files
  are held in memory once instead of twice while they load.
- ZIPs of ONScripter games (a folder with `0.txt`, `00.txt`, `nscript.dat`…) open in a
  new player (`/v`) that runs the game in the browser (ONScripter-yuri, WebAssembly).
  Hover the game's own text to look words up with Yomitan: the player lays the page's
  text, invisible, over the characters the engine drew (clicks still go to the game).
  Choices and the system menu's items can be hovered too. The overlay follows the
  engine: it goes when the text does (new page, hidden window, menu or backlog), not on
  clicks, so clicking beside the game to close Yomitan keeps it.
  A panel below the game can show the text too (A button), with ruby as furigana.
  Import them like manga, or add them to Calibre: the catalog now lists them.
- Reading statistics, progress and "Kanji met" count the text as it is read (pages
  read before, or skipped, count once or not at all).
- Saves stay in the browser; for Calibre games they also sync per reader
  (`vnsaves.json` in the account's folder), newest copy of each save file winning.
- Games can also live unpacked in a folder of their own (`VN_PATH`, default
  `DATA_PATH/vn`, one folder per game) instead of Calibre: the catalog lists them in
  the Store, and the player fetches each file only when the game opens it, so nothing
  is downloaded whole or copied to the browser or the sync folder.
- ZIPs of games imported into the Calibre source (Library → Import, `import`
  permission) are unpacked into the visual novel folder instead of Calibre, up to 8 GB
  (Shift JIS file names are read correctly).
- Admin panel → Tools → Catalog rebuilds the catalog on demand.
- The library's Type filter has Visual novels next to Books and Manga.
- Server: nginx compresses `.wasm`.

### Anki mining

- Settings → Anki: with AnkiConnect, cards you add (e.g. with Yomitan) while a book or
  visual novel is open get media: for books the sentence cut from the book's audiobook
  (or, optionally, read by the AI voice when there is none or it lacks the sentence), for visual novels a screenshot and the game's sound since
  your last click. Fields already filled are left alone. Add the site's address to
  AnkiConnect's `webCorsOriginList`.

### Fixes

- Selecting books on Home (long press or right-click) no longer jumps to the Store; the
  shelves show the selection.
- A Calibre manga opened on a device that hadn't cached it yet (already read elsewhere)
  stayed on the loading spinner instead of opening in the manga reader.

### Server

- The account service no longer has `POST /account/api/import-shared` (copying data saved
  while signed out into an account); the app stopped using it, and `STORAGE_ROOT_NAME` is
  no longer read.

### Washi & Sumi redesign

- New look and default themes: Washi (warm paper, ink text, vermilion accent, mincho
  headings) and its dark pair Sumi, also the default pair for "Follow system theme".
  A theme chosen before stays selected; every built-in theme still works, and Sepia,
  Sakura, Nord and Solarized Dark have slightly stronger muted text (WCAG AA).
- Navigation is a flat bar anchored left (ち seal, section links, actions on the
  right); phones get a bottom tab bar.
- Library: covers without card boxes, title and author below, progress only on
  started books, a 読了 seal on finished ones, difficulty as a five-segment meter
  (the number is in the tooltip); quieter filters with counts on the active group.
- Home: today's characters as the main number, the streak, an 18-week reading
  heatmap and larger Continue reading covers with a Resume button.
- Settings: one column of rows instead of cards, switches for on/off settings,
  segmented controls, bordered inputs, collapsible nav groups, search that
  highlights matching rows, a list that drills into sections on phones, a compact
  Account section and a danger zone (clearing zombie statistics now asks first).
- Theme picker is a grid of swatches; the theme editor has a live preview, new
  colours (subtle text, accent hover, focus ring, success/warning, switches,
  progress, cover shadow, difficulty 1–5, heatmap) and warns about low contrast.
  Themes made before keep working: the new colours follow their existing ones.
- Reader panels (companion, search, Ask AI, Listen, notes, selection toolbar) match
  the theme with bordered inputs; the footer shows a hairline of the book's progress.
- Visible keyboard focus everywhere, and reduced motion turns off animations.

- While signed in, the Statistics page and the Home dashboard download the account's
  statistics and reading goals for every book, not only books opened in this browser.

## v3.1.0 (2026-10-12)

### Name and icon

- The app is called Chimimouryou in the tab title, header and installed app, with
  a ち icon in place of ッツ's. "Open Repository" in bug reports links to this fork.

### Difficulty estimates

- New model inputs from the Japanese readability research: the number of common
  words needed for 90/95/98% of a book's words, moving-average type/token ratio,
  relative clauses and predicates per sentence, hiragana share, kanji outside
  常用 and above 教育漢字, and furigana (how much of the kanji has ruby, and
  katakana readings like 本気→マジ). Word origins (和語/漢語) now come from
  UniDic, homographs (事 こと/じ) are looked up by reading, and tables of
  contents, colophons and ads are left out of the text.
- Estimates show a likely range and how many common words cover 95% of the book.
- The library's gauge button is open to every reader: it shows the selected
  books' estimates and how much of their kanji you have already met while
  reading in this browser. Starting estimates still needs the `difficulty`
  permission.
- The model is now called chimi-difficulty (`chimi-difficulty*.onnx`); estimates
  made by the previous model are redone by "Run" (`MODEL_VERSION`
  `chimi-difficulty-1`).

## v3.0.0 and earlier

First public release. Compared with upstream ッツ Ebook Reader:

### Library and server

- **Calibre library as the bookshelf**, served by nginx: a catalog built from
  `metadata.db` (tags, rating, publisher, series from Calibre or guessed from
  volume numbers, unique titles), covers extracted from EPUBs that have none,
  books processed in the browser once and shared through WebDAV.
- **Adding books**: importing a file into the Calibre source queues it for
  `calibredb add`; books whose title names an existing series are offered for it.
  `assign-series.py` writes guessed series into Calibre itself.
- **Library**: Home (learner dashboard, Continue reading, My books) and Store
  (books or series) tabs; filters for reading status, difficulty, series, length,
  tags and type; series in reading order; "Make series"; "Clear progress".
- **Manga**: CBZ and image-only ZIP files, in a page-turning reader (right to
  left, left to right, vertical strip).
- **Difficulty estimates** with Jiten's features and a model distilled from
  jiten.moe's scores, computed on the server on demand, started from the admin panel's Tools tab or for books
  selected in the library. The word frequency list (`jiten_freq_global.zip`)
  can be imported there.

### Accounts and sync

- **Accounts** (no sign-up; admins add them) with an admin panel (`/admin`,
  linked from Settings → Account: accounts, permissions and server tools) and
  per-account permissions (add books, edit series, difficulty estimates). The
  first start creates `admin` with a temporary password, shown in the deploy
  output and the account service's log until it signs in.
- Admin panel tools: **Series** (puts books without a series into the series
  their titles name and merges duplicate series, after a dry run; backs up
  `metadata.db` first) and **Updates** (compares the server with GitHub's main
  branch; servers set up with `scripts/deploy.sh` update and redeploy themselves
  through `ebook-update`, `UPDATE_REPO`). The updater only installs the current
  head of main and touches the shared state folder as the containers' user, so
  a compromised container can't pick the code root builds or redirect its writes.
- Progress, statistics, reading goals, highlights, recaps and lorebooks sync per
  account; AI settings and themes sync through `settings.json`, reader settings
  separately for phones and larger screens.
- Signing in over plain HTTP is possible with `ALLOW_HTTP_ACCOUNTS=1` (off by
  default; the app warns while it is in use).

### Reader

- **Highlights and notes** (four colours), anchored by character counts and drawn
  with the CSS Custom Highlight API; Markdown export.
- **Search** in the book, furigana ignored, with kana-insensitive and regex options.
- **Ask AI** about a selection (OpenRouter, presets, English or Japanese prompts),
  **Story so far** spoiler-free recaps, a **Lorebook** of characters and places
  (SillyTavern format), an **AI voice** (ElevenLabs) that highlights the line being
  read, and **audiobooks** matched to the text by their subtitles. Default models:
  `~google/gemini-flash-latest` for Ask AI, `~deepseek/deepseek-flash-latest` for
  recaps and the lorebook. Settings → AI has a setup guide for the OpenRouter and
  ElevenLabs keys, an "About you" note added to Ask AI questions (e.g. your level)
  and an AI voice speed. Ask AI presets: Explain, Translate and Nuance.
- **Themes** for the whole app, following the system's light and dark mode, with
  a theme editor and import/export (`themes.md`).
- A settings page with sidebar sections and search.

### Running it

- **Docker**: `docker-compose.yml` (web, account, catalog; optional import and
  difficulty), images for amd64 and arm64 published on tags; `scripts/deploy.sh`
  deploys a checkout to a Proxmox container, an SSH host or the local machine.
  Upstream's reader-only image is `docker-compose.static.yml`.
- **Security**: every location except the app checks access (accounts, trusted
  networks, `PUBLIC_READS`, permissions); `TRUSTED_NETWORKS` is empty by
  default, so signed-out visitors get nothing until you list your networks; synced files are served as downloads
  only; book HTML is sanitized and a Content-Security-Policy allows only the
  site's own scripts; sign-in throttling per username and address; uploads stop
  when the disk is nearly full; security headers.
