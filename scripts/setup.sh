#!/usr/bin/env bash
# One-time setup on Debian/Ubuntu (or WSL): install deps, clone current crawl
# sources, apply patches/, build the webtiles binary. Re-run to update + rebuild.
#
# Env:
#   SDC_BUILD        work root (default ~/sdc-build); the checkout is $SDC_BUILD/crawl
#   SDC_CRAWL_REF    crawl commit, branch or tag (default master's head)
#   SDC_MAKE_FLAGS   extra make flags, e.g. "BUILD_LUA=y BUILD_SQLITE=y
#                    BUILD_ZLIB=y" to bundle those libraries (package-server.sh)
#   SDC_SKIP_BUILD   1 = stop after the checkout and patches (cross-builds
#                    only need the sources)
#   SDC_JOBS         parallel jobs (default nproc)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_ROOT="${SDC_BUILD:-$HOME/sdc-build}"
CRAWL="$BUILD_ROOT/crawl"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update -qq
# webtiles build deps (no SDL/FreeType/fonts: those are for local tiles);
# libpng: the tile-sheet generator, advancecomp/pngcrush: its PNG optimiser
$SUDO apt-get install -y -qq build-essential libncursesw5-dev bison flex \
  liblua5.1-0-dev libsqlite3-dev zlib1g-dev pkg-config python3-yaml \
  python3-tornado binutils-gold libpng-dev advancecomp pngcrush git rsync

mkdir -p "$BUILD_ROOT"
bash "$HERE/scripts/fetch_crawl.sh" "$CRAWL"

# Local patches (see README "Crawl patches")
bash "$HERE/scripts/apply_patches.sh" "$CRAWL"

if [ "${SDC_SKIP_BUILD:-0}" = 1 ]; then
  echo "Sources ready in $CRAWL (build skipped)"
  exit 0
fi

cd "$CRAWL/crawl-ref/source"
echo "Building crawl ($(git describe)) - this takes a few minutes..."
# The Makefile's rule for this generated file is racy at high -j; make it first.
python3 util/status-icon-sizes-gen.py rltiles/icon-sizes.txt
# shellcheck disable=SC2086  # SDC_MAKE_FLAGS is a list of make arguments
make -j"${SDC_JOBS:-$(nproc)}" WEBTILES=y ${SDC_MAKE_FLAGS:-} > "$BUILD_ROOT/build.log" 2>&1 \
  || { tail -30 "$BUILD_ROOT/build.log"; exit 1; }
echo "Built: $CRAWL/crawl-ref/source/crawl"
