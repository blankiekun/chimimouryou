#!/usr/bin/env python3
"""On-demand difficulty estimates for the Calibre library, with Jiten's features and a
model of our own, chimi-difficulty, trained on jiten.moe's scores (distil/). Word frequencies come from Jiten's
Yomitan frequency list (FREQUENCY_DICTIONARY; the bundled copy in data/ unless an admin replaced it).

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
  POST terms?name=NAME  body: zip   install a Yomitan term dictionary (TERM_DICTIONARY_DIR); admins only
  POST terms/remove {"name": NAME}  remove one; admins only
Results are written to RESULTS_PATH, which nginx serves as /calibre/difficulty.json.
Readings files are made one at a time in their own process, never waiting behind an estimate job.

CLI: service.py serve | compute ID...
"""
import functools
import gzip
import hashlib
import hmac
import json
import os
import re
import shutil
import sys
import zipfile
import threading
import time
import urllib.parse
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from yurigana import __version__ as YURIGANA_VERSION

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
import readings_file  # noqa: E402
from word_list import KANJI, NUMBER, PARTICLES, SINGLE_KANA, is_noise_word, word_rows  # noqa: E402,F401

LIBRARY = os.environ.get('CALIBRE_LIBRARY', '/library')
# Unpacked visual novels (catalog format 'VN'; their 'file' is relative to it).
VN_DIR = os.environ.get('VN_DIR', '/vn')
CATALOG_PATH = os.environ.get('CALIBRE_CATALOG', '/data/state/catalog/catalog.json')
STATE_DIR = os.environ.get('JITEN_STATE_DIR', '/data/state/difficulty')
# Rank-based Yomitan frequency dictionary: Jiten's list (jiten.moe/frequency-dictionaries).
FREQUENCY_DICTIONARY = os.environ.get('JITEN_FREQUENCY_DICTIONARY',
                                      os.path.join(STATE_DIR, 'frequency-dictionary.zip'))
# The same list shipped with the code (data/README.md): installed on start when none is.
BUNDLED_FREQUENCY_DICTIONARY = os.path.join(os.path.dirname(os.path.realpath(__file__)),
                                            'data', 'jiten_freq_global.zip')
RESULTS_PATH = os.path.join(STATE_DIR, 'difficulty.json')
MAX_DICTIONARY_BYTES = 64 * 1024 * 1024
# Sanity gate for uploads: Jiten's list has about 500,000 terms, and a new version keeps the readings
# of its most frequent forms; a list that doesn't is refused unless forced.
MIN_DICTIONARY_TERMS = 50_000
AGREEMENT_FORMS = 5000
MIN_AGREEMENT = 0.95
# Yomitan term dictionaries admins upload (bring your own: none is bundled): yurigana's Reader(terms=...) reads
# them for words the frequency list and JMdict lack, in word lists and readings files; JMnedict is read as a
# name dictionary (Reader(names=...), is_name_dictionary). Large dictionaries are
# 50-200 MB zips; a sanity gate refuses files with few usable terms (not a term dictionary).
TERM_DICTIONARY_DIR = os.path.join(STATE_DIR, 'term-dictionaries')
MAX_TERM_DICTIONARY_BYTES = 256 * 1024 * 1024
MIN_TERM_DICTIONARY_TERMS = 1_000
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
# 10: yurigana 0.5.0 (ateji, shown idioms, bare-evidence dominant readings such as 私 わたし).
# 11: yurigana 0.5.1 (行っ on a going cue reads いっ; an uploaded JMnedict is a name dictionary).
# 12: yurigana 0.5.3 (top readings of 118 forms, voiced tails after a noun, 血肉 ちにく).
WORDS_VERSION = 15
# Readings files (#17), made from the reader's processed book in the shared sync folder
# (mounted read-only): <SYNC_DIR>/ttu-reader-data/<title>/bookdata_*.zip.
SYNC_DIR = os.environ.get('SYNC_DIR', '/data/sync')
READINGS_DIR = os.path.join(STATE_DIR, 'readings')
READINGS_QUEUE_MAX = 100
MAX_STATICDATA_BYTES = 30 * 1024 * 1024
# Building a file takes ~3 s: keep the readings worker this long after its last file so the next
# book opened doesn't start a process again (its Reader loads from READER_PACK at once).
READINGS_KEEP_ALIVE = 120
# The Reader's tables (known list, JMdict, term dictionaries): built once (~20 s, ~620 MB) by
# Reader.save, then every worker maps the file (Reader.load: no parse, ~100 MB, pages shared).
# The .key file names the inputs it was built from.
READER_PACK = os.path.join(STATE_DIR, 'reader.ygp')
# The frequency list the same way (FrequencyTable.save/load_packed, ~450 MB as dicts), built with it.
FREQUENCY_PACK = os.path.join(STATE_DIR, 'frequency.ygp')
WORKERS = int(os.environ.get('JITEN_WORKERS', os.cpu_count() or 1))
PORT = int(os.environ.get('JITEN_PORT', '8765'))
HOST = os.environ.get('JITEN_HOST', '127.0.0.1')
# Made by the web container; nginx sends it as X-Internal-Token, so only nginx can call this service.
INTERNAL_TOKEN_FILE = os.environ.get('INTERNAL_TOKEN_FILE', '/data/state/internal-token')
ALLOW_HTTP = os.environ.get('ALLOW_HTTP_ACCOUNTS') == '1'
# Server connect: the standalone app's origins; nginx's auth check took its bearer token.
CORS_ORIGINS = set(os.environ.get('CORS_ORIGINS', '').split())
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
    from yurigana.yomitan import with_extra_readings
    import warnings
    warnings.filterwarnings('ignore')
    import onnxruntime
    from features import Analyzer
    from frequency import FrequencyTable
    _analyzer = Analyzer()
    _frequency = (FrequencyTable.load_packed(FREQUENCY_PACK) if reader_pack_current()
                  else FrequencyTable.load(FREQUENCY_DICTIONARY))
    # Sharing the Analyzer's tokens and the list's readings: no second Sudachi or copy of the list.
    # The extra readings (描く かく…) as Reader(known=path) adds them; the features keep the plain list.
    _reader = _load_reader(_analyzer, lambda: with_extra_readings(_frequency.reading_ranks))
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


def save_words(book_id: int, analysis, frequency):
    """The book's WORDS_PER_BOOK most frequent words (word_list.word_rows) in WORDS_DIR. Returns the
    number of rows and their occurrences before the cap, without noise (is_noise_word), so the
    reader can count the words past the cap as unknown."""
    rows, unique_words, tokens = word_rows(analysis, frequency)
    os.makedirs(WORDS_DIR, exist_ok=True)
    path = os.path.join(WORDS_DIR, f'{book_id}.json.gz')
    with gzip.open(path + '.tmp', 'wt', encoding='utf-8') as f:
        json.dump(rows[:WORDS_PER_BOOK], f, ensure_ascii=False, separators=(',', ':'))
    os.replace(path + '.tmp', path)
    return unique_words, tokens


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
    # The known list and the server's reading model the estimates use (yurigana adds its public table).
    _reader = _load_reader()


def _load_reader(tokenizer=None, known=lambda: FREQUENCY_DICTIONARY):
    """READER_PACK's Reader, or one built here when the file is missing or another yurigana saved it.
    `known` gives the list to build from: the same pairs as the file's (Reader(known=path) reads them
    as FrequencyTable does and adds with_extra_readings')."""
    from yurigana import Reader
    try:
        if reader_pack_current():
            return Reader.load(READER_PACK, tables=READING_MODEL_TABLES, tokenizer=tokenizer)
    except (OSError, ValueError) as error:
        print(f'reader pack: {error}', file=sys.stderr, flush=True)
    return Reader(known=known(), tables=READING_MODEL_TABLES, tokenizer=tokenizer, **term_options())


def reader_pack_key() -> str:
    paths = [FREQUENCY_DICTIONARY, *term_dictionaries()]
    return reader_version() + ' ' + ','.join(f'{os.path.basename(p)}:{os.path.getsize(p)}:{os.path.getmtime(p)}'
                                             for p in paths if os.path.exists(p))


def reader_pack_current() -> bool:
    try:
        with open(READER_PACK + '.key', encoding='utf-8') as f:
            return f.read() == reader_pack_key() and os.path.exists(READER_PACK) and os.path.exists(FREQUENCY_PACK)
    except OSError:
        return False


def _save_reader_pack(key: str):
    from yurigana import Reader
    from frequency import FrequencyTable
    FrequencyTable.load(FREQUENCY_DICTIONARY).save(FREQUENCY_PACK)
    Reader(known=FREQUENCY_DICTIONARY, **term_options()).save(READER_PACK + '.tmp')
    os.replace(READER_PACK + '.tmp', READER_PACK)
    with open(READER_PACK + '.key.tmp', 'w', encoding='utf-8') as f:
        f.write(key)
    os.replace(READER_PACK + '.key.tmp', READER_PACK + '.key')


_reader_pack_lock = threading.Lock()


def ensure_reader_pack():
    """Builds READER_PACK, in a process of its own (its memory goes back when it exits), when it is
    missing or its inputs changed. Workers that start meanwhile build their own Reader."""
    with _reader_pack_lock:
        if reader_pack_current() or not os.path.exists(FREQUENCY_DICTIONARY):
            return
        try:
            with ProcessPoolExecutor(1) as pool:
                pool.submit(_save_reader_pack, reader_pack_key()).result()
        except Exception as error:
            print(f'reader pack: {error}', file=sys.stderr, flush=True)


def term_dictionaries() -> list:
    """The installed term dictionaries' paths, by name."""
    try:
        return sorted(os.path.join(TERM_DICTIONARY_DIR, n) for n in os.listdir(TERM_DICTIONARY_DIR) if n.endswith('.zip'))
    except OSError:
        return []


def is_name_dictionary(path: str) -> bool:
    """JMnedict (by its index title): a name dictionary, Reader(names=...): it shows names it reads one way
    (姫路 ひめじ) and changes no reading. Its rows aren't terms (the readings are glosses)."""
    try:
        with zipfile.ZipFile(path) as archive:
            return str(json.loads(archive.read('index.json')).get('title', '')).lower().startswith('jmnedict')
    except (OSError, zipfile.BadZipFile, KeyError, ValueError, AttributeError):
        return False


def term_options() -> dict:
    """Reader's terms and names arguments, none without dictionaries (and with a yurigana that has none)."""
    paths = term_dictionaries()
    names = [p for p in paths if is_name_dictionary(p)]
    terms = [p for p in paths if p not in names]
    return ({'terms': terms} if terms else {}) | ({'names': names} if names else {})


def reader_version() -> str:
    """yurigana's version, plus the term dictionaries (name, size) when there are any: readings files made
    with others are stale."""
    paths = term_dictionaries()
    if not paths:
        return YURIGANA_VERSION
    names = ','.join(f'{os.path.basename(p)}:{os.path.getsize(p)}' for p in paths)
    return f'{YURIGANA_VERSION}+terms.{hashlib.sha256(names.encode()).hexdigest()[:12]}'


def readings_path(book_id: int) -> str:
    return os.path.join(READINGS_DIR, f'{book_id}.json.gz')


def staticdata_html(bookdata: str) -> str:
    with zipfile.ZipFile(bookdata) as archive:
        if archive.getinfo('staticdata.json').file_size > MAX_STATICDATA_BYTES:
            raise ValueError('staticdata.json is too large')
        html = json.loads(archive.read('staticdata.json'))['elementHtml']
    if not isinstance(html, str):
        raise ValueError('staticdata.json has no elementHtml')
    return html


def html_digest(html: str) -> str:
    return hashlib.sha256(html.encode()).hexdigest()


def _make_readings(book_id: int, bookdata: str):
    html = staticdata_html(bookdata)
    data = readings_file.build(html, _reader, os.path.basename(bookdata), reader_version())
    readings_file.write(readings_path(book_id), {**data, 'html': html_digest(html)})


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
    is work."""

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
        path = readings_path(book_id)
        head = readings_file.header(path)
        current = (readings_file.READINGS_VERSION, reader_version())
        if head and head[:2] == current and head[2] != name and head[3]:
            # Processed again (another device, or deleted and reopened): same text, same file.
            try:
                same = html_digest(staticdata_html(bookdata)) == head[3]
            except (OSError, ValueError, KeyError, zipfile.BadZipFile):
                same = False
            if same:
                with self.lock:
                    readings_file.retarget(path, name)
                head = (*current, name, head[3])
        if head and head[:3] == (*current, name):
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
        idle_since = time.monotonic()
        try:
            while True:
                with self.lock:
                    job = next(iter(self.queue.items()), None)
                    if job:
                        del self.queue[job[0]]
                        self.running = job[0]
                    elif not pool or time.monotonic() - idle_since >= READINGS_KEEP_ALIVE:
                        self.thread = None
                        return
                if not job:
                    time.sleep(1)
                    continue
                book_id, bookdata = job
                if not pool:
                    ensure_reader_pack()
                    pool = ProcessPoolExecutor(1, initializer=_init_readings_worker)
                try:
                    pool.submit(_make_readings, book_id, bookdata).result()
                except Exception as error:
                    print(f'readings {book_id}: {error}', file=sys.stderr, flush=True)
                    self.failed[book_id] = os.path.basename(bookdata)
                    if isinstance(error, BrokenProcessPool):
                        pool = None
                finally:
                    self.running = None
                    idle_since = time.monotonic()
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
    ensure_reader_pack()
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
            while not future.done() and not cancel.wait(0.5):
                pass
            if cancel.is_set():
                # A book can take minutes: stop the workers rather than wait for theirs (results are
                # written to .tmp files and renamed, so nothing is left half-written).
                for process in list(pool._processes.values()):
                    process.terminate()
                pool.shutdown(wait=False, cancel_futures=True)
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



def unchanged_since_failure(failure, book) -> bool:
    """A failed book is retried once its file changed: by size, or for game folders (size 0) by
    their folder's time (`added`)."""
    if not failure:
        return False
    return failure.get('added') == book['added'] if book.get('format') == 'VN' else failure.get('size') == book['size']


class JobRunner:
    def __init__(self):
        self.lock = threading.Lock()
        self.job = None  # {'type', 'done', 'total', 'started', 'error'}
        self.cancel = threading.Event()
        self.installing = False  # a dictionary is being replaced (holds_off_jobs)

    def status(self):
        with self.lock:
            job = dict(self.job) if self.job else None
            if job and not job.get('finished') and self.cancel.is_set():
                job['cancelling'] = True
        results = load_results()
        return {
            'job': job,
            'dictionary': os.path.exists(FREQUENCY_DICTIONARY),
            'termDictionaries': [os.path.basename(p) for p in term_dictionaries()],
            'results': len(results.get('books', {})),
            'noText': len(results.get('noText', [])),
            'failed': len(results.get('failed', {})),
            'workers': WORKERS,
        }

    def start(self, job_type: str, target, *args):
        with self.lock:
            if self.job and not self.job.get('finished'):
                raise RuntimeError('Another job is running')
            if self.installing:
                raise RuntimeError('A dictionary is being installed')
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
                 and not unchanged_since_failure(failed.get(str(b['id'])), b)] \
            if ids is None else [b for b in catalog if b['id'] in wanted]
        self._progress(0, len(books))
        last_save = time.monotonic()
        done = 0
        for book, result in run_in_pools(books, _estimate, self.cancel):
            if isinstance(result, Exception):
                print(f"compute: {book['file']}: {result}", file=sys.stderr)
                failed[str(book['id'])] = {'error': str(result)[:200], 'size': book['size'], 'added': book['added']}
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


def holds_off_jobs(install):
    """No job may start while a dictionary is replaced: its pools would mix the old list and the new."""
    @functools.wraps(install)
    def wrapper(*args, **kwargs):
        with runner.lock:
            if runner.installing or (runner.job and not runner.job.get('finished')):
                raise RuntimeError('Wait until the running job has finished')
            runner.installing = True
        try:
            return install(*args, **kwargs)
        finally:
            runner.installing = False
    return wrapper


class DictionaryMismatch(ValueError):
    """A replacement list whose readings disagree with the installed one."""
    def __init__(self, agreement: float):
        super().__init__(f'The readings of its {AGREEMENT_FORMS:,} most frequent words agree with the installed '
                         f'list on only {agreement:.1%}')
        self.agreement = agreement


def install_bundled_dictionary():
    """Copies the bundled list to FREQUENCY_DICTIONARY when none is installed; an installed (uploaded)
    one is kept. copy2 keeps the mtime, so reader_pack_key is the same on every install of one file."""
    if os.path.exists(FREQUENCY_DICTIONARY) or not os.path.exists(BUNDLED_FREQUENCY_DICTIONARY):
        return
    shutil.copy2(BUNDLED_FREQUENCY_DICTIONARY, FREQUENCY_DICTIONARY + '.tmp')
    os.replace(FREQUENCY_DICTIONARY + '.tmp', FREQUENCY_DICTIONARY)


@holds_off_jobs
def install_dictionary(source, length: int, force: bool = False) -> int:
    """Checks an uploaded rank-based Yomitan frequency list and makes it the one in use
    (from the next job on); returns its number of terms."""
    from frequency import load_yomitan_ranks, reading_agreement

    if not 0 < length <= MAX_DICTIONARY_BYTES:
        raise ValueError('The file is empty or too large')
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


# A file name: no folders, control characters or leading dot
_TERM_NAME = re.compile(r'[^./\\\x00-\x1f\x7f][^/\\\x00-\x1f\x7f]{0,99}')


def term_dictionary_path(name: str) -> str:
    """TERM_DICTIONARY_DIR/<name>.zip for a plain file name (the uploaded file's), else ValueError."""
    name = name[:-4] if name.lower().endswith('.zip') else name
    if not _TERM_NAME.fullmatch(name):
        raise ValueError('Not a plain file name')
    return os.path.join(TERM_DICTIONARY_DIR, name + '.zip')


@holds_off_jobs
def install_term_dictionary(source, length: int, name: str) -> int:
    """Checks an uploaded Yomitan term dictionary and installs it as `name` (replacing one of that name),
    from the next job on; returns its number of usable terms (yurigana.yomitan.term_readings)."""
    try:
        from yurigana.yomitan import name_readings, term_readings
    except ImportError as error:
        raise RuntimeError('This yurigana has no term dictionary support') from error
    path = term_dictionary_path(name)
    if not 0 < length <= MAX_TERM_DICTIONARY_BYTES:
        raise ValueError('The file is empty or too large')
    os.makedirs(TERM_DICTIONARY_DIR, exist_ok=True)
    upload = path + '.upload'
    try:
        with open(upload, 'wb') as f:
            remaining = length  # exactly length: nginx keeps the connection open (install_dictionary)
            while remaining and (chunk := source.read(min(remaining, 1 << 20))):
                f.write(chunk)
                remaining -= len(chunk)
        if os.path.getsize(upload) != length:
            raise ValueError('Upload incomplete')
        try:
            terms = len((name_readings if is_name_dictionary(upload) else term_readings)(upload))
        except (zipfile.BadZipFile, KeyError, ValueError, TypeError, AttributeError, IndexError) as error:
            raise ValueError('Not a Yomitan term dictionary (a zip with index.json and term_bank_*.json)') from error
        if terms < MIN_TERM_DICTIONARY_TERMS:
            raise ValueError(f'The dictionary has only {terms:,} usable terms with kanji')
        os.replace(upload, path)
        return terms
    finally:
        if os.path.exists(upload):
            os.remove(upload)


@holds_off_jobs
def remove_term_dictionary(name: str):
    try:
        os.remove(term_dictionary_path(name))
    except FileNotFoundError:
        pass


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
                    stat = os.fstat(f.fileno())
                    etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
                    if self.headers.get('If-None-Match') == etag:
                        self.send_response(304)
                        self.send_header('ETag', etag)
                        return self.end_headers()
                    data = f.read()
            except OSError:
                return self._send(404, {'error': f'no {parts[0]} for this book'})
            self.send_response(200)
            self.send_header('ETag', etag)
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
        token_request = CORS_ORIGINS and self.headers.get('X-Forwarded-Proto') == 'https' and \
            self.headers.get('Authorization', '').lower().startswith('bearer ') and \
            self.headers.get('Origin') in CORS_ORIGINS
        if not token_request and self.headers.get('Origin') != f"{scheme}://{self.headers.get('Host', '')}":
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
        if parts in (['terms'], ['terms', 'remove']):
            # nginx sends it from the account check of every location that reaches this path.
            if self.headers.get('X-Account-Admin') != '1':
                return self._send(403, {'error': 'Only admins can install term dictionaries'})
            try:
                if parts == ['terms']:
                    query = urllib.parse.parse_qs(self.path.split('?', 1)[1] if '?' in self.path else '')
                    terms = install_term_dictionary(self.rfile, int(self.headers.get('Content-Length') or 0),
                                                    (query.get('name') or [''])[0])
                    return self._send(200, {**runner.status(), 'terms': terms})
                length = max(int(self.headers.get('Content-Length') or 0), 0)
                body = json.loads(self.rfile.read(length) or b'{}')
                remove_term_dictionary(str(body.get('name', '')) if isinstance(body, dict) else '')
                return self._send(200, runner.status())
            except RuntimeError as error:
                return self._send(409, {'error': str(error)})
            except ValueError as error:
                return self._send(400, {'error': str(error)})
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
    install_bundled_dictionary()
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
