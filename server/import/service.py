#!/usr/bin/env python3
"""Import queue: adds uploaded books to the Calibre library, one at a time.

Runs as the library owner (the import container) on port 8767 behind nginx at
/calibre/import/api/. nginx only passes requests from accounts with the import
permission (auth_request to the account service) and sets X-Account-Id.
This is the only writer of metadata.db, so uploads from several readers are
queued and added by a single worker with `calibredb add`, then the catalog is
rebuilt so the books show up in the library.

  POST add?name=<file name>   body: the file   -> {"job": {...}}
  GET  jobs?ids=a,b                            -> {"jobs": [...]} (own jobs only)
  POST series   {"apply": bool}                -> assign-series.py's plan (admins
       only: X-Account-Admin from the auth response): books without a series put into series, duplicate
       series merged; with apply, metadata.db is backed up, written and the
       catalog rebuilt
  POST catalog                                 -> {"books": n} after a full catalog
       rebuild (admins only)
  POST remove   {"ids": [catalog ids]}         -> {"removed": [...], "failed": [...]}
       (admins only): books go to Calibre's recycle bin (`calibredb remove`), game
       folders (negative ids) are deleted from VN_DIR; then the catalog is rebuilt.
       Books older than 14 days are emptied from the recycle bin daily (expire_trash).

A ZIP holding an ONScripter game (a script such as 0.txt or nscript.dat) is not
added to Calibre: the worker unpacks its game folder into VN_DIR, named after the
uploaded file, where the catalog lists it as a visual novel.

Job states: queued, adding, added (calibreId, title), duplicate, failed (error).
Standard library only. Not part of upstream.
"""
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
import zipfile
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# httpbase.py (shared request checks) is in the parent folder: /app in the images, server/ here.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
import httpbase  # noqa: E402

LIBRARY = os.environ.get('CALIBRE_LIBRARY', '/library')
STATE_DIR = os.environ.get('IMPORT_STATE_DIR', '/data/state/import')
CALIBREDB = os.environ.get('CALIBREDB', 'calibredb')
CATALOG_BUILDER = os.environ.get('CATALOG_BUILDER', '/usr/local/bin/build-calibre-catalog')
CATALOG_OUTPUT = os.environ.get('CATALOG_OUTPUT', '/data/state/catalog/catalog.json')
# Shared with assign-series.py, so only one of them writes metadata.db at a time.
WRITE_LOCK = os.path.join(STATE_DIR, 'calibre-write.lock')
PORT = int(os.environ.get('IMPORT_PORT', '8767'))
HOST = os.environ.get('IMPORT_HOST', '127.0.0.1')
# Same switch as the account service: uploads from plain-HTTP pages too.
ALLOW_HTTP = os.environ.get('ALLOW_HTTP_ACCOUNTS') == '1'
# Server connect: the standalone app's origins; nginx's auth check took its bearer token.
CORS_ORIGINS = httpbase.parse_cors_origins(os.environ.get('CORS_ORIGINS', ''))
# Made by the web container; nginx sends it as X-Internal-Token, so only nginx can call this service.
INTERNAL_TOKEN_FILE = os.environ.get('INTERNAL_TOKEN_FILE', '/data/state/internal-token')

FORMATS = ('epub', 'htmlz', 'txt', 'cbz', 'zip')
# Manga: queued as .cbz, since Calibre would unpack a .zip looking for a book inside.
MANGA_FORMATS = ('cbz', 'zip')
PAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp')
MAX_BYTES = 300 * 1024 * 1024
# Games are much larger than books; ZIP uploads may be this large if they hold one.
MAX_VN_BYTES = 8 * 1024 * 1024 * 1024
VN_DIR = os.environ.get('VN_DIR', '/vn')
# ONScripter scripts, as in build-catalog.py and lib/data/vn.ts.
VN_SCRIPTS = ('0.txt', '00.txt', 'nscr_sec.dat', 'nscript.___', 'nscript.dat', 'onscript.nt2', 'onscript.nt3')
# Kept free when unpacking a game.
MIN_FREE_BYTES = int(os.environ.get('MIN_FREE_MB', '1024')) * 1024 * 1024
MAX_PENDING_PER_ACCOUNT = 100
# A manga file name that is only a volume number (第01巻, Vol.2, 03).
GENERIC_NAME = re.compile(r'(?:[\W\d_]|[第巻話一二三四五六七八九十]|vol(?:ume)?|v|ch(?:apter)?)*', re.I)
# Finished jobs are kept this long so the uploader can read the outcome.
KEEP_FINISHED_SECONDS = 7 * 24 * 3600
ADD_TIMEOUT_SECONDS = 600
WORKER_RETRY_SECONDS = 30
CALIBRE_DEBUG = os.environ.get('CALIBRE_DEBUG', 'calibre-debug')
ASSIGN_SERIES = os.environ.get('ASSIGN_SERIES', '/app/assign-series.py')
series_busy = threading.Lock()
catalog_busy = threading.Lock()

lock = threading.Lock()
work = threading.Condition(lock)
jobs: dict[str, dict] = {}
# Uploads still being received (under lock): bytes per account, so checks count them too.
uploading: dict[str, list[int]] = {}


def queue_dir():
    return os.path.join(STATE_DIR, 'queue')


def jobs_path():
    return os.path.join(STATE_DIR, 'jobs.json')


def save_jobs():
    """Caller holds `lock`."""
    now = time.time()
    for job_id in [i for i, j in jobs.items()
                   if j['state'] in ('added', 'duplicate', 'failed') and now - j['updated'] > KEEP_FINISHED_SECONDS]:
        del jobs[job_id]
    tmp = jobs_path() + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(jobs, f, ensure_ascii=False)
    os.replace(tmp, jobs_path())


def job_file(file: str) -> str:
    """A queued file's job, written beside it so the queue survives losing jobs.json."""
    return os.path.join(queue_dir(), file + '.job')


def write_job_file(job: dict):
    tmp = job_file(job['file']) + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(job, f, ensure_ascii=False)
    os.replace(tmp, job_file(job['file']))


def remove_queued(file: str):
    for path in (os.path.join(queue_dir(), file), job_file(file)):
        try:
            os.remove(path)
        except OSError:
            pass


def recover_queue(loaded: bool) -> int:
    """Queued files missing from jobs get their job back from its .job file; files without one
    are leftovers of an interrupted upload, removed only when jobs.json was read. Caller holds
    `lock` or runs before the worker. Returns the jobs recovered."""
    known = {j['file'] for j in jobs.values()}
    names = set(os.listdir(queue_dir()))
    recovered = 0
    for name in names:
        if name.endswith(('.job', '.tmp')) or name in known:
            continue
        try:
            with open(job_file(name), encoding='utf-8') as f:
                job = json.load(f)
            if job.get('file') != name or not isinstance(job.get('id'), str):
                raise ValueError('job file does not match')
        except (OSError, ValueError):
            if loaded:
                remove_queued(name)
            continue
        job.update(state='queued', updated=time.time())
        jobs[job['id']] = job
        recovered += 1
    # Job files whose upload is gone, and half-written ones.
    for name in names:
        if name.endswith('.tmp') or (name.endswith('.job') and name[:-4] not in names):
            try:
                os.remove(os.path.join(queue_dir(), name))
            except OSError:
                pass
    return recovered


def load_jobs() -> bool:
    """False when jobs.json exists but couldn't be read (a corrupt one is moved aside):
    the queued files are then kept rather than taken for leftovers."""
    try:
        with open(jobs_path(), encoding='utf-8') as f:
            jobs.update(json.load(f))
    except FileNotFoundError:
        pass
    except (OSError, ValueError, TypeError) as error:
        print(f'jobs.json unreadable, queued files kept: {error!r}', file=sys.stderr)
        jobs.clear()
        if not isinstance(error, OSError):
            try:
                os.replace(jobs_path(), f'{jobs_path()}.bad-{int(time.time())}')
            except OSError:
                pass
        return False
    # A job interrupted by a restart is retried.
    for job in jobs.values():
        if job['state'] == 'adding':
            job['state'] = 'queued'
    return True


def clean_name(name: str) -> str:
    """File name without directories or control characters, keeping its extension."""
    name = os.path.basename(name.replace('\\', '/'))
    name = re.sub(r'[\x00-\x1f\x7f]', '', name).strip()
    return name[-200:]


def check_book(path: str, ext: str) -> str:
    """Why the file isn't a usable book, or '' if it is."""
    if os.path.getsize(path) == 0:
        return 'The file is empty'
    if ext in ('epub', 'htmlz', 'cbz'):
        if not zipfile.is_zipfile(path):
            return f'Not a valid {ext.upper()} file'
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
        if ext == 'epub' and 'META-INF/container.xml' not in names:
            return 'Not a valid EPUB file (no META-INF/container.xml)'
        if ext == 'cbz' and not any(n.lower().endswith(PAGE_EXTENSIONS) for n in names):
            return 'Not a manga archive (no images)'
        return ''
    with open(path, 'rb') as f:
        if b'\x00' in f.read(65536):
            return 'Not a text file'
    return ''


def zip_name(info: zipfile.ZipInfo) -> str:
    """A member's path. Japanese archives often hold Shift JIS names without the UTF-8
    flag, which zipfile reads as code page 437."""
    name = info.filename
    if not info.flag_bits & 0x800:
        for encoding in ('utf-8', 'cp932'):
            try:
                name = info.filename.encode('cp437').decode(encoding)
                break
            except UnicodeError:
                pass
    return name.replace('\\', '/')


def vn_root(names: list[str]) -> str | None:
    """The folder holding a game's script ('' or 'Game/'), the shallowest if several."""
    roots = sorted((name[:name.rfind('/') + 1] for name in names
                    if name.rsplit('/', 1)[-1].lower() in VN_SCRIPTS and '__MACOSX/' not in name),
                   key=lambda root: root.count('/'))
    return roots[0] if roots else None


def is_vn_zip(path: str) -> bool:
    try:
        with zipfile.ZipFile(path) as archive:
            return vn_root([zip_name(info) for info in archive.infolist()]) is not None
    except (OSError, zipfile.BadZipFile):
        return False


def vn_title(name: str) -> str:
    """The game's folder name: the uploaded file's name without .zip/.cbz."""
    title = re.sub(r'\.(?:zip|cbz)$', '', name, flags=re.I).strip().lstrip('.')
    return re.sub(r'[/\\:*?"<>|]', '_', title)[:150] or 'game'


def add_vn(job: dict) -> dict:
    """Unpacks a game's folder from a queued ZIP into VN_DIR/<title>."""
    path = os.path.join(queue_dir(), job['file'])
    title = vn_title(job['name'])
    target = os.path.join(VN_DIR, title)
    if os.path.exists(target):
        return {'state': 'duplicate', 'error': 'Already in the visual novel folder'}
    tmp = os.path.join(VN_DIR, f".importing-{job['id']}")
    try:
        with zipfile.ZipFile(path) as archive:
            members = [(zip_name(info), info) for info in archive.infolist() if not info.is_dir()]
            root = vn_root([name for name, _ in members])
            if root is None:
                return {'state': 'failed', 'error': 'No ONScripter game in this ZIP'}
            files = []
            for name, info in members:
                parts = name[len(root):].split('/')
                # Only the game folder; nothing outside it, no macOS metadata.
                if (not name.startswith(root) or '__MACOSX/' in name or parts[-1].startswith('._')
                        or any(part in ('', '.', '..') for part in parts)):
                    continue
                files.append((parts, info))
            needed = sum(info.file_size for _, info in files)
            if needed > shutil.disk_usage(VN_DIR).free - MIN_FREE_BYTES:
                return {'state': 'failed', 'error': 'Not enough free space for this game'}
            for parts, info in files:
                dest = os.path.join(tmp, *parts)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with archive.open(info) as source, open(dest, 'wb') as out:
                    shutil.copyfileobj(source, out, 1 << 20)
        os.rename(tmp, target)
    except (OSError, zipfile.BadZipFile, RuntimeError, zlib.error, EOFError) as error:
        print(f"unpack {job['name']}: {error}", file=sys.stderr)
        return {'state': 'failed', 'error': 'Could not unpack this game'}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return {'state': 'added', 'title': title}


def parse_added_ids(output: str) -> list[int]:
    """Book ids from `calibredb add` output ("Added book ids: 12, 13")."""
    match = re.search(r'Added book ids?:\s*([\d,\s]+)', output)
    return [int(i) for i in re.findall(r'\d+', match.group(1))] if match else []


def book_title(book_id: int) -> str:
    result = subprocess.run(
        [CALIBREDB, '--library-path', LIBRARY, 'list', '--search', f'id:{book_id}',
         '--fields', 'title', '--for-machine'],
        capture_output=True, text=True, timeout=120, check=False)
    try:
        return json.loads(result.stdout)[0]['title']
    except (ValueError, IndexError, KeyError, TypeError):
        return ''


def add_book(job: dict) -> dict:
    """Runs calibredb add for one queued file; returns the fields to update."""
    path = os.path.join(queue_dir(), job['file'])
    command = [CALIBREDB, '--library-path', LIBRARY, 'add', path]
    if path.endswith('.cbz'):  # Comics rarely carry metadata; the queued name is a job id.
        title = job['name'].rsplit('.', 1)[0]
        # 第01巻.cbz in two series' folders would be duplicates: the folder names the series.
        if job.get('folder') and GENERIC_NAME.fullmatch(title):
            title = f"{job['folder']} {title}"
        command += ['--title', title]
    with open(WRITE_LOCK, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        result = subprocess.run(
            command,
            capture_output=True, text=True, timeout=ADD_TIMEOUT_SECONDS, check=False)
    output = f'{result.stdout}\n{result.stderr}'
    ids = parse_added_ids(output)
    if ids:
        return {'state': 'added', 'calibreId': ids[0], 'title': book_title(ids[0])}
    if 'already exist' in output:
        return {'state': 'duplicate', 'error': 'Already in the Calibre library'}
    print(f"calibredb add {job['name']}: {output.strip()[-500:]}", file=sys.stderr)
    return {'state': 'failed', 'error': 'Calibre could not add this file'}


def create_empty_library(library: str = LIBRARY) -> bool:
    """A completely empty LIBRARY_PATH becomes a new Calibre library (calibredb makes metadata.db),
    so a new install needs no hand-run calibredb. Anything else is left alone: a folder with any
    file in it, one this user doesn't own (Docker makes a missing, maybe mistyped, path as root)
    or a read-only one. Returns whether it made the library."""
    try:
        if os.listdir(library):
            return False
        owner = os.stat(library).st_uid
    except OSError as error:
        print(f'LIBRARY_PATH: {error}', file=sys.stderr)
        return False
    if owner != os.getuid() or not os.access(library, os.W_OK):
        print(f'LIBRARY_PATH is an empty folder this service may not write (owner uid {owner}, '
              f'running as uid {os.getuid()}), so no Calibre library was made there. Check the path; '
              'for a new library, create the folder yourself (mkdir) owned by PUID, or run calibredb '
              '(docs/INSTALL.md).', file=sys.stderr)
        return False
    try:
        result = subprocess.run([CALIBREDB, '--library-path', library, 'list'],
                                capture_output=True, text=True, timeout=120, check=False)
    except (OSError, subprocess.SubprocessError) as error:
        print(f'Making a Calibre library in LIBRARY_PATH failed: {error}', file=sys.stderr)
        return False
    if not os.path.exists(os.path.join(library, 'metadata.db')):
        print(f'Making a Calibre library in LIBRARY_PATH failed: {result.stderr.strip()[-500:]}',
              file=sys.stderr)
        return False
    print('=' * 72, file=sys.stderr)
    print('LIBRARY_PATH was an empty folder: made a new, empty Calibre library in it (metadata.db).',
          file=sys.stderr)
    print('Add books with Import in the library. Calibre can open this folder too.', file=sys.stderr)
    print('=' * 72, file=sys.stderr)
    return True


def rebuild_catalog(force=False) -> bool:
    try:
        result = subprocess.run([CATALOG_BUILDER, LIBRARY, CATALOG_OUTPUT] + (['--force'] if force else []),
                                capture_output=True, text=True, timeout=1800, check=False)
    except (OSError, subprocess.SubprocessError) as error:
        print(f'catalog build failed: {error}', file=sys.stderr)
        return False
    if result.returncode:
        print(f'catalog build failed: {result.stderr.strip()[-500:]}', file=sys.stderr)
    return not result.returncode


def run_catalog() -> dict:
    """Admin panel → Tools → Catalog: a full rebuild now, rather than at the next interval."""
    if not catalog_busy.acquire(blocking=False):
        raise ApiError(409, 'The catalog is already being rebuilt')
    try:
        if not rebuild_catalog(force=True):
            raise ApiError(500, 'The catalog build failed; see the import service log')
        with open(CATALOG_OUTPUT, encoding='utf-8') as f:
            books = json.load(f)['books']
    finally:
        catalog_busy.release()
    return {'books': len(books), 'visualNovels': sum(1 for book in books if book.get('vn'))}


def finish_batch():
    """Rebuilds the catalog, then reports books added since the last build as added."""
    rebuild_catalog()
    with lock:
        for job in jobs.values():
            if job['state'] == 'unlisted':
                job.update(state='added', updated=time.time())
        save_jobs()


def worker():
    """Runs the queue; an error (e.g. DATA_PATH full) is logged and retried, never ends it."""
    while True:
        try:
            run_queue()
        except Exception as error:  # noqa: BLE001
            print(f'import worker: {error!r}', file=sys.stderr)
            with lock:  # a job that failed to start is tried again
                for job in jobs.values():
                    if job['state'] == 'adding':
                        job['state'] = 'queued'
            time.sleep(WORKER_RETRY_SECONDS)


def run_queue():
    with lock:
        unlisted = any(j['state'] == 'unlisted' for j in jobs.values())
    if unlisted:
        finish_batch()
    while True:
        with work:
            while not (pending := [j for j in jobs.values() if j['state'] == 'queued']):
                work.wait()
            job = min(pending, key=lambda j: j['created'])
            job.update(state='adding', updated=time.time())
            save_jobs()
        try:
            update = add_vn(job) if job.get('kind') == 'vn' else add_book(job)
        except Exception as error:  # noqa: BLE001 - one bad file must not end the worker
            print(f"add {job['name']}: {error!r}", file=sys.stderr)
            update = {'state': 'failed', 'error': 'Calibre could not add this file'}
        remove_queued(job['file'])
        with lock:
            job.update(update, updated=time.time())
            # Added books stay "unlisted" until the catalog, rebuilt once per batch, lists them.
            if job['state'] == 'added':
                job['state'] = 'unlisted'
            batch_done = not any(j['state'] == 'queued' for j in jobs.values()) and \
                any(j['state'] == 'unlisted' for j in jobs.values())
            save_jobs()
        if batch_done:
            finish_batch()


def vn_folder_id(name: str) -> int:
    """build-catalog.py's id for a game folder."""
    return -(zlib.crc32(name.encode()) & 0x7fffffff) or -1


def remove_books(ids: list[int]) -> dict:
    """Library select mode → Delete (admins): takes books and games out of the library."""
    removed, failed = [], []
    books = [i for i in ids if i > 0]
    if books:
        with open(WRITE_LOCK, 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            # No --permanent: Calibre keeps them in its recycle bin (.caltrash) for a while.
            result = subprocess.run(
                [CALIBREDB, '--library-path', LIBRARY, 'remove', ','.join(map(str, books))],
                capture_output=True, text=True, timeout=ADD_TIMEOUT_SECONDS, check=False)
        if result.returncode:
            print(f'calibredb remove: {result.stderr.strip()[-500:]}', file=sys.stderr)
            failed += books
        else:
            removed += books
    games = {i for i in ids if i < 0}
    if games and os.path.isdir(VN_DIR):
        for entry in os.scandir(VN_DIR):
            try:
                if entry.name.startswith('.') or vn_folder_id(entry.name) not in games:
                    continue
            except UnicodeEncodeError:  # a non-UTF-8 name: never in the catalog
                continue
            games.discard(vn_folder_id(entry.name))
            try:
                if entry.is_symlink() or not entry.is_dir():
                    raise OSError('not a folder')
                shutil.rmtree(entry.path)
                removed.append(vn_folder_id(entry.name))
            except OSError as error:
                print(f'remove game {entry.name}: {error}', file=sys.stderr)
                failed.append(vn_folder_id(entry.name))
    failed += sorted(games)
    if removed:
        rebuild_catalog()
    return {'removed': removed, 'failed': failed}


def expire_trash():
    """Calibre empties its recycle bin of books older than 14 days (the library's
    expire_old_trash_after) only while something opens the library; do it daily."""
    while True:
        try:
            with open(WRITE_LOCK, 'a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                result = subprocess.run(
                    [CALIBRE_DEBUG, '-c',
                     f'from calibre.library import db; db({LIBRARY!r}).new_api.expire_old_trash()'],
                    capture_output=True, text=True, timeout=ADD_TIMEOUT_SECONDS, check=False)
            if result.returncode:
                print(f'expire trash: {result.stderr.strip()[-500:]}', file=sys.stderr)
        except (OSError, subprocess.SubprocessError) as error:
            print(f'expire trash: {error}', file=sys.stderr)
        time.sleep(24 * 3600)


def run_series(apply: bool) -> dict:
    """Runs assign-series.py through Calibre's Python; it takes the write lock itself."""
    if not series_busy.acquire(blocking=False):
        raise ApiError(409, 'A series check is already running')
    try:
        result = subprocess.run(
            [CALIBRE_DEBUG, '-e', ASSIGN_SERIES, '--', '--json'] + (['--apply'] if apply else []),
            capture_output=True, text=True, timeout=ADD_TIMEOUT_SECONDS, check=False)
    except subprocess.TimeoutExpired as error:
        raise ApiError(500, 'The series check took too long; see the import service log') from error
    finally:
        series_busy.release()
    try:
        report = json.loads(result.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError) as error:
        print(f'assign-series: {result.stderr.strip()[-500:]}', file=sys.stderr)
        raise ApiError(500, 'The series check failed; see the import service log') from error
    if report.get('written'):
        threading.Thread(target=rebuild_catalog, daemon=True).start()
    return report


def public_job(job: dict) -> dict:
    # Added books count as "adding" until the catalog lists them.
    state = 'adding' if job['state'] == 'unlisted' else job['state']
    return {key: job[key] for key in ('id', 'name', 'calibreId', 'title', 'error') if key in job} | {'state': state}


ApiError = httpbase.HttpError


class Handler(BaseHTTPRequestHandler):
    server_version = 'calibre-import'
    sys_version = ''

    def account(self) -> str:
        account = self.headers.get('X-Account-Id', '')
        if not account:
            raise ApiError(401, 'Sign in to add books to Calibre')
        return account

    def require_admin(self):
        self.account()
        if self.headers.get('X-Account-Admin') != '1':
            raise ApiError(403, 'Only admins can do this')

    def send(self, status: int, body: dict):
        httpbase.send_json(self, status, body)

    def handle_api(self, handler):
        self.send(200, handler())

    def do_GET(self):  # noqa: N802
        httpbase.guard(self, self.get)

    def do_POST(self):  # noqa: N802
        httpbase.guard(self, self.post)

    def get(self):
        url = urlparse(self.path)
        if not httpbase.from_nginx(self.headers, INTERNAL_TOKEN_FILE):
            return self.send(403, {'error': 'Only nginx may call this service'})
        if url.path != '/jobs':
            return self.send(404, {'error': 'not found'})

        def list_jobs():
            account = self.account()
            ids = set(','.join(parse_qs(url.query).get('ids', [])).split(','))
            with lock:
                return {'jobs': [public_job(j) for i, j in jobs.items() if i in ids and j['account'] == account]}

        self.handle_api(list_jobs)

    def post(self):
        url = urlparse(self.path)
        # Not url.path: urlparse drops ';params', so '/series;x' would count as '/series'.
        path = self.path.split('?', 1)[0]
        if not httpbase.from_nginx(self.headers, INTERNAL_TOKEN_FILE):
            return self.send(403, {'error': 'Only nginx may call this service'})
        if path == '/add':
            return self.handle_api(lambda: self.add(url))
        if path == '/series':
            return self.handle_api(self.series)
        if path == '/catalog':
            return self.handle_api(self.catalog)
        if path == '/remove':
            return self.handle_api(self.remove)
        return self.send(404, {'error': 'not found'})

    def same_origin(self):
        if not httpbase.same_site(self.headers, CORS_ORIGINS, ALLOW_HTTP):
            raise ApiError(403, 'Request from another site')

    def series(self):
        self.require_admin()
        self.same_origin()
        try:
            body = json.loads(httpbase.read_body(self, 1024) or b'{}')
            if not isinstance(body, dict):
                raise ValueError
        except ValueError as error:
            raise ApiError(400, 'Invalid request') from error
        return run_series(bool(body.get('apply')))

    def catalog(self):
        self.require_admin()
        self.same_origin()
        return run_catalog()

    def remove(self):
        self.require_admin()
        self.same_origin()
        try:
            ids = json.loads(httpbase.read_body(self, 1 << 16))['ids']
            if not isinstance(ids, list) or not all(type(i) is int and i for i in ids):
                raise ValueError
        except (ValueError, KeyError, TypeError) as error:
            raise ApiError(400, 'Invalid request') from error
        return remove_books(ids)

    def add(self, url):
        account = self.account()
        self.same_origin()
        name = clean_name(parse_qs(url.query).get('name', [''])[0])
        ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
        if ext not in FORMATS:
            raise ApiError(400, 'Only EPUB, HTMLZ, TXT, CBZ and ZIP files can be added')
        if ext in MANGA_FORMATS:
            ext = 'cbz'
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError as error:
            raise ApiError(400, 'Invalid request') from error
        if length <= 0:
            raise ApiError(400, 'The file is empty')
        if length > (MAX_VN_BYTES if ext == 'cbz' else MAX_BYTES):
            raise ApiError(413, 'The file is too large')
        with lock:
            pending = len(uploading.get(account, [])) + sum(
                1 for j in jobs.values() if j['account'] == account and j['state'] in ('queued', 'adding'))
            if pending >= MAX_PENDING_PER_ACCOUNT:
                raise ApiError(429, 'Too many books waiting to be added; try again later')
            reserved = sum(sum(sizes) for sizes in uploading.values())
            if shutil.disk_usage(queue_dir()).free - reserved - length < MIN_FREE_BYTES:
                raise ApiError(507, 'Not enough free space on the server')
            uploading.setdefault(account, []).append(length)

        job_id = uuid.uuid4().hex
        file = f'{job_id}.{ext}'
        path = os.path.join(queue_dir(), file)
        remaining = length
        try:
            with open(path, 'wb') as f:
                while remaining:
                    chunk = self.rfile.read(min(remaining, 1 << 20))
                    if not chunk:
                        break
                    f.write(chunk)
                    remaining -= len(chunk)
        except BaseException as error:
            try:
                os.remove(path)
            except OSError:
                pass
            if isinstance(error, OSError):
                raise ApiError(507, 'Could not store the file') from error
            raise
        finally:
            with lock:
                uploading[account].remove(length)
                if not uploading[account]:
                    del uploading[account]
        vn = not remaining and ext == 'cbz' and is_vn_zip(path)
        if remaining:
            problem = 'Upload incomplete'
        elif vn:
            problem = '' if os.access(VN_DIR, os.W_OK) else 'There is no visual novel folder (VN_PATH) to add games to'
        else:
            problem = 'The file is too large' if length > MAX_BYTES else check_book(path, ext)
        if problem:
            os.remove(path)
            raise ApiError(400, problem)

        now = time.time()
        job = {'id': job_id, 'account': account, 'name': name, 'file': file,
               'state': 'queued', 'created': now, 'updated': now}
        if folder := clean_name(parse_qs(url.query).get('folder', [''])[0]):
            job['folder'] = folder
        if vn:
            job['kind'] = 'vn'

        try:
            write_job_file(job)
        except OSError as error:
            remove_queued(file)
            raise ApiError(507, 'Could not store the file') from error
        with work:
            jobs[job_id] = job
            save_jobs()
            work.notify()
        return {'job': public_job(job)}

    def log_message(self, fmt, *args):
        sys.stderr.write('%s\n' % (fmt % args))


def main():
    os.makedirs(queue_dir(), exist_ok=True)
    # The new library's empty catalog now, rather than at the catalog service's next run.
    if create_empty_library():
        rebuild_catalog()
    if recover_queue(load_jobs()):
        save_jobs()
    # Games half unpacked when the service stopped.
    if os.path.isdir(VN_DIR) and os.access(VN_DIR, os.W_OK):
        for entry in os.scandir(VN_DIR):
            if entry.name.startswith('.importing-'):
                shutil.rmtree(entry.path, ignore_errors=True)
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=expire_trash, daemon=True).start()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == '__main__':
    main()
