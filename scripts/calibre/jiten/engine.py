#!/usr/bin/env python3
"""The difficulty engine's fingerprint: a sha256 over everything that changes an estimate (the
models, the scoring Python, the frequency list's content, yurigana's version, the Sudachi
dictionary, and any term dictionaries or reading-model table the server adds). The service stores
it on each estimate as `engine`, and the analysis tools' manifest names it for the browser's
(scripts/analysis-tools/build.sh). Runtimes (CPython or Pyodide, sudachipy or sudachi.rs wasm,
onnxruntime or onnxruntime-web) are left out: they give the same numbers (checked on 20 Aozora Bunko
books when this was added).

`python3 engine.py` prints this release's canonical fingerprint (the bundled list, the pinned
yurigana and dictionary, nothing added) as apps/web/src/lib/data/difficulty-engine.json, which the
app compares estimates with (isCanonicalEstimate); test_engine.py checks the committed file.
Not upstream."""
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
# The scoring path's files, on the server and in Pyodide alike (readings_file.extract gives the
# browser its text).
ENGINE_FILES = ('features.py', 'frequency.py', 'word_list.py', 'deconjugator.py', 'deconjugator.json',
                'readings_file.py', 'goshu.json.gz', 'kanji-grades.json', 'chimi-difficulty.onnx',
                'chimi-difficulty-low.onnx', 'chimi-difficulty-high.onnx', 'chimi-difficulty-range.json')
BUNDLED_FREQUENCY_LIST = os.path.join(HERE, 'data', 'jiten_freq_global.zip')
REQUIREMENTS = os.path.join(HERE, 'requirements.txt')

_hashes = {}


def file_sha256(path: str) -> str:
    """The file's sha256, remembered by size and time (term dictionaries are up to 256 MB)."""
    stat = os.stat(path)
    key = (path, stat.st_size, stat.st_mtime_ns)
    if key not in _hashes:
        digest = hashlib.sha256()
        with open(path, 'rb') as f:
            while chunk := f.read(1 << 20):
                digest.update(chunk)
        _hashes[key] = digest.hexdigest()
    return _hashes[key]


def engine_fingerprint(frequency_list: str, yurigana: str, sudachi_dict: str, extras=(), code_dir: str = HERE) -> str:
    """`sudachi_dict`: the dictionary's name and version (core-20260723.1); `extras`: paths of other
    files the readings come from (term dictionaries, the reading-model table), by content."""
    digest = hashlib.sha256()
    for name in ENGINE_FILES:
        digest.update(f'{name}:{file_sha256(os.path.join(code_dir, name))}\n'.encode())
    digest.update(f'frequency:{file_sha256(frequency_list)}\nyurigana:{yurigana}\nsudachi:{sudachi_dict}\n'.encode())
    for path in sorted(extras):
        digest.update(f'extra:{os.path.basename(path)}:{file_sha256(path)}\n'.encode())
    return digest.hexdigest()


def pinned_versions() -> tuple:
    """yurigana's and SudachiDict-core's versions in requirements.txt: (yurigana, 'core-<version>')."""
    with open(REQUIREMENTS, encoding='utf-8') as f:
        text = f.read()
    return (re.search(r'yurigana/archive/refs/tags/v([^/]+)\.tar\.gz', text)[1],
            'core-' + re.search(r'SudachiDict-core==(\S+)', text)[1])


def canonical_fingerprint() -> str:
    return engine_fingerprint(BUNDLED_FREQUENCY_LIST, *pinned_versions())


if __name__ == '__main__':
    json.dump({'engine': canonical_fingerprint()}, sys.stdout, indent=1)
    print()
