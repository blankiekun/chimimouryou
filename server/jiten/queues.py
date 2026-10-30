"""Readings files and word lists made on request, one at a time in a worker process of their own."""
import gzip
import json
import os
import sys
import threading
import time
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool

import jobs
import readerpack
import readings_file
import settings
import workers


class ReadingsQueue:
    """Readings files to make, in request order, by one worker process that lives while there
    is work. WordsQueue makes word lists the same way."""
    # Run in the worker as task(book_id, job): here the job is the text copy's (path, name).
    task = staticmethod(workers._make_readings)
    initializer = staticmethod(workers._init_readings_worker)

    def __init__(self):
        self.lock = threading.Lock()
        self.queue = {}  # book id -> job
        self.running = None
        self.failed = {}  # book id -> text copy name it failed on: not retried until that changes
        self.thread = None
        self.added = threading.Event()  # wakes an idle worker thread at once
        self.finished = threading.Condition(self.lock)  # notified after each file

    def request(self, book_id: int, wait: float = 0) -> str:
        """The file's status; with `wait`, waits up to that many seconds for a queued one."""
        status = self._request(book_id)
        if status != 'queued' or wait <= 0:
            return status
        deadline = time.monotonic() + wait
        with self.lock:
            while (book_id in self.queue or self.running == book_id) and \
                    self.finished.wait(max(0, deadline - time.monotonic())):
                pass
        return self._request(book_id)

    def _request(self, book_id: int) -> str:
        if not os.path.exists(settings.FREQUENCY_DICTIONARY):
            return 'unavailable'
        book = next((b for b in jobs.load_catalog() if b['id'] == book_id and not b.get('vn') and not b.get('manga')),
                    None)
        job = book and workers.find_text(book)
        if not job:
            return 'unavailable'
        path_in, name = job
        path = workers.readings_path(book_id)
        head = readings_file.header(path)
        current = (readings_file.READINGS_VERSION, readerpack.reader_version())
        if head and head[:2] == current and head[2] != name and head[3]:
            # Uploaded again (another device, or deleted and reopened): same text, same file.
            try:
                same = workers.html_digest(workers.text_html(path_in)) == head[3]
            except (OSError, EOFError, ValueError, KeyError, TypeError):
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
            if self.failed.get(book_id) == name or len(self.queue) >= settings.READINGS_QUEUE_MAX:
                return 'unavailable'
            self.queue[book_id] = job
            self.added.set()
            if not self.thread:
                self.thread = self._start()
        return 'queued'

    @staticmethod
    def failure(job):
        """What a failure is remembered by: not retried until the job's input changes."""
        return job[1]

    def _start(self):
        thread = threading.Thread(target=self._run, daemon=True)
        thread.start()
        return thread

    def _run(self):
        pool = None
        idle_since = time.monotonic()
        try:
            while True:
                self.added.clear()
                with self.lock:
                    job = next(iter(self.queue.items()), None)
                    if job:
                        del self.queue[job[0]]
                        self.running = job[0]
                    elif not pool or time.monotonic() - idle_since >= settings.READINGS_KEEP_ALIVE:
                        self.thread = None
                        return
                if not job:
                    self.added.wait(1)
                    continue
                book_id, work = job
                if not pool:
                    readerpack.ensure_reader_pack()
                    pool = ProcessPoolExecutor(1, initializer=self.initializer)
                try:
                    pool.submit(self.task, book_id, work).result()
                except Exception as error:
                    print(f'{type(self).__name__} {book_id}: {error}', file=sys.stderr, flush=True)
                    self.failed[book_id] = self.failure(work)
                    if isinstance(error, BrokenProcessPool):
                        pool = None
                finally:
                    with self.lock:
                        self.running = None
                        self.finished.notify_all()
                    idle_since = time.monotonic()
        finally:
            if pool:
                pool.shutdown(cancel_futures=True)


readings = ReadingsQueue()


class WordsQueue(ReadingsQueue):
    """Word lists to make on request (GET words/ID), one at a time in a worker process of their own
    with the Analyzer and a yurigana Reader (~1-3 s a book). The job is the catalog's book."""
    task = staticmethod(workers._make_words)
    initializer = staticmethod(workers._init_words_worker)

    @staticmethod
    def failure(book):
        return book.get('size'), book.get('added'), book.get('text')

    def _request(self, book_id: int) -> str:
        if os.path.exists(workers.words_path(book_id)) or migrate_legacy_words(book_id):
            return 'ready'
        if not os.path.exists(settings.FREQUENCY_DICTIONARY):
            return 'unavailable'
        book = next((b for b in jobs.load_catalog() if b['id'] == book_id), None)
        if not book or (book.get('manga') and not book.get('text')):
            return 'unavailable'
        with self.lock:
            if book_id in self.queue or self.running == book_id:
                return 'queued'
            if self.failed.get(book_id) == self.failure(book) or len(self.queue) >= settings.READINGS_QUEUE_MAX:
                return 'unavailable'
            self.queue[book_id] = book
            self.added.set()
            if not self.thread:
                self.thread = self._start()
        return 'queued'


word_lists = WordsQueue()
# Legacy lists' totals ([uniqueWords, tokens]) by book id, from the estimates they were made with
# (legacy-totals.json, written once by migrate_word_lists before a new estimate replaces them).
_legacy_totals = None


def legacy_totals_path() -> str:
    return os.path.join(settings.WORDS_DIR, 'legacy-totals.json')


def migrate_word_lists():
    """On start, before any job: records the totals of the lists made with their estimate (version
    LEGACY_WORDS_VERSION; only the estimate has their totals), so they stay usable once a new
    estimate replaces it. Lists of an older version are made again when asked for."""
    path = legacy_totals_path()
    if settings.LEGACY_WORDS_VERSION != settings.WORDS_VERSION or os.path.exists(path):
        return
    try:
        legacy = {name[:-len('.json.gz')] for name in os.listdir(settings.WORDS_DIR) if name.endswith('.json.gz')}
    except OSError:
        return
    totals = {key: [estimate['uniqueWords'], estimate['tokens']]
              for key, estimate in jobs.load_results().get('books', {}).items()
              if key in legacy and estimate.get('words') == settings.LEGACY_WORDS_VERSION
              and estimate.get('uniqueWords') is not None and estimate.get('tokens') is not None}
    with open(path + '.tmp', 'w', encoding='utf-8') as f:
        json.dump(totals, f, separators=(',', ':'))
    os.replace(path + '.tmp', path)


def migrate_legacy_words(book_id: int) -> bool:
    """A legacy list moved to words_path with its totals (True); one without them is removed."""
    global _legacy_totals
    legacy = workers.legacy_words_path(book_id)
    if settings.LEGACY_WORDS_VERSION != settings.WORDS_VERSION or not os.path.exists(legacy):
        return False
    if _legacy_totals is None:
        try:
            with open(legacy_totals_path(), encoding='utf-8') as f:
                _legacy_totals = json.load(f)
        except (OSError, ValueError):
            _legacy_totals = {}
    totals = _legacy_totals.get(str(book_id))
    try:
        if totals:
            with gzip.open(legacy, 'rt', encoding='utf-8') as f:
                rows = json.load(f)
            workers.write_words(book_id, {'words': rows, 'uniqueWords': totals[0], 'tokens': totals[1]})
        os.remove(legacy)
    except (OSError, ValueError):
        return False
    return bool(totals)
