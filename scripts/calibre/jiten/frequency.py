"""Word frequencies for the difficulty features, from a rank-based Yomitan frequency
dictionary (Jiten's own list, jiten.moe/frequency-dictionaries), standing in for Jiten's
JmDictWordFrequencies / WordFormFrequencies. Not upstream.
"""
import json
import zipfile

# Jiten's list is one 55 MB bank; anything far bigger is likely a deflate bomb.
MAX_MEMBER_BYTES = 128 * 1024 * 1024
# Share of all word occurrences at rank 1 (の is about 6.5%); shares fall off as 1/rank (Zipf).
TOP_SHARE = 0.065


def _read(archive: zipfile.ZipFile, name: str) -> bytes:
    if archive.getinfo(name).file_size > MAX_MEMBER_BYTES:
        raise ValueError(f'{name} is too large')
    return archive.read(name)


def _yomitan_entries(path: str):
    """(term, reading or None, rank) from a rank-based Yomitan frequency dictionary."""
    with zipfile.ZipFile(path) as archive:
        index = json.loads(_read(archive, 'index.json'))
        if index.get('frequencyMode') != 'rank-based':
            raise ValueError(f"{path}: not a rank-based frequency dictionary")
        for name in archive.namelist():
            if not name.startswith('term_meta_bank'):
                continue
            for term, kind, data in json.loads(_read(archive, name)):
                # data: a number, {value, displayValue}, or {reading, frequency: number | {value}}
                frequency = data.get('frequency', data) if isinstance(data, dict) else data
                value = frequency.get('value') if isinstance(frequency, dict) else frequency
                if kind == 'freq' and isinstance(value, (int, float)) and value > 0:
                    yield term, data.get('reading') if isinstance(data, dict) else None, value


def load_yomitan_ranks(path: str) -> dict:
    """term -> best (lowest) rank from a rank-based Yomitan frequency dictionary."""
    ranks = {}
    for term, _, value in _yomitan_entries(path):
        ranks[term] = min(value, ranks.get(term, value))
    return ranks


def _readings(path: str, forms) -> dict:
    """form -> set of its readings, for those of forms the dictionary lists."""
    wanted, readings = set(forms), {}
    for term, reading, _ in _yomitan_entries(path):
        if term in wanted:
            readings.setdefault(term, set()).update([reading] if reading else [])
    return readings


def reading_agreement(old_path: str, new_path: str, top: int = 5000) -> float:
    """Share of the old list's top forms that the new one lists with an overlapping reading
    (or, for forms without readings, none either): how much a replacement list agrees with it."""
    ranks = load_yomitan_ranks(old_path)
    forms = sorted(ranks, key=ranks.get)[:top]
    if not forms:
        return 1.0
    old, new = _readings(old_path, forms), _readings(new_path, forms)
    return sum(1 for f in forms if f in new and (old[f] & new[f] or old[f] == new[f])) / len(forms)


def _rank(value: str):
    return int(value) if value.isdigit() else float(value)


class FrequencyTable:
    """word(key) -> (rank, share of occurrences); form(key, spelling) -> (rank, share, percentage).
    Keys are Sudachi's normalised form plus a part of speech ('有る\\tverb'), looked up by
    the normalised form, and by its reading when known (事: こと is common, じ rare); a
    spelling's percentage is how close its rank is to the word's."""

    def __init__(self, ranks: dict, reading_ranks: dict | None = None):
        self.ranks = ranks
        self.reading_ranks = reading_ranks or {}

    @classmethod
    def load(cls, path: str) -> 'FrequencyTable':
        ranks, reading_ranks = {}, {}
        for term, reading, value in _yomitan_entries(path):
            ranks[term] = min(value, ranks.get(term, value))
            if reading:
                reading_ranks[term, reading] = min(value, reading_ranks.get((term, reading), value))
        return cls(ranks, reading_ranks)

    def save(self, path: str):
        """The table in yurigana's mmap format, for load_packed: workers share its pages, nothing is parsed."""
        from yurigana import packed
        packed.write(path, {'ranks': {term: repr(rank) for term, rank in self.ranks.items()},
                            'reading_ranks': {f'{term}\t{reading}': repr(rank)
                                              for (term, reading), rank in self.reading_ranks.items()}})

    @classmethod
    def load_packed(cls, path: str) -> 'FrequencyTable':
        from yurigana.packed import Decoded, Packed, PairMap
        pack = Packed(path)
        return cls(Decoded(pack.table('ranks'), _rank), PairMap(pack.table('reading_ranks'), _rank))

    def word(self, key, reading=None):
        term = key.split('\t')[0]
        rank = self.reading_ranks.get((term, reading)) if reading else None
        rank = rank or self.ranks.get(term)
        return (rank, TOP_SHARE / rank) if rank else None

    def form(self, key, form):
        word = self.word(key)
        rank = self.ranks.get(form)
        if not word or not rank:
            return None
        return rank, TOP_SHARE / rank, 100 * min(1.0, word[0] / rank)
