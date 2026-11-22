# Changelog

## v1.6.2 (2026-11-22)

A small fix release for phone play. The explored map is readable again,
targeting Confirm / Cancel works with the thumbstick, Drop is in the menus, and
the spell Learn tab says why there's nothing to learn.

### Fixed
- The remembered map is readable again. Explored ground outside your sight was
  darkened, tinted blue and fogged on top of crawl's own dimming, which left it
  nearly black on a zoomed-out phone. It now looks like stock crawl's
  remembered map; the lantern-lit view and the warm rim at the edge of sight
  stay. ([#81](https://github.com/vimuston/super-dungeon-crawl/issues/81))
- Confirm / Cancel stay up while you aim with the thumbstick. Aiming a wand of
  digging, Phantom Mirror and other targeted actions could hide the buttons,
  and Confirm could look like it cancelled.
  ([#92](https://github.com/vimuston/super-dungeon-crawl/issues/92))
- Learn explains an empty spell library: once you know every spell in it,
  Learn shows crawl's reason under the tabs instead of closing the list.
  ([#93](https://github.com/vimuston/super-dungeon-crawl/issues/93))
- Drop sits next to Pick up in the Tools menu and can be added to the orb menu.
  Switching category in the drop or inventory menu after scrolling a long list
  no longer throws an error.
  ([#97](https://github.com/vimuston/super-dungeon-crawl/issues/97))

## v1.6.1 (2026-11-22)

A small fix release. Chain Lightning looks like chain lightning, torches go out
on walls you freeze, and god descriptions fit on a phone screen.

### Fixed
- Chain Lightning arcs from you to the nearest monster and then on to monsters
  next to each one it hits, instead of bolts dropping from the top of the
  screen. Electric damage numbers crackle with small arcs around the target.
- A torch on a wall iced over by Frozen Ramparts goes dark and frosts over
  instead of flickering for the whole spell.
- God descriptions, powers and wrath text no longer run off the right edge of
  a phone screen.

## v1.6.0 (2026-11-22)

More control on phones. You can move with a thumbstick, hide the buttons you
don't use, buy several shop items at once, and see your Doom and weapon damage
on the stats card. Poison clouds no longer drown out the monsters inside them.

### Added
- Thumbstick movement (Interface > Mobile): a swipe moves you one step in any
  of 8 directions. A d-pad appears where your finger lands and lights up the
  direction; change direction until you lift, slide back to the centre to
  cancel. With the option off, swipes no longer move your character.
- Settings to hide the Fight button, the Explore button and the quick-use bar.
  Hiding Fight or Explore gives the quick-use bar the extra room.
- Buy several shop items at once: tap Buy on one item, then on another without
  answering, and the game asks again with the new total. Marked items get an
  Unmark button.
- The stats card shows your Doom level, each carried weapon's damage and your
  attack delay.

### Changed
- Going to a shop from the shopping list walks you into the shop, not just onto
  its square.
- A faded altar that could belong to several gods shows a button for each god
  (tap to read about them), plus Pray and Cancel.

### Fixed
- Monsters inside a poison cloud or any other big cloud are readable again;
  the cloud's glow no longer washes them out.
- Berserk's red screen, embers and shaking stop when the rage ends, not after
  the cooldown.
- Reading a scroll of blinking shows the blink effect, even for a short jump.
- Taps work again: in 1.5.0, tapping a blink target cancelled the scroll,
  swipes didn't move you and tapping didn't answer --more--.

## v1.5.0 (2026-11-14)

A bigger update for phones. The lobby is new, macro buttons can show game
tiles, abilities can be pinned, and tapping anything on the character sheet
tells you what it does. Invisibility finally looks like invisibility.

### Added
- New lobby that fits phones and desktops. Each game is a card that shows
  whether you can Continue, start New, or whether the slot is full or in play.
- Game tiles on macro buttons: a tile picker with categories (actions, your
  spells and abilities, skills, weapons, armour, items, dungeon features,
  mutations and more), a search box and a button preview. Old emoji macros
  keep their emoji.
- Pin abilities: every ability in the ability menu (`a`) has a Pin button, like
  spells. Pins sit with your macros and belong to the character that made them.
- Tap any passive effect, status or mutation on the character sheet (`%`) to
  read what it does; mutations also show your level and what it gives.
- Invisibility: your character is faint and shimmers like heat haze instead of
  the old blinking square, and flickers when invisibility falters.

### Changed
- The ability menu has Use ability and Describe ability buttons instead of one
  cut-off toggle.
- Picking a blink target highlights the squares you can land on; a tap
  elsewhere buzzes and keeps the prompt open instead of wasting the scroll.

### Fixed
- Aim and confirm prompts get Confirm and Cancel buttons (before, a phone had
  no way to confirm, e.g. quaffing invisibility with monsters in view).
- The level-up stat picker stays on screen until you choose.
- Tapping yourself on a transporter uses it instead of trying to pick up.
- Android: ghosts work. The app never saved or loaded ghost files.
- The character sheet no longer drops mutations that wrap onto a second line.
- On phones, water and other living tiles no longer start to stutter a few
  minutes into a game.
- Android: no more stray error pop-ups when opening the character sheet,
  scrolling, or before your first tap.

## v1.4.0 (2026-11-12)

A smaller update. More god powers work by touch, Find works on phones again,
and big monsters look right next to walls in 2.5D.

### Added
- Big buttons for lettered choices in the message area: Gozag's Call Merchant
  and Potion Petition (with prices; unaffordable ones dimmed), Nemelex's Draw
  Three (with a button to read about the cards), ally orders, and choosing
  your ancestor's gender for Hepliaklqana.
- A typing dialog for text prompts (such as naming your ancestor) with
  Keyboard, Clear, Cancel and OK buttons.

### Changed
- Macros stay when you start a new character. Pinned spells still belong to
  the character that pinned them.

### Fixed
- Find (Tools menu) works again. It used to give up without searching, and
  sometimes typed your search as game commands.
- Two-tile monsters (Pandemonium lords, hell lords, the Lernaean hydra) no
  longer look broken next to walls in 2.5D, and move as one with Living tiles.
- In 2.5D, your character's head is no longer smeared up the wall behind you.

## v1.3.0 (2026-11-11)

Mostly about playing on a phone: shops, altars and the shopping list work by
touch, the most used menus are one tap away, and the quick-use bar no longer
uses things by accident.

### Added
- Shops by touch: each item gets a card with its price (in a different colour
  when you can't afford it); tap to buy, read about it or add it to your
  shopping list. Stand on a shop and tap your character to enter.
- Shopping list in the Tools menu; tap an entry to travel to that shop or read
  about the item.
- Altars by touch: stand on an altar and tap your character to kneel. The god's
  page has Overview, Powers and Wrath tabs and a Join button that shows any
  gold the god asks for.
- Items, Spells and Skills buttons in the top-right corner. The Spells menu has
  Known and Learn tabs; pin a spell for a one-tap cast button.
- Red arrows at the screen edge point to hostile monsters in sight but off
  screen or behind the HUD (can be turned off).
- Tap twice to use quick-use items: the first tap picks, the second uses. On by
  default.
- Setting to auto-pick up armour for empty slots, optionally including shields
  and body armour.
- Setting to lock the 2.5D camera rotation (zoom still works).
- Auto-explore speed slider.

### Changed
- Tap the HP/MP bars for your full stats, tap again for the character sheet.
- The Tools menu is shorter, better ordered and has the shopping list.
- Zoom and rotation are gesture-only (pinch and twist on a phone, middle mouse
  drag on a computer); their sliders are gone.
- New players start with the CRT filter off, the camera straight on and the
  turn counter showing your speed.
- On a computer, the phone layout only turns on when you choose it.
- The skills screen picks its column view with one button that cycles views.

### Fixed
- The quick-use bar can use the items at its far right: slide along the bar
  and lift on the item you want.
- Shop purchases and other yes/no questions get Yes and No buttons.
- A new character starts without the previous character's macros and pinned
  spells.
- With the CRT filter off, the screen no longer flickers or shows grain.
- Tall sprite parts (weapons, helmets, big monsters) no longer stretch up
  walls in 2.5D.
- The message log's close button is on the log, with smaller text on phones.
- Android: Save and Quit closes the app, and settings and macros are kept
  between launches.
- The phone layout never shows the desktop toolbar, and Tools and crawl's own
  menus can't be open at the same time.

## v1.2.2 (2026-11-10)

### Fixed
- The quick-use bar is cropped between the Fight and Explore buttons on phones.

### Changed
- The README leads with spell effects and the mobile layout.

## v1.2.1 (2026-11-06)

### Fixed
- Turning the CRT filter off keeps 2.5D and the effects, and the 2.5D view uses
  real perspective.

## v1.2.0 (2026-11-06)

### Added
- Empty equipment slots in the `%` sheet (mobile).
- Stairs finders on the map; tap yourself to take stairs.
- Touch layout for innate abilities (`A`) and a Tools button for them.

### Changed
- The quick-use bar sits at the very bottom and the message bubble bottom-left.
- The mobile Zoom buttons are gone.

### Fixed
- Tap the map to travel to a Find result.
- Uppercase-only confirms get proper Yes / No buttons.
- Effects follow mobile zoom and 2.5D rotation.

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
- Unexplored edge (`fogedge.js`): soft, blurred dark tendrils curl and sway
  along the border between explored ground and never-seen black.
- `api.hold`: modules can claim a mobile long-press before the stock describe.

### Changed
- HP/MP bars look like Afterglow's terminal bars: 10 glowing block cells with
  damage trails, poison and drained-max cells, and a low-HP flicker.
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
