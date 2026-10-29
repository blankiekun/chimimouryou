"""The fast difficulty core (jiten/core.py) against the fixture core.ts also checks."""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))

import core  # noqa: E402
from frequency import FrequencyTable  # noqa: E402
from yurigana.tokens import HAS_CONTENT, Token  # noqa: E402


def tokens_of(rows):
    """yurigana's SudachiTokenizer.tokens over one chunk of fixture rows: offsets, no symbols or blanks."""
    offset = 0
    # A 6th field repeats the row (runs are stored once).
    expanded = (row[:5] for row in rows for _ in range(row[5] if len(row) > 5 else 1))
    for surface, form, normalized, reading, pos in expanded:
        pos = tuple(pos.split(','))
        if pos[0] not in ('補助記号', '空白') and HAS_CONTENT.search(surface):
            yield Token(surface, form, normalized, pos, reading, offset)
        offset += len(surface)


class CoreTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(HERE, 'fixtures', 'difficulty-core.json'), encoding='utf-8') as f:
            cls.fixture = json.load(f)

    def test_fixture(self):
        for case in self.fixture['cases']:
            table = FrequencyTable(case['ranks'], {tuple(k.split('\t')): v for k, v in case['readingRanks'].items()},
                                   case['compounds'])
            with self.subTest(case['name']):
                self.assertEqual(core.book_core(tokens_of(case['morphemes']), table, case.get('text', ''),
                                                 case.get('rubyKanji', 0)), case['expected'])

    def test_scores(self):
        scale = core.load_scale()
        for v98, expected in self.fixture['scores']:
            self.assertEqual(core.score(v98, scale), expected)

    def test_furigana_scores(self):
        for level, ruby_kanji, expected in self.fixture['furiganaScores']:
            self.assertEqual(core.furigana_score(level, ruby_kanji), expected)

    def test_scale_is_monotone(self):
        scale = core.load_scale()
        anchors = scale['anchors']
        self.assertEqual([a[0] for a in anchors], [1 + i / 4 for i in range(37)])
        self.assertTrue(all(b[1] > a[1] for a, b in zip(anchors, anchors[1:])))
        self.assertEqual(len(scale['tiers']), 10)
        scores = [core.score(v, scale) for v in range(20_000, 200_000, 997)]
        self.assertEqual(scores, sorted(scores))

    def test_core_table_text(self):
        """The list as core.ts's parseCoreTable reads it (core.test.ts parses the same text)."""
        table = FrequencyTable({'顔': 300, 'の': 1}, {('顔', 'がお'): 75124}, {'心配顔': 'しんぱいがお'})
        self.assertEqual(core.core_table_text(table), 'の\t1\n顔\t300\n\n顔\tがお\t75124\n\n心配顔\tしんぱいがお\n')

    def test_buckets(self):
        self.assertEqual([core.bucket(r) for r in (1, 2, 9, 10, 99, 100, 10 ** 6, 10 ** 7, None)],
                         [0, 1, 3, 4, 7, 8, 23, 23, 24])

    def test_repetition_discount(self):
        """Book-specific words cost REPEAT_CAP occurrences: repeating a rare term doesn't raise V98."""
        units = [(f'語{i}', f'語{i}', 'ご', False) for i in range(1, 101)] + [('魔導具', '魔導具', 'まどうぐ', False)] * 2
        ranks = {**{f'語{i}': i for i in range(1, 101)}, '魔導具': 90000}
        once = core.summarise(units, ranks.get)['v98']
        more = core.summarise(units + [units[-1]] * 500, ranks.get)['v98']
        self.assertEqual(once, 100)
        self.assertLessEqual(more, once)


if __name__ == '__main__':
    unittest.main()
