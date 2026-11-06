#!/usr/bin/env bash
# Copy the Super Dungeon Crawl overlay into the crawl checkout and patch the client entry points.
# Safe to re-run: patched files are restored from git first.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
CRAWL="${SDC_BUILD:-$HOME/sdc-build}/crawl"
SRC="$CRAWL/crawl-ref/source"

git -C "$CRAWL" checkout -- \
  crawl-ref/source/webserver/game_data/static/game.js \
  crawl-ref/source/webserver/game_data/templates/game.html \
  crawl-ref/source/webserver/templates/client.html

cp -r "$HERE/overlay/." "$SRC/"
python3 "$HERE/scripts/patch_client.py" "$SRC/webserver/game_data"
echo "Super Dungeon Crawl overlay applied to $SRC"
