#!/usr/bin/env python3
"""A fake Syosetu over the saved fixtures, so tests and the test stack never reach the real site.

The import service sends every source request here when SOURCES_FIXTURE_URL is set (fetcher.py): the original
host becomes the first path part, e.g. http://127.0.0.1:8799/ncode.syosetu.com/n0001aa/5/.
  python3 serve.py [port]       (default 8799, 127.0.0.1 only)
"""
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'syosetu')


def read(name: str) -> bytes:
    with open(os.path.join(ROOT, name), 'rb') as f:
        return f.read()


def answer(path: str, query: dict, cookie: str) -> tuple[int, str, bytes | str]:
    """(status, content type or Location, body) for a request to the fake site."""
    host, _, rest = path.lstrip('/').partition('/')
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
        status, kind, body = answer(url.path, parse_qs(url.query), self.headers.get('Cookie', ''))
        self.send_response(status)
        self.send_header('Location' if status == 302 else 'Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8799), Handler).serve_forever()
