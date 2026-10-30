"""Tests for the API database: schema, FTS5, the rev counter and the newer-modified-wins rule."""

import os
import sys
import tempfile
import unittest

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

    def test_unknown_table(self):
        with self.assertRaises(ValueError):
            self.db.transaction(lambda c: apidb.put_row(c, apidb.Rev(c), 'users', {'id': 1}, 1, {}))


if __name__ == '__main__':
    unittest.main()
