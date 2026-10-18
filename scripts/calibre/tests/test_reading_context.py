"""Tests for jiten/distil/reading_context.py on synthetic text (no Sudachi: a toy tokenizer)."""
import os
import sys
import tempfile
import unittest
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'jiten', 'distil'))
import reading_context as rc  # noqa: E402
from features import Token  # noqa: E402

KNOWN = {('人気', 'にんき'): 3000, ('人気', 'ひとけ'): 30000, ('一緒', 'いっしょ'): 500, ('一緒', 'いっしよ'): 0,
         ('本気', 'ほんき'): 2000, ('本気', 'まじ'): 9000, ('道', 'みち'): 300, ('行く', 'いく'): 50,
         ('行く', 'ゆく'): 900}
KNOWN.pop(('一緒', 'いっしよ'))
FORMS = rc.ambiguous_forms(KNOWN)


class ToyAnalyzer:
    """Splits a line into the longest words of WORDS, one token per other character."""
    WORDS = ['人気', '本気', '一緒', '道', '行った', 'のない', 'がある']
    LEMMAS = {'行った': '行く'}

    def _tokens(self, line):
        i = 0
        while i < len(line):
            word = next((w for w in self.WORDS if line.startswith(w, i)), line[i])
            if word not in '。、':
                pos = ('名詞',) if word in ('人気', '本気', '一緒', '道') else ('助詞',)
                lemma = self.LEMMAS.get(word, word)
                yield Token(word, lemma, lemma, pos + ('*',) * 5, '', i)
            i += len(word)


class LabelTest(unittest.TestCase):
    def test_ambiguous_forms_need_two_hiragana_readings(self):
        self.assertEqual(set(FORMS), {'人気', '本気', '行く'})

    def test_flavour_and_unlisted_ruby_are_not_gold(self):
        readings = FORMS['人気'] | {'いっしょ': 1}
        self.assertEqual(rc.label('ひとけ', readings), ('ひとけ', None))
        self.assertEqual(rc.label('マジ', readings), (None, 'katakana'))
        self.assertEqual(rc.label('ひと気', readings), (None, 'kanji'))
        self.assertEqual(rc.label('hito', readings), (None, 'other'))
        self.assertEqual(rc.label('じんき', readings), (None, 'unlisted'))

    def test_large_kana_ruby_is_read_with_small_kana(self):
        self.assertEqual(rc.label('いつしよ', {'いっしょ': 1, 'いつしょ': 2}), ('いつしょ', None))
        self.assertEqual(rc.label('いつしよ', {'いっしょ': 1}), ('いっしょ', None))

    def test_labels_from_few_authors_are_dropped(self):
        rows = [['b1', 'A', '本気', 'まじ'], ['b2', 'A', '本気', 'まじ'], ['b3', 'B', '本気', 'ほんき'],
                ['b4', 'C', '本気', 'ほんき'], ['b5', 'D', '本気', 'ほんき'], ['b6', 'E', '本気', None]]
        excluded = Counter()
        self.assertEqual([r[3] for r in rc.gold_rows(lambda: iter(rows), excluded)], ['ほんき'] * 3)
        self.assertEqual(excluded, Counter({'few authors': 2}))

    def test_books_without_an_author_are_their_own(self):
        self.assertEqual(rc.author_of(os.path.join('夏目漱石', 'こころ (1)', 'x.epub')), '夏目漱石')
        self.assertEqual(rc.author_of(os.path.join('Unknown', 'こころ (1)', 'x.epub')),
                         os.path.join('Unknown', 'こころ (1)'))

    def test_library_books_take_a_folders_epub_or_each_txt(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name in ('A/b1/x.epub', 'A/b1/x.txt', 'P/1.txt', 'P/2.txt'):
                os.makedirs(os.path.dirname(os.path.join(tmp, name)), exist_ok=True)
                open(os.path.join(tmp, name), 'w').close()
            self.assertEqual([(book, author) for _, book, author in rc.library_books(tmp)],
                             [('A/b1/x.epub', 'A'), ('P/1.txt', 'P'), ('P/2.txt', 'P')])

    def test_split_is_by_author_and_stable(self):
        self.assertEqual(rc.split_of('夏目漱石'), rc.split_of('夏目漱石'))
        self.assertEqual({rc.split_of(str(i)) for i in range(100)}, {0, 1, 2})


class MineTest(unittest.TestCase):
    def setUp(self):
        rc._analyzer, rc._forms = ToyAnalyzer(), FORMS

    def mine(self, text):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'book.txt')
            with open(path, 'w', encoding='utf-8') as f:
                f.write(text)
            return rc.mine_book(path, 'A/book.txt', 'A')

    def test_ruby_over_the_word_is_gold_and_flavour_is_counted(self):
        rows, excluded = self.mine('人気《ひとけ》のない道。\n本気《マジ》の人気《にんき》がある。\n｜人《ひと》気がある。')
        self.assertEqual([(r[2], r[3]) for r in rows], [('人気', 'ひとけ'), ('人気', 'にんき')])
        self.assertEqual(excluded, Counter({'katakana': 1}))
        first = rows[0]
        self.assertEqual(first[5], ['', '人気', 'のない道。'])
        self.assertEqual(first[4][rc.WINDOW], ['のない', ''])  # the token after the word

    def test_per_kanji_and_stem_ruby_are_gold_like_ruby_reading(self):
        rows, _ = self.mine('人《ひと》気《け》のない道。\n道を｜行《い》った。')
        self.assertEqual([(r[2], r[3]) for r in rows], [('人気', 'ひとけ'), ('行く', 'いく')])

    def test_plain_lines_are_sampled_unlabelled(self):
        lines = ['人気がある。'] * (rc.SAMPLE_EVERY + 1)
        rows, _ = self.mine('\n'.join(lines))
        self.assertEqual([(r[2], r[3]) for r in rows], [('人気', None)])  # line 0; line 10 is over the cap


class ScoreTest(unittest.TestCase):
    def test_macro_over_readings_is_not_dominated_by_the_common_one(self):
        results = {'人気': Counter({('ひとけ', True): 90, ('ひとけ', False): 10, ('にんき', False): 10})}
        scores = rc.score(results)
        self.assertAlmostEqual(scores['人気'][0], 0.45)
        self.assertIn('micro 81.8%', rc.summary(scores))

    def test_readings_with_too_few_gold_are_left_out(self):
        scores = rc.score({'人気': Counter({('ひとけ', True): 10, ('にんき', False): rc.MIN_GOLD - 1})})
        self.assertEqual(scores['人気'][0], 1.0)

    def test_baseline_is_rules_then_sudachi_then_the_most_common_reading(self):
        row = ['b', 'A', '人気', 'ひとけ', [], ['', '人気', 'のない道'], 'にんき']
        self.assertEqual(rc.baseline_reading(row, KNOWN, FORMS['人気']), 'ひとけ')
        row[5] = ['', '人気', 'だ']
        self.assertEqual(rc.baseline_reading(row, KNOWN, FORMS['人気']), 'にんき')
        row[6] = None
        self.assertEqual(rc.baseline_reading(row, KNOWN, FORMS['人気']), 'にんき')


if __name__ == '__main__':
    unittest.main()
