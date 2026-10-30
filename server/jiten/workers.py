"""What runs in the worker processes: their initializers and tasks (pickled by name, so module-level), and
the files they read and write: book and manga text, kanji counts, word lists, readings files."""
import gzip
import hashlib
import json
import os
import time
from collections import Counter

import core
import readerpack
import readings_file
import settings
from word_list import word_rows

# Estimate workers: Sudachi and the frequency list (core.py), no Reader or models.
_tokenizer = None
_frequency = None
# The word-list worker: the Analyzer (Sudachi, deconjugation) and a yurigana Reader for the rows' readings.
_analyzer = None
# A yurigana Reader: word-list readings in the word-list worker, readings files in the readings worker.
_reader = None


def _load_frequency():
    from frequency import FrequencyTable
    return (FrequencyTable.load_packed(settings.FREQUENCY_PACK) if readerpack.reader_pack_current()
            else FrequencyTable.load(settings.FREQUENCY_DICTIONARY))


def _init_worker():
    global _tokenizer, _frequency
    from yurigana.tokens import SudachiTokenizer
    _tokenizer = SudachiTokenizer()
    _frequency = _load_frequency()


def _init_words_worker():
    global _analyzer, _frequency, _reader
    from yurigana.yomitan import with_extra_readings
    from features import Analyzer
    _analyzer = Analyzer()
    _frequency = _load_frequency()
    # Sharing the Analyzer's tokens and the list's readings: no second Sudachi or copy of the list.
    # The extra readings (描く かく…) as Reader(known=path) adds them.
    _reader = readerpack._load_reader(_analyzer, lambda: with_extra_readings(_frequency.reading_ranks))


def save_kanji(book_id: int, text: str):
    os.makedirs(settings.KANJI_DIR, exist_ok=True)
    path = os.path.join(settings.KANJI_DIR, f'{book_id}.json.gz')
    counts = Counter(core.KANJI.findall(text))  # features.is_kanji's characters, in C
    with gzip.open(path + '.tmp', 'wt', encoding='utf-8') as f:
        json.dump(dict(counts), f, ensure_ascii=False, separators=(',', ':'))
    os.replace(path + '.tmp', path)
    return len(counts)


def words_path(book_id: int) -> str:
    return os.path.join(settings.WORDS_DIR, f'v{settings.WORDS_VERSION}', f'{book_id}.json.gz')


def legacy_words_path(book_id: int) -> str:
    return os.path.join(settings.WORDS_DIR, f'{book_id}.json.gz')


def write_words(book_id: int, data: dict):
    path = words_path(book_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path + '.tmp', 'wt', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(path + '.tmp', path)


def save_words(book_id: int, analysis, frequency):
    """The book's WORDS_PER_BOOK most frequent words (word_list.word_rows) at words_path, with the
    number of rows and their occurrences before the cap, without noise (is_noise_word), so the
    reader can count the words past the cap as unknown. Returns those two."""
    rows, unique_words, tokens = word_rows(analysis, frequency)
    write_words(book_id, {'words': rows[:settings.WORDS_PER_BOOK], 'uniqueWords': unique_words, 'tokens': tokens})
    return unique_words, tokens


def remove_words(book_id: int):
    """Drops a book's word list (its text changed): the next request makes it again."""
    for path in (words_path(book_id), legacy_words_path(book_id)):
        try:
            os.remove(path)
        except OSError:
            pass


def manga_path(book_id: int) -> str:
    return os.path.join(settings.MOKURO_DIR, f'{book_id}.json')


def manga_text_stamp(book_id: int):
    """The mokuro file's time (ms), None without one: an estimate made from older text is redone."""
    try:
        return int(os.path.getmtime(manga_path(book_id)) * 1000)
    except OSError:
        return None


def manga_text(book_id: int) -> str:
    """A manga volume's text, one speech bubble a line (mokuro splits a bubble into the lines it
    drew; they are one text). Empty without a mokuro file. mokuroPlainText in mokuro.ts reads alike."""
    try:
        with open(manga_path(book_id), encoding='utf-8') as f:
            pages = json.load(f)['pages']
    except (OSError, ValueError, KeyError, TypeError):
        return ''
    return '\n'.join(text for page in pages for block in page.get('blocks', [])
                     if (text := ''.join(block.get('lines', [])).strip()))


def _book_text(book: dict):
    """The book's text, its ruby counts and hints (features.book_text), and its character count."""
    from features import TOKEN_CLEAN, book_text, vn_text
    ruby, hints = {}, []
    if book.get('manga'):
        text = manga_text(book['id'])
    elif book.get('vn'):
        text = vn_text(os.path.join(settings.VN_DIR if book['format'] == 'VN' else settings.LIBRARY, book['file']), ruby, hints)
    else:
        text = book_text(os.path.join(settings.LIBRARY, book['file']), book['format'], ruby, hints)
    return text, ruby, hints, len(TOKEN_CLEAN.sub('', text))


def _estimate(book: dict):
    """(id, estimate) of a book (None: too little text): the core's numbers (core.py), the character
    and kanji counts. No Reader, features or model: ~0.4 s a book."""
    text, ruby, _, characters = _book_text(book)
    if characters < 1000:
        return book['id'], None
    return book['id'], {
        'characters': characters,
        'uniqueKanji': save_kanji(book['id'], text),
        # V98, names, the log-rank histogram and the facets; the app puts V98 on the 1-10 scale (core-scale.json).
        'core': core.book_core(_tokenizer.tokens(text), _frequency, text, ruby.get('kanji', 0)),
        'engine': readerpack.current_engine(),
        'computedAt': int(time.time() * 1000),
        # Manga: the mokuro text it was made from (manga_text_stamp).
        **({'text': book['text']} if book.get('manga') else {}),
    }


def _make_words(book_id: int, book: dict):
    """The book's word list (save_words), with yurigana's readings in context."""
    text, _, hints, characters = _book_text(book)
    if characters < 1000:
        raise ValueError('too little text')
    save_words(book_id, _analyzer.analyse(text, hints, _reader, _frequency), _frequency)


def _init_readings_worker():
    global _reader
    from features import Analyzer
    # The known list and the server's reading model the estimates use (yurigana adds its public table).
    # The Analyzer keeps the last text's tokens: readings_file.build and Reader.read tokenize the book once.
    _reader = readerpack._load_reader(Analyzer())


def readings_path(book_id: int) -> str:
    return os.path.join(settings.READINGS_DIR, f'{book_id}.json.gz')


def text_html(path: str) -> str:
    """The elementHtml of a text copy (gzipped JSON), unpacked up to MAX_STATICDATA_BYTES."""
    with gzip.open(path, 'rb') as f:
        data = f.read(settings.MAX_STATICDATA_BYTES + 1)
    if len(data) > settings.MAX_STATICDATA_BYTES:
        raise ValueError('the text copy is too large')
    html = json.loads(data)['elementHtml']
    if not isinstance(html, str):
        raise ValueError('the text copy has no elementHtml')
    return html


def html_digest(html: str) -> str:
    return hashlib.sha256(html.encode()).hexdigest()


def _make_readings(book_id: int, job: tuple[str, str]):
    path, name = job
    html = text_html(path)
    data = readings_file.build(html, _reader, name, readerpack.reader_version())
    readings_file.write(readings_path(book_id), {**data, 'html': html_digest(html)})


def find_text(book: dict) -> tuple[str, str] | None:
    """(path, name) of the book's text copy, named by its mtime so a new upload is a new name; or None."""
    book_id = book.get('bookId')
    if type(book_id) is not int:
        return None
    path = os.path.join(settings.TEXT_DIR, f'{book_id}.json.gz')
    try:
        return path, f'text_{int(os.path.getmtime(path) * 1000)}'
    except OSError:
        return None
