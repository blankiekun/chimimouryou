#!/bin/bash
# Fetches Yomitan's Chrome build (GPL-3.0, https://github.com/yomidevs/yomitan), unmodified, into
# apps/desktop/yomitan/ with its licence. Pinned: YOMITAN_TAG and its sha256 change together
# (YOMITAN_TAG=<tag> YOMITAN_SHA256=<sum> picks another release).
set -euo pipefail

REPO=https://github.com/yomidevs/yomitan
tag=${YOMITAN_TAG:-26.10.12.0}
sum=${YOMITAN_SHA256:-270bf736862624a6f66d86ce6efb3e76307df4a6ad034073134897de8a414aa7}

out=$(cd "$(dirname "$0")/.." && pwd)/yomitan
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

curl -fsSL -o "$work/yomitan.zip" "$REPO/releases/download/$tag/yomitan-chrome.zip"
echo "$sum  $work/yomitan.zip" | sha256sum -c --quiet
curl -fsSL -o "$work/LICENSE" "https://raw.githubusercontent.com/yomidevs/yomitan/$tag/LICENSE"

rm -rf "$out"
mkdir -p "$out"
unzip -q "$work/yomitan.zip" -d "$out"
cp "$work/LICENSE" "$out/LICENSE"
echo "$tag" > "$out/yomitan-version.txt"
echo "Copied Yomitan $tag to $out"
