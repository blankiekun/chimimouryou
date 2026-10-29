#!/usr/bin/env python3
"""Fails when a built standalone site holds a file from server/ (the standalone edition ships engine/
only). Compares sha256 of every file in the artifact, and every member of each .zip in it, with the
files under server/ of at least --min-size bytes (tiny shared files like an empty __init__.py would
match by chance).

    python3 scripts/check-standalone-artifact.py apps/web/build [--server server]
"""
import argparse
import hashlib
import os
import sys
import zipfile


def _files(root):
    for d, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x != '__pycache__')
        for f in sorted(files):
            path = os.path.join(d, f)
            if os.path.isfile(path) and not os.path.islink(path):
                yield path, os.path.relpath(path, root).replace(os.sep, '/')


def _sha256(data):
    return hashlib.sha256(data).hexdigest()


def find_server_files(artifact: str, server: str = 'server', min_size: int = 64) -> list[tuple[str, str]]:
    known = {}
    for path, rel in _files(server):
        if os.path.getsize(path) >= min_size:
            with open(path, 'rb') as f:
                known.setdefault(_sha256(f.read()), rel)
    hits = []
    for path, rel in _files(artifact):
        with open(path, 'rb') as f:
            data = f.read()
        if _sha256(data) in known:
            hits.append((rel, known[_sha256(data)]))
        if zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as z:
                for member in z.infolist():
                    if not member.is_dir():
                        digest = _sha256(z.read(member))
                        if digest in known:
                            hits.append((f'{rel}!{member.filename}', known[digest]))
    return hits


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('artifact')
    parser.add_argument('--server', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server'))
    args = parser.parse_args()
    hits = find_server_files(args.artifact, args.server)
    for rel, source in hits:
        print(f'{rel} matches server/{source}')
    sys.exit(1 if hits else 0)


if __name__ == '__main__':
    main()
