"""Volume plan of a work: novels get a fixed number of chapters per volume (50), the last one possibly short."""

VOLUME_SIZE = 50


def plan(chapters: int, size: int = VOLUME_SIZE) -> list[dict]:
    """[{number, first, last}] covering chapters 1..chapters, `size` per volume."""
    return [{'number': n + 1, 'first': first, 'last': min(first + size - 1, chapters)}
            for n, first in enumerate(range(1, chapters + 1, size))]
