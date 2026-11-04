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

export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"

init() {
    sudo apt-get update
    sudo apt-get install -y openjdk-17-jdk-headless unzip curl rsync qemu-user-static
    mkdir -p "$TOOLS" "$SDK/cmdline-tools"
    if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
        curl -fL -o "$TOOLS/$CMDLINE_ZIP" \
            "https://dl.google.com/android/repository/$CMDLINE_ZIP"
        rm -rf "$SDK/cmdline-tools/latest" "$SDK/cmdline-tools/cmdline-tools"
        unzip -q "$TOOLS/$CMDLINE_ZIP" -d "$SDK/cmdline-tools"
        mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
    fi
    # `yes` dies of SIGPIPE when sdkmanager is done; pipefail would abort
    yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null || true
    "$SDK/cmdline-tools/latest/bin/sdkmanager" \
        "platform-tools" "platforms;android-34" "build-tools;34.0.0"
    if [ ! -x "$GRADLE" ]; then
        curl -fL -o "$TOOLS/gradle.zip" \
            "https://services.gradle.org/distributions/gradle-$GRADLE_VER-bin.zip"
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
