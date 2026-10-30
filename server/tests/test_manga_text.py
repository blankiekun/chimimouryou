"""Tests for manga estimates from mokuro text in the difficulty service (server/jiten/service.py).
Scoring is faked: the real one needs Sudachi."""
import json
import os
import tempfile
import unittest

from test_readings_file import load_service


class MangaTextTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        tmp = self.tmp.name
        self.service = service = load_service()
        service.settings.MOKURO_DIR = os.path.join(tmp, 'mokuro')
        service.settings.WORDS_DIR = os.path.join(tmp, 'words')
        service.settings.RESULTS_PATH = os.path.join(tmp, 'difficulty.json')
        service.settings.CATALOG_PATH = os.path.join(tmp, 'catalog.json')
        service.settings.FREQUENCY_DICTIONARY = os.path.join(tmp, 'frequency-dictionary.zip')
        open(service.settings.FREQUENCY_DICTIONARY, 'w').close()
        service.readerpack.current_engine = lambda: 'e1'
        os.makedirs(service.settings.MOKURO_DIR)
        os.makedirs(service.settings.WORDS_DIR)
        with open(service.settings.CATALOG_PATH, 'w') as f:
            json.dump({'books': [
                {'id': 1, 'title': '本', 'format': 'EPUB', 'size': 10, 'added': 0},
                {'id': 2, 'title': '漫画 1', 'format': 'CBZ', 'size': 10, 'added': 0},
                {'id': 3, 'title': '漫画 2', 'format': 'ZIP', 'size': 10, 'added': 0},
                {'id': 4, 'title': 'ゲーム', 'format': 'ZIP', 'size': 10, 'added': 0, 'vn': True},
            ]}, f)
        self.scored = []
        self.characters = 2000

        def run_in_pools(books, task, cancel, initializer=None):
            for book in books:
                self.scored.append(book['id'])
                text = service.workers.manga_text(book['id']) if book.get('manga') else 'x' * self.characters
                yield book, (book['id'], None if len(text) < 10 else {
                    'engine': 'e1', 'characters': len(text), 'core': {'v': service.jobs.core.CORE_VERSION},
                    **({'text': book['text']} if book.get('manga') else {})})
        service.jobs.run_in_pools = run_in_pools

    def tearDown(self):
        self.tmp.cleanup()

    def write_text(self, book_id, pages, mtime):
        path = self.service.workers.manga_path(book_id)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({'pages': pages}, f, ensure_ascii=False)
        os.utime(path, (mtime, mtime))

    def compute(self, ids=None):
        self.scored = []
        self.service.jobs.runner.job = {'type': 'compute'}
        self.service.jobs.runner.compute(ids)
        return self.scored

    def test_a_new_engine_redoes_estimates_and_other_text_drops_the_word_list(self):
        service = self.service
        self.assertEqual(self.compute(), [1, 4])
        self.assertEqual(self.compute(), [])
        service.workers.write_words(1, {'words': [], 'uniqueWords': 0, 'tokens': 0})
        service.readerpack.current_engine = lambda: 'e2'
        self.assertEqual(self.compute(), [1, 4])
        self.assertTrue(os.path.exists(service.workers.words_path(1)))  # same text: the list stays
        self.characters = 3000
        self.compute([1])
        self.assertFalse(os.path.exists(service.workers.words_path(1)))

    def test_a_new_core_version_redoes_estimates(self):
        self.assertEqual(self.compute(), [1, 4])
        self.service.jobs.core.CORE_VERSION += 1
        try:
            self.assertEqual(self.compute(), [1, 4])
        finally:
            self.service.jobs.core.CORE_VERSION -= 1

    def test_text_is_a_line_per_bubble(self):
        self.write_text(2, [{'blocks': [{'lines': ['吾輩は', '猫である。']}, {'lines': [' ']}]},
                            {'blocks': [{'lines': ['名前はまだ無い。']}]}, {}], 100)
        self.assertEqual(self.service.workers.manga_text(2), '吾輩は猫である。\n名前はまだ無い。')
        self.assertEqual(self.service.workers.manga_text(3), '')

    def test_catalog_marks_manga_and_their_text(self):
        self.write_text(2, [], 100)
        books = {b['id']: b for b in self.service.jobs.load_catalog()}
        self.assertEqual((books[2]['manga'], books[2]['text']), (True, 100_000))
        self.assertEqual((books[3]['manga'], books[3]['text']), (True, None))
        self.assertNotIn('manga', books[1])
        self.assertNotIn('manga', books[4])

    def test_manga_are_estimated_when_their_text_appears_or_changes(self):
        long_text = [{'blocks': [{'lines': ['吾輩は猫である。名前はまだ無い。']}]}]
        self.write_text(2, long_text, 100)
        # The library run: the book and the manga with text, not the one without.
        self.assertEqual(sorted(self.compute()), [1, 2, 4])
        self.assertEqual(self.service.jobs.load_results()['books']['2']['text'], 100_000)
        self.assertEqual(self.service.jobs.stale_manga(), [])
        self.assertEqual(self.compute(), [])
        # New text for 2, first text for 3.
        self.write_text(2, long_text, 200)
        self.write_text(3, long_text, 100)
        self.assertEqual(self.service.jobs.stale_manga(), [2, 3])
        self.assertEqual(sorted(self.compute(self.service.jobs.stale_manga())), [2, 3])
        self.assertEqual(self.service.jobs.stale_manga(), [])

    def test_too_little_text_waits_for_other_text(self):
        self.write_text(2, [{'blocks': [{'lines': ['短い']}]}], 100)
        self.assertEqual(self.compute([2]), [2])
        results = self.service.jobs.load_results()
        self.assertEqual((results['noText'], results['noTextStamps']), ([2], {'2': 100_000}))
        self.assertEqual(self.service.jobs.stale_manga(), [])
        self.write_text(2, [{'blocks': [{'lines': ['吾輩は猫である。名前はまだ無い。']}]}], 200)
        self.assertEqual(self.service.jobs.stale_manga(), [2])
        self.compute([2])
        results = self.service.jobs.load_results()
        self.assertEqual((results['noText'], results['noTextStamps']), ([], {}))

    def test_failed_manga_are_retried_with_other_text(self):
        failure = {'error': 'x', 'size': 10, 'added': 0, 'text': 100_000}
        book = {'id': 2, 'format': 'CBZ', 'size': 10, 'added': 0, 'manga': True, 'text': 100_000}
        self.assertTrue(self.service.jobs.unchanged_since_failure(failure, book))
        self.assertFalse(self.service.jobs.unchanged_since_failure(failure, {**book, 'text': 200_000}))
        # Books keep their old rule (no 'text' on either side).
        self.assertTrue(self.service.jobs.unchanged_since_failure({'size': 10}, {'size': 10}))
        # A failed game is retried once its folder changes.
        unchanged = self.service.jobs.unchanged_since_failure
        failure = {'size': 0, 'added': 1}
        self.assertTrue(unchanged(failure, {'format': 'VN', 'size': 0, 'added': 1}))
        self.assertFalse(unchanged(failure, {'format': 'VN', 'size': 0, 'added': 2}))
        self.assertTrue(unchanged({'size': 5}, {'format': 'EPUB', 'size': 5, 'added': 9}))
        self.assertFalse(unchanged(None, {'format': 'EPUB', 'size': 5, 'added': 9}))

    def test_readings_files_skip_manga(self):
        self.service.workers.find_text = lambda book: self.fail('looked up ' + book['title'])
        self.assertEqual(self.service.queues.ReadingsQueue()._request(2), 'unavailable')


if __name__ == '__main__':
    unittest.main()
