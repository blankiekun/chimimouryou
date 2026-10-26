"""The standalone edition's analysis tools: a book's word list and readings file made in the browser
(Pyodide) by the difficulty service's own code, with Sudachi's tokens from the browser's wasm build.

One worker (apps/web/src/lib/functions/analysis/analysis.worker.ts) runs both: this module reads the
book with Sudachi's tokens of each text it asks for (`lookup`), for one part: the word list with the
estimate's counts (Settings: difficulty estimates; the level itself is core.ts's, without Pyodide) or
the readings file (generated furigana).
Both parts read the book's whole text with yurigana's Reader alike (carry={}), so the book's second
part reuses the first's read. Not upstream."""
import json
import mmap
import os
import sys
from functools import lru_cache

from yurigana import Reader, __version__ as YURIGANA_VERSION, packed
from yurigana.tokens import HAS_CONTENT, Token

import readings_file
from features import TOKEN_CLEAN, Analyzer, is_kanji
from frequency import FrequencyTable
from word_list import word_rows

READER_PACK = '/packs/reader.ygp'
FREQUENCY_PACK = '/packs/frequency.ygp'


class BrowserTokens:
    """SudachiTokenizer's tokens() and its tokenizer's tokenize() over rows looked up by text. `lookup`
    gives a text's morphemes as `surface \\x1f form \\x1f normalized \\x1f reading \\x1f pos,pos…` joined by
    \\x1e (Sudachi's tokenize_rows)."""

    def __init__(self, lookup, book=None):
        """`book`: a book's parsed rows and token lists (_book), kept across its parts."""
        self.lookup = lookup
        self._parsed, self._listed, self._pos = book or ({}, {}, {})
        self.tokenizer = self

    def _rows(self, text: str):
        rows = self._parsed.get(text)
        if rows is None:
            raw = self.lookup(text)
            rows = self._parsed[text] = [
                (*map(sys.intern, (surface, form, normalized, reading)),
                 self._pos.get(pos) or self._pos.setdefault(pos, tuple(pos.split(','))))
                for surface, form, normalized, reading, pos in (row.split('\x1f') for row in raw.split('\x1e') if raw)]
        return rows

    def tokenize(self, text: str):
        """Every morpheme, as Sudachi's tokenize (no offsets: the Analyzer reads words alone with it)."""
        return [Token(surface, form, normalized, pos, reading) for surface, form, normalized, reading, pos in self._rows(text)]

    def tokens(self, text: str):
        """yurigana.tokens.SudachiTokenizer.tokens: the same chunks, filter and offsets. A text's tokens
        are listed once: the readings file and the Reader both ask for the whole book's."""
        listed = self._listed.get(text)
        if listed is None:
            listed = self._listed[text] = list(self._tokens(text))
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


def _reader(tokenizer, kept: dict) -> Reader:
    """yurigana's Reader over `tokenizer`. Its whole-book reads (carry={}) are kept in `kept`, the
    book's: the readings file and the word list read the same text and hints, so the second part
    reuses the first's Words (NamedTuples, never changed)."""
    reader = Reader.load(READER_PACK, tokenizer=tokenizer)
    read = reader.read

    def read_once(text, hints=(), carry=None):
        if carry != {}:
            return read(text, hints, carry)
        key = id(text), id(hints)  # the book's own objects (_book), alive as long as `kept`
        if key not in kept:
            kept[key] = read(text, hints, carry)
        return kept[key]

    reader.read = read_once
    return reader


@lru_cache(maxsize=1)
def _frequency() -> FrequencyTable:
    """The worker's table (its pack is loaded once), kept with its compound table for the next book."""
    return FrequencyTable.load_packed(FREQUENCY_PACK)


def _words(extracted: tuple, tokens, words_per_book: int, reader: bool, kept: dict) -> dict:
    """The book's word list as the service saves it ({words, uniqueWords, tokens}) with the
    estimate's counts (characters, uniqueKanji). Without `reader` (generated furigana not installed:
    no reader pack) the rows take Sudachi's readings."""
    analyzer = Analyzer(tokens)
    # The deconjugator's cache holds every intermediate form: a small one (only slower).
    analyzer.deconjugator.deconjugate = lru_cache(maxsize=200)(analyzer.deconjugator._deconjugate)
    text, hints, _ = extracted
    frequency = _frequency()
    analysis = analyzer.analyse(text, hints, _reader(analyzer, kept) if reader else None, frequency)
    rows, unique_words, total = word_rows(analysis, frequency)
    return {'words': rows[:words_per_book], 'uniqueWords': unique_words, 'tokens': total,
            'characters': len(TOKEN_CLEAN.sub('', text)), 'uniqueKanji': len({c for c in text if is_kanji(c)})}


# The last book: its text (readings_file.extract), parsed rows, token lists and Reader read, which its
# other part asks for again.
_book = None, None, None, None


def analyse(html: str, lookup, part: str, words_per_book: int = 2000, reader: bool = True) -> str:
    """JSON of `part`: 'words' (_words, with yurigana's Reader for its rows' readings when `reader`)
    or 'readings' (the book's readings file, bookdata '': {readings})."""
    global _book
    if _book[0] != html:
        _book = html, ({}, {}, {}), readings_file.extract(html), {}
    tokens = BrowserTokens(lookup, _book[1])
    if part == 'words':
        result = _words(_book[2], tokens, words_per_book, reader, _book[3])
    else:
        yurigana = _reader(tokens, _book[3])
        result = {'readings': readings_file.build(html, yurigana, '', YURIGANA_VERSION, _book[2])}
    return json.dumps(result, ensure_ascii=False, separators=(',', ':'))
