# Changelog

## Unreleased

### Added
- Windows standalone: one self-contained `super-dungeon-crawl.exe` (C# launcher
  with WebView2, Cygwin crawl and crawlhost). See `scripts/build-windows.ps1`
  and the README.
- Uskayaw Grand Finale spotlight is made of light-map emitters, through the new
  `api.light_extra` hook.

### Changed
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
