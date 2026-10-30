"""The difficulty image copies engine/ and then server/jiten/ into one folder, /app/jiten
(docker/services.Dockerfile)."""
import os
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')


def files(folder: str) -> set:
    top = os.path.join(ROOT, folder)
    return {os.path.relpath(os.path.join(path, name), top)
            for path, dirs, names in os.walk(top) if '__pycache__' not in path for name in names}


class ImageOverlayTest(unittest.TestCase):
    # Catches a server/jiten file named like an engine file (a new service module called core.py or
    # frequency.py): in the image it silently replaces the engine's, and service.py's own sys.path entry
    # makes it win in the tests too, so nothing else notices.
    def test_no_server_file_replaces_an_engine_file(self):
        self.assertEqual(files('server/jiten') & files('engine'), set())


if __name__ == '__main__':
    unittest.main()
