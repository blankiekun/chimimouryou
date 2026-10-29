"""Tests for the parts of jiten/features.py that don't need Sudachi. Run from the repo root:
python3 -m unittest discover -s server/tests
"""
import os
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from features import _origin, aozora_text, book_text, to_hiragana, vn_text  # noqa: E402

try:
    import sudachipy  # noqa: F401  (only in the difficulty image)
except ImportError:
    sudachipy = None

class BookTextTest(unittest.TestCase):
    def test_source_line_breaks_inside_a_paragraph_are_folded(self):
        """Pretty-printed ruby (と男は\\n<ruby>…\\nいた) stays one word; block ends still break lines."""
        path = os.path.join(tempfile.mkdtemp(), 'book.htmlz')
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('index.html', '<p>と男は\n  <ruby>呟<rt>つぶや</rt></ruby>\n  いた。</p>\n<p>\n次</p>')
        hints = []
        self.assertEqual(book_text(path, 'HTMLZ', {}, hints), 'と男は呟いた。\n次')
        self.assertEqual(hints, [(3, 4, 'つぶや')])


class VnTextTest(unittest.TestCase):
    def test_vn_script_in_folder_and_zip(self):
        script = '*start\nbg "a.png",1\n[太郎|voice/v1.ogg]「(本気/マジ)だ!w500」@\n　吾輩は#ffffff猫である。\\\nend\n'
        folder = tempfile.mkdtemp()
        with open(os.path.join(folder, 'nscript.dat'), 'wb') as f:
            f.write(bytes(b ^ 0x84 for b in script.encode('cp932')))
        ruby = {}
        self.assertEqual(vn_text(folder, ruby), '「本気だ」\n吾輩は猫である。')
        self.assertEqual(ruby, {'ruby': 1, 'kanji': 2, 'katakana': 1})
        path = os.path.join(tempfile.mkdtemp(), 'game.zip')
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('Game/1.txt', '二行目\n'.encode())
            archive.writestr('Game/0.txt', script.encode())
            archive.writestr('Game/sub/0.txt', '無視\n'.encode())
        self.assertEqual(vn_text(path), '「本気だ」\n吾輩は猫である。\n二行目')


class VnHintTest(unittest.TestCase):
    def hinted(self, text, hints):
        return [(text[start:end], reading) for start, end, reading in hints]

    def test_vn_hints(self):
        folder = tempfile.mkdtemp()
        with open(os.path.join(folder, '0.txt'), 'w', encoding='utf-8') as f:
            f.write('[太郎|v.ogg]「(本気/マジ)だ」@\n*label\n舞台の(上手/かみて)から#ffffff(人気/ひとけ)\\\n')
        hints = []
        text = vn_text(folder, None, hints)
        self.assertEqual(text, '「本気だ」\n舞台の上手から人気')
        self.assertEqual(self.hinted(text, hints), [('本気', 'マジ'), ('上手', 'かみて'), ('人気', 'ひとけ')])

def reader(analyzer, known):
    from yurigana import Reader
    return Reader(known=known, tokenizer=analyzer)


@unittest.skipUnless(sudachipy, 'needs Sudachi (difficulty image)')
class RubyReadingAnalysisTest(unittest.TestCase):
    def test_ruby_sets_the_occurrence_reading_but_not_the_words(self):
        from features import Analyzer
        hints = []
        text = aozora_text('夜の公園は｜人気《ひとけ》がない。\nこの店は人気だ。宇宙《そら》を見る。本気《マジ》だ。\n', None, hints)
        known = {('人気', 'ひとけ'), ('人気', 'にんき'), ('宇宙', 'うちゅう')}
        analyzer = Analyzer()
        plain, hinted = analyzer.analyse(text), analyzer.analyse(text, hints, reader(analyzer, known))
        readings = {form: dict(counter) for (_, form), counter in hinted.readings.items()}
        self.assertEqual(readings['人気'], {'ひとけ': 1, 'にんき': 1})
        self.assertEqual(readings['宇宙'], {'うちゅう': 1})
        self.assertEqual(readings['本気'], {'ほんき': 1})
        self.assertEqual(hinted.words, plain.words)

    def test_words_met_only_conjugated_get_the_forms_reading(self):
        from features import Analyzer
        analysis = Analyzer().analyse('彼は小さく呟いた。')
        readings = {form: reading for (_, form), reading in analysis.form_readings.items()}
        self.assertEqual(readings.get('呟く'), 'つぶやく')
        self.assertEqual(readings.get('小さい'), 'ちいさい')

    def test_more_ruby_readings(self):
        from features import Analyzer
        hints = []
        text = aozora_text('学校へ行《い》った。\n人《ひと》気《け》のない道。\n一緒《いつしよ》に歩《ある》く。\n', None, hints)
        known = {('行く', 'いく'), ('行く', 'ゆく'), ('人気', 'ひとけ'), ('人気', 'にんき'), ('一緒', 'いっしょ'),
                 ('歩く', 'あるく')}
        analyzer = Analyzer()
        plain, hinted = analyzer.analyse(text), analyzer.analyse(text, hints, reader(analyzer, known))
        readings = {form: dict(counter) for (_, form), counter in hinted.readings.items()}
        self.assertEqual(readings['行く'], {'いく': 1})
        self.assertEqual(readings['人気'], {'ひとけ': 1})
        self.assertEqual(readings['一緒'], {'いっしょ': 1})
        self.assertEqual(readings['歩く'], {'あるく': 1})
        self.assertEqual(hinted.words, plain.words)

    def test_context_rules_after_ruby(self):
        from features import Analyzer
        hints = []
        text = aozora_text('人気のない道。\n｜人気《にんき》がない店。\nこの店は人気だ。\n', None, hints)
        known = {('人気', 'ひとけ'), ('人気', 'にんき')}
        analyzer = Analyzer()
        plain, ruled = analyzer.analyse(text), analyzer.analyse(text, hints, reader(analyzer, known))
        readings = {form: dict(counter) for (_, form), counter in ruled.readings.items()}
        self.assertEqual(readings['人気'], {'ひとけ': 1, 'にんき': 2})  # the book's ruby wins over the rule
        self.assertEqual(ruled.words, plain.words)
        self.assertEqual(dict(plain.readings[next(k for k in plain.readings if k[1] == '人気')]), {'にんき': 3})

    def test_counters_and_the_readers_rules(self):
        from features import Analyzer
        text = '鉛筆を三本買った。\nもう一回本を読む。\n私は行く。\n'
        known = {('鉛筆', 'えんぴつ'), ('本', 'ほん'), ('本', 'もと'), ('買う', 'かう'), ('読む', 'よむ'),
                 ('一回', 'いっかい'), ('一回', 'いちかい'), ('私', 'わたし'), ('私', 'わたくし'), ('行く', 'いく'),
                 ('行く', 'ゆく')}
        analyzer = Analyzer()
        plain, read = analyzer.analyse(text), analyzer.analyse(text, (), reader(analyzer, known))
        readings = {key: dict(counter) for key, counter in read.readings.items()}
        # 三本 さんぼん is no word of its own: 三 (a number) and the counter 本, a suffix, keep theirs.
        self.assertEqual(readings['3\tnoun', '三'], {'さん': 1})
        self.assertEqual(readings['本\tfix', '本'], {'ほん': 1})
        self.assertEqual(readings['一回\tnoun', '一回'], {'いっかい': 1})  # one token: the counter's reading
        self.assertEqual(readings['買う\tverb', '買う'], {'かう': 1})  # conjugated, read by the Reader
        self.assertEqual(readings['私\tpn', '私'], {'わたし': 1})  # yurigana's default
        self.assertEqual(dict(plain.readings['一回\tnoun', '一回']), {'いちかい': 1})
        self.assertEqual(read.words, plain.words)
        self.assertIsNone(analyzer._text)  # the book's tokens aren't kept


class FeatureTest(unittest.TestCase):
    def test_origin_uses_unidic(self):
        self.assertEqual(_origin('手紙', 'noun'), 'wago')  # two kanji, but wago
        self.assertEqual(_origin('勉強', 'noun'), 'kango')
        self.assertEqual(_origin('場所', 'noun'), 'unknown')  # mixed (ば + しょ)
        self.assertEqual(_origin('テレビ', 'noun'), 'gairaigo')
        self.assertEqual(_origin('東京', 'name'), 'unknown')

    def test_to_hiragana(self):
        self.assertEqual(to_hiragana('コト'), 'こと')


if __name__ == '__main__':
    unittest.main()
