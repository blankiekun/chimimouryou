#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Proves the plugin counts characters exactly as the web reader does: runs the reader's TS counter
# (ts-count.run.mts, in the web app's Vitest setup) and charcount.lua inside KOReader (crengine's DOM)
# over the same EPUBs and compares totals per spine item, sample positions both ways and page starts.
#
#   apps/koreader/tools/count-compare.sh <KOReader folder> <book.epub>...
#
# <KOReader folder>: the one holding luajit and reader.lua, e.g. an extracted Linux AppImage's
# squashfs-root/usr/lib/koreader. Needs `pnpm install` in the repo and xvfb-run (KOReader opens an
# SDL window). KOReader's settings go to a temporary HOME, deleted afterwards.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
koreader=$(cd "$1" && pwd)
shift
books=()
for book in "$@"; do books+=("$(realpath "$book")"); done
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

(IFS=,; cd "$here/../../web" && COUNT_BOOKS="${books[*]}" COUNT_OUT="$work/ts-count.json" \
  pnpm exec vitest run --configLoader runner --config ../koreader/tools/vitest.count.config.mts > "$work/vitest.log" 2>&1) ||
  { tail -30 "$work/vitest.log"; exit 1; }

cd "$koreader"
HOME="$work" KO_MULTIUSER=1 xvfb-run -a ./luajit "$here/lua-compare.lua" "$here/../chimimouryou.koplugin" "$work/ts-count.json" \
  "${books[@]}" 2> "$work/koreader.log" | grep -E '^(OK|FAIL|     )'
