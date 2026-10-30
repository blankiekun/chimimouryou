"""Installing the frequency list and term dictionaries, never while a job runs (holds_off_jobs)."""
import functools
import os
import re
import shutil
import zipfile

import jobs
import readerpack
import settings


def holds_off_jobs(install):
    """No job may start while a dictionary is replaced: its pools would mix the old list and the new."""
    @functools.wraps(install)
    def wrapper(*args, **kwargs):
        with jobs.runner.lock:
            if jobs.runner.installing or (jobs.runner.job and not jobs.runner.job.get('finished')):
                raise RuntimeError('Wait until the running job has finished')
            jobs.runner.installing = True
        try:
            return install(*args, **kwargs)
        finally:
            jobs.runner.installing = False
    return wrapper


class DictionaryMismatch(ValueError):
    """A replacement list whose readings disagree with the installed one."""
    def __init__(self, agreement: float):
        super().__init__(f'The readings of its {settings.AGREEMENT_FORMS:,} most frequent words agree with the installed '
                         f'list on only {agreement:.1%}')
        self.agreement = agreement


def install_bundled_dictionary():
    """Copies the bundled list to FREQUENCY_DICTIONARY when none is installed; an installed (uploaded)
    one is kept. copy2 keeps the mtime, so reader_pack_key is the same on every install of one file."""
    if os.path.exists(settings.FREQUENCY_DICTIONARY) or not os.path.exists(settings.BUNDLED_FREQUENCY_DICTIONARY):
        return
    shutil.copy2(settings.BUNDLED_FREQUENCY_DICTIONARY, settings.FREQUENCY_DICTIONARY + '.tmp')
    os.replace(settings.FREQUENCY_DICTIONARY + '.tmp', settings.FREQUENCY_DICTIONARY)


@holds_off_jobs
def install_dictionary(source, length: int, force: bool = False) -> int:
    """Checks an uploaded rank-based Yomitan frequency list and makes it the one in use
    (from the next job on); returns its number of terms."""
    from frequency import load_yomitan_ranks, reading_agreement

    if not 0 < length <= settings.MAX_DICTIONARY_BYTES:
        raise ValueError('The file is empty or too large')
    upload = settings.FREQUENCY_DICTIONARY + '.upload'
    try:
        with open(upload, 'wb') as f:
            # Read exactly length: nginx keeps the connection open, so there is no EOF to wait for.
            remaining = length
            while remaining and (chunk := source.read(min(remaining, 1 << 20))):
                f.write(chunk)
                remaining -= len(chunk)
        if os.path.getsize(upload) != length:
            raise ValueError('Upload incomplete')
        try:
            terms = len(load_yomitan_ranks(upload))
        except (zipfile.BadZipFile, KeyError, ValueError, TypeError, AttributeError) as error:
            raise ValueError("Not Jiten's frequency list (a rank-based Yomitan dictionary zip)") from error
        if terms < settings.MIN_DICTIONARY_TERMS:
            raise ValueError(f'The frequency list has only {terms:,} words; Jiten\'s has about 500,000')
        if not force and os.path.exists(settings.FREQUENCY_DICTIONARY):
            try:
                agreement = reading_agreement(settings.FREQUENCY_DICTIONARY, upload, settings.AGREEMENT_FORMS)
            except (zipfile.BadZipFile, KeyError, ValueError, TypeError, AttributeError):
                agreement = 1.0  # the installed list is unreadable: nothing to compare with
            if agreement < settings.MIN_AGREEMENT:
                raise DictionaryMismatch(agreement)
        os.replace(upload, settings.FREQUENCY_DICTIONARY)
        return terms
    finally:
        if os.path.exists(upload):
            os.remove(upload)


# A file name: no folders, control characters or leading dot
_TERM_NAME = re.compile(r'[^./\\\x00-\x1f\x7f][^/\\\x00-\x1f\x7f]{0,99}')


def term_dictionary_path(name: str) -> str:
    """TERM_DICTIONARY_DIR/<name>.zip for a plain file name (the uploaded file's), else ValueError."""
    name = name[:-4] if name.lower().endswith('.zip') else name
    if not _TERM_NAME.fullmatch(name):
        raise ValueError('Not a plain file name')
    return os.path.join(settings.TERM_DICTIONARY_DIR, name + '.zip')


@holds_off_jobs
def install_term_dictionary(source, length: int, name: str) -> int:
    """Checks an uploaded Yomitan term dictionary and installs it as `name` (replacing one of that name),
    from the next job on; returns its number of usable terms (yurigana.yomitan.term_readings)."""
    try:
        from yurigana.yomitan import name_readings, term_readings
    except ImportError as error:
        raise RuntimeError('This yurigana has no term dictionary support') from error
    path = term_dictionary_path(name)
    if not 0 < length <= settings.MAX_TERM_DICTIONARY_BYTES:
        raise ValueError('The file is empty or too large')
    os.makedirs(settings.TERM_DICTIONARY_DIR, exist_ok=True)
    upload = path + '.upload'
    try:
        with open(upload, 'wb') as f:
            remaining = length  # exactly length: nginx keeps the connection open (install_dictionary)
            while remaining and (chunk := source.read(min(remaining, 1 << 20))):
                f.write(chunk)
                remaining -= len(chunk)
        if os.path.getsize(upload) != length:
            raise ValueError('Upload incomplete')
        try:
            terms = len((name_readings if readerpack.is_name_dictionary(upload) else term_readings)(upload))
        except (zipfile.BadZipFile, KeyError, ValueError, TypeError, AttributeError, IndexError) as error:
            raise ValueError('Not a Yomitan term dictionary (a zip with index.json and term_bank_*.json)') from error
        if terms < settings.MIN_TERM_DICTIONARY_TERMS:
            raise ValueError(f'The dictionary has only {terms:,} usable terms with kanji')
        os.replace(upload, path)
        return terms
    finally:
        if os.path.exists(upload):
            os.remove(upload)


@holds_off_jobs
def remove_term_dictionary(name: str):
    try:
        os.remove(term_dictionary_path(name))
    except FileNotFoundError:
        pass
