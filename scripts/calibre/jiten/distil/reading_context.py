"""Readings in context, measured on a library's own ruby.

Ruby that features.ruby_reading takes as a word's reading (over the word, per kanji, or over
the kanji stem of an inflected word) is that occurrence's reading. Hiding it gives a test of how the service reads words that Jiten lists with several
readings (人気: にんき/ひとけ), on real text instead of hand-written sentences.

  mine LIBRARY OUT --dictionary frequency-dictionary.zip [--processes 4] [--limit N]
      Writes OUT/occurrences.jsonl.gz (one JSON list per occurrence of an ambiguous form:
      book, author, form, gold reading or null, the tokens around it, the text around it,
      Sudachi's reading) and OUT/stats.json. Ruby'd occurrences are the gold; a sample of
      occurrences without ruby (every SAMPLE_EVERY-th line without ruby) is kept unlabelled.
  report OUT --dictionary frequency-dictionary.zip
      Scores the current pipeline (context rules, then Sudachi) on the held-out books.

The rows hold the books' text, so OUT is scratch space: never commit it.

Gold readings. Books use ruby for flavour as well as for readings (マジ over 本気, スキル over
異能, そら over 宇宙, kanji over katakana), so an occurrence is gold only when its ruby is
hiragana and a reading Jiten lists for the form; ruby set in large kana (いつしよ for
いっしょ, common in older books) is tried with small kana. A (form, reading) must also be
found in MIN_AUTHORS authors' books, so one series' own gikun is not taken for a reading.
What is excluded, and why, is counted.

Held out by author (hash of the author folder, author_of; Calibre's "Unknown" is no
author, so such books are their own): `split` 0 = test, 1 = dev, else train, so neither a
book nor its series is on both sides.

Scores are per reading (recall), averaged over a form's readings (macro), because ruby is
biased toward the rare reading: ruby'd 人気 is ひとけ seven times out of eight, the
opposite of plain text. Forms then weigh the same. A reading needs MIN_GOLD held-out
occurrences to count.

Run where `jiten/requirements.txt` is installed (the `difficulty` image's /opt/venv) with
the library readable, e.g.
  docker compose exec difficulty /opt/venv/bin/python /app/jiten/distil/reading_context.py \\
    mine /library /data/state/scratch-readings
  docker compose exec difficulty /opt/venv/bin/python /app/jiten/distil/reading_context.py \\
    report /data/state/scratch-readings
"""
import argparse
import bisect
import gzip
import itertools
import json
import os
import re
import sys
import zlib
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from features import HAS_KANJI, _small_kana, context_reading, ruby_reading, to_hiragana  # noqa: E402

WINDOW = 6  # tokens kept on each side
CONTEXT = 12  # characters kept on each side (features._CONTEXT, for the rules)
SAMPLE_EVERY = 10  # lines without ruby: every n-th is tokenised for unlabelled occurrences
PER_BOOK = 10  # ruby'd occurrences kept per form and reading in one book
PLAIN_PER_BOOK = 1  # unlabelled occurrences kept per form in one book
MIN_AUTHORS = 3
MIN_GOLD = 5
CONTENT_POS = ('名詞', '動詞', '形容詞', '形状詞', '副詞', '代名詞')
BOOK_SUFFIXES = ('.epub', '.txt')
UNKNOWN_AUTHORS = ('Unknown', '不明')

_HIRAGANA = re.compile(r'^[ぁ-ゖー]+$')
_KATAKANA = re.compile(r'[ァ-ヺ]')


# ---------------------------------------------------------------------------
# Labels

def ambiguous_forms(known) -> dict:
    """form -> {hiragana reading: Jiten rank} for forms Jiten lists with two or more."""
    forms = defaultdict(dict)
    for (term, reading), rank in known.items():
        if HAS_KANJI.search(term) and _HIRAGANA.match(reading):
            forms[term][reading] = rank
    return {form: readings for form, readings in forms.items() if len(readings) > 1}


def label(ruby: str, readings) -> tuple:
    """(reading, None) when ruby gives one of `readings` (the form's listed readings), else
    (None, why): 'katakana', 'kanji', 'other' (not hiragana) or 'unlisted'."""
    if _KATAKANA.search(ruby):
        return None, 'katakana'
    if HAS_KANJI.search(ruby):
        return None, 'kanji'
    if not _HIRAGANA.match(ruby):
        return None, 'other'
    if ruby in readings:
        return ruby, None
    return next(((v, None) for v in _small_kana(ruby) if v in readings), (None, 'unlisted'))


def token_window(tokens, i: int, line_start: int, line_end: int) -> list:
    """[surface, dictionary form or '' (not a content word)] of the WINDOW tokens on each side
    of tokens[i] that begin within [line_start, line_end) (None past the line's ends); the
    word itself is left out."""
    def entry(j):
        if not 0 <= j < len(tokens) or not line_start <= tokens[j].begin < line_end:
            return None
        t = tokens[j]
        return [t.surface(), t.dictionary_form() if t.part_of_speech()[0] in CONTENT_POS else '']
    return [entry(j) for j in range(i - WINDOW, i + WINDOW + 1) if j != i]


def split_of(author: str) -> int:
    """0 = test, 1 = dev, 2 = train."""
    return min(zlib.crc32(author.encode()) % 5, 2)


# ---------------------------------------------------------------------------
# Mining

_analyzer = _forms = None


def _init(dictionary):
    global _analyzer, _forms
    from features import Analyzer
    from frequency import FrequencyTable
    _analyzer = Analyzer()
    _forms = ambiguous_forms(FrequencyTable.load(dictionary).reading_ranks)


def mine_book(path: str, book: str, author: str):
    """(rows, exclusion counts) for one book; see the module docstring."""
    from features import book_text
    hints = []
    try:
        text = book_text(path, 'TXT' if path.lower().endswith('.txt') else 'EPUB', None, hints)
    except Exception:  # broken files: skipped, like the service's errors
        return [], Counter({'unreadable books': 1})
    hint_at = {start: (end, reading) for start, end, reading in hints}
    starts = [0] + [m.end() for m in re.finditer('\n', text)]
    line_hints = defaultdict(list)
    for start, end, _ in hints:
        line_hints[bisect.bisect_right(starts, start) - 1].append((start, end))
    rows, excluded, kept = [], Counter(), Counter()
    for number, line_start in enumerate(starts):
        if number not in line_hints and number % SAMPLE_EVERY:
            continue
        line = text[line_start:starts[number + 1] - 1 if number + 1 < len(starts) else len(text)]
        tokens = list(_analyzer._tokens(line))
        for i, token in enumerate(tokens):
            form = token.dictionary_form()
            readings = _forms.get(form)
            if not readings:
                continue
            begin, surface = line_start + token.begin, token.surface()
            hint = hint_at.get(begin)
            gold = None
            if any(s < begin + len(surface) and e > begin for s, e in line_hints.get(number, ())):
                gold = ruby_reading(hint_at, begin, surface, form, {(form, r) for r in readings})
                if not gold:
                    if hint and hint[0] == begin + len(surface):  # over the word: why it isn't gold
                        excluded[label(hint[1], readings)[1] or 'other'] += 1
                    continue  # also ruby over part of the word, or wider: neither gold nor plain text
            if kept[form, gold] >= (PER_BOOK if gold else PLAIN_PER_BOOK):
                continue
            kept[form, gold] += 1
            b = token.begin
            rows.append([book, author, form, gold, token_window(tokens, i, 0, len(line)),
                         [line[max(0, b - CONTEXT):b], surface, line[b + len(surface):b + len(surface) + CONTEXT]],
                         to_hiragana(token.reading_form()) if surface == form else None])
    return rows, excluded


def _mine(args):
    return mine_book(*args)


def author_of(book: str) -> str:
    """The first folder of a book's path (Calibre's author folder); Calibre's "Unknown"
    (more than half of one library's ruby) is no author, so such a book is its own."""
    parts = book.split(os.sep)
    return os.sep.join(parts[:2]) if parts[0] in UNKNOWN_AUTHORS else parts[0]


def library_books(library: str):
    """(path, book key, author_of) per book: a folder's EPUB (Calibre keeps one book's formats
    in a folder), else each of its TXTs (fetch_aozora.py's author folders)."""
    for folder, _, files in sorted(os.walk(library)):
        books = sorted(f for f in files if f.lower().endswith(BOOK_SUFFIXES) and not f.startswith('._'))
        epubs = [f for f in books if f.lower().endswith('.epub')]
        for name in epubs[:1] or books:
            rel = os.path.relpath(os.path.join(folder, name), library)
            yield os.path.join(folder, name), rel, author_of(rel)


def mine(library: str, out: str, dictionary: str, processes: int, limit: int | None):
    from multiprocessing import Pool
    os.makedirs(out, exist_ok=True)
    books = list(library_books(library))[:limit]
    stats = Counter(books=len(books))
    with Pool(processes, initializer=_init, initargs=(dictionary,)) as pool, \
            gzip.open(os.path.join(out, 'occurrences.jsonl.gz'), 'wt', encoding='utf-8') as f:
        for n, (rows, excluded) in enumerate(pool.imap_unordered(_mine, books, chunksize=4), 1):
            stats.update(excluded)
            stats['labelled'] += sum(row[3] is not None for row in rows)
            stats['unlabelled'] += sum(row[3] is None for row in rows)
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')
            if n % 500 == 0:
                print(n, dict(stats), flush=True)
    with open(os.path.join(out, 'stats.json'), 'w') as f:
        json.dump(stats, f, indent=1)
    print(dict(stats))


def read_rows(out: str):
    with gzip.open(os.path.join(out, 'occurrences.jsonl.gz'), 'rt', encoding='utf-8') as f:
        for line in f:
            yield json.loads(line)


def few_author_labels(rows) -> set:
    """(form, reading) pairs that ruby gives in fewer than MIN_AUTHORS authors' books."""
    authors = defaultdict(set)
    for row in rows:
        if row[3] is not None:
            authors[row[2], row[3]].add(row[1])
    return {pair for pair, names in authors.items() if len(names) < MIN_AUTHORS}


def gold_rows(rows, excluded: Counter):
    """Labelled rows without the few-author labels (counted into `excluded`); `rows()` gives
    the rows (read twice: a library's do not fit in memory)."""
    few = few_author_labels(rows())
    for row in rows():
        if row[3] is None:
            continue
        if (row[2], row[3]) in few:
            excluded['few authors'] += 1
        else:
            yield row


# ---------------------------------------------------------------------------
# Scoring

def baseline_reading(row, known, readings) -> str:
    """What the service gives today: a context rule, else Sudachi's reading, else (a conjugated
    word: the service gives the book's most common reading) Jiten's most common one."""
    before, surface, after = row[5]
    return (context_reading(before + surface + after, len(before), surface, row[2], known)
            or row[6] or min(readings, key=readings.get))


def score(results) -> dict:
    """results: form -> Counter of (gold, right?) -> {form: (macro recall, {reading: (right, n)})}."""
    scores = {}
    for form, counts in results.items():
        per = {}
        for (gold, right), n in counts.items():
            r, total = per.get(gold, (0, 0))
            per[gold] = (r + n * right, total + n)
        per = {gold: v for gold, v in per.items() if v[1] >= MIN_GOLD}
        if per:
            scores[form] = (sum(r / n for r, n in per.values()) / len(per), per)
    return scores


def summary(scores) -> str:
    if not scores:
        return 'no forms'
    macro = sum(m for m, _ in scores.values()) / len(scores)
    right = sum(r for _, per in scores.values() for r, _ in per.values())
    total = sum(n for _, per in scores.values() for _, n in per.values())
    two = [m for m, per in scores.values() if len(per) > 1]
    return (f'macro {macro:.1%} over {len(scores)} forms ({sum(two) / max(len(two), 1):.1%} over the '
            f'{len(two)} with 2+ readings held out), micro {right / total:.1%} over {total} occurrences')


def report(out: str, dictionary: str, top: int = 30):
    from frequency import FrequencyTable
    known = FrequencyTable.load(dictionary).reading_ranks
    forms = ambiguous_forms(known)
    with open(os.path.join(out, 'stats.json')) as f:
        excluded = Counter({k: v for k, v in json.load(f).items() if k not in ('books', 'labelled', 'unlabelled')})
    results = defaultdict(Counter)
    gold_counts = Counter()
    for row in gold_rows(lambda: read_rows(out), excluded):
        gold_counts[row[2]] += 1
        if split_of(row[1]) == 0:
            results[row[2]][row[3], baseline_reading(row, known, forms[row[2]]) == row[3]] += 1
    print('ruby left out of the gold:', dict(excluded))
    scores = score(results)
    print('current pipeline (rules, then Sudachi), held-out authors:', summary(scores))
    print('form\tgold (all splits)\tmacro\tper reading (right/n)')
    for form, _ in gold_counts.most_common():
        if form in scores and top:
            top -= 1
            macro, per = scores[form]
            print(f'{form}\t{gold_counts[form]}\t{macro:.1%}\t'
                  + ', '.join(f'{g} {r}/{n}' for g, (r, n) in sorted(per.items(), key=lambda x: -x[1][1])))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=['mine', 'report'])
    parser.add_argument('paths', nargs='+', help='mine: LIBRARY OUT; report: OUT')
    parser.add_argument('--dictionary', default=os.environ.get(
        'JITEN_FREQUENCY_DICTIONARY', '/data/state/difficulty/frequency-dictionary.zip'),
        help="Jiten's frequency list (frequency-dictionary.zip)")
    parser.add_argument('--processes', type=int, default=int(os.environ.get('JITEN_WORKERS', os.cpu_count() or 1)))
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    if args.command == 'mine':
        mine(*args.paths, args.dictionary, args.processes, args.limit)
    else:
        report(args.paths[-1], args.dictionary)
