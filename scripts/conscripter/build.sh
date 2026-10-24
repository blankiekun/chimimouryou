#!/bin/bash
# Fetches the CONscripter web engine (GPL-2.0, https://github.com/blankiekun/CONscripter, a fork of
# ONScripter-yuri) from its newest GitHub release (CONSCRIPTER_TAG=<tag> picks another) into
# apps/web/static/vn/. Needs curl and 7z, or curl and Docker. The files are committed, so this only
# runs when CONscripter has a new release (with CONSCRIPTER_RECORD=1, which adds its sum to sha256sums).
set -euo pipefail

REPO=https://github.com/blankiekun/CONscripter

here=$(cd "$(dirname "$0")" && pwd)
# CONSCRIPTER_OUT: elsewhere (ebook-update installs into DATA_PATH/state/engine).
out=${CONSCRIPTER_OUT:-$here/../../apps/web/static/vn}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# releases/latest redirects to .../releases/tag/<tag>.
tag=${CONSCRIPTER_TAG:-$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$REPO/releases/latest" | sed 's|.*/tag/||')}
[ -n "$tag" ] || { echo "No CONscripter release found" >&2; exit 1; }
curl -fsSL -o "$work/web.7z" "$REPO/releases/download/$tag/conscripter_${tag}_web.7z"

# Each release's sum is recorded once (CONSCRIPTER_RECORD=1 for a new release, then commit the file),
# so a replaced release asset is refused. CONSCRIPTER_SUMS: another list (ebook-update uses main's).
sums=${CONSCRIPTER_SUMS:-$here/sha256sums}
sum=$(awk -v tag="$tag" '$1 == tag { print $2 }' "$sums")
if [ -z "$sum" ] && [ "${CONSCRIPTER_RECORD:-}" = 1 ]; then
  sum=$(sha256sum "$work/web.7z" | cut -d' ' -f1)
  echo "$tag $sum" >> "$sums"
  echo "Recorded the sha256 of CONscripter $tag in $sums"
fi
[ -n "$sum" ] || { echo "No sha256 for CONscripter $tag in $sums (CONSCRIPTER_RECORD=1 records a new release's)" >&2; exit 1; }
echo "$sum  $work/web.7z" | sha256sum -c --quiet

files=(conscripter_web/conscripter.js conscripter_web/conscripter.wasm)
if command -v 7z >/dev/null; then
  7z e -y -o"$work" "$work/web.7z" "${files[@]}" >/dev/null
else
  docker run --rm -i debian:13-slim bash -c \
    'apt-get -qq update >/dev/null && apt-get -qq install -y 7zip >/dev/null 2>&1 &&
     cat > /w.7z && 7z e -y -o/o /w.7z "$@" >/dev/null && tar -C /o -cf - .' _ "${files[@]}" \
    < "$work/web.7z" | tar -C "$work" -xf -
fi

# The app's overlay, choices, progress and Anki need the text hooks under their cons names (CONscripter v0.23.0 and later).
grep -q consOverlay "$work/conscripter.js" || { echo "CONscripter $tag has no text hooks with the cons names (v0.23.0 and later)" >&2; exit 1; }

mkdir -p "$out"
cp "$work/conscripter.js" "$work/conscripter.wasm" "$out/"
echo "$tag" > "$out/conscripter-version.txt"
echo "Copied CONscripter $tag to $out"
