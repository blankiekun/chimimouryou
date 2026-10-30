#!/usr/bin/env python3
"""The server's v1 API (/api/v1/): the catalog, search, and everyone's reading data in state/api/library.db.

Only nginx calls it (X-Internal-Token). nginx checks the account (auth_request) and passes its id in
X-Account-Id; none means a signed-out reader on a trusted network, whose rows are kept under account ''.
Usage: service.py [serve]
"""

import glob
import gzip
import io
import json
import os
import re
import shutil
import sys
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

import apidb
# httpbase.py (shared request checks) is in the parent folder: /app in the images, server/ here.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
import httpbase  # noqa: E402

API_STATE_DIR = os.environ.get('API_STATE_DIR', '/data/state/api')
API_DB = os.environ.get('API_DB', os.path.join(API_STATE_DIR, 'library.db'))
HOST = os.environ.get('API_HOST', '127.0.0.1')
PORT = int(os.environ.get('API_PORT', '8769'))
ACCOUNT_DATA_DIR = os.environ.get('ACCOUNT_DATA_DIR', '/data/accounts')
CALIBRE_CATALOG = os.environ.get('CALIBRE_CATALOG', '/data/state/catalog/catalog.json')
INTERNAL_TOKEN_FILE = os.environ.get('INTERNAL_TOKEN_FILE', '/data/state/internal-token')
MIN_FREE_BYTES = int(os.environ.get('MIN_FREE_MB', '1024')) * 1024 * 1024
VERSION = os.environ.get('VERSION', 'docker')
MAX_JSON_BYTES = 10 * 1024 * 1024
MAX_TEXT_BYTES = 32 * 1024 * 1024
MAX_TEXT_UNPACKED_BYTES = 256 * 1024 * 1024
MAX_COVER_BYTES = 10 * 1024 * 1024
MAX_GAME_BYTES = 100 * 1024 * 1024
TEXT_KEYS = {'elementHtml': str, 'sections': list, 'styleSheet': str}
COVER_TYPES = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif'}

db: apidb.Database


class ApiError(httpbase.HttpError):
    def __init__(self, status: int, message: str, body: dict | None = None):
        super().__init__(status, message, body=body)


def disk_full(path: str) -> bool:
    """Below MIN_FREE_BYTES free: there are no quotas, so this keeps uploads from filling the disk."""
    try:
        return shutil.disk_usage(path).free < MIN_FREE_BYTES
    except OSError:
        return False


ROW_KEYS = {'book': 'book', 'date_key': 'dateKey', 'goal_start': 'goalStart', 'hid': 'hid', 'kind': 'kind',
            'name': 'name', 'series': 'series', 'size': 'size', 'progress': 'progress', 'deleted': 'deleted',
            'data': 'data', 'modified': 'modified', 'rev': 'rev'}

SYNC_TABLES = {'progress': 'progress', 'statistics': 'statistics', 'goals': 'goals', 'highlights': 'highlights',
               'bookDocs': 'book_docs', 'accountDocs': 'account_docs', 'games': 'games',
               'gameDocs': 'game_docs', 'series': 'series_overrides', 'metadata': 'book_metadata'}


def kinds(table: str) -> str:
    """A route's alternation of the doc kinds a table holds (sync-kinds.json)."""
    return '|'.join(map(re.escape, sorted(apidb.DOC_KINDS[table])))


def row_json(table: str, row) -> dict:
    result = {}
    for column in row.keys():
        if column not in ROW_KEYS:
            continue
        value = row[column]
        if column == 'deleted':
            value = bool(value)
        elif column == 'data':
            value = json.loads(value)
        result[ROW_KEYS[column]] = value
    return result


def book_json(row) -> dict:
    return {
        'id': row['id'], 'calibreId': row['calibre_id'], 'key': row['key'], 'title': row['unique_title'],
        'originalTitle': row['title'], 'authors': row['authors'], 'series': row['series'],
        'seriesIndex': row['series_index'], 'seriesInferred': bool(row['series_inferred']),
        'tags': json.loads(row['tags']), 'rating': row['rating'], 'publisher': row['publisher'],
        'published': row['published'], 'added': row['added'], 'format': row['format'], 'file': row['file'],
        'size': row['size'], 'cover': row['cover'], 'vn': bool(row['vn']), 'deleted': bool(row['deleted']),
        'rev': row['rev'],
    }


def image_type(data: bytes) -> str | None:
    """The image type from the magic bytes."""
    if data.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'image/gif'
    return None


def gunzip(data: bytes, limit: int) -> bytes:
    """Decompresses up to limit bytes (more is refused: a gzip bomb)."""
    out = bytearray()
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as f:
            while chunk := f.read(1024 * 1024):
                out += chunk
                if len(out) > limit:
                    raise ApiError(400, 'Too large unpacked')
    except (OSError, EOFError):
        raise ApiError(400, 'Not gzip') from None
    return bytes(out)


def cover_files(book: int) -> list[str]:
    return glob.glob(os.path.join(glob.escape(API_STATE_DIR), 'covers', f'{book}.*'))


def reject_constant(name: str):
    raise ValueError(name)


def int_param(query: dict, name: str, default: int, low: int, high: int | None = None) -> int:
    value = query.get(name, [str(default)])[0]
    if not re.fullmatch(r'\d{1,16}', value) or int(value) < low or (high is not None and int(value) > high):
        raise ApiError(400, f'Bad {name}')
    return int(value)


class Handler(BaseHTTPRequestHandler):
    server_version = 'ebook-api'
    sys_version = ''

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.headers.get('X-Real-IP') or self.client_address[0], fmt % args))

    def send(self, status: int, body: dict | None = None, headers: dict | None = None):
        httpbase.send_json(self, status, body, headers)

    def send_raw(self, status: int, data: bytes, headers: dict | None = None):
        self.send_response(status)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    # -- reads

    def get_version(self, match):
        return 200, {'api': 1, 'server': VERSION}

    def get_catalog(self, match):
        since = int_param(self.query, 'since', 0, 0)
        if not os.path.exists(CALIBRE_CATALOG):
            # The client shows "the library is being built" for this 404.
            raise ApiError(404, 'The library is being built')

        def read(connection):
            if since == 0:
                rows = connection.execute('SELECT * FROM books WHERE deleted = 0 ORDER BY added DESC, id DESC')
            else:
                rows = connection.execute('SELECT * FROM books WHERE rev > ? ORDER BY rev, id', (since,))
            return {'rev': apidb.current_rev(connection), 'books': [book_json(row) for row in rows]}
        return 200, db.transaction(read)

    def get_books(self, match):
        limit = int_param(self.query, 'limit', 50, 1, 200)
        where, params = ['deleted = 0'], []
        q = self.query.get('q', [''])[0].strip()
        if len(q) >= 3:
            where.append('id IN (SELECT rowid FROM books_fts WHERE books_fts MATCH ?)')
            params.append('"' + q.replace('"', '""') + '"')
        elif q:  # trigrams can't match one or two characters
            like = '%' + re.sub(r'([\\%_])', r'\\\1', q) + '%'
            where.append("(title LIKE ? ESCAPE '\\' OR authors LIKE ? ESCAPE '\\' OR series LIKE ? ESCAPE '\\')")
            params += [like, like, like]
        if 'series' in self.query:
            where.append('series = ?')
            params.append(self.query['series'][0])
        if cursor := self.query.get('cursor', [''])[0]:
            found = re.fullmatch(r'(-?\d{1,16}):(-?\d{1,16})', cursor)
            if not found:
                raise ApiError(400, 'Bad cursor')
            where.append('(added, id) < (?, ?)')
            params += [int(found[1]), int(found[2])]
        rows = db.query(f'SELECT * FROM books WHERE {" AND ".join(where)} ORDER BY added DESC, id DESC LIMIT ?',
                        (*params, limit + 1))
        books = [book_json(row) for row in rows[:limit]]
        more = len(rows) > limit
        return 200, {'books': books, 'next': f"{books[-1]['added']}:{books[-1]['id']}" if more else None}

    def get_sync(self, match):
        since = int_param(self.query, 'since', 0, 0)

        def read(connection):
            result = {'rev': apidb.current_rev(connection)}
            for name, table in SYNC_TABLES.items():
                if 'account' in apidb.TABLE_KEYS[table]:
                    rows = connection.execute(f'SELECT * FROM {table} WHERE account = ? AND rev > ? ORDER BY rev',
                                              (self.account, since))
                else:
                    rows = connection.execute(f'SELECT * FROM {table} WHERE rev > ? ORDER BY rev', (since,))
                result[name] = [row_json(table, row) for row in rows]
            return result
        return 200, db.transaction(read)

    def get_migration(self, match):
        try:
            with open(os.path.join(API_STATE_DIR, 'migrate-report.json'), encoding='utf-8') as f:
                return 200, json.load(f)
        except FileNotFoundError:
            return 200, {}

    # -- writes

    def read_body(self, types: tuple[str, ...], limit: int, disk: str = '') -> bytes:
        """The request body, checked before it is read; disk: refuse while that disk is nearly full."""
        # application/json forces a CORS preflight: other sites can't post as a trusted-network reader.
        data = httpbase.read_body(self, limit, types)
        if disk_full(disk or API_STATE_DIR) or (disk and disk_full(API_STATE_DIR)):
            raise ApiError(507, "The server's disk is full")
        return data

    def read_json(self) -> dict:
        try:
            # NaN and Infinity aren't JSON: the browsers couldn't read them back.
            body = json.loads(self.read_body(('application/json',), MAX_JSON_BYTES), parse_constant=reject_constant)
        except ValueError:
            raise ApiError(400, 'Invalid JSON') from None
        if not isinstance(body, dict):
            raise ApiError(400, 'Expected an object')
        modified = body.get('modified')
        if type(modified) is not int or not 0 <= modified < 2 ** 53:
            raise ApiError(400, 'Bad modified')
        return body

    @staticmethod
    def data_of(body: dict) -> str:
        if 'data' not in body:
            raise ApiError(400, 'Missing data')
        return apidb.to_json(body['data'])

    def book_of(self, match) -> int:
        """books.id from the path; deleted books too, so their data is never refused."""
        book = int(match[1])
        if not db.query('SELECT 1 FROM books WHERE id = ?', (book,)):
            raise ApiError(404, 'No such book')
        return book

    def needs_account(self):
        if not self.account:
            raise ApiError(403, 'Needs an account')

    @staticmethod
    def put(table: str, key: dict, modified: int, values: dict):
        status, row = db.transaction(lambda c: apidb.put_row(c, apidb.Rev(c), table, key, modified, values))
        if status == 'conflict':
            raise ApiError(409, 'Newer on the server', {'row': row_json(table, row)})
        return 200, {'rev': row['rev']}

    def put_progress(self, match):
        book, body = self.book_of(match), self.read_json()
        progress = body.get('progress')
        if progress is not None and type(progress) not in (int, float):
            raise ApiError(400, 'Bad progress')
        return self.put('progress', {'account': self.account, 'book': book}, body['modified'],
                        {'data': self.data_of(body), 'progress': progress or 0})

    def statistics_key(self, match) -> dict:
        book = self.book_of(match)
        if not apidb.DATE_RE.fullmatch(match[2]):
            raise ApiError(400, 'Bad date')
        return {'account': self.account, 'book': book, 'date_key': match[2]}

    def put_statistics(self, match):
        key, body = self.statistics_key(match), self.read_json()
        return self.put('statistics', key, body['modified'], {'data': self.data_of(body), 'deleted': 0})

    def delete_statistics(self, match):
        key, body = self.statistics_key(match), self.read_json()
        return self.put('statistics', key, body['modified'], {'data': '{}', 'deleted': 1})

    def highlight_key(self, match) -> dict:
        book = self.book_of(match)
        if not apidb.HID_RE.fullmatch(match[2]):
            raise ApiError(400, 'Bad highlight id')
        return {'account': self.account, 'book': book, 'hid': match[2]}

    def put_highlight(self, match):
        key, body = self.highlight_key(match), self.read_json()
        # Clients PUT their tombstones whole (start and created kept for sorting), like the migration stores them.
        deleted = int(isinstance(body.get('data'), dict) and body['data'].get('deleted') is True)
        return self.put('highlights', key, body['modified'], {'data': self.data_of(body), 'deleted': deleted})

    def delete_highlight(self, match):
        key, body = self.highlight_key(match), self.read_json()
        return self.put('highlights', key, body['modified'], {'data': '{}', 'deleted': 1})

    def put_book_doc(self, match):
        book, body = self.book_of(match), self.read_json()
        return self.put('book_docs', {'account': self.account, 'book': book, 'kind': match[2]}, body['modified'],
                        {'data': self.data_of(body)})

    def put_account_doc(self, match):
        self.needs_account()
        body = self.read_json()
        return self.put('account_docs', {'account': self.account, 'kind': match[1]}, body['modified'],
                        {'data': self.data_of(body)})

    def goal_key(self, match) -> dict:
        if not apidb.DATE_RE.fullmatch(match[1]):
            raise ApiError(400, 'Bad date')
        return {'account': self.account, 'goal_start': match[1]}

    def put_goals(self, match):
        key, body = self.goal_key(match), self.read_json()
        return self.put('goals', key, body['modified'], {'data': self.data_of(body), 'deleted': 0})

    def delete_goals(self, match):
        key, body = self.goal_key(match), self.read_json()
        return self.put('goals', key, body['modified'], {'data': '{}', 'deleted': 1})

    def put_series(self, match):
        book, body = self.book_of(match), self.read_json()
        series = body.get('series')
        if not isinstance(series, str) or len(series) > 200:
            raise ApiError(400, 'Bad series')
        return self.put('series_overrides', {'book': book}, body['modified'], {'series': series})

    def put_metadata(self, match):
        book, body = self.book_of(match), self.read_json()
        if not isinstance(body.get('data'), dict):
            raise ApiError(400, 'Bad data')
        return self.put('book_metadata', {'book': book}, body['modified'], {'data': self.data_of(body)})

    # -- files

    def put_text(self, match):
        book = self.book_of(match)
        data = gunzip(self.read_body(('application/gzip',), MAX_TEXT_BYTES), MAX_TEXT_UNPACKED_BYTES)
        try:
            text = json.loads(data, parse_constant=reject_constant)
        except ValueError:
            raise ApiError(400, 'Invalid JSON') from None
        if not isinstance(text, dict) or not all(isinstance(text.get(k), t) for k, t in TEXT_KEYS.items()):
            raise ApiError(400, 'Expected elementHtml, sections and styleSheet')
        # Text only: no images (blobs) or cover, which the server has in the library.
        kept = {key: text[key] for key in TEXT_KEYS}
        apidb.write_atomic(apidb.text_path(API_STATE_DIR, book), gzip.compress(apidb.to_json(kept).encode()))
        return 200, {}

    def get_text(self, match):
        book = self.book_of(match)
        try:
            with open(apidb.text_path(API_STATE_DIR, book), 'rb') as f:
                data = f.read()
        except FileNotFoundError:
            raise ApiError(404, 'No text copy') from None
        return 200, data, {'Content-Type': 'application/json', 'Content-Encoding': 'gzip'}

    def put_cover(self, match):
        book = self.book_of(match)
        content_type = self.headers.get('Content-Type', '').split(';')[0].strip().lower()
        data = self.read_body(tuple(COVER_TYPES), MAX_COVER_BYTES)
        if image_type(data) != content_type:
            raise ApiError(415, 'Not that image type')
        path = os.path.join(API_STATE_DIR, 'covers', f'{book}.{COVER_TYPES[content_type]}')
        apidb.write_atomic(path, data)
        for other in cover_files(book):
            if other != path:
                os.unlink(other)
        return 200, {}

    def get_cover(self, match):
        book = self.book_of(match)
        for path in cover_files(book):
            content_type = next((t for t, ext in COVER_TYPES.items() if path.endswith('.' + ext)), None)
            if content_type:
                with open(path, 'rb') as f:
                    return 200, f.read(), {'Content-Type': content_type, 'X-Content-Type-Options': 'nosniff',
                                           'Content-Security-Policy': "sandbox; default-src 'none'"}
        raise ApiError(404, 'No cover')

    def game_name(self, match) -> str:
        self.needs_account()
        try:
            name = unquote(match[1], errors='strict')
        except UnicodeDecodeError:
            raise ApiError(400, 'Bad name') from None
        if not 1 <= len(name) <= 300 or any(unicodedata.category(c) == 'Cc' for c in name):
            raise ApiError(400, 'Bad name')
        return name

    def modified_param(self) -> int:
        if 'modified' not in self.query:
            raise ApiError(400, 'Bad modified')
        return int_param(self.query, 'modified', 0, 0, 2 ** 53 - 1)

    def get_games(self, match):
        self.needs_account()
        rows = db.query('SELECT * FROM games WHERE account = ? AND deleted = 0 ORDER BY name', (self.account,))
        return 200, {'games': [row_json('games', row) for row in rows]}

    def put_game(self, match):
        name, modified = self.game_name(match), self.modified_param()
        data = self.read_body(('application/zip',), MAX_GAME_BYTES, ACCOUNT_DATA_DIR)
        if not data.startswith(b'PK\x03\x04'):
            raise ApiError(415, 'Not a zip')
        return self.write_game(name, modified, data)

    def delete_game(self, match):
        return self.write_game(self.game_name(match), self.modified_param(), None)

    def write_game(self, name: str, modified: int, data: bytes | None):
        path = apidb.game_path(ACCOUNT_DATA_DIR, self.account, name)

        def work(connection):
            values = {'size': len(data), 'deleted': 0} if data is not None else {'size': 0, 'deleted': 1}
            status, row = apidb.put_row(connection, apidb.Rev(connection), 'games',
                                        {'account': self.account, 'name': name}, modified, values)
            # In the transaction: a failed file write leaves the row as it was.
            if status == 'written' and data is not None:
                apidb.write_atomic(path, data)
            elif status == 'written' and os.path.exists(path):
                os.unlink(path)
            return status, row
        status, row = db.transaction(work)
        if status == 'conflict':
            raise ApiError(409, 'Newer on the server', {'row': row_json('games', row)})
        return 200, {'rev': row['rev']}

    def put_game_doc(self, match):
        name, body = self.game_name(match), self.read_json()
        return self.put('game_docs', {'account': self.account, 'name': name, 'kind': match[2]}, body['modified'],
                        {'data': self.data_of(body), 'deleted': 0})

    def get_game(self, match):
        name = self.game_name(match)
        rows = db.query('SELECT 1 FROM games WHERE account = ? AND name = ? AND deleted = 0', (self.account, name))
        try:
            if rows:
                with open(apidb.game_path(ACCOUNT_DATA_DIR, self.account, name), 'rb') as f:
                    return 200, f.read(), {'Content-Type': 'application/zip'}
        except FileNotFoundError:
            pass
        raise ApiError(404, 'No such game')

    ROUTES = [
        ('GET', re.compile(r'/api/v1/version'), get_version),
        ('GET', re.compile(r'/api/v1/catalog'), get_catalog),
        ('GET', re.compile(r'/api/v1/books'), get_books),
        ('GET', re.compile(r'/api/v1/sync'), get_sync),
        ('GET', re.compile(r'/api/v1/migration'), get_migration),
        ('PUT', re.compile(r'/api/v1/books/(\d+)/progress'), put_progress),
        ('PUT', re.compile(r'/api/v1/books/(\d+)/statistics/([^/]+)'), put_statistics),
        ('DELETE', re.compile(r'/api/v1/books/(\d+)/statistics/([^/]+)'), delete_statistics),
        ('PUT', re.compile(r'/api/v1/books/(\d+)/highlights/([^/]+)'), put_highlight),
        ('DELETE', re.compile(r'/api/v1/books/(\d+)/highlights/([^/]+)'), delete_highlight),
        ('PUT', re.compile(rf'/api/v1/books/(\d+)/docs/({kinds("book_docs")})'), put_book_doc),
        ('PUT', re.compile(rf'/api/v1/docs/({kinds("account_docs")})'), put_account_doc),
        ('PUT', re.compile(r'/api/v1/goals/([^/]+)'), put_goals),
        ('DELETE', re.compile(r'/api/v1/goals/([^/]+)'), delete_goals),
        ('PUT', re.compile(r'/api/v1/series/(\d+)'), put_series),
        ('PUT', re.compile(r'/api/v1/metadata/(\d+)'), put_metadata),
        ('PUT', re.compile(r'/api/v1/books/(\d+)/text'), put_text),
        ('GET', re.compile(r'/api/v1/books/(\d+)/text'), get_text),
        ('PUT', re.compile(r'/api/v1/books/(\d+)/cover'), put_cover),
        ('GET', re.compile(r'/api/v1/books/(\d+)/cover'), get_cover),
        ('GET', re.compile(r'/api/v1/games'), get_games),
        ('PUT', re.compile(rf'/api/v1/games/([^/]+)/docs/({kinds("game_docs")})'), put_game_doc),
        ('PUT', re.compile(r'/api/v1/games/([^/]+)'), put_game),
        ('GET', re.compile(r'/api/v1/games/([^/]+)'), get_game),
        ('DELETE', re.compile(r'/api/v1/games/([^/]+)'), delete_game),
    ]

    def dispatch(self, method: str):
        url = urlsplit(self.path)
        try:
            if not httpbase.from_nginx(self.headers, INTERNAL_TOKEN_FILE):
                raise ApiError(403, 'Only nginx may call this service')
            self.account = self.headers.get('X-Account-Id', '')
            if self.account and not apidb.ACCOUNT_RE.fullmatch(self.account):
                raise ApiError(400, 'Bad account')
            self.query = parse_qs(url.query)
            routes = [(route_method, handler, match) for route_method, pattern, handler in self.ROUTES
                      if (match := pattern.fullmatch(url.path))]
            if not routes:
                raise ApiError(404, 'Not found')
            route = next(((handler, match) for route_method, handler, match in routes if route_method == method), None)
            if not route:
                raise ApiError(405, 'Method not allowed')
            status, body, *headers = route[0](self, route[1])
            if isinstance(body, bytes):
                self.send_raw(status, body, headers[0] if headers else None)
            else:
                self.send(status, body, headers[0] if headers else None)
        except httpbase.HttpError as error:
            self.send(error.status, {'error': str(error), **error.body})
        except Exception as error:  # noqa: BLE001 - log it, don't leak details
            self.log_message('error: %s: %s', type(error).__name__, error)
            self.send(500, {'error': 'Internal error'})

    def do_GET(self):
        self.dispatch('GET')

    def do_PUT(self):
        self.dispatch('PUT')

    def do_DELETE(self):
        self.dispatch('DELETE')

    def do_POST(self):
        self.dispatch('POST')


def main():
    global db

    command = (sys.argv[1:] or ['serve'])[0]
    if command != 'serve':
        sys.exit(f'Unknown command {command}; usage: service.py [serve]')
    db = apidb.Database(API_DB)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == '__main__':
    main()
