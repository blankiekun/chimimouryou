#!/bin/bash
# Fetches JMdict for Yomitan (EDRDG, CC BY-SA 4.0, see NOTICE) to the file named by $1, for
# Settings → Dictionary's one-tap install: the web image and scripts/build-standalone.sh run this.
# To take a newer dictionary, set both lines to a release of the repository below (it makes one a day;
# `gh release view <tag> -R yomidevs/jmdict-yomitan --json assets` shows each file's digest).
set -euo pipefail

tag=2026-11-03
sum=233979bfe02dd7ae277b76a71727fc885a5cc4ba52dec3b5f635b7a9e8fea788

curl -fsSL --retry 3 -o "$1" "https://github.com/yomidevs/jmdict-yomitan/releases/download/$tag/JMdict_english.zip"
echo "$sum  $1" | sha256sum -c --quiet || { rm -f "$1"; exit 1; }
