"""Sources phase 1 (import/sources/): a Syosetu work becomes volumes in Calibre. Run from the repo root:
python3 -m unittest discover -s server/tests

Written before the code (AGENTS.md). The ways each part could fail, and the test that catches it:

Adapter (adapters/syosetu.py)
  A1 a work link in another form (chapter link, no trailing slash, upper-case ncode, info page, R18 host, query)
     isn't recognised, or a look-alike host (ncode.syosetu.com.evil.example, a path that names it) is   -> test_links
  A2 details read the wrong fields: chapter count, ongoing/finished, author, entities left escaped in
     chapter titles, the wrong index page asked for the latest chapters                                -> test_details
  A3 a removed work (API allcount 0) is taken for a work with no chapters                              -> test_removed_work
  A4 R18 works: the over18 cookie isn't sent (the site redirects to an age check on another host),
     the general API is asked instead of novel18api, a short story's text is looked for at /1/      -> test_r18_short_story
  A5 a chapter loses its preface/afterword or their order, drops ruby, or keeps the site's chrome     -> test_chapter
Planner (planner.py)
  P1 an empty volume after an exact multiple of 50, chapters lost or doubled at a boundary, a work with
     no chapters planned as one empty volume                                                           -> test_plan
Build (build.py)
  B1 a chapter's script, event handlers, styles or images reach the book; '&' or an unclosed <p> make the
     XHTML ill-formed (readers then refuse the whole EPUB); ruby lost                                  -> test_clean
  B2 an invalid EPUB: mimetype not first or compressed, OPF/nav not well-formed when the title has
     '&<"', series missing, not vertical right-to-left                                                 -> test_epub
Fetcher (fetcher.py)
  F1 the per-host limit isn't kept across threads, or other hosts wait for it                          -> test_host_interval
  F2 a 429 with Retry-After isn't retried after the wait; an endless retry loop                        -> test_retry_after
  F3 a redirect to another host is followed                                                            -> test_r18_short_story
  F4 a gzip body inflates past the size cap                                                            -> test_size_cap
Service (sources/api.py + service.py)
  S1 volumes reach calibredb without series, index, identifier, tag or the "<work> <vol>" title       -> test_add_work
  S2 "In library" ignores what's in Calibre, so Add offers volumes again                               -> test_add_work
  S3 a failed job's retry fetches its chapters again instead of resuming at the failed one             -> test_retry_resumes
  S4 another account sees, cancels or deletes my jobs                                                  -> test_jobs_are_per_account

Phase 2, follows (written before the code). The ways it could fail:
  T1 the timer checks a paused follow, misses a due one, or checks a work again before its interval (the
     site sees a request every minute)                                                                 -> test_timer
  U1 new chapters of the open volume reach Calibre as a new book (a duplicate, reading data split) instead
     of add_format on its Calibre id; the timestamp isn't bumped, so devices keep their old copy        -> test_update_in_place
  U2 the 51st chapter is lost, goes into the full volume, or starts a new volume before the open one is
     filled to 50                                                                                       -> test_update_in_place
  U3 a full volume is rewritten (highlights there move); the replaced volume's Calibre id changes      -> test_update_in_place
  U4 a check with nothing new rewrites the open volume anyway (every device downloads it again)       -> test_update_in_place
  U5 the follow says "up to date" or "new chapters" after a failed check                              -> test_update_retry
  R1 Check now after a failed update starts over (fetches every chapter again) instead of resuming at the
     failed chapter, or leaves a second job beside the failed one                                      -> test_update_retry
  P1 another account (an admin too) pauses or unfollows my follow                                      -> test_follows_are_per_account
"""
import gzip
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'import'))
sys.path.insert(0, os.path.join(HERE, 'fixtures', 'sources'))
import serve  # noqa: E402
from sources import build, fetcher, planner  # noqa: E402
from sources.adapters import syosetu  # noqa: E402

STATE = tempfile.mkdtemp()
FAKE_CALIBREDB = os.path.join(STATE, 'calibredb')
ADDS = os.path.join(STATE, 'adds.log')
# add_format and set_metadata calls (updates in place).
CALLS = os.path.join(STATE, 'calls.log')
TOKEN_FILE = os.path.join(STATE, 'internal-token')
with open(TOKEN_FILE, 'w') as f:
    f.write('c0ffee\n')
# Each added volume gets the next Calibre id; the EPUB itself is kept for the checks.
with open(FAKE_CALIBREDB, 'w') as f:
    f.write(f"""#!{sys.executable}
import shutil, sys
args = sys.argv[1:]
if 'add' in args:
    log = open({ADDS!r}, 'a+')
    log.seek(0)
    n = 100 + len(log.readlines())
    log.write(repr(args[3:]) + '\\n')
    shutil.copy(args[3], {STATE!r} + f'/added-{{n}}.epub')
    print(f'Added book ids: {{n}}')
elif 'add_format' in args:
    i = args.index('add_format')
    with open({CALLS!r}, 'a') as log:
        log.write(repr(args[i:]) + '\\n')
    shutil.copy(args[i + 2], {STATE!r} + f'/replaced-{{args[i + 1]}}.epub')
elif 'set_metadata' in args:
    with open({CALLS!r}, 'a') as log:
        log.write(repr(args[args.index('set_metadata'):]) + '\\n')
elif 'list' in args:
    print('[{{"id": 100, "title": "x"}}]')
""")
os.chmod(FAKE_CALIBREDB, 0o755)
FAKE_BUILDER = os.path.join(STATE, 'builder')
with open(FAKE_BUILDER, 'w') as f:
    f.write('#!/bin/sh\necho \'{"books": []}\' > "$2"\n')
os.chmod(FAKE_BUILDER, 0o755)

SITE = ThreadingHTTPServer(('127.0.0.1', 0), serve.Handler)
threading.Thread(target=SITE.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()
FIXTURE_URL = f'http://127.0.0.1:{SITE.server_port}'

spec = importlib.util.spec_from_file_location('import_service_sources', os.path.join(HERE, '..', 'import', 'service.py'))
service = importlib.util.module_from_spec(spec)
with mock.patch.dict(os.environ, IMPORT_STATE_DIR=os.path.join(STATE, 'state'), CALIBREDB=FAKE_CALIBREDB,
                     CATALOG_BUILDER=FAKE_BUILDER, CALIBRE_LIBRARY=STATE, CATALOG_OUTPUT=os.path.join(STATE, 'c.json'),
                     MIN_FREE_MB='0', INTERNAL_TOKEN_FILE=TOKEN_FILE, API_DB=os.path.join(STATE, 'library.db')):
    spec.loader.exec_module(service)
# sources.api is shared with test_import_service's copy of the service, which may have imported it first.
service.sources.API_DB = os.path.join(STATE, 'library.db')


def fake_site():
    """The fetcher pointed at the fixture site, with no wait between requests."""
    return mock.patch.multiple(fetcher, FIXTURE_URL=FIXTURE_URL, INTERVAL=0)


class AdapterTest(unittest.TestCase):
    def test_links(self):
        work = 'https://ncode.syosetu.com/n0001aa/'
        for link in ('https://ncode.syosetu.com/n0001aa/', 'http://ncode.syosetu.com/n0001aa',
                     'https://ncode.syosetu.com/N0001AA/12/', 'https://ncode.syosetu.com/n0001aa/?p=2',
                     ' https://ncode.syosetu.com/novelview/infotop/ncode/n0001aa/ '):
            self.assertEqual(syosetu.parse_url(link), ('n0001aa', work), link)
        self.assertEqual(syosetu.parse_url('https://novel18.syosetu.com/n0002bb/3/'),
                         ('n0002bb', 'https://novel18.syosetu.com/n0002bb/'))
        for link in ('https://ncode.syosetu.com.evil.example/n0001aa/', 'https://evil.example/ncode.syosetu.com/n0001aa/',
                     'https://mypage.syosetu.com/288399/', 'javascript:alert(1)//ncode.syosetu.com/n0001aa/',
                     'https://ncode.syosetu.com/', 'n0001aa', ''):
            self.assertIsNone(syosetu.parse_url(link), link)

    def test_details(self):
        requested = []
        real = fetcher.fetch

        def spy(url, *args, **kwargs):
            requested.append(url)
            return real(url, *args, **kwargs)
        with fake_site(), mock.patch.object(fetcher, 'fetch', spy):
            work = syosetu.details('https://ncode.syosetu.com/n0001aa/')
        self.assertEqual((work['title'], work['authors'], work['status'], work['chapters'], work['short']),
                         ('春の手紙　～試験の物語～', '試験作者', 'ongoing', 103, False))
        self.assertEqual(work['latest'][0], {'n': 103, 'title': '第百三話　手紙の&返事', 'date': '2026-10-27'})
        self.assertEqual([c['n'] for c in work['latest']], [103, 102, 101])
        self.assertIn('https://ncode.syosetu.com/n0001aa/?p=2', requested)

    def test_removed_work(self):
        with fake_site(), self.assertRaises(LookupError):
            syosetu.details('https://ncode.syosetu.com/n0009zz/')

    def test_r18_short_story(self):
        with fake_site():
            work = syosetu.details('https://novel18.syosetu.com/n0002bb/')
            self.assertEqual((work['title'], work['chapters'], work['short'], work['status']),
                             ('夜の短編', 1, True, 'finished'))
            chapter = syosetu.chapter('https://novel18.syosetu.com/n0002bb/', 1, short=True)
            self.assertIn('<ruby>長<rt>なが</rt></ruby>', chapter['html'])
            # Without the cookie the fake site sends us to nl.syosetu.com, which must not be followed.
            with self.assertRaises(fetcher.FetchError):
                fetcher.fetch('https://novel18.syosetu.com/n0002bb/', syosetu.HOSTS)

    def test_chapter(self):
        with fake_site():
            chapter = syosetu.chapter('https://ncode.syosetu.com/n0001aa/', 7, short=False)
        self.assertEqual(chapter['title'], '第7話「手紙」')
        html = chapter['html']
        self.assertLess(html.index('前書き'), html.index('7通目'))
        self.assertLess(html.index('7通目'), html.index('後書き'))
        self.assertIn('<rt>しょうじょ</rt>', html)
        self.assertNotIn('gnshbrequest', html)
        self.assertNotIn('ブックマーク', html)


class PlannerTest(unittest.TestCase):
    def test_plan(self):
        self.assertEqual(planner.plan(0), [])
        self.assertEqual(planner.plan(1), [{'number': 1, 'first': 1, 'last': 1}])
        self.assertEqual(planner.plan(50), [{'number': 1, 'first': 1, 'last': 50}])
        self.assertEqual(planner.plan(101), [{'number': 1, 'first': 1, 'last': 50}, {'number': 2, 'first': 51, 'last': 100},
                                             {'number': 3, 'first': 101, 'last': 101}])


class BuildTest(unittest.TestCase):
    def test_clean(self):
        dirty = ('<p>A&amp;B <span style="x" onclick="y">c</span><script>alert(1)</script>'
                 '<a href="//x"><img src="//x/i.jpg"></a><ruby><rb>漢</rb><rp>(</rp><rt>かん</rt><rp>)</rp></ruby>'
                 '<p>unclosed<br><b>bold</i></div>&lt;tag&gt; & bare')
        xhtml = build.clean(dirty)
        ET.fromstring(f'<body xmlns="http://www.w3.org/1999/xhtml">{xhtml}</body>')
        for gone in ('script', 'alert', 'onclick', 'style', '<img', 'href', '<span', '<a'):
            self.assertNotIn(gone, xhtml)
        self.assertIn('<ruby><rb>漢</rb><rp>(</rp><rt>かん</rt><rp>)</rp></ruby>', xhtml)
        self.assertIn('A&amp;B c', xhtml)
        self.assertIn('&lt;tag&gt; &amp; bare', xhtml)

    def test_epub(self):
        path = os.path.join(STATE, 'built.epub')
        build.epub(path, title='A&B <"作品"> 2', authors='著者', series='A&B <"作品">', series_index=2,
                   identifier='chimi:syosetu:n0001aa:2',
                   chapters=[{'title': '第1話 <&>', 'xhtml': build.clean('<p>一</p>')},
                             {'title': '', 'xhtml': build.clean('<p>二<ruby>字<rt>じ</rt></ruby></p>')}])
        with zipfile.ZipFile(path) as archive:
            first = archive.infolist()[0]
            self.assertEqual((first.filename, first.compress_type), ('mimetype', zipfile.ZIP_STORED))
            self.assertEqual(archive.read('mimetype'), b'application/epub+zip')
            container = ET.fromstring(archive.read('META-INF/container.xml'))
            opf_path = container.find('.//{*}rootfile').get('full-path')
            opf = ET.fromstring(archive.read(opf_path))
            self.assertEqual(opf.find('.//{http://purl.org/dc/elements/1.1/}title').text, 'A&B <"作品"> 2')
            metas = {m.get('name'): m.get('content') for m in opf.iter('{http://www.idpf.org/2007/opf}meta')}
            self.assertEqual((metas['calibre:series'], metas['calibre:series_index']), ('A&B <"作品">', '2'))
            self.assertEqual(opf.find('{*}spine').get('page-progression-direction'), 'rtl')
            base = os.path.dirname(opf_path)
            items = {i.get('id'): i for i in opf.iter('{http://www.idpf.org/2007/opf}item')}
            chapters = [items[ref.get('idref')].get('href') for ref in opf.find('{*}spine')]
            self.assertEqual(len(chapters), 2)
            for href in chapters + [i.get('href') for i in items.values() if 'nav' in (i.get('properties') or '')]:
                ET.fromstring(archive.read(f'{base}/{href}' if base else href))
            self.assertIn('<rt>じ</rt>', archive.read(f'{base}/{chapters[1]}' if base else chapters[1]).decode())
            css = b''.join(archive.read(n) for n in archive.namelist() if n.endswith('.css'))
            self.assertIn(b'vertical-rl', css)


class Echo(BaseHTTPRequestHandler):
    """Records each request's time; /<host>/429 answers 429 once (Retry-After: 1), /<host>/gzip-bomb inflates
    to 3 MB."""
    hits: list = []
    seen_429 = False

    def do_GET(self):  # noqa: N802
        Echo.hits.append((self.path, time.monotonic()))
        if self.path.endswith('/429') and not Echo.seen_429:
            Echo.seen_429 = True
            self.send_response(429)
            self.send_header('Retry-After', '1')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        bomb = self.path.endswith('/gzip-bomb')
        body = gzip.compress(b'0' * (3 << 20)) if bomb else b'ok'
        self.send_response(200)
        if bomb:
            self.send_header('Content-Encoding', 'gzip')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


class FetcherTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Echo)
        threading.Thread(target=cls.server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()
        # Fixture mode: https://<host>/<path> goes to <fixture>/<host>/<path>, so hosts can differ.
        cls.patch = mock.patch.multiple(fetcher, FIXTURE_URL=f'http://127.0.0.1:{cls.server.server_port}')
        cls.patch.start()

    @classmethod
    def tearDownClass(cls):
        cls.patch.stop()
        cls.server.shutdown()

    def test_host_interval(self):
        Echo.hits = []
        with mock.patch.object(fetcher, 'INTERVAL', 0.3):
            threads = [threading.Thread(target=fetcher.fetch, args=(f'https://{host}/', {host}))
                       for host in ('a.example', 'a.example', 'a.example', 'b.example')]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        a = sorted(t for path, t in Echo.hits if path.startswith('/a.example'))
        b = [t for path, t in Echo.hits if path.startswith('/b.example')]
        self.assertEqual(len(a), 3)
        self.assertGreaterEqual(a[1] - a[0], 0.28)
        self.assertGreaterEqual(a[2] - a[1], 0.28)
        self.assertLess(b[0] - a[0], 0.25)

    def test_retry_after(self):
        with mock.patch.object(fetcher, 'INTERVAL', 0):
            start = time.monotonic()
            body, _ = fetcher.fetch('https://c.example/429', {'c.example'})
        self.assertEqual(body, b'ok')
        self.assertGreaterEqual(time.monotonic() - start, 0.9)

    def test_size_cap(self):
        with mock.patch.multiple(fetcher, INTERVAL=0, MAX_BYTES=1 << 20), self.assertRaises(fetcher.FetchError):
            fetcher.fetch('https://d.example/gzip-bomb', {'d.example'})


class ServiceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = fake_site()
        cls.site.start()
        os.makedirs(service.queue_dir(), exist_ok=True)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'
        threading.Thread(target=cls.server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()
        threading.Thread(target=service.worker, daemon=True).start()
        service.start_sources()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.site.stop()

    def request(self, method, path, body=None, account='acc1'):
        headers = {'Host': 'reader.example', 'X-Forwarded-Proto': 'https', 'X-Internal-Token': 'c0ffee',
                   'X-Account-Id': account, 'Origin': 'https://reader.example', 'Content-Type': 'application/json'}
        data = json.dumps(body).encode() if body is not None else (b'' if method != 'GET' else None)
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def wait_job(self, job_id, account='acc1', until=('done', 'failed')):
        for _ in range(400):
            _, body = self.request('GET', '/sources/queue', account=account)
            job = next((j for j in body['jobs'] if j['id'] == job_id), None)
            if job and job['state'] in until:
                return job
            time.sleep(0.05)
        self.fail(f'job did not finish: {job}')

    def test_add_work(self):
        status, work = self.request('POST', '/sources/lookup', {'url': 'https://ncode.syosetu.com/n0001aa/5/'})
        self.assertEqual(status, 200, work)
        self.assertEqual([(v['number'], v['first'], v['last'], v['inLibrary']) for v in work['volumes']],
                         [(1, 1, 50, False), (2, 51, 100, False), (3, 101, 103, False)])
        self.assertEqual(self.request('POST', '/sources/lookup', {'url': 'https://example.com/n0001aa/'})[0], 400)
        status, body = self.request('POST', f'/sources/works/{work["id"]}/add', {'volumes': [1, 3]})
        self.assertEqual(status, 200, body)
        job = self.wait_job(body['job']['id'])
        self.assertEqual((job['state'], job['done'], job['total']), ('done', 53, 53), job)

        with open(ADDS) as log:
            adds = [eval(line) for line in log]  # noqa: S307 - the fake calibredb's own repr()
        added = [a for a in adds if 'chimi:syosetu:n0001aa:3' in a]
        self.assertEqual(len(added), 1)
        args = added[0]
        for flag, value in (('--title', '春の手紙　～試験の物語～ 3'), ('--series', '春の手紙　～試験の物語～'),
                            ('--series-index', '3'), ('--tags', 'Syosetu'), ('--authors', '試験作者')):
            self.assertEqual(args[args.index(flag) + 1], value)
        number = 100 + adds.index(args)
        with zipfile.ZipFile(os.path.join(STATE, f'added-{number}.epub')) as archive:
            texts = [n for n in archive.namelist() if n.endswith('.xhtml') and 'nav' not in n]
            self.assertEqual(len(texts), 3)

        # The catalog lists what Calibre holds; until then a volume isn't "in library".
        db = service.sources.database()
        db.transaction(lambda c: c.execute(
            "INSERT INTO books (key, calibre_id, title, unique_title, format, file, updated, rev) "
            "VALUES ('u3', ?, 't', 't3', 'EPUB', 'f', 0, 0)", (number,)))
        _, work = self.request('GET', f'/sources/works/{work["id"]}')
        self.assertEqual([v['inLibrary'] for v in work['volumes']], [False, False, True])
        _, again = self.request('POST', '/sources/works/resolve', {'site': 'syosetu', 'workKey': 'n0001aa'})
        self.assertEqual(again['id'], work['id'])

    def test_retry_resumes(self):
        _, work = self.request('POST', '/sources/lookup', {'url': 'https://ncode.syosetu.com/n0001aa/'}, 'acc2')
        fetched = []
        real = fetcher.fetch

        def failing(url, *args, **kwargs):
            failed = url.endswith('/n0001aa/53/') and url not in fetched
            fetched.append(url)
            if failed:
                raise fetcher.FetchError("ncode.syosetu.com didn't answer (503)")
            return real(url, *args, **kwargs)
        with mock.patch.object(fetcher, 'fetch', failing):
            _, body = self.request('POST', f'/sources/works/{work["id"]}/add', {'volumes': [2]}, 'acc2')
            job = self.wait_job(body['job']['id'], 'acc2')
            self.assertEqual((job['state'], job['failedAt'], job['done']), ('failed', 53, 2), job)
            self.assertIn('503', job['error'])
            self.assertEqual(self.request('POST', f'/sources/jobs/{job["id"]}/retry', {}, 'acc2')[0], 200)
            job = self.wait_job(job['id'], 'acc2')
        self.assertEqual((job['state'], job['done'], job['total']), ('done', 50, 50))
        chapters = [url for url in fetched if '/n0001aa/' in url and '?' not in url and not url.endswith('/n0001aa/')]
        self.assertEqual(chapters.count('https://ncode.syosetu.com/n0001aa/51/'), 1)
        self.assertEqual(chapters.count('https://ncode.syosetu.com/n0001aa/53/'), 2)
        self.assertEqual(len(chapters), 51)

    def test_jobs_are_per_account(self):
        _, work = self.request('POST', '/sources/lookup', {'url': 'https://novel18.syosetu.com/n0002bb/'}, 'acc3')
        _, body = self.request('POST', f'/sources/works/{work["id"]}/add', {'volumes': [1]}, 'acc3')
        job_id = body['job']['id']
        self.wait_job(job_id, 'acc3')
        _, queue = self.request('GET', '/sources/queue', account='acc4')
        self.assertNotIn(job_id, [j['id'] for j in queue['jobs']])
        self.assertEqual(self.request('POST', f'/sources/jobs/{job_id}/cancel', {}, 'acc4')[0], 404)
        self.assertEqual(self.request('DELETE', f'/sources/jobs/{job_id}', None, 'acc4')[0], 404)
        self.assertEqual(self.request('DELETE', f'/sources/jobs/{job_id}', None, 'acc3')[0], 200)
        _, queue = self.request('GET', '/sources/queue', account='acc3')
        self.assertNotIn(job_id, [j['id'] for j in queue['jobs']])

    def fixture_work(self, ncode, chapters):
        """A copy of the n0001aa fixtures as work `ncode` whose chapter count the test changes (set_chapters)."""
        root = tempfile.mkdtemp(dir=STATE)
        for name in os.listdir(serve.ROOT):
            shutil.copy(os.path.join(serve.ROOT, name), os.path.join(root, name.replace('n0001aa', ncode)))
        patch = mock.patch.object(serve, 'ROOT', root)
        patch.start()
        self.addCleanup(patch.stop)
        self.set_chapters(ncode, chapters)
        return f'https://ncode.syosetu.com/{ncode}/'

    def set_chapters(self, ncode, chapters):
        path = os.path.join(serve.ROOT, f'api-{ncode}.json')
        with open(path, encoding='utf-8') as f:
            answer = json.load(f)
        answer[1]['general_all_no'] = chapters
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(answer, f)

    def follow_state(self, work_id, account, until=lambda follow: follow['state'] not in ('', 'checking')):
        for _ in range(400):
            _, body = self.request('GET', '/sources/following', account=account)
            follow = next((f for f in body['follows'] if f['workId'] == work_id), None)
            if follow and until(follow):
                return follow
            time.sleep(0.05)
        self.fail(f'follow did not settle: {follow}')

    def calls(self):
        try:
            with open(CALLS) as log:
                return [eval(line) for line in log]  # noqa: S307 - the fake calibredb's own repr()
        except FileNotFoundError:
            return []

    def adds_of(self, ncode):
        with open(ADDS) as log:
            return [eval(line) for line in log if f':{ncode}:' in line]  # noqa: S307

    def chapters_in(self, epub):
        with zipfile.ZipFile(epub) as archive:
            return len([n for n in archive.namelist() if n.endswith('.xhtml') and 'nav' not in n])

    def test_update_in_place(self):
        url = self.fixture_work('n0003cc', 60)
        _, work = self.request('POST', '/sources/lookup', {'url': url}, 'acc5')
        wid = work['id']
        # Following a work not in the library fetches all of it: Vol. 1 full, Vol. 2 open.
        self.assertEqual(self.request('PUT', f'/sources/follows/{wid}', {}, 'acc5')[0], 200)
        follow = self.follow_state(wid, 'acc5')
        self.assertEqual(follow['state'], 'new', follow)
        self.assertIn('60 new chapters', follow['detail'])
        self.wait_volumes(wid, 2)
        adds = self.adds_of('n0003cc')
        self.assertEqual(len(adds), 2)
        vol1, vol2 = (self.calibre_id(a) for a in adds)

        def check(chapters):
            before = len(self.calls())
            self.set_chapters('n0003cc', chapters)
            self.assertEqual(self.request('POST', '/sources/check', {'work': wid}, 'acc5')[0], 200)
            self.follow_state(wid, 'acc5')
            self.wait_volumes(wid, (chapters + 49) // 50, chapters)
            return self.calls()[before:]

        # Two new chapters: Vol. 2 is replaced on its own Calibre id and its timestamp moves.
        calls = check(62)
        self.assertEqual([c[:2] for c in calls], [['add_format', str(vol2)], ['set_metadata', str(vol2)]], calls)
        self.assertTrue(calls[1][3].startswith('timestamp:'), calls)
        self.assertEqual(self.chapters_in(os.path.join(STATE, f'replaced-{vol2}.epub')), 12)
        self.assertEqual(len(self.adds_of('n0003cc')), 2)
        self.assertIn('2 new chapters, added to Vol. 2', self.follow_state(wid, 'acc5')['detail'])
        # Nothing new: nothing is rewritten.
        self.assertEqual(check(62), [])
        self.assertEqual(self.follow_state(wid, 'acc5')['state'], 'current')
        # Past 100: Vol. 2 filled to 50, chapter 101 starts Vol. 3; Vol. 1 never touched.
        calls = check(101)
        self.assertEqual([c[:2] for c in calls], [['add_format', str(vol2)], ['set_metadata', str(vol2)]], calls)
        self.assertEqual(self.chapters_in(os.path.join(STATE, f'replaced-{vol2}.epub')), 50)
        adds = self.adds_of('n0003cc')
        self.assertEqual([a[a.index('--series-index') + 1] for a in adds], ['1', '2', '3'])
        # Then only Vol. 3 changes: full Vol. 2 stays as it is.
        calls = check(102)
        self.assertEqual({c[1] for c in calls}, {str(self.calibre_id(adds[2]))}, calls)
        _, work = self.request('GET', f'/sources/works/{wid}', account='acc5')
        self.assertEqual([(v['number'], v['first'], v['last']) for v in work['volumes']],
                         [(1, 1, 50), (2, 51, 100), (3, 101, 102)])
        self.assertTrue(work['following'])
        self.assertNotIn(str(vol1), {c[1] for c in self.calls()})

    def calibre_id(self, args):
        """The fake calibredb's id for an add: 100 + its line in the log."""
        with open(ADDS) as log:
            return 100 + [eval(line) for line in log].index(args)  # noqa: S307

    def wait_volumes(self, work_id, count, last=None):
        """Until the work's volumes all have Calibre ids (and the last ends at chapter `last`)."""
        for _ in range(400):
            rows = service.sources.database().query(
                'SELECT number, last_ch, calibre_id FROM work_volumes WHERE work = ? ORDER BY number', (work_id,))
            if (len(rows) == count and all(r['calibre_id'] for r in rows)
                    and (last is None or rows[-1]['last_ch'] == last)):
                return rows
            time.sleep(0.05)
        self.fail(f'volumes: {[dict(r) for r in rows]}')

    def test_update_retry(self):
        url = self.fixture_work('n0004dd', 55)
        _, work = self.request('POST', '/sources/lookup', {'url': url}, 'acc6')
        wid = work['id']
        fetched = []
        real = fetcher.fetch

        def failing(address, *args, **kwargs):
            failed = address.endswith('/n0004dd/53/') and address not in fetched
            fetched.append(address)
            if failed:
                raise fetcher.FetchError("ncode.syosetu.com didn't answer (503)")
            return real(address, *args, **kwargs)
        with mock.patch.object(fetcher, 'fetch', failing):
            self.request('PUT', f'/sources/follows/{wid}', {}, 'acc6')
            follow = self.follow_state(wid, 'acc6')
            self.assertEqual(follow['state'], 'failed', follow)
            self.assertIn('503', follow['detail'])
            self.request('POST', '/sources/check', {'work': wid}, 'acc6')
            follow = self.follow_state(wid, 'acc6', lambda f: f['state'] == 'new')
        self.wait_volumes(wid, 2)
        chapters = [a for a in fetched if '/n0004dd/' in a and '?' not in a and not a.endswith('/n0004dd/')]
        self.assertEqual(chapters.count('https://ncode.syosetu.com/n0004dd/52/'), 1)
        self.assertEqual(chapters.count('https://ncode.syosetu.com/n0004dd/53/'), 2)
        self.assertEqual(len(chapters), 56)
        _, queue = self.request('GET', '/sources/queue', account='acc6')
        self.assertEqual([j['state'] for j in queue['jobs'] if j['workId'] == wid], ['done'])

    def test_timer(self):
        url = self.fixture_work('n0005ee', 3)
        _, work = self.request('POST', '/sources/lookup', {'url': url}, 'acc7')
        wid = work['id']
        sources = service.sources

        def jobs():
            return sources.database().query("SELECT id FROM source_jobs WHERE work = ? AND kind = 'update'", (wid,))
        self.request('PUT', f'/sources/follows/{wid}', {'paused': True}, 'acc7')
        sources.queue_due_checks(sources.now_ms())
        self.assertEqual(jobs(), [])
        self.request('PUT', f'/sources/follows/{wid}', {'paused': False}, 'acc7')
        self.follow_state(wid, 'acc7')
        self.assertEqual(len(jobs()), 1)
        now = sources.now_ms()
        sources.queue_due_checks(now + 3600 * 1000)
        self.assertEqual(len(jobs()), 1)
        self.set_chapters('n0005ee', 4)
        sources.queue_due_checks(now + sources.CHECK_MS + 60 * 1000)
        # The follow reads 'checking' until the volume's import job ends, after the detail is written.
        follow = self.follow_state(wid, 'acc7', lambda f: f['state'] != 'checking' and f['detail'].startswith('1 new chapter'))
        self.assertEqual(follow['state'], 'new')

    def test_follows_are_per_account(self):
        url = self.fixture_work('n0006ff', 2)
        _, work = self.request('POST', '/sources/lookup', {'url': url}, 'acc8')
        wid = work['id']
        self.request('PUT', f'/sources/follows/{wid}', {}, 'acc8')
        self.follow_state(wid, 'acc8')
        # Another reader's pause is their own follow; their unfollow finds nothing of mine.
        self.assertEqual(self.request('PUT', f'/sources/follows/{wid}', {'paused': True}, 'acc9')[0], 200)
        self.assertEqual(self.request('DELETE', f'/sources/follows/{wid}', None, 'acc9')[0], 200)
        self.assertEqual(self.request('DELETE', f'/sources/follows/{wid}', None, 'acc9')[0], 404)
        follow = self.follow_state(wid, 'acc8')
        self.assertFalse(follow['paused'])
        self.assertEqual(self.request('DELETE', f'/sources/follows/{wid}', None, 'acc8')[0], 200)
        _, body = self.request('GET', '/sources/following', account='acc8')
        self.assertEqual(body['follows'], [])


if __name__ == '__main__':
    unittest.main()
