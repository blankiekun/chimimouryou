"""A book's text and its analysis into words for the word lists (word_list.py): a Python port of the
word grouping in Jiten.Parser/Parser.cs (Apache-2.0), which once fed the retired difficulty model
(chimi-difficulty; the estimate is core.py now).

Sudachi tokens are grouped into words as Jiten does (a verb or adjective together with its
auxiliaries is one conjugated word, suru verbs are merged), words are identified by Sudachi's
normalised form, and frequencies come from Jiten's Yomitan frequency list (see frequency.py).
"""
import os
import posixpath
import re
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache

from compound_merge import merge_compounds
from deconjugator import Deconjugator
# Book text with its ruby and Sudachi tokens come from yurigana (the readings in context too: a Reader).
from yurigana.readings import is_kanji, to_hiragana  # noqa: F401
from yurigana import text as _text
from yurigana.text import _count_ruby, _mark_ruby, _take_hints, aozora_text  # noqa: F401
from yurigana.tokens import SudachiTokenizer, Token  # noqa: F401

# A text node's source line breaks with the blanks around them (HTML whitespace, not line breaks).
_TEXT_NODE = re.compile(r'>[^<]+')
_SOURCE_BREAK = re.compile(r'[ \t\r]*\n[ \t\r\n]*')


def fold_source_breaks(markup: str) -> str:
    """Markup with its text nodes' source line breaks taken out: pretty-printed EPUBs put them around
    <ruby> (`と男は\\n<ruby>呟…</ruby>\\nいた`), and kept as lines they split the word for Sudachi. Line
    breaks come from block ends and <br> only (core.ts's coreText folds alike)."""
    return _TEXT_NODE.sub(lambda m: _SOURCE_BREAK.sub('', m.group()), markup)


# The most text a book's zip or TXT may bring into a worker, so a zip bomb fails rather than fills its memory. Real books are
# far under it: at most 18.5 MB of documents in a sample of 4,800, and text copies stop at 30 MB (MAX_STATICDATA_BYTES).
MAX_BOOK_TEXT_BYTES = 256 * 1024 * 1024


def _check_text_size(sizes):
    if sum(sizes) > MAX_BOOK_TEXT_BYTES:
        raise ValueError('The text of this book is too large')


def book_text(path: str, fmt: str, ruby: dict | None = None, hints: list | None = None) -> str:
    """yurigana's book_text with fold_source_breaks on each EPUB/HTMLZ document (TXT lines are real)."""
    if fmt == 'TXT':
        _check_text_size([os.path.getsize(path)])
        return _text.book_text(path, fmt, ruby, hints)
    with zipfile.ZipFile(path) as archive:
        sizes = {info.filename: info.file_size for info in archive.infolist()}
        if fmt == 'HTMLZ':
            names = sorted(n for n in sizes if n.lower().endswith(('.html', '.xhtml', '.htm')))
        else:
            # What _epub_documents reads to find the documents.
            _check_text_size(size for name, size in sizes.items()
                             if name == 'META-INF/container.xml' or name.lower().endswith('.opf'))
            names = list(_text._epub_documents(archive))
        _check_text_size(sizes.get(name, 0) for name in names)
        parts, offset = [], 0
        for name in names:
            try:
                markup = fold_source_breaks(archive.read(name).decode('utf-8', 'replace'))
            except KeyError:
                continue
            part_hints = [] if hints is not None else None
            part = _text._markup_to_text(markup, ruby, part_hints)
            if part:
                if part_hints:
                    hints.extend((start + offset, end + offset, reading) for start, end, reading in part_hints)
                parts.append(part)
                offset += len(part) + 1
    return '\n'.join(parts)

TOKEN_CLEAN = re.compile(r'[^a-zA-Z0-9぀-ゟ゠-ヿ一-龯Ａ-Ｚａ-ｚ０-９々．]')

# Auxiliaries that are part of a conjugated word in Jiten (anything the deconjugator handles).
CONJUGATING_AUX = {'ない', 'ぬ', 'ん', 'ず', 'た', 'ます', 'れる', 'られる', 'せる', 'させる', 'しめる', 'たい',
                   'たがる', 'う', 'よう', 'まい', 'てる', 'とく', 'ちゃう', 'じゃう', 'ちまう', 'じまう', 'す', 'さす'}
JOINING_PARTICLES = {'て', 'で', 'ば', 'ちゃ', 'じゃ', 'たり', 'だり'}
# Verbs after て/で that Jiten folds into the conjugation (teiru, shimau, toku, ...).
TE_AUXILIARY_VERBS = {'いる', 'おる', 'ある', 'いく', 'ゆく', 'くる', 'しまう', 'おく', 'みる', 'やる', 'あげる',
                      'くれる', 'もらう', 'くださる', 'いただく', 'しまる'}
STEM_AUXILIARY_VERBS = {'すぎる', '過ぎる', 'がる', 'だす', '出す', 'はじめる', '始める', 'つづける', '続ける',
                        'おわる', '終わる'}


# ---------------------------------------------------------------------------
# Visual novel text (book text and its ruby hints: yurigana.text)

_VN_SCRIPT = re.compile(r'^(?:\d+\.txt|nscript\.dat)$', re.I)
_VN_RUBY = re.compile(r'\(([^/)]*)/([^)]*)\)')
# Waits, colours and line ends inside ONScripter text lines.
_VN_CONTROL = re.compile(r'^\s*\[[^\]]*\]|!(?:sd|[sdwz]\d+)|#[0-9a-fA-F]{6}|[@\\/]')


def vn_text(path: str, ruby: dict | None = None, hints: list | None = None) -> str:
    """Text lines of an ONScripter game (its folder, or a ZIP holding one): numbered .txt
    scripts or nscript.dat (XORed with 0x84). Like the reader's scriptCharacters, a text
    line starts with a non-ASCII character or a name tag (left out, `[name|voice]`);
    ruby is (base/reading).
    Encrypted scripts (nscr_sec.dat…) give no text."""
    archive = None
    if os.path.isdir(path):
        scripts = {name: os.path.join(path, name) for name in os.listdir(path) if _VN_SCRIPT.match(name)}
        read = lambda name: open(scripts[name], 'rb').read()  # noqa: E731
        size = lambda name: os.path.getsize(scripts[name])  # noqa: E731
    else:
        archive = zipfile.ZipFile(path)
        names = [n for n in archive.namelist() if _VN_SCRIPT.match(posixpath.basename(n))]
        root = min((posixpath.dirname(n) for n in names), key=lambda d: d.count('/'), default='')
        scripts = {posixpath.basename(n): n for n in names if posixpath.dirname(n) == root}
        read = lambda name: archive.read(scripts[name])  # noqa: E731
        size = lambda name: archive.getinfo(scripts[name]).file_size  # noqa: E731
    try:
        _check_text_size(map(size, scripts))
        txt = sorted((n for n in scripts if n.lower().endswith('.txt')), key=lambda n: int(n.split('.')[0]))
        raw = b'\n'.join(read(n) for n in txt) if txt else \
            bytes(b ^ 0x84 for b in read(next(iter(scripts)))) if scripts else b''
    finally:
        if archive:
            archive.close()
    try:
        script = raw.decode('utf-8')
    except UnicodeDecodeError:
        script = raw.decode('cp932', 'replace')
    lines, offset = [], 0
    for line in script.splitlines():
        if re.match(r'\s*(?:[^\x00-\x7f]|\[)', line):
            if ruby is not None:
                for match in _VN_RUBY.finditer(line):
                    _count_ruby(ruby, match.group(1), match.group(2))
            text = _VN_CONTROL.sub('', _VN_RUBY.sub(r'\1', line)).strip()
            if text:
                if hints is not None:
                    marked = _VN_RUBY.sub(lambda m: _mark_ruby(m.group(1), m.group(2)), line)
                    _take_hints(_VN_CONTROL.sub('', marked).strip(), text, hints, offset)
                lines.append(text)
                offset += len(text) + 1
    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# Words

@dataclass
class Word:
    key: str  # word identity (Jiten: JMdict WordId)
    form: str  # written form (Jiten: ReadingIndex)
    pos: str  # coarse part of speech (_coarse_pos)
    reading: str | None = None  # hiragana reading of an unconjugated word, to tell homographs apart


@dataclass
class Analysis:
    text: str
    # (key, form) -> [Word (first occurrence), occurrences]; Jiten's DeckWords are unique per
    # (WordId, ReadingIndex), so each written form counts as its own word.
    words: dict = field(default_factory=dict)
    # (key, form) -> Counter of each occurrence's reading (for word lists)
    readings: dict = field(default_factory=dict)
    # (key, form) -> Sudachi's reading of the form alone, for words met only conjugated
    form_readings: dict = field(default_factory=dict)
    word_count: int = 0


def _coarse_pos(pos: tuple) -> str:
    p0, p1 = pos[0], pos[1]
    if p0 == '名詞':
        if p1 == '固有名詞':
            return 'name'
        return 'noun'
    return {
        '代名詞': 'pn', '形状詞': 'adj', '連体詞': 'adj', '形容詞': 'adj', '動詞': 'verb', '副詞': 'adv',
        '接続詞': 'conjunc', '感動詞': 'inter', '助動詞': 'aux', '助詞': 'particle', '接頭辞': 'fix',
        '接尾辞': 'fix',
    }.get(p0, 'other')


class Analyzer:
    def __init__(self, sudachi=None):
        """`sudachi`: a SudachiTokenizer (made here when None), or anything with its `tokens` and a
        `tokenizer` whose tokenize() gives morphemes (the browser's, browser.py)."""
        sudachi = sudachi or SudachiTokenizer()
        self.tokenizer = sudachi.tokenizer
        self._tokens = sudachi.tokens
        self.deconjugator = Deconjugator()
        self._text = self._text_tokens = None

    @lru_cache(maxsize=100_000)
    def _form_reading(self, form: str) -> str | None:
        return to_hiragana(''.join(t.reading_form() for t in self.tokenizer.tokenize(form))) or None

    def tokens(self, text: str) -> list:
        """Sudachi tokens of `text`; a Reader made with this Analyzer as its tokenizer gets the
        tokens analyse() already has instead of tokenizing the book again."""
        if text is not self._text:
            self._text, self._text_tokens = text, list(self._tokens(text))
        return self._text_tokens

    def analyse(self, text: str, hints=(), reader=None, frequency=None) -> Analysis:
        """`hints`: (start, end, ruby) from book_text. `reader` (a yurigana Reader, made with
        this Analyzer as its tokenizer) gives each occurrence's reading in `readings`: the
        book's ruby, a context rule, the reading model, a default or the list's only reading,
        else Sudachi's, as in readings files (carry={}: a name's ruby read for its bare occurrences
        too, so the browser reads the book once for both). Tokens it reads as part
        of a longer word (a compound: 三日月 みかづき) keep Sudachi's. Word.reading stays Sudachi's.
        With `frequency` (a FrequencyTable), JMdict compounds Sudachi splits are words again (compound_merge: 心配顔 しんぱいがお, not 顔 がお)."""
        result = Analysis(text=text)
        tokens = self.tokens(text)
        # A number + counter span (三本 さんぼん) and compounds are Words over several tokens:
        # only a Word over exactly the head token is its reading (the counter's own: 本 ほん).
        read = {(w.start, w.end): w for w in reader.read(text, hints, carry={})} if reader else {}
        self._text = self._text_tokens = None  # don't keep a book's tokens past its analysis
        if frequency is not None:
            tokens = merge_compounds(tokens, frequency, {span: w.reading for span, w in read.items() if w.reading})

        index = 0
        while index < len(tokens):
            head = tokens[index]
            pos = head.part_of_speech()
            end = index + 1

            # Suru verb: 勉強 + する is one word.
            suru = False
            if (pos[0] == '名詞' and pos[2] == 'サ変可能' and end < len(tokens)
                    and tokens[end].dictionary_form() in ('する', '為る') and tokens[end].part_of_speech()[0] == '動詞'):
                end += 1
                suru = pos_inflects = True
            else:
                pos_inflects = pos[0] in ('動詞', '形容詞', '助動詞') or pos[4] != '*'

            if pos_inflects:
                after_te = False
                while end < len(tokens):
                    token = tokens[end]
                    tpos = token.part_of_speech()
                    form = token.dictionary_form()
                    if tpos[0] == '助動詞' and form in CONJUGATING_AUX:
                        pass
                    elif tpos[0] == '形容詞' and tpos[1] == '非自立可能' and form in ('ない', '無い'):
                        pass
                    elif tpos[0] == '形状詞' and tpos[1] == '助動詞語幹' and form == 'そう':
                        pass
                    elif tpos[0] == '助詞' and tpos[1] == '接続助詞' and token.surface() in JOINING_PARTICLES:
                        end += 1
                        after_te = token.surface() in ('て', 'で')
                        if not after_te:
                            break
                        continue
                    elif tpos[0] in ('動詞', '接尾辞') and (
                            (after_te and form in TE_AUXILIARY_VERBS)
                            or form in STEM_AUXILIARY_VERBS):
                        pass
                    else:
                        break
                    after_te = False
                    end += 1

            coarse = _coarse_pos(pos)
            head_surface, head_form, normalized = head.surface(), head.dictionary_form(), head.normalized_form()
            form = head_surface if suru else head_form
            word_key = (f'{normalized}\t{coarse}', form)
            word_reading = to_hiragana(head.reading_form()) if head_surface == head_form else None
            entry = result.words.get(word_key)
            if entry:
                entry[1] += 1
                occurrence_readings = result.readings[word_key]
            else:
                result.words[word_key] = [Word(key=word_key[0], form=form, pos=coarse, reading=word_reading), 1]
                occurrence_readings = result.readings[word_key] = Counter()
            own = read.get((head.begin, head.begin + len(head_surface)))
            reading = own.reading if own and own.form == form else None
            occurrence_readings[reading or word_reading] += 1
            if not (reading or word_reading) and word_key not in result.form_readings:
                result.form_readings[word_key] = self._form_reading(form)
            result.word_count += 1
            index = end
        return result
