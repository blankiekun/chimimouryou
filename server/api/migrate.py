#!/usr/bin/env python3
"""Copies the WebDAV sync folders (shared and per account) into library.db. Dry run unless --apply.

Book folders are matched to books by their unique title. Every row goes through the newer-`modified`-wins
rule, so running it again writes nothing and a newer row in the database is kept. The folders are left as
they are. Text copies come from the shared `bookdata_` zips (staticdata.json only, no images).
Usage: migrate.py [--apply] [--sync DIR] [--accounts DIR] [--db PATH] [--state DIR]
"""

import argparse
import gzip
import json
import os
import sqlite3
import sys
import urllib.request
import zipfile

import apidb
import syncnames

DATA_FOLDER = 'ttu-reader-data'
BOOK_DOCS = {'recaps.json': 'recaps', 'lorebook.json': 'lorebook', 'vnsaves.json': 'vnsaves'}
ACCOUNT_DOCS = {'settings.json': 'settings', 'kanji.json': 'kanji', 'words.json': 'words',
                'immersion.json': 'immersion'}
TEXT_KEYS = {'elementHtml': str, 'sections': list, 'styleSheet': str}
COUNTS = ('progress', 'statistics', 'goals', 'highlights', 'docs', 'text', 'textThere', 'games', 'skipped', 'errors')


def as_ms(value) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != int(value) or value < 0:
        raise ValueError(f'bad time {value!r}')
    return int(value)


def read_json(path: str):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def mtime_ms(path: str) -> int:
    return int(os.path.getmtime(path) * 1000)


def files_in(folder: str) -> list[str]:
    return sorted(entry.name for entry in os.scandir(folder) if entry.is_file()) if os.path.isdir(folder) else []


class Migration:
    def __init__(self, connection: sqlite3.Connection, apply: bool, state: str, accounts: str):
        self.connection, self.apply, self.state, self.accounts = connection, apply, state, accounts
        self.written = self.kept = 0
        self.titles: dict[str, int] = {}
        # Live books first: a deleted book only gets a folder whose title no live book holds.
        for row in connection.execute('SELECT id, unique_title FROM books ORDER BY deleted DESC, id'):
            self.titles[row['unique_title']] = row['id']

    def row(self, rev, table: str, key: dict, modified: int, values: dict) -> bool:
        """Writes (or in a dry run, checks) one row; True when it is (or would be) written."""
        if self.apply:
            status = apidb.put_row(self.connection, rev, table, key, modified, values)[0]
        else:
            where = ' AND '.join(f'{column} = ?' for column in key)
            stored = self.connection.execute(f'SELECT modified FROM {table} WHERE {where}',
                                             tuple(key.values())).fetchone()
            status = 'written' if stored is None or stored['modified'] < modified else 'kept'
        if status == 'written':
            self.written += 1
            return True
        self.kept += 1
        return False

    def source(self, account: str, data_dir: str, root_dir: str) -> dict:
        rev = apidb.Rev(self.connection)
        report = {'account': account, 'folders': 0, 'matched': 0, 'orphans': [], 'counts': dict.fromkeys(COUNTS, 0),
                  'errors': []}
        counts = report['counts']

        def guarded(where: str, work):
            try:
                work()
            except (OSError, ValueError, KeyError, TypeError, AttributeError, zipfile.BadZipFile) as error:
                counts['errors'] += 1
                report['errors'].append(f'{where}: {type(error).__name__}: {error}')

        folders = sorted(entry.name for entry in os.scandir(data_dir) if entry.is_dir()) \
            if os.path.isdir(data_dir) else []
        for folder in folders:
            report['folders'] += 1
            path = os.path.join(data_dir, folder)
            names = files_in(path)
            try:
                title = syncnames.desanitize_filename(folder)
            except UnicodeDecodeError:
                title = folder
            book = self.titles.get(title)
            if book is None:
                report['orphans'].append(title)
                game = syncnames.find_file(names, 'bookdata_')
                if account and game:  # a Windows game record: not a catalog book
                    guarded(f'{folder}/{game}', lambda: self.game(rev, account, title, os.path.join(path, game),
                                                                 counts))
                continue
            report['matched'] += 1
            used = set()
            for prefix in ('progress_', 'statistics_'):
                if name := syncnames.find_file(names, prefix):
                    used.add(name)
                    guarded(f'{folder}/{name}', lambda: getattr(self, prefix.rstrip('_'))(
                        rev, account, book, os.path.join(path, name), counts))
            for name in names:
                file = os.path.join(path, name)
                if name in used:
                    continue
                if name == 'annotations.json':
                    guarded(f'{folder}/{name}', lambda: self.highlights(rev, account, book, file, counts))
                elif name in BOOK_DOCS:
                    guarded(f'{folder}/{name}', lambda: self.book_doc(rev, account, book, BOOK_DOCS[name], file,
                                                                      counts))
                elif name.startswith('bookdata_') and not account and name == syncnames.find_file(names, 'bookdata_'):
                    guarded(f'{folder}/{name}', lambda: self.text(book, file, counts))
                else:
                    counts['skipped'] += 1

        root_names = files_in(data_dir)
        goals = syncnames.find_file(root_names, 'ttu-user-goals_')
        counts['skipped'] += len(root_names) - (1 if goals else 0)
        if goals:
            guarded(goals, lambda: self.goals(rev, account, os.path.join(data_dir, goals), counts))
        if account:
            for name in files_in(root_dir):
                if name in ACCOUNT_DOCS:
                    guarded(name, lambda: self.account_doc(rev, account, ACCOUNT_DOCS[name],
                                                           os.path.join(root_dir, name), counts))
        return report

    def progress(self, rev, account, book, file, counts):
        metadata = syncnames.progress_metadata(os.path.basename(file))
        data = read_json(file)
        counts['progress'] += 1
        self.row(rev, 'progress', {'account': account, 'book': book}, as_ms(metadata['lastBookmarkModified']),
                 {'data': apidb.to_json(data), 'progress': metadata['progress'] or 0})

    def statistics(self, rev, account, book, file, counts):
        entries = read_json(file)
        if not isinstance(entries, list):
            raise ValueError('not a list')
        for entry in entries:
            if not isinstance(entry.get('dateKey'), str):
                raise ValueError('entry without dateKey')
            counts['statistics'] += 1
            self.row(rev, 'statistics', {'account': account, 'book': book, 'date_key': entry['dateKey']},
                     as_ms(entry['lastStatisticModified']), {'data': apidb.to_json(entry), 'deleted': 0})

    def goals(self, rev, account, file, counts):
        entries = read_json(file)
        if not isinstance(entries, list):
            raise ValueError('not a list')
        for entry in entries:
            if not isinstance(entry.get('goalStartDate'), str):
                raise ValueError('entry without goalStartDate')
            counts['goals'] += 1
            self.row(rev, 'goals', {'account': account, 'goal_start': entry['goalStartDate']},
                     as_ms(entry['lastGoalModified']), {'data': apidb.to_json(entry), 'deleted': 0})

    def highlights(self, rev, account, book, file, counts):
        highlights = read_json(file).get('highlights')
        if not isinstance(highlights, list):
            raise ValueError('highlights is not a list')
        for highlight in highlights:
            if not apidb.HID_RE.fullmatch(str(highlight.get('id'))):
                raise ValueError(f"bad highlight id {highlight.get('id')!r}")
            counts['highlights'] += 1
            self.row(rev, 'highlights', {'account': account, 'book': book, 'hid': highlight['id']},
                     as_ms(highlight['modified']),
                     {'data': apidb.to_json(highlight), 'deleted': int(bool(highlight.get('deleted')))})

    def book_doc(self, rev, account, book, kind, file, counts):
        data = read_json(file)
        counts['docs'] += 1
        self.row(rev, 'book_docs', {'account': account, 'book': book, 'kind': kind}, mtime_ms(file),
                 {'data': apidb.to_json(data)})

    def account_doc(self, rev, account, kind, file, counts):
        data = read_json(file)
        counts['docs'] += 1
        self.row(rev, 'account_docs', {'account': account, 'kind': kind}, mtime_ms(file),
                 {'data': apidb.to_json(data)})

    def text(self, book, file, counts):
        counts['text'] += 1
        path = apidb.text_path(self.state, book)
        if os.path.exists(path):
            counts['textThere'] += 1
            return
        with zipfile.ZipFile(file) as archive:
            static = json.loads(archive.read('staticdata.json'))
        if not all(isinstance(static.get(key), kind) for key, kind in TEXT_KEYS.items()):
            raise ValueError('staticdata.json without elementHtml, sections and styleSheet')
        if self.apply:
            apidb.write_atomic(path, gzip.compress(apidb.to_json({key: static[key] for key in TEXT_KEYS}).encode()))

    def game(self, rev, account, name, file, counts):
        modified = as_ms(syncnames.book_metadata(os.path.basename(file))['lastBookModified'])
        counts['games'] += 1
        if self.row(rev, 'games', {'account': account, 'name': name}, modified,
                    {'size': os.path.getsize(file), 'deleted': 0}) and self.apply:
            with open(file, 'rb') as f:
                apidb.write_atomic(apidb.game_path(self.accounts, account, name), f.read())

    def shared(self, sync: str, report: dict):
        rev = apidb.Rev(self.connection)
        for name, table, key in (('series.json', 'series_overrides', 'series'),
                                 ('metadata.json', 'book_metadata', 'metadata')):
            report[key], report[key + 'Unmatched'] = 0, []
            path = os.path.join(sync, name)
            if not os.path.exists(path):
                continue
            try:
                entries = read_json(path)
                for title, entry in entries.items():
                    book = self.titles.get(title)
                    if book is None:
                        report[key + 'Unmatched'].append(title)
                        continue
                    modified = as_ms(entry['modified'])
                    if table == 'series_overrides':
                        if not isinstance(entry['series'], str):
                            raise ValueError(f'series of {title} is not a string')
                        values = {'series': entry['series']}
                    else:
                        values = {'data': apidb.to_json({k: v for k, v in entry.items() if k != 'modified'})}
                    report[key] += 1
                    self.row(rev, table, {'book': book}, modified, values)
            except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
                report['errors'].append(f'{name}: {type(error).__name__}: {error}')


def connect(db_path: str, apply: bool):
    if apply:
        db = apidb.Database(db_path)
        return db, db.connection
    # Read-only: a dry run never creates or changes the database.
    connection = sqlite3.connect(f'file:{urllib.request.pathname2url(os.path.abspath(db_path))}?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    return None, connection


def run(sync: str, accounts: str, db_path: str, state: str, apply: bool) -> dict | None:
    """Migrates (or with apply False, reports what it would); None when library.db has no books yet."""
    try:
        if not os.path.exists(db_path):
            raise sqlite3.OperationalError('no database')
        db, connection = connect(db_path, apply)
        if connection.execute('SELECT COUNT(*) FROM books').fetchone()[0] == 0:
            connection.close()
            raise sqlite3.OperationalError('no books')
    except sqlite3.OperationalError:
        # Mapping against no books would report every folder as an orphan.
        print('no books in library.db yet: run the catalog build first')
        return None

    try:
        migration = Migration(connection, apply, state, accounts)

        def in_transaction(work):
            return db.transaction(lambda _: work()) if apply else work()

        sources = [('', os.path.join(sync, DATA_FOLDER), sync)]
        skipped_accounts = []
        for entry in sorted(os.scandir(accounts), key=lambda e: e.name) if os.path.isdir(accounts) else []:
            if not entry.is_dir():
                continue
            if not apidb.ACCOUNT_RE.fullmatch(entry.name):
                skipped_accounts.append(entry.name)
                continue
            root = os.path.join(entry.path, 'account', 'sync')
            if os.path.isdir(root):
                sources.append((entry.name, os.path.join(root, DATA_FOLDER), root))
        report = {'applied': apply, 'sources': [], 'skippedAccounts': skipped_accounts, 'errors': []}
        for account, data_dir, root_dir in sources:
            report['sources'].append(in_transaction(lambda: migration.source(account, data_dir, root_dir)))
        in_transaction(lambda: migration.shared(sync, report))
        report['written'], report['kept'] = migration.written, migration.kept
    finally:
        connection.close()

    print_report(report)
    if apply:
        apidb.write_atomic(os.path.join(state, 'migrate-report.json'),
                           json.dumps(report, ensure_ascii=False, indent=1).encode())
    return report


def print_report(report: dict):
    for source in report['sources']:
        counts = source['counts']
        name = f"account {source['account'][:8]}…" if source['account'] else "shared ('')"
        print(f"{name}: {source['folders']} folders, {source['matched']} matched, {len(source['orphans'])} orphans")
        print(f"  progress {counts['progress']}, statistics {counts['statistics']}, goals {counts['goals']}, "
              f"highlights {counts['highlights']}, docs {counts['docs']}, "
              f"text {counts['text']} ({counts['textThere']} already there), games {counts['games']}, "
              f"skipped {counts['skipped']}, errors {counts['errors']}")
        if source['orphans']:
            print(f"  orphans: {', '.join(source['orphans'])}")
        for error in source['errors']:
            print(f'  error: {error}')
    games = sum(source['counts']['games'] for source in report['sources'])
    print(f"games {games}, series {report['series']} ({len(report['seriesUnmatched'])} unmatched), "
          f"metadata {report['metadata']} ({len(report['metadataUnmatched'])} unmatched)")
    if report['skippedAccounts']:
        print(f"skipped account folders: {', '.join(report['skippedAccounts'])}")
    for error in report['errors']:
        print(f'error: {error}')
    if report['applied']:
        print(f"applied: {report['written']} written, {report['kept']} kept (equal or newer in the DB)")
    else:
        print(f"dry run: nothing written; run with --apply ({report['written']} rows would be written, "
              f"{report['kept']} kept)")


def main(argv: list[str]) -> int:
    state = os.environ.get('API_STATE_DIR', '/data/state/api')
    parser = argparse.ArgumentParser(description='Copy the WebDAV sync folders into library.db.')
    parser.add_argument('--apply', action='store_true', help='write (default: dry run)')
    parser.add_argument('--sync', default=os.environ.get('SHARED_SYNC_DIR', '/data/sync'))
    parser.add_argument('--accounts', default=os.environ.get('ACCOUNT_DATA_DIR', '/data/accounts'))
    parser.add_argument('--db', default=os.environ.get('API_DB', os.path.join(state, 'library.db')))
    parser.add_argument('--state', default=state)
    args = parser.parse_args(argv)
    return 0 if run(args.sync, args.accounts, args.db, args.state, args.apply) is not None else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
