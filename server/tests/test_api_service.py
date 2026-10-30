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
        catalog_file = os.path.join(root, 'catalog.json')
        with open(catalog_file, 'w') as f:
            f.write('{"books": []}')
        values = {
            'API_STATE_DIR': os.path.join(root, 'state', 'api'),
            'ACCOUNT_DATA_DIR': os.path.join(root, 'accounts'),
            'INTERNAL_TOKEN_FILE': token_file,
            'CALIBRE_CATALOG': catalog_file,
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
        threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()
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
        self.assertEqual(self.call('GET', '/api/v1/version'), (200, {'api': 1, 'server': 'test'}))

    def test_bad_account_header(self):
        self.assertEqual(self.call('GET', '/api/v1/version', account='../x')[0], 400)

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

    # Bug caught: before the first build the client must see 'being built' (404), not an empty library;
    # an empty library after it must not stay 'being built'.
    def test_catalog_before_first_build(self):
        os.unlink(service.CALIBRE_CATALOG)
        self.assertEqual(self.call('GET', '/api/v1/catalog?since=0'), (404, {'error': 'The library is being built'}))
        with open(service.CALIBRE_CATALOG, 'w') as f:
            f.write('{"books": []}')
        self.assertEqual(self.call('GET', '/api/v1/catalog?since=0'), (200, {'rev': 0, 'books': []}))

    # Bug caught: no report yet (a fresh install) would be a 500 on the admin page.
    def test_migration_report(self):
        self.assertEqual(self.call('GET', '/api/v1/migration'), (200, {}))
        report = {'applied': True, 'sources': [{'account': '', 'orphans': ['猫']}]}
        apidb.write_atomic(os.path.join(service.API_STATE_DIR, 'migrate-report.json'), json.dumps(report).encode())
        self.assertEqual(self.call('GET', '/api/v1/migration'), (200, report))

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


class WriteTest(ServiceTestCase):
    def setUp(self):
        super().setUp()
        self.books([catalog_book(1, '猫', added=1)])
        self.book = self.book_id('uuid-1')

    def sync(self, account=''):
        status, body = self.call('GET', '/api/v1/sync?since=0', account=account)
        self.assertEqual(status, 200)
        return body

    def test_progress_round_trip(self):
        status, body = self.call('PUT', f'/api/v1/books/{self.book}/progress',
                                 {'modified': 10, 'progress': 0.5, 'data': {'chapter': 2}}, account=ACCOUNT_A)
        self.assertEqual(status, 200)
        [row] = self.sync(ACCOUNT_A)['progress']
        self.assertEqual(row, {'book': self.book, 'progress': 0.5, 'data': {'chapter': 2}, 'modified': 10,
                               'rev': body['rev']})

    def test_conflict_returns_stored_row(self):
        path = f'/api/v1/books/{self.book}/progress'
        status, body = self.call('PUT', path, {'modified': 20, 'progress': 0.2, 'data': {}})
        self.assertEqual(status, 200)
        rev = body['rev']
        status, body = self.call('PUT', path, {'modified': 10, 'progress': 0.1, 'data': {}})
        self.assertEqual(status, 409)
        self.assertEqual((body['error'], body['row']['modified'], body['row']['progress']),
                         ('Newer on the server', 20, 0.2))
        self.assertEqual(self.call('PUT', path, {'modified': 20, 'progress': 0.3, 'data': {}}), (200, {'rev': rev}))
        self.assertEqual(self.sync()['rev'], rev)

    # Catches the newer-wins check and the write not being one transaction: with devices writing the same
    # row at once, an older position could overwrite a newer one, or two writes could share a rev.
    def test_racing_writes_to_one_row_keep_the_newest(self):
        path = f'/api/v1/books/{self.book}/progress'
        writers = 12
        barrier = threading.Barrier(writers)
        results = {}

        def put(modified):
            barrier.wait()
            results[modified] = self.call('PUT', path, {'modified': modified, 'progress': modified / 100, 'data': {}},
                                          account=ACCOUNT_A)

        threads = [threading.Thread(target=put, args=(modified,)) for modified in range(1, writers + 1)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(results[writers][0], 200)  # the newest always wins
        won = sorted((modified, body['rev']) for modified, (status, body) in results.items() if status == 200)
        revs = [rev for _, rev in won]
        self.assertEqual(revs, sorted(set(revs)))  # unique, and increasing with modified
        for modified, (status, body) in results.items():
            if status != 200:
                self.assertEqual(status, 409)
                self.assertGreater(body['row']['modified'], modified)
        [row] = self.sync(ACCOUNT_A)['progress']
        self.assertEqual((row['modified'], row['progress'], row['rev']), (writers, writers / 100, revs[-1]))

    def test_highlight_tombstone(self):
        path = f'/api/v1/books/{self.book}/highlights/h-1'
        self.assertEqual(self.call('PUT', path, {'modified': 1, 'data': {'text': '猫'}})[0], 200)
        self.assertEqual(self.call('DELETE', path, {'modified': 2})[0], 200)
        [row] = self.sync()['highlights']
        self.assertEqual((row['hid'], row['deleted'], row['data']), ('h-1', True, {}))
        self.assertEqual(self.call('DELETE', path, {'modified': 1})[0], 409)
        self.assertEqual(self.call('PUT', f'/api/v1/books/{self.book}/highlights/a%20b', {'modified': 1, 'data': {}})[0],
                         400)

    # Bug caught: a tombstone PUT whole would be stored live, so a deleted highlight comes back elsewhere.
    def test_highlight_put_tombstone(self):
        path = f'/api/v1/books/{self.book}/highlights/h-2'
        tombstone = {'id': 'h-2', 'deleted': True, 'start': 5, 'created': 1}
        self.assertEqual(self.call('PUT', path, {'modified': 3, 'data': tombstone})[0], 200)
        [row] = self.sync()['highlights']
        self.assertEqual((row['deleted'], row['data']), (True, tombstone))
        self.assertEqual(self.call('PUT', path, {'modified': 4, 'data': {'id': 'h-2', 'deleted': False}})[0], 200)
        self.assertFalse(self.sync()['highlights'][0]['deleted'])

    # Bug caught: an older delete overwriting a newer day/goal, or a delete the /sync feed doesn't report.
    def test_statistics_and_goal_tombstones(self):
        for path in (f'/api/v1/books/{self.book}/statistics/2026-10-01', '/api/v1/goals/2026-10-01'):
            self.assertEqual(self.call('PUT', path, {'modified': 10, 'data': {'a': 1}}, account=ACCOUNT_A)[0], 200)
            self.assertEqual(self.call('DELETE', path, {'modified': 20}, account=ACCOUNT_A)[0], 200)
            self.assertEqual(self.call('DELETE', path, {'modified': 5}, account=ACCOUNT_A)[0], 409)
        body = self.sync(ACCOUNT_A)
        for table in ('statistics', 'goals'):
            [row] = body[table]
            self.assertEqual((row['deleted'], row['data'], row['modified']), (True, {}, 20))
        path = '/api/v1/goals/2026-10-01'
        self.assertEqual(self.call('PUT', path, {'modified': 30, 'data': {'b': 2}}, account=ACCOUNT_A)[0], 200)
        self.assertFalse(self.sync(ACCOUNT_A)['goals'][0]['deleted'])

    def test_accounts_are_isolated(self):
        self.call('PUT', f'/api/v1/books/{self.book}/progress', {'modified': 1, 'progress': 0, 'data': {}},
                  account=ACCOUNT_A)
        self.call('PUT', f'/api/v1/books/{self.book}/statistics/2026-10-01', {'modified': 1, 'data': {}})
        self.assertEqual(len(self.sync(ACCOUNT_A)['progress']), 1)
        self.assertEqual(self.sync(ACCOUNT_A)['statistics'], [])
        self.assertEqual(self.sync()['progress'], [])
        self.assertEqual(len(self.sync()['statistics']), 1)
        self.assertEqual(self.sync(ACCOUNT_B)['progress'], [])

    def test_account_docs_need_account(self):
        self.assertEqual(self.call('PUT', '/api/v1/docs/settings', {'modified': 1, 'data': {}}),
                         (403, {'error': 'Needs an account'}))
        self.assertEqual(self.call('PUT', '/api/v1/docs/settings', {'modified': 1, 'data': {'a': 1}},
                                   account=ACCOUNT_A)[0], 200)
        self.assertEqual(self.sync(ACCOUNT_A)['accountDocs'][0]['kind'], 'settings')
        self.assertEqual(self.call('PUT', '/api/v1/goals/2026-10-01', {'modified': 1, 'data': []},
                                   account=ACCOUNT_A)[0], 200)
        self.assertEqual(self.sync(ACCOUNT_A)['goals'][0]['goalStart'], '2026-10-01')
        self.assertEqual(self.call('PUT', f'/api/v1/books/{self.book}/docs/recaps', {'modified': 1, 'data': {}})[0],
                         200)

    # Bug: a kind in sync-kinds.json (the client's list, sync-kinds.test.ts) that a route or the table refuses
    # (404/500): that file never syncs to the server while Drive and folders sync it.
    def test_every_sync_kind_is_written(self):
        with open(os.path.join(os.path.dirname(__file__), '..', 'api', 'sync-kinds.json'), encoding='utf-8') as f:
            kinds = json.load(f)
        book_kinds = [*kinds['bookDocs'].values(), *kinds['mediaDocs'].values()]
        paths = [*(f'books/{self.book}/docs/{kind}' for kind in book_kinds),
                 *(f'docs/{kind}' for kind in kinds['accountDocs'].values()),
                 *(f'games/g/docs/{kind}' for kind in kinds['gameDocs'])]
        for path in paths:
            with self.subTest(path=path):
                self.assertEqual(self.call('PUT', f'/api/v1/{path}', {'modified': 1, 'data': {'p': path}},
                                           account=ACCOUNT_A)[0], 200)
        sync = self.sync(ACCOUNT_A)
        self.assertEqual(sorted(row['kind'] for row in sync['bookDocs']), sorted(book_kinds))
        self.assertEqual(sorted(row['kind'] for row in sync['accountDocs']), sorted(kinds['accountDocs'].values()))
        self.assertEqual(sorted(row['kind'] for row in sync['gameDocs']), sorted(kinds['gameDocs']))

    def test_validation(self):
        body = {'modified': 1, 'data': {}}
        self.assertEqual(self.call('PUT', f'/api/v1/books/{self.book}/statistics/2026-1-1', body)[0], 400)
        self.assertEqual(self.call('PUT', f'/api/v1/books/{self.book}/docs/other', body)[0], 404)
        self.assertEqual(self.call('PUT', '/api/v1/books/999/docs/recaps', body)[0], 404)
        self.assertEqual(self.call('PUT', '/api/v1/docs/settings', b'{}', account=ACCOUNT_A,
                                   headers={'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.call('PUT', f'/api/v1/books/{self.book}/docs/recaps', {'data': {}})[0], 400)
        self.assertEqual(self.call('PUT', f'/api/v1/books/{self.book}/docs/recaps', {'modified': 1.5, 'data': {}})[0],
                         400)
        self.assertEqual(self.call('PUT', f'/api/v1/books/{self.book}/docs/recaps', [1])[0], 400)
        self.assertEqual(self.call('PUT', f'/api/v1/books/{self.book}/docs/recaps', b'{', account=ACCOUNT_A,
                                   headers={'Content-Type': 'application/json'})[0], 400)

    def test_too_large(self):
        import http.client
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        connection.putrequest('PUT', f'/api/v1/books/{self.book}/progress')
        for name, value in (('X-Internal-Token', TOKEN), ('Content-Type', 'application/json'),
                            ('Content-Length', str(service.MAX_JSON_BYTES + 1))):
            connection.putheader(name, value)
        connection.endheaders()
        self.assertEqual(connection.getresponse().status, 413)
        connection.close()

    def test_disk_full(self):
        service.MIN_FREE_BYTES = 1 << 62
        self.assertEqual(self.call('PUT', f'/api/v1/books/{self.book}/progress',
                                   {'modified': 1, 'progress': 0, 'data': {}}),
                         (507, {'error': "The server's disk is full"}))
        self.assertEqual(self.sync()['progress'], [])

    def test_series_and_metadata(self):
        self.assertEqual(self.call('PUT', f'/api/v1/series/{self.book}', {'modified': 1, 'series': 'S'},
                                   account=ACCOUNT_A)[0], 200)
        self.assertEqual(self.call('PUT', f'/api/v1/metadata/{self.book}', {'modified': 1, 'data': {'a': 1}})[0], 200)
        self.assertEqual(self.call('PUT', f'/api/v1/metadata/{self.book}', {'modified': 2, 'data': [1]})[0], 400)
        self.assertEqual(self.call('PUT', f'/api/v1/series/{self.book}', {'modified': 2, 'series': 'x' * 201})[0], 400)
        for account in ('', ACCOUNT_A, ACCOUNT_B):
            body = self.sync(account)
            self.assertEqual([row['series'] for row in body['series']], ['S'])
            self.assertEqual([row['data'] for row in body['metadata']], [{'a': 1}])


PNG = b'\x89PNG\r\n\x1a\n' + b'0' * 16


class FileTest(ServiceTestCase):
    def setUp(self):
        super().setUp()
        self.books([catalog_book(1, '猫', added=1)])
        self.book = self.book_id('uuid-1')

    def test_text_round_trip(self):
        import gzip
        text = {'elementHtml': '<p>猫</p>', 'sections': [{'reference': 'a'}], 'styleSheet': 'p{}',
                'blobs': {'x': 'y'}, 'coverImage': 'z'}
        path = f'/api/v1/books/{self.book}/text'
        self.assertEqual(self.request('GET', path)[0], 404)
        self.assertEqual(self.call('PUT', path, gzip.compress(json.dumps(text).encode()),
                                   headers={'Content-Type': 'application/gzip'}), (200, {}))
        status, headers, data = self.request('GET', path)
        self.assertEqual((status, headers['Content-Type'], headers['Content-Encoding']),
                         (200, 'application/json', 'gzip'))
        self.assertEqual(json.loads(gzip.decompress(data)),
                         {'elementHtml': '<p>猫</p>', 'sections': [{'reference': 'a'}], 'styleSheet': 'p{}'})
        self.assertTrue(os.path.exists(apidb.text_path(service.API_STATE_DIR, self.book)))

    def test_text_rejects_bad_gzip_and_bombs(self):
        import zlib
        path = f'/api/v1/books/{self.book}/text'
        gzip_headers = {'Content-Type': 'application/gzip'}
        self.assertEqual(self.call('PUT', path, b'not gzip', headers=gzip_headers)[0], 400)
        compressor = zlib.compressobj(1, zlib.DEFLATED, 31)
        chunk = b'\0' * (1 << 20)
        bomb = b''.join(compressor.compress(chunk) for _ in range(300)) + compressor.flush()
        self.assertEqual(self.call('PUT', path, bomb, headers=gzip_headers)[0], 400)
        import gzip
        missing = gzip.compress(json.dumps({'elementHtml': ''}).encode())
        self.assertEqual(self.call('PUT', path, missing, headers=gzip_headers)[0], 400)
        self.assertEqual(self.request('GET', path)[0], 404)

    def test_cover_type_checked(self):
        path = f'/api/v1/books/{self.book}/cover'
        self.assertEqual(self.request('GET', path)[0], 404)
        self.assertEqual(self.call('PUT', path, PNG, headers={'Content-Type': 'image/jpeg'})[0], 415)
        self.assertEqual(self.call('PUT', path, b'<svg/>', headers={'Content-Type': 'image/svg+xml'})[0], 415)
        jpeg = b'\xff\xd8\xff' + b'0' * 16
        self.assertEqual(self.call('PUT', path, jpeg, headers={'Content-Type': 'image/jpeg'})[0], 200)
        self.assertEqual(self.call('PUT', path, PNG, headers={'Content-Type': 'image/png'})[0], 200)
        status, headers, data = self.request('GET', path)
        self.assertEqual((status, headers['Content-Type'], headers['X-Content-Type-Options'], data),
                         (200, 'image/png', 'nosniff', PNG))
        self.assertIn('sandbox', headers['Content-Security-Policy'])
        self.assertEqual(sorted(os.listdir(os.path.join(service.API_STATE_DIR, 'covers'))), [f'{self.book}.png'])

    def test_games_round_trip_and_tombstone(self):
        name = urllib.request.quote('ゲーム/1', safe='')
        game = b'PK\x03\x04' + b'0' * 16
        zip_headers = {'Content-Type': 'application/zip'}
        self.assertEqual(self.call('PUT', f'/api/v1/games/{name}?modified=5', game, ACCOUNT_A, zip_headers)[0], 200)
        self.assertEqual(self.call('PUT', f'/api/v1/games/{name}?modified=4', game, ACCOUNT_A, zip_headers)[0], 409)
        self.assertEqual(self.call('PUT', f'/api/v1/games/{name}?modified=6', b'nope', ACCOUNT_A, zip_headers)[0],
                         415)
        self.assertEqual(self.call('PUT', f'/api/v1/games/{name}', game, ACCOUNT_A, zip_headers)[0], 400)
        status, body = self.call('GET', '/api/v1/games', account=ACCOUNT_A)
        self.assertEqual([(g['name'], g['size'], g['modified']) for g in body['games']], [('ゲーム/1', 20, 5)])
        self.assertEqual(self.request('GET', f'/api/v1/games/{name}', account=ACCOUNT_A)[2], game)
        self.assertEqual(self.request('GET', f'/api/v1/games/{name}', account=ACCOUNT_B)[0], 404)
        file = apidb.game_path(service.ACCOUNT_DATA_DIR, ACCOUNT_A, 'ゲーム/1')
        self.assertTrue(os.path.exists(file))
        self.assertEqual(self.call('DELETE', f'/api/v1/games/{name}?modified=7', account=ACCOUNT_A)[0], 200)
        self.assertFalse(os.path.exists(file))
        self.assertEqual(self.call('GET', '/api/v1/games', account=ACCOUNT_A)[1], {'games': []})
        self.assertEqual(self.request('GET', f'/api/v1/games/{name}', account=ACCOUNT_A)[0], 404)
        [row] = self.call('GET', '/api/v1/sync?since=0', account=ACCOUNT_A)[1]['games']
        self.assertTrue(row['deleted'])
        self.assertEqual(self.call('PUT', '/api/v1/games/%01x?modified=1', game, ACCOUNT_A, zip_headers)[0], 400)

    def test_games_need_account(self):
        self.assertEqual(self.call('GET', '/api/v1/games')[0], 403)
        self.assertEqual(self.call('PUT', '/api/v1/games/g?modified=1', b'PK\x03\x04',
                                   headers={'Content-Type': 'application/zip'})[0], 403)


if __name__ == '__main__':
    unittest.main()
