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
  train OUT --dictionary … [--model reading-model.json.gz] [--priors ROWS]
      Trains ../reading_model.py's classifier per form on the training authors, keeps a
      form's model only where it beats rules + Sudachi on the dev authors, prints the
      scores on the test authors and writes the kept forms (retrained on all gold).
  evaluate OUT --dictionary … --model TABLE [--all] [--prune KEPT]
      Scores a table on OUT's test authors (--all: on every row, e.g. Tatoeba's sentences
      from fetch_tatoeba.py); with --prune, writes TABLE with only the forms OUT can score
      (MIN_GOLD occurrences of a reading) that read no worse than rules + Sudachi there
      (only the choice of forms comes from OUT: the entries are TABLE's).
  build [LIBRARY STATE]
      A server's own table: mine + train into STATE/reading-model.json.gz (default
      $CALIBRE_LIBRARY and $JITEN_STATE_DIR, i.e. /library and /data/state/difficulty in
      the difficulty container), with the rows in a scratch folder there, removed after.

The rows hold the books' text, so OUT is scratch space: never commit it, nor a table built
from copyrighted books (`../reading-model-public.json.gz` is built only from fetch_aozora.py's
public-domain works and half of fetch_tatoeba.py's sentences, and pruned on the other half).

The classifier. Ruby'd text overstates the rare reading, so the prior that the table keeps
is not the share among gold: it is re-estimated on unlabelled occurrences of the form
(EM, em_priors) from the share the classifier predicts there, or, given fully labelled
text (`train --priors`, Tatoeba's half a for the public table), taken from it. A form's model is kept when
its dev macro is GATE above rules + Sudachi and its accuracy weighed by that prior
(prior_weighted, an estimate for text without ruby) is not lower. The service asks it only
after the rules (the order made no difference on the library: 77.5% macro either way).

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
  docker compose exec difficulty /opt/venv/bin/python /app/jiten/distil/reading_context.py build
"""
import argparse
import bisect
import gzip
import itertools
import json
import math
import os
import re
import sys
import zlib
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from features import HAS_KANJI, _small_kana, context_reading, ruby_reading, to_hiragana  # noqa: E402
from reading_model import RULE_FORMS, WINDOW, ReadingModel, build_form, features, token_window  # noqa: E402,F401

CONTEXT = 12  # characters kept on each side (features._CONTEXT, for the rules)
SAMPLE_EVERY = 10  # lines without ruby: every n-th is tokenised for unlabelled occurrences
PER_BOOK = 10  # ruby'd occurrences kept per form and reading in one book
PLAIN_PER_BOOK = 1  # unlabelled occurrences kept per form in one book
MIN_AUTHORS = 3
MIN_GOLD = 5
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

# ---------------------------------------------------------------------------
# Training (the model in ../reading_model.py)

MIN_TRAIN = 20  # training gold per reading; a form needs two such readings
MIN_PLAIN = 30  # unlabelled occurrences, for the prior
VOCABULARY = 200  # features kept per form (most frequent)
GATE = 0.02  # macro gain over rules + Sudachi a form's model needs on the dev books
CAP = 500  # dev/test rows kept per form and reading, unlabelled rows per form
TRAIN_CAP = 3000  # training rows per form and reading (a sample when there are more)


def em_priors(likelihoods: list, prior: list, iterations: int = 50) -> list:
    """Reading shares of text without ruby (Saerens, Latinne & Decaestecker 2002): starting
    from the ruby'd share, which overstates the rare reading, the mean posterior of unlabelled
    occurrences (`likelihoods`: log P(features | reading) per occurrence), repeated."""
    for _ in range(iterations):
        logs = [math.log(p) for p in prior]
        totals = [0.0] * len(prior)
        for ll in likelihoods:
            scores = [a + b for a, b in zip(logs, ll)]
            top = max(scores)
            exp = [math.exp(x - top) for x in scores]
            z = sum(exp)
            totals = [t + e / z for t, e in zip(totals, exp)]
        prior = [max(t / len(likelihoods), 0.005) for t in totals]
        prior = [p / sum(prior) for p in prior]
    return prior


def fit(counts: dict, plain: list, shares: Counter | None = None):
    """(table entry, priors) for one form: `counts` {reading: [occurrences, Counter of features]}
    of its gold, `plain` the feature lists of unlabelled occurrences, `shares` its readings in
    text where every occurrence is labelled (train --priors), which give the prior directly
    when there are MIN_PLAIN of them; None without enough of either."""
    shares = shares if shares and sum(shares.values()) >= MIN_PLAIN else None
    if not shares and len(plain) < MIN_PLAIN:
        return None
    total = Counter()
    for _, c in counts.values():
        total.update(c)
    vocabulary = [f for f, n in total.most_common(VOCABULARY) if n >= 3]
    readings = list(counts)
    entry = build_form({r: counts[r][1] for r in readings}, vocabulary, [0.0] * len(readings))
    model = ReadingModel({'': entry})
    likelihoods = [] if shares else [list(model.scores('', found).values()) for found in plain]
    n = sum(counts[r][0] for r in readings)
    if shares:  # add-one, like the features
        prior = [(shares[r] + 1) / (sum(shares.values()) + len(readings)) for r in readings]
    else:
        prior = em_priors(likelihoods, [counts[r][0] / n for r in readings])
    entry[1] = [round(math.log(p), 3) for p in prior]
    return entry, dict(zip(readings, prior))


def prior_weighted(per: dict, prior: dict) -> float:
    """Accuracy expected on text without ruby: recall per reading weighed by its estimated share."""
    weights = {g: prior.get(g, 0.0) for g in per}
    total = sum(weights.values()) or 1.0
    return sum(weights[g] * r / n for g, (r, n) in per.items()) / total


def train(out: str, dictionary: str, model_path: str | None, top: int = 30, given=None, prune=None,
          all_splits=False, priors_from: str | None = None):
    """Trains a model per form on the training authors, keeps it where it beats rules + Sudachi
    on the dev authors, prints the scores on the test authors, and writes the kept forms'
    models (retrained on all gold) to `model_path`. With `given` (a ReadingModel), scores that
    one instead (on every row with `all_splits`), and writes it to `prune` with only the forms
    scored there whose macro it doesn't lower. `priors_from`: rows of text whose every
    occurrence is labelled (Tatoeba's half a, also among OUT's rows): their reading shares are
    the priors, instead of EM on OUT's unlabelled rows (books' plain text, read by a model
    trained on ruby, put 彼 at あれ 62% and 行く at ゆく 53%)."""
    from frequency import FrequencyTable
    known = FrequencyTable.load(dictionary).reading_ranks
    forms = ambiguous_forms(known)
    few = few_author_labels(read_rows(out))
    excluded = Counter()
    train_gold = Counter((row[2], row[3]) for row in read_rows(out)
                         if row[3] is not None and (row[2], row[3]) not in few and split_of(row[1]) == 2)
    readings_ok = defaultdict(set)
    for (form, reading), n in train_gold.items():
        if n >= MIN_TRAIN:
            readings_ok[form].add(reading)
    # Forms with hand rules are never modelled (ReadingModel.reading skips them too).
    eligible = set(given.forms) if given else {form for form, readings in readings_ok.items()
                                               if len(readings) > 1 and form not in RULE_FORMS}

    counts = defaultdict(lambda: defaultdict(lambda: [0, Counter()]))
    held, held_n, plain = defaultdict(list), Counter(), defaultdict(list)
    for number, (_, author, form, gold, window, context, sudachi) in enumerate(read_rows(out)):
        if gold is None:
            if form in eligible and len(plain[form]) < CAP:
                plain[form].append(features(window))
            continue
        if (form, gold) in few:
            excluded['few authors'] += 1
            continue
        split = 0 if all_splits else split_of(author)
        if split == 2:
            if form in eligible and gold in readings_ok[form] and \
                    zlib.crc32(number.to_bytes(8, 'little')) % train_gold[form, gold] < TRAIN_CAP:
                entry = counts[form][gold]
                entry[0] += 1
                entry[1].update(features(window))
        elif held_n[form, gold, split] < CAP:
            held_n[form, gold, split] += 1
            before, surface, after = context
            rule = context_reading(before + surface + after, len(before), surface, form, known)
            plain_reading = sudachi or min(forms[form], key=forms[form].get)
            held[form].append((split, gold, rule, rule or plain_reading, features(window) if form in eligible else None,
                               plain_reading))

    shares = defaultdict(Counter)
    for row in read_rows(priors_from) if priors_from else ():
        if row[3] is not None:
            shares[row[2]][row[3]] += 1
    kept, priors = {}, {}
    if given:
        kept = {form: given for form in given.forms}
        priors = {form: dict(zip(e[0], (math.exp(p) for p in e[1]))) for form, e in given.forms.items()}
    for form in sorted(eligible if not given else ()):
        fitted = fit(counts[form], plain[form], shares.get(form))
        if not fitted:
            continue
        model = ReadingModel({form: fitted[0]})
        dev = [h for h in held[form] if h[0] == 1]
        base = score({form: Counter((g, b == g) for _, g, _, b, _, _ in dev)}).get(form)
        mine = score({form: Counter((g, model.predict_features(form, f) == g) for _, g, _, _, f, _ in dev)}).get(form)
        if base and mine and mine[0] >= base[0] + GATE and \
                prior_weighted(mine[1], fitted[1]) >= prior_weighted(base[1], fitted[1]):
            kept[form], priors[form] = model, fitted[1]

    results = {name: defaultdict(Counter)
               for name in ('Sudachi alone', 'baseline', 'model, then rules', 'rules, then model')}
    for form, rows in held.items():
        for split, gold, rule, base, found, plain_reading in rows:
            if split:
                continue
            guess = kept[form].predict_features(form, found) if form in kept and form not in RULE_FORMS else None
            results['Sudachi alone'][form][gold, plain_reading == gold] += 1
            results['baseline'][form][gold, base == gold] += 1
            results['model, then rules'][form][gold, (guess or base) == gold] += 1
            results['rules, then model'][form][gold, (rule or guess or base) == gold] += 1
    print(f'{len(eligible)} forms with enough gold, {len(kept)} kept (beat rules + Sudachi on the dev books)')
    print('ruby left out of the gold:', dict(excluded))
    scores = {name: score(r) for name, r in results.items()}
    for name, s in scores.items():
        print(f'{name}, held-out authors, all forms: {summary(s)}')
        print(f'{name}, held-out authors, kept forms: {summary({f: v for f, v in s.items() if f in kept})}')
    base, new = scores['baseline'], scores['rules, then model']  # the service's order
    print('form\ttest gold\tbefore\tafter\tprior (estimated share without ruby)\tper reading after (right/n)')
    ranked = sorted((f for f in kept if f in new), key=lambda f: -sum(n for _, n in new[f][1].values()))
    for form in ranked[:top]:
        print(f'{form}\t{sum(n for _, n in new[form][1].values())}\t{base[form][0]:.1%}\t{new[form][0]:.1%}\t'
              + ' '.join(f'{r} {p:.0%}' for r, p in priors[form].items()) + '\t'
              + ', '.join(f'{g} {r}/{n}' for g, (r, n) in sorted(new[form][1].items(), key=lambda x: -x[1][1])))

    if given and prune:
        unscored = sorted(f for f in given.forms if f not in base or f not in new)
        worse = sorted(f for f in given.forms if f not in unscored and new[f][0] < base[f][0])
        print('dropped, too few occurrences:', ' '.join(unscored) or 'none')
        print('dropped, worse than rules + Sudachi:', ' '.join(worse) or 'none')
        write_table(prune, {f: e for f, e in given.forms.items() if f not in unscored + worse})
    if model_path and not given:
        table = {}
        for form in kept:
            for split, gold, _, _, found, _ in held[form]:
                if gold in counts[form]:
                    counts[form][gold][0] += 1
                    counts[form][gold][1].update(found)
            table[form] = fit(counts[form], plain[form], shares.get(form))[0]
        write_table(model_path, table)


def write_table(path: str, table: dict):
    with gzip.open(path + '.tmp', 'wt', encoding='utf-8') as f:
        json.dump({'version': 1, 'forms': table}, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(path + '.tmp', path)
    print(f'{path}: {len(table)} forms, {os.path.getsize(path) / 1e6:.1f} MB')


def build(library: str, state: str, dictionary: str, processes: int):
    """A server's own model: mines its library into a scratch folder in `state`, trains, writes
    state/reading-model.json.gz (preferred by the service over the committed public table)
    and removes the scratch folder."""
    import shutil
    scratch = os.path.join(state, 'reading-model-scratch')
    try:
        mine(library, scratch, dictionary, processes, None)
        train(scratch, dictionary, os.path.join(state, 'reading-model.json.gz'))
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=['mine', 'report', 'train', 'evaluate', 'build'])
    parser.add_argument('paths', nargs='*', help='mine: LIBRARY OUT; report/train/evaluate: OUT; build: [LIBRARY STATE]')
    parser.add_argument('--dictionary', default=os.environ.get(
        'JITEN_FREQUENCY_DICTIONARY', '/data/state/difficulty/frequency-dictionary.zip'),
        help="Jiten's frequency list (frequency-dictionary.zip)")
    parser.add_argument('--model', help='train: where to write the table (reading-model.json.gz); evaluate: the table')
    parser.add_argument('--priors', help='train: rows of fully labelled text (Tatoeba) whose shares are the priors')
    parser.add_argument('--prune', help='evaluate: write the table with only the forms it reads no worse')
    parser.add_argument('--all', action='store_true', help='evaluate: score every row, not the test authors')
    parser.add_argument('--processes', type=int, default=int(os.environ.get('JITEN_WORKERS', os.cpu_count() or 1)))
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    if args.command == 'mine':
        mine(*args.paths, args.dictionary, args.processes, args.limit)
    elif args.command == 'report':
        report(args.paths[-1], args.dictionary)
    elif args.command == 'train':
        train(args.paths[-1], args.dictionary, args.model, priors_from=args.priors)
    elif args.command == 'evaluate':
        train(args.paths[-1], args.dictionary, None, given=ReadingModel.load(args.model), prune=args.prune,
              all_splits=args.all)
    else:
        library, state = args.paths or (os.environ.get('CALIBRE_LIBRARY', '/library'),
                                        os.environ.get('JITEN_STATE_DIR', '/data/state/difficulty'))
        build(library, state, args.dictionary, args.processes)
