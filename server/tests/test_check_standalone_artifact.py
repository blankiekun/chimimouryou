"""Tests for scripts/check-standalone-artifact.py: a standalone build holds no file from server/.
python3 -m unittest discover -s server/tests
"""
import importlib.util
import os
import tempfile
import unittest
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
spec = importlib.util.spec_from_file_location('check_standalone_artifact',
                                              os.path.join(ROOT, 'scripts', 'check-standalone-artifact.py'))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

SERVICE = b'# a service\n' + b'x' * 88


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)


class FindServerFilesTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.server = os.path.join(tmp.name, 'server')
        self.artifact = os.path.join(tmp.name, 'build')
        write(os.path.join(self.server, 'x', 'service.py'), SERVICE)
        write(os.path.join(self.server, 'x', '__pycache__', 'service.pyc'), b'p' * 200)
        write(os.path.join(self.artifact, 'index.html'), b'<!doctype html>' + b'h' * 100)

    def find(self):
        return check.find_server_files(self.artifact, self.server)

    def test_clean_artifact(self):
        with open(os.path.join(ROOT, 'engine', 'features.py'), 'rb') as f:
            features = f.read()
        with zipfile.ZipFile(os.path.join(self.artifact, 'analysis.zip'), 'w') as z:
            z.writestr('py/features.py', features)
        # Tiny files (an empty __init__.py) and __pycache__ bytes match by chance, not by copying.
        write(os.path.join(self.server, 'x', '__init__.py'), b'# package\n')
        write(os.path.join(self.artifact, '__init__.py'), b'# package\n')
        write(os.path.join(self.artifact, 'service.pyc'), b'p' * 200)
        self.assertEqual(self.find(), [])

    def test_copied_server_file(self):
        write(os.path.join(self.artifact, 'app', 'service.py'), SERVICE)
        self.assertEqual(self.find(), [('app/service.py', 'x/service.py')])

    def test_file_inside_zip(self):
        with zipfile.ZipFile(os.path.join(self.artifact, 'analysis.zip'), 'w') as z:
            z.writestr('py/service.py', SERVICE)
        self.assertEqual(self.find(), [('analysis.zip!py/service.py', 'x/service.py')])


if __name__ == '__main__':
    unittest.main()
