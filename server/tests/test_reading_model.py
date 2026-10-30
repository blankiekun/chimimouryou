"""Tests for the difficulty service's reading-model tables (the model itself is yurigana's)."""
import gzip
import json
import os
import tempfile
import unittest

from test_readings_file import load_service


class ServiceTest(unittest.TestCase):
    # Catches the service passing its tables after yurigana's public one (the server's own table, learned
    # from this library's ruby, would never win) or failing to start on a broken table file.
    def test_the_servers_table_wins_and_a_broken_one_is_ignored(self):
        service = load_service()
        with tempfile.TemporaryDirectory() as tmp:
            server, broken = os.path.join(tmp, 'reading-model.json.gz'), os.path.join(tmp, 'broken.json.gz')
            with gzip.open(server, 'wt', encoding='utf-8') as f:
                json.dump({'version': 1, 'forms': {'一目': 'server'}}, f)
            with open(broken, 'w') as f:
                f.write('not gzip')
            service.READING_MODEL_TABLES = [server, broken, os.path.join(tmp, 'missing')]
            service.READER_PACK = os.path.join(tmp, 'reader.ygp')
            service.TERM_DICTIONARY_DIR = os.path.join(tmp, 'term-dictionaries')
            forms = service._load_reader(object(), known=set).model.forms
            self.assertEqual(forms['一目'], 'server')  # also in yurigana's public table
            self.assertIsInstance(forms['件'], list)  # the public table still fills in the rest


if __name__ == '__main__':
    unittest.main()
