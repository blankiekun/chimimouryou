#!/usr/bin/env python3
"""Request matrix of the Python services (account, api, import, difficulty, mokuro): who gets which
status for which request, as TSV on stdout. Run it before and after a change to the services' request
handling or to nginx's access rules and diff the two files; every changed row is a behaviour change.

    check-service-requests.py nginx BASE_URL USER:PASSWORD ADMIN:PASSWORD > nginx.tsv
    check-service-requests.py direct [SERVER_DIR] > direct.tsv

nginx: through the site, signed out (from this machine's address: a trusted network or not), as an
account without permissions and as an admin. Non-destructive: write requests carry bodies the services
refuse (or nothing they keep), and never start a job. Requests under nginx's `readings` rate limit are
paced 10.5 s apart (about 3 minutes in all); the last row is a burst of text-copy writes.

direct: starts each service from SERVER_DIR (default /app, the difficulty image, which holds all of
them but mokuro: mount server/mokuro at /app/mokuro) on loopback with throwaway state, an internal
token and CORS_ORIGINS=https://app.example, then calls them as nginx would, and as nginx never would
(no or a wrong token, bad Content-Length). Run it with the difficulty image's Python, e.g.

    docker run --rm -i -v "$PWD/server/mokuro:/app/mokuro:ro" ebook-reader-difficulty:local \\
      /opt/venv/bin/python - direct < scripts/check-service-requests.py

Columns: pass, service, method, path, caller, origin, body, status, JSON body (json/-). A dropped
connection (an unhandled exception in a service) is status `reset`. Standard library only.
"""
import gzip
import http.client
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.parse

ROWS = []


def request(base, method, path, headers=None, body=b'', length='auto'):
    """(status, is_json); length: 'auto', None (no Content-Length) or a header value."""
    url = urllib.parse.urlsplit(base)
    conn = (http.client.HTTPSConnection if url.scheme == 'https' else http.client.HTTPConnection)(
        url.hostname, url.port, timeout=60)
    try:
        conn.putrequest(method, url.path.rstrip('/') + path, skip_host=True, skip_accept_encoding=True)
        conn.putheader('Host', (headers or {}).get('Host', url.netloc))
        for name, value in (headers or {}).items():
            if name != 'Host':
                conn.putheader(name, value)
        if length == 'auto':
            length = str(len(body)) if body or method in ('POST', 'PUT') else None
        if length is not None:
            conn.putheader('Content-Length', length)
        conn.endheaders()
        try:
            conn.send(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # refused before the body was read (413 and the like): the answer is still there
        response = conn.getresponse()
        data = response.read()
    except (OSError, http.client.HTTPException):
        return 'reset', '-'
    finally:
        conn.close()
    try:
        json.loads(data)
        is_json = 'json'
    except ValueError:
        is_json = '-'
    return response.status, is_json


def row(*fields):
    ROWS.append(fields)
    print('\t'.join(str(f) for f in fields), flush=True)


# Bodies: (name, bytes, content type). Over-limit sizes are set per request.
def padded(obj: dict, size: int) -> bytes:
    """A valid JSON object of exactly `size` bytes."""
    data = json.dumps({**obj, 'pad': ''}).encode()
    return json.dumps({**obj, 'pad': 'x' * (size - len(data))}).encode()


MALFORMED = b'{"ids": ['
MOKURO = b'{"pages": [{"img_width": 10, "img_height": 10, "img_path": "1.jpg", "blocks": []}]}'
NON_OBJECT = b'[]'


# ---------------------------------------------------------------------------
# Through nginx

def nginx_pass(base, user, admin):
    url = urllib.parse.urlsplit(base)
    same = f'{url.scheme}://{url.netloc}'
    foreign = 'https://evil.example'
    origins = {'none': {}, 'same': {'Origin': same}, 'foreign': {'Origin': foreign}}
    json_type = {'Content-Type': 'application/json'}
    book = first_book(base)

    callers = {'anon': {}}
    for name, credentials in (('reader', user), ('admin', admin)):
        username, password = credentials.split(':', 1)
        callers[name] = {'Cookie': login(base, same, username, password)}

    last_paced = [0.0]

    def call(method, path, caller, origin, body_name='-', body=b'', headers=None, paced=False):
        if paced:  # nginx's readings zone: 6 a minute
            time.sleep(max(0.0, last_paced[0] + 10.5 - time.time()))
            last_paced[0] = time.time()
        status, is_json = request(base, method, path, {**callers[caller], **origins[origin], **(headers or {})}, body)
        if status == 'reset':  # nginx answers every request: a dropped connection is the network's
            status, is_json = request(base, method, path, {**callers[caller], **origins[origin], **(headers or {})},
                                      body)
        row('nginx', service_of(path), method, path.split('?')[0], caller, origin, body_name, status, is_json)

    for caller in callers:
        # account
        call('GET', '/account/api/me', caller, 'none')
        call('GET', '/account/api/tokens', caller, 'none')
        call('GET', '/account/api/admin/users', caller, 'none')
        for origin in origins:
            call('POST', '/account/api/token/revoke', caller, origin, 'empty', b'{}', json_type)
        # api
        call('GET', '/api/v1/version', caller, 'none')
        call('GET', '/api/v1/sync?since=0', caller, 'none')
        call('GET', '/api/v1/games', caller, 'none')
        for origin in ('none', 'foreign'):
            call('PUT', f'/api/v1/books/{book}/progress', caller, origin, 'malformed', MALFORMED, json_type)
        call('PUT', f'/api/v1/series/{book}', caller, 'none', 'malformed', MALFORMED, json_type)
        # import
        call('GET', '/calibre/import/api/jobs?ids=x', caller, 'none')
        for origin in origins:
            call('POST', '/calibre/import/api/add?name=x.exe', caller, origin, 'empty')
        call('POST', '/calibre/import/api/catalog', caller, 'foreign', 'empty')
        call('POST', '/calibre/import/api/series', caller, 'foreign', 'non-object', NON_OBJECT, json_type)
        call('POST', '/calibre/import/api/remove', caller, 'foreign', 'invalid-id', b'{"ids": [0]}', json_type)
        # difficulty
        call('GET', '/calibre/difficulty/api/status', caller, 'none')
        for origin in origins:
            call('POST', '/calibre/difficulty/api/compute', caller, origin, 'no-ids', b'{"ids": []}', json_type)
        call('POST', '/calibre/difficulty/api/terms/remove', caller, 'same', 'malformed', MALFORMED, json_type)
        # mokuro (not running on every install: an admin's row may be 502)
        call('POST', '/calibre/mokuro/api/cancel', caller, 'foreign', 'empty', b'{}', json_type)

    # Admin bodies (same origin)
    for path, bodies in (
            ('/account/api/password', [('malformed', MALFORMED), ('non-object', NON_OBJECT),
                                       ('over-16k', padded({}, 17 * 1024))]),
            (f'/api/v1/books/{book}/progress', [('non-object', NON_OBJECT), ('over-10m', padded({}, 10 * 2**20 + 1))]),
            ('/calibre/import/api/series', [('malformed', MALFORMED), ('non-object', NON_OBJECT),
                                            ('over-1k', padded({'apply': False}, 2048))]),
            ('/calibre/import/api/remove', [('malformed', MALFORMED), ('non-object', NON_OBJECT),
                                            ('invalid-id', b'{"ids": [0]}')]),
            ('/calibre/difficulty/api/compute', [('malformed', MALFORMED), ('non-object', NON_OBJECT),
                                                 ('over-1m', padded({'ids': []}, 2**20 + 1))]),
            ('/calibre/difficulty/api/terms/remove', [('non-object', NON_OBJECT)])):
        method = 'PUT' if path.startswith('/api/') else 'POST'
        for name, body in bodies:
            call(method, path, 'admin', 'same', name, body, json_type)
    call('PUT', f'/api/v1/books/{book}/progress', 'admin', 'same', 'text/plain', b'{}', {'Content-Type': 'text/plain'})

    # Rate-limited (readings zone): readings, ranks, text copy
    bad_text = gzip.compress(b'{}')
    gz = {'Content-Type': 'application/gzip'}
    for caller in callers:
        call('PUT', f'/api/v1/books/{book}/text', caller, 'none', 'no-keys', bad_text, gz, paced=True)
        call('GET', f'/api/v1/books/{book}/text', caller, 'none', paced=True)
    call('PUT', f'/api/v1/books/{book}/text', 'admin', 'foreign', 'no-keys', bad_text, gz, paced=True)
    call('GET', '/calibre/difficulty/api/readings/999999', 'anon', 'none', paced=True)
    for origin in origins:
        call('POST', '/calibre/difficulty/api/readings/999999', 'anon', origin, 'empty', paced=True)
    for name, body in (('ok', '{"forms": ["猫", 1]}'.encode()), ('malformed', MALFORMED),
                       ('non-object', NON_OBJECT), ('over-1m', padded({'forms': []}, 2**20 + 1))):
        call('POST', '/calibre/difficulty/api/ranks', 'reader', 'same', name, body, json_type, paced=True)
    call('POST', '/calibre/difficulty/api/ranks', 'reader', 'foreign', 'ok', b'{"forms": []}', json_type, paced=True)

    # Burst: 15 text-copy writes at once from a signed-in reader.
    statuses = [str(request(base, 'PUT', f'/api/v1/books/{book}/text', {**callers['reader'], **gz}, bad_text)[0])
                for _ in range(15)]
    row('nginx', 'api', 'PUT', '/api/v1/books/{id}/text x15', 'reader', 'none', 'no-keys',
        ' '.join(f'{s}x{statuses.count(s)}' for s in sorted(set(statuses))), '-')


def service_of(path):
    for prefix, name in (('/account/', 'account'), ('/api/v1/', 'api'), ('/calibre/import/', 'import'),
                         ('/calibre/difficulty/', 'difficulty'), ('/calibre/mokuro/', 'mokuro')):
        if path.startswith(prefix):
            return name
    return '?'


def login(base, origin, username, password):
    url = urllib.parse.urlsplit(base)
    conn = (http.client.HTTPSConnection if url.scheme == 'https' else http.client.HTTPConnection)(
        url.hostname, url.port, timeout=30)
    conn.request('POST', url.path.rstrip('/') + '/account/api/login',
                 json.dumps({'username': username, 'password': password}),
                 {'Content-Type': 'application/json', 'Origin': origin})
    response = conn.getresponse()
    response.read()
    if response.status != 200:
        sys.exit(f'Signing in as {username}: HTTP {response.status}')
    return response.getheader('Set-Cookie').split(';', 1)[0]


def first_book(base):
    """A book id of the library (writes to it are refused, so its data stays as it is)."""
    url = urllib.parse.urlsplit(base)
    conn = http.client.HTTPConnection(url.hostname, url.port, timeout=30) if url.scheme == 'http' \
        else http.client.HTTPSConnection(url.hostname, url.port, timeout=30)
    conn.request('GET', url.path.rstrip('/') + '/api/v1/books?limit=1')
    response = conn.getresponse()
    books = json.loads(response.read()).get('books') if response.status == 200 else None
    if not books:
        sys.exit(f'No book to use (GET /api/v1/books: HTTP {response.status}); run from a trusted network')
    return books[0]['id']


# ---------------------------------------------------------------------------
# Direct calls (no nginx)

SERVICES = {
    # name: (script, port env, port, extra env)
    'account': ('account/service.py', 'ACCOUNT_PORT', 18766, {}),
    'api': ('api/service.py', 'API_PORT', 18769, {}),
    'import': ('import/service.py', 'IMPORT_PORT', 18767, {}),
    'difficulty': ('jiten/service.py', 'JITEN_PORT', 18765, {'JITEN_WORKERS': '1'}),
    'mokuro': ('mokuro/service.py', 'MOKURO_PORT', 18768, {'MOKURO_BIN': '/nonexistent'}),
}
HOST = 'reader.example'
LISTED = 'https://app.example'


def start_services(server_dir, state):
    token = 'matrix-internal-token'
    with open(os.path.join(state, 'internal-token'), 'w', encoding='ascii') as f:
        f.write(token)
    library = os.path.join(state, 'library')
    os.makedirs(library)
    open(os.path.join(library, 'placeholder'), 'w').close()  # not empty: import makes no Calibre library
    with open(os.path.join(state, 'catalog.json'), 'w', encoding='utf-8') as f:
        json.dump({'books': [{'id': 7, 'format': 'CBZ', 'title': 'Manga', 'file': 'm.cbz'}]}, f)
    env = {**os.environ, 'INTERNAL_TOKEN_FILE': os.path.join(state, 'internal-token'),
           'CORS_ORIGINS': LISTED, 'ALLOW_HTTP_ACCOUNTS': '1', 'MIN_FREE_MB': '0', 'CALIBRE_DEBUG': 'false',
           'CALIBRE_LIBRARY': library, 'CALIBRE_CATALOG': os.path.join(state, 'catalog.json'),
           'CATALOG_OUTPUT': os.path.join(state, 'catalog.json'), 'VN_DIR': os.path.join(state, 'vn'),
           'SHARED_SYNC_DIR': os.path.join(state, 'sync'), 'ACCOUNT_DATA_DIR': os.path.join(state, 'accounts'),
           'ACCOUNT_STATE_DIR': os.path.join(state, 'account'), 'API_STATE_DIR': os.path.join(state, 'api'),
           'API_DB': os.path.join(state, 'api', 'library.db'), 'IMPORT_STATE_DIR': os.path.join(state, 'import'),
           'JITEN_STATE_DIR': os.path.join(state, 'difficulty'), 'MOKURO_STATE_DIR': os.path.join(state, 'mokuro'),
           'ACCOUNT_HOST': '127.0.0.1', 'API_HOST': '127.0.0.1', 'IMPORT_HOST': '127.0.0.1',
           'JITEN_HOST': '127.0.0.1', 'MOKURO_HOST': '127.0.0.1'}
    for name in ('api', 'import', 'difficulty', 'mokuro', 'sync', 'accounts', 'account'):
        os.makedirs(os.path.join(state, name), exist_ok=True)
    # Saving book 7's text fails (as on a full disk): an unexpected error in the service.
    os.makedirs(os.path.join(state, 'mokuro', '7.json.tmp'))
    processes = []
    for name, (script, port_env, port, extra) in SERVICES.items():
        log = open(os.path.join(state, f'{name}.log'), 'wb')
        processes.append(subprocess.Popen([sys.executable, '-W', 'ignore', os.path.join(server_dir, script), 'serve'],
                                          env={**env, port_env: str(port), **extra}, stdout=log, stderr=log))
    for name, (_, _, port, _) in SERVICES.items():
        for _ in range(600):
            try:
                socket.create_connection(('127.0.0.1', port), timeout=1).close()
                break
            except OSError:
                time.sleep(0.1)
        else:
            sys.exit(f'{name} did not start; its log: ' + open(os.path.join(state, f'{name}.log')).read()[-2000:])
    # A book for the api's book routes.
    with sqlite3.connect(env['API_DB']) as connection:
        connection.execute("INSERT OR IGNORE INTO books (id, key, calibre_id, title, unique_title, format, file, "
                           "updated, rev) VALUES (1, 'matrix', 1, 'Matrix', 'Matrix', 'EPUB', 'm.epub', 0, 0)")
    return token, processes


def direct_pass(server_dir):
    state = tempfile.mkdtemp(prefix='service-matrix-')
    token, processes = start_services(server_dir, state)
    try:
        direct_rows(token)
    finally:
        for process in processes:
            process.terminate()
        for process in processes:
            process.wait()
        with os.scandir(state) as entries:
            for entry in entries:
                if entry.name.endswith('.log') and os.path.getsize(entry.path):
                    sys.stderr.write(f'--- {entry.name}\n' + open(entry.path, errors='replace').read()[-3000:])


def direct_rows(token):
    # caller: which token. origin: scheme of the request (X-Forwarded-Proto), bearer or not, Origin.
    tokens = {'no-token': {}, 'wrong-token': {'X-Internal-Token': 'wrong'}, 'nginx': {'X-Internal-Token': token}}
    # As nginx sends them after its account check: an admin with every permission.
    account = {'X-Account-Id': 'a' * 32, 'X-Account-Admin': '1', 'Host': HOST}
    origins = {
        'http none': {'X-Forwarded-Proto': 'http'},
        'http same': {'X-Forwarded-Proto': 'http', 'Origin': f'http://{HOST}'},
        'http foreign': {'X-Forwarded-Proto': 'http', 'Origin': 'https://evil.example'},
        'http listed': {'X-Forwarded-Proto': 'http', 'Origin': LISTED},
        'https same': {'X-Forwarded-Proto': 'https', 'Origin': f'https://{HOST}'},
        'https listed': {'X-Forwarded-Proto': 'https', 'Origin': LISTED},
        'no-proto same-https': {'Origin': f'https://{HOST}'},
        'https bearer none': {'X-Forwarded-Proto': 'https', 'Authorization': 'Bearer abc'},
        'https bearer same': {'X-Forwarded-Proto': 'https', 'Authorization': 'Bearer abc', 'Origin': f'https://{HOST}'},
        'https bearer listed': {'X-Forwarded-Proto': 'https', 'Authorization': 'Bearer abc', 'Origin': LISTED},
        'https bearer foreign': {'X-Forwarded-Proto': 'https', 'Authorization': 'Bearer abc',
                                 'Origin': 'https://evil.example'},
        'http bearer listed': {'X-Forwarded-Proto': 'http', 'Authorization': 'Bearer abc', 'Origin': LISTED},
    }
    json_type = {'Content-Type': 'application/json'}

    def call(service, method, path, caller, origin, body_name, body=b'', headers=None, length='auto'):
        base = f'http://127.0.0.1:{SERVICES[service][2]}'
        status, is_json = request(base, method, path, {**tokens[caller], **account, **origins[origin], **(headers or {})},
                                  body, length)
        row('direct', service, method, path, caller, origin, body_name, status, is_json)

    gets = {'account': '/me', 'api': '/api/v1/version', 'import': '/jobs?ids=x', 'difficulty': '/status',
            'mokuro': '/status'}
    # A POST each service refuses after its Origin check (or accepts harmlessly), to see that check alone.
    posts = {'account': ('POST', '/token/revoke', b'{}'), 'api': ('PUT', '/api/v1/books/1/progress', MALFORMED),
             'import': ('POST', '/remove', b'{"ids": [0]}'), 'difficulty': ('POST', '/compute', b'{"ids": []}'),
             'mokuro': ('POST', '/generate', b'{"ids": []}')}
    for service in SERVICES:
        for caller in tokens:
            call(service, 'GET', gets[service], caller, 'http none', '-')
            method, path, body = posts[service]
            call(service, method, path, caller, 'http same', 'refused', body, json_type)
        method, path, body = posts[service]
        for origin in origins:
            call(service, method, path, 'nginx', origin, 'refused', body, json_type)

    # Bodies, same origin over HTTP. over-*: one byte over the service's or nginx's limit.
    bodies = {
        ('account', 'POST', '/login'): [('ok', b'{"username": "nobody", "password": "x"}'),
                                        ('over-16k', padded({}, 16 * 1024 + 1))],
        ('api', 'PUT', '/api/v1/books/1/progress'): [('over-10m', padded({}, 10 * 2**20 + 1)),
                                                     ('text/plain', b'{}', {'Content-Type': 'text/plain'})],
        ('import', 'POST', '/series'): [('over-1k', padded({'apply': False}, 2048))],
        ('import', 'POST', '/remove'): [('over-64k', padded({'ids': [0]}, 2**16 + 1))],
        ('difficulty', 'POST', '/compute'): [('over-1m', padded({'ids': []}, 2**20 + 1))],
        ('difficulty', 'POST', '/ranks'): [('ok', '{"forms": ["猫", 1, [1]]}'.encode()),
                                           ('over-1m', padded({'forms': []}, 2**20 + 1))],
        ('difficulty', 'POST', '/terms/remove'): [],
        ('difficulty', 'POST', '/readings/999999'): [('ok', b'')],
        ('mokuro', 'POST', '/generate'): [('over-64k', padded({'ids': []}, 2**16 + 1)),
                                          ('over-64m', padded({'ids': []}, 64 * 2**20 + 1))],
        ('mokuro', 'POST', '/remove'): [('ok', b'{"id": 999999}')],
        ('mokuro', 'POST', '/upload?id=999999'): [('not-manga', b'{}')],
        ('mokuro', 'POST', '/upload?id=7'): [('not-mokuro', b'{"pages": 1}'), ('write-fails', MOKURO)],
    }
    for (service, method, path), extra in bodies.items():
        common = [('malformed', MALFORMED), ('non-object', NON_OBJECT), ('empty', b'')]
        for name, body, *headers in common + extra:
            call(service, method, path, 'nginx', 'http same', name, body, {**json_type, **(headers[0] if headers else {})})
        call(service, method, path, 'nginx', 'http same', 'no-length', b'', json_type, length=None)
        call(service, method, path, 'nginx', 'http same', 'bad-length', b'', json_type, length='abc')


def main(argv):
    if len(argv) == 5 and argv[1] == 'nginx':
        nginx_pass(argv[2], argv[3], argv[4])
    elif len(argv) in (2, 3) and argv[1] == 'direct':
        direct_pass(argv[2] if len(argv) == 3 else '/app')
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv)
