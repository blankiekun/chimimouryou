"""Tests for the API service (server/api/service.py) over real HTTP. Run from the repo root:
python3 -m unittest discover -s server/tests
"""

import importlib.util
import json
import os
import sys
import tempfile
import threading
import unittest
import unittest.mock
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'api'))
import apidb  # noqa: E402

# A plain `import service` would collide with the account service's tests.
spec = importlib.util.spec_from_file_location(
    'api_service', os.path.join(os.path.dirname(__file__), '..', 'api', 'service.py'))
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

TOKEN = 'internal-test-token'
ACCOUNT_A = 'a' * 32
ACCOUNT_B = 'b' * 32


def catalog_book(book_id, title, authors='', series='', added=0):
    return {'id': book_id, 'key': f'uuid-{book_id}', 'title': title, 'authors': authors, 'series': series,
            'seriesIndex': None, 'seriesInferred': False, 'tags': ['t'], 'rating': None, 'publisher': '',
            'published': None, 'added': added, 'format': 'EPUB', 'vn': False, 'size': 1,
            'file': f'{book_id}/b.epub', 'cover': ''}


class ServiceTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = self.tmp.name
        token_file = os.path.join(root, 'internal-token')
        with open(token_file, 'w') as f:
            f.write(TOKEN)
        values = {
            'API_STATE_DIR': os.path.join(root, 'state', 'api'),
            'ACCOUNT_DATA_DIR': os.path.join(root, 'accounts'),
            'INTERNAL_TOKEN_FILE': token_file,
            'VERSION': 'test',
            'MIN_FREE_BYTES': 0,
        }
        for name, value in values.items():
            old = getattr(service, name)
            setattr(service, name, value)
            self.addCleanup(setattr, service, name, old)
        quiet = unittest.mock.patch.object(service.Handler, 'log_message', lambda *args: None)
        quiet.start()
        self.addCleanup(quiet.stop)
        service.db = apidb.Database(os.path.join(values['API_STATE_DIR'], 'library.db'))
        self.addCleanup(service.db.connection.close)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def books(self, books):
        return service.db.transaction(lambda c: apidb.upsert_books(c, books, None, 1))

    def book_id(self, key):
        return service.db.query('SELECT id FROM books WHERE key = ?', (key,))[0]['id']

    def request(self, method, path, body=None, account='', headers=None):
        """(status, response headers, body bytes)."""
        all_headers = {'X-Internal-Token': TOKEN}
        if account:
            all_headers['X-Account-Id'] = account
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode()
            all_headers['Content-Type'] = 'application/json'
        all_headers.update(headers or {})
        request = urllib.request.Request(f'http://127.0.0.1:{self.server.server_port}{path}', data=body,
                                         method=method, headers={k: v for k, v in all_headers.items() if v is not None})
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.headers, error.read()

    def call(self, method, path, body=None, account='', headers=None):
        status, _, data = self.request(method, path, body, account, headers)
        return status, json.loads(data) if data else None


class ReadTest(ServiceTestCase):
    def test_needs_internal_token(self):
        self.assertEqual(self.call('GET', '/api/v1/version', headers={'X-Internal-Token': None})[0], 403)
        self.assertEqual(self.call('GET', '/api/v1/version', headers={'X-Internal-Token': 'wrong'})[0], 403)

    def test_bad_account_header(self):
        self.assertEqual(self.call('GET', '/api/v1/version', account='../x')[0], 400)

    def test_version(self):
        self.assertEqual(self.call('GET', '/api/v1/version'), (200, {'api': 1, 'server': 'test'}))

    def test_catalog_delta(self):
        books = [catalog_book(1, '猫', added=1), catalog_book(2, '犬', added=2)]
        self.books(books)
        status, body = self.call('GET', '/api/v1/catalog?since=0')
        self.assertEqual(status, 200)
        self.assertEqual([b['title'] for b in body['books']], ['犬', '猫'])
        self.assertEqual(body['books'][0]['tags'], ['t'])
        rev = body['rev']
        self.books(books[1:])
        status, body = self.call('GET', f'/api/v1/catalog?since={rev}')
        self.assertEqual([(b['title'], b['deleted']) for b in body['books']], [('猫', True)])
        self.assertGreater(body['rev'], rev)
        self.assertEqual(len(self.call('GET', '/api/v1/catalog?since=0')[1]['books']), 1)
        self.assertEqual(self.call('GET', '/api/v1/catalog?since=-1')[0], 400)
        self.assertEqual(self.call('GET', '/api/v1/catalog?since=x')[0], 400)

    def test_books_search_and_paging(self):
        self.books([catalog_book(1, '吾輩は猫である', series='S', added=1), catalog_book(2, '猫町', added=2),
                    catalog_book(3, '坊っちゃん', series='S', added=3), catalog_book(4, 'こころ', added=4),
                    catalog_book(5, '三四郎', added=5)])

        def titles(query):
            status, body = self.call('GET', '/api/v1/books?' + query)
            self.assertEqual(status, 200)
            return [b['title'] for b in body['books']], body['next']

        self.assertEqual(titles('q=' + urllib.request.quote('猫であ')), (['吾輩は猫である'], None))
        self.assertEqual(titles('q=' + urllib.request.quote('猫')), (['猫町', '吾輩は猫である'], None))
        self.assertEqual(titles('series=S'), (['坊っちゃん', '吾輩は猫である'], None))
        seen, cursor = [], ''
        for _ in range(3):
            page, cursor = titles(f'limit=2&cursor={cursor}' if cursor else 'limit=2')
            seen += page
        self.assertEqual(len(seen), 5)
        self.assertIsNone(cursor)
        self.assertEqual(self.call('GET', '/api/v1/books?limit=0')[0], 400)
        self.assertEqual(self.call('GET', '/api/v1/books?limit=201')[0], 400)
        self.assertEqual(self.call('GET', '/api/v1/books?cursor=x')[0], 400)

    def test_unknown_route(self):
        self.assertEqual(self.call('GET', '/api/v1/nothing')[0], 404)
        self.assertEqual(self.call('DELETE', '/api/v1/catalog')[0], 405)


if __name__ == '__main__':
    unittest.main()
