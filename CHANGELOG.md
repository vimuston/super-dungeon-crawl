# Changelog

## v1.1.0 (2026-11-06)

### Added
- Orb menu (mobile): long-press your character for a ring of orbs. Spells,
  Evoke and Abilities fan out your spells, evocable items and abilities (slide
  or tap, lift to use); the other orbs are your own actions. Long-press an orb
  in the ring to replace it; the + orb adds, moves and removes them.
- `webtiles-spells.patch`: the `player` message carries `spells`, `talents`
  (every ability) and `evokables` for the orb menu.
- Touch-first layouts for crawl's menus (skills, spells, character selection,
  the `%` sheet, number keypad) and mobile macros.
- Loading screen with the title art and a progress bar.
- `api.hold`: modules can claim a mobile long-press before the stock describe.

### Changed
- Stats & HP always sit top-left and the quick-use bar always bottom centre
  with its names; the orb menu is always on. The four settings are gone.
- The Interface and Mobile settings are one "Interface" tab.

## v1.0.0 (2026-11-05)

### Added
- Windows standalone: one self-contained `super-dungeon-crawl.exe` (C# launcher
  with WebView2, Cygwin crawl and crawlhost). See `scripts/build-windows.ps1`
  and the README.
- Uskayaw Grand Finale spotlight is made of light-map emitters, through the new
  `api.light_extra` hook.
- Ranged firing feel (`rangedfx.js`): bow draw and release, crossbow thunk,
  hand-cannon recoil, sling whirl and throw lunges on your character, tinted by
  brand. The sprite moves through alive.js's new `player_kick` event.
- GitHub Actions release builds (`release.yml`): Windows exe, Android APK and
  Linux server packages (x86-64, arm64) from one pinned crawl commit.
- `fxkit.on_merge`, `fxkit.spawn`, `fxkit.nearest_monster`, `fxkit.brand_of`,
  `api.warn` and `api.reduced_motion`: shared helpers for the effect modules.

### Security
- The Android app's and Windows exe's loopback servers require a per-launch
  token in the page URL and a loopback `Host`/`Origin` on the WebSocket, so
  other apps and web pages can't drive the game; WebSocket messages and header
  lines are size-capped.
- The server package listens on loopback by default and no longer overwrites
  `config.yml` on update.
- Pinned checksums for the build downloads (Android tools, Gradle, ncurses,
  Cygwin installer + signature) and commit-pinned GitHub Actions.

### Changed
- One message-log observer (fxkit) and one `map_knowledge.merge` wrapper for
  all effect modules, instead of one per module.
- All builds share `apply_patches.sh` (a patch that no longer applies now stops
  every build alike) and the standalone builds share `stage_client.sh`.
- The Android app is local-only (no server mode); its version code grows with
  every CI build.
- `setup.sh` no longer installs SDL, FreeType or fonts (local-tiles only).
- Effects follow the 2.5D view: `api.depth_map` maps map positions through the
  view's rotation, keystone and zoom, and `fxkit.anchor_of` uses it. Summons,
  coins and marks now stay on their tiles.
- Berserk covers the whole screen, remembered map and unexplored dark included,
  and is gentler: less contrast, a lighter vignette, less chromatic smear. The
  game's own line-of-sight-only red flash is suppressed.
- Uskayaw Stomp is a short screen shake instead of floor pulses.
- Damage numbers mode no longer shows onomatopoeia when the damage is unknown.

### Removed
- Statue form, Tremorstone and Condenser Vane effects.
- Uskayaw Line Pass effect.
- The settings fallback to the pre-rename `dcss-crt-settings` storage key, and
  the empty `beamfx.css`.

## 2026-11 effects update (ba8fd8e)

- Gozag coins: instant on kill, shorter, glimmering, follow the tile, and work
  for Orb of Destruction kills.
- Silence is a soft round purple light-map aura (like the Shining One halo).
- Ozo's Armour is an icy glow with frost twinkles on the player tile.
- Summon effects follow the summoned creature.
- Branded weapons: an element effect on the target, and damage numbers in the
  element's colour with a gold underline.
- Damage numbers land on the right monster among similar ones; axe cleave
  shows every hit.
- Scroll overlays only fire when a scroll is read. Call Merchant and Bribe
  Branch triggers fixed.
- Removed beam streaks (only the Orb of Destruction trail stays), fire storm
  scorch decals, Gell's gravitambourine and phial of floods overlays.

## 2026-10 effects pack (1d4d497)

- New modules: status auras (haste, slow, invisibility, Ozo, Death's Door,
  Sublimation of Blood), summon circles and necromancy wisps, terrain effects
  (passwall, apportation, digging), wand marks, scroll, potion and rune
  effects, HP/MP bar pulses, and effects for 20+ gods.
- Shared `fxkit` and the `api.grade` screen-grade channel.

## Earlier

- Renamed to Super Dungeon Crawl (543c3b7).
- Android app with offline on-device crawl and save import/export (02e2160).
- Mobile touch layout (c3f7bb1).
