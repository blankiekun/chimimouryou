# @license BSD-3-Clause
# Copyright (c) 2026, ッツ Reader Authors
# All rights reserved.

"""Builds chimimouryou-discord.ankiaddon (the add-on folder zipped, plus a manifest) next to this file."""

import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, "chimimouryou_discord")
MANIFEST = {"package": "chimimouryou_discord", "name": "chimimouryou Discord companion"}


def build(out=os.path.join(HERE, "chimimouryou-discord.ankiaddon")):
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(SOURCE):
            dirs[:] = sorted(d for d in dirs if d != "__pycache__")
            for name in sorted(files):
                if not name.endswith((".pyc", ".pyo")) and name != "meta.json":
                    path = os.path.join(root, name)
                    zf.write(path, os.path.relpath(path, SOURCE))
        zf.writestr("manifest.json", json.dumps(MANIFEST))
    return out


if __name__ == "__main__":
    print(build(*sys.argv[1:]))
