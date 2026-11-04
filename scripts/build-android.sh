#!/usr/bin/env bash
# Build the Android app (android/) on a Debian/Ubuntu machine (or WSL).
#
#   init   one time: JDK 17, rsync, QEMU (apt), Android command-line tools,
#          platform 34, build-tools and Gradle into ~/android-build (~1 GB;
#          set DCSS_ANDROID_TOOLS to put them elsewhere)
#   build  assemble the APK and copy it to dist/super-dungeon-crawl.apk (bundles the
#          on-device crawl: run crossbuild-android.sh build first)
#
# Install on the phone: copy dist/super-dungeon-crawl.apk over and open it (allow
# "install unknown apps" for the file manager), or `adb install -r` it.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="${DCSS_ANDROID_TOOLS:-$HOME/android-build}"
SDK="$TOOLS/sdk"
GRADLE_VER=8.7
GRADLE="$TOOLS/gradle-$GRADLE_VER/bin/gradle"
CMDLINE_ZIP=commandlinetools-linux-11076708_latest.zip
# pinned downloads (Google's repository2-3.xml lists the SHA-1 d313adb7...;
# Gradle publishes gradle-<ver>-bin.zip.sha256)
CMDLINE_SHA256=2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258
GRADLE_SHA256=544c35d6bd849ae8a5ed0bcea39ba677dc40f49df7d1835561582da2009b961d

export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"

# fetch URL FILE SHA256: download and refuse anything with another checksum
fetch() {
    curl -fL -o "$2.part" "$1"
    if ! echo "$3  $2.part" | sha256sum -c --quiet -; then
        rm -f "$2.part"
        echo "checksum mismatch for $1" >&2
        exit 1
    fi
    mv "$2.part" "$2"
}

init() {
    sudo apt-get update
    sudo apt-get install -y openjdk-17-jdk-headless unzip curl rsync qemu-user-static
    mkdir -p "$TOOLS" "$SDK/cmdline-tools"
    if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
        fetch "https://dl.google.com/android/repository/$CMDLINE_ZIP" \
            "$TOOLS/$CMDLINE_ZIP" "$CMDLINE_SHA256"
        rm -rf "$SDK/cmdline-tools/latest" "$SDK/cmdline-tools/cmdline-tools"
        unzip -q "$TOOLS/$CMDLINE_ZIP" -d "$SDK/cmdline-tools"
        mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
    fi
    # `yes` dies of SIGPIPE when sdkmanager is done; pipefail would abort
    yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null || true
    "$SDK/cmdline-tools/latest/bin/sdkmanager" \
        "platform-tools" "platforms;android-34" "build-tools;34.0.0"
    if [ ! -x "$GRADLE" ]; then
        fetch "https://services.gradle.org/distributions/gradle-$GRADLE_VER-bin.zip" \
            "$TOOLS/gradle.zip" "$GRADLE_SHA256"
        unzip -q "$TOOLS/gradle.zip" -d "$TOOLS"
    fi
    echo "android toolchain ready in $TOOLS"
}

build() {
    [ -x "$GRADLE" ] || { echo "run '$0 init' first" >&2; exit 1; }
    # Build a copy outside the checkout: Gradle is slow on (and trips over
    # file locks of) a Windows drive mounted into WSL, and the checkout stays
    # free of build output.
    local work="$TOOLS/work"
    mkdir -p "$work"
    rsync -a --delete --exclude build --exclude .gradle \
        "$HERE/android/" "$work/android/"
    # on-device crawl + bundled client/game data from crossbuild-android.sh
    local out="${SDC_BUILD:-$HOME/sdc-build}/android-out"
    [ -f "$out/jniLibs/arm64-v8a/libcrawl.so" ] \
        || { echo "run 'scripts/crossbuild-android.sh build' first" >&2; exit 1; }
    rsync -a "$out/jniLibs/" "$work/android/app/src/main/jniLibs/"
    rsync -a "$out/assets/" "$work/android/app/src/main/assets/"
    echo "sdk.dir=$SDK" > "$work/android/local.properties"
    (cd "$work/android" && "$GRADLE" --no-daemon -q assembleRelease)
    mkdir -p "$HERE/dist"
    cp "$work/android/app/build/outputs/apk/release/app-release.apk" \
        "$HERE/dist/super-dungeon-crawl.apk"
    echo "built $HERE/dist/super-dungeon-crawl.apk"
}

case "${1:-}" in
    init) init ;;
    build) build ;;
    *) echo "usage: $0 init|build" >&2; exit 2 ;;
esac
