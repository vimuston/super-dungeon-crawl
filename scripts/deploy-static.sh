#!/usr/bin/env bash
# Copy the given overlay static files into the crawl checkout for live testing.
# Usage: scripts/deploy-static.sh crt.js sdc_api.js depth.js
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HERE/overlay/webserver/game_data/static"
DST="${SDC_BUILD:-$HOME/sdc-build}/crawl/crawl-ref/source/webserver/game_data/static"

for f in "$@"; do
  cp "$SRC/$f" "$DST/$f"
  echo "deployed $f"
done
