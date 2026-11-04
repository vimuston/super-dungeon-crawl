#!/usr/bin/env bash
# Package a ready-to-run webtiles server: the crawl binary built by setup.sh,
# its game data, the webtiles server with the Super Dungeon Crawl client
# applied, and a start script.
#
#   package-server.sh   -> dist/super-dungeon-crawl-server-linux-<arch>.tar.gz
#
# Run scripts/setup.sh first. For a package that runs on other machines,
# build with SDC_MAKE_FLAGS="BUILD_LUA=y BUILD_SQLITE=y BUILD_ZLIB=y" so only
# glibc, libstdc++ and ncurses are needed at runtime.
#
# Env: SDC_BUILD (default ~/sdc-build), SDC_DIST (default dist/ in the checkout),
#      SDC_VERSION (label in the package's VERSION file)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${SDC_BUILD:-$HOME/sdc-build}"
CRAWL="$ROOT/crawl"
SRC="$CRAWL/crawl-ref/source"
DIST="${SDC_DIST:-$HERE/dist}"
ARCH="$(uname -m)"
NAME="super-dungeon-crawl-server"
WORK="$ROOT/server-pkg"
PKG="$WORK/$NAME"

[ -x "$SRC/crawl" ] || { echo "no crawl binary in $SRC: run scripts/setup.sh first" >&2; exit 1; }

bash "$HERE/scripts/apply.sh"

rm -rf "$WORK"
mkdir -p "$PKG/crawl-ref/source" "$PKG/tools" "$DIST"
cp "$SRC/crawl" "$PKG/crawl-ref/source/"
strip "$PKG/crawl-ref/source/crawl" 2>/dev/null || true
# game data (dat/tiles is only for the local-tiles build; the webtiles copies
# of the tile images are in webserver/), docs and settings
rsync -a --exclude tiles "$SRC/dat" "$PKG/crawl-ref/source/"
rsync -a "$CRAWL/crawl-ref/docs" "$CRAWL/crawl-ref/settings" "$PKG/crawl-ref/"
rm -rf "$PKG/crawl-ref/docs/develop"
rsync -a --exclude __pycache__ --exclude '*.db3' --exclude '*.log' \
  --exclude tox.ini --exclude mypy.ini \
  --exclude config.yml \
  "$SRC/webserver" "$PKG/crawl-ref/source/"
# The package ships defaults, not config.yml: start.sh creates config.yml from
# them once, so unpacking a newer package never overwrites your settings.
cat > "$PKG/crawl-ref/source/webserver/config.default.yml" <<'EOF'
# Defaults for this server package. start.sh copies this file to config.yml
# on the first start; edit config.yml (updates never overwrite it).
#
# Single player on this machine: listens on loopback only and logs everyone
# in as "player" without a password.
#   - To play from other devices on a network you trust (your home LAN), set
#     bind_address: "" (all interfaces). Anyone who can reach the port then
#     plays as "player".
#   - To host for other people, copy config.public.yml over config.yml
#     (accounts, loopback) and put an HTTPS reverse proxy in front.
bind_address: "127.0.0.1"
bind_port: 8080
autologin: "player"
development_mode: false
game_data_no_cache: true
EOF
cp "$HERE/scripts/ensure_user.py" "$PKG/tools/"
cp "$HERE/LICENSE" "$HERE/NOTICE" "$PKG/"

cat > "$PKG/start.sh" <<'EOF'
#!/usr/bin/env bash
# Start the Super Dungeon Crawl webtiles server (see README.txt).
set -euo pipefail
cd "$(dirname "$0")/crawl-ref/source"
mkdir -p rcs/running rcs/ttyrecs saves
[ -f webserver/config.yml ] || cp webserver/config.default.yml webserver/config.yml
python3 ../../tools/ensure_user.py
port="$(python3 -c 'import yaml; print((yaml.safe_load(open("webserver/config.yml")) or {}).get("bind_port", 8080))' 2>/dev/null || echo 8080)"
echo "Super Dungeon Crawl: http://localhost:$port  (Ctrl+C to stop)"
exec python3 webserver/server.py
EOF
chmod +x "$PKG/start.sh"

cat > "$PKG/README.txt" <<EOF
Super Dungeon Crawl webtiles server (linux-$ARCH)
================================================

Dungeon Crawl Stone Soup with the Super Dungeon Crawl client, ready to run.

Requirements: Linux $ARCH with glibc 2.34 or newer (Debian 12+, Ubuntu 22.04+),
Python 3 with Tornado 6 and PyYAML, and ncurses 6. On Debian/Ubuntu:

    sudo apt install python3-tornado python3-yaml libncursesw6

Run:

    ./start.sh

then open http://localhost:8080 on this machine.

Configuration: crawl-ref/source/webserver/config.yml, created from
config.default.yml on the first start.

  By default the server is for one player on this machine: it listens on
  127.0.0.1 only and logs everyone in as "player" without a password.
  - To play from other devices on a network you trust (your home LAN), set
    bind_address: "" in config.yml. Anyone who can reach the port then plays
    as "player", so never do this on a public or shared network.
  - To host for other people, copy config.public.yml over config.yml (real
    accounts, loopback only) and put an HTTPS reverse proxy (Caddy, nginx) in
    front of it.

To update, unpack a newer package over this one. Your config.yml, saves
(crawl-ref/source/saves), options and morgue files (crawl-ref/source/rcs) are
kept.

Saves are compatible with the Windows and Android builds of the same release.
License: GPL-2.0-or-later, see LICENSE and NOTICE.
EOF

{
  echo "super-dungeon-crawl ${SDC_VERSION:-$(git -C "$HERE" describe --always --dirty 2>/dev/null || echo dev)}"
  echo "crawl $(git -C "$CRAWL" rev-parse HEAD)"
} > "$PKG/VERSION"

out="$DIST/$NAME-linux-$ARCH.tar.gz"
tar -C "$WORK" -czf "$out" "$NAME"
echo "packaged $out ($(du -h "$out" | cut -f1))"
