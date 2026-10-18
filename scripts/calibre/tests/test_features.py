"""Tests for the parts of jiten/features.py that don't need Sudachi. Run from the repo root:
python3 -m unittest discover -s scripts/calibre/tests
"""
import math
import os
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'jiten'))
from features import (EXTRA_FEATURES, Analysis, Word, _coverage_rank, _origin, aozora_text, book_text,  # noqa: E402
                      compute_extra_features, compute_features, context_reading, ruby_reading, to_hiragana,
                      vn_text)

try:
    import sudachipy  # noqa: F401  (only in the difficulty image)
except ImportError:
    sudachipy = None

OPF = '''<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<manifest>
  <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  <item id="c1" href="text/p-001.xhtml" media-type="application/xhtml+xml"/>
  <item id="col" href="text/colophon.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="nav"/><itemref idref="c1"/><itemref idref="col"/></spine>
</package>'''


def epub(chapter: str):
    path = os.path.join(tempfile.mkdtemp(), 'book.epub')
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/>'
                                                   '</rootfiles></container>')
        archive.writestr('OEBPS/content.opf', OPF)
        archive.writestr('OEBPS/nav.xhtml', '<html><body><p>目次</p></body></html>')
        archive.writestr('OEBPS/text/p-001.xhtml', f'<html><body>{chapter}</body></html>')
        archive.writestr('OEBPS/text/colophon.xhtml', '<html><body><p>発行所　株式会社</p></body></html>')
    return path


class Frequency:
    def __init__(self, ranks):
        self.ranks = ranks

    def word(self, key, reading=None):
        rank = self.ranks.get(key.split('\t')[0])
        return (rank, 1 / rank) if rank else None


class BookTextTest(unittest.TestCase):
    def test_skips_contents_and_colophon_and_counts_ruby(self):
        ruby = {}
        text = book_text(epub('<p><ruby>本気<rt>マジ</rt></ruby>で<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp>'
                              '</ruby>を読む。</p>'), 'EPUB', ruby)
        self.assertEqual(text, '本気で漢字を読む。')
        self.assertEqual(ruby, {'ruby': 2, 'kanji': 4, 'katakana': 1})

    def test_aozora_ruby_in_txt(self):
        path = os.path.join(tempfile.mkdtemp(), 'book.txt')
        with open(path, 'w', encoding='utf-8') as f:
            f.write('吾輩《わがはい》は｜猫《ねこ》である。\n')
        ruby = {}
        self.assertEqual(book_text(path, 'TXT', ruby), '吾輩は猫である。')
        self.assertEqual(ruby, {'ruby': 2, 'kanji': 3})

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


class RubyHintTest(unittest.TestCase):
    def hinted(self, text, hints):
        return [(text[start:end], reading) for start, end, reading in hints]

    def test_epub_hints_are_offsets_in_the_plain_text(self):
        hints = []
        text = book_text(epub('<p>夜の<ruby class="r">公園<rt class="x">こうえん</rt></ruby>は'
                              '<ruby><rb>人気</rb><rp>(</rp><rt>ひと<span>け</span></rt><rp>)</rp></ruby>がない。</p>'
                              '<p><ruby>本気<rt>マジ</rt></ruby>だ</p>'), 'EPUB', {}, hints)
        self.assertEqual(text, '夜の公園は人気がない。\n本気だ')
        self.assertEqual(self.hinted(text, hints), [('公園', 'こうえん'), ('人気', 'ひとけ'), ('本気', 'マジ')])

    def test_odd_markup_gives_no_hints_and_the_same_text(self):
        hints = []
        text = book_text(epub('<p><ruby> 人気<rt>ひとけ</rt></ruby>がない</p>'), 'EPUB', None, hints)
        self.assertEqual((text, hints), ('人気がない', []))

    def test_aozora_and_vn_hints(self):
        hints = []
        text = aozora_text('　吾輩《わがはい》は\n｜猫《ねこ》である。\n', None, hints)
        self.assertEqual(text, '吾輩は\n猫である。')
        self.assertEqual(self.hinted(text, hints), [('吾輩', 'わがはい'), ('猫', 'ねこ')])
        folder = tempfile.mkdtemp()
        with open(os.path.join(folder, '0.txt'), 'w', encoding='utf-8') as f:
            f.write('[太郎|v.ogg]「(本気/マジ)だ」@\n*label\n舞台の(上手/かみて)から#ffffff(人気/ひとけ)\\\n')
        hints = []
        text = vn_text(folder, None, hints)
        self.assertEqual(text, '「本気だ」\n舞台の上手から人気')
        self.assertEqual(self.hinted(text, hints), [('本気', 'マジ'), ('上手', 'かみて'), ('人気', 'ひとけ')])

    def test_only_plain_readings_listed_by_jiten(self):
        known = {('人気', 'ひとけ'), ('人気', 'にんき'), ('本気', 'まじ'), ('本気', 'ほんき'), ('宇宙', 'うちゅう')}
        hints = {0: (2, 'ひとけ'), 3: (5, 'そら'), 6: (8, 'マジ'), 9: (11, 'まじ'), 12: (13, 'ひと')}
        self.assertEqual(ruby_reading(hints, 0, '人気', '人気', known), 'ひとけ')
        self.assertIsNone(ruby_reading(hints, 3, '宇宙', '宇宙', known))  # not a reading of 宇宙
        self.assertIsNone(ruby_reading(hints, 6, '本気', '本気', known))  # katakana: flavour
        self.assertEqual(ruby_reading(hints, 9, '本気', '本気', known), 'まじ')  # Jiten lists it (accepted hole)
        self.assertIsNone(ruby_reading(hints, 12, '人気', '人気', known))  # ruby over part of the token
        self.assertIsNone(ruby_reading(hints, 1, '気', '気', known))

    def test_per_kanji_ruby_is_joined(self):
        known = {('人気', 'ひとけ'), ('人気', 'にんき')}
        self.assertEqual(ruby_reading({0: (1, 'ひと'), 1: (2, 'け')}, 0, '人気', '人気', known), 'ひとけ')
        self.assertIsNone(ruby_reading({0: (1, 'ひと'), 1: (2, 'き')}, 0, '人気', '人気', known))  # not listed
        self.assertIsNone(ruby_reading({0: (1, 'ひと'), 1: (3, 'けの')}, 0, '人気', '人気', known))  # past the token
        self.assertIsNone(ruby_reading({0: (1, 'ひと'), 1: (2, 'ケ')}, 0, '人気', '人気', known))  # katakana part

    def test_ruby_over_the_kanji_stem(self):
        known = {('行く', 'いく'), ('行く', 'ゆく'), ('上手い', 'うまい'), ('歩く', 'あるく'), ('見上げる', 'みあげる'),
                 ('子ども', 'こども'), ('魚市場', 'うおいちば')}
        self.assertEqual(ruby_reading({0: (1, 'い')}, 0, '行っ', '行く', known), 'いく')  # 行《い》った
        self.assertEqual(ruby_reading({0: (1, 'ゆ')}, 0, '行か', '行く', known), 'ゆく')
        self.assertEqual(ruby_reading({0: (2, 'うま')}, 0, '上手く', '上手い', known), 'うまい')
        self.assertEqual(ruby_reading({0: (1, 'ある')}, 0, '歩く', '歩く', known), 'あるく')
        self.assertEqual(ruby_reading({0: (1, 'み'), 1: (2, 'あ')}, 0, '見上げ', '見上げる', known), 'みあげる')
        self.assertEqual(ruby_reading({0: (1, 'こ')}, 0, '子ども', '子ども', known), 'こども')
        self.assertIsNone(ruby_reading({0: (1, 'おこな')}, 0, '行っ', '行く', known))  # おこなく: not listed
        self.assertIsNone(ruby_reading({0: (1, 'うお')}, 0, '魚市場', '魚市場', known))  # kanji left: compound
        self.assertIsNone(ruby_reading({0: (1, 'い')}, 0, '云っ', '言う', {('言う', 'いう')}))  # lemma spelled apart

    def test_large_kana_ruby(self):
        known = {('一緒', 'いっしょ'), ('目下', 'もっか'), ('目下', 'めした'), ('勝つ', 'かつ'), ('喋る', 'しゃべる')}
        self.assertEqual(ruby_reading({0: (2, 'いつしよ')}, 0, '一緒', '一緒', known), 'いっしょ')
        self.assertEqual(ruby_reading({0: (2, 'もつか')}, 0, '目下', '目下', known), 'もっか')
        self.assertEqual(ruby_reading({0: (1, 'か')}, 0, '勝つ', '勝つ', known), 'かつ')  # exact first
        self.assertEqual(ruby_reading({0: (1, 'しやべ')}, 0, '喋っ', '喋る', known), 'しゃべる')  # stem and large kana
        self.assertIsNone(ruby_reading({0: (2, 'つか')}, 0, '目下', '目下', {('目下', 'っか')}))  # never a leading っ


class ContextReadingTest(unittest.TestCase):
    known = {('人気', 'ひとけ'), ('人気', 'にんき'), ('明日', 'あした'), ('明日', 'あす'), ('上手', 'かみて'),
             ('今日', 'こんにち'), ('他', 'た')}

    def reading(self, text, form, surface=None, known=None):
        return context_reading(text, text.index(form), surface or form, form, self.known if known is None else known)

    def test_rules(self):
        self.assertEqual(self.reading('夜の公園は人気がなく、', '人気'), 'ひとけ')
        self.assertIsNone(self.reading('彼は人気者だ。', '人気'))  # Sudachi's reading stays
        self.assertEqual(self.reading('役者が舞台の上手から', '上手'), 'かみて')  # text before
        self.assertEqual(self.reading('今日に至るまで', '今日'), 'こんにち')
        self.assertEqual(self.reading('その他の項目', '他'), 'た')
        self.assertEqual(self.reading('明日は雨だ。', '明日'), 'あした')
        self.assertIsNone(self.reading('明日の日本を担う', '明日'))
        self.assertIsNone(self.reading('料理が上手だ', '上手'))

    def test_hitoke_needs_a_cue(self):
        for text in ('人気のない路地', '人気も無い', '人気が少ない', '人気が絶えた', '周囲に人気がない', '人気がない場所に',
                     '廊下は人気がなく静か', '夜の公園は人気がまったくなかった', '辺りに人気はなかった', '駐車場は人気がない', '事務所に人気がない'):
            self.assertEqual(self.reading(text, '人気'), 'ひとけ', text)
        self.assertEqual(self.reading('人気のない奴だ', '人気'), 'にんき')  # before the のない rule
        for text in ('この店は人気がない', '茨城県は人気がない', '海外では人気がない', '国内では人気がない', '人気がない',
                     'この作家はまだ人気がない', '作家は人気がない', '市場では人気がない', 'パン屋は人気がない',
                     '驚くほど人気がない', 'この店は全く人気がない', '北海道では人気がない', '長所は人気がないことだ'):
            self.assertIsNone(self.reading(text, '人気'), text)  # no cue: Sudachi's にんき

    def test_only_the_line_and_listed_readings(self):
        self.assertIsNone(self.reading('舞台の\n上手から', '上手'))
        self.assertIsNone(self.reading('人気\nのない', '人気'))
        self.assertIsNone(self.reading('人気のない', '人気', known={('人気', 'にんき')}))
        self.assertIsNone(self.reading('人気のない', '人気', known=()))  # no frequency list: no rules


@unittest.skipUnless(sudachipy, 'needs Sudachi (difficulty image)')
class RubyReadingAnalysisTest(unittest.TestCase):
    def test_ruby_sets_the_occurrence_reading_but_not_the_features(self):
        from features import Analyzer
        from frequency import FrequencyTable
        hints = []
        text = aozora_text('夜の公園は｜人気《ひとけ》がない。\nこの店は人気だ。宇宙《そら》を見る。本気《マジ》だ。\n', None, hints)
        known = {('人気', 'ひとけ'), ('人気', 'にんき'), ('宇宙', 'うちゅう')}
        analyzer = Analyzer()
        plain, hinted = analyzer.analyse(text), analyzer.analyse(text, hints, known)
        readings = {form: dict(counter) for (_, form), counter in hinted.readings.items()}
        self.assertEqual(readings['人気'], {'ひとけ': 1, 'にんき': 1})
        self.assertEqual(readings['宇宙'], {'うちゅう': 1})
        self.assertEqual(readings['本気'], {'ほんき': 1})
        self.assertEqual(hinted.words, plain.words)
        frequency = FrequencyTable({'人気': 1500, '公園': 2000, '宇宙': 3000, '本気': 4000}, {('人気', 'ひとけ'): 40000})
        self.assertEqual(compute_features(hinted, frequency), compute_features(plain, frequency))
        self.assertEqual(compute_extra_features(hinted, frequency), compute_extra_features(plain, frequency))

    def test_more_ruby_readings(self):
        from features import Analyzer
        hints = []
        text = aozora_text('学校へ行《い》った。\n人《ひと》気《け》のない道。\n一緒《いつしよ》に歩《ある》く。\n', None, hints)
        known = {('行く', 'いく'), ('行く', 'ゆく'), ('人気', 'ひとけ'), ('人気', 'にんき'), ('一緒', 'いっしょ'),
                 ('歩く', 'あるく')}
        analyzer = Analyzer()
        plain, hinted = analyzer.analyse(text), analyzer.analyse(text, hints, known)
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
        plain, ruled = analyzer.analyse(text), analyzer.analyse(text, hints, known)
        readings = {form: dict(counter) for (_, form), counter in ruled.readings.items()}
        self.assertEqual(readings['人気'], {'ひとけ': 1, 'にんき': 2})  # the book's ruby wins over the rule
        self.assertEqual(ruled.words, plain.words)
        self.assertEqual(dict(plain.readings[next(k for k in plain.readings if k[1] == '人気')]), {'にんき': 3})


class FeatureTest(unittest.TestCase):
    def test_origin_uses_unidic(self):
        self.assertEqual(_origin('手紙', 'noun'), 'wago')  # two kanji, but wago
        self.assertEqual(_origin('勉強', 'noun'), 'kango')
        self.assertEqual(_origin('場所', 'noun'), 'unknown')  # mixed (ば + しょ)
        self.assertEqual(_origin('テレビ', 'noun'), 'gairaigo')
        self.assertEqual(_origin('東京', 'name'), 'unknown')

    def test_coverage_rank(self):
        ranked = [(1, 50), (10, 40), (5000, 8), (90000, 2)]
        self.assertEqual(_coverage_rank(ranked, 0.90), 10)
        self.assertEqual(_coverage_rank(ranked, 0.95), 5000)
        self.assertEqual(_coverage_rank(ranked, 0.99), 90000)
        self.assertTrue(math.isnan(_coverage_rank([], 0.95)))

    def test_to_hiragana(self):
        self.assertEqual(to_hiragana('コト'), 'こと')

    def test_extra_features(self):
        words = {('の\tparticle', 'の'): [Word('の\tparticle', 'の', 'particle', 'wago', (), 'の'), 95],
                 ('魔法\tnoun', '魔法'): [Word('魔法\tnoun', '魔法', 'noun', 'kango', (), '魔法'), 5]}
        analysis = Analysis(text='魔法の本を読んだ。\n鬱だ', words=words, word_count=100, line_sentence_count=2,
                            predicates=3, relative_clauses=1, mattr=0.5)
        extra = compute_extra_features(analysis, Frequency({'の': 1, '魔法': 2000}), {'ruby': 1, 'kanji': 1, 'katakana': 1})
        self.assertEqual(list(extra), EXTRA_FEATURES)
        self.assertAlmostEqual(extra['CoverageRank95'], math.log(1))
        self.assertAlmostEqual(extra['CoverageRank98'], math.log(2000))
        self.assertEqual(extra['PredicatesPerSentence'], 1.5)
        self.assertEqual(extra['RelativeClausesPerSentence'], 0.5)
        self.assertAlmostEqual(extra['NonJoyoKanjiShare'], 0)  # 鬱 became 常用 in 2010
        self.assertAlmostEqual(extra['RubyKanjiShare'], 1 / 5)  # 魔法本読鬱
        self.assertEqual(extra['RubyKatakanaShare'], 1)


if __name__ == '__main__':
    unittest.main()
