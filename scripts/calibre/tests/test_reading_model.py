"""Tests for the difficulty service's reading-model tables (the model itself is yurigana's)."""
import gzip
import json
import os
import tempfile
import unittest


class ServiceTest(unittest.TestCase):
    def test_the_servers_table_wins_and_the_committed_one_fills_in(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            'jiten_service', os.path.join(os.path.dirname(__file__), '..', 'jiten', 'service.py'))
        service = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(service)
        with tempfile.TemporaryDirectory() as tmp:
            paths = [os.path.join(tmp, name) for name in ('server.json.gz', 'aozora.json.gz', 'broken.json.gz')]
            for path, forms in zip(paths, ({'人気': 'server'}, {'人気': 'aozora', '床': 'aozora'})):
                with gzip.open(path, 'wt', encoding='utf-8') as f:
                    json.dump({'version': 1, 'forms': forms}, f)
            with open(paths[2], 'w') as f:
                f.write('not gzip')
            self.assertEqual(service.load_reading_model(paths).forms, {'人気': 'server', '床': 'aozora'})
            self.assertIsNone(service.load_reading_model([os.path.join(tmp, 'missing')]))
        self.assertGreater(len(service.load_reading_model().forms), 30)  # yurigana's public table


if __name__ == '__main__':
    unittest.main()
