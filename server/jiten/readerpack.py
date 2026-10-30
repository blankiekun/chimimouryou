"""The Reader and frequency packs every worker loads (ensure_reader_pack), the installed frequency list's
ranks (POST ranks), the term dictionaries and the versions made from them (current_engine, reader_version)."""
import hashlib
import json
import os
import sys
import threading
import zipfile
from concurrent.futures import ProcessPoolExecutor

from yurigana import __version__ as YURIGANA_VERSION

import settings
from engine import engine_fingerprint


def _load_reader(tokenizer=None, known=lambda: settings.FREQUENCY_DICTIONARY):
    """READER_PACK's Reader, or one built here when the file is missing or another yurigana saved it.
    `known` gives the list to build from: the same pairs as the file's (Reader(known=path) reads them
    as FrequencyTable does and adds with_extra_readings')."""
    from yurigana import Reader
    try:
        if reader_pack_current():
            return Reader.load(settings.READER_PACK, tables=settings.READING_MODEL_TABLES, tokenizer=tokenizer)
    except (OSError, ValueError) as error:
        print(f'reader pack: {error}', file=sys.stderr, flush=True)
    return Reader(known=known(), tables=settings.READING_MODEL_TABLES, tokenizer=tokenizer, **term_options())


# POST ranks: kept until the frequency list changes (form_ranks).
_form_ranks = (None, {})
_form_ranks_lock = threading.Lock()


def form_ranks(forms) -> dict:
    """form -> its best rank in the installed frequency list, for the forms it lists. The packed table when
    current (shared pages, nothing parsed), else the list itself, kept until the list changes."""
    global _form_ranks
    from frequency import FrequencyTable, load_yomitan_ranks
    try:
        stat = os.stat(settings.FREQUENCY_DICTIONARY)
    except OSError:
        return {}
    key = (stat.st_mtime_ns, stat.st_size)
    with _form_ranks_lock:
        if _form_ranks[0] != key:
            ranks = (FrequencyTable.load_packed(settings.FREQUENCY_PACK).ranks if reader_pack_current()
                     else load_yomitan_ranks(settings.FREQUENCY_DICTIONARY))
            _form_ranks = (key, ranks)
        ranks = _form_ranks[1]
    return {form: ranks[form] for form in forms if isinstance(form, str) and form in ranks}


def reader_pack_key() -> str:
    paths = [settings.FREQUENCY_DICTIONARY, *term_dictionaries()]
    return f'{reader_version()} pack{settings.PACK_FORMAT} ' + ','.join(f'{os.path.basename(p)}:{os.path.getsize(p)}:{os.path.getmtime(p)}'
                                             for p in paths if os.path.exists(p))


def reader_pack_current() -> bool:
    try:
        with open(settings.READER_PACK + '.key', encoding='utf-8') as f:
            return f.read() == reader_pack_key() and os.path.exists(settings.READER_PACK) and os.path.exists(settings.FREQUENCY_PACK)
    except OSError:
        return False


def _save_reader_pack(key: str):
    from yurigana import Reader
    from frequency import FrequencyTable
    FrequencyTable.load(settings.FREQUENCY_DICTIONARY).save(settings.FREQUENCY_PACK)
    Reader(known=settings.FREQUENCY_DICTIONARY, **term_options()).save(settings.READER_PACK + '.tmp')
    os.replace(settings.READER_PACK + '.tmp', settings.READER_PACK)
    with open(settings.READER_PACK + '.key.tmp', 'w', encoding='utf-8') as f:
        f.write(key)
    os.replace(settings.READER_PACK + '.key.tmp', settings.READER_PACK + '.key')


_reader_pack_lock = threading.Lock()


def ensure_reader_pack():
    """Builds READER_PACK, in a process of its own (its memory goes back when it exits), when it is
    missing or its inputs changed. Workers that start meanwhile build their own Reader."""
    with _reader_pack_lock:
        if reader_pack_current() or not os.path.exists(settings.FREQUENCY_DICTIONARY):
            return
        try:
            with ProcessPoolExecutor(1) as pool:
                pool.submit(_save_reader_pack, reader_pack_key()).result()
        except Exception as error:
            print(f'reader pack: {error}', file=sys.stderr, flush=True)


def term_dictionaries() -> list:
    """The installed term dictionaries' paths, by name."""
    try:
        return sorted(os.path.join(settings.TERM_DICTIONARY_DIR, n) for n in os.listdir(settings.TERM_DICTIONARY_DIR) if n.endswith('.zip'))
    except OSError:
        return []


def is_name_dictionary(path: str) -> bool:
    """JMnedict (by its index title): a name dictionary, Reader(names=...): it shows names it reads one way
    (姫路 ひめじ) and changes no reading. Its rows aren't terms (the readings are glosses)."""
    try:
        with zipfile.ZipFile(path) as archive:
            return str(json.loads(archive.read('index.json')).get('title', '')).lower().startswith('jmnedict')
    except (OSError, zipfile.BadZipFile, KeyError, ValueError, AttributeError):
        return False


def term_options() -> dict:
    """Reader's terms and names arguments, none without dictionaries (and with a yurigana that has none)."""
    paths = term_dictionaries()
    names = [p for p in paths if is_name_dictionary(p)]
    terms = [p for p in paths if p not in names]
    return ({'terms': terms} if terms else {}) | ({'names': names} if names else {})


def current_engine() -> str:
    """This server's engine fingerprint (engine.py): its frequency list, yurigana, Sudachi dictionary
    and reading-model table. Term dictionaries are left out: they change word lists' readings only, not
    the estimate (the core uses Sudachi's tokens), so a server with them still makes canonical estimates."""
    from importlib.metadata import PackageNotFoundError, version
    try:
        sudachi = 'core-' + version('SudachiDict-core')
    except PackageNotFoundError:
        sudachi = 'core-unknown'
    extras = [p for p in settings.READING_MODEL_TABLES if os.path.exists(p)]
    return engine_fingerprint(settings.FREQUENCY_DICTIONARY, YURIGANA_VERSION, sudachi, extras)


def reader_version() -> str:
    """yurigana's version, plus the term dictionaries (name, size) when there are any: readings files made
    with others are stale."""
    paths = term_dictionaries()
    if not paths:
        return YURIGANA_VERSION
    names = ','.join(f'{os.path.basename(p)}:{os.path.getsize(p)}' for p in paths)
    return f'{YURIGANA_VERSION}+terms.{hashlib.sha256(names.encode()).hexdigest()[:12]}'
