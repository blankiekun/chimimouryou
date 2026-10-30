"""Tests for the API database: schema, FTS5, the rev counter and the newer-modified-wins rule."""

import os
import sys
import tempfile
import unittest
import unittest.mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'api'))
import apidb  # noqa: E402


def add_book(connection, rev, title='吾輩は猫である', key='k1'):
    connection.execute(
        'INSERT INTO books (key, calibre_id, title, unique_title, format, file, updated, rev) '
        "VALUES (?, 1, ?, ?, 'epub', 'a.epub', 0, ?)", (key, title, title, rev()))
    return connection.execute('SELECT id FROM books WHERE key = ?', (key,)).fetchone()['id']


class ApiDbTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, 'api', 'library.db')
        self.db = apidb.Database(self.path)

    def tearDown(self):
        self.db.connection.close()
        self.tmp.cleanup()

    def test_schema_twice(self):
        again = apidb.Database(self.path)
        self.assertEqual(again.query('PRAGMA journal_mode')[0][0], 'wal')
        again.connection.close()

    # Bug caught: a library.db made by PR2 (no deleted column) would fail every statistics/goal write.
    def test_adds_deleted_to_old_schema(self):
        path = os.path.join(self.tmp.name, 'old', 'library.db')
        os.makedirs(os.path.dirname(path))
        import sqlite3
        old = sqlite3.connect(path)
        old.executescript('''
            CREATE TABLE statistics (account TEXT NOT NULL, book INTEGER NOT NULL, date_key TEXT NOT NULL,
                data TEXT NOT NULL, modified INTEGER NOT NULL, rev INTEGER NOT NULL,
                PRIMARY KEY (account, book, date_key));
            CREATE TABLE goals (account TEXT NOT NULL, goal_start TEXT NOT NULL, data TEXT NOT NULL,
                modified INTEGER NOT NULL, rev INTEGER NOT NULL, PRIMARY KEY (account, goal_start));
            INSERT INTO statistics VALUES ('', 1, '2026-10-01', '{"x":1}', 5, 1);
            INSERT INTO goals VALUES ('', '2026-10-01', '{}', 5, 1);''')
        old.commit()
        old.close()
        upgraded = apidb.Database(path)
        self.addCleanup(upgraded.connection.close)
        for table in ('statistics', 'goals'):
            [row] = upgraded.query(f'SELECT data, deleted FROM {table}')
            self.assertEqual(row['deleted'], 0)
        self.assertEqual(upgraded.query('SELECT data FROM statistics')[0][0], '{"x":1}')

    # Catches a transaction that raises halfway leaving partial rows, a used-up rev, or a stuck BEGIN or
    # lock: one connection serves every request thread, so that would block all writes until a restart.
    def test_a_failed_transaction_rolls_back_and_frees_the_lock(self):
        rev = apidb.current_rev(self.db.connection)

        def work(connection):
            add_book(connection, apidb.Rev(connection))
            raise ValueError('halfway')

        with self.assertRaises(ValueError):
            self.db.transaction(work)
        self.assertEqual(self.db.query('SELECT count(*) FROM books')[0][0], 0)
        self.assertEqual(apidb.current_rev(self.db.connection), rev)
        self.assertFalse(self.db.lock.locked())
        self.assertFalse(self.db.connection.in_transaction)
        self.db.transaction(lambda c: add_book(c, apidb.Rev(c)))
        self.assertEqual(apidb.current_rev(self.db.connection), rev + 1)

    def test_fts5_trigram(self):
        book = self.db.transaction(lambda c: add_book(c, apidb.Rev(c)))
        match = "SELECT rowid FROM books_fts WHERE books_fts MATCH '\"猫であ\"'"
        self.assertEqual([row[0] for row in self.db.query(match)], [book])
        self.db.transaction(lambda c: c.execute("UPDATE books SET title = '坊っちゃん' WHERE id = ?", (book,)))
        self.assertEqual(self.db.query(match), [])

    def test_rev_once_per_transaction(self):
        def two(c):
            rev = apidb.Rev(c)
            book = add_book(c, rev)
            apidb.put_row(c, rev, 'progress', {'account': '', 'book': book}, 1, {'data': '{}', 'progress': 0})
            apidb.put_row(c, rev, 'book_docs', {'account': '', 'book': book, 'kind': 'recaps'}, 1, {'data': '{}'})
            return book
        book = self.db.transaction(two)
        self.assertEqual(self.db.query('SELECT rev FROM progress')[0][0], 1)
        self.assertEqual(self.db.query('SELECT rev FROM book_docs')[0][0], 1)
        self.db.transaction(lambda c: apidb.put_row(
            c, apidb.Rev(c), 'progress', {'account': '', 'book': book}, 2, {'data': '{}', 'progress': 0}))
        self.assertEqual(self.db.query('SELECT rev FROM progress')[0][0], 2)
        self.assertEqual(apidb.current_rev(self.db.connection), 2)

    def test_put_row_rules(self):
        book = self.db.transaction(lambda c: add_book(c, apidb.Rev(c)))
        key = {'account': 'a' * 32, 'book': book}

        def put(modified):
            return self.db.transaction(lambda c: apidb.put_row(
                c, apidb.Rev(c), 'progress', key, modified, {'data': '{"x":1}', 'progress': 0.5}))

        self.assertEqual(put(10)[0], 'written')
        rev = self.db.query('SELECT rev FROM progress')[0][0]
        self.assertEqual(put(10)[0], 'same')
        self.assertEqual(self.db.query('SELECT rev FROM progress')[0][0], rev)
        self.assertEqual(apidb.current_rev(self.db.connection), rev)
        status, row = put(5)
        self.assertEqual(status, 'conflict')
        self.assertEqual(row['modified'], 10)
        self.assertEqual(put(20)[0], 'written')
        row = self.db.query('SELECT modified, rev FROM progress')[0]
        self.assertEqual(row['modified'], 20)
        self.assertGreater(row['rev'], rev)

    # Bug: on equal modified the live row was kept as 'same', so a delete made in the same millisecond
    # as the stored edit never reached the server and the highlight came back on every device.
    def test_tombstone_wins_a_tie(self):
        book = self.db.transaction(lambda c: add_book(c, apidb.Rev(c)))
        key = {'account': 'a' * 32, 'book': book, 'hid': 'h1'}

        def put(deleted):
            return self.db.transaction(lambda c: apidb.put_row(
                c, apidb.Rev(c), 'highlights', key, 10, {'data': '{}', 'deleted': deleted}))

        self.assertEqual(put(0)[0], 'written')
        self.assertEqual(put(1)[0], 'written')
        self.assertEqual(put(0)[0], 'same')
        self.assertEqual(self.db.query('SELECT deleted FROM highlights')[0][0], 1)

    # Bugs caught: a library.db made before sync-kinds.json keeps its kind CHECKs (CREATE TABLE IF NOT EXISTS never
    # changes a table), so a kind added to the JSON is refused with a 500 there while fresh test DBs pass; the
    # rebuild losing or changing rows, dropping the rev index the sync reads by, or failing on the second open.
    def test_drops_old_kind_checks(self):
        path = os.path.join(self.tmp.name, 'checks', 'library.db')
        apidb.Database(path).connection.close()
        import sqlite3
        old = sqlite3.connect(path)
        # The doc tables as they were made before sync-kinds.json.
        old.executescript('''
            DROP TABLE book_docs; DROP TABLE account_docs; DROP TABLE game_docs;
            CREATE TABLE IF NOT EXISTS book_docs (
                account TEXT NOT NULL, book INTEGER NOT NULL REFERENCES books(id),
                kind TEXT NOT NULL CHECK (kind IN ('recaps', 'lorebook', 'vnsaves', 'audiobook', 'subtitles')),
                data TEXT NOT NULL,
                modified INTEGER NOT NULL, rev INTEGER NOT NULL,
                PRIMARY KEY (account, book, kind));
            CREATE TABLE IF NOT EXISTS account_docs (
                account TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('settings', 'kanji', 'words', 'immersion')),
                data TEXT NOT NULL, modified INTEGER NOT NULL, rev INTEGER NOT NULL,
                PRIMARY KEY (account, kind));
            CREATE TABLE IF NOT EXISTS game_docs (
                account TEXT NOT NULL, name TEXT NOT NULL,
                kind TEXT NOT NULL CHECK (kind IN ('progress', 'statistics', 'vnsaves')),
                data TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
                modified INTEGER NOT NULL, rev INTEGER NOT NULL,
                PRIMARY KEY (account, name, kind));
            CREATE INDEX book_docs_rev ON book_docs(account, rev);
            CREATE INDEX account_docs_rev ON account_docs(account, rev);
            CREATE INDEX game_docs_rev ON game_docs(account, rev);
            INSERT INTO books (id, key, calibre_id, title, unique_title, format, file, updated, rev)
                VALUES (1, 'k', 1, 't', 't', 'epub', 'a.epub', 0, 1);
            INSERT INTO book_docs VALUES ('a', 1, 'recaps', '{"r":1}', 5, 2);
            INSERT INTO account_docs VALUES ('a', 'words', '{"w":1}', 6, 3);
            INSERT INTO game_docs VALUES ('a', 'g', 'vnsaves', '{"g":1}', 0, 7, 4);''')
        old.commit()
        before = {table: old.execute(f'SELECT * FROM {table}').fetchall()
                  for table in ('book_docs', 'account_docs', 'game_docs')}
        old.close()
        for _ in range(2):
            upgraded = apidb.Database(path)
            for table, rows in before.items():
                self.assertEqual([tuple(row) for row in upgraded.query(f'SELECT * FROM {table}')], rows)
                self.assertTrue(upgraded.query("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
                                               (f'{table}_rev',)))
            upgraded.connection.close()
        upgraded = apidb.Database(path)
        self.addCleanup(upgraded.connection.close)
        with unittest.mock.patch.dict(apidb.DOC_KINDS, {'account_docs': {*apidb.DOC_KINDS['account_docs'], 'new'}}):
            self.assertEqual(upgraded.transaction(lambda c: apidb.put_row(
                c, apidb.Rev(c), 'account_docs', {'account': 'a', 'kind': 'new'}, 1, {'data': '{}'}))[0], 'written')

    # Bug caught: with the CHECKs gone, a writer (migration, a route regex changed by hand) storing a kind no
    # client reads; put_row refuses kinds outside sync-kinds.json.
    def test_refuses_unknown_kinds(self):
        with self.assertRaises(ValueError):
            self.db.transaction(lambda c: apidb.put_row(
                c, apidb.Rev(c), 'account_docs', {'account': 'a', 'kind': 'other'}, 1, {'data': '{}'}))

    def test_unknown_table(self):
        with self.assertRaises(ValueError):
            self.db.transaction(lambda c: apidb.put_row(c, apidb.Rev(c), 'users', {'id': 1}, 1, {}))


if __name__ == '__main__':
    unittest.main()
