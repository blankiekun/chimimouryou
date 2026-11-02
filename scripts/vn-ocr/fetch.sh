#!/bin/bash
# Fetches vita-vn-ocr's line spotter and Large recognizer (ONNX, https://github.com/bee-san/vita-vn-ocr,
# GPL-3.0-or-later, non-commercial use only: see ONNX-ATTRIBUTION.md) with their attribution files and
# model cards into apps/web/static/vn/ocr/ (gitignored; VN_OCR_OUT picks another folder), for the VN
# overlay's OCR (lib/functions/vn-ocr/). Release assets send no CORS headers, so the site serves them
# itself: the web image and scripts/build-standalone.sh run this. Every file is checked against
# sha256sums (its release's SHA256SUMS). Needs curl and sha256sum.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
out=${VN_OCR_OUT:-$here/../../apps/web/static/vn/ocr}
mkdir -p "$out"
while read -r tag file sum; do
  # Files from the last run that still pass their sums are kept.
  if ! echo "$sum  $out/$file" | sha256sum -c --quiet >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$out/$file" \
      "https://github.com/bee-san/vita-vn-ocr/releases/download/$tag/$file"
    echo "$sum  $out/$file" | sha256sum -c --quiet
  fi
done < <(grep -v '^#' "$here/sha256sums")
echo "Copied vita-vn-ocr's models to $out"
