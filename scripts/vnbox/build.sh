#!/bin/bash
# Fetches the VNBox web build (GPL-2.0, https://github.com/blankiekun/VNBox, a fork of Boxedwine),
# the root fs it was tested with (TinyCore15Wine11.0-web.zip, GPL/LGPL, mirrored by the release) and
# the Japanese overlay jp.zip (IPA fonts) from a VNBox release into apps/web/static/vn/vnbox/
# (gitignored; VNBOX_OUT picks another folder). Browsers can't fetch release assets cross-origin,
# so the files are served by the site itself: the web image and the Pages workflow run this.
# The tag is the last one in sha256sums (VNBOX_TAG=<tag> picks another; VNBOX_RECORD=1 records a
# new release's sums, then commit the file). Also fetches 0xDC00's text hook scripts (MIT,
# https://github.com/0xDC00/scripts) at the commit pinned in dc00-sha256sums into <out>/hooks/,
# with index.json for the Windows game dialog (hook-index.mjs). Needs curl, tar, sha256sum, node.
set -euo pipefail

REPO=https://github.com/blankiekun/VNBox

here=$(cd "$(dirname "$0")" && pwd)
out=${VNBOX_OUT:-$here/../../apps/web/static/vn/vnbox}
sums=$here/sha256sums
tag=${VNBOX_TAG:-$(awk '!/^#/ && NF { t = $1 } END { print t }' "$sums")}
[ -n "$tag" ] || { echo "No VNBox tag in $sums" >&2; exit 1; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

assets=("vnbox-web-$tag.tar.gz" TinyCore15Wine11.0-web.zip jp.zip)
for f in "${assets[@]}"; do
  sum=$(awk -v tag="$tag" -v f="$f" '$1 == tag && $2 == f { print $3 }' "$sums")
  # Zips from the last run that still pass their sums are kept (the tarball is unpacked, so fetched).
  if [ -n "$sum" ] && [ -f "$out/$f" ] && echo "$sum  $out/$f" | sha256sum -c --quiet 2>/dev/null; then
    cp "$out/$f" "$work/$f"
    echo "Kept $f"
    continue
  fi
  curl -fsSL --retry 3 -o "$work/$f" "$REPO/releases/download/$tag/$f"
  if [ -z "$sum" ] && [ "${VNBOX_RECORD:-}" = 1 ]; then
    sum=$(sha256sum "$work/$f" | cut -d' ' -f1)
    echo "$tag $f $sum" >> "$sums"
    echo "Recorded the sha256 of VNBox $tag $f in $sums"
  fi
  # A replaced release asset is refused.
  [ -n "$sum" ] || { echo "No sha256 for VNBox $tag $f in $sums (VNBOX_RECORD=1 records a new release's)" >&2; exit 1; }
  echo "$sum  $work/$f" | sha256sum -c --quiet
done

rm -rf "$out"
mkdir -p "$out"
tar -C "$out" --strip-components=1 -xzf "$work/vnbox-web-$tag.tar.gz"
mv "$work/TinyCore15Wine11.0-web.zip" "$work/jp.zip" "$out/"
echo "$tag" > "$out/vnbox-version.txt"
echo "Copied VNBox $tag to $out"

# The PC scripts and the libraries they require(), served under /vn/ like VNBox (frida=).
read -r dc00 dc00sum < <(awk '!/^#/ && NF { c = $1; s = $2 } END { print c, s }' "$here/dc00-sha256sums")
curl -fsSL --retry 3 -o "$work/dc00.tar.gz" "https://codeload.github.com/0xDC00/scripts/tar.gz/$dc00"
echo "$dc00sum  $work/dc00.tar.gz" | sha256sum -c --quiet
mkdir -p "$work/dc00" "$out/hooks"
tar -C "$work/dc00" --strip-components=1 -xzf "$work/dc00.tar.gz"
cp "$work/dc00"/PC_*.js "$work/dc00"/lib*.js "$work/dc00/LICENSE" "$out/hooks/"
node "$here/hook-index.mjs" "$out/hooks"
echo "Copied 0xDC00's hook scripts ${dc00:0:12} to $out/hooks"
