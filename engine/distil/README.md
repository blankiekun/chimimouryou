# distil

Tools for the difficulty service's data (`..`). The GBDT model that used to live here
(chimi-difficulty, Jiten's 55 features plus our own, trained on jiten.moe's scores) was
retired when the estimate became the fast core (`../core.py`, engine 4).

- `core_scale.py`: freezes the 1-10 book scale (`../core-scale.json`) from a reference set of
  V98s: a bell curve, mean 5.5, SD 2. Only the anchors are written, nothing of a book.
- `make_tables.py`: builds `../goshu.json.gz` (word origins from UniDic, which the Analyzer
  still records) and `../kanji-grades.json` (常用 grades from KANJIDIC2, read by the UI font
  subsetter).
- `validate_speed.py`: checks estimates against how fast readers actually read, once
  statistics cover enough books.

## Readings in context (word lists)

Word lists read ambiguous words (人気: にんき or ひとけ) with
[yurigana](https://github.com/blankiekun/yurigana): the book's ruby, else context rules, else
a small reading model, else Sudachi (`../features.py`, `Analysis.readings`; docs/READINGS.md).
Its tools (`python -m yurigana.evaluate`, `python -m yurigana.reading_context
mine|report|train|evaluate|build`, `fetch_aozora`, `fetch_tatoeba`), the hand-written test
sentences, how the public table was built and the accuracy numbers (hand eval 95.0% macro
with ruby / 80.3% without; Tatoeba half b 86.4% micro with the public table, 86.8% with this
library's) are in its README. On this library's held-out authors: rules then Sudachi 74.2%
macro over 4,184 forms, 76.7% with a table built from the library (403 forms). Rows mined
from a library hold book text: scratch, never git.
