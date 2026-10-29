"""Tests for jiten/frequency.py (Yomitan ranks). Run from the repo root:
python3 -m unittest discover -s server/tests
"""
import json
import os
import sys
import tempfile
import unittest
import zipfile
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'engine'))
from frequency import TOP_SHARE, FrequencyTable, load_yomitan_ranks, reading_agreement  # noqa: E402

ENTRIES = [
    ['ある', 'freq', {'value': 18, 'displayValue': '18㋕'}],
    ['有る', 'freq', {'reading': 'ある', 'frequency': {'value': 12756, 'displayValue': '12756'}}],
    ['有る', 'freq', {'reading': 'ある', 'frequency': {'value': 18}}],
    ['在る', 'freq', {'reading': 'ある', 'frequency': 10382}],
    ['魔法', 'freq', {'reading': 'まほう', 'frequency': 1986}],
    ['事', 'freq', {'reading': 'こと', 'frequency': 30}],
    ['事', 'freq', {'reading': 'じ', 'frequency': 9000}],
]


def dictionary(mode='rank-based', entries=ENTRIES):
    path = os.path.join(tempfile.mkdtemp(), 'freq.zip')
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('index.json', json.dumps({'title': 'T', 'format': 3, 'frequencyMode': mode}))
        archive.writestr('term_meta_bank_1.json', json.dumps(entries))
    return path


def with_reading(form, reading):
    """ENTRIES with every entry of form read as reading instead."""
    return [[t, k, {'reading': reading, 'frequency': d.get('frequency', d)} if t == form else d]
            for t, k, d in ENTRIES]


class YomitanRanksTest(unittest.TestCase):
    def test_best_rank_per_term(self):
        self.assertEqual(load_yomitan_ranks(dictionary()), {'ある': 18, '有る': 18, '在る': 10382, '魔法': 1986, '事': 30})

    def test_rejects_occurrence_based(self):
        with self.assertRaises(ValueError):
            load_yomitan_ranks(dictionary('occurrence-based'))

    def test_word_and_spelling_lookups(self):
        table = FrequencyTable.load(dictionary())
        self.assertEqual(table.word('有る\tverb'), (18, TOP_SHARE / 18))
        self.assertIsNone(table.word('珍語\tnoun'))  # not in the dictionary: skipped, as in Jiten
        self.assertEqual(table.form('有る\tverb', 'ある'), (18, TOP_SHARE / 18, 100))
        rank, _, percentage = table.form('有る\tverb', '在る')
        self.assertEqual(rank, 10382)
        self.assertAlmostEqual(percentage, 100 * 18 / 10382)
        self.assertIsNone(table.form('有る\tverb', 'アル'))

    def test_reading_tells_homographs_apart(self):
        table = FrequencyTable.load(dictionary())
        self.assertEqual(table.word('事\tnoun', 'じ')[0], 9000)
        self.assertEqual(table.word('事\tnoun', 'こと')[0], 30)
        self.assertEqual(table.word('事\tnoun')[0], 30)  # unknown reading: the most common one
        self.assertEqual(table.word('魔法\tnoun', 'まじっく')[0], 1986)  # reading not listed: the spelling's rank

    def test_saved_table_reads_the_same(self):
        table = FrequencyTable.load(dictionary())
        with tempfile.TemporaryDirectory() as tmp:
            table.save(os.path.join(tmp, 'frequency.ygp'))
            packed = FrequencyTable.load_packed(os.path.join(tmp, 'frequency.ygp'))
            for key, reading in (('事\tnoun', 'じ'), ('事\tnoun', 'こと'), ('事\tnoun', None), ('魔法\tnoun', 'まじっく'),
                                 ('珍語\tnoun', None)):
                self.assertEqual(packed.word(key, reading), table.word(key, reading))
            self.assertEqual(packed.form('有る\tverb', '在る'), table.form('有る\tverb', '在る'))
            self.assertEqual((('事', 'じ') in packed.reading_ranks, ('事', 'ず') in packed.reading_ranks), (True, False))

    def test_reading_agreement(self):
        old = dictionary()
        self.assertEqual(reading_agreement(old, dictionary()), 1.0)
        # Top forms by rank: ある, 有る, 事, 魔法, 在る. One read otherwise, one dropped.
        self.assertEqual(reading_agreement(old, dictionary(entries=with_reading('魔法', 'まじっく'))), 0.8)
        self.assertEqual(reading_agreement(old, dictionary(entries=ENTRIES[1:])), 0.8)  # ある gone
        self.assertEqual(reading_agreement(old, dictionary(entries=ENTRIES[:-1])), 1.0)  # 事 keeps こと
        self.assertEqual(reading_agreement(old, dictionary(entries=with_reading('事', 'ごと')), top=2), 1.0)



class InstallDictionaryTest(unittest.TestCase):
    def setUp(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            'jiten_service', os.path.join(os.path.dirname(__file__), '..', 'jiten', 'service.py'))
        self.service = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.service)
        self.service.FREQUENCY_DICTIONARY = os.path.join(tempfile.mkdtemp(), 'frequency-dictionary.zip')
        self.service.MIN_DICTIONARY_TERMS = 5

    def install(self, data: bytes, force=False):
        import io
        # Bytes past Content-Length stand in for a socket that stays open: they must not be read.
        return self.service.install_dictionary(io.BytesIO(data + b'next request'), len(data), force)

    def test_no_job_starts_during_an_install(self):
        runner = self.service.runner
        # A job asked for while the upload is checked is refused.
        with mock.patch('frequency.load_yomitan_ranks', side_effect=lambda _: runner.start('x', print)):
            with self.assertRaisesRegex(RuntimeError, 'being installed'):
                self.install(b'zip')
        self.assertIsNone(runner.job)
        self.assertFalse(runner.installing)

    def test_a_failed_game_is_retried_once_its_folder_changes(self):
        unchanged = self.service.unchanged_since_failure
        failure = {'size': 0, 'added': 1}
        self.assertTrue(unchanged(failure, {'format': 'VN', 'size': 0, 'added': 1}))
        self.assertFalse(unchanged(failure, {'format': 'VN', 'size': 0, 'added': 2}))
        self.assertTrue(unchanged({'size': 5}, {'format': 'EPUB', 'size': 5, 'added': 9}))
        self.assertFalse(unchanged(None, {'format': 'EPUB', 'size': 5, 'added': 9}))

    def test_refuses_small_lists(self):
        self.service.MIN_DICTIONARY_TERMS = 6
        with open(dictionary(), 'rb') as f, self.assertRaises(ValueError):
            self.install(f.read())
        self.assertFalse(os.path.exists(self.service.FREQUENCY_DICTIONARY))

    def test_replacement_must_agree_unless_forced(self):
        with open(dictionary(), 'rb') as f:
            self.install(f.read())
        # A list that agrees (a new version of the same one) needs no force.
        with open(dictionary(entries=ENTRIES[:-1]), 'rb') as f:
            installed = f.read()
        self.assertEqual(self.install(installed), 5)
        with open(dictionary(entries=with_reading('魔法', 'まじっく')), 'rb') as f:
            other = f.read()
        with self.assertRaises(self.service.DictionaryMismatch) as error:
            self.install(other)
        self.assertEqual(error.exception.agreement, 0.8)
        with open(self.service.FREQUENCY_DICTIONARY, 'rb') as f:
            self.assertEqual(f.read(), installed)
        self.assertEqual(self.install(other, force=True), 5)
        with open(self.service.FREQUENCY_DICTIONARY, 'rb') as f:
            self.assertEqual(f.read(), other)

    def test_installs_a_rank_based_list(self):
        with open(dictionary(), 'rb') as f:
            self.assertEqual(self.install(f.read()), 5)
        self.assertTrue(os.path.exists(self.service.FREQUENCY_DICTIONARY))

    def test_rejects_oversized_members(self):
        import frequency
        limit = frequency.MAX_MEMBER_BYTES
        frequency.MAX_MEMBER_BYTES = 100  # the term bank is bigger
        try:
            with open(dictionary(), 'rb') as f, self.assertRaises(ValueError):
                self.install(f.read())
        finally:
            frequency.MAX_MEMBER_BYTES = limit

    def test_bundled_list_is_installed_only_when_none_is(self):
        bundled_path = self.service.BUNDLED_FREQUENCY_DICTIONARY = dictionary()
        self.service.install_bundled_dictionary()
        with open(self.service.FREQUENCY_DICTIONARY, 'rb') as f, open(bundled_path, 'rb') as bundled:
            self.assertEqual(f.read(), bundled.read())
        with open(dictionary(entries=ENTRIES[:-1]), 'rb') as f:
            uploaded = f.read()
        self.install(uploaded)
        self.service.install_bundled_dictionary()
        with open(self.service.FREQUENCY_DICTIONARY, 'rb') as f:
            self.assertEqual(f.read(), uploaded)

    def test_rejects_other_files_and_keeps_the_current_one(self):
        for data in (b'not a zip', open(dictionary('occurrence-based'), 'rb').read()):
            with self.assertRaises(ValueError):
                self.install(data)
        self.assertFalse(os.path.exists(self.service.FREQUENCY_DICTIONARY))
        self.assertEqual(os.listdir(os.path.dirname(self.service.FREQUENCY_DICTIONARY)), [])


def _has_term_dictionaries():
    try:
        from yurigana.yomitan import term_readings  # noqa: F401
        return True
    except ImportError:
        return False


@unittest.skipUnless(_has_term_dictionaries(), 'needs a yurigana with term dictionaries')
class InstallTermDictionaryTest(unittest.TestCase):
    def setUp(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            'jiten_service', os.path.join(os.path.dirname(__file__), '..', 'jiten', 'service.py'))
        self.service = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.service)
        self.service.TERM_DICTIONARY_DIR = os.path.join(tempfile.mkdtemp(), 'term-dictionaries')
        self.service.MIN_TERM_DICTIONARY_TERMS = 2

    def zip(self, rows):
        path = os.path.join(tempfile.mkdtemp(), 'terms.zip')
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('index.json', json.dumps({'title': 'test', 'format': 3}))
            archive.writestr('term_bank_1.json', json.dumps([[t, r, '', '', 0, [], 0, ''] for t, r in rows], ensure_ascii=False))
        with open(path, 'rb') as f:
            return f.read()

    def install(self, data: bytes, name='My terms.zip'):
        import io
        return self.service.install_term_dictionary(io.BytesIO(data + b'next request'), len(data), name)

    def test_installs_lists_and_removes(self):
        self.assertEqual(self.service.term_options(), {})
        version = self.service.reader_version()
        self.assertEqual(self.install(self.zip([('星喰竜', 'ほしくいりゅう'), ('女剣豪', 'おんなけんごう')])), 2)
        self.assertEqual(self.service.runner.status()['termDictionaries'], ['My terms.zip'])
        self.assertEqual(len(self.service.term_options()['terms']), 1)
        self.assertNotEqual(self.service.reader_version(), version)  # readings files made before are stale
        self.service.remove_term_dictionary('My terms')
        self.assertEqual(self.service.term_dictionaries(), [])
        self.assertEqual(self.service.reader_version(), version)

    def test_jmnedict_is_a_name_dictionary(self):
        from yurigana.yomitan import name_readings  # noqa: F401 (yurigana 0.5.1+)
        path = os.path.join(tempfile.mkdtemp(), 'names.zip')
        with zipfile.ZipFile(path, 'w') as archive:  # yomitan-import's JMnedict: readings in the glosses
            archive.writestr('index.json', json.dumps({'title': 'JMnedict [2026-10-20]', 'format': 3}))
            archive.writestr('term_bank_1.json', json.dumps([[t, '', '', '', 0, [r], 0, ''] for t, r in
                                                             (('姫路', 'ひめじ'), ('柚木', 'ゆずき'), ('柚木', 'ゆのき'))], ensure_ascii=False))
        with open(path, 'rb') as f:
            self.assertEqual(self.install(f.read(), 'JMnedict.zip'), 2)  # as terms, no row would count
        self.install(self.zip([('星喰竜', 'ほしくいりゅう'), ('女剣豪', 'おんなけんごう')]))
        options = self.service.term_options()
        self.assertEqual([os.path.basename(p) for p in options['names']], ['JMnedict.zip'])
        self.assertEqual([os.path.basename(p) for p in options['terms']], ['My terms.zip'])

    def test_refuses_bad_files_and_names(self):
        for data in (b'not a zip', self.zip([('星喰竜', 'ほしくいりゅう'), ('ルキア(QMA)', 'るきあ')])):
            with self.assertRaises(ValueError):
                self.install(data)
        for name in ('../x.zip', 'a/b.zip', '.zip', ''):
            with self.assertRaises(ValueError):
                self.install(self.zip([('星喰竜', 'ほしくいりゅう'), ('女剣豪', 'おんなけんごう')]), name)
        self.assertEqual(self.service.term_dictionaries(), [])
        self.assertEqual([n for n in os.listdir(self.service.TERM_DICTIONARY_DIR)], [])


class KanjiEndpointTest(unittest.TestCase):
    def test_saved_counts_are_served(self):
        import importlib.util
        import threading
        import urllib.error
        import urllib.request
        from http.server import ThreadingHTTPServer
        spec = importlib.util.spec_from_file_location(
            'jiten_service_kanji', os.path.join(os.path.dirname(__file__), '..', 'jiten', 'service.py'))
        service = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(service)
        service.KANJI_DIR = tempfile.mkdtemp()
        service.INTERNAL_TOKEN_FILE = os.path.join(service.KANJI_DIR, 'token')
        with open(service.INTERNAL_TOKEN_FILE, 'w') as f:
            f.write('c0ffee')
        service.save_kanji(7, '魔法の魔女')
        def get(url, token='c0ffee'):
            return urllib.request.urlopen(urllib.request.Request(url, headers={'X-Internal-Token': token}))
        server = ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            base = f'http://127.0.0.1:{server.server_port}'
            with get(f'{base}/kanji/7') as response:
                import gzip
                self.assertEqual(json.loads(gzip.decompress(response.read())), {'魔': 2, '法': 1, '女': 1})
            for path in ('/kanji/8', '/kanji/..%2Fx', '/kanji/%C2%B2'):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    get(base + path)
                self.assertEqual(error.exception.code, 404)
            with self.assertRaises(urllib.error.HTTPError) as error:
                get(f'{base}/kanji/7', token='')
            self.assertEqual(error.exception.code, 403)

            def post(origin):
                headers = {'X-Internal-Token': 'c0ffee', 'Host': 'reader.example'}
                if origin:
                    headers['Origin'] = origin
                request = urllib.request.Request(f'{base}/nothing', data=b'{}', headers=headers)
                try:
                    return urllib.request.urlopen(request).status
                except urllib.error.HTTPError as error:
                    return error.code
            # Other sites can't post with the reader's cookie; past the check, an unknown action is 404.
            self.assertEqual(post(None), 403)
            self.assertEqual(post('https://evil.example'), 403)
            self.assertEqual(post('http://reader.example'), 403)
            self.assertEqual(post('https://reader.example'), 404)

            def upload(admin, path='/dictionary'):
                headers = {'X-Internal-Token': 'c0ffee', 'Host': 'reader.example',
                           'Origin': 'https://reader.example', 'X-Account-Admin': admin}
                request = urllib.request.Request(base + path, data=b'not a zip', headers=headers)
                try:
                    return urllib.request.urlopen(request).status
                except urllib.error.HTTPError as error:
                    return error.code
            service.FREQUENCY_DICTIONARY = os.path.join(service.KANJI_DIR, 'freq.zip')
            # Only admins (nginx's account check) get past to the file checks.
            self.assertEqual(upload('0'), 403)
            self.assertEqual(upload(''), 403)
            self.assertEqual(upload('1'), 400)
        finally:
            server.shutdown()
            server.server_close()


class RanksEndpointTest(unittest.TestCase):
    def test_ranks_of_listed_forms(self):
        import importlib.util
        import threading
        import urllib.error
        import urllib.request
        from http.server import ThreadingHTTPServer
        spec = importlib.util.spec_from_file_location(
            'jiten_service_ranks', os.path.join(os.path.dirname(__file__), '..', 'jiten', 'service.py'))
        service = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(service)
        service.FREQUENCY_DICTIONARY = dictionary()
        service.READER_PACK = os.path.join(tempfile.mkdtemp(), 'missing.ygp')
        service.INTERNAL_TOKEN_FILE = os.path.join(tempfile.mkdtemp(), 'token')
        with open(service.INTERNAL_TOKEN_FILE, 'w') as f:
            f.write('c0ffee')
        server = ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()

        def post(body, origin='https://reader.example', length=None):
            headers = {'X-Internal-Token': 'c0ffee', 'Host': 'reader.example', 'Origin': origin,
                       'Content-Type': 'application/json'}
            if length is not None:
                headers['Content-Length'] = str(length)
            request = urllib.request.Request(f'http://127.0.0.1:{server.server_port}/ranks', data=body, headers=headers)
            try:
                with urllib.request.urlopen(request) as response:
                    return response.status, json.loads(response.read())
            except urllib.error.HTTPError as error:
                return error.code, None
        try:
            # Unlisted forms and non-strings are left out; a form takes its best rank over its readings.
            status, body = post(json.dumps({'forms': ['事', '魔法', '無い', 3]}).encode())
            self.assertEqual((status, body), (200, {'ranks': {'事': 30, '魔法': 1986}}))
            self.assertEqual(post(b'{"forms": "x"}')[0], 400)
            self.assertEqual(post(b'not json')[0], 400)
            self.assertEqual(post(json.dumps({'forms': ['x'] * (service.MAX_RANK_FORMS + 1)}).encode())[0], 400)
            # Only the header is too large: a real 1 MB body races the early 413 into a broken pipe.
            self.assertEqual(post(b'{}', length=service.MAX_RANKS_BYTES + 1)[0], 413)
            self.assertEqual(post(b'{"forms": []}', origin='https://evil.example')[0], 403)
        finally:
            server.shutdown()
            server.server_close()


class NginxTest(unittest.TestCase):
    def test_frequency_list_upload_is_admin_only(self):
        import re
        path = os.path.join(os.path.dirname(__file__), '..', 'nginx-ebook-reader.conf.template')
        with open(path, encoding='utf-8') as f:
            template = f.read()
        block = re.search(r'location = /calibre/difficulty/api/dictionary \{(.*?)\n  \}', template, re.S).group(1)
        self.assertIn('auth_request /_account_admin;', block)
        # The service's own check reads X-Account-Admin: every location reaching it sets it from the account.
        api = re.search(r'location /calibre/difficulty/api/ \{(.*?)\n  \}', template, re.S).group(1)
        self.assertIn('proxy_set_header X-Account-Admin $account_admin;', api)

    def test_ranks_are_for_shared_readers_with_a_capped_body(self):
        import re
        path = os.path.join(os.path.dirname(__file__), '..', 'nginx-ebook-reader.conf.template')
        with open(path, encoding='utf-8') as f:
            template = f.read()
        block = re.search(r'location = /calibre/difficulty/api/ranks \{(.*?)\n  \}', template, re.S).group(1)
        self.assertIn('auth_request /_account_shared;', block)
        self.assertIn('client_max_body_size 1m;', block)
        self.assertIn('limit_req zone=', block)


class SaveWordsTest(unittest.TestCase):
    def test_most_frequent_words_with_ranks_names_left_out(self):
        import gzip
        import importlib.util
        from features import Analysis, Word
        spec = importlib.util.spec_from_file_location(
            'jiten_service', os.path.join(os.path.dirname(__file__), '..', 'jiten', 'service.py'))
        service = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(service)
        service.WORDS_DIR = tempfile.mkdtemp()
        service.WORDS_PER_BOOK = 2

        def word(key, form, pos, reading=None):
            return Word(key=f'{key}\t{pos}', form=form, pos=pos, origin='wago', conjugations=(), surface=form,
                        reading=reading)
        analysis = Analysis(text='')
        for w, count in ((word('猫', '猫', 'noun', 'ねこ'), 3), (word('太郎', '太郎', 'name'), 9),
                         (word('走る', '走る', 'verb'), 5), (word('稀', '稀', 'noun'), 1), (word('今', '今', 'fix', 'こん'), 7)):
            analysis.words[w.key, w.form] = [w, count]
        # The totals count the rows past the cap (稀) too.
        self.assertEqual(service.save_words(7, analysis, FrequencyTable({'猫': 1200})), (3, 9))
        with gzip.open(service.words_path(7), 'rt', encoding='utf-8') as f:
            self.assertEqual(json.load(f), {'words': [['走る', None, 5, None, '走る'], ['猫', 'ねこ', 3, 1200, '猫']],
                                            'uniqueWords': 3, 'tokens': 9})

    def test_totals_leave_noise_out(self):
        import importlib.util
        from features import Analysis, Word
        spec = importlib.util.spec_from_file_location(
            'jiten_service', os.path.join(os.path.dirname(__file__), '..', 'jiten', 'service.py'))
        service = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(service)
        service.WORDS_DIR = tempfile.mkdtemp()
        analysis = Analysis(text='')
        # Particles, numbers, lone kana and unranked kana-only words aren't vocabulary.
        for form, count in (('猫', 3), ('から', 9), ('三', 4), ('ッ', 5), ('ふむ', 2), ('すごい', 6)):
            w = Word(f'{form}\tnoun', form, 'noun', 'wago', (), form)
            analysis.words[w.key, form] = [w, count]
        self.assertEqual(service.save_words(9, analysis, FrequencyTable({'から': 30, 'すごい': 900})), (2, 9))

    def test_one_row_per_reading(self):
        import gzip
        import importlib.util
        from collections import Counter
        from features import Analysis, Word
        spec = importlib.util.spec_from_file_location(
            'jiten_service', os.path.join(os.path.dirname(__file__), '..', 'jiten', 'service.py'))
        service = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(service)
        service.WORDS_DIR = tempfile.mkdtemp()
        other = Word('他\tnoun', '他', 'noun', 'kango', (), '他', 'ほか')
        run = Word('走る\tverb', '走る', 'verb', 'wago', (), '走る', 'はしる')
        box = Word('箱\tnoun', '箱', 'noun', 'wago', (), '箱', 'はこ')
        face = Word('顔\tnoun', '顔', 'noun', 'wago', (), '顔', 'かお')
        analysis = Analysis(text='', words={(other.key, '他'): [other, 7], (run.key, '走る'): [run, 4],
                                            (box.key, '箱'): [box, 3], (face.key, '顔'): [face, 1]})
        # 走った has no reading: it counts for the word's most common one.
        analysis.readings = {(other.key, '他'): Counter({'ほか': 5, 'た': 2}),
                             (run.key, '走る'): Counter({None: 3, 'はしる': 1}),
                             (box.key, '箱'): Counter({'ばこ': 2, 'はこ': 1}),  # この箱 ばこ: the list has only はこ
                             (face.key, '顔'): Counter({'がお': 1})}  # a split tail: がお ranks, かお better
        service.save_words(8, analysis, FrequencyTable({'他': 145038, '箱': 2000, '顔': 113},
                                                       {('他', 'ほか'): 382, ('他', 'た'): 145038, ('箱', 'はこ'): 2000,
                                                        ('顔', 'かお'): 113, ('顔', 'がお'): 75124}))
        with gzip.open(service.words_path(8), 'rt', encoding='utf-8') as f:
            self.assertEqual(json.load(f)['words'], [['他', 'ほか', 5, 382, '他'], ['走る', 'はしる', 4, None, '走る'],
                                            ['箱', 'はこ', 3, 2000, '箱'], ['他', 'た', 2, 145038, '他'],
                                            ['顔', 'がお', 1, 113, '顔']])

    def test_merges_fills_and_drops(self):
        import gzip
        import importlib.util
        from collections import Counter
        from features import Analysis, Word
        spec = importlib.util.spec_from_file_location(
            'jiten_service', os.path.join(os.path.dirname(__file__), '..', 'jiten', 'service.py'))
        service = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(service)
        service.WORDS_DIR = tempfile.mkdtemp()
        have = Word('有る\tverb', 'ある', 'verb', 'wago', (), 'ある', 'ある')
        some = Word('或る\tadj', 'ある', 'adj', 'wago', (), 'ある', 'ある')
        mutter = Word('呟く\tverb', '呟く', 'verb', 'wago', (), '呟いた')
        know = Word('分かる\tverb', 'わかる', 'verb', 'wago', (), 'わかっ')
        know2 = Word('分かる\tadj', 'わかる', 'adj', 'wago', (), 'わかる', 'わかる')
        desu = Word('です\taux', 'です', 'aux', 'wago', (), 'です', 'です')
        nante = Word('なんて\tparticle', 'なんて', 'particle', 'wago', (), 'なんて', 'なんて')
        words = (have, 6), (some, 2), (mutter, 3), (know, 4), (know2, 1), (desu, 9), (nante, 5)
        analysis = Analysis(text='', words={(w.key, w.form): [w, n] for w, n in words})
        analysis.readings = {(have.key, 'ある'): Counter({'ある': 6}), (some.key, 'ある'): Counter({'ある': 2}),
                             (mutter.key, '呟く'): Counter({None: 3}), (know.key, 'わかる'): Counter({None: 4}),
                             (know2.key, 'わかる'): Counter({'わかる': 1})}
        # Sudachi's reading of the form, for words met only conjugated.
        analysis.form_readings = {(mutter.key, '呟く'): 'つぶやく', (know.key, 'わかる'): 'わからない'}
        service.save_words(5, analysis, FrequencyTable({'有る': 900, '或る': 300}))
        with gzip.open(service.words_path(5), 'rt', encoding='utf-8') as f:
            # わかる takes the form's reading in the book, not Sudachi's.
            self.assertEqual(json.load(f)['words'], [['ある', 'ある', 8, 300, '有る'], ['わかる', 'わかる', 5, None, '分かる'],
                                            ['呟く', 'つぶやく', 3, None, '呟く']])
