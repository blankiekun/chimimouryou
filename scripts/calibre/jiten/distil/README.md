# chimi-difficulty

`../chimi-difficulty.onnx` is this project's difficulty model: Jiten's approach retrained on
jiten.moe's own scores, so local estimates land on jiten.moe's scale. The live site
scores books with a private hosted model; the `.onnx` in Jiten's repository is the
older model and is not used there.

Inputs: the 55 features of `../features.py`, with word frequencies from Jiten's
Yomitan frequency list (`../frequency.py`), plus `EXTRA_FEATURES`, which are not Jiten's:

| Input | What it measures | Source |
|---|---|---|
| `LogCharacters`, `LogUniqueKanji` | length, kanji range | |
| `CoverageRank90/95/98` | how many of the most common words cover 90/95/98% of the book's words (log) | known-word thresholds: 95-96% for Japanese learners (小森・三國・近藤 2004), 95/98% (Laufer & Ravenhorst-Kalovski 2010) |
| `Mattr` | moving-average type/token ratio, 500 words | Covington & McFall 2010 (plain TTR mostly measures length) |
| `LineSentenceLength` | characters per sentence, line breaks ending sentences | light novels' lines often lack 。 |
| `PredicatesPerSentence`, `HiraganaRatio` | clause load, hiragana share | 柴崎・原 2010 (12-grade readability formula) |
| `RelativeClausesPerSentence` | a verb or auxiliary in 連体形 right before a noun (昨日買った本) | Japanese relative clauses have no marker word |
| `NonJoyoKanjiShare`, `UpperJoyoKanjiShare` | kanji outside 常用, and 常用 above 教育漢字 | `../kanji-grades.json` (KANJIDIC2) |
| `RubyKanjiShare`, `RubyKatakanaShare` | kanji under furigana (総ルビ = children's books), katakana readings (本気→マジ) | measured before the furigana is removed |

Jiten's own features got two fixes as well: word origins (和語/漢語/外来語, for the
jReadability score) come from UniDic (`../goshu.json.gz`) instead of guessing from the
script (手紙 and 仕事 are wago, 場所 mixed), and homographs are looked up by reading
(事: こと is common, じ rare). Tables of contents, colophons and ads are left out of
the text. `make_tables.py` builds both tables (needs fugashi and unidic-lite).

Target: jiten.moe's `difficultyAlgorithmic` (before reader votes). The `-low`/`-high`
models are its 10th and 90th percentiles; quantile boosting is overconfident on unseen
books (62% inside), so the service widens both sides by `chimi-difficulty-range.json`
(conformalized quantile regression, Romano et al. 2019), which brings it to 80%.

Result (2026-10-11, 3,253 books of the library that are on jiten.moe, 5-fold
cross-validation grouped by series):

| | r | mean abs. error | RMSE | bias |
|---|---|---|---|---|
| Jiten's original model (library frequencies) | 0.63 | 0.77 | | -0.73 |
| Jiten's features + length, unique kanji (previous) | 0.88 | 0.23 | 0.30 | -0.03 |
| plus `EXTRA_FEATURES` (in use) | 0.90 | 0.22 | 0.28 | -0.02 |

Half the books are within 0.17 of jiten.moe, 90% within 0.46. The range is 0.74 wide on
average. The gain is small because jiten.moe's score itself barely uses these signals
(unique kanji and the spread of word frequencies carry most of it): the model can only
copy jiten.moe more closely. `validate_speed.py` checks estimates against how fast
readers actually read, once statistics cover enough books.

## Readings in context (word lists)

Word lists read ambiguous words (人気: にんき or ひとけ) from the book's ruby, else from
context rules, else Sudachi (`../features.py`, `Analysis.readings`). `eval_readings.py`
checks them on hand-written sentences; `reading_context.py` on a whole library, using each
book's ruby as the answer and hiding it:

    reading_context.py mine <library> <scratch> --dictionary frequency-dictionary.zip
    reading_context.py report <scratch> --dictionary frequency-dictionary.zip

Gold is the ruby `../features.py`'s `ruby_reading` accepts: over the word, kanji by kanji,
or over an inflected word's kanji stem (so verbs get labels too). Mining 19,372 EPUBs took 25
minutes on 3 processes in a 3 GB container (4.22 M ruby'd occurrences of forms Jiten lists with
two or more readings, 7.3 M unlabelled ones sampled from lines without ruby); the report takes
a minute and a half. The scratch folder holds book text: keep it out of git. Ruby over the
word left out of the answers: unlisted readings 355,804, katakana 110,907 (マジ over 本気),
kanji 3,913, other 4,019, and (form, reading) pairs from fewer than three authors 6,401
(本気 まじ: 38 occurrences, all one author).

Current pipeline on the held-out authors (2026-10-18, this library, rules then Sudachi):
macro 74.2% over 4,184 forms, 51.3% over the 1,210 forms with two or more readings held out,
micro 80.9% over 824,249 occurrences. Ruby is biased to the rare reading, which is why the
score is per reading: 身体 からだ 4,108/6,686, 微笑む ほほえむ 2,363/7,580, 吐く つく 0/3,403,
頃 ごろ 0/184, 何故 なにゆえ 0/77.

## Rebuilding

Run from one working folder (the scripts use relative paths). Jiten allows its public
API for personal projects and small-scale research, not bulk downloading
(https://jiten.moe/guides/api-and-scraping): fetch only what the library needs, slowly.

1. `curl -o jiten-data/novels.json https://api.jiten.moe/api/media-deck/get-media-decks-by-type/4`
   (all novel works, one request) and `jiten-data/catalog.json` from `/calibre/catalog.json`.
2. `python3 match.py`: works whose title or series matches the library.
3. `python3 fetch.py`: volume scores of matched series, at most 75 requests a minute
   (anonymous limit 120), resumable, stops after 5 errors in a row.
4. `python3 labels.py`: pairs books with scores (`books.json`, `labels.json`).
5. Where the library is readable and `jiten/requirements.txt` is installed (the
   `difficulty` image has it in `/opt/venv`), with `jiten/` (this folder's parent),
   `books.json`, `labels.json` and `frequency-dictionary.zip` (Jiten's list) next to
   `extract.py`: `CALIBRE_LIBRARY=<library> python extract.py 4` (about 135 books a
   minute on 5 cores).
6. `train.py` with scikit-learn and skl2onnx (a separate venv, e.g. `/opt/jiten-train`):
   prints the comparison and writes the three `chimi-difficulty*.onnx`
   and `chimi-difficulty-range.json`; copy them to `..`.

Bump `MODEL_VERSION` in `../service.py` with a new model, so whole-library runs redo the
estimates.
