#!/usr/bin/env python3
"""On-demand difficulty estimates for the Calibre library, with Jiten's features and a
model of our own, chimi-difficulty, trained on jiten.moe's scores (distil/). Word frequencies come from Jiten's
Yomitan frequency list (FREQUENCY_DICTIONARY).

Nothing runs until asked: the reader (or the CLI) requests difficulty for chosen books.

HTTP API (bound to localhost, proxied by nginx at /calibre/difficulty/api/):
  GET  status                       progress of the current job
  GET  kanji/ID                     kanji counts of an estimated book (for each reader's own kanji coverage)
  GET  words/ID                     the book's most frequent words: [form, reading, count, rank] (WORDS_PER_BOOK)
  POST compute    {"ids": [...]}    estimate difficulty for these books ({"all": true} for all without a current estimate)
  POST cancel                       stop the running job
  POST dictionary   body: the zip    install Jiten's frequency list (jiten_freq_global.zip)
Results are written to RESULTS_PATH, which nginx serves as /calibre/difficulty.json.

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

from yurigana import PUBLIC_TABLE, load_tables

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))

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
# chimi-difficulty, trained on jiten.moe's own scores (distil/, README there): their scale directly,
# adjustment included, from Jiten's 55 features plus EXTRA_FEATURES. The -low/-high models
# are its 10th and 90th percentiles, shown as a range.
MODEL_DIR = os.path.dirname(os.path.realpath(__file__))
MODEL_PATHS = {name: os.path.join(MODEL_DIR, f'chimi-difficulty{suffix}.onnx')
               for name, suffix in (('difficulty', ''), ('low', '-low'), ('high', '-high'))}
# Added to both sides of the range so it holds 80% of books (written by distil/train.py).
with open(os.path.join(MODEL_DIR, 'chimi-difficulty-range.json'), encoding='utf-8') as _f:
    RANGE_WIDEN = json.load(_f)['widen']
# Readings in context for word lists (yurigana's reading model): the server's own table, built
# from its library by `python -m yurigana.reading_context build`, and for other forms
# yurigana's public one, built from Aozora Bunko and Tatoeba.
READING_MODEL_PATHS = [os.path.join(STATE_DIR, 'reading-model.json.gz'), PUBLIC_TABLE]
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
WORDS_VERSION = 6
# Not vocabulary, left out of the book's word totals (uniqueWords, tokens) like the reader's
# word coverage does (isNoiseWord in book-words.ts): particles, numbers, lone kana, and kana-only
# words without a frequency rank (tokenizer noise).
PARTICLES = set('は が を に で と も の へ や か な ね よ わ ぞ ぜ さ て ば し から まで より だけ ほど '
                'くらい ぐらい など なら って けど けれど のに ので しか こそ でも ても さえ'.split())
NUMBER = re.compile(r'[0-9０-９〇一二三四五六七八九十百千万]+')
SINGLE_KANA = re.compile(r'[\u3041-\u309f\u30a0-\u30ffー]')
KANJI = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0003134f]')
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
_reading_model = None


def load_reading_model(paths=None):
    """The tables of READING_MODEL_PATHS that load, merged (a form's model from the first that
    has one), or None."""
    return load_tables(paths or READING_MODEL_PATHS)


def _init_worker():
    global _analyzer, _frequency, _sessions, _reading_model
    import warnings
    warnings.filterwarnings('ignore')
    import onnxruntime
    from features import Analyzer
    from frequency import FrequencyTable
    _analyzer = Analyzer()
    _frequency = FrequencyTable.load(FREQUENCY_DICTIONARY)
    _reading_model = load_reading_model()
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
    count in the book, frequency rank or None], one row per reading (他: ほか and た). Names,
    affixes (今 read こん, from 今回) and unclassified tokens are left out. Returns the number of
    rows and their occurrences before the cap, without noise (is_noise_word), so the reader can
    count the words past the cap as unknown."""
    rows = []
    for word_key, (word, count) in analysis.words.items():
        if word.pos in ('name', 'fix', 'other'):
            continue
        readings = Counter(analysis.readings.get(word_key) or {word.reading: count})
        # Conjugated occurrences have no reading: they go to the word's most common one.
        unknown = readings.pop(None, 0)
        if readings:
            readings[readings.most_common(1)[0][0]] += unknown
        elif unknown:
            readings[None] = unknown
        for reading, n in readings.items():
            data = frequency.word(word.key, reading)
            rows.append([word.form, reading, n, data[0] if data else None])
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
    analysis = _analyzer.analyse(text, hints, _frequency.reading_ranks, _reading_model)
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


def install_dictionary(source, length: int) -> int:
    """Checks an uploaded rank-based Yomitan frequency list and makes it the one in use
    (from the next job on); returns its number of terms."""
    from frequency import load_yomitan_ranks

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
        if not terms:
            raise ValueError('The frequency list has no words')
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
        elif len(parts) == 2 and parts[0] in ('kanji', 'words') and re.fullmatch(r'-?[0-9]+', parts[1]):
            folder = KANJI_DIR if parts[0] == 'kanji' else WORDS_DIR
            try:
                with open(os.path.join(folder, f'{int(parts[1])}.json.gz'), 'rb') as f:
                    data = f.read()
            except OSError:
                return self._send(404, {'error': 'no estimate for this book'})
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
        if self._action() == 'dictionary':
            try:
                terms = install_dictionary(self.rfile, int(self.headers.get('Content-Length') or 0))
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
