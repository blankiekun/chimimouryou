"""The API database (state/api/library.db): schema, connection, rev counter and the one write rule.

The api service, the catalog builder and the migration all write through this module, so a row is only ever
replaced by one with a newer `modified`, and every change takes the next value of the shared rev counter.
"""

import hashlib
import json
import os
import tempfile
import re
import sqlite3
import threading

ACCOUNT_RE = re.compile(r'[0-9a-f]{32}')
DATE_RE = re.compile(r'\d{4}-\d{2}-\d{2}')
HID_RE = re.compile(r'[A-Za-z0-9-]{1,100}')

# The doc kinds each table holds, shared with the app (apps/web/src/lib/data/remote/server-rows.ts, checked by
# sync-kinds.test.ts); service.py's routes and migrate.py's file maps read it too.
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sync-kinds.json'), encoding='utf-8') as f:
    SYNC_KINDS = json.load(f)
DOC_KINDS = {
    'book_docs': {*SYNC_KINDS['bookDocs'].values(), *SYNC_KINDS['mediaDocs'].values()},
    'account_docs': set(SYNC_KINDS['accountDocs'].values()),
    'game_docs': set(SYNC_KINDS['gameDocs']),
}

SCHEMA = '''
CREATE TABLE IF NOT EXISTS sync_counter (id INTEGER PRIMARY KEY CHECK (id = 1), rev INTEGER NOT NULL);
INSERT OR IGNORE INTO sync_counter VALUES (1, 0);

CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    calibre_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    unique_title TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '',
    series TEXT NOT NULL DEFAULT '',
    series_index REAL,
    series_inferred INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    rating REAL,
    publisher TEXT NOT NULL DEFAULT '',
    published INTEGER,
    added INTEGER NOT NULL DEFAULT 0,
    format TEXT NOT NULL,
    file TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    cover TEXT NOT NULL DEFAULT '',
    vn INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    rev INTEGER NOT NULL
);
-- Unique among live books only: a deleted book keeps its title until it comes back or another takes it.
CREATE UNIQUE INDEX IF NOT EXISTS books_live_title ON books(unique_title) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS books_rev ON books(rev);
CREATE INDEX IF NOT EXISTS books_order ON books(added DESC, id DESC) WHERE deleted = 0;

CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
    title, authors, series, content='books', content_rowid='id', tokenize='trigram');
CREATE TRIGGER IF NOT EXISTS books_ai AFTER INSERT ON books BEGIN
    INSERT INTO books_fts(rowid, title, authors, series) VALUES (new.id, new.title, new.authors, new.series);
END;
CREATE TRIGGER IF NOT EXISTS books_ad AFTER DELETE ON books BEGIN
    INSERT INTO books_fts(books_fts, rowid, title, authors, series)
    VALUES ('delete', old.id, old.title, old.authors, old.series);
END;
CREATE TRIGGER IF NOT EXISTS books_au AFTER UPDATE OF title, authors, series ON books BEGIN
    INSERT INTO books_fts(books_fts, rowid, title, authors, series)
    VALUES ('delete', old.id, old.title, old.authors, old.series);
    INSERT INTO books_fts(rowid, title, authors, series) VALUES (new.id, new.title, new.authors, new.series);
END;

CREATE TABLE IF NOT EXISTS progress (
    account TEXT NOT NULL, book INTEGER NOT NULL REFERENCES books(id), data TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0, modified INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (account, book));
CREATE TABLE IF NOT EXISTS statistics (
    account TEXT NOT NULL, book INTEGER NOT NULL REFERENCES books(id), date_key TEXT NOT NULL, data TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, modified INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (account, book, date_key));
CREATE TABLE IF NOT EXISTS goals (
    account TEXT NOT NULL, goal_start TEXT NOT NULL, data TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, modified INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (account, goal_start));
CREATE TABLE IF NOT EXISTS highlights (
    account TEXT NOT NULL, book INTEGER NOT NULL REFERENCES books(id), hid TEXT NOT NULL, data TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, modified INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (account, book, hid));
CREATE TABLE IF NOT EXISTS book_docs (
    account TEXT NOT NULL, book INTEGER NOT NULL REFERENCES books(id),
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    modified INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (account, book, kind));
CREATE TABLE IF NOT EXISTS account_docs (
    account TEXT NOT NULL, kind TEXT NOT NULL,
    data TEXT NOT NULL, modified INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (account, kind));
CREATE TABLE IF NOT EXISTS games (
    account TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0, modified INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (account, name));
-- A Windows game's progress, statistics and saves (the whole file its sync folder held) and details (no book id).
CREATE TABLE IF NOT EXISTS game_docs (
    account TEXT NOT NULL, name TEXT NOT NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
    modified INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (account, name, kind));
CREATE TABLE IF NOT EXISTS series_overrides (
    book INTEGER PRIMARY KEY REFERENCES books(id), series TEXT NOT NULL,
    modified INTEGER NOT NULL, rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS book_metadata (
    book INTEGER PRIMARY KEY REFERENCES books(id), data TEXT NOT NULL,
    modified INTEGER NOT NULL, rev INTEGER NOT NULL);

-- Sources (the import service, server/import/sources/): works fetched from sites, their volumes in Calibre and
-- the fetch jobs. Not synced (no rev): the Sources pages ask the import service.
CREATE TABLE IF NOT EXISTS works (
    id INTEGER PRIMARY KEY, site TEXT NOT NULL, work_key TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '', authors TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'novel' CHECK (kind IN ('novel', 'manga')), url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ongoing', chapters INTEGER NOT NULL DEFAULT 0,
    per TEXT NOT NULL DEFAULT 'volume', volume_size INTEGER, cover TEXT NOT NULL DEFAULT '',
    updated INTEGER NOT NULL DEFAULT 0,
    UNIQUE (site, work_key));
CREATE TABLE IF NOT EXISTS work_volumes (
    work INTEGER NOT NULL REFERENCES works(id), number INTEGER NOT NULL,
    first_ch INTEGER NOT NULL, last_ch INTEGER NOT NULL, calibre_id INTEGER,
    complete INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (work, number));
-- volumes: the volume numbers still to fetch (JSON); done/total count units (chapters) of the whole job.
CREATE TABLE IF NOT EXISTS source_jobs (
    id TEXT PRIMARY KEY, account TEXT NOT NULL, work INTEGER NOT NULL REFERENCES works(id),
    kind TEXT NOT NULL, volumes TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'chapters',
    done INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL,
    error TEXT NOT NULL DEFAULT '', failed_at INTEGER, created INTEGER NOT NULL, updated INTEGER NOT NULL);
-- Servers a reader added as sources (OPDS catalogs, Suwayomi), private to that account. secret: the password,
-- encrypted with SOURCES_SECRET_KEY (sources/servers/__init__.py), never sent back. Removed ones stay (deleted = 1,
-- no secret) so adding the same address again finds its works.
CREATE TABLE IF NOT EXISTS source_servers (
    id INTEGER PRIMARY KEY, account TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('opds', 'suwayomi')),
    name TEXT NOT NULL, url TEXT NOT NULL, user TEXT NOT NULL DEFAULT '', secret TEXT NOT NULL DEFAULT '',
    deleted INTEGER NOT NULL DEFAULT 0, modified INTEGER NOT NULL,
    UNIQUE (account, url));
-- A server work's items (OPDS entry ids) by number. Whole files keep their volume number when the feed gains or
-- reorders entries (new ones get the next numbers); for page manga, the chapter ids fetched under each number, which
-- the import service checks before replacing a volume.
CREATE TABLE IF NOT EXISTS work_items (
    work INTEGER NOT NULL REFERENCES works(id), number INTEGER NOT NULL, item TEXT NOT NULL,
    PRIMARY KEY (work, number), UNIQUE (work, item));
-- A reader following a work (per account): the import service checks it every SOURCES_CHECK_HOURS. state: '' (not
-- checked yet), current, new (detail: what the last check added), failed, removed. device '' = the server timer.
CREATE TABLE IF NOT EXISTS follows (
    account TEXT NOT NULL, work INTEGER NOT NULL REFERENCES works(id), device TEXT NOT NULL DEFAULT '',
    paused INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '',
    last_check INTEGER, next_check INTEGER, modified INTEGER NOT NULL,
    PRIMARY KEY (account, work));

CREATE INDEX IF NOT EXISTS progress_rev ON progress(account, rev);
CREATE INDEX IF NOT EXISTS statistics_rev ON statistics(account, rev);
CREATE INDEX IF NOT EXISTS goals_rev ON goals(account, rev);
CREATE INDEX IF NOT EXISTS highlights_rev ON highlights(account, rev);
CREATE INDEX IF NOT EXISTS book_docs_rev ON book_docs(account, rev);
CREATE INDEX IF NOT EXISTS account_docs_rev ON account_docs(account, rev);
CREATE INDEX IF NOT EXISTS games_rev ON games(account, rev);
CREATE INDEX IF NOT EXISTS game_docs_rev ON game_docs(account, rev);
CREATE INDEX IF NOT EXISTS series_overrides_rev ON series_overrides(rev);
CREATE INDEX IF NOT EXISTS book_metadata_rev ON book_metadata(rev);
'''

TABLE_KEYS: dict[str, tuple[str, ...]] = {
    'progress': ('account', 'book'),
    'statistics': ('account', 'book', 'date_key'),
    'goals': ('account', 'goal_start'),
    'highlights': ('account', 'book', 'hid'),
    'book_docs': ('account', 'book', 'kind'),
    'account_docs': ('account', 'kind'),
    'games': ('account', 'name'),
    'game_docs': ('account', 'name', 'kind'),
    'series_overrides': ('book',),
    'book_metadata': ('book',),
}


def drop_kind_checks(connection: sqlite3.Connection):
    """Databases from before sync-kinds.json: their doc tables CHECK the kinds of then, which would refuse a new
    one. Each is made again without (create, copy, drop, rename in one transaction); put_row checks kinds now.
    shortcut: drop this once every install has opened its database with it (owner's call)."""
    for table in DOC_KINDS:
        sql = connection.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
                                 (table,)).fetchone()[0]
        if 'CHECK (kind IN' not in sql:
            continue
        # foreign_keys can't change inside a transaction; nothing references these tables.
        connection.execute('PRAGMA foreign_keys = OFF')
        try:
            connection.execute('BEGIN IMMEDIATE')
            try:
                # Another process may have rebuilt it meanwhile.
                sql = connection.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
                                         (table,)).fetchone()[0]
                if 'CHECK (kind IN' in sql:
                    new_sql = re.sub(r' CHECK \(kind IN \([^)]*\)\)', '', sql)
                    new_sql = re.sub(rf'^CREATE TABLE {table}\b', f'CREATE TABLE {table}_new', new_sql)
                    connection.execute(new_sql)
                    connection.execute(f'INSERT INTO {table}_new SELECT * FROM {table}')
                    connection.execute(f'DROP TABLE {table}')
                    connection.execute(f'ALTER TABLE {table}_new RENAME TO {table}')
                    connection.execute(f'CREATE INDEX IF NOT EXISTS {table}_rev ON {table}(account, rev)')
                connection.execute('COMMIT')
            except BaseException:
                connection.execute('ROLLBACK')
                raise
        finally:
            connection.execute('PRAGMA foreign_keys = ON')


def check_fts5_trigram(connection: sqlite3.Connection):
    try:
        connection.execute("CREATE VIRTUAL TABLE temp.fts5_check USING fts5(a, tokenize='trigram')")
        connection.execute('DROP TABLE temp.fts5_check')
    except sqlite3.OperationalError as error:
        raise RuntimeError(f'SQLite without FTS5 trigram: {sqlite3.sqlite_version} ({error})') from error


class Database:
    """One connection shared by the request threads, serialized by a lock."""

    def __init__(self, path: str):
        old_umask = os.umask(0o077)
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            self.connection = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        finally:
            os.umask(old_umask)
        self.connection.row_factory = sqlite3.Row
        # The catalog builder and the migration write from other processes.
        self.connection.execute('PRAGMA busy_timeout = 10000')
        check_fts5_trigram(self.connection)
        self.connection.execute('PRAGMA journal_mode = WAL')
        self.connection.execute('PRAGMA foreign_keys = ON')
        self.connection.executescript(SCHEMA)
        # Databases from before statistics and goal deletes.
        for table in ('statistics', 'goals'):
            columns = [row['name'] for row in self.connection.execute(f'PRAGMA table_info({table})')]
            if 'deleted' not in columns:
                self.connection.execute(f'ALTER TABLE {table} ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0')
        drop_kind_checks(self.connection)
        self.lock = threading.Lock()

    def query(self, sql: str, params=()) -> list[sqlite3.Row]:
        with self.lock:
            return self.connection.execute(sql, params).fetchall()

    def transaction(self, work):
        """Calls work(connection) in one transaction, so reads and writes can't interleave with other threads."""
        with self.lock:
            self.connection.execute('BEGIN IMMEDIATE')
            try:
                result = work(self.connection)
                self.connection.execute('COMMIT')
                return result
            except BaseException:
                self.connection.execute('ROLLBACK')
                raise


class Rev:
    """The next rev, taken at most once per transaction: every row a transaction writes gets the same one."""

    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection
        self.value: int | None = None

    def __call__(self) -> int:
        if self.value is None:
            self.value = self.connection.execute(
                'UPDATE sync_counter SET rev = rev + 1 WHERE id = 1 RETURNING rev').fetchone()[0]
        return self.value


def current_rev(connection: sqlite3.Connection) -> int:
    return connection.execute('SELECT rev FROM sync_counter WHERE id = 1').fetchone()[0]


def put_row(connection: sqlite3.Connection, rev: Rev, table: str, key: dict, modified: int,
            values: dict) -> tuple[str, sqlite3.Row | None]:
    """Writes a row unless the stored one is as new or newer: 'written', 'same' (equal modified, nothing
    written, so clients don't loop on a bumped rev) or 'conflict' (stored newer). On equal modified a tombstone
    still replaces a live row, so a delete is never lost to a tie. Returns the stored row after."""
    if table not in TABLE_KEYS:
        raise ValueError(f'unknown table {table}')
    key_columns = TABLE_KEYS[table]
    if set(key) != set(key_columns):
        raise ValueError(f'{table} is keyed by {key_columns}')
    if table in DOC_KINDS and key['kind'] not in DOC_KINDS[table]:
        raise ValueError(f'unknown {table} kind {key["kind"]}')
    where = ' AND '.join(f'{column} = ?' for column in key_columns)
    key_values = tuple(key[column] for column in key_columns)
    stored = connection.execute(f'SELECT * FROM {table} WHERE {where}', key_values).fetchone()
    if stored is not None and stored['modified'] == modified and not (values.get('deleted') and not stored['deleted']):
        return 'same', stored
    if stored is not None and stored['modified'] > modified:
        return 'conflict', stored
    columns = list(key_columns) + list(values) + ['modified', 'rev']
    params = key_values + tuple(values.values()) + (modified, rev())
    updates = ', '.join(f'{column} = excluded.{column}' for column in list(values) + ['modified', 'rev'])
    connection.execute(
        f'INSERT INTO {table} ({", ".join(columns)}) VALUES ({", ".join("?" * len(columns))}) '
        f'ON CONFLICT ({", ".join(key_columns)}) DO UPDATE SET {updates}', params)
    return 'written', connection.execute(f'SELECT * FROM {table} WHERE {where}', key_values).fetchone()


def to_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def book_columns(book: dict) -> dict:
    """books columns (besides key, unique_title and the bookkeeping ones) from a catalog builder dict."""
    return {
        'calibre_id': book['id'], 'title': book['title'], 'authors': book['authors'], 'series': book['series'],
        'series_index': book['seriesIndex'], 'series_inferred': int(bool(book['seriesInferred'])),
        'tags': to_json(book['tags']), 'rating': book['rating'], 'publisher': book['publisher'],
        'published': book['published'], 'added': book['added'], 'format': book['format'], 'file': book['file'],
        'size': book['size'] or 0, 'cover': book['cover'], 'vn': int(bool(book['vn'])),
    }


def upsert_books(connection: sqlite3.Connection, books: list[dict], seed_titles: dict[str, str] | None,
                 now_ms: int) -> dict[str, str]:
    """Brings the books table in line with the catalog builder's list (dicts with 'key') and returns
    key -> unique_title of every live book. A book keeps its unique title for good; a new book with a taken
    title gets ' (authors)', then ' [calibre id]'. Books gone from the list are soft-deleted, never removed,
    so their rows and data come back with them. Call inside a transaction."""
    rev = Rev(connection)
    stored = {row['key']: row for row in connection.execute('SELECT * FROM books')}
    listed = {book['key']: book for book in books}
    taken = {row['unique_title'] for row in stored.values() if not row['deleted'] and row['key'] in listed}

    for key, row in stored.items():
        if key not in listed and not row['deleted']:
            connection.execute('UPDATE books SET deleted = 1, updated = ?, rev = ? WHERE id = ?',
                               (now_ms, rev(), row['id']))

    def free_title(book: dict, preferred: str | None) -> str:
        candidates = [preferred] if preferred else []
        candidate = book['title']
        candidates.append(candidate)
        if book['authors']:
            candidate = f"{candidate} ({book['authors']})"
            candidates.append(candidate)
        while True:
            for title in candidates:
                if title not in taken:
                    taken.add(title)
                    return title
            candidate = f"{candidate} [{book['id']}]"
            candidates = [candidate]

    # Returning books first, so they get their old titles back before a new book can take them.
    order = sorted(listed.values(), key=lambda b: (b['key'] not in stored, -b['added'], -b['id']))
    for book in order:
        columns = book_columns(book)
        row = stored.get(book['key'])
        if row is None:
            unique_title = free_title(book, (seed_titles or {}).get(book['key']))
            names = ['key', 'unique_title', *columns, 'updated', 'rev']
            connection.execute(
                f'INSERT INTO books ({", ".join(names)}) VALUES ({", ".join("?" * len(names))})',
                (book['key'], unique_title, *columns.values(), now_ms, rev()))
            continue
        changes = {name: value for name, value in columns.items() if row[name] != value}
        if row['deleted']:
            changes['deleted'] = 0
            changes['unique_title'] = free_title(book, row['unique_title'])
        if changes:
            assignments = ', '.join(f'{name} = ?' for name in changes)
            connection.execute(f'UPDATE books SET {assignments}, updated = ?, rev = ? WHERE id = ?',
                               (*changes.values(), now_ms, rev(), row['id']))
    return {row['key']: row['unique_title']
            for row in connection.execute('SELECT key, unique_title FROM books WHERE deleted = 0')}


def text_path(state_dir: str, book_id: int) -> str:
    """A book's text copy (the client's parsed HTML without images), gzipped JSON."""
    return os.path.join(state_dir, 'text', f'{book_id}.json.gz')


def game_path(accounts_dir: str, account: str, name: str) -> str:
    """A Windows game record (they aren't catalog books, so they go by title, hashed for the file name)."""
    return os.path.join(accounts_dir, account, 'games', hashlib.sha256(name.encode()).hexdigest()[:32] + '.zip')


def write_atomic(path: str, data: bytes):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix='.tmp-')
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise
