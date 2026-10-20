#!/usr/bin/env python3
"""On-demand difficulty estimates for the Calibre library, with Jiten's features and a
model of our own, chimi-difficulty, trained on jiten.moe's scores (distil/). Word frequencies come from Jiten's
Yomitan frequency list (FREQUENCY_DICTIONARY).

Nothing runs until asked: the reader (or the CLI) requests difficulty for chosen books.

HTTP API (bound to localhost, proxied by nginx at /calibre/difficulty/api/):
  GET  status                       progress of the current job
  GET  kanji/ID                     kanji counts of an estimated book (for each reader's own kanji coverage)
  GET  words/ID                     the book's most frequent words: [form, reading, count, rank, lemma] (WORDS_PER_BOOK)
  GET  readings/ID                  the book's readings file (readings_file.py)
  POST readings/ID                  make it if missing or stale: {"status": "ready" | "queued" | "unavailable"}
  POST compute    {"ids": [...]}    estimate difficulty for these books ({"all": true} for all without a current estimate)
  POST cancel                       stop the running job
  POST dictionary   body: the zip    install Jiten's frequency list (jiten_freq_global.zip); admins only.
                                    Replacing one needs ?force=1 when its readings disagree (409 with "agreement")
Results are written to RESULTS_PATH, which nginx serves as /calibre/difficulty.json.
Readings files are made one at a time in their own process, never waiting behind an estimate job.

CLI: service.py serve | compute ID...
"""
import gzip
import hmac
import json
import os
import re
import sys
import zipfile
import threading
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from yurigana import __version__ as YURIGANA_VERSION
from yurigana.reader import _UNVOICED

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
import readings_file  # noqa: E402

LIBRARY = os.environ.get('CALIBRE_LIBRARY', '/library')
# Unpacked visual novels (catalog format 'VN'; their 'file' is relative to it).
VN_DIR = os.environ.get('VN_DIR', '/vn')
CATALOG_PATH = os.environ.get('CALIBRE_CATALOG', '/data/state/catalog/catalog.json')
STATE_DIR = os.environ.get('JITEN_STATE_DIR', '/data/state/difficulty')
# Rank-based Yomitan frequency dictionary: Jiten's list (jiten.moe/frequency-dictionaries).
FREQUENCY_DICTIONARY = os.environ.get('JITEN_FREQUENCY_DICTIONARY',
                                      os.path.join(STATE_DIR, 'frequency-dictionary.zip'))
RESULTS_PATH = os.path.join(STATE_DIR, 'difficulty.json')
MAX_DICTIONARY_BYTES = 64 * 1024 * 1024
# Sanity gate for uploads: Jiten's list has about 500,000 terms, and a new version keeps the readings
# of its most frequent forms; a list that doesn't is refused unless forced.
MIN_DICTIONARY_TERMS = 50_000
AGREEMENT_FORMS = 5000
MIN_AGREEMENT = 0.95
# chimi-difficulty, trained on jiten.moe's own scores (distil/, README there): their scale directly,
# adjustment included, from Jiten's 55 features plus EXTRA_FEATURES. The -low/-high models
# are its 10th and 90th percentiles, shown as a range.
MODEL_DIR = os.path.dirname(os.path.realpath(__file__))
MODEL_PATHS = {name: os.path.join(MODEL_DIR, f'chimi-difficulty{suffix}.onnx')
               for name, suffix in (('difficulty', ''), ('low', '-low'), ('high', '-high'))}
# Added to both sides of the range so it holds 80% of books (written by distil/train.py).
with open(os.path.join(MODEL_DIR, 'chimi-difficulty-range.json'), encoding='utf-8') as _f:
    RANGE_WIDEN = json.load(_f)['widen']
# Readings in context for word lists and readings files (a yurigana Reader): the server's own
# reading-model table, built from its library by `python -m yurigana.reading_context build`; the
# Reader adds yurigana's public one (Aozora Bunko and Tatoeba) for other forms.
READING_MODEL_TABLES = [os.path.join(STATE_DIR, 'reading-model.json.gz')]
# Stored with each estimate; whole-library runs redo estimates made by another model.
MODEL_VERSION = 'chimi-difficulty-1'
# Per-book kanji counts, gzipped JSON, for the reader's own coverage.
KANJI_DIR = os.path.join(STATE_DIR, 'kanji')
# Per-book word lists, gzipped JSON, for "words to study"; capped to bound disk use (~19k books).
WORDS_DIR = os.path.join(STATE_DIR, 'words')
WORDS_PER_BOOK = 2000
# Stored with each estimate ('words'); whole-library runs redo word lists made by an older version.
# 2: one row per (form, reading). 3: the book's own ruby gives readings (yurigana's ruby_reading).
# 4: context rules for ambiguous forms (yurigana's context_reading).
# 5: more of the ruby: per-kanji spans, kanji stems of inflected words, large kana; 人気がない
#    reads ひとけ only with a cue.
# 6: a reading model learned from ruby reads ambiguous forms no rule covers (yurigana's ReadingModel).
# Moving the readings to yurigana 0.1.1 changed no reading.
# 7: readings for words met only conjugated, rows of one form and reading merged, particles and
#    auxiliaries dropped by part of speech, a 5th column: the lemma; yurigana 0.2.0's context rules
#    and models; a voiced reading the list lacks counts for the unvoiced one (箱 ばこ: はこ).
# 8: readings from yurigana's whole Reader, as readings files have them: defaults, the list's only
#    reading, counters (本 in 三本: ほん), rendaku, readings of conjugated occurrences.
# 9: SudachiDict-core instead of -full (compounds split differently, 3-10% of rows), and
#    yurigana 0.3.0 (context rules for hard nouns and verbs, compound joins, native つ counts,
#    hand-checked extra readings).
WORDS_VERSION = 9
# Not vocabulary, left out of the book's word totals (uniqueWords, tokens) like the reader's
# word coverage does (isNoiseWord in book-words.ts): particles, numbers, lone kana, and kana-only
# words without a frequency rank (tokenizer noise).
PARTICLES = set('は が を に で と も の へ や か な ね よ わ ぞ ぜ さ て ば し から まで より だけ ほど '
                'くらい ぐらい など なら って けど けれど のに ので しか こそ でも ても さえ'.split())
NUMBER = re.compile(r'[0-9０-９〇一二三四五六七八九十百千万]+')
SINGLE_KANA = re.compile(r'[\u3041-\u309f\u30a0-\u30ffー]')
KANJI = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0003134f]')
# Readings files (#17), made from the reader's processed book in the shared sync folder
# (mounted read-only): <SYNC_DIR>/ttu-reader-data/<title>/bookdata_*.zip.
SYNC_DIR = os.environ.get('SYNC_DIR', '/data/sync')
READINGS_DIR = os.path.join(STATE_DIR, 'readings')
READINGS_QUEUE_MAX = 100
MAX_STATICDATA_BYTES = 30 * 1024 * 1024
WORKERS = int(os.environ.get('JITEN_WORKERS', os.cpu_count() or 1))
PORT = int(os.environ.get('JITEN_PORT', '8765'))
HOST = os.environ.get('JITEN_HOST', '127.0.0.1')
# Made by the web container; nginx sends it as X-Internal-Token, so only nginx can call this service.
INTERNAL_TOKEN_FILE = os.environ.get('INTERNAL_TOKEN_FILE', '/data/state/internal-token')
ALLOW_HTTP = os.environ.get('ALLOW_HTTP_ACCOUNTS') == '1'
# Worker processes are replaced after this many books to bound their memory.
BOOKS_PER_POOL = 300


# ---------------------------------------------------------------------------
# Worker processes (one Sudachi tokenizer each)

_analyzer = None
_frequency = None
_sessions = None
# A yurigana Reader: word-list readings in estimate workers, readings files in the readings worker.
_reader = None


def _init_worker():
    global _analyzer, _frequency, _sessions, _reader
    from yurigana import Reader
    from yurigana.yomitan import with_extra_readings
    import warnings
    warnings.filterwarnings('ignore')
    import onnxruntime
    from features import Analyzer
    from frequency import FrequencyTable
    _analyzer = Analyzer()
    _frequency = FrequencyTable.load(FREQUENCY_DICTIONARY)
    # Sharing the Analyzer's tokens and the list's readings: no second Sudachi or copy of the list.
    # The extra readings (描く かく…) as Reader(known=path) adds them; the features keep the plain list.
    _reader = Reader(known=with_extra_readings(_frequency.reading_ranks), tables=READING_MODEL_TABLES, tokenizer=_analyzer)
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    _sessions = {name: onnxruntime.InferenceSession(path, options) for name, path in MODEL_PATHS.items()}


def save_kanji(book_id: int, text: str):
    from features import is_kanji
    os.makedirs(KANJI_DIR, exist_ok=True)
    path = os.path.join(KANJI_DIR, f'{book_id}.json.gz')
    with gzip.open(path + '.tmp', 'wt', encoding='utf-8') as f:
        json.dump(dict(Counter(c for c in text if is_kanji(c))), f, ensure_ascii=False, separators=(',', ':'))
    os.replace(path + '.tmp', path)


def is_noise_word(form: str, rank) -> bool:
    return (form in PARTICLES or bool(NUMBER.fullmatch(form)) or bool(SINGLE_KANA.fullmatch(form))
            or (rank is None and not KANJI.search(form)))


def save_words(book_id: int, analysis, frequency):
    """The book's WORDS_PER_BOOK most frequent words, most frequent first, as [form, reading or None,
    count in the book, frequency rank or None, lemma (Sudachi's normalized form: 分かる for わかる
    and 判る)], one row per reading (他: ほか and た). Rows of one form and reading from different
    Sudachi words (ある: 有る and 或る) are merged. A word met only conjugated takes the form's most
    common reading in the book, else Sudachi's reading of the form (None only when neither exists).
A voiced reading the list lacks counts for the unvoiced one it gives (箱 ばこ: はこ).
    Names, affixes (今 read こん, from 今回), particles, auxiliaries and unclassified tokens are left
    out. Returns the number of rows and their occurrences before the cap, without noise
    (is_noise_word), so the reader can count the words past the cap as unknown."""
    merged = {}  # (form, reading) -> [form, reading, count, rank, lemma, the lemma's count]
    by_form = {}  # form -> Counter of readings
    conjugated = []

    def add(word, reading, n):
        lemma = word.key.split('\t')[0]
        # A voiced reading the list lacks (この箱 ばこ, 小屋 ごや as a compound's tail) is the word's plain one.
        plain = reading and reading[0].translate(_UNVOICED) + reading[1:]
        if plain != reading and (lemma, reading) not in frequency.reading_ranks and (lemma, plain) in frequency.reading_ranks:
            reading = plain
        data = frequency.word(word.key, reading)
        rank = data[0] if data else None
        row = merged.get((word.form, reading))
        if row is None:
            merged[word.form, reading] = [word.form, reading, n, rank, lemma, n]
        else:
            row[2] += n
            row[3] = min(filter(None, (row[3], rank)), default=None)
            if n > row[5]:
                row[4], row[5] = lemma, n
        by_form.setdefault(word.form, Counter())[reading] += n

    for word_key, (word, count) in analysis.words.items():
        if word.pos in ('name', 'fix', 'other', 'particle', 'aux'):
            continue
        readings = Counter(analysis.readings.get(word_key) or {word.reading: count})
        # Conjugated occurrences have no reading: they go to the word's most common one.
        unknown = readings.pop(None, 0)
        if readings:
            readings[readings.most_common(1)[0][0]] += unknown
        elif unknown:
            conjugated.append((word, word_key, unknown))
        for reading, n in readings.items():
            add(word, reading, n)
    for word, word_key, n in conjugated:
        known = by_form.get(word.form)
        add(word, known.most_common(1)[0][0] if known else analysis.form_readings.get(word_key), n)
    rows = [row[:5] for row in merged.values()]
    vocabulary = [row for row in rows if not is_noise_word(row[0], row[3])]
    rows = sorted(rows, key=lambda row: -row[2])[:WORDS_PER_BOOK]
    os.makedirs(WORDS_DIR, exist_ok=True)
    path = os.path.join(WORDS_DIR, f'{book_id}.json.gz')
    with gzip.open(path + '.tmp', 'wt', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(path + '.tmp', path)
    return len(vocabulary), sum(row[2] for row in vocabulary)


def _estimate(book: dict):
    import numpy
    from features import (EXTRA_FEATURES, FEATURE_ORDER, TOKEN_CLEAN, book_text, compute_extra_features,
                          compute_features, is_kanji, vn_text, words_for_coverage)
    ruby, hints = {}, []
    if book.get('vn'):
        text = vn_text(os.path.join(VN_DIR if book['format'] == 'VN' else LIBRARY, book['file']), ruby, hints)
    else:
        text = book_text(os.path.join(LIBRARY, book['file']), book['format'], ruby, hints)
    characters = len(TOKEN_CLEAN.sub('', text))
    if characters < 1000:
        return book['id'], None
    analysis = _analyzer.analyse(text, hints, _reader)
    features = compute_features(analysis, _frequency)
    extra = compute_extra_features(analysis, _frequency, ruby)
    row = numpy.array([[features[name] for name in FEATURE_ORDER] + [extra[name] for name in EXTRA_FEATURES]],
                      dtype=numpy.float32)
    scores = {name: round(min(max(float(session.run(None, {'float_input': row})[0][0][0]), 0.0), 5.0), 2)
              for name, session in _sessions.items()}
    save_kanji(book['id'], text)
    unique_words, tokens = save_words(book['id'], analysis, _frequency)
    # 'adjusted' is kept for older readers (deprecated, see CHANGELOG; drop it one release later);
    # the model includes jiten.moe's adjustment.
    return book['id'], {
        'difficulty': scores['difficulty'],
        'adjusted': scores['difficulty'],
        'low': round(max(min(scores['low'], scores['difficulty']) - RANGE_WIDEN, 0.0), 2),
        'high': round(min(max(scores['high'], scores['difficulty']) + RANGE_WIDEN, 5.0), 2),
        'words95': words_for_coverage(extra) if extra['CoverageRank95'] == extra['CoverageRank95'] else None,
        'model': MODEL_VERSION,
        'words': WORDS_VERSION,
        'characters': characters,
        'uniqueKanji': len({c for c in text if is_kanji(c)}),
        # All the book's words (rows of its word list before the cap) and their occurrences,
        # without noise; older estimates have neither.
        'uniqueWords': unique_words,
        'tokens': tokens,
        'computedAt': int(time.time() * 1000),
    }


# ---------------------------------------------------------------------------
# Readings files

def _init_readings_worker():
    global _reader
    from yurigana import Reader
    # The known list and the server's reading model the estimates use (yurigana adds its public table).
    _reader = Reader(known=FREQUENCY_DICTIONARY, tables=READING_MODEL_TABLES)


def readings_path(book_id: int) -> str:
    return os.path.join(READINGS_DIR, f'{book_id}.json.gz')


def _make_readings(book_id: int, bookdata: str):
    with zipfile.ZipFile(bookdata) as archive:
        if archive.getinfo('staticdata.json').file_size > MAX_STATICDATA_BYTES:
            raise ValueError('staticdata.json is too large')
        html = json.loads(archive.read('staticdata.json'))['elementHtml']
    readings_file.write(readings_path(book_id),
                        readings_file.build(html, _reader, os.path.basename(bookdata), YURIGANA_VERSION))


def find_bookdata(title: str):
    """The newest bookdata_*.zip in a title's shared sync folder, or None."""
    folder = os.path.join(SYNC_DIR, 'ttu-reader-data', readings_file.sanitize_for_filename(title))
    try:
        paths = [os.path.join(folder, name) for name in os.listdir(folder)
                 if name.startswith('bookdata_') and name.endswith('.zip')]
    except OSError:
        return None
    return max(paths, key=os.path.getmtime, default=None)


class ReadingsQueue:
    """Readings files to make, in request order, by one worker process that lives while there
    is work (a Reader takes a few seconds and ~750 MB to load)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.queue = {}  # book id -> bookdata path
        self.running = None
        self.failed = {}  # book id -> bookdata name it failed on: not retried until that changes
        self.thread = None

    def request(self, book_id: int) -> str:
        if not os.path.exists(FREQUENCY_DICTIONARY):
            return 'unavailable'
        book = next((b for b in load_catalog() if b['id'] == book_id and not b.get('vn')), None)
        bookdata = book and find_bookdata(book['title'])
        if not bookdata:
            return 'unavailable'
        name = os.path.basename(bookdata)
        if readings_file.header(readings_path(book_id)) == (readings_file.READINGS_VERSION, YURIGANA_VERSION, name):
            return 'ready'
        with self.lock:
            if book_id in self.queue or self.running == book_id:
                return 'queued'
            if self.failed.get(book_id) == name or len(self.queue) >= READINGS_QUEUE_MAX:
                return 'unavailable'
            self.queue[book_id] = bookdata
            if not self.thread:
                self.thread = self._start()
        return 'queued'

    def _start(self):
        thread = threading.Thread(target=self._run, daemon=True)
        thread.start()
        return thread

    def _run(self):
        pool = None
        try:
            while True:
                with self.lock:
                    if not self.queue:
                        self.thread = None
                        return
                    book_id, bookdata = next(iter(self.queue.items()))
                    del self.queue[book_id]
                    self.running = book_id
                pool = pool or ProcessPoolExecutor(1, initializer=_init_readings_worker)
                try:
                    pool.submit(_make_readings, book_id, bookdata).result()
                except Exception as error:
                    print(f'readings {book_id}: {error}', file=sys.stderr, flush=True)
                    self.failed[book_id] = os.path.basename(bookdata)
                    if isinstance(error, BrokenProcessPool):
                        pool = None
                finally:
                    self.running = None
        finally:
            if pool:
                pool.shutdown(cancel_futures=True)


readings = ReadingsQueue()


# ---------------------------------------------------------------------------
# Jobs

def run_in_pools(books, task, cancel: threading.Event):
    """Yields (book, result or exception), using fresh worker pools per chunk.
    Books lost when a worker process dies (e.g. out of memory) are retried one at a
    time, so only a book that kills a worker on its own is reported as failed."""
    for start in range(0, len(books), BOOKS_PER_POOL):
        lost = []
        yield from _run_pool(books[start:start + BOOKS_PER_POOL], task, cancel, WORKERS, lost)
        for book in lost:
            if cancel.is_set():
                return
            lost_again = []
            yield from _run_pool([book], task, cancel, 1, lost_again)
            if lost_again:
                yield book, RuntimeError('the worker process died on this book (out of memory?)')
        if cancel.is_set():
            return


def _run_pool(books, task, cancel: threading.Event, workers: int, lost: list):
    """Yields results of one pool; books whose worker died are added to `lost`."""
    with ProcessPoolExecutor(workers, initializer=_init_worker) as pool:
        futures = [pool.submit(task, book) for book in books]
        for book, future in zip(books, futures):
            if cancel.is_set():
                for f in futures:
                    f.cancel()
                return
            try:
                yield book, future.result()
            except BrokenProcessPool:
                lost.append(book)
            except Exception as error:
                yield book, error


def load_catalog():
    with open(CATALOG_PATH, encoding='utf-8') as f:
        # Manga (CBZ/ZIP) has no text to score; visual novels have their scripts.
        return [b for b in json.load(f)['books'] if b['format'] in ('EPUB', 'HTMLZ', 'TXT') or b.get('vn')]


def load_results():
    try:
        with open(RESULTS_PATH, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {'books': {}}


def save_results(results):
    tmp = RESULTS_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(results, f, separators=(',', ':'))
    os.replace(tmp, RESULTS_PATH)



class JobRunner:
    def __init__(self):
        self.lock = threading.Lock()
        self.job = None  # {'type', 'done', 'total', 'started', 'error'}
        self.cancel = threading.Event()

    def status(self):
        with self.lock:
            job = dict(self.job) if self.job else None
        results = load_results()
        return {
            'job': job,
            'dictionary': os.path.exists(FREQUENCY_DICTIONARY),
            'results': len(results.get('books', {})),
            'noText': len(results.get('noText', [])),
            'failed': len(results.get('failed', {})),
            'workers': WORKERS,
        }

    def start(self, job_type: str, target, *args):
        with self.lock:
            if self.job and not self.job.get('finished'):
                raise RuntimeError('Another job is running')
            self.cancel.clear()
            self.job = {'type': job_type, 'done': 0, 'total': 0, 'started': int(time.time() * 1000)}
        threading.Thread(target=self._run, args=(target, args), daemon=True).start()

    def _run(self, target, args):
        try:
            target(*args)
        except Exception as error:  # reported through status
            with self.lock:
                self.job['error'] = str(error)
        with self.lock:
            self.job['finished'] = int(time.time() * 1000)
            self.job['cancelled'] = self.cancel.is_set()

    def _progress(self, done=None, total=None):
        with self.lock:
            if done is not None:
                self.job['done'] = done
            if total is not None:
                self.job['total'] = total

    def compute(self, ids):
        if not os.path.exists(FREQUENCY_DICTIONARY):
            raise RuntimeError(f'Frequency dictionary missing: {FREQUENCY_DICTIONARY}')
        catalog = load_catalog()
        results = load_results()
        wanted = set(ids or ())
        # Books with too little text (image-only manga and scans) can't be estimated, and
        # failed ones are broken files (not a zip, no container.xml), retried once the file changes.
        no_text = set(results.get('noText', []))
        failed = results.setdefault('failed', {})
        # All books: only those not tried yet, estimated by another model or with an older word list, or
        # whose file changed since it failed. Selected books are always recomputed.
        books = [b for b in catalog if (results['books'].get(str(b['id']), {}).get('model') != MODEL_VERSION
                                        or results['books'][str(b['id'])].get('words') != WORDS_VERSION
                                        or not os.path.exists(os.path.join(WORDS_DIR, f"{b['id']}.json.gz")))
                 and b['id'] not in no_text
                 and failed.get(str(b['id']), {}).get('size') != b['size']] \
            if ids is None else [b for b in catalog if b['id'] in wanted]
        self._progress(0, len(books))
        last_save = time.monotonic()
        done = 0
        for book, result in run_in_pools(books, _estimate, self.cancel):
            if isinstance(result, Exception):
                print(f"compute: {book['file']}: {result}", file=sys.stderr)
                failed[str(book['id'])] = {'error': str(result)[:200], 'size': book['size']}
            elif result[1]:
                results['books'][str(result[0])] = result[1]
                no_text.discard(result[0])
                failed.pop(str(result[0]), None)
            else:
                no_text.add(result[0])
                failed.pop(str(result[0]), None)
            results['noText'] = sorted(no_text)
            done += 1
            self._progress(done)
            if time.monotonic() - last_save > 10:
                save_results(results)
                last_save = time.monotonic()
        save_results(results)


runner = JobRunner()


class DictionaryMismatch(ValueError):
    """A replacement list whose readings disagree with the installed one."""
    def __init__(self, agreement: float):
        super().__init__(f'The readings of its {AGREEMENT_FORMS:,} most frequent words agree with the installed '
                         f'list on only {agreement:.1%}')
        self.agreement = agreement


def install_dictionary(source, length: int, force: bool = False) -> int:
    """Checks an uploaded rank-based Yomitan frequency list and makes it the one in use
    (from the next job on); returns its number of terms."""
    from frequency import load_yomitan_ranks, reading_agreement

    if not 0 < length <= MAX_DICTIONARY_BYTES:
        raise ValueError('The file is empty or too large')
    if runner.job and not runner.job.get('finished'):
        raise RuntimeError('Wait until the running job has finished')
    upload = FREQUENCY_DICTIONARY + '.upload'
    try:
        with open(upload, 'wb') as f:
            # Read exactly length: nginx keeps the connection open, so there is no EOF to wait for.
            remaining = length
            while remaining and (chunk := source.read(min(remaining, 1 << 20))):
                f.write(chunk)
                remaining -= len(chunk)
        if os.path.getsize(upload) != length:
            raise ValueError('Upload incomplete')
        try:
            terms = len(load_yomitan_ranks(upload))
        except (zipfile.BadZipFile, KeyError, ValueError, TypeError, AttributeError) as error:
            raise ValueError("Not Jiten's frequency list (a rank-based Yomitan dictionary zip)") from error
        if terms < MIN_DICTIONARY_TERMS:
            raise ValueError(f'The frequency list has only {terms:,} words; Jiten\'s has about 500,000')
        if not force and os.path.exists(FREQUENCY_DICTIONARY):
            try:
                agreement = reading_agreement(FREQUENCY_DICTIONARY, upload, AGREEMENT_FORMS)
            except (zipfile.BadZipFile, KeyError, ValueError, TypeError, AttributeError):
                agreement = 1.0  # the installed list is unreadable: nothing to compare with
            if agreement < MIN_AGREEMENT:
                raise DictionaryMismatch(agreement)
        os.replace(upload, FREQUENCY_DICTIONARY)
        return terms
    finally:
        if os.path.exists(upload):
            os.remove(upload)


def from_nginx(headers) -> bool:
    """Whether the request carries nginx's internal token (none configured: refuse everything)."""
    try:
        with open(INTERNAL_TOKEN_FILE, encoding='ascii') as f:
            token = f.read().strip()
    except OSError:
        return False
    return bool(token) and hmac.compare_digest(token, headers.get('X-Internal-Token', ''))


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def _action(self):
        return self.path.rstrip('/').rsplit('/', 1)[-1]

    def do_GET(self):
        if not from_nginx(self.headers):
            return self._send(403, {'error': 'Only nginx may call this service'})
        parts = self.path.split('?')[0].strip('/').split('/')
        if parts == ['status']:
            self._send(200, runner.status())
        elif len(parts) == 2 and parts[0] in ('kanji', 'words', 'readings') and re.fullmatch(r'-?[0-9]+', parts[1]):
            folder = {'kanji': KANJI_DIR, 'words': WORDS_DIR, 'readings': READINGS_DIR}[parts[0]]
            try:
                with open(os.path.join(folder, f'{int(parts[1])}.json.gz'), 'rb') as f:
                    data = f.read()
            except OSError:
                return self._send(404, {'error': f'no {parts[0]} for this book'})
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(data)
        else:
            self._send(404, {'error': 'not found'})

    def do_POST(self):
        if not from_nginx(self.headers):
            return self._send(403, {'error': 'Only nginx may call this service'})
        # nginx checks the account; this stops other sites from posting with its cookie.
        scheme = 'http' if ALLOW_HTTP and self.headers.get('X-Forwarded-Proto') == 'http' else 'https'
        if self.headers.get('Origin') != f"{scheme}://{self.headers.get('Host', '')}":
            return self._send(403, {'error': 'Request from another site'})
        parts = self.path.split('?')[0].strip('/').split('/')
        if len(parts) == 2 and parts[0] == 'readings' and re.fullmatch(r'-?[0-9]+', parts[1]):
            return self._send(200, {'status': readings.request(int(parts[1]))})
        if parts == ['dictionary']:
            # nginx sends it from the account check of every location that reaches this path.
            if self.headers.get('X-Account-Admin') != '1':
                return self._send(403, {'error': 'Only admins can install the frequency list'})
            query = self.path.split('?', 1)[1] if '?' in self.path else ''
            try:
                terms = install_dictionary(self.rfile, int(self.headers.get('Content-Length') or 0),
                                           force='force=1' in query.split('&'))
            except DictionaryMismatch as error:
                return self._send(409, {'error': str(error), 'agreement': error.agreement})
            except RuntimeError as error:
                return self._send(409, {'error': str(error)})
            except ValueError as error:
                return self._send(400, {'error': str(error)})
            return self._send(200, {**runner.status(), 'terms': terms})
        try:
            length = max(int(self.headers.get('Content-Length') or 0), 0)
            body = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            return self._send(400, {'error': 'invalid JSON'})
        action = self._action()
        try:
            if action == 'compute':
                ids = None if body.get('all') else [int(i) for i in body.get('ids', [])]
                if ids is not None and not ids:
                    return self._send(400, {'error': 'no books given'})
                runner.start('compute', runner.compute, ids)
            elif action == 'cancel':
                runner.cancel.set()
            else:
                return self._send(404, {'error': 'not found'})
        except RuntimeError as error:
            return self._send(409, {'error': str(error)})
        except (AttributeError, TypeError, ValueError):
            return self._send(400, {'error': 'invalid request'})
        self._send(202, runner.status())

    def log_message(self, *args):
        pass


def main(argv):
    os.makedirs(STATE_DIR, exist_ok=True)
    command = argv[1] if len(argv) > 1 else 'serve'
    if command == 'serve':
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    elif command == 'compute':
        runner.job = {'type': 'compute'}
        runner.compute([int(i) for i in argv[2:]] or None)
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv)
