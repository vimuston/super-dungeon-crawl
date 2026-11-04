#!/usr/bin/env bash
# Runs inside Cygwin (build-windows.ps1 calls it): build crawl.exe with
# webtiles, plus crawlhost.exe, and stage everything the Windows package holds.
#
#   cygbuild-windows.sh build   crawl + crawlhost, then stage
#   cygbuild-windows.sh stage   only re-stage the web client / game data
#
# Output ($SDC_WIN_OUT/pkg, the package root; Cygwin finds its root from
# cygwin1.dll, so bin/ and usr/ sit right there):
#   bin/         crawl.exe, crawlhost.exe, cygwin1.dll and the other DLLs
#   usr/share/terminfo/   xterm-256color (crawl still drives curses in a pty)
#   crawl/       dat/, docs/, settings/ (the game's -dir; saves/ appears here)
#   web/         index.html, game.html, static/, gamedata/ (the client)
set -euo pipefail

HERE="${SDC_HERE:?run through build-windows.ps1}"
OUT="${SDC_WIN_OUT:?run through build-windows.ps1}"
ROOT="$HOME/sdc-build"
SRC="$ROOT/crawl"
PKG="$OUT/pkg"
JOBS="${SDC_JOBS:-$(nproc)}"

prepare_tree() {
  mkdir -p "$ROOT"
  # first build, or a pinned commit (SDC_CRAWL_REF): fetch; otherwise keep
  # the checkout as it is
  if [ ! -d "$SRC/.git" ] || [ -n "${SDC_CRAWL_REF:-}" ]; then
    bash "$HERE/scripts/fetch_crawl.sh" "$SRC"
  fi
  for p in "$HERE"/patches/*.patch; do
    if git -C "$SRC" apply -R --check "$p" 2>/dev/null; then
      echo "Patch already applied: $(basename "$p")"
    else
      git -C "$SRC" apply "$p" && echo "Applied patch: $(basename "$p")"
    fi
  done
}

build_crawl() {
  python3 -c 'import yaml' 2>/dev/null || python3 -m pip install -q pyyaml
  cd "$SRC/crawl-ref/source"
  python3 util/status-icon-sizes-gen.py rltiles/icon-sizes.txt || true
  make -j"$JOBS" WEBTILES=y BUILD_LUA=y BUILD_SQLITE=y BUILD_ZLIB=y BUILD_PCRE=y \
    > "$ROOT/win-crawl.log" 2>&1 || { tail -40 "$ROOT/win-crawl.log"; exit 1; }
  ls -l crawl.exe
}

build_host() {
  mkdir -p "$PKG/bin"
  gcc -O2 -Wall -o "$PKG/bin/crawlhost.exe" "$HERE/android/native/crawlhost.c"
  cp "$SRC/crawl-ref/source/crawl.exe" "$PKG/bin/crawl.exe"
  strip "$PKG/bin/crawl.exe" "$PKG/bin/crawlhost.exe"
  # every Cygwin DLL they load (not the Windows system ones)
  for exe in crawl crawlhost; do
    ldd "$PKG/bin/$exe.exe" | awk '/=>/ {print $3}' | grep -iv '/cygdrive/c/windows' \
      | while read -r dll; do
        [ "$(dirname "$dll")" = "$PKG/bin" ] || cp -u "$dll" "$PKG/bin/"
      done
  done
  mkdir -p "$PKG/usr/share/terminfo/78"
  cp /usr/share/terminfo/78/xterm-256color "$PKG/usr/share/terminfo/78/"
}

stage() {
  local s="$SRC/crawl-ref/source"
  # the Super Dungeon Crawl client, exactly as apply.sh puts it on the server
  git -C "$SRC" checkout -- \
    crawl-ref/source/webserver/game_data/static/game.js \
    crawl-ref/source/webserver/game_data/templates/game.html
  cp -r "$HERE/overlay/webserver/game_data/." "$s/webserver/game_data/"
  python3 "$HERE/scripts/patch_client.py" "$s/webserver/game_data"

  # saves/ and rcs/ belong to the player: leave them alone on a re-stage
  rm -rf "$PKG/web" "$PKG/crawl/dat" "$PKG/crawl/docs" "$PKG/crawl/settings"
  mkdir -p "$PKG/crawl/rcs" "$PKG/web/gamedata"
  cp -r "$s/dat" "$s/../docs" "$s/../settings" "$PKG/crawl/"
  rm -rf "$PKG/crawl/docs/develop"
  rm -rf "$PKG/crawl/dat/tiles"      # local-tiles only
  cp -r "$s/webserver/static" "$PKG/web/static"
  cp -r "$s/webserver/game_data/static/." "$PKG/web/gamedata/"
  sed 's/{{ *version *}}/local/g' "$s/webserver/game_data/templates/game.html" \
    > "$PKG/web/game.html"
  python3 -c 'import tornado' 2>/dev/null || python3 -m pip install -q tornado
  python3 "$HERE/android/native/render_client.py" "$s/webserver/templates" \
    > "$PKG/web/index.html"
  # saves/.prepared marks the compiled des/db caches; new data invalidates it
  rm -rf "$PKG/crawl/saves/des" "$PKG/crawl/saves/db" "$PKG/crawl/saves/.prepared"
  git -C "$SRC" rev-parse --short HEAD > "$PKG/crawl/VERSION"
  du -sh "$PKG/bin" "$PKG/crawl" "$PKG/web"
}

case "${1:-}" in
  build) prepare_tree; build_crawl; build_host; stage ;;
  stage) stage ;;
  *) echo "usage: $0 build|stage" >&2; exit 2 ;;
esac
