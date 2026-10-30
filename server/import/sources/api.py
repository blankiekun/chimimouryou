"""Sources in the import service: look a work up, plan its volumes, fetch them and hand each finished volume to
the import queue as an EPUB with its Calibre series, index, identifier and tag.

Endpoints (under /calibre/import/api/sources/, `import` permission via nginx; jobs are per account):
  POST lookup {url}                      -> work: a site's work link (Syosetu, Kakuyomu)
  GET  works/{id}                        -> work: details, volume plan, per-volume inLibrary/pending
  POST works/resolve {site, workKey}     -> work
  POST works/{id}/add {volumes: [n]}     -> {job}: fetches those volumes (ones in the library or on their way
                                            are skipped)
  GET  queue                             -> {jobs, interval}: own jobs, newest first
  POST jobs/{id}/retry                   -> {job}: a failed or cancelled job goes on from the chapter it stopped at
  POST jobs/{id}/cancel                  -> {job}
  DELETE jobs/{id}                       -> {}: a job that isn't running
  PUT  follows/{work} {paused?}          -> {follow}: follows the work (or pauses/resumes it); own follows only
  DELETE follows/{work}                  -> {}: unfollows; the volumes stay in the library
  GET  following                         -> {follows, checkHours}: own follows
  POST check {work?}                     -> {follows, checkHours}: Check now, for every unpaused follow or one work
  GET  sites/{site}/search?q=&page=      -> {site, siteName, domain, order, total, more, works: [{workKey, url, title,
       sites/{site}/popular?page=            authors, status, chapters, updated, inLibrary, following}]}: 20 per page,
       sites/{site}/latest?page=             the site's answer cached 10 min; inLibrary/following by site + work key
  GET  covers/{work}                     -> the work's cover image (service.py sends it), fetched once from the
                                            adapter's COVER_HOSTS and kept in <state>/sources/covers/

Job states: queued, fetching, adding (volumes in the import queue), done, failed (error, failed_at), cancelled.
Job kinds: add (volumes chosen by the reader) and update (a followed work's check). Chapters are cached in
<state>/sources/<work id>/<n>.json until their volume is full, so a retry resumes and the open volume is rebuilt
without fetching it again.

Runners: one per site, so a long job on one site doesn't hold up another (the fetcher keeps the per-host limit).

Follows: the runner queues an update job for every work with a due unpaused follow (SOURCES_CHECK_HOURS, an hour
after a failed check), one job per work whoever follows it; a failed update job is queued again rather than a new
one. An update fetches the open (not full) volume in the library and every volume after it (with nothing in the
library, from the reader's failed or cancelled pick, else from Vol. 1): the open one is
replaced in place (calibredb add_format on its Calibre id, timestamp bumped so devices download it again), new
ones are added. Full volumes are never touched.
"""
import hashlib
import json
import os
import shutil
import sys
import threading
import time
import uuid

import apidb  # server/api, put on sys.path by service.py

from . import build, fetcher, planner
from .adapters import kakuyomu, syosetu

ADAPTERS = {adapter.SITE: adapter for adapter in (syosetu, kakuyomu)}
API_DB = os.environ.get('API_DB', '/data/state/api/library.db')
DETAILS_SECONDS = 600
SEARCH_SECONDS = 600
SEARCH_CACHED = 200
MAX_PAGE = 100
COVER_BYTES = 5 * 1024 * 1024
# A cover the site wouldn't give is asked for again after this long.
COVER_RETRY_SECONDS = 600
KEEP_DONE_MS = 7 * 24 * 3600 * 1000
MAX_ACTIVE_PER_ACCOUNT = 20
ACTIVE = ('queued', 'fetching')
CHECKING = (*ACTIVE, 'adding')
CHECK_HOURS = float(os.environ.get('SOURCES_CHECK_HOURS') or 6)
CHECK_MS = int(CHECK_HOURS * 3600 * 1000)
RETRY_MS = min(3600 * 1000, CHECK_MS)


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


_db: apidb.Database | None = None
_db_lock = threading.Lock()
_details: dict[int, tuple[float, dict]] = {}
_searches: dict[tuple, tuple[float, dict]] = {}
_cover_failed: dict[int, float] = {}


class _Wake:
    """Wakes every site's runner."""
    def __init__(self):
        self.events = {site: threading.Event() for site in ADAPTERS}

    def set(self):
        for event in self.events.values():
            event.set()


_wake = _Wake()
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
        'UPDATE works SET title = ?, authors = ?, status = ?, chapters = ?, updated = ?, cover = ? WHERE id = ?',
        (details['title'], details['authors'], details['status'], details['chapters'], details['updated'],
         details.get('cover', ''), work['id'])))
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


def _work_json(work: dict, details: dict | None, account: str = '') -> dict:
    db = database()
    followed = db.query('SELECT paused FROM follows WHERE account = ? AND work = ?', (account, work['id']))
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
            'domain': adapter.DOMAIN, 'interval': fetcher.INTERVAL, 'checkHours': CHECK_HOURS,
            'following': bool(followed), 'paused': bool(followed and followed[0]['paused']),
            'cover': bool(work['cover'])}


def _show(work: dict, account: str) -> dict:
    try:
        details = _fetch_details(work)
    except (fetcher.FetchError, LookupError, ValueError) as error:
        if not work['title']:  # never fetched: nothing to show (not 502: the app reads that as "service off")
            raise ApiError(404 if isinstance(error, LookupError) else 503, str(error)) from error
        details = None
    return _work_json(_work_row(work['id']), details, account)


def lookup(body: dict, account: str) -> dict:
    url = body.get('url')
    if not isinstance(url, str) or len(url) > 2000:
        raise ApiError(400, 'Paste a link to a work')
    for site, adapter in ADAPTERS.items():
        if found := adapter.parse_url(url):
            work = _work_for(site, *found)
            try:
                return _show(work, account)
            except ApiError:
                # A work the site doesn't have shouldn't stay as an empty row.
                if not work['title']:
                    database().transaction(lambda c: c.execute(
                        'DELETE FROM works WHERE id = ? AND title = \'\' AND NOT EXISTS '
                        '(SELECT 1 FROM source_jobs WHERE work = ?)', (work['id'], work['id'])))
                raise
    raise ApiError(400, f"Not a link to a work on a supported site ({', '.join(a.NAME for a in ADAPTERS.values())})")


def resolve(body: dict, account: str) -> dict:
    site, key = body.get('site'), body.get('workKey')
    if site not in ADAPTERS or not isinstance(key, str):
        raise ApiError(400, 'Invalid request')
    rows = database().query('SELECT * FROM works WHERE site = ? AND work_key = ?', (site, key))
    if rows:
        return _show(dict(rows[0]), account)
    return lookup({'url': ADAPTERS[site].work_url(key)}, account)


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


# Follows -------------------------------------------------------------------------------------------------

FOLLOW_QUERY = ('SELECT f.*, w.title, w.site, w.chapters, w.cover, '
                '(SELECT COUNT(*) FROM work_volumes v WHERE v.work = w.id AND v.calibre_id IS NOT NULL) AS volumes, '
                'EXISTS (SELECT 1 FROM source_jobs j WHERE j.work = w.id AND j.state IN (?, ?, ?)) AS checking '
                'FROM follows f JOIN works w ON w.id = f.work WHERE f.account = ?')


def _follow_json(row) -> dict:
    adapter = ADAPTERS[row['site']]
    return {'workId': row['work'], 'title': row['title'], 'site': row['site'], 'siteName': adapter.NAME,
            'domain': adapter.DOMAIN, 'chapters': row['chapters'], 'volumes': row['volumes'],
            'paused': bool(row['paused']), 'state': 'checking' if row['checking'] else row['state'],
            'detail': row['detail'], 'lastCheck': row['last_check'], 'nextCheck': row['next_check'],
            'modified': row['modified'], 'cover': bool(row['cover'])}


def following(account: str) -> dict:
    rows = database().query(f'{FOLLOW_QUERY} ORDER BY w.title', (*CHECKING, account))
    return {'follows': [_follow_json(row) for row in rows], 'checkHours': CHECK_HOURS}


def follow(account: str, work_id: int, body: dict) -> dict:
    """Follows the work, or pauses/resumes the follow. A new follow is checked at once."""
    _work_row(work_id)
    paused = body.get('paused', False)
    if not isinstance(paused, bool):
        raise ApiError(400, 'Invalid request')
    database().transaction(lambda c: c.execute(
        'INSERT INTO follows (account, work, paused, modified) VALUES (?, ?, ?, ?) ON CONFLICT (account, work) '
        'DO UPDATE SET paused = excluded.paused, modified = excluded.modified',
        (account, work_id, int(paused), now_ms())))
    _wake.set()
    rows = database().query(f'{FOLLOW_QUERY} AND f.work = ?', (*CHECKING, account, work_id))
    return {'follow': _follow_json(rows[0])}


def unfollow(account: str, work_id: int) -> dict:
    if not database().transaction(lambda c: c.execute(
            'DELETE FROM follows WHERE account = ? AND work = ?', (account, work_id)).rowcount):
        raise ApiError(404, 'Not following that work')
    return {}


def check(account: str, body: dict) -> dict:
    """Check now: the account's unpaused follows (or the one work) are due at once."""
    work = body.get('work')
    if work is not None and type(work) is not int:
        raise ApiError(400, 'Invalid request')
    due = database().transaction(lambda c: c.execute(
        "UPDATE follows SET next_check = NULL WHERE account = ? AND paused = 0 AND device = ''"
        + (' AND work = ?' if work is not None else ''), (account, *([work] if work is not None else []))).rowcount)
    if work is not None and not due:
        raise ApiError(404, 'Not following that work, or it is paused')
    queue_due_checks(now_ms())
    return following(account)


def queue_due_checks(now: int):
    """One update job per work with a due, unpaused follow and no job under way."""
    def run(c):
        due = c.execute(
            "SELECT work, MIN(account) AS account FROM follows WHERE paused = 0 AND device = '' AND "
            '(next_check IS NULL OR next_check <= ?) AND work NOT IN '
            '(SELECT work FROM source_jobs WHERE state IN (?, ?, ?)) GROUP BY work', (now, *CHECKING)).fetchall()
        for row in due:
            # A failed check goes on from the chapter it stopped at.
            old = c.execute("SELECT id FROM source_jobs WHERE work = ? AND kind = 'update' AND state IN "
                            "('failed', 'cancelled') ORDER BY created DESC LIMIT 1", (row['work'],)).fetchone()
            if old:
                c.execute("UPDATE source_jobs SET state = 'queued', error = '', updated = ? WHERE id = ?",
                          (now_ms(), old['id']))
            else:
                c.execute('INSERT INTO source_jobs (id, account, work, kind, volumes, unit, total, state, created, '
                          "updated) VALUES (?, ?, ?, 'update', '[]', 'chapters', 0, 'queued', ?, ?)",
                          (uuid.uuid4().hex, row['account'], row['work'], now_ms(), now_ms()))
            c.execute("UPDATE follows SET next_check = ? WHERE work = ? AND paused = 0 AND device = ''",
                      (now + CHECK_MS, row['work']))
        return len(due)
    if database().transaction(run):
        _wake.set()


def _follow_result(work_id: int, state: str, detail: str):
    """A check's outcome, for everyone following the work."""
    now = now_ms()
    database().transaction(lambda c: c.execute(
        "UPDATE follows SET state = ?, detail = ?, last_check = ?, next_check = ? WHERE work = ? AND device = ''",
        (state, detail, now, now + (RETRY_MS if state == 'failed' else CHECK_MS), work_id)))


def _kept_volumes(work_id: int) -> dict:
    """The work's volumes in Calibre: a Calibre id the catalog lists, or hasn't listed yet (just added)."""
    return {row['number']: row for row in database().query(
        'SELECT v.* FROM work_volumes v WHERE v.work = ? AND v.calibre_id IS NOT NULL AND (EXISTS '
        '(SELECT 1 FROM books b WHERE b.calibre_id = v.calibre_id AND b.deleted = 0) OR NOT EXISTS '
        '(SELECT 1 FROM books b WHERE b.calibre_id = v.calibre_id))', (work_id,))}


def _update_plan(work: dict, plan: dict, size: int) -> tuple[list[int], int]:
    """(volumes an update fetches, new chapters): the last volume in the library if it isn't full, and every
    volume after it (all of them when none is there yet). Full volumes are never fetched again."""
    kept = _kept_volumes(work['id'])
    last = kept[max(kept)] if kept else None
    if last is None:
        # Nothing in the library yet: start where the reader's picked add began ("Vol. 3 onward") when it failed
        # before any volume reached Calibre (volumes it queued have rows, ones it didn't stay in the job), not at 1.
        db = database()
        picked = [row['number'] for row in db.query('SELECT number FROM work_volumes WHERE work = ?', (work['id'],))]
        picked += [n for row in db.query(
            "SELECT volumes FROM source_jobs WHERE work = ? AND kind = 'add' AND state IN ('failed', 'cancelled')",
            (work['id'],)) for n in json.loads(row['volumes'])]
        picked = [n for n in picked if n in plan]
        start = min(picked, default=1)
        have = plan[start]['first'] - 1 if start in plan else 0
    else:
        full = last['last_ch'] - last['first_ch'] + 1 >= size
        start, have = last['number'] + int(full), last['last_ch']
    numbers = [n for n, volume in sorted(plan.items())
               if n >= start and not (n in kept and kept[n]['last_ch'] >= volume['last'])]
    return numbers, max(0, work['chapters'] - have)


def _volumes_text(numbers: list[int]) -> str:
    return f'Vol. {numbers[0]}' if len(numbers) == 1 else f'Vol. {numbers[0]}–{numbers[-1]}'


# Search and covers -------------------------------------------------------------------------------------

def browse(account: str, site: str, kind: str, query: dict) -> dict:
    """A page of the site's search, popular or latest works, with what this account has of each."""
    adapter = ADAPTERS.get(site)
    if not adapter:
        raise ApiError(404, 'No such site')
    q = (query.get('q') or '').strip()
    page = query.get('page') or '1'
    if not page.isdigit() or not 1 <= int(page) <= MAX_PAGE or len(q) > 200 or (kind == 'search' and not q):
        raise ApiError(400, 'Invalid request')
    key = (site, kind, q, int(page))
    cached = _searches.get(key)
    if cached and time.monotonic() - cached[0] < SEARCH_SECONDS:
        found = cached[1]
    else:
        try:
            found = adapter.search(q, int(page)) if kind == 'search' else getattr(adapter, kind)(int(page))
        except (fetcher.FetchError, LookupError, ValueError) as error:
            raise ApiError(503, str(error)) from error
        now = time.monotonic()
        for old in [k for k, (at, _) in _searches.items() if now - at >= SEARCH_SECONDS]:
            _searches.pop(old, None)
        if len(_searches) >= SEARCH_CACHED:
            _searches.pop(next(iter(_searches)), None)
        _searches[key] = (now, found)
    keys = [w['workKey'] for w in found['works']]
    marks = {row['work_key']: row for row in database().query(
        'SELECT w.work_key, EXISTS (SELECT 1 FROM work_volumes v JOIN books b ON b.calibre_id = v.calibre_id '
        'WHERE v.work = w.id AND b.deleted = 0) AS in_library, '
        'EXISTS (SELECT 1 FROM follows f WHERE f.work = w.id AND f.account = ?) AS following '
        f'FROM works w WHERE w.site = ? AND w.work_key IN ({", ".join("?" * len(keys))})',
        (account, site, *keys))} if keys else {}
    return {'site': site, 'siteName': adapter.NAME, 'domain': adapter.DOMAIN, 'order': adapter.SEARCH_ORDER,
            'total': found['total'], 'more': found['more'], 'page': int(page),
            'works': [{**w, 'inLibrary': bool(w['workKey'] in marks and marks[w['workKey']]['in_library']),
                       'following': bool(w['workKey'] in marks and marks[w['workKey']]['following'])}
                      for w in found['works']]}


IMAGE_TYPES = ((b'\xff\xd8\xff', 'image/jpeg'), (b'\x89PNG\r\n\x1a\n', 'image/png'), (b'GIF8', 'image/gif'))


def _image_type(data: bytes) -> str | None:
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    return next((kind for magic, kind in IMAGE_TYPES if data.startswith(magic)), None)


def cover(work_id: int) -> tuple[bytes, str]:
    """(image, content type) of the work's cover: fetched once from a host its adapter names, then kept on disk.
    Only JPEG, PNG, GIF and WebP pass, so a page the site sends instead is never served as an image."""
    work = _work_row(work_id)
    url = work['cover']
    if not url:
        raise ApiError(404, 'No cover')
    folder = os.path.join(_state_dir, 'sources', 'covers')
    prefix = f'{work_id}-'
    path = os.path.join(folder, prefix + hashlib.sha256(url.encode()).hexdigest()[:16])
    try:
        with open(path, 'rb') as f:
            data = f.read()
        return data, _image_type(data) or 'application/octet-stream'
    except OSError:
        pass
    if time.monotonic() - _cover_failed.get(work_id, -COVER_RETRY_SECONDS) < COVER_RETRY_SECONDS:
        raise ApiError(404, 'No cover')
    try:
        data = fetcher.fetch(url, ADAPTERS[work['site']].COVER_HOSTS)[0]
        kind = _image_type(data)
        if not kind or len(data) > COVER_BYTES:
            raise ValueError('not an image')
    except (fetcher.FetchError, ValueError) as error:
        _cover_failed[work_id] = time.monotonic()
        raise ApiError(404, 'No cover') from error
    os.makedirs(folder, exist_ok=True)
    for old in os.listdir(folder):  # an earlier cover of the work
        if old.startswith(prefix):
            os.remove(os.path.join(folder, old))
    apidb.write_atomic(path, data)
    return data, kind


def route(method: str, path: str, account: str, body: dict) -> dict:
    """path is relative to /sources (e.g. '/works/3/add'); body is the query of a GET."""
    parts = path.strip('/').split('/')
    if method == 'GET' and len(parts) == 3 and parts[0] == 'sites' and parts[2] in ('search', 'popular', 'latest'):
        return browse(account, parts[1], parts[2], body)
    if method == 'POST' and parts == ['lookup']:
        return lookup(body, account)
    if method == 'POST' and parts == ['works', 'resolve']:
        return resolve(body, account)
    if parts[0] == 'works' and len(parts) >= 2 and parts[1].isdigit():
        if method == 'GET' and len(parts) == 2:
            return _show(_work_row(int(parts[1])), account)
        if method == 'POST' and parts[2:] == ['add']:
            return add(account, int(parts[1]), body)
    if method == 'GET' and parts == ['queue']:
        return queue(account)
    if method == 'GET' and parts == ['following']:
        return following(account)
    if method == 'POST' and parts == ['check']:
        return check(account, body)
    if parts[0] == 'follows' and len(parts) == 2 and parts[1].isdigit():
        if method == 'PUT':
            return follow(account, int(parts[1]), body)
        if method == 'DELETE':
            return unfollow(account, int(parts[1]))
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
    chapter = ADAPTERS[work['site']].chapter(work['url'], n, details)
    apidb.write_atomic(path, json.dumps(chapter, ensure_ascii=False).encode())
    return chapter


def _queue_volume(job, work: dict, volume: dict, chapters: list[dict], last: bool):
    adapter = ADAPTERS[work['site']]
    number = volume['number']
    title = f"{work['title']} {number}"
    kept = _kept_volumes(work['id']).get(number)

    def write(path):
        build.epub(path, title=title, authors=work['authors'], series=work['title'], series_index=number,
                   identifier=f"chimi:{work['site']}:{work['work_key']}:{number}",
                   chapters=[{'title': c['title'], 'xhtml': c['html']} for c in chapters])
    complete = int(volume['last'] - volume['first'] + 1 >= (work['volume_size'] or planner.VOLUME_SIZE))
    # The row's chapters and Calibre id change only once Calibre has the file (volume_added).
    database().transaction(lambda c: c.execute(
        'INSERT INTO work_volumes (work, number, first_ch, last_ch, complete) VALUES (?, ?, ?, ?, ?) '
        'ON CONFLICT (work, number) DO NOTHING', (work['id'], number, volume['first'], volume['last'], complete)))
    _enqueue(job['account'], f'{title}.epub', write, {
        'title': title, 'authors': work['authors'], 'series': work['title'], 'seriesIndex': number,
        'identifier': f"chimi:{work['site']}:{work['work_key']}:{number}", 'tags': adapter.NAME,
        'sourceJob': job['id'], 'sourceWork': work['id'], 'sourceVolume': number, 'sourceLast': last,
        'sourceChapters': [volume['first'], volume['last'], complete],
        # The open volume in the library is replaced in place: same Calibre id, so its reading data stays.
        'replaceCalibreId': kept['calibre_id'] if kept else None})
    return complete


def run_job(job):
    work = _work_row(job['work'])
    _details.pop(work['id'], None)  # the chapter list as it is now
    details = _fetch_details(work)
    work = _work_row(work['id'])
    size = work['volume_size'] or planner.VOLUME_SIZE
    plan = {v['number']: v for v in planner.plan(work['chapters'], size)}
    if job['kind'] == 'update':
        remaining, new = _update_plan(work, plan, size)
        if resumed := [n for n in json.loads(job['volumes']) if n in plan]:
            # A failed check goes on with the volumes it hadn't queued (the ones it had may still be on their way
            # into Calibre), and any volume begun since.
            remaining = sorted(set(resumed) | {n for n in remaining if n > max(resumed)})
        if not remaining:  # nothing new: no job left in the queue for it
            database().transaction(lambda c: c.execute('DELETE FROM source_jobs WHERE id = ?', (job['id'],)))
            _follow_result(work['id'], 'current', '')
            return
        updated = list(remaining)
        total = sum(plan[n]['last'] - plan[n]['first'] + 1 for n in remaining)
        database().transaction(lambda c: c.execute(
            'UPDATE source_jobs SET volumes = ?, total = ?, done = 0 WHERE id = ?',
            (json.dumps(remaining), total, job['id'])))
    else:
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
        if _queue_volume(job, work, volume, chapters, last=not remaining):
            for n in range(volume['first'], volume['last'] + 1):
                try:
                    os.remove(os.path.join(cache_dir(work['id']), f'{n}.json'))
                except OSError:
                    pass
        database().transaction(lambda c: c.execute(
            'UPDATE source_jobs SET volumes = ?, updated = ? WHERE id = ?', (json.dumps(remaining), now_ms(), job['id'])))
    _set_state(job['id'], ('fetching',), 'adding')
    if job['kind'] == 'update':
        _follow_result(work['id'], 'new', f"{new} new chapter{'' if new == 1 else 's'}, added to "
                                          f'{_volumes_text(updated)}')


class ChapterError(Exception):
    def __init__(self, chapter: int, message: str):
        super().__init__(message)
        self.chapter = chapter


def runner(site: str):
    """Fetches the site's queued jobs one at a time."""
    wake = _wake.events[site]
    while True:
        try:
            queue_due_checks(now_ms())
        except Exception as error:  # noqa: BLE001 - the runner goes on
            print(f'sources timer: {error!r}', file=sys.stderr)
        rows = database().query(f"{JOB_QUERY} WHERE j.state = 'queued' AND w.site = ? ORDER BY j.created LIMIT 1",
                                (site,))
        if not rows:
            wake.wait(60)
            wake.clear()
            continue
        job = rows[0]
        if not _set_state(job['id'], ('queued',), 'fetching'):
            continue
        failure = None
        try:
            run_job(job)
        except ChapterError as error:
            failure = error
            _set_state(job['id'], ('fetching',), 'failed', error=str(error), failed_at=error.chapter)
        except (fetcher.FetchError, LookupError, ValueError) as error:
            failure = error
            _set_state(job['id'], ('fetching',), 'failed', error=str(error))
        except Exception as error:  # noqa: BLE001 - one bad job must not end the runner
            print(f"sources job {job['id']}: {error!r}", file=sys.stderr)
            failure = RuntimeError('Something went wrong; see the import service log')
            _set_state(job['id'], ('fetching',), 'failed', error=str(failure))
        if failure is not None and job['kind'] == 'update':
            # The details call says the work is gone; a chapter that isn't there is a failed check.
            removed = isinstance(failure, LookupError) and not isinstance(failure, ChapterError)
            _follow_result(job['work'], 'removed' if removed else 'failed', str(failure))


def volume_added(import_job: dict):
    """The import worker finished a volume's import job: record its Calibre id; the job's last volume ends it."""
    calibre_id = import_job.get('calibreId') if import_job['state'] in ('added', 'unlisted') else None
    number = import_job['sourceVolume']

    def record(c):
        if calibre_id:
            c.execute('UPDATE work_volumes SET calibre_id = ? WHERE work = ? AND number = ?',
                      (calibre_id, import_job['sourceWork'], number))
            if chapters := import_job.get('sourceChapters'):
                c.execute('UPDATE work_volumes SET first_ch = ?, last_ch = ?, complete = ? WHERE work = ? AND '
                          'number = ?', (*chapters, import_job['sourceWork'], number))
            if import_job.get('sourceLast'):
                c.execute("UPDATE source_jobs SET state = 'done', updated = ? WHERE id = ? AND state = 'adding'",
                          (now_ms(), import_job['sourceJob']))
        else:
            c.execute("UPDATE source_jobs SET state = 'failed', error = ?, updated = ? WHERE id = ? AND state IN "
                      "('adding', 'fetching')",
                      (f"Vol. {number}: {import_job.get('error') or 'Calibre could not add it'}", now_ms(),
                       import_job['sourceJob']))
            return c.execute("SELECT kind, error FROM source_jobs WHERE id = ? AND kind = 'update'",
                             (import_job['sourceJob'],)).fetchone()
    failed_update = database().transaction(record)
    _wake.set()  # a follow waiting on this job is checked now, not at the runner's next minute
    if failed_update:
        _follow_result(import_job['sourceWork'], 'failed', failed_update['error'])


def start(state_dir: str, enqueue):
    """Starts the runner; enqueue(account, name, write(path), extra fields) puts a file into the import queue."""
    global _state_dir, _enqueue
    _state_dir, _enqueue = state_dir, enqueue
    # Jobs interrupted by a restart go on from their cached chapters.
    database().transaction(lambda c: c.execute("UPDATE source_jobs SET state = 'queued' WHERE state = 'fetching'"))
    for site in ADAPTERS:
        threading.Thread(target=runner, args=(site,), daemon=True).start()
