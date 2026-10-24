"""Readings files (#17): which reading each kanji word of a book has in context, and the
furigana the reader may add for it, in the reader's own character counts.

The input is the reader's processed book (staticdata.json's elementHtml in a bookdata_*.zip of
the book's sync folder), counted exactly like the reader does (get-paragraph-nodes.ts,
get-character-count.ts), so offsets are bookmark positions. The output, gzipped JSON:

  v, yurigana     READINGS_VERSION and yurigana's version that made it
  bookdata        the bookdata file it was made from
  characters      the book's character count
  words           [[form, reading or null]]: dictionary forms and their readings
  glosses         [[[offset, length, base, ruby], ...]]: furigana per kanji run, offsets in
                  characters from the word's start; base is the text it goes over
  occ             [Δstart, word index, gloss index or -1, ...]: each kanji word in reading
                  order, start in characters from the previous one's; a number + counter
                  span (三本 さんぼん) comes right before its tokens' own words, at the same start
  len             [length, ...]: each occ entry's surface length in characters, a verb's or
                  adjective's auxiliaries included (黙り込んだ 5, 食べさせられた 6; not て)
"""
import gzip
import json
import os
import re
from html.parser import HTMLParser

from yurigana.readings import surface_reading

# 1: first version. 2: yurigana 0.2.0 (counter spans, names' ruby carried, 来た glossed き).
# 3: SudachiDict-core instead of -full (compounds split differently, about 1% of occurrences),
#    yurigana 0.3.0.
# 4: yurigana 0.5.0 (ateji, shown idioms, bare-evidence dominant readings, name ruby carried back).
# 5: names' ruby carried to their bare occurrences (source 'book') glossed.
# 8: every reading glossed, not only the sure ones (defaults, Sudachi's, counter spans too).
# 9: `len`, each occurrence's surface length with its auxiliaries.
READINGS_VERSION = 9

# Radical and Unified_Ideograph as in Unicode 16.
# shortcut: newer CJK extensions are missing, add them when browsers count them.
_RADICAL = '⺀-⺙⺛-⻳⼀-⿕'
_IDEOGRAPH = ('㐀-䶿一-鿿﨎﨏﨑﨓﨔﨟﨡﨣﨤﨧-﨩'
              '\U00020000-\U0002a6df\U0002a700-\U0002b739\U0002b740-\U0002b81d\U0002b820-\U0002cea1'
              '\U0002ceb0-\U0002ebe0\U0002ebf0-\U0002ee5d\U00030000-\U0003134a\U00031350-\U000323af')
# get-character-count.ts's set (/iu); Python's re.I also folds ı and İ into it, JavaScript's doesn't.
_COUNTED = re.compile(f'[0-9A-Z○◯々-〇〻ぁ-ゖゝ-ゞァ-ヺー０-９Ａ-Ｚｦ-ﾝ{_RADICAL}{_IDEOGRAPH}]', re.I)
KANJI_RUN = re.compile(f'[{_IDEOGRAPH}々〆ヶ]+')
HIRAGANA = re.compile(r'^[ぁ-ゖー]+$')
KATAKANA = re.compile(r'^[ァ-ヺー・]+$')
# A gaiji image in the text (counts as one character); a symbol to the tokenizer.
GAIJI = '〓'
BLOCK = {'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'tr', 'dd', 'dt', 'section', 'article'}
VOID = {'br', 'img', 'hr', 'meta', 'link', 'input', 'source', 'wbr', 'col', 'area', 'base', 'embed', 'param', 'track'}


def is_counted(char: str) -> bool:
    return bool(_COUNTED.match(char)) and char not in 'ıİ'


class Extract(HTMLParser):
    """Text as get-paragraph-nodes.ts sees it: rt and [hidden]/[aria-hidden] subtrees skipped,
    a gaiji image (class containing 'gaiji') one GAIJI, a newline at block ends. Ruby is kept as
    (start, end, reading) hints like yurigana's book_text; rp text is left out of the text
    unless it has counted characters (the reader counts those; that ruby gives no hint)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.stack, self.hints, self.gaiji = [], [], [], set()
        self.length, self.skip, self.ruby, self.rp = 0, 0, None, None

    def put(self, text):
        self.parts.append(text)
        self.length += len(text)

    def handle_starttag(self, tag, attrs):
        names = {name for name, _ in attrs}
        hidden = 'hidden' in names or 'aria-hidden' in names
        if tag == 'img':
            if not self.skip and not hidden and any('gaiji' in c for c in (dict(attrs).get('class') or '').split()):
                self.gaiji.add(self.length)
                self.put(GAIJI)
            return
        if tag in VOID:
            if tag == 'br':
                self.put('\n')
            return
        hidden = hidden or tag == 'rt'
        self.stack.append((tag, hidden))
        self.skip += hidden
        if tag == 'ruby' and not self.skip:
            self.ruby = [self.length, []]
        if tag == 'rp' and not self.skip:
            self.rp = []

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in VOID or not any(t == tag for t, _ in self.stack):
            return
        while self.stack:
            name, hidden = self.stack.pop()
            self.skip -= hidden
            if name == 'rp' and self.rp is not None:
                text = ''.join(self.rp)
                if any(is_counted(c) for c in text):
                    self.put(text)
                    self.ruby = None  # odd markup: no hint rather than one over the rp text
                self.rp = None
            if name == 'ruby' and self.ruby is not None:
                start, reading = self.ruby
                reading = re.sub(r'\s', '', ''.join(reading))
                if reading and self.length > start:
                    self.hints.append((start, self.length, reading))
                self.ruby = None
            if name == tag:
                break
        if tag in BLOCK:
            self.put('\n')

    def handle_data(self, data):
        if self.ruby is not None and self.stack and self.stack[-1][0] == 'rt':
            self.ruby[1].append(data)
        if self.skip:
            return
        if self.rp is not None:
            self.rp.append(data)
        else:
            self.put(data)


def extract(html: str):
    """(text, hints, counts): counts[i] is the reader's character count before text[i]
    (len(text) + 1 entries, the last one the book's total)."""
    parser = Extract()
    parser.feed(html)
    parser.close()
    text = ''.join(parser.parts)
    counts, n = [], 0
    for i, char in enumerate(text):
        counts.append(n)
        if i in parser.gaiji or is_counted(char):
            n += 1
    counts.append(n)
    return text, parser.hints, counts


def to_hiragana(text: str) -> str:
    return ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in text)


def gloss(surface: str, form: str, reading: str, after: str = ''):
    """The dictionary form's reading split over the surface's kanji runs, [(offset, run,
    ruby)] (行っ, 行く, いく: [(0, 行, い)]), or None when the runs differ or don't align.
    The surface's own reading when yurigana gives one (来た, 来る, くる: き; `after` is the text
    after the surface)."""
    spoken = surface_reading(surface, form, reading, after)
    if spoken:
        form, reading = surface, spoken
    runs = [(m.start(), m.group()) for m in KANJI_RUN.finditer(surface)]
    if not runs or [run for _, run in runs] != KANJI_RUN.findall(form):
        return None
    pattern = ''.join('(.+?)' if KANJI_RUN.fullmatch(part) else re.escape(to_hiragana(part))
                      for part in re.split(f'({KANJI_RUN.pattern})', form) if part)
    match = re.fullmatch(pattern, reading)
    return match and [(offset, run, ruby) for (offset, run), ruby in zip(runs, match.groups())]


def build(html: str, reader, bookdata: str, version: str, extracted: tuple | None = None) -> dict:
    """The readings file of a book's elementHtml, read by a yurigana Reader. `extracted`: extract(html),
    when the caller has it."""
    text, hints, counts = extracted or extract(html)
    covering = {}
    for start, end, reading in hints:
        for i in range(start, end):
            covering[i] = (start, end, reading)
    words, glosses, occ, lengths = {}, {}, [], []
    # A verb's or adjective's span takes the auxiliaries after it (黙り込ん|だ, 食べ|させ|られ|た).
    begins, ends = {}, {}
    for token in reader.tokenizer.tokens(text):
        begins[token.begin] = token
        ends[token.begin + len(token.surface())] = token.part_of_speech()[0]
    flavoured = set()  # forms the book gave a ruby that isn't their reading (マジ over 本気)
    last = 0
    # carry: a name's ruby read for its bare occurrences (source 'book'), glossed like the others.
    for word in reader.read(text, hints, carry={}):
        under = {covering[i] for i in range(word.start, word.end) if i in covering}
        shown = -1
        if under:
            # Under the book's own ruby: never ours. Ruby that isn't the word's reading marks
            # the form as flavour-rubied, so later bare ones get none either.
            if word.source != 'ruby' and any(
                    KATAKANA.match(ruby) or KANJI_RUN.search(ruby)
                    or (len(under) == 1 and HIRAGANA.match(ruby) and start <= word.start and end >= word.end)
                    for start, end, ruby in under):
                flavoured.add(word.form)
        elif (word.form not in flavoured and word.source != 'ruby'
              and word.reading and HIRAGANA.match(word.reading)):
            parts = gloss(text[word.start:word.end], word.form, word.reading, text[word.end:word.end + 8])
            if parts:
                begin = counts[word.start]
                key = tuple((counts[word.start + offset] - begin, len(run), run, ruby) for offset, run, ruby in parts)
                shown = glosses.setdefault(key, len(glosses))
        index = words.setdefault((word.form, word.reading), len(words))
        occ += [counts[word.start] - last, index, shown]
        end = word.end
        if ends.get(end) in ('動詞', '形容詞'):
            while (token := begins.get(end)) and token.part_of_speech()[0] == '助動詞' and not KANJI_RUN.search(token.surface()):
                end += len(token.surface())
        lengths.append(counts[end] - counts[word.start])
        last = counts[word.start]
    return {'v': READINGS_VERSION, 'yurigana': version, 'bookdata': bookdata, 'characters': counts[-1],
            'words': [list(key) for key in words], 'glosses': [[list(part) for part in key] for key in glosses],
            'occ': occ, 'len': lengths}


def write(path: str, data: dict):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path + '.tmp', 'wt', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(path + '.tmp', path)


def header(path: str):
    """(v, yurigana, bookdata, html digest or None) of a readings file, or None."""
    try:
        with gzip.open(path, 'rt', encoding='utf-8') as f:
            data = json.load(f)
        return data['v'], data['yurigana'], data['bookdata'], data.get('html')
    except (OSError, ValueError, KeyError, TypeError):
        return None


def retarget(path: str, bookdata: str):
    """Records a newer bookdata of the same text as the file's source."""
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        data = json.load(f)
    write(path, {**data, 'bookdata': bookdata})


def sanitize_for_filename(title: str) -> str:
    """A title's sync folder name: BaseStorageHandler.sanitizeForFilename."""
    title = re.sub(r' \Z', '~ttu-spc~', title)
    title = re.sub(r'\.\Z', '~ttu-dend~', title)
    title = title.replace('*', '~ttu-star~')
    return re.sub(r'[/?<>\\:*|%"]', lambda m: '%%%02X' % ord(m.group()), title)
