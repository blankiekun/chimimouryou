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
`service.py` writes the rows. The first step that gives a reading wins:

1. the book's ruby (yurigana's `ruby_reading`; `book_text`, `aozora_text` and `vn_text` give
   the ruby as hints)
2. a context rule (`context_reading`)
3. the reading model (`ReadingModel`)
4. Sudachi's reading (`Word.reading`)

The reading list (`known`) is Jiten's frequency list (`FrequencyTable.reading_ranks`): a
reading is always hiragana and one that list gives for the written form. Katakana ruby still
counts for `RubyKatakanaShare`, which is measured separately.

Sudachi gives a reading only for an unconjugated word. A conjugated occurrence without one
goes to the word's most common reading in the book, in `save_words`. A word met only
conjugated takes the form's most common reading in the book (from another dictionary word
with the same form), else Sudachi's reading of the form alone (`Analysis.form_readings`).
Rows of one form and reading are merged, and each row also carries the lemma (Sudachi's
normalized form).

**Tables** (`load_reading_model` in `service.py`): `state/difficulty/reading-model.json.gz`
is the server's own table, built from its library
([docs/CONFIGURATION.md](CONFIGURATION.md#python-services) has the command); yurigana's
public table fills in the forms it lacks. Forms with a context rule are never answered by a
table.

### Versions

- **`WORDS_VERSION`** (`service.py`) is stored with each estimate. Bump it, with a comment,
  whenever a new yurigana release (or anything above) changes which reading a word gets;
  "Books without an estimate" then redoes those word lists. Before moving the pin, compare
  `python -m yurigana.eval_readings --dictionary frequency-dictionary.zip` in the difficulty
  image with the old and the new tag.
- **`MODEL_VERSION`** is for the difficulty scores. They use `Word.reading` (always
  Sudachi's), never `Analysis.readings`, so reading changes leave it alone.

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
and tables, so a word reads the same in both.

**Format** (gzipped JSON):

- `v` (`READINGS_VERSION`), `yurigana` (its version), `bookdata` (the file it was made from) and
  `characters` (the book's count): a file whose `v`, `yurigana` or `bookdata` differ is stale
  and made again on the next request.
- `words`: `[form, reading or null]`, dictionary forms (行った: 行く).
- `glosses`: `[[offset, length, base, ruby], ...]`, the dictionary form's reading split over the
  word's kanji runs (行っ: 行/い; 取り扱い: 取/と, 扱/あつか), offsets in characters from the
  word's start; `base` is the text the ruby goes over, for the reader to check.
- `occ`: `Δstart, word, gloss` per kanji word in reading order; `gloss` is `-1` when no
  furigana is to be added.

**What gets furigana** (a gloss): a hiragana reading on the list that comes from the list's
only reading, a context rule or the reading model (never Sudachi's guess); not under the book's
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
