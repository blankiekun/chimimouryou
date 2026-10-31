#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# End-to-end run of the plugin in a real KOReader (Linux build) under Xvfb against a chimimouryou
# server, never a live one: a test server whose trusted networks include this machine (no token), or
# E2E_TOKEN set for an https:// one.
#
#   apps/koreader/tools/e2e.sh <KOReader folder> <server> <book id> <book title> <out dir>
#
# Saves a "web reader" place for the book first (PUT progress, as another device would), then
# e2e-driver.lua signs in, browses, searches, downloads and opens the book, takes the offered jump,
# turns pages and syncs. Afterwards the server must hold the place KOReader reported (same character
# count) and today's statistics row for the book. Screenshots and the log go to <out dir>.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
koreader=$(cd "$1" && pwd)
server=$2 book=$3 title=$4
out=$(mkdir -p "$5" && cd "$5" && pwd)
home=$(mktemp -d)
trap 'rm -rf "$home"' EXIT
auth=()
[ -n "${E2E_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $E2E_TOKEN")

day=$(date +%F)
start=$(date +%s%3N)
# The other device's place: 5,000 characters in.
curl -sf "${auth[@]}" -X PUT -H 'Content-Type: application/json' "$server/api/v1/books/$book/progress" \
  -d "{\"modified\": $start, \"progress\": 0, \"data\": {\"exploredCharCount\": 5000, \"progress\": 0, \"lastBookmarkModified\": $start}}" > /dev/null
before=$(curl -sf "${auth[@]}" "$server/api/v1/sync?since=0" |
  jq --argjson b "$book" --arg d "$day" '[.statistics[] | select(.book == $b and .dateKey == $d and (.deleted | not))][0].data.readingTime // 0')

data="$home/.config/koreader"
mkdir -p "$data/plugins" "$data/patches"
ln -s "$here/../chimimouryou.koplugin" "$data/plugins/chimimouryou.koplugin"
cp "$here/e2e-driver.lua" "$data/patches/2-chimimouryou-e2e.lua"
# No first-run quick start guide or colour notice on top of the steps.
echo 'return { color_rendering = false, quickstart_shown_version = 999999999 }' > "$data/settings.reader.lua"

cd "$koreader"
HOME="$home" KO_MULTIUSER=1 E2E_OUT="$out" E2E_SERVER="$server" E2E_TITLE="$title" EMULATE_READER_W=600 EMULATE_READER_H=800 \
  timeout 300 xvfb-run -a -s "-screen 0 600x800x24" ./reader.lua > "$out/koreader.log" 2>&1 || true
grep '^E2E' "$out/koreader.log" | tee "$out/steps.txt"

count=$(sed -n 's/^E2E\tcount-before-sync\t//p' "$out/steps.txt")
sync=$(curl -sf "${auth[@]}" "$server/api/v1/sync?since=0")
saved=$(jq --argjson b "$book" '[.progress[] | select(.book == $b)][0].data.exploredCharCount' <<< "$sync")
after=$(jq --argjson b "$book" --arg d "$day" '[.statistics[] | select(.book == $b and .dateKey == $d)][0].data.readingTime // 0' <<< "$sync")
echo "KOReader's place $count, server's $saved; today's reading time $before s -> $after s"
grep -q $'^E2E\toffer\t.*character 5000' "$out/steps.txt" || { echo "FAIL: no offer to jump to character 5000"; exit 1; }
[ -n "$count" ] && [ "$count" = "$saved" ] || { echo "FAIL: the server doesn't hold KOReader's place"; exit 1; }
[ "$after" -gt "$before" ] || { echo "FAIL: no reading time added"; exit 1; }
echo OK
