"""The sync file-name parsers against the fixture the TypeScript side checks too
(apps/web/src/lib/data/storage/handler/sync-file-names-fixture.test.ts)."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'api'))
import syncnames  # noqa: E402

with open(os.path.join(os.path.dirname(__file__), 'fixtures', 'sync-file-names.json'), encoding='utf-8') as f:
    FIXTURE = json.load(f)

PARSERS = {
    'book': syncnames.book_metadata,
    'progress': syncnames.progress_metadata,
    'statistics': syncnames.statistics_metadata,
    'goals': syncnames.goals_metadata,
}


class SyncNamesTest(unittest.TestCase):
    def test_titles(self):
        for case in FIXTURE['titles']:
            with self.subTest(title=case['title']):
                self.assertEqual(syncnames.sanitize_for_filename(case['title']), case['sanitized'])
                self.assertEqual(syncnames.desanitize_filename(case['sanitized']), case['title'])

    def test_parse(self):
        for case in FIXTURE['parse']:
            with self.subTest(name=case['name']):
                parsed = PARSERS[case['kind']](case['name'])
                self.assertEqual(parsed, case['expected'])
                # 1 and 1.0 compare equal: check the types too.
                self.assertEqual({k: type(v) for k, v in parsed.items()},
                                 {k: type(v) for k, v in case['expected'].items()})

    def test_find_file(self):
        for case in FIXTURE['findFile']:
            with self.subTest(names=case['names'], prefix=case['prefix']):
                self.assertEqual(syncnames.find_file(case['names'], case['prefix']), case['expected'])


if __name__ == '__main__':
    unittest.main()
