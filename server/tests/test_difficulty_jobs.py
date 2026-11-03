"""Tests for the difficulty service's job pools (server/jiten/jobs.py)."""
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


if __name__ == '__main__':
    unittest.main()
