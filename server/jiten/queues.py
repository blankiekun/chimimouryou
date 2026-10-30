"""Readings files and word lists made on request, one at a time in a worker process of their own."""
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
        if os.path.exists(workers.words_path(book_id)):
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
