"""The sync folders' file names, as the reader writes them (ports of base-handler.ts).

Folder names are sanitized book titles; file names carry the metadata (`progress_1_6_<modified>_<progress>.json`).
Pinned to the TypeScript by tests/fixtures/sync-file-names.json, which both sides test against.
"""

import re
from urllib.parse import quote, unquote

NUMBER_RE = re.compile(r'[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?')

STATISTICS_KEYS = (
    'exporterVersion', 'dbVersion', 'lastStatisticModified', 'charactersRead', 'readingTime', 'minReadingSpeed',
    'altMinReadingSpeed', 'lastReadingSpeed', 'maxReadingSpeed', 'averageReadingTime', 'averageWeightedRedingTime',
    'averageCharactersRead', 'averageWeightedCharatersRead', 'averageReadingSpeed', 'averageWeightedReadingSpeed',
)


def number(part: str | None) -> int | float | None:
    """JavaScript's +part: '' is 0, a missing or non-numeric part is NaN (None)."""
    if part is None:
        return None
    part = part.strip()
    if not part:
        return 0
    if not NUMBER_RE.fullmatch(part):
        return None
    value = float(part)
    return int(value) if value.is_integer() else value


def sanitize_for_filename(title: str) -> str:
    title = re.sub(r' \Z', '~ttu-spc~', title)
    title = re.sub(r'\.\Z', '~ttu-dend~', title)
    title = title.replace('*', '~ttu-star~')
    return re.sub(r'[/?<>\\:*|%"]', lambda match: quote(match.group(), safe=''), title)


def desanitize_filename(name: str) -> str:
    return (unquote(name, errors='strict').replace('~ttu-star~', '*').replace('~ttu-dend~', '.')
            .replace('~ttu-spc~', ' '))


def parts(name: str, extension: str) -> list[str]:
    return [part.removesuffix(extension) for part in name.split('_')]


def part(values: list[str], index: int) -> str | None:
    return values[index] if index < len(values) else None


def book_metadata(name: str) -> dict:
    values = parts(name, '.zip')
    keys = ('exporterVersion', 'dbVersion', 'characters', 'lastBookModified', 'lastBookOpen')
    return {key: number(part(values, index + 1)) for index, key in enumerate(keys)}


def progress_metadata(name: str) -> dict:
    values = parts(name, '.json')
    keys = ('exporterVersion', 'dbVersion', 'lastBookmarkModified', 'progress')
    return {key: number(part(values, index + 1)) for index, key in enumerate(keys)}


def statistics_metadata(name: str) -> dict:
    values = parts(name, '.json')
    metadata = {key: number(part(values, index + 1)) for index, key in enumerate(STATISTICS_KEYS)}
    metadata['finishDate'] = part(values, 16) or 'na'
    return metadata


def goals_metadata(name: str) -> dict:
    values = parts(name, '.json')
    keys = ('exporterVersion', 'dbVersion', 'lastGoalModified')
    return {key: number(part(values, index + 1)) for index, key in enumerate(keys)}


def find_file(names: list[str], prefix: str) -> str | None:
    """The file with this prefix to read: for progress and statistics the newest by the time in its name."""
    matching = [name for name in names if name.startswith(prefix)]
    if prefix not in ('progress_', 'statistics_'):
        return matching[0] if matching else None
    newest = None
    for name in matching:
        if newest is None or (number(part(name.split('_'), 3)) or 0) > (number(part(newest.split('_'), 3)) or 0):
            newest = name
    return newest
