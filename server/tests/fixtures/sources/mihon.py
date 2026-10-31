"""Mihon extensions for serve.py and the desktop app's E2E (apps/desktop/e2e/mihon.e2e.mjs).

- https://repo.example/mihon/index.pb: a Mihon repository (gzip protobuf, the fields mihon-index.ts reads) listing
  keiyoushi's Rawkuma jar, which is served beside it unchanged (mihon/, Apache-2.0, see NOTICE).
- rawkuma.net: an invented NatsuId (WordPress) site in the shape the jar reads: one series, "Fixture Manga", two
  chapters of three pages (the nonce form, advanced_search, wp-json/wp/v2/manga, chapter_list, chapter pages).
- `python3 mihon.py <dir>`: an https proxy for the E2E. CONNECT to rawkuma.net or repo.example ends here, in TLS with
  a certificate from a test CA it makes in <dir> (ca.pem, and ca.p12 as the JVM's trust store); serve.py's
  handler answers. Any other host is tunnelled unchanged (the app's Java download). Prints "proxy <port>".
"""
import gzip
import json
import os
import socket
import socketserver
import ssl
import subprocess
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
JAR = 'tachiyomi-ja.rawkuma-v1.6.43.jar'
PAGE = os.path.join(HERE, 'kakuyomu', 'cover.png')
BASE = 'https://rawkuma.net'
HOSTS = {'rawkuma.net', 'repo.example'}
WORK = {'id': 101, 'slug': 'fixture-manga', 'title': 'Fixture Manga'}
CHAPTERS = 2
PAGES = 3
NONCE = 'fixture-nonce'
# The id the jar gives its source (keiyoushi's generated one, not MD5 of name/lang/version).
SOURCE_ID = 5746834068092446709
TRUST_PASSWORD = 'chimi-e2e'


def varint(n: int) -> bytes:
    n &= (1 << 64) - 1
    out = bytearray()
    while True:
        out.append((n & 0x7f) | (0x80 if n > 0x7f else 0))
        n >>= 7
        if not n:
            return bytes(out)


def field(number: int, value: bytes | str | int) -> bytes:
    if isinstance(value, int):
        return varint(number << 3) + varint(value)
    data = value.encode() if isinstance(value, str) else value
    return varint(number << 3 | 2) + varint(len(data)) + data


def index_pb() -> bytes:
    source = field(1, SOURCE_ID) + field(2, 'Rawkuma') + field(3, 'ja') + field(4, BASE)
    extension = (field(1, 'Rawkuma') + field(2, 'eu.kanade.tachiyomi.extension.ja.rawkuma')
                 + field(3, field(501, f'https://repo.example/mihon/{JAR}')) + field(4, '1.6')
                 + field(6, '1.6.43') + field(7, 1) + field(8, source))
    store = field(1, 'Fixture Mihon') + field(3, 'fixture-signing-key') + field(101, field(1, extension))
    return gzip.compress(store)


def repo(rest: str) -> tuple[int, str, bytes]:
    if rest == 'index.pb':
        return 200, 'application/octet-stream', index_pb()
    if rest == JAR:
        with open(os.path.join(HERE, 'mihon', JAR), 'rb') as f:
            return 200, 'application/java-archive', f.read()
    return 404, 'text/plain', b'not found'


def manga() -> dict:
    terms = [[{'name': name, 'slug': name.lower(), 'taxonomy': taxonomy}]
             for taxonomy, name in (('genre', 'Action'), ('type', 'Manga'), ('status', 'Ongoing'),
                                    ('series-author', 'Fixture Author'))]
    return {'id': WORK['id'], 'slug': WORK['slug'], 'title': {'rendered': WORK['title']},
            'content': {'rendered': '<p>An invented series for the E2E.</p>'},
            '_embedded': {'wp:featuredmedia': [{'source_url': f'{BASE}/img/cover.png'}], 'wp:term': terms}}


def rawkuma(rest: str, query: dict, body: bytes = b'') -> tuple[int, str, bytes]:
    html = 'text/html; charset=UTF-8'
    work = f'{BASE}/manga/{WORK["slug"]}/'
    action = query.get('action', [''])[0]
    if rest == 'wp-admin/admin-ajax.php' and action == 'get_nonce':
        return 200, html, f'<form><input type="hidden" name="search_nonce" value="{NONCE}"></form>'.encode()
    if rest == 'wp-admin/admin-ajax.php' and action == 'advanced_search':
        if NONCE.encode() not in body:
            return 403, 'text/plain', b'bad nonce'
        return 200, html, f'<div><a href="{work}"><img src="{BASE}/img/cover.png"></a></div>'.encode()
    if rest == 'wp-admin/admin-ajax.php' and action == 'chapter_list':
        if query.get('manga_id') != [str(WORK['id'])]:
            return 200, html, b'<div></div>'
        rows = ''.join(f'<div><a href="{work}chapter-{n}/"><span>Chapter {n}</span>'
                       f'<time datetime="2026-0{n}-01T00:00:00Z"></time></a></div>'
                       for n in range(CHAPTERS, 0, -1))
        return 200, html, rows.encode()
    if rest == 'wp-json/wp/v2/manga':
        found = [manga()] if WORK['slug'] in query.get('slug[]', []) else []
        return 200, 'application/json', json.dumps(found).encode()
    if rest == f'wp-json/wp/v2/manga/{WORK["id"]}':
        return 200, 'application/json', json.dumps(manga()).encode()
    for n in range(1, CHAPTERS + 1):
        if rest == f'manga/{WORK["slug"]}/chapter-{n}/':
            images = ''.join(f'<img src="{BASE}/img/{n}-{p}.png">' for p in range(1, PAGES + 1))
            return 200, html, f'<html><body><section data-image-data="1">{images}</section></body></html>'.encode()
    if rest.startswith('img/') and rest.endswith('.png'):
        with open(PAGE, 'rb') as f:
            return 200, 'image/png', f.read()
    return 404, 'text/plain', b'not found'


def make_ca(folder: str) -> ssl.SSLContext:
    """A test CA and a certificate for HOSTS from it (openssl), and the CA as a PKCS12 trust store for the JVM."""
    os.makedirs(folder, exist_ok=True)
    path = lambda name: os.path.join(folder, name)  # noqa: E731
    run = lambda *args: subprocess.run(['openssl', *args], check=True, capture_output=True)  # noqa: E731
    ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes']
    run('req', '-x509', *ec, '-keyout', path('ca.key'), '-out', path('ca.pem'), '-days', '2',
        '-subj', '/CN=chimimouryou E2E CA', '-addext', 'basicConstraints=critical,CA:TRUE',
        '-addext', 'keyUsage=critical,keyCertSign')
    run('req', '-x509', *ec, '-keyout', path('site.key'), '-out', path('site.pem'), '-days', '2',
        '-CA', path('ca.pem'), '-CAkey', path('ca.key'), '-subj', '/CN=rawkuma.net',
        '-addext', 'subjectAltName=' + ','.join(f'DNS:{host}' for host in sorted(HOSTS)))
    # -jdktrust marks the certificate trusted the way Java's keytool does (a trust store, not a key store).
    run('pkcs12', '-export', '-nokeys', '-in', path('ca.pem'), '-out', path('ca.p12'),
        '-passout', f'pass:{TRUST_PASSWORD}', '-jdktrust', 'anyExtendedKeyUsage')
    context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    context.load_cert_chain(path('site.pem'), path('site.key'))
    return context


def pipe(src: socket.socket, dst: socket.socket):
    try:
        while data := src.recv(65536):
            dst.sendall(data)
    except OSError:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass


class Proxy(socketserver.StreamRequestHandler):
    context: ssl.SSLContext

    def handle(self):
        import serve  # here: serve.py imports this module
        parts = self.rfile.readline().decode('latin-1').split()
        while self.rfile.readline() not in (b'\r\n', b'\n', b''):
            pass
        if len(parts) < 2 or parts[0] != 'CONNECT':
            self.wfile.write(b'HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n')
            return
        host, _, port = parts[1].rpartition(':')
        if host in HOSTS:
            self.wfile.write(b'HTTP/1.1 200 Connection established\r\n\r\n')
            self.wfile.flush()
            try:
                tls = self.context.wrap_socket(self.connection, server_side=True)
            except (ssl.SSLError, OSError):
                return

            class Site(serve.Handler):
                def parse_request(self):  # serve.py's paths start with the host
                    ok = super().parse_request()
                    self.path = f'/{host}{self.path}'
                    return ok

            Site(tls, self.client_address, self.server)
            return
        try:
            remote = socket.create_connection((host, int(port)), timeout=30)
        except (OSError, ValueError):
            self.wfile.write(b'HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')
            return
        remote.settimeout(None)
        self.wfile.write(b'HTTP/1.1 200 Connection established\r\n\r\n')
        self.wfile.flush()
        threading.Thread(target=pipe, args=(remote, self.connection), daemon=True).start()
        pipe(self.connection, remote)


if __name__ == '__main__':
    sys.path.insert(0, HERE)
    Proxy.context = make_ca(sys.argv[1])
    server = socketserver.ThreadingTCPServer(('127.0.0.1', 0), Proxy)
    server.daemon_threads = True
    print(f'proxy {server.server_address[1]}', flush=True)
    server.serve_forever()
