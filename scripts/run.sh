#!/usr/bin/env bash
# Apply the overlay and start the webtiles server on http://localhost:8080
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SDC_BUILD:-$HOME/sdc-build}/crawl/crawl-ref/source"

if [ ! -x "$SRC/crawl" ]; then
  echo "crawl binary missing - run setup first (setup.cmd / scripts/setup.sh)" >&2
  exit 1
fi

bash "$HERE/scripts/apply.sh"
cd "$SRC"
mkdir -p rcs/running rcs/ttyrecs
python3 "$HERE/scripts/ensure_user.py"
echo "Super Dungeon Crawl: open http://localhost:8080  (Ctrl+C to stop)"
exec python3 webserver/server.py
