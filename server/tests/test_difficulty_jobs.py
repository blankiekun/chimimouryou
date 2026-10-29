"""Tests for the difficulty service's job pools (server/jiten/service.py)."""
import threading
import time
import unittest

from test_readings_file import load_service


class CancelTest(unittest.TestCase):
    def test_cancel_stops_books_in_progress(self):
        service = load_service()
        service._init_worker = int  # the real one loads Sudachi; a builtin pickles under any start method
        cancel = threading.Event()
        threading.Timer(1, cancel.set).start()
        started = time.monotonic()
        # Each "book" sleeps a minute: cancel must not wait for them.
        results = list(service._run_pool([60, 60, 60], time.sleep, cancel, 2, []))
        self.assertEqual(results, [])
        self.assertLess(time.monotonic() - started, 10)


if __name__ == '__main__':
    unittest.main()
