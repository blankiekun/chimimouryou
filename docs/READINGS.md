# Readings and furigana

Two separate pieces of the app decide how a kanji word is read.

- The difficulty service reads every word of a book for its **word lists**: a word with
  two readings becomes two rows, 他 read ほか and 他 read た.
- The reader's **"Known" furigana style** decides which of a book's own ruby to hide.

Neither one changes the book or the difficulty scores.

## Word-list readings (difficulty service)

`Analyzer.analyse` in [`scripts/calibre/jiten/features.py`](../scripts/calibre/jiten/features.py)
counts a reading for each occurrence of a word in `Analysis.readings`, and `save_words` in
`service.py` writes the rows. The first step that gives a reading wins:

1. the book's ruby (`ruby_reading`)
2. a context rule (`context_reading`)
3. the reading model (`reading_model.py`)
4. Sudachi's reading

Whatever the step, a reading is hiragana and one that Jiten's frequency list gives for the
written form (`FrequencyTable.reading_ranks`, the `known` argument). Anything else is never
a reading.

### 1. The book's ruby: `ruby_reading`

`book_text`, `aozora_text` and `vn_text` keep each ruby's position as a hint
(`_mark_ruby`, `_take_hints`). For a word's head token, `ruby_reading` accepts these:

- **Ruby over the token**, as one span or as adjacent spans kanji by kanji, which are joined:
  人《ひと》気《け》 gives ひとけ.
- **Ruby over the kanji stem of an inflected word**, when the rest of the token is kana. The
  lemma's okurigana is added: 行《い》った counts as 行く read いく.
- **Large kana made small**, for older books that set ruby in large kana: いつしよ gives いっしょ
  (`_small_kana`). The reading as written is tried first.

Ruby that isn't a reading is ignored:

- katakana (マジ over 本気)
- ruby containing kanji
- gikun or any reading Jiten doesn't list for the form (そら over 宇宙)
- ruby over part of a compound (魚《うお》市場)

Katakana ruby still counts for `RubyKatakanaShare`, which is measured separately (`_count_ruby`).

### 2. Context rules: `context_reading`

`_CONTEXT_RULES` covers about 30 forms whose reading depends on the words around them. Each
rule is `(reading, before, after[, 'and'])`:

- `before` is a regex that must end where the word starts.
- `after` must match where the head token ends.
- Both are looked for within the line, 12 characters on each side (`_CONTEXT`).

A rule fires when either pattern matches, or when both do if the fourth element is `'and'`.
The first rule whose reading Jiten lists wins. 人気 shows the kinds of rule:

- 人気の(ない|無い) followed by 奴, 作品… is にんき.
- 人気の(ない|無い) otherwise, 人気も(ない|無), and 人気が(少な|絶え|途絶え) are ひとけ.
- 人気が(ない|無い) is ひとけ only with a cue: an `after` cue (人気がない場所, …ない、静か),
  or an `'and'` rule that also needs a place or absence word before it (周囲に人気がない).
  Plain この店は人気がない stays にんき.

`distil/readings-test.tsv` is the regression set for the rules; add rows with every new rule.

### 3. The reading model: `reading_model.py`

For forms no rule covers there is a small naive Bayes classifier per written form. It is
trained on books' ruby, the same ruby `ruby_reading` accepts.

**Features** (`features`, `token_window`) are taken within the line:

- the surfaces of the two tokens on each side (`L1:`, `L2:`, `R1:`, `R2:`)
- those pairs (`L:`, `R:`)
- the content-word lemmas within six tokens (`W:`)

A table keeps the 200 most frequent features per form.

**Prediction:** `ReadingModel.reading` answers only for forms in its table, and only with
a reading Jiten lists. The best reading's posterior must be at least
`ReadingModel.confidence` (0.7); otherwise the word falls through to Sudachi. At 0.5 the
model scored higher on ruby'd text but changed plain sentences that Sudachi had right.

**Training** (`distil/reading_context.py train`):

- Books are split by author into train, dev and test.
- **Prior:** ruby overstates the rare reading (ruby'd 人気 is ひとけ seven times out of
  eight), so the prior is re-estimated on occurrences without ruby (EM, `em_priors`), or,
  with `--priors`, taken from fully labelled text (Tatoeba's half a for the public table).
- **Gate:** a form keeps its model only if it beats rules + Sudachi on the dev authors by
  2 points of macro (recall per reading, averaged), and its accuracy weighted by that
  prior is no lower.

**Tables** (`load_reading_model` in `service.py`):

- `state/difficulty/reading-model.json.gz` is the server's own table, built from its
  library ([docs/CONFIGURATION.md](CONFIGURATION.md#python-services) has the command).
- `jiten/reading-model-public.json.gz` is committed, trained on Aozora Bunko's
  public-domain works (`distil/fetch_aozora.py`) and half a of Tatoeba's reviewed sentences
  (`distil/fetch_tatoeba.py`, CC BY 2.0 FR; halves by sentence id).
- They merge per form: the server's table wins, and the public one fills in the rest.
- Forms with a context rule (`RULE_FORMS`, from `_CONTEXT_RULES`) are never answered by a
  table, even an old one that has them: when no rule fires they keep Sudachi's reading
  (人気がない without a cue stays にんき).

The committed table is pruned on Tatoeba's half b, which it never saw (`evaluate --all
--prune`): it keeps only the forms that half b can score (5 occurrences of a reading) and
reads no worse than rules + Sudachi, 42 forms in the current build. Nothing derived from
copyrighted books goes in git: no table, no sentences, no choice of forms.

### 4. Sudachi

When nothing else gives a reading, the word keeps Sudachi's (`Word.reading`). Sudachi gives
a reading only for an unconjugated word (`surface == dictionary_form`). A conjugated
occurrence without one goes to the word's most common reading in the book, in `save_words`.

### Versions and evaluation

- **`WORDS_VERSION`** (`service.py`) is stored with each estimate. Bump it, with a comment,
  whenever any of the above changes which reading a word gets. "Books without an
  estimate" then redoes those word lists.
- **`MODEL_VERSION`** is for the difficulty scores. They use `Word.reading` (always
  Sudachi's), never `Analysis.readings`, so reading changes leave it alone.

Ways to measure:

- `distil/eval_readings.py --dictionary frequency-dictionary.zip [--model TABLE]` scores
  `readings-test.tsv`, the hand-written sentences, with and without their ruby.
- `distil/reading_context.py mine LIBRARY OUT` then `report OUT` scores the current
  pipeline on a library's own ruby, hidden, with authors held out.
  - Gold is ruby `ruby_reading` accepts, from three or more authors.
  - The score is macro over each form's readings, because ruby is biased toward rare
    readings.
  - OUT holds book text: keep it out of git.
- `reading_context.py evaluate OUT --model TABLE` scores a table on those rows.

[`distil/README.md`](../scripts/calibre/jiten/distil/README.md) has the latest numbers.

## The reader's "Known" furigana style

With "Hide furigana style" set to Known (reader settings, `FuriganaStyle.Known`), the reader
hides ruby the reader probably no longer needs
([`apps/web/src/lib/data/known-furigana.ts`](../apps/web/src/lib/data/known-furigana.ts)).
`reactiveElements` (`components/book-reader/reactive-elements.ts`) marks each rendered section's `<ruby>` with `ttu-known-ruby` (hidden;
a click shows it again) when `hideKnownRuby` holds:

- **The reading is hiragana.** Katakana ruby and ruby with kanji are the author's choice
  and stay.
- **Every kanji of the base was met at least `knownKanjiMinCount` (10) times**, counted
  over all books from `kanji-seen` (`data/kanji-seen.ts`), which is read once per opened
  book.
- **`isPlainReading(base, reading, readings)`:** the reading is spelled by the base's
  kanji readings, in order, with its kana as written.
  - Readings come from `kanji-readings.json`: on and kun readings of 常用 and 人名用 kanji
    from KANJIDIC2, built by `scripts/calibre/jiten/distil/make_tables.py`.
  - Rendaku (ひと → びと) and a final っ (がく → がっ) are allowed.
  - Gikun (そら over 宇宙), jukujikun (きょう over 今日) and kanji outside the table don't
    match, so their ruby stays.

This is independent of the difficulty service's readings: it uses no Jiten list, rules or
model.
