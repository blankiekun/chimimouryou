"""The difficulty service's settings: paths and limits from the environment, and the versions of the
files it writes (WORDS_VERSION). Imports nothing of the service's own."""
import os

import httpbase

LIBRARY = os.environ.get('CALIBRE_LIBRARY', '/library')
# Unpacked visual novels (catalog format 'VN'; their 'file' is relative to it).
VN_DIR = os.environ.get('VN_DIR', '/vn')
CATALOG_PATH = os.environ.get('CALIBRE_CATALOG', '/data/state/catalog/catalog.json')
STATE_DIR = os.environ.get('JITEN_STATE_DIR', '/data/state/difficulty')
# Rank-based Yomitan frequency dictionary: Jiten's list (jiten.moe/frequency-dictionaries).
FREQUENCY_DICTIONARY = os.environ.get('JITEN_FREQUENCY_DICTIONARY',
                                      os.path.join(STATE_DIR, 'frequency-dictionary.zip'))
# The same list shipped with the code (data/README.md): installed on start when none is.
BUNDLED_FREQUENCY_DICTIONARY = os.path.join(os.path.dirname(os.path.realpath(__file__)),
                                            'data', 'jiten_freq_global.zip')
RESULTS_PATH = os.path.join(STATE_DIR, 'difficulty.json')
MAX_DICTIONARY_BYTES = 64 * 1024 * 1024
# Sanity gate for uploads: Jiten's list has about 500,000 terms, and a new version keeps the readings
# of its most frequent forms; a list that doesn't is refused unless forced.
MIN_DICTIONARY_TERMS = 50_000
AGREEMENT_FORMS = 5000
MIN_AGREEMENT = 0.95
# Yomitan term dictionaries admins upload (bring your own: none is bundled): yurigana's Reader(terms=...) reads
# them for words the frequency list and JMdict lack, in word lists and readings files; JMnedict is read as a
# name dictionary (Reader(names=...), is_name_dictionary). Large dictionaries are
# 50-200 MB zips; a sanity gate refuses files with few usable terms (not a term dictionary).
TERM_DICTIONARY_DIR = os.path.join(STATE_DIR, 'term-dictionaries')
MAX_TERM_DICTIONARY_BYTES = 256 * 1024 * 1024
MIN_TERM_DICTIONARY_TERMS = 1_000
# Readings in context for word lists and readings files (a yurigana Reader): the server's own
# reading-model table, built from its library by `python -m yurigana.reading_context build`; the
# Reader adds yurigana's public one (Aozora Bunko and Tatoeba) for other forms.
READING_MODEL_TABLES = [os.path.join(STATE_DIR, 'reading-model.json.gz')]
# Per-book kanji counts, gzipped JSON, for the reader's own coverage.
KANJI_DIR = os.path.join(STATE_DIR, 'kanji')
# Per-book word lists, gzipped JSON, for "words to study": made on first request, in a folder per
# WORDS_VERSION (words_path), capped to bound their size.
WORDS_DIR = os.path.join(STATE_DIR, 'words')
WORDS_PER_BOOK = 2000
# A request for a missing list waits this long for it (most books take 1-3 s), else gets a 503.
WORDS_WAIT = 20
# The word lists' version (words_path); a list of another is made again when asked for.
# 2: one row per (form, reading). 3: the book's own ruby gives readings (yurigana's ruby_reading).
# 4: context rules for ambiguous forms (yurigana's context_reading).
# 5: more of the ruby: per-kanji spans, kanji stems of inflected words, large kana; 人気がない
#    reads ひとけ only with a cue.
# 6: a reading model learned from ruby reads ambiguous forms no rule covers (yurigana's ReadingModel).
# Moving the readings to yurigana 0.1.1 changed no reading.
# 7: readings for words met only conjugated, rows of one form and reading merged, particles and
#    auxiliaries dropped by part of speech, a 5th column: the lemma; yurigana 0.2.0's context rules
#    and models; a voiced reading the list lacks counts for the unvoiced one (箱 ばこ: はこ).
# 8: readings from yurigana's whole Reader, as readings files have them: defaults, the list's only
#    reading, counters (本 in 三本: ほん), rendaku, readings of conjugated occurrences.
# 9: SudachiDict-core instead of -full (compounds split differently, 3-10% of rows), and
#    yurigana 0.3.0 (context rules for hard nouns and verbs, compound joins, native つ counts,
#    hand-checked extra readings).
# 10: yurigana 0.5.0 (ateji, shown idioms, bare-evidence dominant readings such as 私 わたし).
# 11: yurigana 0.5.1 (行っ on a going cue reads いっ; an uploaded JMnedict is a name dictionary).
# 12: yurigana 0.5.3 (top readings of 118 forms, voiced tails after a noun, 血肉 ちにく).
# 17: the book's ruby over a name carried to its bare occurrences (carry={}), as in readings files
#    (蝎 さそり, 叮寧 ていねい), so the browser reads a book once for both.
# 18: SudachiDict-core 20261015 (normalized forms of ずる verbs: 封ずる 封じる; a few readings and
#    compounds such as 気に入る).
# 19: JMdict compounds Sudachi splits joined again when commoner than their rarest part
#    (compound_merge: 心配顔, not 顔 がお), and a voiced reading the list ranks takes the unvoiced
#    one's rank when better (顔 がお: かお's).
# 20: source line breaks folded in book_text (features.fold_source_breaks): pretty-printed ruby no
#    longer splits words (呟 いた).
WORDS_VERSION = 20
# Lists made with their estimate, before lists were made on request: WORDS_DIR/<id>.json.gz, a bare
# list of rows, version 19 (its totals were the estimate's: migrate_word_lists keeps them).
LEGACY_WORDS_VERSION = 19
# Readings files (#17), made from the reader's text copy of the book (PUT /api/v1/books/{id}/text):
# <TEXT_DIR>/<bookId>.json.gz, found by the catalog entry's bookId (library.db's books.id).
TEXT_DIR = os.environ.get('TEXT_DIR', '/data/state/api/text')
# Manga text from the mokuro service (<id>.json, mokuro/service.py), read-only here: a manga volume is
# estimated from it, and again whenever the file changes (watch_manga_text, every MANGA_TEXT_CHECK_SECONDS).
MOKURO_DIR = os.environ.get('MOKURO_STATE_DIR', '/data/state/mokuro')
MANGA_TEXT_CHECK_SECONDS = 60
READINGS_DIR = os.path.join(STATE_DIR, 'readings')
READINGS_QUEUE_MAX = 100
MAX_STATICDATA_BYTES = 30 * 1024 * 1024
# Building a file takes ~3 s: keep the readings worker this long after its last file so the next
# book opened doesn't start a process again (its Reader loads from READER_PACK at once).
READINGS_KEEP_ALIVE = 120
# A POST holds the request this long for a file that gets ready, so most books are answered at once
# rather than at the client's first poll (3 s). The client gives up after 5 s.
READINGS_WAIT = 3.5
# The Reader's tables (known list, JMdict, term dictionaries): built once (~20 s, ~620 MB) by
# Reader.save, then every worker maps the file (Reader.load: no parse, ~100 MB, pages shared).
# The .key file names the inputs it was built from.
READER_PACK = os.path.join(STATE_DIR, 'reader.ygp')
# The frequency list the same way (FrequencyTable.save/load_packed, ~450 MB as dicts), built with it.
FREQUENCY_PACK = os.path.join(STATE_DIR, 'frequency.ygp')
WORKERS = int(os.environ.get('JITEN_WORKERS', os.cpu_count() or 1))
PORT = int(os.environ.get('JITEN_PORT', '8765'))
HOST = os.environ.get('JITEN_HOST', '127.0.0.1')
# Made by the web container; nginx sends it as X-Internal-Token, so only nginx can call this service.
INTERNAL_TOKEN_FILE = os.environ.get('INTERNAL_TOKEN_FILE', '/data/state/internal-token')
ALLOW_HTTP = os.environ.get('ALLOW_HTTP_ACCOUNTS') == '1'
# Server connect: the standalone app's origins; nginx's auth check took its bearer token.
CORS_ORIGINS = httpbase.parse_cors_origins(os.environ.get('CORS_ORIGINS', ''))
# The JSON bodies of compute, cancel and terms/remove (nginx's default limit for them).
MAX_JSON_BYTES = 1024 * 1024
# Worker processes are replaced after this many books to bound their memory.
BOOKS_PER_POOL = 300
# The reader and frequency packs' format (readerpack.py).
# 2: FREQUENCY_PACK has the JMdict compound table (compound_merge), so older packs are rebuilt.
PACK_FORMAT = 2
# POST ranks: a reader's Anki deck and marks, sent once and cached by the reader.
MAX_RANKS_BYTES = 1024 * 1024
MAX_RANK_FORMS = 50_000
