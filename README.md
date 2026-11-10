# Super Dungeon Crawl

[Dungeon Crawl Stone Soup](https://github.com/crawl/crawl) (DCSS, current
`master`) played through its webtiles client, rebuilt around visual effects:
every spell element hits with its own animation, gods, wands, scrolls and
statuses get their own moments, the dungeon is lit and alive, and phones get a
real touch layout instead of a shrunken desktop page. Everything runs on your
own machine: a Windows exe, an Android app, or a local webtiles server.

- [What it changes](#what-it-changes)
- [Install and play](#install-and-play)
- [Controls](#controls)
- [Building](#building)
- [Crawl patches](#crawl-patches)
- [Security notes](#security-notes)
- [Development](#development)
- [License](#license)

## What it changes

Mostly the webtiles **browser client**; the crawl binary gets three small
patches (see [Crawl patches](#crawl-patches)).

### Spell effects

Every spell hit shows its damage number, and every element has its own
number style and motion, so a fireball, a frost bolt and a chaos surge never
look like a sword hit:

| Element | What you see |
|---------|--------------|
| fire    | flame tongues and embers; the number flickers and rises |
| lava    | a molten slam with dark crust chunks and orange drips |
| cold    | the number snaps in, shivers, freezes and shatters; frost spokes or ice spikes |
| electricity | jittering digits, forked lightning from above, sparks |
| poison / acid | the number sags and drips or melts away; bubbles, sizzle, a puddle |
| earth   | slams in from above with rock chunks, a dust ring and cracks |
| force / air | afterimages and shock rings, or a spiralling gust |
| necromancy / shadow / blood | ghostly rise and drain motes, melting tendrils, heartbeat thumps |
| chaos   | every digit twists its own way while hues cycle, glitch slices, a vortex |
| holy    | rotating rays, a halo ring, sparkles |
| water / steam | a jelly splash with ripples, hot puffs |
| dispel  | digits dissolve into pixels |

Spells that do no damage get their own effects too: polymorph, charm, hexes,
blink and teleport (a dematerialise / rematerialise with phosphor tears), a
rune circle and scanline curtain for summons and green soul wisps for
necromancy, passwall ripples, digging debris and the Orb of Destruction's
glowing trail.

### More effects

- **Gods**: abilities of nearly every god have their own effect: Okawaru's
  arena duel, Qazlal's elemental upheaval, Wu Jian's golden dash trails,
  Yredelemnul's chains, torment's red-black pulse, Lugonu's tears in reality,
  Xom's random flourishes, Sif Muna's bolts into the MP bar and more.
- **Statuses**: haste speed lines, slow's laggy ghosts, an icy Ozo's Armour
  glow, Death's Door greyscale, poison bubbles and a throbbing HP bar, dizzy
  stars for confusion, and a full berserk sequence (onset shockwave, rage
  tremor, heartbeat vignette, the crash afterwards).
- **Combat**: damage numbers (or comic-style "KA-CHUNK" words) on every
  attack, blood when you are hurt, and a physical feel for ranged weapons: the
  bowstring draws and snaps, crossbows thunk, hand cannons kick with flash and
  smoke, slings whirl.
- **Items and events**: scrolls and potions, rune and Orb pickups, a shaft
  plunge into darkness, HP/MP bars that surge and drain, and terminal-style
  splash text for statuses, big hits, level-ups and new areas.

### Mobile layout

On phones (and in the Android app) the client becomes a touch game rather
than a shrunken desktop page: tap to travel or attack, swipe to step,
long-press to describe. Long-press your character for the **orb menu**, a ring
of orbs you slide onto to fan out spells, wands and abilities. Messages appear
in a fading bubble, the quick-use bar sits at the very bottom, your own macros
can be pinned on screen, y/n
questions get real buttons, and the menus (skills, spells, character
selection, the `%` overview, number prompts) get full-screen touch layouts.
See [Controls](#controls) for the details.

### A living dungeon

- **Lighting**: fire, lava, torches, lightning, cold, poison, magic, portals,
  altars, glowing monsters and spell bolts light their surroundings; your
  line of sight is lantern-lit and the remembered map outside it turns cold
  and foggy, with dark tendrils curling at the edge of the unexplored.
- **Living tiles**: every tile in sight gets a little motion from what it is
  and what is happening (creatures breathe by state, water ripples, lava
  heaves, trees sway, gold glints, hits send ripples), and clouds of fire,
  fog, steam and poison drift and swirl. See the header of `alive.js` for
  the full list.
- **2.5D view**: an optional slanted camera with raised walls and upright
  creatures. Hold the middle mouse button (mouse3) on the view and drag
  sideways to rotate it, up/down to zoom; a middle click resets both. With
  Shift held, dragging up/down changes the perspective instead, and
  Shift + middle click resets it.

### HUD and CRT look

- **HUD**: the dungeon takes the full width. Status badges, slim HP/MP bars
  and a compact stats strip form one panel in the top-left corner.
  The quick-use bar becomes an action bar at the bottom; a small minimap and
  monster list sit top-right.
- **CRT filter** (optional, Alt+C): curvature, scanlines, bloom, an
  aperture-grille mask and a phosphor glow on text; red bleeds in from the
  edges when HP is low. With it off, the 2.5D view and all effects stay.

Mouse clicks and hovers go through the same curvature, so they hit the tile
you see. Settings persist in the browser (localStorage).

## Install and play

Prebuilt packages are on the project's GitHub Releases page: the Windows exe,
the Android APK and Linux server packages for x86-64 and arm64. Or build them
yourself (see [Building](#building)). Saves move between builds made from the
same crawl commit and patches, which every file of one release shares.

### Windows (standalone)

`super-dungeon-crawl.exe` is self-contained: download it and run it. No WSL,
Python, .NET or server needed. On first start the game files unpack to
`%LOCALAPPDATA%\SuperDungeonCrawl\game` (`--dir PATH` unpacks elsewhere).
Saves, morgue files and `rcs/player.rc` live in its `crawl\` folder and
survive updates. The game shows in its own window (WebView2, part of Windows
10/11; F11 = fullscreen). Closing the window saves the game and exits.

The exe isn't code-signed, so on first start Windows SmartScreen may warn
about an unrecognised app: choose More info > Run anyway.

### Android

Install `super-dungeon-crawl.apk` (allow installing unknown apps for your file
manager, or `adb install -r super-dungeon-crawl.apk`). The app is fully
offline: it bundles crawl for arm64, the game data and the client, and runs
everything on the phone. It never connects to a server.

- Fullscreen, the screen stays on, back = Esc (or closes the mobile
  overlays).
- After a minute in the background the game is saved, and it resumes when
  you come back.
- Tools > Saves exports the save or imports one (`saves/player.cs` from
  another install).

### Linux server package

`super-dungeon-crawl-server-linux-<arch>.tar.gz` (x86_64 or aarch64) is a
ready-to-run webtiles server for Debian 12+ / Ubuntu 22.04+ or similar:

```bash
sudo apt install python3-tornado python3-yaml libncursesw6
tar -xzf super-dungeon-crawl-server-linux-x86_64.tar.gz
super-dungeon-crawl-server/start.sh
```

Then open <http://localhost:8080> on that machine. By default it listens on
loopback only; to play from other devices on your home network, set
`bind_address: ""` in `crawl-ref/source/webserver/config.yml` (created on the
first start; read [Security notes](#security-notes) first). Its `README.txt`
covers the configuration. To update, unpack a newer package over the old one:
`config.yml`, saves and options stay.

### Linux, or Windows with WSL (from source)

On Debian or Ubuntu (or in WSL):

```bash
bash scripts/setup.sh   # one time: build deps, clone crawl to ~/sdc-build, build it
bash scripts/run.sh     # apply the client, start the server
```

Then open <http://localhost:8080>. You are logged in automatically as
`player`. Re-run `setup.sh` to update to the newest crawl.

On Windows with WSL, `setup.cmd` and `run.cmd` do the same (they use your
default WSL distribution; set `SDC_WSL_DISTRO` to pick another). If
`localhost:8080` stops answering after several server restarts, WSL's port
relay has gone stale: `wsl --shutdown`, then `run.cmd` again.

## Controls

| Key    | Toggle                                      |
|--------|---------------------------------------------|
| Alt+M  | minimap                                     |
| Alt+L  | monster list (under the minimap)            |
| Alt+S  | stats card                                  |
| Alt+C  | CRT filter: curved → flat → off             |
| Alt+H  | CRT HUD ↔ classic webtiles layout           |
| Alt+P  | 2.5D view on/off                            |
| Alt+O  | settings panel (all options)                |

The same toggles are the icon buttons above the minimap. The settings panel
covers the HUD layout, splash text, CRT filter strength, living tiles, the
2.5D view and the individual effects.

**Touch** (phones and the Android app): tap a tile to travel or attack, swipe
for one step (a long swipe runs), long-press to describe; any tap continues
past `--more--`. Tap the HP/MP pill (top-left) to enlarge it to the full
stats card. Tools (top-right) has the menus, the on-screen keyboard and zoom
(or pinch the dungeon). Tools > Macros defines your own key sequences, each
with an optional emoji in place of its label; pin a macro to keep it on
screen above Explore. Messages appear in a fading bubble; tap it for
the log, and y/n questions get Yes / No buttons.

Long-press your own character for the orb menu: a ring of orbs around you.
Slide (or tap) onto Spells, Evoke or Abilities to fan out your spells,
wands and evokers, or abilities, and lift on one to use it; the other orbs
are your own actions (Pick up, Map, Rest, Look by default). Long-press any
orb in the ring to replace it, or use the + orb to add, move and remove.

Menus get touch layouts too (setting "Mobile menus", on with the mobile UI by
default): full-screen popups with a close button and the key hints as buttons.
Skills are one tappable list (tap = off / on / focus, ◎ sets a training
target, i describes), spells are cards (tap = cast, i = details, power /
range view), character selection is a single grouped list (first tap
previews, Choose picks), the `%` overview is a card sheet (HP/MP bars, stats,
resistance pips, tappable equipment, status chips; "Text view" for the
original), and number prompts get a keypad.

## Building

Everything builds from this checkout; build output and toolchains go to
per-user work directories (never into the checkout), and every location can be
changed with an environment variable.

| Target | Build machine | Script |
|--------|---------------|--------|
| Local webtiles server | Debian/Ubuntu or WSL | `scripts/setup.sh` |
| Linux server package | Debian/Ubuntu or WSL (x86-64 or arm64) | `scripts/setup.sh`, `scripts/package-server.sh` |
| Android APK | x86-64 Debian/Ubuntu or WSL | `scripts/build-android.sh`, `scripts/crossbuild-android.sh` |
| Windows exe | Windows 10/11 + .NET 6+ SDK | `scripts/build-windows.ps1` |
| arm64 Linux server binary | x86-64 Debian/Ubuntu or WSL | `scripts/crossbuild-arm64.sh` |

Environment variables:

| Variable | Default | Used by |
|----------|---------|---------|
| `SDC_BUILD` | `~/sdc-build` | crawl checkout and Linux-side build trees |
| `SDC_CRAWL_REF` | master's head | crawl commit, branch or tag to fetch (`setup.sh`, Windows build) |
| `SDC_MAKE_FLAGS` | (none) | extra `make` flags for `setup.sh`, e.g. `BUILD_LUA=y BUILD_SQLITE=y BUILD_ZLIB=y` |
| `SDC_SKIP_BUILD` | `0` | `1`: `setup.sh` only fetches and patches the sources |
| `SDC_ALLOW_PATCH_FAIL` | `0` | `1`: skip a patch that no longer applies instead of failing |
| `SDC_VERSION_CODE`, `SDC_VERSION_NAME` | `3`, `2.0` | Android version (CI sets them per run) |
| `SDC_JOBS` | all cores | parallel build jobs |
| `DCSS_ANDROID_TOOLS` | `~/android-build` | Android SDK, NDK, Gradle |
| `SDC_PLAYER_RC` | (none) | options file bundled as the APK's starting `player.rc` |
| `SDC_KEYSTORE_FILE`, `SDC_KEYSTORE_PASSWORD`, `SDC_KEY_ALIAS`, `SDC_KEY_PASSWORD` | (none: debug key) | APK release signing |
| `SDC_DIST`, `SDC_VERSION` | `dist/`, `git describe` | output dir and version label of `package-server.sh` |
| `SDC_WIN_ROOT` | `%LOCALAPPDATA%\sdc-build` | Cygwin, sources and staging for the Windows build (a few GB, no spaces in the path) |
| `SDC_DIST` | `dist\` in the checkout | where the Windows exe goes (Windows build) |
| `SDC_WSL_DISTRO` | default distribution | `setup.cmd`, `run.cmd` |
| `SDC_ARM64_SUITE`, `SDC_ARM64_STDCXX` | `trixie`, `libstdc++-14-dev` | Debian release of the arm64 target |
| `SDC_DEPLOY`, `SDC_DEPLOY_DIR` | (none), `sdc-build/crawl/crawl-ref/source` | `crossbuild-arm64.sh ship` target |
| `SDC_SSH`, `SDC_SCP` | `ssh`, `scp` | `crossbuild-arm64.sh ship` (e.g. `ssh.exe`/`scp.exe` from WSL) |

All Linux-side builds start from the crawl checkout that `scripts/setup.sh`
makes, so run it first.

### Local webtiles server

`scripts/setup.sh` installs the build dependencies (apt), shallow-clones
crawl into `$SDC_BUILD/crawl`, applies `patches/` and builds with
`WEBTILES=y`. `scripts/run.sh` copies `overlay/` into the checkout
(`scripts/apply.sh`), creates the autologin user and starts the server.

### Linux server package

```bash
SDC_MAKE_FLAGS="BUILD_LUA=y BUILD_SQLITE=y BUILD_ZLIB=y" bash scripts/setup.sh
bash scripts/package-server.sh   # -> dist/super-dungeon-crawl-server-linux-<arch>.tar.gz
```

The make flags build Lua, SQLite and zlib into the binary, so the package
needs only glibc, libstdc++ and ncurses on the target. It runs on systems with
the build machine's glibc or newer: build on the oldest release you want to
support. Build on an arm64 machine for an arm64 package.

### Android APK

```bash
bash scripts/build-android.sh init        # one time: JDK 17, QEMU, Android SDK, Gradle
bash scripts/crossbuild-android.sh build  # NDK, ncurses, crawl, bundled game data (~10 min)
bash scripts/build-android.sh build       # -> dist/super-dungeon-crawl.apk
```

After client-only changes (JS/CSS), `crossbuild-android.sh stage` re-stages
the client and game data before `build-android.sh build`. Crawl's level and
database caches are precompiled under QEMU so the first start on the phone is
quick. Without the `SDC_KEYSTORE_*` variables the APK is signed with the
Android debug key; use your own keystore for anything you distribute (an
installed APK only accepts updates signed with the same key).

How it works: `LocalServer.java` stands in for the webtiles server, serving
the client on `127.0.0.1` and running crawl through
`android/native/crawlhost.c`, which gives crawl a pty and relays its webtiles
socket.

### Windows exe

In PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1 all       # everything
```

or step by step:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1 init      # one time: Cygwin + deps
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1 build     # crawl, crawlhost, stage (~15 min)
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1 launcher  # launcher exe
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1 package   # -> dist\super-dungeon-crawl.exe
```

After client-only changes, run `stage` then `package`. Crawl has no native
Windows webtiles port, so `crawl.exe` and `crawlhost.exe` (the same
`crawlhost.c`) are Cygwin builds; the exe carries the Cygwin DLLs and the
terminfo entry crawl needs. `windows/` is the C# launcher, which serves the
client on `127.0.0.1:47268`, like the Android app. Without the WebView2 runtime
it falls back to an Edge/Chrome `--app` window.

### arm64 Linux server

To host the webtiles server on an arm64 machine (for example a single-board
computer), either run `scripts/setup.sh` on it (slow: up to an hour on a small
board), or cross-build the binary on an x86-64 machine in a few minutes:

```bash
bash scripts/crossbuild-arm64.sh init     # one time: cross toolchain, QEMU, arm64 sysroot
bash scripts/crossbuild-arm64.sh build    # -> $SDC_BUILD/crawl-arm64/crawl-ref/source/crawl
SDC_DEPLOY=user@host bash scripts/crossbuild-arm64.sh ship   # copy as crawl.new
```

The server needs a checkout made by `setup.sh` (for the game data and
webserver). `ship` copies the binary next to its `crawl` as `crawl.new`; swap
it in when no game is running. Set `SDC_ARM64_SUITE` (and `SDC_ARM64_STDCXX`)
if the server runs a Debian release other than trixie. Client-only updates
need no new binary: `scripts/apply.sh` on the server.

### GitHub Actions

`.github/workflows/ci.yml` checks every push (JS/Python syntax, shellcheck,
the patches and client hooks against upstream crawl, the Android Java).

`.github/workflows/release.yml` builds everything from one pinned crawl commit:
the server packages (x86-64 on `ubuntu-22.04`, arm64 on `ubuntu-22.04-arm`),
the APK and the Windows exe.

- Push a tag `v*` (for example `git tag v2.0.0 && git push origin v2.0.0`) to
  build and publish a GitHub Release with all four files.
- Run it by hand from the Actions tab to get the files as workflow artifacts
  only; the `crawl_ref` input picks a crawl commit, branch or tag.
- For a stable Android signing key, add the repository secrets
  `ANDROID_KEYSTORE_BASE64` (base64 of a `.jks` file),
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`.
  Without them each release is signed with a throwaway debug key, and players
  must uninstall the app before installing a newer release (export the save
  first).

Make a keystore once with
`keytool -genkeypair -keystore release.jks -alias sdc -keyalg RSA -keysize 4096 -validity 10000`
and keep it safe: losing it means future releases can't update existing
installs.

## Crawl patches

Every build applies every `patches/*.patch` through `scripts/apply_patches.sh`
(idempotently). A patch that no longer applies to the chosen crawl commit
stops the build; `SDC_ALLOW_PATCH_FAIL=1` builds without it instead.

- `damage-numbers.patch` (`attack.cc`): melee and missile attack messages
  carry the damage dealt ("You hit the goblin for 7!"); the client shows it as
  damage numbers.
- `spell-damage-numbers.patch` (`beam.cc`): the same for spell and beam hits
  ("The bolt of fire hits the goblin for 12!"). `spellfx.js` gives every
  element its own number style and motion. Without the patch the spell still
  animates, with an element word instead of the number.
- `webtiles-abilities.patch` (`tileweb.cc/.h`): the webtiles `player` message
  gets an `abilities` field (the god invocations of the `a` menu), which the
  quick-use bar shows as a group in front of the item slots.
- `webtiles-spells.patch` (`tileweb.cc/.h`): the `player` message also gets
  `spells` (memorised spells with letter, MP, fail %), `talents` (every
  ability) and `evokables` (evocable inventory items), for the mobile orb
  menu. Without it the orb menu falls back to the stock `z` / `a` / `V` menus.

To revert them, `git checkout` those files in `$SDC_BUILD/crawl` and rebuild.

## Security notes

- The bundled `overlay/webserver/config.yml` logs everyone in as `player`
  with no password. It is for a single-user local install only (from source it
  listens on all interfaces inside WSL, which only this PC can reach; the
  server package listens on loopback unless you change it). Anyone who can
  reach the port plays as `player`, so never open it on a public or shared
  network. To host for other people, use `overlay/webserver/config.public.yml`
  (real accounts, loopback bind) behind an HTTPS reverse proxy.
- The Android app and the Windows exe serve the game on loopback
  (`127.0.0.1`), which other apps on the device and web pages in a browser
  can also reach. So every launch makes a random token: the page URL carries
  it, `index.html` is only served with it, and the game's WebSocket needs it
  plus a loopback `Host` and `Origin` header. Other pages, apps and DNS
  rebinding get a 403. Message sizes are capped.
- The Android app allows plain http only to loopback and navigates nowhere
  else. WebView remote debugging (`chrome://inspect`) is off unless the APK
  is built debuggable (`-PsdcDebug` on the Gradle command line).
- Build downloads are checked: the Android command-line tools, Gradle and
  ncurses against pinned SHA-256 checksums, the Cygwin installer against its
  checksum and Authenticode signature. GitHub Actions are pinned to commit
  hashes (Dependabot proposes updates).

## Development

```
overlay/                      copied over crawl-ref/source/
  webserver/config.yml        local server overrides (autologin, port)
  webserver/game_data/static/
    crt.js                    core: HUD, WebGL CRT shader, hotkeys, settings panel
    sdc_api.js                shared settings / option registry / event bus
    fxkit.js                  shared helpers for the effect modules
    crt.css                   phosphor theme, HUD panels (@imports the rest)
    light.js, alive.js, depth.js   lighting, living tiles, 2.5D data for the shader
    mobile.js/.css            mobile/touch layout
    (+ bars, stats, toolbar, quickbar, crt_splash and the *fx effect modules)
  webserver/static/
    sdc_title.png, sdc_loader.css   loading screen (title art + progress bar)
patches/                      crawl source patches
scripts/
  setup.sh, run.sh, apply.sh  local server: build, start, apply the client
  fetch_crawl.sh              shallow crawl checkout at SDC_CRAWL_REF
  apply_patches.sh            patches/ into a crawl checkout (every build)
  stage_client.sh             client + game data for the Android / Windows builds
  package-server.sh           Linux server tarball
  patch_client.py             hooks crt.js into game.js / game.html, loader into client.html
  ensure_user.py              creates the autologin user
  deploy-static.sh            copy changed static files into the checkout
  build-android.sh            Android toolchain + APK
  crossbuild-android.sh       crawl for Android (NDK) + bundled game data
  build-windows.ps1           Windows standalone: Cygwin, launcher, one-exe package
  cygbuild-windows.sh         the Cygwin side of the Windows build
  crossbuild-arm64.sh         crawl for arm64 Linux servers
android/                      fullscreen WebView app (Java, no dependencies)
  native/crawlhost.c          runs crawl in a pty and relays its webtiles socket
  native/render_client.py     renders client.html for the bundled client
windows/                      launcher exe for the Windows standalone (C#)
```

Feature modules talk to each other only through `sdc_api.js` (options, events,
commands). For live testing against a running local server, copy changed
static files into the checkout with `scripts/deploy-static.sh <file>...` and
reload the page; no server restart is needed. Most effect modules have a
browser console helper of the form `sdc_<module>_test("name")`, for example
`sdc_wandfx_test("polymorph")` or `sdc_rangedfx_test("cannon")`.

`patch_client.py` makes a few asserted string edits to `game.js` (so the
dungeon can use the full width) and `game.html` (the stylesheet link). If an
upstream update moves that code, it stops with a clear error instead of
producing a half-broken client.

## License

GPL-2.0-or-later, like DCSS itself. See [LICENSE](LICENSE) and
[NOTICE](NOTICE) for third-party components.
