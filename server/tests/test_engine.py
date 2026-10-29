"""Tests for the difficulty engine's fingerprint (engine/engine.py)."""
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, '..', '..', 'engine'))
import engine  # noqa: E402
from test_readings_file import load_service  # noqa: E402

COMMITTED = os.path.join(HERE, '..', '..', 'apps', 'web', 'src', 'lib', 'data', 'difficulty-engine.json')


class EngineFingerprintTest(unittest.TestCase):
    def test_committed_fingerprint_is_current(self):
        with open(COMMITTED, encoding='utf-8') as f:
            committed = json.load(f)['engine']
        self.assertEqual(committed, engine.canonical_fingerprint(),
                         'The engine changed: python3 engine/engine.py > '
                         'apps/web/src/lib/data/difficulty-engine.json')

    def test_code_record_is_current(self):
        with open(engine.CODE_RECORD, encoding='utf-8') as f:
            record = json.load(f)
        self.assertEqual((record['version'], record['code']), (engine.ENGINE_VERSION, engine.code_hash()),
                         'The scoring Python changed. If any estimate, word list or readings file changes, '
                         'bump ENGINE_VERSION in engine/engine.py; if every output stays the same, '
                         'only re-record the hash. Either way: python3 engine/engine.py --record '
                         '&& python3 engine/engine.py > apps/web/src/lib/data/difficulty-engine.json')

    def test_inputs_change_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            own = os.path.join(tmp, 'list.zip')
            shutil.copy(engine.BUNDLED_FREQUENCY_LIST, own)
            canonical = engine.canonical_fingerprint()
            self.assertEqual(engine.engine_fingerprint(own, *engine.pinned_versions()), canonical)
            with open(own, 'ab') as f:
                f.write(b'x')
            self.assertNotEqual(engine.engine_fingerprint(own, *engine.pinned_versions()), canonical)
            self.assertNotEqual(engine.engine_fingerprint(engine.BUNDLED_FREQUENCY_LIST, '0.0.0', 'core-1'), canonical)
            terms = os.path.join(tmp, 'terms.zip')
            open(terms, 'wb').close()
            self.assertNotEqual(engine.engine_fingerprint(engine.BUNDLED_FREQUENCY_LIST, *engine.pinned_versions(),
                                                          [terms]), canonical)

    def test_service_with_the_bundled_list_is_canonical(self):
        service = load_service()
        with tempfile.TemporaryDirectory() as tmp:
            service.FREQUENCY_DICTIONARY = os.path.join(tmp, 'frequency-dictionary.zip')
            service.TERM_DICTIONARY_DIR = os.path.join(tmp, 'terms')
            service.READING_MODEL_TABLES = [os.path.join(tmp, 'reading-model.json.gz')]
            shutil.copy(engine.BUNDLED_FREQUENCY_LIST, service.FREQUENCY_DICTIONARY)
            if (service.YURIGANA_VERSION, 'core-' + _installed('SudachiDict-core')) != engine.pinned_versions():
                self.skipTest('installed yurigana or SudachiDict-core differ from requirements.txt')
            self.assertEqual(service.current_engine(), engine.canonical_fingerprint())
            # Term dictionaries change readings only: still canonical
            os.makedirs(service.TERM_DICTIONARY_DIR)
            open(os.path.join(service.TERM_DICTIONARY_DIR, 'terms.zip'), 'wb').close()
            self.assertEqual(service.current_engine(), engine.canonical_fingerprint())
            # An admin's own list
            with open(service.FREQUENCY_DICTIONARY, 'ab') as f:
                f.write(b'x')
            self.assertNotEqual(service.current_engine(), engine.canonical_fingerprint())


def _installed(name):
    from importlib.metadata import PackageNotFoundError, version
    try:
        return version(name)
    except PackageNotFoundError:
        return 'missing'


if __name__ == '__main__':
    unittest.main()
