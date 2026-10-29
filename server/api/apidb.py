"""The API database (state/api/library.db): schema, connection, rev counter and the one write rule.

The api service, the catalog builder and the migration all write through this module, so a row is only ever
replaced by one with a newer `modified`, and every change takes the next value of the shared rev counter.
"""

import os
import re
import sqlite3
import threading

ACCOUNT_RE = re.compile(r'[0-9a-f]{32}')

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
    modified INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (account, book, date_key));
CREATE TABLE IF NOT EXISTS goals (
    account TEXT NOT NULL, goal_start TEXT NOT NULL, data TEXT NOT NULL,
    modified INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (account, goal_start));
CREATE TABLE IF NOT EXISTS highlights (
    account TEXT NOT NULL, book INTEGER NOT NULL REFERENCES books(id), hid TEXT NOT NULL, data TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, modified INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (account, book, hid));
CREATE TABLE IF NOT EXISTS book_docs (
    account TEXT NOT NULL, book INTEGER NOT NULL REFERENCES books(id),
    kind TEXT NOT NULL CHECK (kind IN ('recaps', 'lorebook', 'vnsaves')), data TEXT NOT NULL,
    modified INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (account, book, kind));
CREATE TABLE IF NOT EXISTS account_docs (
    account TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('settings', 'kanji', 'words', 'immersion')),
    data TEXT NOT NULL, modified INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (account, kind));
CREATE TABLE IF NOT EXISTS games (
    account TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0, modified INTEGER NOT NULL, rev INTEGER NOT NULL,
    PRIMARY KEY (account, name));
CREATE TABLE IF NOT EXISTS series_overrides (
    book INTEGER PRIMARY KEY REFERENCES books(id), series TEXT NOT NULL,
    modified INTEGER NOT NULL, rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS book_metadata (
    book INTEGER PRIMARY KEY REFERENCES books(id), data TEXT NOT NULL,
    modified INTEGER NOT NULL, rev INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS progress_rev ON progress(account, rev);
CREATE INDEX IF NOT EXISTS statistics_rev ON statistics(account, rev);
CREATE INDEX IF NOT EXISTS goals_rev ON goals(account, rev);
CREATE INDEX IF NOT EXISTS highlights_rev ON highlights(account, rev);
CREATE INDEX IF NOT EXISTS book_docs_rev ON book_docs(account, rev);
CREATE INDEX IF NOT EXISTS account_docs_rev ON account_docs(account, rev);
CREATE INDEX IF NOT EXISTS games_rev ON games(account, rev);
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
    'series_overrides': ('book',),
    'book_metadata': ('book',),
}


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
    written, so clients don't loop on a bumped rev) or 'conflict' (stored newer). Returns the stored row after."""
    if table not in TABLE_KEYS:
        raise ValueError(f'unknown table {table}')
    key_columns = TABLE_KEYS[table]
    if set(key) != set(key_columns):
        raise ValueError(f'{table} is keyed by {key_columns}')
    where = ' AND '.join(f'{column} = ?' for column in key_columns)
    key_values = tuple(key[column] for column in key_columns)
    stored = connection.execute(f'SELECT * FROM {table} WHERE {where}', key_values).fetchone()
    if stored is not None and stored['modified'] == modified:
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
