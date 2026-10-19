# Readings and furigana

Two pieces of the app decide how a kanji word is read. Both come from
[yurigana](https://github.com/blankiekun/yurigana), a separate package pinned to a release
(`scripts/calibre/jiten/requirements.txt` and `apps/web/package.json`). Its README describes
the engine: the order of readings, the flavour rule, the reading model, certainty, how to
build a table and the accuracy numbers.

- The difficulty service reads every word of a book for its **word lists**: a word with
  two readings becomes two rows, 他 read ほか and 他 read た.
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
goes to the word's most common reading in the book, in `save_words`.

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
