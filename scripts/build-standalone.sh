#!/bin/bash
# Builds the published standalone site into apps/web/build: the app (VITE_EDITION=standalone), the
# analysis tools, JMdict, VNBox with its hooks and the theme guide. Used by the Pages workflow
# (deploy/pages/pages.yml) and the VPS workflow (.github/workflows/vps-site.yml).
# Run after `pnpm install`. Environment:
#   VITE_BASE_PATH     the site's address, e.g. https://chimireader.github.io (required)
#   VITE_GDRIVE_CLIENT_ID, VITE_GDRIVE_CLIENT_SECRET  Google Drive sync (optional)
#   VNBOX_CACHE        a folder kept between runs for VNBox's ~125 MB of zips (default: a new temp dir)
# Needs Rust (rustup) besides what scripts/analysis-tools/build.sh and scripts/vnbox/build.sh need.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${VITE_BASE_PATH:?Set VITE_BASE_PATH to the site address}"

VITE_EDITION=standalone VITE_STORAGE_ROOT_NAME=chimi-reader-data pnpm build

# Settings → Analysis tools: Sudachi (wasm), Pyodide and yurigana, built from source (~10 min).
rustup target add wasm32-unknown-unknown
scripts/analysis-tools/build.sh

# Settings → Dictionary's one-tap JMdict (EDRDG, CC BY-SA 4.0, see NOTICE), served same-origin.
mkdir -p apps/web/build/dictionaries
curl -fsSL --retry 3 -o apps/web/build/dictionaries/JMdict_english.zip \
  https://github.com/yomidevs/jmdict-yomitan/releases/latest/download/JMdict_english.zip

# VNBox (Windows games) and its root fs, served same-origin (release assets have no CORS).
# build.sh keeps the zips in VNBOX_CACHE that still pass their sums.
vnbox=${VNBOX_CACHE:-$(mktemp -d)}
VNBOX_OUT="$vnbox" scripts/vnbox/build.sh
mkdir -p apps/web/build/vn
cp -r "$vnbox" apps/web/build/vn/vnbox

# Settings → Themes links to the theme guide (the web image copies it the same way).
cp themes.md apps/web/build/themes.md
