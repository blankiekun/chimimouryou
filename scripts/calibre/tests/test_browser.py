"""Tests for the analysis tools' Pyodide entry point (scripts/calibre/jiten/browser.py): the tokens it
gives from the tokenizer worker's rows."""
import os
import sys
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, '..', 'jiten'))
import browser  # noqa: E402

ROWS = {
    '猫が鳴く。': '\x1e'.join([
        '猫\x1f猫\x1f猫\x1fネコ\x1f名詞,普通名詞,一般,*,*,*',
        'が\x1fが\x1fが\x1fガ\x1f助詞,格助詞,*,*,*,*',
        '鳴く\x1f鳴く\x1f鳴く\x1fナク\x1f動詞,一般,*,*,五段-カ行,終止形-一般',
        '。\x1f。\x1f。\x1f。\x1f補助記号,句点,*,*,*,*',
    ]),
}


class BrowserTokensTest(unittest.TestCase):
    def test_tokens_keep_offsets_and_drop_punctuation(self):
        tokens = browser.BrowserTokens(ROWS.get)
        found = [(t.surface(), t.reading_form(), t.begin) for t in tokens.tokens('猫が鳴く。\n猫が鳴く。')]
        self.assertEqual(found, [('猫', 'ネコ', 0), ('が', 'ガ', 1), ('鳴く', 'ナク', 2),
                                 ('猫', 'ネコ', 6), ('が', 'ガ', 7), ('鳴く', 'ナク', 8)])
        self.assertFalse(tokens.misses)

    def test_unknown_text_is_a_miss(self):
        tokens = browser.BrowserTokens(ROWS.get)
        self.assertEqual([t.surface() for t in tokens.tokenizer.tokenize('犬')], ['犬'])
        self.assertEqual(tokens.misses, {'犬'})


class FirstTextsTest(unittest.TestCase):
    def test_only_the_word_list_asks_for_marker_words(self):
        html = '<p>猫が鳴く。</p>'
        readings = browser.first_texts(html, 'readings')
        words = browser.first_texts(html, 'words')
        self.assertEqual(readings, ['猫が鳴く。'])
        self.assertTrue(set(readings) < set(words))


if __name__ == '__main__':
    unittest.main()
