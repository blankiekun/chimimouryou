"""Sources in the import service: look a work up, plan its volumes, fetch them and hand each finished volume to
the import queue as an EPUB with its Calibre series, index, identifier and tag.

Endpoints (under /calibre/import/api/sources/, `import` permission via nginx; jobs are per account):
  POST lookup {url}                      -> work: a site's work link (Syosetu in phase 1)
  GET  works/{id}                        -> work: details, volume plan, per-volume inLibrary/pending
  POST works/resolve {site, workKey}     -> work
  POST works/{id}/add {volumes: [n]}     -> {job}: fetches those volumes (ones in the library or on their way
                                            are skipped)
  GET  queue                             -> {jobs, interval}: own jobs, newest first
  POST jobs/{id}/retry                   -> {job}: a failed or cancelled job goes on from the chapter it stopped at
  POST jobs/{id}/cancel                  -> {job}
  DELETE jobs/{id}                       -> {}: a job that isn't running

Job states: queued, fetching, adding (volumes in the import queue), done, failed (error, failed_at), cancelled.
Chapters are cached in <state>/sources/<work id>/<n>.json until their volume is queued, so a retry resumes.
"""
import json
import os
import shutil
import sys
import threading
import time
import uuid

import apidb  # server/api, put on sys.path by service.py

from . import build, fetcher, planner
from .adapters import syosetu

ADAPTERS = {syosetu.SITE: syosetu}
API_DB = os.environ.get('API_DB', '/data/state/api/library.db')
DETAILS_SECONDS = 600
KEEP_DONE_MS = 7 * 24 * 3600 * 1000
MAX_ACTIVE_PER_ACCOUNT = 20
ACTIVE = ('queued', 'fetching')


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


_db: apidb.Database | None = None
_db_lock = threading.Lock()
_details: dict[int, tuple[float, dict]] = {}
_wake = threading.Event()
# Set by start(): the import service's state folder and its enqueue(account, name, write, extra) -> job.
_state_dir = ''
_enqueue = None


def database() -> apidb.Database:
    global _db
    with _db_lock:
        if _db is None:
            _db = apidb.Database(API_DB)
        return _db


def now_ms() -> int:
    return int(time.time() * 1000)


def cache_dir(work_id: int) -> str:
    return os.path.join(_state_dir, 'sources', str(work_id))


# Works ---------------------------------------------------------------------------------------------------

def _fetch_details(work: dict) -> dict:
    """The site's details (cached 10 min), saved into the works row."""
    cached = _details.get(work['id'])
    if cached and time.monotonic() - cached[0] < DETAILS_SECONDS:
        return cached[1]
    details = ADAPTERS[work['site']].details(work['url'])
    _details[work['id']] = (time.monotonic(), details)
    database().transaction(lambda c: c.execute(
        'UPDATE works SET title = ?, authors = ?, status = ?, chapters = ?, updated = ? WHERE id = ?',
        (details['title'], details['authors'], details['status'], details['chapters'], details['updated'],
         work['id'])))
    return details


def _work_row(work_id: int) -> dict:
    rows = database().query('SELECT * FROM works WHERE id = ?', (work_id,))
    if not rows:
        raise ApiError(404, 'No such work')
    return dict(rows[0])


def _work_for(site: str, key: str, url: str) -> dict:
    def upsert(c):
        c.execute('INSERT INTO works (site, work_key, url, volume_size) VALUES (?, ?, ?, ?) '
                  'ON CONFLICT (site, work_key) DO UPDATE SET url = excluded.url', (site, key, url, planner.VOLUME_SIZE))
        return dict(c.execute('SELECT * FROM works WHERE site = ? AND work_key = ?', (site, key)).fetchone())
    return database().transaction(upsert)


def _work_json(work: dict, details: dict | None) -> dict:
    db = database()
    volumes = {row['number']: row for row in db.query(
        'SELECT v.*, EXISTS (SELECT 1 FROM books b WHERE b.calibre_id = v.calibre_id AND b.deleted = 0) AS live '
        'FROM work_volumes v WHERE v.work = ?', (work['id'],))}
    jobs = db.query('SELECT state, volumes FROM source_jobs WHERE work = ? AND state IN (?, ?, ?)',
                    (work['id'], *ACTIVE, 'adding'))
    fetching = {n for job in jobs if job['state'] in ACTIVE for n in json.loads(job['volumes'])}
    adding = any(job['state'] == 'adding' for job in jobs)
    plan = []
    for volume in planner.plan(work['chapters'], work['volume_size'] or planner.VOLUME_SIZE):
        row = volumes.get(volume['number'])
        in_library = bool(row and row['live'])
        plan.append({**volume, 'inLibrary': in_library,
                     'pending': not in_library and (volume['number'] in fetching or (bool(row) and adding))})
    adapter = ADAPTERS[work['site']]
    return {'id': work['id'], 'site': work['site'], 'siteName': adapter.NAME, 'workKey': work['work_key'],
            'url': work['url'], 'title': work['title'], 'authors': work['authors'], 'status': work['status'],
            'chapters': work['chapters'], 'updated': work['updated'],
            'summary': (details or {}).get('summary', ''), 'latest': (details or {}).get('latest', []),
            'volumeSize': work['volume_size'] or planner.VOLUME_SIZE, 'volumes': plan,
            'domain': adapter.DOMAIN, 'interval': fetcher.INTERVAL}


def _show(work: dict) -> dict:
    try:
        details = _fetch_details(work)
    except (fetcher.FetchError, LookupError, ValueError) as error:
        if not work['title']:  # never fetched: nothing to show (not 502: the app reads that as "service off")
            raise ApiError(404 if isinstance(error, LookupError) else 503, str(error)) from error
        details = None
    return _work_json(_work_row(work['id']), details)


def lookup(body: dict) -> dict:
    url = body.get('url')
    if not isinstance(url, str) or len(url) > 2000:
        raise ApiError(400, 'Paste a link to a work')
    for site, adapter in ADAPTERS.items():
        if found := adapter.parse_url(url):
            work = _work_for(site, *found)
            try:
                return _show(work)
            except ApiError:
                # A work the site doesn't have shouldn't stay as an empty row.
                if not work['title']:
                    database().transaction(lambda c: c.execute(
                        'DELETE FROM works WHERE id = ? AND title = \'\' AND NOT EXISTS '
                        '(SELECT 1 FROM source_jobs WHERE work = ?)', (work['id'], work['id'])))
                raise
    raise ApiError(400, 'Not a link to a work on a supported site (Syosetu)')


def resolve(body: dict) -> dict:
    site, key = body.get('site'), body.get('workKey')
    if site not in ADAPTERS or not isinstance(key, str):
        raise ApiError(400, 'Invalid request')
    rows = database().query('SELECT * FROM works WHERE site = ? AND work_key = ?', (site, key))
    if rows:
        return _show(dict(rows[0]))
    return lookup({'url': f'https://ncode.syosetu.com/{key}/'})


# Jobs ----------------------------------------------------------------------------------------------------

def _job_json(row) -> dict:
    adapter = ADAPTERS[row['site']]
    return {'id': row['id'], 'workId': row['work'], 'title': row['title'], 'site': row['site'],
            'siteName': adapter.NAME, 'domain': adapter.DOMAIN, 'kind': row['kind'], 'volumes': json.loads(row['volumes']), 'unit': row['unit'],
            'done': row['done'], 'total': row['total'], 'state': row['state'], 'error': row['error'],
            'failedAt': row['failed_at'], 'created': row['created'], 'updated': row['updated']}


JOB_QUERY = 'SELECT j.*, w.title, w.site FROM source_jobs j JOIN works w ON w.id = j.work'


def _own_job(account: str, job_id: str):
    rows = database().query(f'{JOB_QUERY} WHERE j.id = ? AND j.account = ?', (job_id, account))
    if not rows:
        raise ApiError(404, 'No such job')
    return rows[0]


def add(account: str, work_id: int, body: dict) -> dict:
    work = _work_row(work_id)
    numbers = body.get('volumes')
    if not isinstance(numbers, list) or not numbers or not all(type(n) is int for n in numbers):
        raise ApiError(400, 'Choose the volumes to add')
    plan = {v['number']: v for v in _work_json(work, None)['volumes']}
    wanted = sorted({n for n in numbers if n in plan and not plan[n]['inLibrary'] and not plan[n]['pending']})
    if not wanted:
        raise ApiError(400, 'Those volumes are already in the library or on their way')
    now = now_ms()
    job_id = uuid.uuid4().hex

    def create(c):
        active = c.execute('SELECT COUNT(*) FROM source_jobs WHERE account = ? AND state IN (?, ?)',
                           (account, *ACTIVE)).fetchone()[0]
        if active >= MAX_ACTIVE_PER_ACCOUNT:
            raise ApiError(429, 'Too many works waiting to be fetched; try again later')
        total = sum(plan[n]['last'] - plan[n]['first'] + 1 for n in wanted)
        c.execute('INSERT INTO source_jobs (id, account, work, kind, volumes, unit, total, state, created, updated) '
                  "VALUES (?, ?, ?, 'add', ?, 'chapters', ?, 'queued', ?, ?)",
                  (job_id, account, work_id, json.dumps(wanted), total, now, now))
    database().transaction(create)
    _wake.set()
    return {'job': _job_json(_own_job(account, job_id))}


def queue(account: str) -> dict:
    db = database()
    db.transaction(lambda c: c.execute("DELETE FROM source_jobs WHERE state = 'done' AND updated < ?",
                                       (now_ms() - KEEP_DONE_MS,)))
    rows = db.query(f'{JOB_QUERY} WHERE j.account = ? ORDER BY j.created DESC', (account,))
    return {'jobs': [_job_json(row) for row in rows], 'interval': fetcher.INTERVAL}


def _set_state(job_id: str, allowed: tuple[str, ...], state: str, **fields):
    assignments = ''.join(f', {name} = ?' for name in fields)

    def change(c):
        return c.execute(f'UPDATE source_jobs SET state = ?, updated = ?{assignments} WHERE id = ? AND state IN '
                         f'({", ".join("?" * len(allowed))})',
                         (state, now_ms(), *fields.values(), job_id, *allowed)).rowcount
    return database().transaction(change)


def retry(account: str, job_id: str) -> dict:
    _own_job(account, job_id)
    if not _set_state(job_id, ('failed', 'cancelled'), 'queued', error=''):
        raise ApiError(409, 'Only a failed or cancelled job can be retried')
    _wake.set()
    return {'job': _job_json(_own_job(account, job_id))}


def cancel(account: str, job_id: str) -> dict:
    _own_job(account, job_id)
    if not _set_state(job_id, ACTIVE, 'cancelled'):
        raise ApiError(409, 'Only a waiting or running job can be cancelled')
    return {'job': _job_json(_own_job(account, job_id))}


def delete(account: str, job_id: str) -> dict:
    job = _own_job(account, job_id)
    removed = database().transaction(lambda c: c.execute(
        'DELETE FROM source_jobs WHERE id = ? AND state NOT IN (?, ?)', (job_id, *ACTIVE)).rowcount)
    if not removed:
        raise ApiError(409, 'Cancel the job first')
    # Chapters cached for it go too, unless another job of the work still needs them.
    if not database().query('SELECT 1 FROM source_jobs WHERE work = ? AND state IN (?, ?, ?, ?)',
                            (job['work'], 'failed', 'cancelled', *ACTIVE)):
        shutil.rmtree(cache_dir(job['work']), ignore_errors=True)
    return {}


def route(method: str, path: str, account: str, body: dict) -> dict:
    """path is relative to /sources (e.g. '/works/3/add')."""
    parts = path.strip('/').split('/')
    if method == 'POST' and parts == ['lookup']:
        return lookup(body)
    if method == 'POST' and parts == ['works', 'resolve']:
        return resolve(body)
    if parts[0] == 'works' and len(parts) >= 2 and parts[1].isdigit():
        if method == 'GET' and len(parts) == 2:
            return _show(_work_row(int(parts[1])))
        if method == 'POST' and parts[2:] == ['add']:
            return add(account, int(parts[1]), body)
    if method == 'GET' and parts == ['queue']:
        return queue(account)
    if parts[0] == 'jobs' and len(parts) >= 2:
        if method == 'POST' and parts[2:] == ['retry']:
            return retry(account, parts[1])
        if method == 'POST' and parts[2:] == ['cancel']:
            return cancel(account, parts[1])
        if method == 'DELETE' and len(parts) == 2:
            return delete(account, parts[1])
    raise ApiError(404, 'not found')


# The runner ----------------------------------------------------------------------------------------------

def _cancelled(job_id: str) -> bool:
    rows = database().query('SELECT state FROM source_jobs WHERE id = ?', (job_id,))
    return not rows or rows[0]['state'] != 'fetching'


def _chapter(work: dict, details: dict, n: int) -> dict:
    """Chapter n, from the cache or the site (then cached)."""
    path = os.path.join(cache_dir(work['id']), f'{n}.json')
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        pass
    chapter = ADAPTERS[work['site']].chapter(work['url'], n, details['short'])
    apidb.write_atomic(path, json.dumps(chapter, ensure_ascii=False).encode())
    return chapter


def _queue_volume(job, work: dict, volume: dict, chapters: list[dict], last: bool):
    adapter = ADAPTERS[work['site']]
    number = volume['number']
    title = f"{work['title']} {number}"

    def write(path):
        build.epub(path, title=title, authors=work['authors'], series=work['title'], series_index=number,
                   identifier=f"chimi:{work['site']}:{work['work_key']}:{number}",
                   chapters=[{'title': c['title'], 'xhtml': c['html']} for c in chapters])
    database().transaction(lambda c: c.execute(
        'INSERT INTO work_volumes (work, number, first_ch, last_ch, complete) VALUES (?, ?, ?, ?, ?) '
        'ON CONFLICT (work, number) DO UPDATE SET first_ch = excluded.first_ch, last_ch = excluded.last_ch, '
        'calibre_id = NULL, complete = excluded.complete',
        (work['id'], number, volume['first'], volume['last'],
         int(volume['last'] - volume['first'] + 1 == (work['volume_size'] or planner.VOLUME_SIZE)))))
    _enqueue(job['account'], f'{title}.epub', write, {
        'title': title, 'authors': work['authors'], 'series': work['title'], 'seriesIndex': number,
        'identifier': f"chimi:{work['site']}:{work['work_key']}:{number}", 'tags': adapter.NAME,
        'sourceJob': job['id'], 'sourceWork': work['id'], 'sourceVolume': number, 'sourceLast': last})


def run_job(job):
    work = _work_row(job['work'])
    _details.pop(work['id'], None)  # the chapter list as it is now
    details = _fetch_details(work)
    work = _work_row(work['id'])
    plan = {v['number']: v for v in planner.plan(work['chapters'], work['volume_size'] or planner.VOLUME_SIZE)}
    remaining = json.loads(job['volumes'])
    if any(n not in plan for n in remaining):
        raise LookupError(f'Vol. {max(remaining)} is no longer on the site')
    # A retry counts again from the volumes already queued; cached chapters count as they are read.
    left = sum(plan[n]['last'] - plan[n]['first'] + 1 for n in remaining)
    database().transaction(lambda c: c.execute(
        'UPDATE source_jobs SET done = MAX(0, total - ?) WHERE id = ?', (left, job['id'])))
    for number in list(remaining):
        volume = plan[number]
        chapters = []
        for n in range(volume['first'], volume['last'] + 1):
            if _cancelled(job['id']):
                return
            try:
                chapters.append(_chapter(work, details, n))
            except (fetcher.FetchError, LookupError, ValueError) as error:
                raise ChapterError(n, f'Chapter {n}: {error}') from error
            database().transaction(lambda c: c.execute(
                'UPDATE source_jobs SET done = MIN(total, done + 1), updated = ? WHERE id = ?', (now_ms(), job['id'])))
        remaining.remove(number)
        _queue_volume(job, work, volume, chapters, last=not remaining)
        for n in range(volume['first'], volume['last'] + 1):
            try:
                os.remove(os.path.join(cache_dir(work['id']), f'{n}.json'))
            except OSError:
                pass
        database().transaction(lambda c: c.execute(
            'UPDATE source_jobs SET volumes = ?, updated = ? WHERE id = ?', (json.dumps(remaining), now_ms(), job['id'])))
    _set_state(job['id'], ('fetching',), 'adding')


class ChapterError(Exception):
    def __init__(self, chapter: int, message: str):
        super().__init__(message)
        self.chapter = chapter


def runner():
    """Fetches queued jobs one at a time (phase 1 has one site, so one host)."""
    while True:
        rows = database().query(f"{JOB_QUERY} WHERE j.state = 'queued' ORDER BY j.created LIMIT 1")
        if not rows:
            _wake.wait(60)
            _wake.clear()
            continue
        job = rows[0]
        if not _set_state(job['id'], ('queued',), 'fetching'):
            continue
        try:
            run_job(job)
        except ChapterError as error:
            _set_state(job['id'], ('fetching',), 'failed', error=str(error), failed_at=error.chapter)
        except (fetcher.FetchError, LookupError, ValueError) as error:
            _set_state(job['id'], ('fetching',), 'failed', error=str(error))
        except Exception as error:  # noqa: BLE001 - one bad job must not end the runner
            print(f"sources job {job['id']}: {error!r}", file=sys.stderr)
            _set_state(job['id'], ('fetching',), 'failed', error='Something went wrong; see the import service log')


def volume_added(import_job: dict):
    """The import worker finished a volume's import job: record its Calibre id; the job's last volume ends it."""
    calibre_id = import_job.get('calibreId') if import_job['state'] in ('added', 'unlisted') else None
    number = import_job['sourceVolume']

    def record(c):
        if calibre_id:
            c.execute('UPDATE work_volumes SET calibre_id = ? WHERE work = ? AND number = ?',
                      (calibre_id, import_job['sourceWork'], number))
            if import_job.get('sourceLast'):
                c.execute("UPDATE source_jobs SET state = 'done', updated = ? WHERE id = ? AND state = 'adding'",
                          (now_ms(), import_job['sourceJob']))
        else:
            c.execute("UPDATE source_jobs SET state = 'failed', error = ?, updated = ? WHERE id = ? AND state IN "
                      "('adding', 'fetching')",
                      (f"Vol. {number}: {import_job.get('error') or 'Calibre could not add it'}", now_ms(),
                       import_job['sourceJob']))
    database().transaction(record)


def start(state_dir: str, enqueue):
    """Starts the runner; enqueue(account, name, write(path), extra fields) puts a file into the import queue."""
    global _state_dir, _enqueue
    _state_dir, _enqueue = state_dir, enqueue
    # Jobs interrupted by a restart go on from their cached chapters.
    database().transaction(lambda c: c.execute("UPDATE source_jobs SET state = 'queued' WHERE state = 'fetching'"))
    threading.Thread(target=runner, daemon=True).start()
