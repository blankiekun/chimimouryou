"""Tests for the analysis tools' Pyodide entry point (engine/browser.py): the tokens it
gives from Sudachi's rows, and the Reader read a book's two parts share."""
import os
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, '..'))
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

    def test_a_book_cache_asks_for_each_text_once(self):
        asked, book = [], ({}, {}, {})

        def lookup(text):
            asked.append(text)
            return ROWS.get(text)

        first = [(t.surface(), t.begin) for t in browser.BrowserTokens(lookup, book).tokens('猫が鳴く。')]
        second = browser.BrowserTokens(lookup, book)
        self.assertEqual([(t.surface(), t.begin) for t in second.tokens('猫が鳴く。')], first)
        self.assertEqual([t.surface() for t in second.tokenizer.tokenize('猫が鳴く。')], ['猫', 'が', '鳴く', '。'])
        self.assertEqual(asked, ['猫が鳴く。'])


class ReaderTest(unittest.TestCase):
    def test_the_books_other_part_reuses_a_whole_book_read(self):
        reads = []

        class FakeReader:
            @classmethod
            def load(cls, path, tokenizer=None):
                return cls()

            def read(self, text, hints=(), carry=None):
                reads.append(carry)
                return [text]

        text, hints, kept = '猫が鳴く。', [], {}
        with mock.patch.object(browser, 'Reader', FakeReader):
            first = browser._reader('readings tokens', kept).read(text, hints, carry={})
            second = browser._reader('words tokens', kept).read(text, hints, carry={})
            browser._reader('tokens', kept).read(text, hints)  # without carry: never kept
        self.assertIs(first, second)
        self.assertEqual(reads, [{}, None])


if __name__ == '__main__':
    unittest.main()
