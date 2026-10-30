#!/usr/bin/env python3
"""Output snapshot of the difficulty service: every file it writes for a library and its answers to the
admin requests, as JSON on stdout. Run it with the difficulty image built before and after a change to
the service and diff the two files; a refactor must leave them equal. Run it twice on one image first:
anything that differs there is not deterministic and needs normalizing below.

    docker run --rm -i -v "$DATA_PATH:/data:ro" -v "$LIBRARY_PATH:/library:ro" -v "$VN_PATH:/vn:ro" \\
      ebook-reader-difficulty:local /opt/venv/bin/python - < scripts/check-difficulty-output.py > a.json

It reads the install's catalog, library, text copies and mokuro text (the service's defaults under
/data) and writes only to a throwaway state folder, with a copy of the installed frequency list
(mtime kept, so the packs' key is the same). Steps: `service.py compute` (all books), then `serve` on
loopback: GET words/ID for every catalog book, POST readings/ID for every book until ready or
unavailable, POST ranks, then the admin paths (POST dictionary with the bundled list, a generated term
dictionary installed and removed, a compute cancelled at once), GET status after each.
Manifest: per file, the sha256 of its content (gzip files decompressed: their header has the write
time), except reader.ygp (not byte-stable; reader.ygp.key is); `computedAt` dropped from difficulty.json and `started`/`finished` from job statuses.
The manifest stays on the machine that made it: it is derived from the library's books. Standard library only.
"""
import gzip
import hashlib
import http.client
import io
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import zipfile

SERVICE = os.environ.get('SERVICE', '/app/jiten/service.py')
SOURCE = os.environ.get('FREQUENCY_SOURCE', '/data/state/difficulty/frequency-dictionary.zip')
BUNDLED = os.path.join(os.path.dirname(SERVICE), 'data', 'jiten_freq_global.zip')
CATALOG = os.environ.get('CALIBRE_CATALOG', '/data/state/catalog/catalog.json')
PORT = 18765
HEADERS = {'Host': 'localhost', 'Origin': 'https://localhost', 'X-Account-Admin': '1'}


def log(*args):
    print(*args, file=sys.stderr, flush=True)


def call(method, path, body=b'', content_type='application/json'):
    conn = http.client.HTTPConnection('127.0.0.1', PORT, timeout=300)
    try:
        headers = {**HEADERS, 'X-Internal-Token': TOKEN}
        if method == 'POST':
            headers.update({'Content-Length': str(len(body)), 'Content-Type': content_type})
        conn.request(method, path, body if method == 'POST' else None, headers)
        response = conn.getresponse()
        data = response.read()
    finally:
        conn.close()
    if response.getheader('Content-Encoding') == 'gzip':
        data = gzip.decompress(data)
    try:
        return response.status, json.loads(data)
    except ValueError:
        return response.status, None


def status():
    code, body = call('GET', '/status')
    if isinstance(body, dict) and body.get('job'):
        body['job'] = {k: v for k, v in body['job'].items() if k not in ('started', 'finished')}
    return code, body


def term_dictionary() -> bytes:
    """A small Yomitan term dictionary: two-kanji terms read with two kana (term_readings keeps them)."""
    kanji = '一二三四五六七八九十山川田日月火水木金土上下中大小人口目手足耳石花草竹糸'
    rows = [[a + b, 'あい', '', '', 0, ['x'], 0, ''] for a in kanji for b in kanji]
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as archive:
        archive.writestr('index.json', json.dumps({'title': 'snapshot terms', 'format': 3, 'revision': '1'}))
        archive.writestr('term_bank_1.json', json.dumps(rows, ensure_ascii=False))
    return out.getvalue()


def digest(path: str):
    opener = gzip.open if path.endswith('.gz') else open
    with opener(path, 'rb') as f:
        data = f.read()
    if os.path.basename(path) == 'difficulty.json':
        results = json.loads(data)
        for estimate in results.get('books', {}).values():
            estimate.pop('computedAt', None)
        data = json.dumps(results, sort_keys=True).encode()
    return hashlib.sha256(data).hexdigest()


def manifest(state: str) -> dict:
    # reader.ygp differs between two builds from the same inputs (yurigana's Reader.save); its .key names them.
    return {os.path.relpath(os.path.join(path, name), state): digest(os.path.join(path, name))
            for path, _, names in sorted(os.walk(state)) for name in sorted(names) if name != 'reader.ygp'}


def until(predicate, seconds, step=1.0):
    deadline = time.monotonic() + seconds
    while True:
        value = predicate()
        if value or time.monotonic() > deadline:
            return value
        time.sleep(step)


root = tempfile.mkdtemp()
state = os.path.join(root, 'difficulty')
os.makedirs(state)
shutil.copy2(SOURCE, os.path.join(state, 'frequency-dictionary.zip'))
TOKEN = 'snapshot-token'
with open(os.path.join(root, 'token'), 'w') as f:
    f.write(TOKEN)
env = {**os.environ, 'JITEN_STATE_DIR': state, 'INTERNAL_TOKEN_FILE': os.path.join(root, 'token'),
       'JITEN_PORT': str(PORT), 'JITEN_HOST': '127.0.0.1', 'JITEN_WORKERS': os.environ.get('JITEN_WORKERS', '2')}
python = sys.executable
with open(CATALOG, encoding='utf-8') as f:
    ids = sorted(b['id'] for b in json.load(f)['books'])
out = {'steps': {}}

log('compute (all books)...')
subprocess.run([python, '-W', 'ignore', SERVICE, 'compute'], env=env, check=True)

log('serve...')
server = subprocess.Popen([python, '-W', 'ignore', SERVICE, 'serve'], env=env)
try:
    def listening():
        try:
            socket.create_connection(('127.0.0.1', PORT), timeout=1).close()
            return True
        except OSError:
            return False
    if not until(listening, 60, 0.2):
        sys.exit('the service did not start')
    out['steps']['status'] = status()
    words = {}
    for book_id in ids:
        code = until(lambda: (c := call('GET', f'/words/{book_id}')[0]) != 503 and c, 300)
        words[book_id] = code
        log(f'words/{book_id}: {code}')
    out['steps']['words'] = words
    readings = {}
    for book_id in ids:
        answer = until(lambda: (s := call('POST', f'/readings/{book_id}')[1].get('status')) != 'queued' and s, 300)
        readings[book_id] = answer
        log(f'readings/{book_id}: {answer}')
    out['steps']['readings'] = readings
    out['files'] = manifest(state)
    out['steps']['ranks'] = call('POST', '/ranks', json.dumps({'forms': ['猫', '魔法', '事', 'ある', 'zz']}).encode())
    with open(BUNDLED, 'rb') as f:
        out['steps']['dictionary'] = call('POST', '/dictionary', f.read(), 'application/zip')
    out['steps']['dictionary'][1].pop('job', None)
    out['steps']['terms'] = call('POST', '/terms?name=snapshot-terms', term_dictionary(), 'application/zip')
    out['steps']['status after terms'] = status()
    out['steps']['terms/remove'] = call('POST', '/terms/remove', b'{"name": "snapshot-terms"}')
    out['steps']['status after remove'] = status()
    out['steps']['compute'] = call('POST', '/compute', json.dumps({'ids': ids}).encode())[0]
    out['steps']['cancel'] = call('POST', '/cancel', b'{}')[0]
    until(lambda: 'finished' in (call('GET', '/status')[1].get('job') or {}), 300)
    out['steps']['status after cancel'] = status()
finally:
    server.terminate()
    server.wait()
    shutil.rmtree(root, ignore_errors=True)
json.dump(out, sys.stdout, ensure_ascii=False, indent=1, sort_keys=True)
print()
