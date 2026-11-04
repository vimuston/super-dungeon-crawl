#!/usr/bin/env bash
# Cross-build crawl for the on-device mode of the Android app (aarch64,
# static, Android NDK) and stage everything the APK bundles.
#
#   crossbuild-android.sh build   ncurses + crawl + crawlhost, then stage
#   crossbuild-android.sh stage   only re-stage the web client / game data
#
# Output, picked up by build-android.sh:
#   $OUT/jniLibs/arm64-v8a/libcrawl.so, libcrawlhost.so  (executables; the
#        .so name gets them installed somewhere Android lets apps exec from)
#   $OUT/assets/crawl/   dat/, docs/, settings/ (+ rcs/player.rc)
#   $OUT/assets/web/     index.html, static/, gamedata/ (the Super Dungeon Crawl client)
#
# Needs the crawl checkout from scripts/setup.sh and the Android SDK from
# build-android.sh init; installs the NDK.
# Env:
#   SDC_BUILD           work root (default ~/sdc-build)
#   DCSS_ANDROID_TOOLS  Android SDK / Gradle root (default ~/android-build)
#   SDC_PLAYER_RC       an options file to bundle as the app's starting
#                       rcs/player.rc (optional; default: crawl's defaults)
#   SDC_JOBS            parallel jobs (default nproc)
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${SDC_BUILD:-$HOME/sdc-build}"
TOOLS="${DCSS_ANDROID_TOOLS:-$HOME/android-build}"
SDK="$TOOLS/sdk"
NDK_VER=29.0.14206865
NDK="$SDK/ndk/$NDK_VER"
API=26
TRIPLE=aarch64-linux-android
SRC="$ROOT/crawl-android"           # separate tree, like crawl-arm64
NC_VER=6.5
NC_SHA256=136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6
NC="$ROOT/ncurses-android"          # install prefix
BIN="$ROOT/android-bin"             # $TRIPLE-gcc etc. wrappers for the Makefile
OUT="$ROOT/android-out"
JOBS="${SDC_JOBS:-$(nproc)}"

tc() { echo "$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin"; }

need_deps() {
  [ -d "$ROOT/crawl/.git" ] \
    || { echo "no crawl checkout in $ROOT/crawl: run scripts/setup.sh first" >&2; exit 1; }
  [ -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ] \
    || { echo "no Android SDK in $SDK: run scripts/build-android.sh init first" >&2; exit 1; }
  command -v qemu-aarch64-static >/dev/null \
    || { echo "qemu-aarch64-static missing: sudo apt-get install qemu-user-static" >&2; exit 1; }
}

ensure_ndk() {
  if [ ! -d "$NDK" ]; then
    "$SDK/cmdline-tools/latest/bin/sdkmanager" "ndk;$NDK_VER"
  fi
  mkdir -p "$BIN"
  # crawl's Makefile calls $(CROSSHOST)-gcc/-g++/-ar/...; map them to NDK clang
  printf '#!/bin/sh\nexec %s/%s%s-clang "$@"\n' "$(tc)" $TRIPLE $API > "$BIN/$TRIPLE-gcc"
  printf '#!/bin/sh\nexec %s/%s%s-clang++ "$@"\n' "$(tc)" $TRIPLE $API > "$BIN/$TRIPLE-g++"
  for t in ar ranlib strip nm; do
    printf '#!/bin/sh\nexec %s/llvm-%s "$@"\n' "$(tc)" $t > "$BIN/$TRIPLE-$t"
  done
  chmod +x "$BIN"/*
  export PATH="$BIN:$PATH"
}

build_ncurses() {
  [ -f "$NC/lib/libncursesw.a" ] && return
  local work="$ROOT/ncurses-$NC_VER"
  if [ ! -d "$work" ]; then
    curl -fL -o "$ROOT/ncurses-$NC_VER.tar.gz.part" \
      "https://ftp.gnu.org/gnu/ncurses/ncurses-$NC_VER.tar.gz"
    # same checksum from ftp.gnu.org and invisible-island's own mirror
    echo "$NC_SHA256  $ROOT/ncurses-$NC_VER.tar.gz.part" | sha256sum -c --quiet - \
      || { rm -f "$ROOT/ncurses-$NC_VER.tar.gz.part"; echo "ncurses checksum mismatch" >&2; exit 1; }
    mv "$ROOT/ncurses-$NC_VER.tar.gz.part" "$ROOT/ncurses-$NC_VER.tar.gz"
    tar -xzf "$ROOT/ncurses-$NC_VER.tar.gz" -C "$ROOT"
  fi
  cd "$work"
  # No terminfo database on the phone: compile the one terminal crawlhost
  # declares (TERM=xterm-256color) into the library.
  ./configure --host=$TRIPLE --prefix="$NC" --with-build-cc=gcc \
    CC=$TRIPLE-gcc AR=$TRIPLE-ar RANLIB=$TRIPLE-ranlib STRIP=$TRIPLE-strip \
    --enable-widec --without-shared --with-normal --without-debug \
    --without-cxx --without-cxx-binding --without-ada --without-progs \
    --without-tests --without-manpages --disable-database \
    --with-fallbacks=xterm-256color --disable-stripping \
    > "$ROOT/ncurses-android.log" 2>&1 || { tail -30 "$ROOT/ncurses-android.log"; exit 1; }
  make -j"$JOBS" >> "$ROOT/ncurses-android.log" 2>&1 \
    && make install >> "$ROOT/ncurses-android.log" 2>&1 \
    || { tail -30 "$ROOT/ncurses-android.log"; exit 1; }
}

prepare_tree() {
  if [ ! -d "$SRC/.git" ]; then
    cp -a "$ROOT/crawl" "$SRC"
    git -C "$SRC" checkout -q -- .
    git -C "$SRC" clean -xfdq || true
    git -C "$SRC" submodule foreach -q --recursive 'git clean -xfdq' || true
  fi
  bash "$HERE/scripts/apply_patches.sh" "$SRC"
  # Crawl's __ANDROID__ code is for its SDL port (JNI keyboard, SDL storage
  # paths, logcat). This is a plain console+webtiles build that happens to
  # run on Android, so retarget those blocks to a macro nobody defines.
  cd "$SRC/crawl-ref/source"
  { grep -rl --include='*.cc' --include='*.h' '__ANDROID__' . || true; } \
    | { grep -v '^./contrib/' || true; } \
    | xargs -r sed -i 's/__ANDROID__/CRAWL_SDL_ANDROID/g'
  # ...except where it's about bionic itself (no backtrace() before API 33)
  sed -i 's/defined(CRAWL_SDL_ANDROID)/defined(__ANDROID__)/' crash.cc
}

build_crawl() {
  cd "$SRC/crawl-ref/source"
  python3 util/status-icon-sizes-gen.py rltiles/icon-sizes.txt
  # tile generation runs on the build machine (see crossbuild-arm64.sh)
  make -j"$JOBS" WEBTILES=y build-rltiles > "$ROOT/android-tiles.log" 2>&1 \
    || { tail -30 "$ROOT/android-tiles.log"; exit 1; }
  # Static: no libc++_shared to ship, and qemu-aarch64 can run it here.
  make -j"$JOBS" WEBTILES=y CROSSHOST=$TRIPLE -o build-rltiles \
    NC_PREFIX="$NC" NO_TRY_GOLD=y EXTERNAL_FLAGS="-isystem $NC/include" \
    EXTERNAL_LDFLAGS="-static -static-libstdc++" \
    > "$ROOT/android-crawl.log" 2>&1 || { tail -40 "$ROOT/android-crawl.log"; exit 1; }
  file crawl
}

build_host() {
  mkdir -p "$OUT/jniLibs/arm64-v8a"
  $TRIPLE-gcc -O2 -Wall -static -o "$OUT/jniLibs/arm64-v8a/libcrawlhost.so" \
    "$HERE/android/native/crawlhost.c"
  cp "$SRC/crawl-ref/source/crawl" "$OUT/jniLibs/arm64-v8a/libcrawl.so"
  $TRIPLE-strip "$OUT/jniLibs/arm64-v8a/libcrawl.so"
}

stage() {
  # a fresh asset tree every time: the APK holds no player data
  rm -rf "$OUT/assets"
  bash "$HERE/scripts/stage_client.sh" "$SRC" "$OUT/assets"
  # optional starting options file (the player can change options in game)
  if [ -n "${SDC_PLAYER_RC:-}" ]; then
    cp "$SDC_PLAYER_RC" "$OUT/assets/crawl/rcs/player.rc"
    echo "bundled options file: $SDC_PLAYER_RC"
  fi
  build_cache
  git -C "$SRC" rev-parse --short HEAD > "$OUT/assets/crawl/VERSION"
  echo "$(date +%s)" >> "$OUT/assets/crawl/VERSION"
  du -sh "$OUT/assets/crawl" "$OUT/assets/web" "$OUT/jniLibs"
}

# Crawl compiles dat/des and the text databases into saves/des, saves/db on
# first start (a minute or more on a phone), keyed on each source file's
# exact mtime. Give the bundled files a fixed mtime (the app restores it when
# unpacking, see MainActivity.DATA_MTIME) and ship caches built against it.
DATA_MTIME=1700000000

build_cache() {
  local c="$ROOT/android-cache"
  find "$OUT/assets/crawl" -exec touch -h -d "@$DATA_MTIME" {} +
  rm -rf "$c"
  mkdir -p "$c"
  cp -a "$OUT/assets/crawl/dat" "$OUT/assets/crawl/docs" "$OUT/assets/crawl/settings" "$c/"
  (cd "$c" && qemu-aarch64-static "$OUT/jniLibs/arm64-v8a/libcrawl.so" -dir "$c/" -builddb \
     > "$ROOT/android-builddb.log" 2>&1) \
    || { tail -20 "$ROOT/android-builddb.log"; exit 1; }
  mkdir -p "$OUT/assets/crawl/cache"
  cp -r "$c/saves/des" "$c/saves/db" "$OUT/assets/crawl/cache/"
  echo "caches: $(ls "$c/saves/des" | wc -l) des, $(ls "$c/saves/db" | wc -l) db files"
}

case "${1:-}" in
  build) need_deps; ensure_ndk; build_ncurses; prepare_tree; build_crawl; build_host; stage ;;
  stage) need_deps; ensure_ndk; stage ;;
  *) echo "usage: $0 build|stage" >&2; exit 2 ;;
esac
