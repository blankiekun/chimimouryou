#!/usr/bin/env python3
"""On-demand difficulty estimates for the Calibre library: the fast core (core.py: V98 and a log-rank
histogram from Sudachi's tokens), the character and kanji counts. Word frequencies come from Jiten's
Yomitan frequency list (FREQUENCY_DICTIONARY; the bundled copy in data/ unless an admin replaced it).
A book's word list is made when it is first asked for (GET words/ID), not with its estimate.

Nothing runs until asked: the reader (or the CLI) requests difficulty for chosen books.

HTTP API (bound to localhost, proxied by nginx at /calibre/difficulty/api/):
  GET  status                       progress of the current job
  GET  kanji/ID                     kanji counts of an estimated book (for each reader's own kanji coverage)
  GET  words/ID                     the book's word list: {words: [[form, reading, count, rank, lemma]…] (WORDS_PER_BOOK),
                                    uniqueWords, tokens}, made first if missing (waits up to WORDS_WAIT, else 503)
  GET  readings/ID                  the book's readings file (readings_file.py)
  POST readings/ID                  make it if missing or stale (waits up to READINGS_WAIT): {"status": "ready" | "queued" | "unavailable"}
  POST ranks      {"forms": [...]}  {"ranks": {form: rank}}: the installed frequency list's best rank of each form it lists
                                    (a reader's Anki words and marks met in no book, for words known); read-only, capped
  POST compute    {"ids": [...]}    estimate difficulty for these books ({"all": true} for all without a current estimate)
  POST cancel                       stop the running job
  POST dictionary   body: the zip    install Jiten's frequency list (jiten_freq_global.zip); admins only.
                                    Replacing one needs ?force=1 when its readings disagree (409 with "agreement")
  POST terms?name=NAME  body: zip   install a Yomitan term dictionary (TERM_DICTIONARY_DIR); admins only
  POST terms/remove {"name": NAME}  remove one; admins only
Results are written to RESULTS_PATH, which nginx serves as /calibre/difficulty.json.
Readings files and word lists are made one at a time in processes of their own, never waiting behind an
estimate job.

CLI: service.py serve | compute ID...
"""
import json
import os
import re
import sys
import threading
import urllib.parse
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
# httpbase.py (shared request checks) is in the parent folder: /app in the image, server/ here.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
# The service's modules import each other as modules and read their names at call time (settings.X),
# so a test or a caller sees one copy; none of them imports this file, which runs as __main__.
import httpbase  # noqa: E402
import install  # noqa: E402
import jobs  # noqa: E402
import queues  # noqa: E402
import readerpack  # noqa: E402
import settings  # noqa: E402
import workers  # noqa: E402


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        httpbase.send_json(self, status, body)

    def _action(self):
        return self.path.rstrip('/').rsplit('/', 1)[-1]

    def do_GET(self):
        httpbase.guard(self, self._get)

    def do_POST(self):
        httpbase.guard(self, self._post)

    def _get(self):
        if not httpbase.from_nginx(self.headers, settings.INTERNAL_TOKEN_FILE):
            return self._send(403, {'error': 'Only nginx may call this service'})
        parts = self.path.split('?')[0].strip('/').split('/')
        if parts == ['status']:
            self._send(200, jobs.runner.status())
        elif len(parts) == 2 and parts[0] in ('kanji', 'words', 'readings') and re.fullmatch(r'-?[0-9]+', parts[1]):
            book_id = int(parts[1])
            if parts[0] == 'words':
                path = workers.words_path(book_id)
                status = 'ready' if os.path.exists(path) else queues.word_lists.request(book_id, settings.WORDS_WAIT)
                if status == 'queued':
                    return self._send(503, {'status': 'queued'})
            else:
                path = os.path.join(settings.KANJI_DIR if parts[0] == 'kanji' else settings.READINGS_DIR, f'{book_id}.json.gz')
            try:
                with open(path, 'rb') as f:
                    stat = os.fstat(f.fileno())
                    etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
                    if self.headers.get('If-None-Match') == etag:
                        self.send_response(304)
                        self.send_header('ETag', etag)
                        return self.end_headers()
                    data = f.read()
            except OSError:
                return self._send(404, {'error': f'no {parts[0]} for this book'})
            self.send_response(200)
            self.send_header('ETag', etag)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(data)
        else:
            self._send(404, {'error': 'not found'})

    def _post(self):
        if not httpbase.from_nginx(self.headers, settings.INTERNAL_TOKEN_FILE):
            return self._send(403, {'error': 'Only nginx may call this service'})
        if not httpbase.same_site(self.headers, settings.CORS_ORIGINS, settings.ALLOW_HTTP):
            return self._send(403, {'error': 'Request from another site'})
        parts = self.path.split('?')[0].strip('/').split('/')
        if len(parts) == 2 and parts[0] == 'readings' and re.fullmatch(r'-?[0-9]+', parts[1]):
            return self._send(200, {'status': queues.readings.request(int(parts[1]), settings.READINGS_WAIT)})
        if parts == ['ranks']:
            data = httpbase.read_body(self, settings.MAX_RANKS_BYTES)
            if not data:
                return self._send(400, {'error': 'Empty request'})
            try:
                forms = json.loads(data).get('forms')
            except (ValueError, AttributeError):
                return self._send(400, {'error': 'invalid JSON'})
            if not isinstance(forms, list) or len(forms) > settings.MAX_RANK_FORMS:
                return self._send(400, {'error': 'invalid request'})
            try:
                return self._send(200, {'ranks': readerpack.form_ranks(forms)})
            except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
                return self._send(503, {'error': str(error)})
        if parts == ['dictionary']:
            # nginx sends it from the account check of every location that reaches this path.
            if self.headers.get('X-Account-Admin') != '1':
                return self._send(403, {'error': 'Only admins can install the frequency list'})
            query = self.path.split('?', 1)[1] if '?' in self.path else ''
            try:
                terms = install.install_dictionary(self.rfile, int(self.headers.get('Content-Length') or 0),
                                           force='force=1' in query.split('&'))
            except install.DictionaryMismatch as error:
                return self._send(409, {'error': str(error), 'agreement': error.agreement})
            except RuntimeError as error:
                return self._send(409, {'error': str(error)})
            except ValueError as error:
                return self._send(400, {'error': str(error)})
            return self._send(200, {**jobs.runner.status(), 'terms': terms})
        if parts in (['terms'], ['terms', 'remove']):
            # nginx sends it from the account check of every location that reaches this path.
            if self.headers.get('X-Account-Admin') != '1':
                return self._send(403, {'error': 'Only admins can install term dictionaries'})
            try:
                if parts == ['terms']:
                    query = urllib.parse.parse_qs(self.path.split('?', 1)[1] if '?' in self.path else '')
                    terms = install.install_term_dictionary(self.rfile, int(self.headers.get('Content-Length') or 0),
                                                    (query.get('name') or [''])[0])
                    return self._send(200, {**jobs.runner.status(), 'terms': terms})
                body = json.loads(httpbase.read_body(self, settings.MAX_JSON_BYTES) or b'{}')
                install.remove_term_dictionary(str(body.get('name', '')) if isinstance(body, dict) else '')
                return self._send(200, jobs.runner.status())
            except RuntimeError as error:
                return self._send(409, {'error': str(error)})
            except ValueError as error:
                return self._send(400, {'error': str(error)})
        try:
            body = json.loads(httpbase.read_body(self, settings.MAX_JSON_BYTES) or b'{}')
        except ValueError:
            return self._send(400, {'error': 'invalid JSON'})
        action = self._action()
        try:
            if action == 'compute':
                ids = None if body.get('all') else [int(i) for i in body.get('ids', [])]
                if ids is not None and not ids:
                    return self._send(400, {'error': 'no books given'})
                jobs.runner.start('compute', jobs.runner.compute, ids)
            elif action == 'cancel':
                jobs.runner.cancel.set()
            else:
                return self._send(404, {'error': 'not found'})
        except RuntimeError as error:
            return self._send(409, {'error': str(error)})
        except (AttributeError, TypeError, ValueError):
            return self._send(400, {'error': 'invalid request'})
        self._send(202, jobs.runner.status())

    def log_message(self, *args):
        pass


def main(argv):
    os.makedirs(settings.STATE_DIR, exist_ok=True)
    install.install_bundled_dictionary()
    command = argv[1] if len(argv) > 1 else 'serve'
    if command == 'serve':
        queues.migrate_word_lists()
        threading.Thread(target=jobs.watch_manga_text, daemon=True).start()
        ThreadingHTTPServer((settings.HOST, settings.PORT), Handler).serve_forever()
    elif command == 'compute':
        jobs.runner.job = {'type': 'compute'}
        jobs.runner.compute([int(i) for i in argv[2:]] or None)
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv)
