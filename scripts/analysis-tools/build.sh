#!/bin/bash
# Builds the standalone edition's analysis tools (Settings → Analysis tools: word lists and generated
# furigana in the browser, apps/web/src/lib/data/analysis-tools.ts) into apps/web/build/analysis-tools/
# (ANALYSIS_TOOLS_OUT picks another folder). Run after `pnpm build`; nothing here is committed:
#   sudachi.js, sudachi_bg.wasm  sudachi.rs for wasm (Benjas333/sudachi-wasm333 at SUDACHI_COMMIT, Apache-2.0)
#                                with sudachi-wasm.patch: wasm32 build fixes and dict_alloc/initialize_from_ptr,
#                                so the dictionary streams into wasm memory without a copy
#   core.dic.gz                  SudachiDict-core, the server's dictionary (scripts/calibre/jiten/requirements.txt)
#   pyodide/                     Pyodide (MPL-2.0), the core files only (a lock file without packages)
#   analysis.zip                 yurigana (pinned like the server) and the difficulty service's Python
#   reader.ygp.gz, frequency.ygp.gz  yurigana's Reader and the frequency table, packed as the server packs them
#   chimi-difficulty*.onnx, chimi-difficulty-range.json  the difficulty models
#   ort/                         onnxruntime-web's plain wasm runtime (the app's own copy, which Whisper's
#                                build lacks the models' ML operators), from apps/web/node_modules
#   manifest.json                the files, their sizes, the tools' version, the difficulty engine's
#                                fingerprint (`engine`) and which files only one feature needs
#                                (`features`; the rest serve both difficulty and furigana)
# Needs curl, python3 (3.12+), gzip, and Rust (rustup) with the wasm32-unknown-unknown target; installs
# wasm-bindgen-cli at the version Cargo.lock pins when it is missing.
set -euo pipefail

SUDACHI_COMMIT=60f529a8ea96428835c8facc350559f562c0e3b2
SUDACHI_DICT=20260723.1
PYODIDE=314.0.7
WASM_BINDGEN=0.2.128

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
out=${ANALYSIS_TOOLS_OUT:-$root/apps/web/build/analysis-tools}
jiten=$root/scripts/calibre/jiten
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
yurigana=$(grep -o 'https://github.com/blankiekun/yurigana/archive/refs/tags/[^ ]*\.tar\.gz' "$jiten/requirements.txt")
yurigana_sha256=$(grep -o 'yurigana/archive/refs/tags/[^ ]*\.tar\.gz#sha256=[0-9a-f]\{64\}' "$jiten/requirements.txt" | sed 's/.*=//' || true)
[ -n "$yurigana_sha256" ] || { echo "No #sha256= for yurigana in scripts/calibre/jiten/requirements.txt" >&2; exit 1; }
grep -q "SudachiDict-core==$SUDACHI_DICT" "$jiten/requirements.txt" ||
  { echo "SUDACHI_DICT differs from scripts/calibre/jiten/requirements.txt" >&2; exit 1; }
mkdir -p "$out/pyodide"

# Sudachi
curl -fsSL "https://github.com/Benjas333/sudachi-wasm333/archive/$SUDACHI_COMMIT.tar.gz" | tar -xz -C "$work"
src=$work/sudachi-wasm333-$SUDACHI_COMMIT
patch -s -d "$src" -p1 < "$here/sudachi-wasm.patch"
[ "$(wasm-bindgen --version 2>/dev/null)" = "wasm-bindgen $WASM_BINDGEN" ] ||
  cargo install -q wasm-bindgen-cli --version "$WASM_BINDGEN" --locked
(cd "$src" && cargo build -q --release --locked --target wasm32-unknown-unknown -p sudachi)
wasm-bindgen --target web --no-typescript --out-dir "$work/pkg" "$src/target/wasm32-unknown-unknown/release/sudachi.wasm"
cp "$work/pkg/sudachi.js" "$work/pkg/sudachi_bg.wasm" "$out/"

# The dictionary from its wheel: gzip, which browsers decompress natively (DecompressionStream)
wheel=$(curl -fsSL "https://pypi.org/pypi/SudachiDict-core/$SUDACHI_DICT/json" |
  python3 -c 'import json, sys; print(next(u["url"] for u in json.load(sys.stdin)["urls"] if u["filename"].endswith(".whl")))')
curl -fsSL -o "$work/dict.whl" "$wheel"
python3 -c 'import sys, zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read("sudachidict_core/resources/system.dic"))' \
  "$work/dict.whl" > "$work/core.dic"
gzip -9 -c "$work/core.dic" > "$out/core.dic.gz"

# Pyodide's core: the runtime and the standard library, no packages
curl -fsSL "https://registry.npmjs.org/pyodide/-/pyodide-$PYODIDE.tgz" | tar -xz -C "$work"
cp "$work/package/"{pyodide.mjs,pyodide.asm.mjs,pyodide.asm.wasm,python_stdlib.zip} "$out/pyodide/"
python3 -c 'import json, sys; lock = json.load(open(sys.argv[1])); json.dump({"info": lock["info"], "packages": {}}, open(sys.argv[2], "w"))' \
  "$work/package/pyodide-lock.json" "$out/pyodide/pyodide-lock.json"

# yurigana and the service's modules; the packs are built by the same yurigana
curl -fsSL -o "$work/yurigana.tar.gz" "$yurigana"
echo "$yurigana_sha256  $work/yurigana.tar.gz" | sha256sum -c --quiet
tar -xzf "$work/yurigana.tar.gz" -C "$work"
yg=$(echo "$work"/yurigana-*/yurigana)
mkdir -p "$work/py"
cp -r "$yg" "$work/py/"
# All of the package: Reader.load checks the packs against a hash of its files (_source_hash)
rm -rf "$work/py/yurigana/__pycache__"
cp "$jiten/"{features.py,deconjugator.py,deconjugator.json,frequency.py,readings_file.py,word_list.py,goshu.json.gz,kanji-grades.json,browser.py} "$work/py/"
python3 -c 'import shutil, sys; shutil.make_archive(sys.argv[1], "zip", sys.argv[2])' "$out/analysis" "$work/py"
PYTHONPATH="$(dirname "$yg"):$jiten" python3 - "$jiten/data/jiten_freq_global.zip" "$work" <<'EOF'
import sys
from yurigana import Reader
from frequency import FrequencyTable
freq, work = sys.argv[1:]
FrequencyTable.load(freq).save(f'{work}/frequency.ygp')
# The tokenizer is the browser's; building needs none (the server's _save_reader_pack, without term dictionaries)
Reader(known=freq, tokenizer=False).save(f'{work}/reader.ygp')
EOF
for pack in reader frequency; do gzip -9 -c "$work/$pack.ygp" > "$out/$pack.ygp.gz"; done
cp "$jiten/"chimi-difficulty{,-low,-high}.onnx "$jiten/chimi-difficulty-range.json" "$out/"
mkdir -p "$out/ort"
cp "$root/apps/web/node_modules/onnxruntime-web/dist/"ort-wasm-simd-threaded.{mjs,wasm} "$out/ort/"

# Raw sizes let the worker preallocate the dictionary and the packs.
# The version names the Python and the models too (a hash of their files), so a change there redoes the
# books' analyses. Files only difficulty estimates need: the frequency pack and the models; only generated
# furigana: the reader pack (word lists take Sudachi's readings without it).
# `engine`: the difficulty engine's fingerprint (scripts/calibre/jiten/engine.py), which the browser's
# estimates carry; it must be the release's (apps/web/src/lib/data/difficulty-engine.json).
python3 - "$out" "$work" "$SUDACHI_DICT" "$PYODIDE" "$(basename "$yurigana" .tar.gz)" "$jiten" \
  "$root/apps/web/src/lib/data/difficulty-engine.json" <<'EOF'
import hashlib, json, os, sys
out, work, dic, pyodide, yurigana, jiten, committed = sys.argv[1:]
sys.path.insert(0, jiten)
from engine import BUNDLED_FREQUENCY_LIST, engine_fingerprint
engine = engine_fingerprint(BUNDLED_FREQUENCY_LIST, yurigana.lstrip('v'), f'core-{dic}')
if engine != json.load(open(committed))['engine']:
    sys.exit(f'The engine differs from {committed}: python3 {jiten}/engine.py > {committed}')
code = hashlib.sha256()
for d, _, fs in sorted(os.walk(f'{work}/py')):
    for f in sorted(fs):
        code.update(f.encode() + open(os.path.join(d, f), 'rb').read())
difficulty = {'frequency.ygp.gz', 'chimi-difficulty.onnx', 'chimi-difficulty-low.onnx', 'chimi-difficulty-high.onnx',
              'chimi-difficulty-range.json', 'ort/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.wasm'}
for f in sorted(difficulty - {'frequency.ygp.gz', 'ort/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.wasm'}):
    code.update(f.encode() + open(f'{out}/{f}', 'rb').read())
raw = {'core.dic.gz': os.path.getsize(f'{work}/core.dic'), 'reader.ygp.gz': os.path.getsize(f'{work}/reader.ygp'),
       'frequency.ygp.gz': os.path.getsize(f'{work}/frequency.ygp')}
files = sorted(os.path.relpath(os.path.join(d, f), out) for d, _, fs in os.walk(out) for f in fs if f != 'manifest.json')
json.dump({'version': f'sudachidict-{dic} pyodide-{pyodide} yurigana-{yurigana.lstrip("v")} py-{code.hexdigest()[:12]} engine-{engine[:12]}',
           'engine': engine,
           'files': [{'name': f, 'bytes': os.path.getsize(f'{out}/{f}'), **({'raw': raw[f]} if f in raw else {}),
                      **({'features': ['difficulty']} if f in difficulty else {}),
                      **({'features': ['furigana']} if f == 'reader.ygp.gz' else {})}
                     for f in files]}, open(f'{out}/manifest.json', 'w'), indent=1)
EOF
du -sh "$out"
