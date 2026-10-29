#!/usr/bin/env python3
"""The server's v1 API (/api/v1/): the catalog, search, and everyone's reading data in state/api/library.db.

Only nginx calls it (X-Internal-Token). nginx checks the account (auth_request) and passes its id in
X-Account-Id; none means a signed-out reader on a trusted network, whose rows are kept under account ''.
Usage: service.py [serve]
"""

import hmac
import json
import os
import re
import shutil
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import apidb

API_STATE_DIR = os.environ.get('API_STATE_DIR', '/data/state/api')
API_DB = os.environ.get('API_DB', os.path.join(API_STATE_DIR, 'library.db'))
HOST = os.environ.get('API_HOST', '127.0.0.1')
PORT = int(os.environ.get('API_PORT', '8769'))
ACCOUNT_DATA_DIR = os.environ.get('ACCOUNT_DATA_DIR', '/data/accounts')
INTERNAL_TOKEN_FILE = os.environ.get('INTERNAL_TOKEN_FILE', '/data/state/internal-token')
MIN_FREE_BYTES = int(os.environ.get('MIN_FREE_MB', '1024')) * 1024 * 1024
VERSION = os.environ.get('VERSION', 'docker')

db: apidb.Database


class ApiError(Exception):
    def __init__(self, status: int, message: str, body: dict | None = None):
        super().__init__(message)
        self.status = status
        self.body = body or {}


def from_nginx(headers) -> bool:
    """Whether the request carries the internal token (none configured: refuse everything)."""
    try:
        with open(INTERNAL_TOKEN_FILE, encoding='ascii') as f:
            token = f.read().strip()
    except OSError:
        return False
    return bool(token) and hmac.compare_digest(token, headers.get('X-Internal-Token', ''))


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
               'series': 'series_overrides', 'metadata': 'book_metadata'}


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
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else b''
        self.send_raw(status, data, {'Content-Type': 'application/json', **(headers or {})} if body is not None
                      else headers)

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

    ROUTES = [
        ('GET', re.compile(r'/api/v1/version'), get_version),
        ('GET', re.compile(r'/api/v1/catalog'), get_catalog),
        ('GET', re.compile(r'/api/v1/books'), get_books),
        ('GET', re.compile(r'/api/v1/sync'), get_sync),
    ]

    def dispatch(self, method: str):
        url = urlsplit(self.path)
        try:
            if not from_nginx(self.headers):
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
        except ApiError as error:
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
