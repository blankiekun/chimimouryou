# Readings and furigana

Two pieces of the app decide how a kanji word is read. Both come from
[yurigana](https://github.com/blankiekun/yurigana), a separate package pinned to a release
(`scripts/calibre/jiten/requirements.txt` and `apps/web/package.json`). Its README describes
the engine: the order of readings, the flavour rule, the reading model, certainty, how to
build a table and the accuracy numbers.

- The difficulty service reads every word of a book for its **word lists**: a word with
  two readings becomes two rows, 他 read ほか and 他 read た.
- The difficulty service also writes a **readings file** per book: every kanji word's reading
  in the reader's own character positions, and the furigana the reader may add.
- The reader's **"Known" furigana style** decides which of a book's own ruby to hide.

Neither one changes the book or the difficulty scores.

## Word-list readings (difficulty service)

`Analyzer.analyse` in [`scripts/calibre/jiten/features.py`](../scripts/calibre/jiten/features.py)
counts a reading for each occurrence of a word in `Analysis.readings`, and `save_words` in
`service.py` writes the rows. The readings are yurigana's `Reader`, the same one readings files
use (below), so both agree: the book's ruby (`book_text`, `aozora_text` and `vn_text` give it
as hints), a context rule, the reading model, the list's only reading, a default (私 わたし,
言う いう rather than ゆう), number readings (三百 さんびゃく), rendaku, else Sudachi's
reading; conjugated occurrences get the dictionary form's reading too. One `Reader` per
worker, with the Analyzer as its tokenizer (no second tokenizing of the book) and the
worker's reading list. Name ruby is not carried to later bare occurrences (`read()` without
`carry`): a name's word list row is left out anyway. Readings files carry it and gloss the
carried readings (below).

A row is a Sudachi word (its form, part of speech and lemma), and only a `Reader` word over
exactly that word's token gives its reading:

- A number + counter span (三本 さんぼん) is not a row: Jiten's list has 三 and 本 apart.
  The number is noise (left out of the totals) and the counter, a suffix to Sudachi, is an
  affix, left out like the others. A counter Sudachi keeps in one token with its number
  (一回) is a row with the span's reading (いっかい, not Sudachi's いちかい).
- Tokens the `Reader` joins into a compound the list gives one reading (三日月 みかづき, 3-4%
  of a book's kanji tokens) keep Sudachi's reading each.

The reading list (`known`) is Jiten's frequency list (`FrequencyTable.reading_ranks`): a
reading is always hiragana and one that list gives for the written form. Katakana ruby still
counts for `RubyKatakanaShare`, which is measured separately.

An occurrence without a reading goes to the word's most common reading in the book, in
`save_words`. A word met only without one takes the form's most common reading in the book
(from another dictionary word with the same form), else Sudachi's reading of the form alone
(`Analysis.form_readings`). Rows of one form and reading are merged, and each row also carries
the lemma (Sudachi's normalized form). A voiced reading the list lacks counts for the
unvoiced one it gives (この箱 read ばこ: はこ), so it gets the word's rank; a voiced reading the
list has stays (造り in 石造り: づくり).

**Tables** (`READING_MODEL_TABLES` in `service.py`): `state/difficulty/reading-model.json.gz`
is the server's own table, when one has been built from its library (optional: none exists
until you build it; [docs/CONFIGURATION.md](CONFIGURATION.md#python-services) has the
command); yurigana's public table fills in the forms it lacks, or answers alone without it. A form
with a context rule is answered by a table only when no rule fires, and only if the table lists
it in `ruleForms` (trained on the occurrences no rule reads, yurigana 0.2.0); other tables'
entries for those forms are dropped.

### Versions

- **`WORDS_VERSION`** (`service.py`) is stored with each estimate. Bump it, with a comment,
  whenever a new yurigana release (or anything above) changes which reading a word gets;
  "Books without an estimate" then redoes those word lists. Before moving the pin, compare
  `python -m yurigana.evaluate SET.jsonl --known frequency-dictionary.zip` (gold sets from
  `python -m yurigana.evaluate tatoeba OUT`, yurigana's docs/evaluation.md) in the difficulty
  image with the old and the new tag.
- **`MODEL_VERSION`** is for the difficulty scores. They use `Word.reading` (always
  Sudachi's), never `Analysis.readings`, so reading changes leave it alone
  (`test_features.py` checks the features with and without a `Reader`).

## Readings files

`scripts/calibre/jiten/readings_file.py`, made on request by the difficulty service
(`POST /calibre/difficulty/api/readings/<id>`, docs/CONFIGURATION.md) into
`state/difficulty/readings/<id>.json.gz`. The reader does not use them yet.

**Input**: the reader's own processed book, `staticdata.json`'s `elementHtml` in the newest
`bookdata_*.zip` of the title's shared sync folder (`sync/ttu-reader-data/<title>/`, the title
as `sanitizeForFilename` writes it). It is counted exactly like the reader counts bookmarks
(`get-paragraph-nodes.ts`, `get-character-count.ts`): `<rt>` and `[hidden]`/`[aria-hidden]`
subtrees left out, a gaiji image is one character, the same set of counted characters, code
points. `scripts/calibre/tests/fixtures/character-count.json` is checked by both sides
(`test_readings_file.py`, `character-count-fixture.test.ts`). The book's ruby goes to yurigana
as hints, like `book_text`.

**Readings**: yurigana's `Reader` with the word lists' reading list (Jiten's frequency list)
and tables, as for word lists. The whole book is one text read with `carry={}`, so a name's ruby is carried to its
later bare occurrences (`source` 'book', also earlier ones for names of 2+ characters); those are glossed (see below).

**Format** (gzipped JSON):

- `v` (`READINGS_VERSION`), `yurigana` (its version), `bookdata` (the file it was made from) and
  `characters` (the book's count): a file whose `v`, `yurigana` or `bookdata` differ is stale
  and made again on the next request.
- `words`: `[form, reading or null]`, dictionary forms (行った: 行く).
- `glosses`: `[[offset, length, base, ruby], ...]`, the surface's reading (yurigana's
  `surface_reading`: 来た: 来/き) split over the word's kanji runs (行っ: 行/い; 取り扱い: 取/と,
  扱/あつか), offsets in characters from the word's start; `base` is the text the ruby goes
  over, for the reader to check.
- `occ`: `Δstart, word, gloss` per kanji word in reading order; `gloss` is `-1` when no
  furigana is to be added. A number + counter span (三本 さんぼん) comes right before its
  tokens' own words, at the same start (Δstart 0 for the first of them).

**What gets furigana** (a gloss): a hiragana reading on the list that comes from the list's
only reading, a context rule, the reading model or a name's ruby carried from elsewhere in the book
(never Sudachi's guess, a default or a counter span); not under the book's
own ruby; and not a form the book flavour-rubied earlier: once ruby that isn't the word's
reading covers it (katakana like マジ over 本気, ruby with kanji, or rejected hiragana over the
whole word like そら over 宇宙), later bare occurrences of that form get none. Partial hiragana
ruby (と over 取 of 取り扱い) doesn't count as flavour.

## The reader's "Known" furigana style

With "Hide furigana style" set to Known (reader settings, `FuriganaStyle.Known`), the reader
hides ruby the reader probably no longer needs
([`apps/web/src/lib/data/known-furigana.ts`](../apps/web/src/lib/data/known-furigana.ts)).
`reactiveElements` (`components/book-reader/reactive-elements.ts`) marks each rendered
section's `<ruby>` with `ttu-known-ruby` (hidden; a click shows it again) when yurigana's
`hideKnownRuby` holds: the ruby is hiragana, every kanji of the base was met at least
`knownKanjiMinCount` (10) times over all books (`data/kanji-seen.ts`, read once per opened
book), and the reading is spelled by the kanji's readings (`isPlainReading`,
`yurigana/kanji-readings.json` from KANJIDIC2). Katakana ruby, ruby with kanji, gikun and
jukujikun stay.

This is independent of the difficulty service's readings: it uses no Jiten list, rules or
model.
