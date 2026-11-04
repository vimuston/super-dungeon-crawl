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
  "$SRC/webserver" "$PKG/crawl-ref/source/"
cp "$HERE/scripts/ensure_user.py" "$PKG/tools/"
cp "$HERE/LICENSE" "$HERE/NOTICE" "$PKG/"

cat > "$PKG/start.sh" <<'EOF'
#!/usr/bin/env bash
# Start the Super Dungeon Crawl webtiles server (see README.txt).
set -euo pipefail
cd "$(dirname "$0")/crawl-ref/source"
mkdir -p rcs/running rcs/ttyrecs saves
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

Requirements: Linux $ARCH with glibc 2.35 or newer (Debian 12+, Ubuntu 22.04+),
Python 3 with Tornado 6 and PyYAML, and ncurses 6. On Debian/Ubuntu:

    sudo apt install python3-tornado python3-yaml libncursesw6

Run:

    ./start.sh

then open http://localhost:8080 (or http://<this machine>:8080).

Configuration: crawl-ref/source/webserver/config.yml.

  The default config is for a personal install: it listens on all interfaces
  and logs everyone in as "player" without a password. Only run it on a
  network you trust. To host for other people, copy config.public.yml over
  config.yml (real accounts, loopback only) and put an HTTPS reverse proxy
  (Caddy, nginx) in front of it.

Saves, morgue files and options live in crawl-ref/source/saves and
crawl-ref/source/rcs. Keep those folders when you update: unpack the new
package over the old one.

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
