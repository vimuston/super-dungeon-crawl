#!/usr/bin/env bash
# Stage the Super Dungeon Crawl client and crawl's game data for the
# standalone builds (Android app, Windows exe), exactly as apply.sh puts the
# client on a webtiles server.
#
#   stage_client.sh CRAWL_CHECKOUT DEST
#
#   DEST/crawl/   dat/ (without the local-tiles images), docs/, settings/,
#                 rcs/ (saves/ and rcs/ files already there are kept)
#   DEST/web/     index.html, game.html, static/, gamedata/
#
# Needs python3 with tornado (render_client.py renders the stock template).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:?usage: stage_client.sh CRAWL_CHECKOUT DEST}"
DEST="${2:?usage: stage_client.sh CRAWL_CHECKOUT DEST}"
s="$SRC/crawl-ref/source"

# the client: stock files restored, overlay copied, entry points hooked
git -C "$SRC" checkout -- \
  crawl-ref/source/webserver/game_data/static/game.js \
  crawl-ref/source/webserver/game_data/templates/game.html \
  crawl-ref/source/webserver/templates/client.html
cp -r "$HERE/overlay/webserver/game_data/." "$s/webserver/game_data/"
cp -r "$HERE/overlay/webserver/static/." "$s/webserver/static/"
python3 "$HERE/scripts/patch_client.py" "$s/webserver/game_data"

# saves/ and rcs/ belong to the player: leave them alone on a re-stage
rm -rf "$DEST/web" "$DEST/crawl/dat" "$DEST/crawl/docs" "$DEST/crawl/settings"
mkdir -p "$DEST/crawl/rcs" "$DEST/web/gamedata"
cp -r "$s/dat" "$s/../docs" "$s/../settings" "$DEST/crawl/"
rm -rf "$DEST/crawl/docs/develop"
rm -rf "$DEST/crawl/dat/tiles"      # local-tiles only
cp -r "$s/webserver/static" "$DEST/web/static"
cp -r "$s/webserver/game_data/static/." "$DEST/web/gamedata/"
sed 's/{{ *version *}}/local/g' "$s/webserver/game_data/templates/game.html" \
  > "$DEST/web/game.html"
python3 "$HERE/android/native/render_client.py" "$s/webserver/templates" \
  > "$DEST/web/index.html"
