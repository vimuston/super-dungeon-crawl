#!/usr/bin/env bash
# Cross-build the patched crawl webtiles binary for an arm64 Linux server
# (aarch64, Debian 13 "trixie" by default) on an x86-64 Debian/Ubuntu machine
# (or WSL). A few minutes, against the better part of an hour on a small board.
#
#   crossbuild-arm64.sh init    one time: cross toolchain + arm64 sysroot
#   crossbuild-arm64.sh build   build the binary (from the crawl checkout that
#                               scripts/setup.sh made, plus patches/)
#   crossbuild-arm64.sh ship    copy the binary to the server as crawl.new
#                               (swap it in once no game is running)
#
# Env:
#   SDC_BUILD          work root (default ~/sdc-build; setup.sh uses the same)
#   SDC_ARM64_SUITE    Debian suite of the target (default trixie; match the
#                      server's release so the libraries line up)
#   SDC_ARM64_STDCXX   C++ headers package of that suite (default
#                      libstdc++-14-dev, trixie's)
#   SDC_DEPLOY         ship target, user@host (required for ship)
#   SDC_DEPLOY_DIR     crawl-ref/source directory on the server, relative to
#                      the login's home or absolute
#                      (default sdc-build/crawl/crawl-ref/source)
#   SDC_SSH, SDC_SCP   ssh / scp commands (default ssh / scp). Under WSL with
#                      the keys only in Windows, use ssh.exe / scp.exe.
#   SDC_JOBS           parallel jobs (default nproc)
set -euo pipefail

ROOT="${SDC_BUILD:-$HOME/sdc-build}"
SYSROOT="$ROOT/sysroot-arm64"
SRC="$ROOT/crawl-arm64"            # separate tree so the native build stays intact
SUITE="${SDC_ARM64_SUITE:-trixie}"
# the C++ runtime headers are versioned per suite (trixie: GCC 14)
STDCXX="${SDC_ARM64_STDCXX:-libstdc++-14-dev}"
DEPLOY_DIR="${SDC_DEPLOY_DIR:-sdc-build/crawl/crawl-ref/source}"
SSH="${SDC_SSH:-ssh}"
SCP="${SDC_SCP:-scp}"
TRIPLE=aarch64-linux-gnu
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cmd_init() {
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    gcc-$TRIPLE g++-$TRIPLE binutils-$TRIPLE qemu-user-static binfmt-support \
    debootstrap perl pkg-config bison flex python3-yaml
  # The sysroot's second stage runs arm64 binaries through QEMU. Without
  # systemd (e.g. WSL) nothing registers the handler, so do it by hand
  # (F = open the interpreter now, so it also works inside the chroot).
  if [ ! -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ]; then
    mountpoint -q /proc/sys/fs/binfmt_misc || sudo mount -t binfmt_misc binfmt_misc /proc/sys/fs/binfmt_misc
    printf '%s' ':qemu-aarch64:M::\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\xb7\x00:\xff\xff\xff\xff\xff\xff\xff\x00\xff\xff\xff\xff\xff\xff\xff\xff\xfe\xff\xff\xff:/usr/bin/qemu-aarch64-static:OCF' \
      | sudo tee /proc/sys/fs/binfmt_misc/register >/dev/null
  fi
  if [ ! -d "$SYSROOT/debootstrap" ] && [ ! -x "$SYSROOT/bin/true" ]; then
    sudo debootstrap --foreign --arch=arm64 --variant=minbase \
      --include=libc6-dev,$STDCXX,libncursesw6,libncurses-dev,liblua5.1-0-dev,libsqlite3-dev,zlib1g-dev,libpng-dev,libfreetype-dev,pkg-config \
      "$SUITE" "$SYSROOT" http://deb.debian.org/debian
  fi
  if [ -d "$SYSROOT/debootstrap" ]; then
    sudo chroot "$SYSROOT" /debootstrap/debootstrap --second-stage
  fi
  echo "init done: $SUITE arm64 sysroot at $SYSROOT"
}

cmd_build() {
  [ -x "$SYSROOT/bin/true" ] || { echo "run '$0 init' first" >&2; exit 1; }
  if [ ! -d "$SRC/.git" ]; then
    [ -d "$ROOT/crawl/.git" ] \
      || { echo "no crawl checkout in $ROOT/crawl: run scripts/setup.sh first" >&2; exit 1; }
    cp -a "$ROOT/crawl" "$SRC"
    git -C "$SRC" clean -xfdq || true     # drop native objects, keep sources + submodules
  fi
  bash "$HERE/scripts/apply_patches.sh" "$SRC"
  cd "$SRC/crawl-ref/source"
  # The Makefile's rule for this generated file is racy at high -j; make it first.
  python3 util/status-icon-sizes-gen.py rltiles/icon-sizes.txt
  # Tile generation runs on the build machine and its output is
  # arch-independent: build it natively first, with none of the cross flags
  # (they leak into the sub-make).
  make -j"${SDC_JOBS:-$(nproc)}" WEBTILES=y build-rltiles > "$ROOT/crossbuild-tiles.log" 2>&1 \
    || { tail -30 "$ROOT/crossbuild-tiles.log"; exit 1; }
  export PKG_CONFIG_SYSROOT_DIR="$SYSROOT"
  export PKG_CONFIG_LIBDIR="$SYSROOT/usr/lib/$TRIPLE/pkgconfig:$SYSROOT/usr/lib/pkgconfig:$SYSROOT/usr/share/pkgconfig"
  make -j"${SDC_JOBS:-$(nproc)}" WEBTILES=y CROSSHOST=$TRIPLE -o build-rltiles \
    EXTERNAL_FLAGS="--sysroot=$SYSROOT" EXTERNAL_LDFLAGS="--sysroot=$SYSROOT" \
    > "$ROOT/crossbuild.log" 2>&1 || { tail -40 "$ROOT/crossbuild.log"; exit 1; }
  file crawl
  echo "built $SRC/crawl-ref/source/crawl"
}

cmd_ship() {
  local target="${SDC_DEPLOY:?set SDC_DEPLOY=user@host (the arm64 server)}"
  local bin="$SRC/crawl-ref/source/crawl"
  [ -x "$bin" ] || { echo "run '$0 build' first" >&2; exit 1; }
  local src="$bin" tmp=""
  case "$SCP" in
    *.exe)
      # a Windows scp (WSL with the SSH keys on the Windows side) can't read
      # the Linux filesystem reliably: stage the file in the Windows temp dir
      local wtemp
      wtemp="$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')"
      tmp="$(mktemp -p "$(wslpath -u "$wtemp")" crawl-arm64.XXXXXX)"
      cp "$bin" "$tmp"
      src="$(wslpath -w "$tmp")"
      ;;
  esac
  "$SCP" -o BatchMode=yes "$src" "$target:$DEPLOY_DIR/crawl.new"
  if [ -n "$tmp" ]; then rm -f "$tmp"; fi
  "$SSH" -o BatchMode=yes "$target" "chmod +x $DEPLOY_DIR/crawl.new"
  echo "Copied as crawl.new. Once no game is running on the server:"
  echo "  $SSH $target 'cd $DEPLOY_DIR && mv crawl crawl.old && mv crawl.new crawl'"
}

"cmd_${1:?usage: crossbuild-arm64.sh init|build|ship}"
