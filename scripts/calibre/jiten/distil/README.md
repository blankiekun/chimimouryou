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

### The reading model

`../reading_model.py` reads the ambiguous forms where no rule applies (`reading_context.py
train`): naive Bayes over the two tokens on each side, the pairs they make and the content
words within six tokens, 200 features per form. The prior comes from text without ruby
(EM, Saerens et al. 2002), since the ruby'd share overstates rare readings; a form keeps its
model only if it beats rules + Sudachi by 2 points of macro on the dev authors without
losing accuracy weighed by that prior, and the service uses it after the rules when its
posterior is 0.7 or more (0.5 scored 0.8 points higher on ruby'd text but changed hand-checked
plain sentences that Sudachi had right).

With fully labelled text (`train --priors`: Tatoeba's half a for the committed table) the
prior is that text's reading shares instead: EM on Aozora's plain text, read by a model
trained on ruby, put 彼 at あれ 62%, 行く at ゆく 53% and 僕 at しもべ 14%, and lost 25 common
forms on Tatoeba's half b that way.

Held-out authors of this library (test split, rows capped at 500 per form and reading;
gold is the ruby `ruby_reading` accepts, so inflected verbs count; for them the baseline is
Jiten's most common reading, where the service gives the book's most common one). Macro /
micro over all 4,184 forms, macro over the 1,210 with 2+ readings held out:

| | all forms | 2+ readings | forms | size |
|---|---|---|---|---|
| rules, then Sudachi | 74.2% / 77.1% | 51.3% | | |
| + Aozora-only table, pruned the same way | 74.3% / 77.7% | 51.6% | 30 | 32 kB |
| + public table (committed: Aozora + Tatoeba a, pruned on b) | 74.3% / 77.9% | 51.7% | 42 | 47 kB |
| + table from the library (`build`) | 76.7% / 83.1% | 59.0% | 403 | 0.5 MB |

Tatoeba's half b (54,086 reviewed sentences, never trained on), every occurrence of a form
Jiten lists with 2+ readings that the transcription marks with a listed reading: 56,443
occurrences of 1,599 forms; 23,141 of them belong to the 210 forms with two or more readings
in the gold. Micro over all / over those 210, macro (per reading, 5+ occurrences, 693 forms):

| | all | 210 forms | macro |
|---|---|---|---|
| Sudachi alone | 83.6% | 85.1% | 91.8% |
| rules, then Sudachi | 85.6% | 90.0% | 92.2% |
| + public table before pruning (121 forms, held out) | 86.4% | 91.7% | 92.8% |
| + public table (42 forms; chosen on this half) | 86.4% | 91.7% | 93.1% |
| + table from the library over the public one | 86.8% | 92.3% | 94.0% |

For scale: GiNZA reports 91.5% micro over 33,877 Tatoeba examples of 248 homographs (a
different form list). yomikata (BERT, claims 94% over its 130 forms), run on the same half b
occurrences of its forms (2,545 of 65 forms, unconjugated): 77.9%, of which 414 errors are
明日 あす where Tatoeba has あした; without 明日 (2,103) yomikata 92.9%, Sudachi 88.4%, rules
+ Sudachi 89.3%, + public table 94.0%, + library table 96.0%. yomikata is not a dependency.

On `readings-test.tsv` neither table changes the score with ruby (95.0% macro); without ruby
the public table changes nothing (80.3%) and the library's loses one sentence (79.8%).
Analysing a book costs about 2.5% more with the public table and 4.4% with the library's
(20 books, 17.5 s → 18.0 s and 17.7 s → 18.5 s); they changed 0.17% and 0.48% of word
occurrences' readings.

Building the committed table (`../reading-model-public.json.gz`), nothing from a library
involved: `fetch_aozora.py <aozora>` (10,477 public-domain works in 新字新仮名, about an hour
at 3 requests at a time) and `fetch_tatoeba.py <tatoeba>` (108,266 reviewed transcriptions
from Tatoeba, CC BY 2.0 FR, split in two halves by sentence id); `reading_context.py mine`
each of `<aozora>`, `<tatoeba>/a` and `<tatoeba>/b` (2 minutes each); `train` on the Aozora
and half a rows together (concatenate the two `occurrences.jsonl.gz` into one folder)
with `--priors <half a rows> --model <full table>` (30 seconds, 121 forms); then `evaluate
<half b rows> --all --model <full table> --prune ../reading-model-public.json.gz`, which
drops the forms half b can't score (MIN_GOLD, 5 occurrences of a reading) or reads worse
than rules + Sudachi. Dropped in the 2026-10-18 build: 72 for too few occurrences, mostly
literary words modern sentences don't use (先刻 傍 態 櫓 許 刃 柄 艶 …), and 一言 上下 例 右手
市 形 質 as worse. Neither the downloads nor the rows go in git.

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
