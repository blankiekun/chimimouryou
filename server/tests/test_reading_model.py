"""Tests for the difficulty service's reading-model tables (the model itself is yurigana's)."""
import gzip
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'engine'))


class ServiceTest(unittest.TestCase):
    def test_the_servers_table_wins_and_the_committed_one_fills_in(self):
        import importlib.util
        from yurigana import Reader
        spec = importlib.util.spec_from_file_location(
            'jiten_service', os.path.join(os.path.dirname(__file__), '..', 'jiten', 'service.py'))
        service = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(service)
        self.assertEqual(service.READING_MODEL_TABLES, [os.path.join(service.STATE_DIR, 'reading-model.json.gz')])
        with tempfile.TemporaryDirectory() as tmp:
            # Forms without context rules: tables' entries for those are dropped unless listed in ruleForms.
            paths = [os.path.join(tmp, name) for name in ('server.json.gz', 'aozora.json.gz', 'broken.json.gz', 'missing')]
            for path, forms in zip(paths, ({'日向': 'server'}, {'日向': 'aozora', '大事': 'aozora'})):
                with gzip.open(path, 'wt', encoding='utf-8') as f:
                    json.dump({'version': 1, 'forms': forms}, f)
            with open(paths[2], 'w') as f:
                f.write('not gzip')
            # The service's Readers get the server's table; yurigana's public one comes after it.
            forms = Reader(known=set(), tables=paths, tokenizer=object()).model.forms
            self.assertEqual((forms['日向'], forms['大事']), ('server', 'aozora'))
        self.assertGreater(len(Reader(known=set(), tokenizer=object()).model.forms), 30)  # yurigana's public table


if __name__ == '__main__':
    unittest.main()
