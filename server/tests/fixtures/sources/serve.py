#!/usr/bin/env python3
"""A fake Syosetu and Kakuyomu over the saved fixtures, so tests and the test stack never reach the real site, and
a fake OPDS catalog and Suwayomi (servers.py) at /opds/ and /suwayomi/.

The import service sends every source request here when SOURCES_FIXTURE_URL is set (fetcher.py): the original
host becomes the first path part, e.g. http://127.0.0.1:8799/ncode.syosetu.com/n0001aa/5/.
  python3 serve.py [port]       (default 8799, 127.0.0.1 only)
https://repo.example/ is an extension repository (extensions/index.json, the extensions) with test pages for the
fetch proxy (headers, slow, to/<host>).
/fake-set changes it while it runs: s1, chapters (servers.py), work + chapters (a copy of n0001aa with that many
chapters), cors=1|0, ext=<version> (every extension's version in index.json). example.com, example.org and
example.net serve the Kakuyomu, Syosetu and Syosetu API pages (extensions on sites that aren't built in).
https://repo.example/manatan/manga.min.json is a Manatan repository and mokuro.moe an invented Mokuro catalog
(manatan.py). https://repo.example/mihon/index.pb is a Mihon repository and rawkuma.net an invented site its jar
reads (mihon.py, which is also the desktop E2E's https proxy).
"""
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import manatan
import mihon
import servers

HERE = os.path.dirname(os.path.abspath(__file__))
# Copies of work n0001aa with a chapter count the app's tests and E2E change (/fake-set?work=n0003cc&chapters=62).
WORKS: dict[str, int] = {}
# Requests for the extension repository's index.json (the fetch proxy's index cache).
INDEX_HITS = {'count': 0}
# CORS headers on every answer (/fake-set?cors=1): the standalone app in a plain browser can read the fake sites.
CORS = {'on': False}
# /fake-set?ext=<version>: index.json lists that version for every extension (the app's Update).
EXT_VERSION = {'v': ''}
# Extension fixtures on hosts that aren't built-in sites (the app runs only those): the same pages.
ALIASES = {'example.com': 'kakuyomu.jp', 'example.org': 'ncode.syosetu.com', 'example.net': 'api.syosetu.com'}
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


def answer(path: str, query: dict, cookie: str, referer: str = '') -> tuple[int, str, bytes | str]:
    """(status, content type or Location, body) for a request to the fake site."""
    host, _, rest = path.lstrip('/').partition('/')
    host = ALIASES.get(host, host)
    if host == 'kakuyomu.jp':
        return kakuyomu(rest, query)
    if host == 'cdn.kdkw.jp' and rest.startswith('referer/'):  # like manga CDNs: images only with the site's Referer
        if not referer.startswith('https://kakuyomu.jp'):
            return 403, 'text/plain', b'forbidden'
        rest = rest.replace('referer/', 'page/', 1)
    if host == 'cdn.kdkw.jp':
        return (200, 'image/png', read('cover.png', KAKUYOMU)) if rest.endswith('.png') else \
            (200, 'text/html', b'<html><script>alert(1)</script></html>')
    if host == 'api.syosetu.com' and 'ncode' not in query:  # search
        return 200, 'application/json; charset=UTF-8', read('api-search.json')
    if host == 'api.syosetu.com':
        ncode = query.get('ncode', [''])[0].lower()
        if ncode in WORKS:
            work = json.loads(read('api-n0001aa.json'))
            work[1].update(general_all_no=WORKS[ncode], ncode=ncode.upper(), title=f"{work[1]['title']} {ncode}")
            return 200, 'application/json; charset=UTF-8', json.dumps(work).encode()
        name = f'api-{ncode}.json' if os.path.exists(os.path.join(ROOT, f'api-{ncode}.json')) else 'api-empty.json'
        return 200, 'application/json; charset=UTF-8', read(name)
    if host not in ('ncode.syosetu.com', 'novel18.syosetu.com'):
        return 404, 'text/plain', b'not found'
    # Like the real site: R18 pages without the cookie go to the age check on another host.
    if host == 'novel18.syosetu.com' and 'over18=yes' not in cookie:
        return 302, f'https://nl.syosetu.com/redirect/ageauth/?url={path}', b''
    if (copy := rest.split('/')[0]) in WORKS:
        rest = rest.replace(copy, 'n0001aa', 1)
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
        if first == 'fake-set':  # the test stack's E2E reorders feeds: /fake-set?s1=1,4,2,3&chapters=1,2,13,3
            query = parse_qs(url.query)
            if 's1' in query:
                servers.VOLUMES['s1'] = [int(n) for n in query['s1'][0].split(',')]
            if 'work' in query:
                WORKS[query['work'][0]] = int(query['chapters'][0])
            elif 'chapters' in query:
                servers.CHAPTERS['order'] = [int(n) for n in query['chapters'][0].split(',')]
            if 'cors' in query:
                CORS['on'] = query['cors'][0] == '1'
            if 'ext' in query:
                EXT_VERSION['v'] = query['ext'][0]
            status, kind, body = 200, 'text/plain', b'ok'
        elif first == 'opds':
            status, kind, body = servers.opds(rest, parse_qs(url.query), self.headers.get('Authorization', ''))
        elif first == 'suwayomi':
            status, kind, body = servers.suwayomi(rest, parse_qs(url.query))
        elif first == 'repo.example' and rest.startswith('mihon/'):  # a Mihon repository (mihon.py)
            status, kind, body = mihon.repo(rest[len('mihon/'):])
        elif first == 'rawkuma.net':  # the site its jar reads (mihon.py)
            status, kind, body = mihon.rawkuma(rest, parse_qs(url.query), getattr(self, 'body', b''))
        elif first == 'repo.example' and rest.startswith('manatan/'):  # a Manatan repository (manatan.py)
            status, kind, body = manatan.repo(rest[len('manatan/'):])
        elif first == 'repo.example':  # an extension repository: index.json, the extensions, and test pages
            status, kind, body = self.repo(rest)
        elif first == 'mokuro.moe':  # an invented Mokuro catalog, CBZs in byte ranges (manatan.py)
            status, kind, body, self.extra = manatan.mokuro(rest, self.headers.get('Range', ''))
        else:
            status, kind, body = answer(url.path, parse_qs(url.query), self.headers.get('Cookie', ''),
                                        self.headers.get('Referer', ''))
        self.send_response(status)
        self.send_header('Location' if status == 302 else 'Content-Type', kind)
        if CORS['on']:
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Expose-Headers', 'Content-Range')
        if status == 401:
            self.send_header('WWW-Authenticate', 'Basic realm="fake"')
        for name, value in getattr(self, 'extra', {}).items():
            self.send_header(name, value)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def repo(self, rest: str) -> tuple[int, str, bytes]:
        if rest == 'index.json':
            INDEX_HITS['count'] += 1
        if rest == 'headers':  # what the fetch proxy sent, and a cookie it must not pass on
            self.extra = {'Set-Cookie': 'session=site'}
            return 200, 'text/html', json.dumps(dict(self.headers)).encode()
        if rest == 'slow':
            time.sleep(0.5)
            return 200, 'text/plain', b'slow'
        if rest.startswith('to/'):  # a redirect to https://<rest>
            return 302, f'https://{rest[3:]}', b''
        path = os.path.join(HERE, 'extensions', os.path.basename(rest))
        if rest == 'index.json' and EXT_VERSION['v']:
            entries = json.loads(read(path, HERE))
            for entry in entries:
                entry['version'] = EXT_VERSION['v']
            return 200, 'application/json', json.dumps(entries).encode()
        if os.path.isfile(path):
            return 200, 'application/json' if rest.endswith('.json') else 'text/javascript', read(path, HERE)
        return 404, 'text/plain', b'not found'

    def do_POST(self):  # noqa: N802 - rawkuma.net's search form (mihon.py)
        self.body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        self.do_GET()

    def do_OPTIONS(self):  # noqa: N802 - CORS preflight (a server's Basic credentials)
        self.send_response(204 if CORS['on'] else 405)
        if CORS['on']:
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Headers', 'Authorization')
        self.end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8799), Handler).serve_forever()
