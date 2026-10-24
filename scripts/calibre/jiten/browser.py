"""The standalone edition's analysis tools: a book's word list and readings file made in the browser
(Pyodide) by the difficulty service's own code, with Sudachi's tokens from the browser's wasm build.

Sudachi and Pyodide don't fit in memory together, so they run one after the other in two workers
(apps/web/src/lib/functions/analysis/): the tokenizer worker tokenizes the texts asked for and stops,
then this module reads the book with those tokens (`lookup`), for one part: the word list with the
difficulty model's input (Settings: difficulty estimates) or the readings file (generated furigana). Texts nobody tokenized yet (yurigana
reads parts of words, the Analyzer conjugated forms) are `misses`: the tokenizer worker takes them and
the book is read again, until there are none. Not upstream."""
import json
import mmap
import os
import sys
from functools import lru_cache

from yurigana import Reader, __version__ as YURIGANA_VERSION, packed
from yurigana.tokens import HAS_CONTENT, Token

import readings_file
from features import (EXTRA_FEATURES, FEATURE_ORDER, TOKEN_CLEAN, Analyzer, _count_ruby, compute_extra_features,
                      compute_features, is_kanji, words_for_coverage)
from frequency import FrequencyTable
from word_list import word_rows

READER_PACK = '/packs/reader.ygp'
FREQUENCY_PACK = '/packs/frequency.ygp'
# Stands in for a text not tokenized yet, so the round goes on and finds the other misses.
_MISSING = '名詞,普通名詞,一般,*,*,*'


class BrowserTokens:
    """SudachiTokenizer's tokens() and its tokenizer's tokenize() over rows looked up by text. `lookup`
    gives a text's morphemes as `surface \\x1f form \\x1f normalized \\x1f reading \\x1f pos,pos…` joined by
    \\x1e (the tokenizer worker's rows), or None when the text wasn't tokenized: it joins `misses`."""

    def __init__(self, lookup, book=None):
        """`book`: a book's parsed rows and token lists (_book), kept across its parts."""
        self.lookup, self.misses = lookup, set()
        self._parsed, self._listed, self._pos = book or ({}, {}, {})
        self.tokenizer = self

    def _rows(self, text: str):
        rows = self._parsed.get(text)
        if rows is None:
            raw = self.lookup(text)
            if raw is None:
                self.misses.add(text)
                raw = '\x1f'.join((text, text, text, '', _MISSING))
            rows = [(*map(sys.intern, (surface, form, normalized, reading)),
                     self._pos.get(pos) or self._pos.setdefault(pos, tuple(pos.split(','))))
                    for surface, form, normalized, reading, pos in (row.split('\x1f') for row in raw.split('\x1e') if raw)]
            if text not in self.misses:
                self._parsed[text] = rows
        return rows

    def tokenize(self, text: str):
        """Every morpheme, as Sudachi's tokenize (no offsets: the Analyzer reads words alone with it)."""
        return [Token(surface, form, normalized, pos, reading) for surface, form, normalized, reading, pos in self._rows(text)]

    def tokens(self, text: str):
        """yurigana.tokens.SudachiTokenizer.tokens: the same chunks, filter and offsets. A text's tokens
        are listed once: the readings file and the Reader both ask for the whole book's."""
        listed = self._listed.get(text)
        if listed is None:
            listed = list(self._tokens(text))
            if not self.misses:
                self._listed[text] = listed
        return iter(listed)

    def _tokens(self, text: str):
        offset = 0
        for paragraph in text.split('\n'):
            start = offset
            offset += len(paragraph) + 1
            while paragraph:
                chunk = paragraph[:5000]
                if len(paragraph) > 5000:
                    cut = max(chunk.rfind(c) for c in '。！？')
                    chunk = paragraph[: cut + 1] if cut > 0 else chunk
                paragraph = paragraph[len(chunk):]
                at, start = start, start + len(chunk)
                for surface, form, normalized, reading, pos in self._rows(chunk):
                    if pos[0] not in ('補助記号', '空白') and HAS_CONTENT.search(surface):
                        yield Token(surface, form, normalized, pos, reading, at)
                    at += len(surface)


# The packs live in bytearrays the page fills (no file, no copy): Packed maps a file, so it gets the
# bytearray standing for that file instead.
_buffers = {}


class _Mmap:
    ACCESS_READ = mmap.ACCESS_READ

    @staticmethod
    def mmap(fileno, length, access=None):
        return _buffers[os.fstat(fileno).st_ino]


def pack_buffer(path: str, size: int) -> int:
    """The address of a `size`-byte buffer the page fills with the pack read from `path`."""
    import ctypes
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'wb').close()
    buffer = _buffers[os.stat(path).st_ino] = bytearray(size)
    packed.mmap = _Mmap
    return ctypes.addressof((ctypes.c_char * size).from_buffer(buffer))


def first_texts(html: str, part: str) -> list:
    """What the first round tokenizes: the book's text in the tokenizer's chunks, and for the word
    list (`part` 'words') the Analyzer's marker words."""
    tokens = BrowserTokens(lambda text: None)
    if part == 'words':
        Analyzer(tokens)
    text = readings_file.extract(html)[0]
    for _ in tokens.tokens(text):
        pass
    return sorted(tokens.misses)


def _words(extracted: tuple, tokens, words_per_book: int, reader: bool) -> dict:
    """The book's word list as the service saves it ({words, uniqueWords, tokens}) and the
    difficulty model's input row (`features`, the service's _estimate) with the estimate's counts.
    Without `reader` (generated furigana not installed: no reader pack) the rows take Sudachi's
    readings; the features never use the Reader, so the estimate is the same."""
    analyzer = Analyzer(tokens)
    # The deconjugator's cache holds every intermediate form: a small one (only slower).
    analyzer.deconjugator.deconjugate = lru_cache(maxsize=200)(analyzer.deconjugator._deconjugate)
    text, hints, _ = extracted
    # book_text's furigana count, from the same ruby
    ruby = {}
    for start, end, reading in hints:
        _count_ruby(ruby, text[start:end], reading)
    frequency = FrequencyTable.load_packed(FREQUENCY_PACK)
    analysis = analyzer.analyse(text, hints, Reader.load(READER_PACK, tokenizer=analyzer) if reader else None)
    rows, unique_words, total = word_rows(analysis, frequency)
    features = compute_features(analysis, frequency)
    extra = compute_extra_features(analysis, frequency, ruby)
    return {'words': rows[:words_per_book], 'uniqueWords': unique_words, 'tokens': total,
            'features': [features[name] for name in FEATURE_ORDER] + [extra[name] for name in EXTRA_FEATURES],
            'words95': words_for_coverage(extra) if extra['CoverageRank95'] == extra['CoverageRank95'] else None,
            'characters': len(TOKEN_CLEAN.sub('', text)), 'uniqueKanji': len({c for c in text if is_kanji(c)})}


# The last book: its text (readings_file.extract), parsed rows and token lists, which its other part
# asks for again.
_book = None, None, None


def analyse(html: str, lookup, part: str, words_per_book: int = 2000, reader: bool = True) -> str:
    """JSON: {misses} while texts are missing, else `part`: 'words' (_words, with yurigana's Reader
    for its rows' readings when `reader`) or 'readings' (the book's readings file, bookdata '':
    {readings})."""
    global _book
    if _book[0] != html:
        _book = html, ({}, {}, {}), readings_file.extract(html)
    tokens = BrowserTokens(lookup, _book[1])
    if part == 'words':
        result = _words(_book[2], tokens, words_per_book, reader)
    else:
        yurigana = Reader.load(READER_PACK, tokenizer=tokens)
        result = {'readings': readings_file.build(html, yurigana, '', YURIGANA_VERSION, _book[2])}
    if tokens.misses:
        return json.dumps({'misses': sorted(tokens.misses)}, ensure_ascii=False)
    return json.dumps(result, ensure_ascii=False, separators=(',', ':'))
