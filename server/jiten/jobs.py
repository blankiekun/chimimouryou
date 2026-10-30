"""Estimate jobs: the worker pools, the catalog and results, the JobRunner and the manga text watcher."""
import json
import os
import sys
import threading
import time
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool

import core
import readerpack
import settings
import workers
from engine import file_sha256


def run_in_pools(books, task, cancel: threading.Event, initializer=None):
    """Yields (book, result or exception), using fresh worker pools per chunk.
    Books lost when a worker process dies (e.g. out of memory) are retried one at a
    time, so only a book that kills a worker on its own is reported as failed."""
    readerpack.ensure_reader_pack()
    for start in range(0, len(books), settings.BOOKS_PER_POOL):
        lost = []
        yield from _run_pool(books[start:start + settings.BOOKS_PER_POOL], task, cancel, settings.WORKERS, lost, initializer)
        for book in lost:
            if cancel.is_set():
                return
            lost_again = []
            yield from _run_pool([book], task, cancel, 1, lost_again, initializer)
            if lost_again:
                yield book, RuntimeError('the worker process died on this book (out of memory?)')
        if cancel.is_set():
            return


def _run_pool(books, task, cancel: threading.Event, processes: int, lost: list, initializer=None):
    """Yields results of one pool; books whose worker died are added to `lost`."""
    with ProcessPoolExecutor(processes, initializer=initializer or workers._init_worker) as pool:
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
    """The books with text: EPUB, HTMLZ, TXT, visual novels (their scripts) and manga (CBZ/ZIP, their mokuro
    text: 'manga', and 'text', its manga_text_stamp, None while they have none)."""
    with open(settings.CATALOG_PATH, encoding='utf-8') as f:
        books = json.load(f)['books']
    for book in books:
        if book['format'] in ('CBZ', 'ZIP') and not book.get('vn'):
            book.update(manga=True, text=workers.manga_text_stamp(book['id']))
    return [b for b in books if b['format'] in ('EPUB', 'HTMLZ', 'TXT') or b.get('vn') or b.get('manga')]


def load_results():
    try:
        with open(settings.RESULTS_PATH, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {'books': {}}


def save_results(results):
    tmp = settings.RESULTS_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(results, f, separators=(',', ':'))
    os.replace(tmp, settings.RESULTS_PATH)



def unchanged_since_failure(failure, book) -> bool:
    """A failed book is retried once its file changed: by size, for game folders (size 0) by
    their folder's time (`added`), for manga also by their text."""
    if not failure or failure.get('text') != book.get('text'):
        return False
    return failure.get('added') == book['added'] if book.get('format') == 'VN' else failure.get('size') == book['size']


def needs_estimate(book, results, engine) -> bool:
    """Whether a whole-library run estimates the book: never tried, estimated by another engine or
    an older CORE_VERSION (the estimate is the core: ~0.4 s a book), or (manga) from other text;
    not a book without text or whose file is unchanged since it failed.
    Manga without text are tried once some appears. Word lists aren't made here (WordsQueue)."""
    key = str(book['id'])
    if book.get('manga') and not book.get('text'):
        return False
    if book['id'] in results.get('noText', []) and results.get('noTextStamps', {}).get(key) == book.get('text'):
        return False
    estimate = results['books'].get(key, {})
    return (estimate.get('engine') != engine or estimate.get('text') != book.get('text')
            or (estimate.get('core') or {}).get('v') != core.CORE_VERSION) \
        and not unchanged_since_failure(results.get('failed', {}).get(key), book)


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
        dictionary = os.path.exists(settings.FREQUENCY_DICTIONARY)
        return {
            'job': job,
            'dictionary': dictionary,
            # The app compares it with its release's (isCanonicalEstimate): another list, term
            # dictionaries or reading model make estimates that don't count for reading rank.
            'engine': readerpack.current_engine() if dictionary else None,
            'customFrequencyList': dictionary and os.path.exists(settings.BUNDLED_FREQUENCY_DICTIONARY)
                                   and file_sha256(settings.FREQUENCY_DICTIONARY) != file_sha256(settings.BUNDLED_FREQUENCY_DICTIONARY),
            'termDictionaries': [os.path.basename(p) for p in readerpack.term_dictionaries()],
            'results': len(results.get('books', {})),
            'noText': len(results.get('noText', [])),
            'failed': len(results.get('failed', {})),
            'workers': settings.WORKERS,
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
        if not os.path.exists(settings.FREQUENCY_DICTIONARY):
            raise RuntimeError(f'Frequency dictionary missing: {settings.FREQUENCY_DICTIONARY}')
        catalog = load_catalog()
        results = load_results()
        wanted = set(ids or ())
        # Books with too little text (scans, manga without mokuro text) can't be estimated, and
        # failed ones are broken files (not a zip, no container.xml), retried once the file changes.
        no_text = set(results.get('noText', []))
        # Manga in noText: the text they had then (none: None), so new text is tried.
        no_text_stamps = results.setdefault('noTextStamps', {})
        failed = results.setdefault('failed', {})
        # All books: needs_estimate. Selected books are always recomputed.
        engine = readerpack.current_engine()
        books = [b for b in catalog if needs_estimate(b, results, engine)] \
            if ids is None else [b for b in catalog if b['id'] in wanted]
        self._progress(0, len(books))
        last_save = time.monotonic()
        done = 0
        for book, result in run_in_pools(books, workers._estimate, self.cancel):
            if isinstance(result, Exception):
                print(f"compute: {book['file']}: {result}", file=sys.stderr)
                failed[str(book['id'])] = {'error': str(result)[:200], 'size': book['size'], 'added': book['added'],
                                           **({'text': book['text']} if book.get('manga') else {})}
            elif result[1]:
                before = results['books'].get(str(result[0]), {})
                # Its text changed (another file or mokuro text): the word list is made again on request.
                if before and (before.get('characters'), before.get('text')) != \
                        (result[1]['characters'], result[1].get('text')):
                    workers.remove_words(result[0])
                results['books'][str(result[0])] = result[1]
                no_text.discard(result[0])
                no_text_stamps.pop(str(result[0]), None)
                failed.pop(str(result[0]), None)
            else:
                no_text.add(result[0])
                if book.get('manga'):
                    no_text_stamps[str(result[0])] = book['text']
                failed.pop(str(result[0]), None)
            results['noText'] = sorted(no_text)
            done += 1
            self._progress(done)
            if time.monotonic() - last_save > 10:
                save_results(results)
                last_save = time.monotonic()
        save_results(results)


runner = JobRunner()


def stale_manga() -> list:
    """Manga whose mokuro text appeared or changed since their estimate (needs_estimate)."""
    if not os.path.exists(settings.FREQUENCY_DICTIONARY):
        return []
    results = load_results()
    engine = readerpack.current_engine()
    return [b['id'] for b in load_catalog() if b.get('manga') and needs_estimate(b, results, engine)]


def watch_manga_text():
    """Estimates manga as their text is made or uploaded (mokuro service), when no other job runs."""
    while True:
        time.sleep(settings.MANGA_TEXT_CHECK_SECONDS)
        try:
            ids = stale_manga()
            if ids:
                runner.start('compute', runner.compute, ids)
        except RuntimeError:
            pass  # another job or a dictionary install: next time
        except Exception as error:
            print(f'manga text: {error}', file=sys.stderr, flush=True)
