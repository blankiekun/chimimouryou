"""Tests for mokuro/service.py with a fake mokuro. Run from the repo root:
python3 -m unittest discover -s server/tests
"""
import importlib.util
import json
import os
import sys
import tempfile
import unittest
import zipfile

STATE = tempfile.mkdtemp()
LIBRARY = os.path.join(STATE, 'library')
FAKE_MOKURO = os.path.join(STATE, 'mokuro')
os.makedirs(os.path.join(LIBRARY, 'a'))

# Writes what mokuro 0.2 writes next to the volume: <volume>.mokuro.
with open(FAKE_MOKURO, 'w') as f:
    f.write(f"""#!{sys.executable}
import json, sys, zipfile
volume = sys.argv[-1]
names = sorted(n for n in zipfile.ZipFile(volume).namelist() if n.endswith('.jpg') and 'MACOSX' not in n)
if 'fail' in open(volume, 'rb').read().decode('latin-1'):
    sys.exit('RuntimeError: broken page')
page = lambda n: {{'img_width': 800, 'img_height': 1200, 'img_path': n, 'blocks': [
    {{'box': [1, 2, 30, 40], 'vertical': True, 'font_size': 16, 'lines_coords': [], 'lines': ['もう', 'いい']}}]}}
json.dump({{'version': '0.2.5', 'pages': [page(n) for n in names]}}, open(volume[:-4] + '.mokuro', 'w'))
""")
os.chmod(FAKE_MOKURO, 0o755)

with zipfile.ZipFile(os.path.join(LIBRARY, 'a', 'manga.cbz'), 'w') as z:
    for name in ('Images/002.jpg', 'Images/001.jpg', '__MACOSX/Images/._001.jpg', 'info.txt'):
        z.writestr(name, b'x')
with zipfile.ZipFile(os.path.join(LIBRARY, 'a', 'broken.cbz'), 'w') as z:
    z.writestr('001.jpg', b'fail')

CATALOG = os.path.join(STATE, 'catalog.json')
with open(CATALOG, 'w') as f:
    json.dump({'books': [
        {'id': 1, 'title': '漫画1', 'format': 'CBZ', 'file': 'a/manga.cbz'},
        {'id': 2, 'title': '漫画2', 'format': 'CBZ', 'file': 'a/broken.cbz'},
        {'id': 3, 'title': '本', 'format': 'EPUB', 'file': 'a/book.epub'},
    ]}, f)

os.environ.update(CALIBRE_LIBRARY=LIBRARY, CALIBRE_CATALOG=CATALOG, MOKURO_BIN=FAKE_MOKURO,
                  MOKURO_STATE_DIR=os.path.join(STATE, 'mokuro-state'))
spec = importlib.util.spec_from_file_location(
    'mokuro_service', os.path.join(os.path.dirname(__file__), '..', 'mokuro', 'service.py'))
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


class ConvertTest(unittest.TestCase):
    def test_keeps_page_names_sizes_and_text(self):
        data = service.convert({'version': '0.2.5', 'pages': [{
            'img_width': 846, 'img_height': 1200, 'img_path': './Images/a.jpg',
            'blocks': [{'box': [698, 77, 756, 194], 'vertical': True, 'font_size': 16,
                        'lines_coords': [[[0, 0]]], 'lines': ['もうこんなに', '日が高く']}]}]}, 'upload')
        self.assertEqual(data['source'], 'upload')
        self.assertEqual(data['mokuro'], '0.2.5')
        self.assertEqual(data['pages'], [{
            'name': 'Images/a.jpg', 'width': 846.0, 'height': 1200.0,
            'blocks': [{'box': [698.0, 77.0, 756.0, 194.0], 'vertical': True, 'fontSize': 16.0,
                        'lines': ['もうこんなに', '日が高く']}]}])

    def test_rejects_other_json(self):
        for bad in ({}, {'pages': []}, {'pages': [{'img_path': 'a.jpg'}]}, [1],
                    {'pages': [{'img_width': 1, 'img_height': 1, 'img_path': 'a',
                                'blocks': [{'box': [1, 2, 3], 'lines': []}]}]},
                    {'pages': [{'img_width': 1, 'img_height': 1, 'img_path': 'a',
                                'blocks': [{'box': [1, 2, 3, 4], 'lines': [{'x': 1}]}]}]}):
            with self.assertRaises(ValueError, msg=bad):
                service.convert(bad, 'upload')


class GenerateTest(unittest.TestCase):
    def test_runs_mokuro_and_stores_its_text(self):
        service.runner._run_one(1)
        self.assertIsNone(service.runner.last['error'])
        with open(service.ocr_path(1), encoding='utf-8') as f:
            data = json.load(f)
        self.assertEqual(data['source'], 'server')
        self.assertEqual([p['name'] for p in data['pages']], ['Images/001.jpg', 'Images/002.jpg'])
        self.assertEqual(data['pages'][0]['blocks'][0]['lines'], ['もう', 'いい'])
        self.assertFalse(os.path.exists(os.path.join(service.WORK_DIR, '1')))

    def test_reports_mokuro_errors(self):
        service.runner._run_one(2)
        self.assertIn('broken page', service.runner.last['error'])
        self.assertFalse(os.path.exists(service.ocr_path(2)))

    def test_counts_only_pages(self):
        self.assertEqual(service.page_count(os.path.join(LIBRARY, 'a', 'manga.cbz')), 2)

    def test_queues_only_manga(self):
        with self.assertRaises(ValueError):
            service.runner.generate([3])


if __name__ == '__main__':
    unittest.main()
