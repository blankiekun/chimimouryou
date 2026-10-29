"""Tests for the migration from the WebDAV sync folders into library.db (server/api/migrate.py)."""

import gzip
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'api'))
import apidb  # noqa: E402

spec = importlib.util.spec_from_file_location(
    'api_migrate', os.path.join(os.path.dirname(__file__), '..', 'api', 'migrate.py'))
migrate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migrate)

ACCOUNT = '1a2b3c4d' * 4
PROGRESS = 'progress_1_6_1700000000000_0.4231.json'
STATISTICS = 'statistics_1_6_1700000000000_5000_3600000_10_12_20_30_1800000_1900000_2500_2600_40_41_na.json'
GOALS = 'ttu-user-goals_1_6_1700000000000.json'
BOOKDATA = 'bookdata_1_6_123456_1700000000000_1700000000001.zip'


def book(book_id, title):
    return {'id': book_id, 'key': f'uuid-{book_id}', 'title': title, 'authors': '', 'series': '',
            'seriesIndex': None, 'seriesInferred': False, 'tags': [], 'rating': None, 'publisher': '',
            'published': None, 'added': book_id, 'format': 'EPUB', 'vn': False, 'size': 1,
            'file': f'{book_id}/b.epub', 'cover': ''}


def zip_bytes(files: dict) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return out.getvalue()


class MigrateTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = tmp.name
        self.sync = os.path.join(root, 'sync')
        self.accounts = os.path.join(root, 'accounts')
        self.state = os.path.join(root, 'state', 'api')
        self.db_path = os.path.join(self.state, 'library.db')
        db = apidb.Database(self.db_path)
        db.transaction(lambda c: apidb.upsert_books(c, [book(1, 'a/b?'), book(2, '猫')], None, 1))
        self.ids = {row['unique_title']: row['id'] for row in db.query('SELECT id, unique_title FROM books')}
        db.connection.close()

        shared = os.path.join(self.sync, 'ttu-reader-data')
        self.write(shared, 'a%2Fb%3F', PROGRESS, {'progress': 0.4231, 'dataId': 1})
        self.write(shared, 'a%2Fb%3F', 'cover_1_6.jpeg', b'jpeg')
        self.write(shared, 'a%2Fb%3F', 'recaps.json', {'recaps': []})
        static = {'title': 'a/b?', 'elementHtml': '<p>x</p>', 'sections': [], 'styleSheet': '', 'htmlBackup': 'x'}
        self.write(shared, 'a%2Fb%3F', BOOKDATA,
                   zip_bytes({'staticdata.json': json.dumps(static), 'blobs/image.png': b'png'}))
        self.write(shared, '某タイトル', PROGRESS, {'progress': 0.1})
        self.write(shared, '猫', 'annotations.json', {'title': '猫', 'highlights': 'not a list'})
        self.write(self.sync, '', 'series.json', {'a/b?': {'series': 'S', 'modified': 5},
                                                  'missing': {'series': 'T', 'modified': 5}})
        self.write(self.sync, '', 'metadata.json', {'猫': {'description': 'd', 'modified': 6}})

        account = os.path.join(self.accounts, ACCOUNT, 'account', 'sync')
        data = os.path.join(account, 'ttu-reader-data')
        self.write(data, '猫', PROGRESS, {'progress': 0.4231})
        self.write(data, '猫', STATISTICS, [{'dateKey': '2026-10-01', 'lastStatisticModified': 1700000000000},
                                             {'dateKey': '2026-10-02', 'lastStatisticModified': 1700000000001}])
        self.write(data, '猫', 'annotations.json', {'title': '猫', 'highlights': [
            {'id': 'h1', 'modified': 3, 'text': '猫'}, {'id': 'h2', 'modified': 4, 'deleted': True}]})
        self.write(data, 'ゲーム', 'bookdata_1_6_0_1700000000009_1700000000009.zip', zip_bytes({'a': 'b'}))
        self.write(data, '', GOALS, [{'goalStartDate': '2026-10-01', 'lastGoalModified': 7}])
        self.write(account, '', 'settings.json', {'theme': {'values': 1, 'modified': 1}})
        os.makedirs(os.path.join(self.accounts, 'not-an-account'))

    @staticmethod
    def write(folder, sub, name, content):
        path = os.path.join(folder, sub, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(content if isinstance(content, bytes) else json.dumps(content).encode())

    def run_migrate(self, apply):
        with redirect_stdout(io.StringIO()) as out:
            report = migrate.run(self.sync, self.accounts, self.db_path, self.state, apply)
        self.output = out.getvalue()
        return report

    def db(self):
        db = apidb.Database(self.db_path)
        self.addCleanup(db.connection.close)
        return db

    def listing(self):
        # SQLite's own -wal/-shm files may appear when a read-only connection opens a WAL database.
        return sorted(os.path.relpath(os.path.join(d, f), self.state) for d, _, fs in os.walk(self.state) for f in fs
                      if not f.endswith(('-wal', '-shm')))

    def test_dry_run_writes_nothing(self):
        with open(self.db_path, 'rb') as f:
            before = f.read()
        listing = self.listing()
        report = self.run_migrate(False)
        with open(self.db_path, 'rb') as f:
            self.assertEqual(f.read(), before)
        self.assertEqual(self.listing(), listing)
        shared, account = report['sources']
        self.assertEqual((shared['account'], shared['folders'], shared['matched'], shared['orphans']),
                         ('', 3, 2, ['某タイトル']))
        self.assertEqual({k: shared['counts'][k] for k in ('progress', 'docs', 'text', 'skipped', 'errors')},
                         {'progress': 1, 'docs': 1, 'text': 1, 'skipped': 1, 'errors': 1})
        self.assertEqual({k: account['counts'][k] for k in
                          ('progress', 'statistics', 'goals', 'highlights', 'docs', 'games')},
                         {'progress': 1, 'statistics': 2, 'goals': 1, 'highlights': 2, 'docs': 1, 'games': 1})
        self.assertEqual(report['skippedAccounts'], ['not-an-account'])
        self.assertEqual((report['series'], report['seriesUnmatched']), (1, ['missing']))
        self.assertEqual(report['metadata'], 1)
        self.assertGreater(report['written'], 0)
        self.assertIn('dry run: nothing written', self.output)
        self.assertIn('某タイトル', self.output)

    def test_apply(self):
        report = self.run_migrate(True)
        db = self.db()
        cat, slash = self.ids['猫'], self.ids['a/b?']
        self.assertEqual([(r['account'], r['book'], r['progress']) for r in
                          db.query('SELECT * FROM progress ORDER BY account')],
                         [('', slash, 0.4231), (ACCOUNT, cat, 0.4231)])
        self.assertEqual([(r['account'], r['date_key']) for r in db.query('SELECT * FROM statistics')],
                         [(ACCOUNT, '2026-10-01'), (ACCOUNT, '2026-10-02')])
        self.assertEqual([(r['hid'], r['deleted'], r['modified']) for r in db.query('SELECT * FROM highlights')],
                         [('h1', 0, 3), ('h2', 1, 4)])
        self.assertEqual([(r['account'], r['goal_start'], r['modified']) for r in db.query('SELECT * FROM goals')],
                         [(ACCOUNT, '2026-10-01', 7)])
        self.assertEqual([(r['account'], r['kind']) for r in db.query('SELECT * FROM account_docs')],
                         [(ACCOUNT, 'settings')])
        self.assertEqual([(r['account'], r['book'], r['kind']) for r in db.query('SELECT * FROM book_docs')],
                         [('', slash, 'recaps')])
        self.assertEqual([(r['book'], r['series']) for r in db.query('SELECT * FROM series_overrides')], [(slash, 'S')])
        self.assertEqual([(r['book'], json.loads(r['data'])) for r in db.query('SELECT * FROM book_metadata')],
                         [(cat, {'description': 'd'})])
        self.assertEqual([(r['account'], r['name'], r['modified']) for r in db.query('SELECT * FROM games')],
                         [(ACCOUNT, 'ゲーム', 1700000000009)])
        self.assertTrue(os.path.exists(apidb.game_path(self.accounts, ACCOUNT, 'ゲーム')))
        with gzip.open(apidb.text_path(self.state, slash)) as f:
            self.assertEqual(sorted(json.load(f)), ['elementHtml', 'sections', 'styleSheet'])
        with open(os.path.join(self.state, 'migrate-report.json'), encoding='utf-8') as f:
            self.assertEqual(json.load(f)['sources'][0]['orphans'], ['某タイトル'])
        self.assertGreater(report['written'], 0)
        self.assertIn('applied:', self.output)

    def test_apply_twice_is_idempotent(self):
        self.run_migrate(True)
        rev = apidb.current_rev(self.db().connection)
        report = self.run_migrate(True)
        self.assertEqual(report['written'], 0)
        self.assertEqual(report['sources'][0]['counts']['textThere'], 1)
        self.assertEqual(apidb.current_rev(self.db().connection), rev)

    def test_newer_db_row_kept(self):
        db = self.db()
        db.transaction(lambda c: apidb.put_row(c, apidb.Rev(c), 'progress', {'account': ACCOUNT, 'book': self.ids['猫']},
                                               1800000000000, {'data': '{"newer":1}', 'progress': 0.9}))
        report = self.run_migrate(True)
        row = db.query('SELECT * FROM progress WHERE account = ?', (ACCOUNT,))[0]
        self.assertEqual((row['progress'], row['data']), (0.9, '{"newer":1}'))
        self.assertGreater(report['kept'], 0)

    def test_newest_progress_file_wins(self):
        folder = os.path.join(self.accounts, ACCOUNT, 'account', 'sync', 'ttu-reader-data')
        self.write(folder, '猫', 'progress_1_6_1700000000005_0.5.json', {'progress': 0.5, 'newest': True})
        self.run_migrate(True)
        row = self.db().query('SELECT * FROM progress WHERE account = ?', (ACCOUNT,))[0]
        self.assertEqual((row['modified'], row['progress'], json.loads(row['data'])['newest']),
                         (1700000000005, 0.5, True))

    def test_refuses_without_books(self):
        os.remove(self.db_path)
        for suffix in ('-wal', '-shm'):
            if os.path.exists(self.db_path + suffix):
                os.remove(self.db_path + suffix)
        apidb.Database(self.db_path).connection.close()
        listing = self.listing()
        with redirect_stdout(io.StringIO()) as out:
            self.assertEqual(migrate.main(['--apply', '--sync', self.sync, '--accounts', self.accounts,
                                           '--db', self.db_path, '--state', self.state]), 1)
        self.assertIn('no books in library.db yet', out.getvalue())
        self.assertEqual(self.listing(), listing)
        with redirect_stdout(io.StringIO()):
            self.assertEqual(migrate.main(['--db', os.path.join(self.state, 'none.db'), '--sync', self.sync,
                                           '--accounts', self.accounts, '--state', self.state]), 1)
        self.assertFalse(os.path.exists(os.path.join(self.state, 'none.db')))


if __name__ == '__main__':
    unittest.main()
