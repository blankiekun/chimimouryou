#!/bin/bash
# The desktop app's built-in text hook for games played natively (games.js), into
# apps/desktop/lunahook/, never committed:
# - LunaHook (LunaHost64.dll, LunaHook32/64.dll, GPL-3.0) and Locale Remulator (LRProc.exe,
#   LRHookx32/64.dll, LRSubMenus.dll, LRConfig.xml, LGPL-3.0), unmodified, from LunaTranslator's
#   release zip (https://github.com/HIllya51/LunaTranslator), with the MSVC runtime LunaHost needs on
#   Windows and the licences. Pinned: LUNA_TAG and its sha256 change together.
# - chimihook.exe and inject32.exe (native/, GPL-3.0-or-later) built with mingw-w64
#   (gcc-mingw-w64-x86-64 and gcc-mingw-w64-i686).
# Skipped on macOS, which has no native games.
set -euo pipefail

[ "$(uname)" = Darwin ] && { echo "No native games on macOS: lunahook/ skipped"; exit 0; }

tag=${LUNA_TAG:-v12.1.3.3}
sum=${LUNA_SHA256:-687a76b688fb9597b42a1895b3954fc1fc0fd20a4821f42153c610d4d91e2a8d}

here=$(cd "$(dirname "$0")/.." && pwd)
out=$here/lunahook
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

curl -fsSL -o "$work/luna.zip" "https://github.com/HIllya51/LunaTranslator/releases/download/$tag/LunaTranslator_x64.zip"
echo "$sum  $work/luna.zip" | sha256sum -c --quiet
root=LunaTranslator_x64
unzip -q "$work/luna.zip" -d "$work" \
  "$root/files/LunaHook/LunaHost64.dll" "$root/files/LunaHook/LunaHook32.dll" "$root/files/LunaHook/LunaHook64.dll" \
  "$root/files/Locale/Locale_Remulator/*" \
  "$root/files/runtime3.13-64/msvcp140.dll" "$root/files/runtime3.13-64/vcruntime140.dll" \
  "$root/files/runtime3.13-64/vcruntime140_1.dll" \
  "$root/LICENSES/LICENSE.LunaTranslator" "$root/LICENSES/LICENSE.Artikash.Textractor" \
  "$root/LICENSES/LICENSE.TsudaKageyu.minhook" "$root/LICENSES/LICENSE.InWILL.Locale_Remulator"

rm -rf "$out"
mkdir -p "$out/licenses"
# One flat folder: LunaHost64.dll and LRProc.exe find the MSVC runtime beside the exe that loads them.
cp "$work/$root"/files/LunaHook/*.dll "$work/$root"/files/Locale/Locale_Remulator/* \
  "$work/$root"/files/runtime3.13-64/*.dll "$out/"
cp "$work/$root"/LICENSES/* "$out/licenses/"

flags=(-municode -O2 -s -static)
x86_64-w64-mingw32-gcc "${flags[@]}" -o "$out/chimihook.exe" "$here/native/chimihook.c" -lole32
i686-w64-mingw32-gcc "${flags[@]}" -o "$out/inject32.exe" "$here/native/inject32.c"
echo "$tag" > "$out/lunahook-version.txt"
echo "LunaHook $tag and chimihook in $out"
