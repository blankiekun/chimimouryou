"""Tests for the difficulty service's job pools and its results file (server/jiten/jobs.py)."""
import contextlib
import errno
import io
import json
import os
import tempfile
import threading
import time
import unittest

from test_readings_file import load_service


class CancelTest(unittest.TestCase):
    def test_cancel_stops_books_in_progress(self):
        service = load_service()
        service.workers._init_worker = int  # the real one loads Sudachi; a builtin pickles under any start method
        cancel = threading.Event()
        threading.Timer(1, cancel.set).start()
        started = time.monotonic()
        # Each "book" sleeps a minute: cancel must not wait for them.
        results = list(service.jobs._run_pool([60, 60, 60], time.sleep, cancel, 2, []))
        self.assertEqual(results, [])
        self.assertLess(time.monotonic() - started, 10)

    def test_automatic_runs_after_a_cancel(self):
        # Catches: a Cancel with no job running turning automatic estimates off; a cancelled run starting again on
        # the next tick; automatic runs never coming back.
        service = load_service()
        runner = service.jobs.JobRunner()
        now = time.time() * 1000
        hold = service.settings.CANCEL_HOLD_SECONDS * 1000
        for idle in (None, {'type': 'compute', 'finished': now}):
            runner.job = idle
            runner.request_cancel()
            self.assertFalse(runner.holds_off_automatic())
        runner.job = {'type': 'compute'}
        runner.request_cancel()
        runner.job['finished'] = now
        self.assertTrue(runner.holds_off_automatic())
        runner.job['finished'] = now - hold - 1000
        self.assertFalse(runner.holds_off_automatic())


class DamagedResultsTest(unittest.TestCase):
    """A difficulty.json that can't be read holds 2 hours of work on a real library. The ways it could go wrong:
    1. A whole-library or selected-books job reads it as "no estimates" and saves over it.
    2. Damage that still parses (a list, no "books", "books" not an object) gets through, or dies on an unhelpful error.
    3. A read error (EIO), which may pass, is treated as "no estimates" and the next save loses everything.
    4. A missing file blocks the first run.
    5. /status raises, or says nothing while no job has run (after a restart), or answers a job the panel can't draw.
    6. The watcher starts a job, dies, or logs every minute forever; it doesn't resume once the file is removed.
    7. The blocked state outlives the damage, so the panel keeps saying so after the file was removed."""

    GOOD = b'{"books":{"1":{"engine":"e1","computedAt":1}}}'
    DAMAGED = (b'{"books": {"1": {"comput', b'', b'\xff\xfe not text', b'[1, 2]', b'{"noText": []}', b'{"books": [1]}')

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.service = service = load_service()
        self.path = service.settings.RESULTS_PATH = os.path.join(self.tmp.name, 'difficulty.json')
        service.settings.CATALOG_PATH = os.path.join(self.tmp.name, 'catalog.json')
        service.settings.FREQUENCY_DICTIONARY = os.path.join(self.tmp.name, 'frequency-dictionary.zip')
        open(service.settings.FREQUENCY_DICTIONARY, 'w').close()
        with open(service.settings.CATALOG_PATH, 'w') as f:
            json.dump({'books': [{'id': 2, 'title': '本', 'format': 'EPUB', 'size': 10, 'added': 5}]}, f)
        service.readerpack.current_engine = lambda: 'e1'
        service.jobs.run_in_pools = lambda books, task, cancel: (
            (b, (b['id'], {'engine': 'e1', 'characters': 9, 'added': b['added'], 'core': {'v': service.jobs.core.CORE_VERSION}}))
            for b in books)
        self.runner = service.jobs.runner

    def write(self, content):
        with open(self.path, 'wb') as f:
            f.write(content)

    def read(self):
        with open(self.path, 'rb') as f:
            return f.read()

    def run_job(self, ids=None):
        self.runner.job = {'type': 'compute', 'done': 0, 'total': 0, 'started': 1}
        self.runner._run(self.runner.compute, (ids,))

    def assert_blocked_message(self, job):
        self.assertIn(self.path, job['error'])
        self.assertIn('Repair or remove', job['error'])
        # The panel draws these: job.done.toLocaleString() throws without them, and no `finished` spins forever.
        for field in ('done', 'total', 'finished'):
            self.assertIsInstance(job[field], int)

    def test_a_job_never_saves_over_a_damaged_file(self):
        for damaged in self.DAMAGED:
            for ids in (None, [2]):
                with self.subTest(damaged=damaged, ids=ids):
                    self.write(damaged)
                    self.run_job(ids)
                    self.assertEqual(self.read(), damaged)
                    self.assert_blocked_message(self.runner.status()['job'])

    def test_a_read_error_blocks_the_job_and_the_estimates_survive_it(self):
        self.write(self.GOOD)
        service = self.service

        def failing_open(path, *args, **kwargs):
            if path == self.path:
                raise OSError(errno.EIO, 'Input/output error', path)
            return open(path, *args, **kwargs)
        service.jobs.open = failing_open
        self.run_job()
        self.assert_blocked_message(self.runner.status()['job'])
        self.assertEqual(self.read(), self.GOOD)
        service.jobs.refresh_words_stamp()
        self.assertEqual(self.read(), self.GOOD)
        del service.jobs.open
        self.run_job()
        self.assertEqual(sorted(service.jobs.load_results()['books']), ['1', '2'])
        self.assertNotIn('error', self.runner.status()['job'])

    def test_a_missing_file_is_a_first_run(self):
        self.assertEqual(self.service.jobs.load_results(), {'books': {}})
        self.assertIsNone(self.runner.status()['job'])
        self.run_job()
        self.assertEqual(list(self.service.jobs.load_results()['books']), ['2'])
        self.assertNotIn('error', self.runner.status()['job'])

    def test_status_reports_damage_with_no_job_and_leaves_a_running_job_alone(self):
        self.write(self.DAMAGED[0])
        status = self.runner.status()
        self.assertEqual(status['results'], 0)
        self.assert_blocked_message(status['job'])
        self.assertIsNone(self.runner.job)  # what status shows isn't a job that holds off anything

        self.runner.job = {'type': 'compute', 'done': 1, 'total': 5, 'started': 1}
        self.assertNotIn('error', self.runner.status()['job'])
        self.runner.job['finished'] = 2  # a job that went fine, damaged afterwards
        self.assert_blocked_message(self.runner.status()['job'])

    def test_removing_the_file_clears_the_block(self):
        self.write(self.DAMAGED[0])
        self.run_job()
        os.remove(self.path)
        self.assertIsNone(self.runner.status()['job'])
        self.run_job()
        self.assertEqual(list(self.service.jobs.load_results()['books']), ['2'])

    def test_the_watcher_starts_nothing_logs_each_change_once_and_resumes(self):
        jobs = self.service.jobs
        started = []
        self.runner.start = lambda *args: started.append(args)
        # An estimate from a file replaced since: the watcher's business once it can read the results.
        good = b'{"books":{"2":{"engine":"e1","added":1,"core":{"v":%d}}}}' % jobs.core.CORE_VERSION
        self.write(self.DAMAGED[0])
        log = io.StringIO()
        with contextlib.redirect_stderr(log):
            problem = ''
            for _ in range(3):
                problem = jobs.check_stale_books(problem)
            self.assertEqual(started, [])
            self.assertEqual(self.read(), self.DAMAGED[0])
            self.assertEqual(len(log.getvalue().splitlines()), 1)
            self.assertIn(self.path, log.getvalue())
            self.write(good)
            for _ in range(3):
                problem = jobs.check_stale_books(problem)
        self.assertEqual(len(log.getvalue().splitlines()), 2)
        self.assertEqual(len(started), 3)


if __name__ == '__main__':
    unittest.main()
