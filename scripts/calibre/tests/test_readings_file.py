"""Tests for readings files (scripts/calibre/jiten/readings_file.py) and the difficulty service's
readings queue. The reader is faked: yurigana's Reader needs Sudachi."""
import gzip
import importlib.util
import json
import os
import re
import sys
import tempfile
import time
import unittest
import zipfile
from typing import NamedTuple

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, '..', 'jiten'))
import readings_file  # noqa: E402


class Word(NamedTuple):
    start: int
    end: int
    form: str
    reading: str
    source: str
    certainty: float


class Token(NamedTuple):
    begin: int
    text: str
    pos: str

    def surface(self):
        return self.text

    def part_of_speech(self):
        return (self.pos, '*')


class FakeTokenizer:
    """Tokens given as (surface, part of speech), found in the text in order."""

    def __init__(self, tokens):
        self.given = tokens

    def tokens(self, text):
        at = 0
        for surface, pos in self.given:
            at = text.index(surface, at)
            yield Token(at, surface, pos)
            at += len(surface)


class FakeReader:
    """Words given as (surface, form, reading, source), found in the text in order."""

    def __init__(self, *words, tokens=()):
        self.words = words
        self.tokenizer = FakeTokenizer(tokens)

    def read(self, text, hints=(), carry=None):
        assert carry == {}  # one book, one text
        out, at = [], 0
        for surface, form, reading, source in self.words:
            at = text.index(surface, at)
            out.append(Word(at, at + len(surface), form, reading, source, 1.0))
            at += len(surface)
        return out


def build(html, *words):
    return readings_file.build(html, FakeReader(*words), 'bookdata_1_2_3_4_5.zip', '0.1.1')


class CountingTest(unittest.TestCase):
    def test_the_shared_fixture(self):
        # The same fixture is counted by the reader in character-count-fixture.test.ts.
        with open(os.path.join(HERE, 'fixtures', 'character-count.json'), encoding='utf-8') as f:
            fixture = json.load(f)
        text, hints, counts = readings_file.extract(fixture['html'])
        self.assertEqual(text, fixture['text'])
        self.assertEqual(counts[-1], fixture['characters'])
        self.assertEqual(''.join(c for i, c in enumerate(text) if counts[i + 1] > counts[i]), fixture['counted'])
        self.assertEqual([list(h) for h in hints], fixture['hints'])

    def test_sanitize_for_filename_matches_the_reader(self):
        for title, folder in (('普通', '普通'), ('a?b*c. ', 'a%3Fb~ttu-star~c.~ttu-spc~'), ('終わり.', '終わり~ttu-dend~'),
                              ('50%: "x" <y>|z\\/', '50%25%3A %22x%22 %3Cy%3E%7Cz%5C%2F'), ('改行\n.', '改行\n~ttu-dend~')):
            self.assertEqual(readings_file.sanitize_for_filename(title), folder)


class GlossTest(unittest.TestCase):
    def test_dictionary_form_readings_go_over_the_surfaces_kanji(self):
        self.assertEqual(readings_file.gloss('行っ', '行く', 'いく'), [(0, '行', 'い')])
        self.assertEqual(readings_file.gloss('取り扱い', '取り扱い', 'とりあつかい'), [(0, '取', 'と'), (2, '扱', 'あつか')])
        self.assertEqual(readings_file.gloss('大人', '大人', 'おとな'), [(0, '大人', 'おとな')])
        self.assertIsNone(readings_file.gloss('取扱い', '取り扱い', 'とりあつかい'))  # other runs
        self.assertIsNone(readings_file.gloss('行っ', '行く', 'おこなう'))  # doesn't end in く
        # 来る's stem is read by what follows (yurigana's surface_reading).
        self.assertEqual(readings_file.gloss('来', '来る', 'くる', 'た。'), [(0, '来', 'き')])
        self.assertEqual(readings_file.gloss('来', '来る', 'くる', 'ない'), [(0, '来', 'こ')])
        self.assertEqual(readings_file.gloss('来る', '来る', 'くる'), [(0, '来', 'く')])

    def test_the_file(self):
        data = build('<p>彼は<ruby>行<rt>い</rt></ruby>った。<br>行った<img class="gaiji">取り扱い</p>',
                     ('行っ', '行く', 'いく', 'ruby'), ('行っ', '行く', 'いく', 'only'),
                     ('取り扱い', '取り扱い', 'とりあつかい', 'rule'))
        self.assertEqual((data['v'], data['yurigana'], data['bookdata']), (readings_file.READINGS_VERSION, '0.1.1', 'bookdata_1_2_3_4_5.zip'))
        self.assertEqual(data['characters'], 13)  # 彼は行った 行った 〓 取り扱い
        self.assertEqual(data['words'], [['行く', 'いく'], ['取り扱い', 'とりあつかい']])
        self.assertEqual(data['glosses'], [[[0, 1, '行', 'い']], [[0, 1, '取', 'と'], [2, 1, '扱', 'あつか']]])
        # Starts 2, 5 and 9 (the gaiji counts); the one under the book's ruby gets none of ours.
        self.assertEqual(data['occ'], [2, 0, -1, 3, 0, 0, 4, 1, 1])
        self.assertEqual(data['len'], [2, 2, 4])  # no tokens given: the words' own

    def test_lengths_take_a_verbs_or_adjectives_auxiliaries(self):
        data = readings_file.build('<p>黙り込んだ。学生だった。書いている。</p>', FakeReader(
            ('黙り込ん', '黙り込む', 'だまりこむ', 'only'), ('学生', '学生', 'がくせい', 'only'),
            ('書い', '書く', 'かく', 'only'),
            tokens=[('黙り込ん', '動詞'), ('だ', '助動詞'), ('学生', '名詞'), ('だっ', '助動詞'), ('た', '助動詞'),
                    ('書い', '動詞'), ('て', '助詞'), ('いる', '動詞')]), 'b', '0')
        self.assertEqual(data['len'], [5, 2, 2])


class ShowTest(unittest.TestCase):
    def shown(self, html, *words):
        return [g for g in build(html, *words)['occ'][2::3]]

    def test_every_hiragana_reading_whatever_its_source(self):
        self.assertEqual(self.shown('<p>顔と顔と顔と顔と顔</p>', ('顔', '顔', 'かお', 'only'), ('顔', '顔', 'かお', 'model'),
                                    ('顔', '顔', 'かお', 'dictionary'), ('顔', '顔', None, 'dictionary'),
                                    ('顔', '顔', 'カオ', 'rule')), [0, 0, 0, -1, -1])

    def test_a_names_ruby_carried_to_its_bare_occurrences(self):
        self.assertEqual(self.shown('<p><ruby>芽衣<rt>めい</rt></ruby>と芽衣</p>',
                                    ('芽衣', '芽衣', 'めい', 'ruby'), ('芽衣', '芽衣', 'めい', 'book')), [-1, 0])

    def test_katakana_ruby_flavours_the_form_from_there_on(self):
        self.assertEqual(self.shown('<p>本気だ。<ruby>本気<rt>マジ</rt></ruby>だ。本気だ。</p>',
                                    *[('本気', '本気', 'ほんき', s) for s in ('only', 'dictionary', 'only')]), [0, -1, -1])

    def test_rejected_hiragana_ruby_over_the_whole_word_flavours_it(self):
        self.assertEqual(self.shown('<p><ruby>宇宙<rt>そら</rt></ruby>の宇宙</p>',
                                    *[('宇宙', '宇宙', 'うちゅう', s) for s in ('dictionary', 'only')]), [-1, -1])

    def test_partial_or_accepted_hiragana_ruby_does_not(self):
        self.assertEqual(self.shown('<p><ruby>取<rt>と</rt></ruby>り扱い。取り扱い</p>',
                                    *[('取り扱い', '取り扱い', 'とりあつかい', s) for s in ('dictionary', 'only')]), [-1, 0])
        self.assertEqual(self.shown('<p><ruby>宇宙<rt>うちゅう</rt></ruby>の宇宙</p>',
                                    *[('宇宙', '宇宙', 'うちゅう', s) for s in ('ruby', 'only')]), [-1, 0])

    def test_partial_katakana_ruby_does(self):
        self.assertEqual(self.shown('<p><ruby>本<rt>マ</rt></ruby>気だ。本気</p>',
                                    *[('本気', '本気', 'ほんき', s) for s in ('dictionary', 'only')]), [-1, -1])


def load_service():
    spec = importlib.util.spec_from_file_location('jiten_service', os.path.join(HERE, '..', 'jiten', 'service.py'))
    service = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(service)
    return service


class ReadingsQueueTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        tmp = self.tmp.name
        self.service = service = load_service()
        service.FREQUENCY_DICTIONARY = os.path.join(tmp, 'frequency-dictionary.zip')
        open(service.FREQUENCY_DICTIONARY, 'w').close()
        service.CATALOG_PATH = os.path.join(tmp, 'catalog.json')
        with open(service.CATALOG_PATH, 'w') as f:
            json.dump({'books': [{'id': 1, 'title': '本?', 'format': 'EPUB'}, {'id': 2, 'title': '無し', 'format': 'EPUB'},
                                 {'id': 3, 'title': 'ゲーム', 'format': 'VN', 'vn': True}]}, f)
        service.SYNC_DIR = os.path.join(tmp, 'sync')
        service.READINGS_DIR = os.path.join(tmp, 'readings')
        self.folder = os.path.join(service.SYNC_DIR, 'ttu-reader-data', '本%3F')
        self.bookdata = self.add_bookdata('bookdata_1_6_10_1_1.zip')
        service.ensure_reader_pack = lambda: None
        self.queue = service.ReadingsQueue()
        self.queue._start = lambda: 'thread'

    def tearDown(self):
        self.tmp.cleanup()

    def add_bookdata(self, name, html='<p>行った</p>'):
        os.makedirs(self.folder, exist_ok=True)
        path = os.path.join(self.folder, name)
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('staticdata.json', json.dumps({'elementHtml': html}))
        return path

    def test_queued_once_then_ready_until_stale(self):
        service, queue = self.service, self.queue
        self.assertEqual([queue.request(i) for i in (1, 1, 2, 3, 99)], ['queued', 'queued', 'unavailable', 'unavailable', 'unavailable'])
        self.assertEqual(queue.queue, {1: self.bookdata})
        # The worker makes it.
        queue.queue.clear()
        service._reader = FakeReader(('行っ', '行く', 'いく', 'only'))
        service._make_readings(1, self.bookdata)
        self.assertEqual(queue.request(1), 'ready')
        with gzip.open(service.readings_path(1), 'rt', encoding='utf-8') as f:
            self.assertEqual(json.load(f)['occ'], [0, 0, 0])
        # A new bookdata (the book was processed again) or another yurigana make it stale.
        newer = self.add_bookdata('bookdata_1_6_10_2_2.zip', html='<p>行ったよ</p>')
        os.utime(newer, (2e9, 2e9))
        self.assertEqual(queue.request(1), 'queued')
        self.assertEqual(queue.queue, {1: newer})
        queue.queue.clear()
        service._make_readings(1, newer)
        self.assertEqual(queue.request(1), 'ready')
        # Processed again with the same text: the file is kept and points at the newest bookdata.
        again = self.add_bookdata('bookdata_1_6_10_4_4.zip', html='<p>行ったよ</p>')
        os.utime(again, (4e9, 4e9))
        self.assertEqual(queue.request(1), 'ready')
        self.assertEqual(readings_file.header(service.readings_path(1))[2], 'bookdata_1_6_10_4_4.zip')
        service.YURIGANA_VERSION = '9.9.9'
        self.assertEqual(queue.request(1), 'queued')

    def test_full_queue_failures_and_no_dictionary(self):
        queue = self.queue
        queue.queue = {-i: 'x' for i in range(self.service.READINGS_QUEUE_MAX)}
        self.assertEqual(queue.request(1), 'unavailable')
        queue.queue = {}
        queue.failed[1] = os.path.basename(self.bookdata)
        self.assertEqual(queue.request(1), 'unavailable')
        queue.failed[1] = 'bookdata_older.zip'
        self.assertEqual(queue.request(1), 'queued')
        queue.queue = {}
        os.remove(self.service.FREQUENCY_DICTIONARY)
        self.assertEqual(queue.request(1), 'unavailable')

    def test_the_worker_makes_queued_files_and_remembers_failures(self):
        from concurrent.futures import ThreadPoolExecutor
        service, queue = self.service, self.service.ReadingsQueue()
        service.ProcessPoolExecutor = lambda workers, initializer: ThreadPoolExecutor(workers)
        service.READINGS_KEEP_ALIVE = 0
        service._reader = FakeReader(('行っ', '行く', 'いく', 'only'))
        self.assertEqual(queue.request(1), 'queued')
        queue.thread.join(10)
        self.assertEqual((queue.request(1), queue.thread), ('ready', None))
        broken = self.add_bookdata('bookdata_1_6_10_3_3.zip', html=None)
        os.utime(broken, (3e9, 3e9))
        self.assertEqual(queue.request(1), 'queued')
        queue.thread.join(10)
        self.assertEqual((queue.failed, queue.request(1)), ({1: 'bookdata_1_6_10_3_3.zip'}, 'unavailable'))
        # A request can wait for its file: answered when it is made.
        os.remove(service.readings_path(1))
        queue.failed.clear()
        os.remove(broken)
        self.assertEqual(queue.request(1, wait=10), 'ready')
        self.assertEqual(queue.request(1, wait=10), 'ready')

    def test_the_worker_stays_loaded_for_the_next_book(self):
        from concurrent.futures import ThreadPoolExecutor
        service, queue = self.service, self.service.ReadingsQueue()
        pools = []
        service.ProcessPoolExecutor = lambda workers, initializer: pools.append(1) or ThreadPoolExecutor(workers)
        service._reader = FakeReader(('行っ', '行く', 'いく', 'only'))
        service.READINGS_KEEP_ALIVE = 30
        self.assertEqual(queue.request(1), 'queued')
        for _ in range(100):
            if queue.request(1) == 'ready':
                break
            time.sleep(0.05)
        thread = queue.thread
        self.assertTrue(thread.is_alive())
        os.remove(service.readings_path(1))
        self.assertEqual(queue.request(1), 'queued')
        for _ in range(100):
            if queue.request(1) == 'ready':
                break
            time.sleep(0.05)
        self.assertEqual((queue.request(1), queue.thread, len(pools)), ('ready', thread, 1))
        service.READINGS_KEEP_ALIVE = 0
        thread.join(10)
        self.assertIsNone(queue.thread)

    def test_oversized_staticdata_is_refused(self):
        self.service.MAX_STATICDATA_BYTES = 10
        with self.assertRaises(ValueError):
            self.service._make_readings(1, self.bookdata)


class WordsQueueTest(unittest.TestCase):
    """Word lists are made on first request; lists made with their estimate keep its totals."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        tmp = self.tmp.name
        self.service = service = load_service()
        service.FREQUENCY_DICTIONARY = os.path.join(tmp, 'frequency-dictionary.zip')
        open(service.FREQUENCY_DICTIONARY, 'w').close()
        service.CATALOG_PATH = os.path.join(tmp, 'catalog.json')
        with open(service.CATALOG_PATH, 'w') as f:
            json.dump({'books': [{'id': i, 'title': f'本{i}', 'format': 'EPUB', 'size': 10, 'added': 0}
                                 for i in (1, 5, 6)]}, f)
        service.WORDS_DIR = os.path.join(tmp, 'words')
        service.RESULTS_PATH = os.path.join(tmp, 'difficulty.json')
        service.ensure_reader_pack = lambda: None

    def tearDown(self):
        self.tmp.cleanup()

    def test_queued_once_then_ready(self):
        queue = self.service.WordsQueue()
        queue._start = lambda: 'thread'
        self.assertEqual([queue.request(i) for i in (1, 1, 99)], ['queued', 'queued', 'unavailable'])
        queue.queue.clear()
        self.service.write_words(1, {'words': [], 'uniqueWords': 0, 'tokens': 0})
        self.assertEqual(queue.request(1), 'ready')
        queue.failed[5] = queue.failure({'size': 10, 'added': 0})
        self.assertEqual(queue.request(5), 'unavailable')

    def test_the_worker_makes_it_while_the_request_waits(self):
        from concurrent.futures import ThreadPoolExecutor
        service = self.service
        service.ProcessPoolExecutor = lambda workers, initializer: ThreadPoolExecutor(workers)
        service.READINGS_KEEP_ALIVE = 0
        queue = service.WordsQueue()
        queue.task = lambda book_id, book: service.write_words(book_id, {'words': [book['title']]})
        self.assertEqual(queue.request(6, wait=10), 'ready')
        with gzip.open(service.words_path(6), 'rt', encoding='utf-8') as f:
            self.assertEqual(json.load(f), {'words': ['本6']})

    def test_legacy_lists_keep_their_estimates_totals(self):
        service = self.service
        os.makedirs(service.WORDS_DIR)
        for book_id in (1, 5):
            with gzip.open(service.legacy_words_path(book_id), 'wt', encoding='utf-8') as f:
                json.dump([['猫', 'ねこ', 3, 1200, '猫']], f)
        service.save_results({'books': {'1': {'words': 19, 'uniqueWords': 7, 'tokens': 30},
                                        '5': {'words': 18, 'uniqueWords': 7, 'tokens': 30}}})
        service.migrate_word_lists()
        # A new estimate replaces the old one: the totals were kept.
        service.save_results({'books': {'1': {'core': {}}, '5': {'core': {}}}})
        service.migrate_word_lists()
        queue = service.WordsQueue()
        queue._start = lambda: 'thread'
        self.assertEqual(queue.request(1), 'ready')
        with gzip.open(service.words_path(1), 'rt', encoding='utf-8') as f:
            self.assertEqual(json.load(f), {'words': [['猫', 'ねこ', 3, 1200, '猫']], 'uniqueWords': 7, 'tokens': 30})
        # An older list has no totals to keep: it is made again.
        self.assertEqual(queue.request(5), 'queued')
        self.assertFalse(os.path.exists(service.legacy_words_path(1)) or os.path.exists(service.legacy_words_path(5)))


class NginxTest(unittest.TestCase):
    def test_readers_reach_readings_files_without_the_difficulty_permission(self):
        with open(os.path.join(HERE, '..', 'nginx-ebook-reader.conf.template'), encoding='utf-8') as f:
            template = f.read()
        block = re.search(r'location ~ \^/calibre/difficulty/api/readings/[^{]*\{(.*?)\n  \}', template, re.S).group(1)
        self.assertIn('auth_request /_account_shared;', block)
        self.assertIn('limit_req zone=readings', block)
        api = re.search(r'location /calibre/difficulty/api/ \{(.*?)\n  \}', template, re.S).group(1)
        self.assertIn('auth_request /_account_difficulty_writes;', api)


class ReaderPackTest(unittest.TestCase):
    """READER_PACK is built once, again when its inputs change; workers load it or build their own."""

    def test_built_once_then_again_when_its_inputs_change(self):
        from concurrent.futures import ThreadPoolExecutor
        from unittest import mock
        made = []

        class Reader:
            def __init__(self, **options):
                made.append(options)

            def save(self, path):
                with open(path, 'w') as f:
                    f.write('pack')

            @classmethod
            def load(cls, path, tables, tokenizer):
                return ('loaded', path, tokenizer)

        class FrequencyTable:
            @classmethod
            def load(cls, path):
                return cls()

            def save(self, path):
                open(path, 'w').close()

        service = load_service()
        fakes = {'yurigana': mock.Mock(Reader=Reader), 'frequency': mock.Mock(FrequencyTable=FrequencyTable)}
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(sys.modules, fakes):
            service.ProcessPoolExecutor = ThreadPoolExecutor
            service.FREQUENCY_DICTIONARY = os.path.join(tmp, 'frequency-dictionary.zip')
            service.TERM_DICTIONARY_DIR = os.path.join(tmp, 'term-dictionaries')
            service.READER_PACK = os.path.join(tmp, 'reader.ygp')
            service.FREQUENCY_PACK = os.path.join(tmp, 'frequency.ygp')
            with open(service.FREQUENCY_DICTIONARY, 'w') as f:
                f.write('a')
            self.assertIsInstance(service._load_reader(), Reader)  # no pack yet: built in the worker
            service.ensure_reader_pack()
            service.ensure_reader_pack()
            self.assertEqual(len(made), 2)
            self.assertEqual(made[1], {'known': service.FREQUENCY_DICTIONARY})
            self.assertEqual(service._load_reader('tokenizer'), ('loaded', service.READER_PACK, 'tokenizer'))
            with open(service.FREQUENCY_DICTIONARY, 'w') as f:
                f.write('a newer list')
            self.assertFalse(service.reader_pack_current())
            service.ensure_reader_pack()
            self.assertEqual((len(made), service.reader_pack_current()), (3, True))


if __name__ == '__main__':
    unittest.main()
