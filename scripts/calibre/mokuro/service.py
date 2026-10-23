#!/usr/bin/env python3
"""Mokuro OCR for the Calibre library's manga: the text of every speech bubble, which the
manga reader lays over the pages for Yomitan.

Text comes from mokuro (https://github.com/kha-white/mokuro, GPL-3.0), either run here
(the mokuro image; one volume at a time, about 5 s a page on a CPU) or on any other
machine and uploaded as a .mokuro file. Either way it is stored as STATE_DIR/<catalog id>.json,
which nginx serves as /calibre/mokuro/<id>.json.

HTTP API (behind nginx at /calibre/mokuro/api/, accounts with the import permission):
  GET  status                        the running volume, the queue, and whether mokuro is installed
  POST generate  {"ids": [...]}      queue these manga
  POST cancel                        stop the running volume and empty the queue
  POST upload?id=ID   body: .mokuro  store mokuro's output for this book
  POST remove    {"id": ID}          delete a book's text

CLI: service.py serve | generate ID...
Standard library only (mokuro runs as a separate program). Not part of upstream.
"""
import hmac
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

LIBRARY = os.environ.get('CALIBRE_LIBRARY', '/library')
CATALOG_PATH = os.environ.get('CALIBRE_CATALOG', '/data/state/catalog/catalog.json')
STATE_DIR = os.environ.get('MOKURO_STATE_DIR', '/data/state/mokuro')
WORK_DIR = os.path.join(STATE_DIR, 'work')
MOKURO = os.environ.get('MOKURO_BIN', '/opt/mokuro/bin/mokuro')
PORT = int(os.environ.get('MOKURO_PORT', '8768'))
HOST = os.environ.get('MOKURO_HOST', '127.0.0.1')
ALLOW_HTTP = os.environ.get('ALLOW_HTTP_ACCOUNTS') == '1'
# Server connect: the standalone app's origins; nginx's auth check took its bearer token.
CORS_ORIGINS = set(os.environ.get('CORS_ORIGINS', '').split())
INTERNAL_TOKEN_FILE = os.environ.get('INTERNAL_TOKEN_FILE', '/data/state/internal-token')
# As in load-cbz.ts (getMimeTypeFromName): the files the reader shows as pages.
PAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.svg')
MAX_UPLOAD_BYTES = 64 * 1024 * 1024
MAX_PAGES = 5000
MAX_BLOCKS = 1000
MAX_LINES = 100
MAX_LINE = 2000
# A volume that takes longer than this is stuck (300 pages take about half an hour).
VOLUME_TIMEOUT_SECONDS = 6 * 3600


def ocr_path(book_id: int):
    return os.path.join(STATE_DIR, f'{book_id}.json')


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
        raise ValueError('not a number')
    return round(float(value), 1)


def convert(mokuro: dict, source: str) -> dict:
    """mokuro's .mokuro output → what the reader loads: per page its path in the CBZ,
    size and text blocks (box in image pixels). Rejects anything else, since uploads
    come from readers."""
    pages = mokuro.get('pages') if isinstance(mokuro, dict) else None
    if not isinstance(pages, list) or not pages or len(pages) > MAX_PAGES:
        raise ValueError('Not a .mokuro file (no pages)')
    result = []
    for page in pages:
        try:
            width, height = _number(page['img_width']), _number(page['img_height'])
            name = page['img_path']
            blocks = page.get('blocks', [])
            if not isinstance(name, str) or not isinstance(blocks, list) or len(blocks) > MAX_BLOCKS \
                    or width <= 0 or height <= 0:
                raise ValueError
            converted = []
            for block in blocks:
                box = [_number(v) for v in block['box']]
                lines = block['lines']
                if len(box) != 4 or not isinstance(lines, list) or len(lines) > MAX_LINES \
                        or not all(isinstance(line, str) and len(line) <= MAX_LINE for line in lines):
                    raise ValueError
                converted.append({'box': box, 'vertical': bool(block.get('vertical')),
                                  'fontSize': _number(block.get('font_size', 0)), 'lines': lines})
        except (KeyError, TypeError, ValueError):
            raise ValueError('Not a .mokuro file (a page is malformed)') from None
        result.append({'name': re.sub(r'^(\./)+', '', name.replace('\\', '/')), 'width': width,
                       'height': height, 'blocks': converted})
    version = mokuro.get('version')
    return {'source': source, 'mokuro': version if isinstance(version, str) else '',
            'created': int(time.time() * 1000), 'pages': result}


def save_ocr(book_id: int, data: dict):
    os.makedirs(STATE_DIR, exist_ok=True)
    path = ocr_path(book_id)
    with open(path + '.tmp', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(path + '.tmp', path)


def load_manga():
    with open(CATALOG_PATH, encoding='utf-8') as f:
        return {b['id']: b for b in json.load(f)['books']
                if b['format'] in ('CBZ', 'ZIP') and not b.get('vn')}


def page_count(path: str) -> int:
    with zipfile.ZipFile(path) as z:
        return sum(1 for n in z.namelist() if n.lower().endswith(PAGE_EXTENSIONS)
                   and '__MACOSX/' not in n and not n.rsplit('/', 1)[-1].startswith('.'))


class Runner:
    def __init__(self):
        self.lock = threading.Lock()
        self.queue = []
        self.job = None  # {'id', 'title', 'done', 'total', 'started'}
        self.last = None  # the previous volume's outcome
        self.process = None
        self.wake = threading.Event()

    def status(self):
        with self.lock:
            job = dict(self.job) if self.job else None
            if job:
                job['done'] = self._done_pages(job['id'])
            return {'job': job, 'queue': list(self.queue), 'last': self.last,
                    'generator': os.access(MOKURO, os.X_OK)}

    def generate(self, ids):
        if not os.access(MOKURO, os.X_OK):
            raise RuntimeError('mokuro is not installed here: upload .mokuro files made elsewhere')
        manga = load_manga()
        unknown = [i for i in ids if i not in manga]
        if unknown:
            raise ValueError(f'Not manga in the library: {unknown}')
        with self.lock:
            running = self.job['id'] if self.job else None
            self.queue += [i for i in ids if i not in self.queue and i != running]
        self.wake.set()

    def cancel(self):
        with self.lock:
            self.queue = []
            if self.process:
                self.process.kill()

    def _done_pages(self, book_id):
        # mokuro caches each page's result in _ocr/<volume>/... as it goes.
        total = 0
        for _, _, files in os.walk(os.path.join(WORK_DIR, str(book_id), '_ocr')):
            total += sum(1 for f in files if f.endswith('.json'))
        return total

    def run_forever(self):
        while True:
            self.wake.wait()
            with self.lock:
                if not self.queue:
                    self.wake.clear()
                    continue
                book_id = self.queue.pop(0)
            self._run_one(book_id)

    def _run_one(self, book_id):
        error = None
        title = ''
        work = os.path.join(WORK_DIR, str(book_id))
        try:
            book = load_manga().get(book_id)
            if not book:
                raise RuntimeError('no longer in the library')
            title = book['title']
            source = os.path.join(LIBRARY, book['file'])
            with self.lock:
                self.job = {'id': book_id, 'title': title, 'done': 0, 'total': page_count(source),
                            'started': int(time.time() * 1000)}
            shutil.rmtree(work, ignore_errors=True)
            os.makedirs(work)
            # mokuro writes its output next to the volume; the library is read-only.
            volume = os.path.join(work, 'volume.cbz')
            os.symlink(source, volume)
            process = subprocess.Popen(
                [MOKURO, '--disable_confirmation=true', '--legacy_html=false', volume],
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, cwd=work)
            with self.lock:
                self.process = process
            try:
                _, stderr = process.communicate(timeout=VOLUME_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                process.kill()
                raise RuntimeError('mokuro took too long') from None
            if process.returncode:
                raise RuntimeError('cancelled' if process.returncode < 0 else
                                   (stderr.strip().splitlines() or ['mokuro failed'])[-1][-300:])
            with open(os.path.join(work, 'volume.mokuro'), encoding='utf-8') as f:
                save_ocr(book_id, convert(json.load(f), 'server'))
        except (OSError, ValueError, RuntimeError, zipfile.BadZipFile) as err:
            error = str(err)
            print(f'mokuro: {book_id} {title}: {error}', file=sys.stderr)
        finally:
            shutil.rmtree(work, ignore_errors=True)
            with self.lock:
                self.process = None
                self.job = None
                self.last = {'id': book_id, 'title': title, 'error': error,
                             'finished': int(time.time() * 1000)}


runner = Runner()


def read_body(source, length: int) -> bytes:
    if not 0 < length <= MAX_UPLOAD_BYTES:
        raise ValueError('The file is empty or too large')
    data = source.read(length)
    if len(data) != length:
        raise ValueError('Upload incomplete')
    return data


def from_nginx(headers) -> bool:
    """Whether the request carries nginx's internal token (none configured: refuse everything)."""
    try:
        with open(INTERNAL_TOKEN_FILE, encoding='ascii') as f:
            token = f.read().strip()
    except OSError:
        return False
    return bool(token) and hmac.compare_digest(token, headers.get('X-Internal-Token', ''))


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not from_nginx(self.headers):
            return self._send(403, {'error': 'Only nginx may call this service'})
        if urlparse(self.path).path.strip('/') == 'status':
            return self._send(200, runner.status())
        self._send(404, {'error': 'not found'})

    def do_POST(self):
        if not from_nginx(self.headers):
            return self._send(403, {'error': 'Only nginx may call this service'})
        # nginx checks the account; this stops other sites from posting with its cookie.
        scheme = 'http' if ALLOW_HTTP and self.headers.get('X-Forwarded-Proto') == 'http' else 'https'
        token_request = CORS_ORIGINS and self.headers.get('X-Forwarded-Proto') == 'https' and \
            self.headers.get('Authorization', '').lower().startswith('bearer ') and \
            self.headers.get('Origin') in CORS_ORIGINS
        if not token_request and self.headers.get('Origin') != f"{scheme}://{self.headers.get('Host', '')}":
            return self._send(403, {'error': 'Request from another site'})
        url = urlparse(self.path)
        action = url.path.strip('/')
        try:
            body = read_body(self.rfile, int(self.headers.get('Content-Length') or 0))
            if action == 'upload':
                book_id = int(parse_qs(url.query).get('id', [''])[0])
                if book_id not in load_manga():
                    raise ValueError('Not manga in the library')
                try:
                    mokuro = json.loads(body)
                except ValueError:
                    raise ValueError('Not a .mokuro file (not JSON)') from None
                data = convert(mokuro, 'upload')
                save_ocr(book_id, data)
                return self._send(200, {'pages': len(data['pages'])})
            request = json.loads(body)
            if action == 'generate':
                ids = [int(i) for i in request['ids']]
                if not ids:
                    raise ValueError('no books given')
                runner.generate(ids)
            elif action == 'cancel':
                runner.cancel()
            elif action == 'remove':
                try:
                    os.remove(ocr_path(int(request['id'])))
                except FileNotFoundError:
                    pass
            else:
                return self._send(404, {'error': 'not found'})
        except RuntimeError as error:
            return self._send(409, {'error': str(error)})
        except (KeyError, TypeError, ValueError) as error:
            return self._send(400, {'error': str(error) or 'invalid request'})
        self._send(202, runner.status())

    def log_message(self, *args):
        pass


def main(argv):
    os.makedirs(STATE_DIR, exist_ok=True)
    # Left behind by a restart mid-volume.
    shutil.rmtree(WORK_DIR, ignore_errors=True)
    command = argv[1] if len(argv) > 1 else 'serve'
    if command == 'serve':
        threading.Thread(target=runner.run_forever, daemon=True).start()
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    elif command == 'generate':
        for book_id in argv[2:]:
            runner._run_one(int(book_id))
            print(json.dumps(runner.last))
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv)
