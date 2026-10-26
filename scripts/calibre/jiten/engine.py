#!/usr/bin/env python3
"""The difficulty engine's fingerprint: a sha256 over everything that changes an estimate (the
1-10 scale and the deconjugation rules, ENGINE_VERSION for the scoring Python, the frequency list's content, yurigana's version, the Sudachi
dictionary, and a reading-model table if the server adds one; not term dictionaries, which change
word lists' readings only, not the score). The service stores
it on each estimate as `engine`, and the analysis tools' manifest names it for the browser's
(scripts/analysis-tools/build.sh). Runtimes (CPython or Pyodide, sudachipy or sudachi.rs wasm,
core.py or core.ts) are left out: they give the same numbers (checked on 20 Aozora Bunko
books when this was added).

`python3 engine.py` prints this release's canonical fingerprint (the bundled list, the pinned
yurigana and dictionary, nothing added) as apps/web/src/lib/data/difficulty-engine.json, which the
app compares estimates with (isCanonicalEstimate); test_engine.py checks the committed file.
`python3 engine.py --record` writes engine-code.json (ENGINE_VERSION and the scoring Python's
hash), which test_engine.py checks too, so no code change goes by without deciding on a bump.
Not upstream."""
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
# Bump when a change to CODE_FILES changes any estimate's numbers or word list, then
# `python3 engine.py --record` and regenerate difficulty-engine.json. A refactor that keeps every
# output the same only re-records (`--record`), so library estimates stay current.
# 4: the estimate is the fast core (core.py: V98, its histogram and the facets); the GBDT model is gone.
# 5: core version 3 (ranks by the best spelling; source line breaks folded in book_text), scale version 2.
# 6: core version 4 (rare katakana words met 3 times are names), scale version 3.
ENGINE_VERSION = 6
# The scoring path's Python, on the server and in Pyodide alike (readings_file.extract gives the
# browser its text; core.ts is checked against core.py by the shared fixture): in the fingerprint
# through ENGINE_VERSION, guarded by engine-code.json.
CODE_FILES = ('core.py', 'features.py', 'compound_merge.py', 'frequency.py', 'word_list.py', 'deconjugator.py',
              'readings_file.py')
# What the estimate reads, by content: the 1-10 scale and the deconjugation rules (vendored from
# Jiten: data, and any edit to it is a rule change; they shape the word totals of local estimates).
DATA_FILES = ('core-scale.json', 'deconjugator.json')
CODE_RECORD = os.path.join(HERE, 'engine-code.json')
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
    """`sudachi_dict`: the dictionary's name and version (core-20261015); `extras`: paths of other
    files the estimate depends on (the reading-model table), by content."""
    digest = hashlib.sha256()
    digest.update(f'version:{ENGINE_VERSION}\n'.encode())
    for name in DATA_FILES:
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


def code_hash(code_dir: str = HERE) -> str:
    """A sha256 over CODE_FILES, which engine-code.json records with ENGINE_VERSION."""
    digest = hashlib.sha256()
    for name in CODE_FILES:
        digest.update(f'{name}:{file_sha256(os.path.join(code_dir, name))}\n'.encode())
    return digest.hexdigest()


if __name__ == '__main__':
    if sys.argv[1:] == ['--record']:
        with open(CODE_RECORD, 'w', encoding='utf-8') as f:
            json.dump({'version': ENGINE_VERSION, 'code': code_hash()}, f, indent=2)
            f.write('\n')
        sys.exit()
    json.dump({'engine': canonical_fingerprint()}, sys.stdout, indent=2)
    print()
