#!/usr/bin/env python3
"""A fake Syosetu and Kakuyomu over the saved fixtures, so tests and the test stack never reach the real site, and
a fake OPDS catalog and Suwayomi (servers.py) at /opds/ and /suwayomi/.

The import service sends every source request here when SOURCES_FIXTURE_URL is set (fetcher.py): the original
host becomes the first path part, e.g. http://127.0.0.1:8799/ncode.syosetu.com/n0001aa/5/.
  python3 serve.py [port]       (default 8799, 127.0.0.1 only)
"""
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import servers

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'syosetu')
KAKUYOMU = os.path.join(HERE, 'kakuyomu')


def read(name: str, root: str | None = None) -> bytes:
    with open(os.path.join(root or ROOT, name), 'rb') as f:
        return f.read()


def kakuyomu(rest: str, query: dict) -> tuple[int, str, bytes | str]:
    if rest == 'search':
        q = query.get('q', [''])[0] or query.get('order', [''])[0]
        return 200, 'text/html; charset=utf-8', read('search.html', KAKUYOMU).replace(b'@Q@', q.encode())
    if (match := re.fullmatch(r'works/(\d+)', rest)) and os.path.exists(os.path.join(KAKUYOMU, f'work-{match[1]}.html')):
        return 200, 'text/html; charset=utf-8', read(f'work-{match[1]}.html', KAKUYOMU)
    if match := re.fullmatch(r'works/1177354054000000001/episodes/(1177354054000\d{6})', rest):
        return 200, 'text/html; charset=utf-8', read('episode.html', KAKUYOMU).replace(b'@N@', match[1].encode())
    return 404, 'text/html', b'<html>404</html>'


def answer(path: str, query: dict, cookie: str) -> tuple[int, str, bytes | str]:
    """(status, content type or Location, body) for a request to the fake site."""
    host, _, rest = path.lstrip('/').partition('/')
    if host == 'kakuyomu.jp':
        return kakuyomu(rest, query)
    if host == 'cdn.kdkw.jp':
        return (200, 'image/png', read('cover.png', KAKUYOMU)) if rest.endswith('.png') else \
            (200, 'text/html', b'<html><script>alert(1)</script></html>')
    if host == 'api.syosetu.com' and 'ncode' not in query:  # search
        return 200, 'application/json; charset=UTF-8', read('api-search.json')
    if host == 'api.syosetu.com':
        ncode = query.get('ncode', [''])[0].lower()
        name = f'api-{ncode}.json' if os.path.exists(os.path.join(ROOT, f'api-{ncode}.json')) else 'api-empty.json'
        return 200, 'application/json; charset=UTF-8', read(name)
    if host not in ('ncode.syosetu.com', 'novel18.syosetu.com'):
        return 404, 'text/plain', b'not found'
    # Like the real site: R18 pages without the cookie go to the age check on another host.
    if host == 'novel18.syosetu.com' and 'over18=yes' not in cookie:
        return 302, f'https://nl.syosetu.com/redirect/ageauth/?url={path}', b''
    if match := re.fullmatch(r'(n\w+)/', rest):
        for name in (f'index-{match[1]}.html', f'short-{match[1]}.html'):
            if os.path.exists(os.path.join(ROOT, name)):
                return 200, 'text/html; charset=UTF-8', read(name)
    if (match := re.fullmatch(r'(n\w+)/(\d+)/', rest)) and os.path.exists(
            os.path.join(ROOT, f'chapter-{match[1]}.html')):
        return 200, 'text/html; charset=UTF-8', read(f'chapter-{match[1]}.html').replace(b'@N@', match[2].encode())
    return 404, 'text/plain', b'not found'


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        url = urlparse(self.path)
        first, _, rest = url.path.lstrip('/').partition('/')
        if first == 'opds':
            status, kind, body = servers.opds(rest, parse_qs(url.query), self.headers.get('Authorization', ''))
        elif first == 'suwayomi':
            status, kind, body = servers.suwayomi(rest, parse_qs(url.query))
        else:
            status, kind, body = answer(url.path, parse_qs(url.query), self.headers.get('Cookie', ''))
        self.send_response(status)
        self.send_header('Location' if status == 302 else 'Content-Type', kind)
        if status == 401:
            self.send_header('WWW-Authenticate', 'Basic realm="fake"')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8799), Handler).serve_forever()
