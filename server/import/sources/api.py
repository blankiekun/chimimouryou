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
                                            adapter's COVER_HOSTS (or the work's server) and kept in
                                            <state>/sources/covers/
  GET  servers                           -> {servers: [{id, type, name, url, user, hasPassword}]}: own servers; the
                                            password never comes back
  POST servers {type, url, name, user, password}
                                         -> {server, tested: {title, entries}}: tests the catalog with the credentials,
                                            then adds it; 400 {error, field} says what to fix (url, password, type)
  PUT  servers/{id} {name?, user?, password?} -> {server}: new credentials are tested first
  DELETE servers/{id}                    -> {}: its follows and waiting jobs go; volumes stay in the library
  GET  servers/{id}/browse?section=&q=   -> {server, title, section, next, search, entries: [{kind: section | work |
                                            book, title, authors, href, workKey, cover, inLibrary, following}]}: a
                                            feed of the catalog (its root, a section's path, or a search)
  GET  servers/{id}/image?href=          -> an image on that server (browse covers; service.py sends it)

Job states: queued, fetching, adding (volumes in the import queue), done, failed (error, failed_at), cancelled.
Job kinds: add (volumes chosen by the reader) and update (a followed work's check). Chapters are cached in
<state>/sources/<work id>/<n>.json until their volume is full, so a retry resumes and the open volume is rebuilt
without fetching it again.

Runners: one per site, so a long job on one site doesn't hold up another (the fetcher keeps the per-host limit),
and one for every added server.

Servers (servers/opds.py; Suwayomi is an OPDS preset): private to the account that added them; their works are
works of site 'opds:<server id>' keyed by the series feed's path. "files" works are one volume per file, queued as
it came; "pages" works (manga) are CBZs of `per` chapter (one each) or volume (MANGA_VOLUME_SIZE chapters), a
choice that stays once a volume is in the library or on its way.

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
import re
import shutil
import sys
import threading
import time
import uuid
from urllib.parse import urlparse

import apidb  # server/api, put on sys.path by service.py

from . import build, fetcher, planner, servers
from .adapters import kakuyomu, syosetu
from .servers import opds

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
# Chapters per CBZ of a manga that comes as pages, one volume at a time.
MANGA_VOLUME_SIZE = 10
# The runner of every added server's jobs.
SERVERS = 'servers'


class ApiError(Exception):
    def __init__(self, status: int, message: str, field: str = ''):
        super().__init__(message)
        self.status = status
        self.field = field  # the form field it concerns (Add a source)


_db: apidb.Database | None = None
_db_lock = threading.Lock()
_details: dict[int, tuple[float, dict]] = {}
_searches: dict[tuple, tuple[float, dict]] = {}
_cover_failed: dict[int, float] = {}


class _Wake:
    """Wakes every site's runner."""
    def __init__(self):
        self.events = {site: threading.Event() for site in (*ADAPTERS, SERVERS)}

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

def _adapter(site: str):
    """The site's adapter, or the added server (opds:<id>) as one."""
    if site in ADAPTERS:
        return ADAPTERS[site]
    if site.startswith('opds:') and site[5:].isdigit():
        rows = database().query('SELECT * FROM source_servers WHERE id = ?', (int(site[5:]),))
        if rows:
            return opds.Server(dict(rows[0]))
    raise ApiError(404, 'No such site')


def _own_server(account: str, site: str) -> opds.Server:
    """The account's live server of site 'opds:<id>' (404 for anyone else's: servers are private)."""
    server = _adapter(site) if site.startswith('opds:') else None
    rows = server and database().query('SELECT account FROM source_servers WHERE id = ?', (server.id,))
    if not rows or rows[0]['account'] != account or server.deleted:
        raise ApiError(404, 'No such source')
    return server


def _check_access(work: dict, account: str):
    """A server's works are its owner's only."""
    if work['site'].startswith('opds:'):
        try:
            _own_server(account, work['site'])
        except ApiError as error:
            raise ApiError(404, 'No such work') from error


def _pages(work: dict) -> bool:
    """A server work that comes as page images (so per chapter or per volume can be chosen)."""
    return work['site'].startswith('opds:') and work['kind'] == 'manga' and (
        work['per'] == 'chapter' or (work['volume_size'] or 1) > 1)


def _fetch_details(work: dict) -> dict:
    """The site's details (cached 10 min), saved into the works row."""
    cached = _details.get(work['id'])
    if cached and time.monotonic() - cached[0] < DETAILS_SECONDS:
        return cached[1]
    details = _adapter(work['site']).details(work['url'])
    _details[work['id']] = (time.monotonic(), details)
    size = work['volume_size'] or planner.VOLUME_SIZE
    if details.get('mode') == 'files':
        size = 1
    elif details.get('mode') == 'pages':
        size = 1 if work['per'] == 'chapter' else MANGA_VOLUME_SIZE
    database().transaction(lambda c: c.execute(
        'UPDATE works SET title = ?, authors = ?, status = ?, chapters = ?, updated = ?, cover = ?, kind = ?, '
        'volume_size = ? WHERE id = ?',
        (details['title'], details['authors'], details['status'], details['chapters'], details['updated'],
         details.get('cover', ''), details.get('kind', work['kind']), size, work['id'])))
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
    adapter = _adapter(work['site'])
    server = work['site'].startswith('opds:')
    # Per chapter or per volume stays once anything of the work is in the library or on its way.
    choice = _pages(work) and not volumes and not jobs
    return {'id': work['id'], 'site': work['site'], 'siteName': adapter.NAME, 'workKey': work['work_key'],
            'url': work['url'], 'title': work['title'], 'authors': work['authors'], 'status': work['status'],
            'chapters': work['chapters'], 'updated': work['updated'],
            'summary': (details or {}).get('summary', ''), 'latest': (details or {}).get('latest', []),
            'volumeSize': work['volume_size'] or planner.VOLUME_SIZE, 'volumes': plan,
            'kind': work['kind'], 'per': work['per'], 'perChoice': MANGA_VOLUME_SIZE if choice else None,
            'server': adapter.id if server else None, 'files': server and not _pages(work),
            'domain': adapter.DOMAIN, 'interval': fetcher.SERVER_INTERVAL if server else fetcher.INTERVAL,
            'checkHours': CHECK_HOURS,
            'following': bool(followed), 'paused': bool(followed and followed[0]['paused']),
            'cover': bool(work['cover'])}


def _show(work: dict, account: str) -> dict:
    _check_access(work, account)
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
            return _show_new(_work_for(site, *found), account)
    raise ApiError(400, f"Not a link to a work on a supported site ({', '.join(a.NAME for a in ADAPTERS.values())})")


def _show_new(work: dict, account: str) -> dict:
    try:
        return _show(work, account)
    except ApiError:
        # A work the site doesn't have shouldn't stay as an empty row.
        if not work['title']:
            database().transaction(lambda c: c.execute(
                'DELETE FROM works WHERE id = ? AND title = \'\' AND NOT EXISTS '
                '(SELECT 1 FROM source_jobs WHERE work = ?)', (work['id'], work['id'])))
        raise


def resolve(body: dict, account: str) -> dict:
    site, key = body.get('site'), body.get('workKey')
    if not isinstance(site, str) or not isinstance(key, str) or len(key) > 2000:
        raise ApiError(400, 'Invalid request')
    if site.startswith('opds:'):
        server = _own_server(account, site)
        try:
            url = server.url(key)
        except ValueError as error:
            raise ApiError(400, str(error)) from error
        key = opds.work_key(server.type, url)
        return _show_new(_work_for(site, key, server.url(key)), account)
    if site not in ADAPTERS:
        raise ApiError(400, 'Invalid request')
    rows = database().query('SELECT * FROM works WHERE site = ? AND work_key = ?', (site, key))
    if rows:
        return _show(dict(rows[0]), account)
    return lookup({'url': ADAPTERS[site].work_url(key)}, account)


# Jobs ----------------------------------------------------------------------------------------------------

def _job_json(row) -> dict:
    adapter = _adapter(row['site'])
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


def _set_per(work: dict, per) -> dict:
    """A pages work's CBZs per chapter or per volume, while none of it is in the library or on its way."""
    if per not in ('volume', 'chapter'):
        raise ApiError(400, 'Invalid request')
    if per == work['per']:
        return work
    if not _pages(work):
        raise ApiError(400, 'This work comes as whole files')
    if not _work_json(work, None)['perChoice']:
        raise ApiError(409, f"Some of it is already in the library: it stays one CBZ per {work['per']}")
    database().transaction(lambda c: c.execute('UPDATE works SET per = ?, volume_size = ? WHERE id = ?', (
        per, 1 if per == 'chapter' else MANGA_VOLUME_SIZE, work['id'])))
    return _work_row(work['id'])


def add(account: str, work_id: int, body: dict) -> dict:
    work = _work_row(work_id)
    _check_access(work, account)
    numbers = body.get('volumes')
    if not isinstance(numbers, list) or not numbers or not all(type(n) is int for n in numbers):
        raise ApiError(400, 'Choose the volumes to add')
    if 'per' in body:
        work = _set_per(work, body['per'])
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
                  "VALUES (?, ?, ?, 'add', ?, ?, ?, 'queued', ?, ?)",
                  (job_id, account, work_id, json.dumps(wanted),
                   'volumes' if work['site'].startswith('opds:') and not _pages(work) else 'chapters', total, now, now))
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
    adapter = _adapter(row['site'])
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
    _check_access(_work_row(work_id), account)
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


_image_type = build.image_type


def cover(work_id: int, account: str) -> tuple[bytes, str]:
    """(image, content type) of the work's cover: fetched once from a host its adapter names (or its server), then
    kept on disk. Only JPEG, PNG, GIF and WebP pass, so a page the site sends instead is never served as an image."""
    work = _work_row(work_id)
    _check_access(work, account)
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
        adapter = _adapter(work['site'])
        data = (adapter.get(adapter.url(url), COVER_BYTES) if isinstance(adapter, opds.Server)
                else fetcher.fetch(url, adapter.COVER_HOSTS))[0]
        kind = _image_type(data)
        if not kind or len(data) > COVER_BYTES:
            raise ValueError('not an image')
    except (fetcher.FetchError, LookupError, ValueError) as error:
        _cover_failed[work_id] = time.monotonic()
        raise ApiError(404, 'No cover') from error
    os.makedirs(folder, exist_ok=True)
    for old in os.listdir(folder):  # an earlier cover of the work
        if old.startswith(prefix):
            os.remove(os.path.join(folder, old))
    apidb.write_atomic(path, data)
    return data, kind


# Servers -----------------------------------------------------------------------------------------------

def _server_json(row) -> dict:
    return {'id': row['id'], 'type': row['type'], 'name': row['name'], 'url': row['url'], 'user': row['user'],
            'hasPassword': bool(row['secret'])}


def list_servers(account: str) -> dict:
    rows = database().query('SELECT * FROM source_servers WHERE account = ? AND deleted = 0 ORDER BY name, id',
                            (account,))
    return {'servers': [_server_json(row) for row in rows]}


def _test(server: opds.Server) -> dict:
    """Reads the catalog's root with the server's credentials; 400 {field} saying what to fix."""
    label = 'Suwayomi' if server.type == 'suwayomi' else 'The catalog'
    try:
        feed = server.feed(server.root)
    except fetcher.FetchError as error:
        if error.status in (401, 403):
            raise ApiError(400, f'{label} refused the user name or password ({error.status}).', 'password') from error
        if error.reason:
            reason = re.sub(r'^\[Errno -?\d+\]\s*', '', error.reason).lower()
            what = 'Suwayomi' if server.type == 'suwayomi' else "the catalog's server"
            raise ApiError(400, f"Couldn't reach {server.DOMAIN} ({reason}). Is {what} running, and can this "
                                'server reach it?', 'url') from error
        raise ApiError(400, f'{error}. Check the address.', 'url') from error
    except opds.NotCatalog as error:
        where = "Suwayomi's is at /api/opds/v1.2" if server.type == 'suwayomi' else "Komga's is at /opds/v1.2/catalog"
        raise ApiError(400, f'This address answered, but not with an OPDS catalog. {where}.', 'url') from error
    except servers.SecretError as error:
        raise ApiError(400, str(error), 'password') from error
    return {'title': feed['title'], 'entries': len(feed['entries'])}


def _text_field(body: dict, name: str, limit: int) -> str:
    value = body.get(name, '')
    if not isinstance(value, str) or len(value) > limit:
        raise ApiError(400, 'Too long' if isinstance(value, str) else 'Invalid request', name)
    return value.strip() if name != 'password' else value


def add_server(account: str, body: dict) -> dict:
    kind = body.get('type')
    if kind not in ('opds', 'suwayomi'):
        raise ApiError(400, 'Choose Suwayomi or OPDS catalog', 'type')
    url, name = _text_field(body, 'url', 2000), _text_field(body, 'name', 100)
    user, password = _text_field(body, 'user', 200), _text_field(body, 'password', 1000)
    parts = urlparse(url)
    if not fetcher.origin(url):
        raise ApiError(400, 'Use an address starting with http:// or https://.', 'url')
    if parts.username or parts.password:  # it would be kept as plain text
        raise ApiError(400, 'Put the user name and password in their fields, not in the address.', 'url')
    url = opds.catalog_url(kind, url)
    for row in database().query('SELECT * FROM source_servers WHERE account = ? AND deleted = 0', (account,)):
        if row['url'] == url:
            raise ApiError(400, f"This server is already in your sources as {row['name']}.", 'url')
    try:
        secret = servers.encrypt(password) if password else ''
    except servers.SecretError as error:
        raise ApiError(400, str(error), 'password') from error
    server = opds.Server({'id': 0, 'type': kind, 'url': url, 'name': name or parts.hostname, 'user': user,
                          'secret': secret, 'deleted': 0})
    tested = _test(server)
    name = name or tested['title'] or parts.hostname

    def save(c):
        # A server added again after being removed gets its old id back, so its works match again.
        c.execute('INSERT INTO source_servers (account, type, name, url, user, secret, deleted, modified) '
                  'VALUES (?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT (account, url) DO UPDATE SET type = excluded.type, '
                  'name = excluded.name, user = excluded.user, secret = excluded.secret, deleted = 0, '
                  'modified = excluded.modified', (account, kind, name, url, user, secret, now_ms()))
        return c.execute('SELECT * FROM source_servers WHERE account = ? AND url = ?', (account, url)).fetchone()
    return {'server': _server_json(database().transaction(save)), 'tested': tested}


def update_server(account: str, server_id: int, body: dict) -> dict:
    server = _own_server(account, f'opds:{server_id}')
    row = dict(database().query('SELECT * FROM source_servers WHERE id = ?', (server_id,))[0])
    if 'name' in body:
        row['name'] = _text_field(body, 'name', 100) or row['name']
    if 'user' in body or 'password' in body:
        row['user'] = _text_field(body, 'user', 200) if 'user' in body else row['user']
        if 'password' in body:  # else the saved one stays
            password = _text_field(body, 'password', 1000)
            try:
                row['secret'] = servers.encrypt(password) if password else ''
            except servers.SecretError as error:
                raise ApiError(400, str(error), 'password') from error
        _test(opds.Server(row))
    database().transaction(lambda c: c.execute(
        'UPDATE source_servers SET name = ?, user = ?, secret = ?, modified = ? WHERE id = ?',
        (row['name'], row['user'], row['secret'], now_ms(), server.id)))
    return {'server': _server_json(database().query('SELECT * FROM source_servers WHERE id = ?', (server_id,))[0])}


def delete_server(account: str, server_id: int) -> dict:
    server = _own_server(account, f'opds:{server_id}')

    def remove(c):
        works = 'SELECT id FROM works WHERE site = ?'
        c.execute("UPDATE source_servers SET deleted = 1, secret = '', modified = ? WHERE id = ?", (now_ms(), server.id))
        c.execute(f'DELETE FROM follows WHERE account = ? AND work IN ({works})', (account, server.SITE))
        c.execute(f"UPDATE source_jobs SET state = 'cancelled' WHERE account = ? AND state IN (?, ?) AND work IN "
                  f'({works})', (account, *ACTIVE, server.SITE))
    database().transaction(remove)
    return {}


def _path(server: opds.Server, href: str | None) -> str | None:
    """href as a path on the server (what the app sends back as a section), or None when it is elsewhere."""
    try:
        url = server.url(href) if href else None
    except ValueError:
        return None
    return url and opds.work_key('opds', url)


def browse_server(account: str, server_id: int, query: dict) -> dict:
    """A feed of the server's catalog: its root, a section (a path from an earlier answer) or a search."""
    server = _own_server(account, f'opds:{server_id}')
    section, q = (query.get('section') or '').strip(), (query.get('q') or '').strip()
    if len(section) > 2000 or len(q) > 200:
        raise ApiError(400, 'Invalid request')
    try:
        url = server.search_url(q) if q else server.url(section) if section else server.root
        feed = server.feed(url)
    except opds.NotCatalog as error:
        raise ApiError(503, 'The server answered, but not with an OPDS feed') from error
    except fetcher.FetchError as error:
        raise ApiError(503, str(error)) from error
    except LookupError as error:
        raise ApiError(404, str(error)) from error
    except ValueError as error:
        raise ApiError(400, str(error)) from error
    entries = []
    for entry in feed['entries']:
        if opds.is_item(entry):
            kind, href = 'book', None
        elif entry['nav'] and (href := _path(server, entry['nav'])):
            kind = 'work' if entry['navKind'] == 'acquisition' else 'section'
        else:
            continue
        key = opds.work_key(server.type, server.url(href or url))
        entries.append({'kind': kind, 'title': entry['title'], 'authors': entry['authors'], 'href': href,
                        'workKey': key if kind != 'section' else None, 'cover': _path(server, entry['cover'])})
    keys = list({e['workKey'] for e in entries if e['workKey']})
    marks = {row['work_key']: row for row in database().query(
        'SELECT w.work_key, EXISTS (SELECT 1 FROM work_volumes v JOIN books b ON b.calibre_id = v.calibre_id '
        'WHERE v.work = w.id AND b.deleted = 0) AS in_library, '
        'EXISTS (SELECT 1 FROM follows f WHERE f.work = w.id AND f.account = ?) AS following '
        f'FROM works w WHERE w.site = ? AND w.work_key IN ({", ".join("?" * len(keys))})',
        (account, server.SITE, *keys))} if keys else {}
    for entry in entries:
        mark = marks.get(entry['workKey'])
        entry.update(inLibrary=bool(mark and mark['in_library']), following=bool(mark and mark['following']))
    return {'server': {'id': server.id, 'name': server.NAME, 'type': server.type}, 'title': feed['title'],
            'section': _path(server, url), 'next': _path(server, feed['next']), 'search': bool(feed['search']),
            'entries': entries}


def server_image(account: str, server_id: int, href: str) -> tuple[bytes, str]:
    """(image, content type) of an image on the account's server (browse covers); 404 for anything else."""
    server = _own_server(account, f'opds:{server_id}')
    try:
        data = server.get(server.url(href), COVER_BYTES)[0]
    except (fetcher.FetchError, LookupError, ValueError) as error:
        raise ApiError(404, 'No image') from error
    if not (kind := _image_type(data)):
        raise ApiError(404, 'No image')
    return data, kind


def route(method: str, path: str, account: str, body: dict) -> dict:
    """path is relative to /sources (e.g. '/works/3/add'); body is the query of a GET."""
    parts = path.strip('/').split('/')
    if parts[0] == 'servers':
        if parts == ['servers']:
            if method == 'GET':
                return list_servers(account)
            if method == 'POST':
                return add_server(account, body)
        elif parts[1].isdigit():
            if method == 'PUT' and len(parts) == 2:
                return update_server(account, int(parts[1]), body)
            if method == 'DELETE' and len(parts) == 2:
                return delete_server(account, int(parts[1]))
            if method == 'GET' and parts[2:] == ['browse']:
                return browse_server(account, int(parts[1]), body)
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
    """Chapter n, from the cache or the site (then cached). A server's files and pages go into the folder <n>."""
    path = os.path.join(cache_dir(work['id']), f'{n}.json')
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        pass
    adapter = _adapter(work['site'])
    if isinstance(adapter, opds.Server):
        chapter = adapter.chapter(work['url'], n, details, os.path.join(cache_dir(work['id']), str(n)))
    else:
        chapter = adapter.chapter(work['url'], n, details)
    apidb.write_atomic(path, json.dumps(chapter, ensure_ascii=False).encode())
    return chapter


def _identifier(work: dict, number: int) -> str:
    # A server's work key is a path: its id stands in for it.
    return f"chimi:{work['site']}:{work['id'] if work['site'].startswith('opds:') else work['work_key']}:{number}"


def _queue_volume(job, work: dict, volume: dict, chapters: list[dict], last: bool):
    adapter = _adapter(work['site'])
    number = volume['number']
    title = f"{work['title']} {number}"
    kept = _kept_volumes(work['id']).get(number)
    folders = [os.path.join(cache_dir(work['id']), str(n)) for n in range(volume['first'], volume['last'] + 1)]
    ext = 'epub'

    def write(path):
        build.epub(path, title=title, authors=work['authors'], series=work['title'], series_index=number,
                   identifier=_identifier(work, number),
                   chapters=[{'title': c['title'], 'xhtml': c['html']} for c in chapters])
    if chapters and chapters[0].get('file'):  # a server's whole file, queued as it came
        ext = chapters[0]['file'].rsplit('.', 1)[1]

        def write(path):  # noqa: F811
            shutil.copyfile(os.path.join(folders[0], chapters[0]['file']), path)
    elif chapters and 'pages' in chapters[0]:
        ext = 'cbz'

        def write(path):  # noqa: F811
            build.cbz(path, title=title, authors=work['authors'], series=work['title'], number=number,
                      pages=[os.path.join(folder, page) for folder, c in zip(folders, chapters) for page in c['pages']])
    complete = int(volume['last'] - volume['first'] + 1 >= (work['volume_size'] or planner.VOLUME_SIZE))
    # The row's chapters and Calibre id change only once Calibre has the file (volume_added).
    database().transaction(lambda c: c.execute(
        'INSERT INTO work_volumes (work, number, first_ch, last_ch, complete) VALUES (?, ?, ?, ?, ?) '
        'ON CONFLICT (work, number) DO NOTHING', (work['id'], number, volume['first'], volume['last'], complete)))
    _enqueue(job['account'], f'{title}.{ext}', write, {
        'title': title, 'authors': work['authors'], 'series': work['title'], 'seriesIndex': number,
        'identifier': _identifier(work, number), 'tags': getattr(adapter, 'TAG', adapter.NAME),
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
                shutil.rmtree(os.path.join(cache_dir(work['id']), str(n)), ignore_errors=True)
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
    """Fetches the site's (or, for SERVERS, every added server's) queued jobs one at a time."""
    wake = _wake.events[site]
    where, params = ("w.site LIKE 'opds:%'", ()) if site == SERVERS else ('w.site = ?', (site,))
    while True:
        try:
            queue_due_checks(now_ms())
        except Exception as error:  # noqa: BLE001 - the runner goes on
            print(f'sources timer: {error!r}', file=sys.stderr)
        rows = database().query(f"{JOB_QUERY} WHERE j.state = 'queued' AND {where} ORDER BY j.created LIMIT 1",
                                params)
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
    for site in (*ADAPTERS, SERVERS):
        threading.Thread(target=runner, args=(site,), daemon=True).start()
