// Living tiles: every tile in view gets a little motion that comes from what
// it is and what is happening, done entirely as tiny (<= ~1.5 px) per-pixel
// sample displacement in the CRT shader (crt.js FRAG, alive()). No art, no
// per-sprite CPU work: this module only builds a cols x rows RGBA data
// texture (one texel per visible cell) when the map changes, plus a handful
// of uniforms each frame.
//
// What moves, and what drives it
//   Creatures breathe: a heave about the feet (chest widens, head rises).
//     asleep          slow, deep breaths, with an occasional deeper sigh
//     unaware         relaxed breathing
//     awake hostile   quick, shallow, tense; deeper for tougher threats and
//                     quicker after a shout/roar is heard ("startle")
//     ally            breathes in step with you
//     neutral         slow and calm
//     fleeing         rapid panting plus a fine tremble
//     paralysed/caught/netted/webbed: perfectly still (even in water)
//     wounded (monster damage pips) slower, with a weary sideways sway
//     big monsters    slower, heavier
//     flying          a gentle hover bob
//     wading/swimming bobs with the water swell under it
//   Body plans change that: plants sway in the wind instead of breathing;
//   statues/golems/turrets are still; corporeal undead do not breathe but
//   lurch now and then; ghosts and wraiths float; jellies and oozes jiggle;
//   vortices and elementals swirl; snakes, eels and tentacles slither;
//   insects, spiders and rats skitter in short twitchy bursts.
//   Every 20-40 s a random awake creature in view glances aside.
//   You: breathing follows HP (calm and deep at full health, shallower and
//     quicker as it drops); under half HP a lub-dub heartbeat pulse; you lean
//     a hair toward the nearest awake hostile; haste quickens and slow slows
//     the rhythm; berserk heaves with a tremor; confusion sways; poison
//     gives a queasy shimmer and a faint green pallor; paralysed = still.
//   Environment
//     water           travelling ripples with soft caustic glints (deep
//                     water: slower, larger swell)
//     lava            slow convection heave and crust brightening; heat
//                     haze shimmers above lava, fire and flame clouds and
//                     rises into the cell above
//     trees           sway in a wind whose gusts travel across the level as
//                     visible bands; grass/moss nods; open doors stir
//     torches, fiery features, fire clouds: flames lick and flicker
//     crystal and ice walls: slow refraction plus a light sweep every ~25 s
//     frozen ramparts walls under the spell drift with pale frost sheets, a
//                     cold light sweep and twinkling ice crystals
//     stairs down     slow inward pull; stairs up / exits: slow swell;
//     portals/gates/teleporters/conduits: slow swirl; altars: slow glow
//     fountains       concentric rings; toxic bog/mud: bubbles
//     gold and gems   a star glint now and then (gems rarer, colder)
//     potions slosh; scrolls/books flutter in gusts; fresh corpses get a fly
//     clouds          drift with the wind; cold clouds shimmer
//   Events: being hit sends a shock ring out from you (size ~ damage/max
//   HP); walking through water leaves rings; blink/teleport arrival pops a
//   ring; level-up rolls a broad, bright shimmer wave; arriving on a new
//   level a settling wave; a monster taking
//   a hit gets a small impact ring; explosions/crashes/rumbles in the
//   message log shake the view slightly.
//   Branch mood: the Temple is calm and slow; Lair/Swamp/Shoals/Ice Cave are
//   windy; the Crypt/Tomb are hushed; hells are unsettled (heat shimmer);
//   in the Slime Pits the walls ooze; the Abyss slowly breathes as a whole
//   and Pandemonium a little.
//   Cells outside line of sight (remembered map) do not move.
//
// Data texture (uploaded only when the map changes; NEAREST, no flip, row 0 =
// top row of the view): R = material, G = creature state | spill << 4 (how
// far the sprite reaches into the cell above, 15ths of a cell), B = creature
// params (damage 0-4 | threat << 3 | big << 6 | flying << 7),
// A = item/cloud class | body plan << 4.
//
// Off (setting "alive"), the map view, no WebGL, or prefers-reduced-motion:
// the source returns null and crt.js sets u_alive_amt = 0 (shader skips it).
//
// Debug (browser console):
//   sdc_alive_debug.classes()          class names (and counts in view)
//   sdc_alive_debug.cell(x, y)         decoded texel at map coords
//   sdc_alive_debug.force("lava", x, y) force a class at a cell (any
//                                        material / item / body plan /
//                                        state name; omit x,y = player)
//   sdc_alive_debug.ripple(x, y, s)    ripple at map coords, strength s
//   sdc_alive_debug.clear()            remove forced cells
//   sdc_alive_debug.stats()            timings and current parameters
define(["jquery", "./sdc_api", "./map_knowledge", "./dungeon_renderer",
        "./enums", "./player", "./tileinfo-dngn", "./tileinfo-main",
        "./tileinfo-player", "./tileinfo-wall", "./fxkit"],
function ($, api, map_knowledge, dungeon_renderer, enums, player,
          dngn, main, tileinfo_player, wall, kit) {
    "use strict";

    // Tuning ----------------------------------------------------------------
    // master strength: scales every displacement (a tile-relative offset;
    // 1.0 was under a pixel for most motions, i.e. invisible). Live tuning:
    // sdc_alive_debug.strength(n)
    var STRENGTH = 3.0;
    var AMP = {                 // per-effect multipliers (shader u_alive_amp*)
        creatures: 1.0,         // breathing, body plans, twitches
        liquids:   1.0,         // water, lava, bog, fountains, clouds
        wind:      1.0,         // trees, grass, plants, doors, paper
        flames:    1.0,         // torches, fire, heat haze
        magic:     1.0,         // stairs, portals, altars, crystal
        glints:    1.0,         // gold/gem stars, flies, potion slosh
        ripples:   1.0,         // event rings / waves / quake
        player:    1.0,         // your own breathing / heartbeat / lean
    };
    var TWITCH_MIN = 20, TWITCH_MAX = 40;   // s between creature glances
    var RIPPLE_LIFE = 3.0;                  // s
    var REBUILD_MS = 2000;                  // safety rebuild interval
    var MSG_GRACE = 1500;                   // ms after game_init

    api.register_option({ key: "alive", label: "Living tiles", default: true,
                          choices: [[true, "On"], [false, "Off"]] });

    var UNSEEN_BITS = 0x00020000 | 0x00040000;  // MM_UNSEEN | UNSEEN

    // Classes ---------------------------------------------------------------
    var MAT_NAMES = ["none", "shallow", "deep", "lava", "tree", "torch", "fire",
                     "crystal", "wall", "door", "down", "up", "portal", "altar",
                     "fountain", "bog", "grass", "door_shut", "frozen",
                     "verdant"];
    var ITEM_NAMES = ["none", "gold", "gem", "potion", "paper", "corpse",
                      "cloud", "cloud_fire", "cloud_cold"];
    var KIND_NAMES = ["normal", "plant", "still", "undead", "ghost", "ooze",
                      "swirl", "serpent", "skitter"];
    var STATE_NAMES = ["empty", "asleep", "hostile", "ally", "neutral",
                       "fleeing", "held", "player", "unaware"];
    function ids(names)
    {
        var o = {};
        names.forEach(function (n, i) { o[n.toUpperCase()] = i; });
        return o;
    }
    var M = ids(MAT_NAMES), I = ids(ITEM_NAMES), K = ids(KIND_NAMES),
        S = ids(STATE_NAMES);

    function tok(list)
    {
        return new RegExp("(^|_)(" + list + ")(_|$)");
    }

    // dungeon feature / floor / wall names -> material (first match wins)
    var MAT_RULES = [
        [/_GONE$|_EXPIRED$|_INACTIVE$|DRY_FOUNTAIN|PETRIFIED_TREE|ZOT_CLOSED|SEALED_STAIRS|VAULTS_CLOSED/, 0],
        [/^(DNGN_SHALLOW_WATER|SHOALS_SHALLOW_WATER|DNGN_WAVE_|WAVE_(N|S|E|W|CORNER)|MURKY_WAVE|SHORE_)/, M.SHALLOW],
        [/^(DNGN_DEEP_WATER|SHOALS_DEEP_WATER|DNGN_OPEN_SEA|WAVE_DEEP|DNGN_STARWATER)/, M.DEEP],
        [/^DNGN_LAVA/, M.LAVA],
        [/TORCH/, M.TORCH],
        [/^(FIERY_CONDUIT|DNGN_DRAGON_VEIN_FIRE)/, M.FIRE],
        [/^DNGN_(ALTAR_|UNKNOWN_ALTAR)/, M.ALTAR],
        [/FOUNTAIN/, M.FOUNTAIN],
        [/^DNGN_(ENTER_(ABYSS|PANDEMONIUM|HELL|GEHENNA|COCYTUS|DIS|TARTARUS|ZOT_OPEN)|EXIT_(ABYSS|PANDEMONIUM)|TRANSIT_PANDEMONIUM|PORTAL|STARRY_PORTAL|TELEPORTER|TRANSPORTER|UNKNOWN_PORTAL|RUNELIGHT|BINDING_SIGIL|DIMENSION_EDGE|TRAP_TELEPORT|TRAP_GOLUBRIA|ABYSSAL_STAIR)|CONDUIT$/, M.PORTAL],
        [/STAIRS_DOWN|ESCAPE_HATCH_DOWN|^DNGN_ENTER(_|$)|^DNGN_TRAP_SHAFT/, M.DOWN],
        [/STAIRS_UP|ESCAPE_HATCH_UP|^DNGN_EXIT_|^DNGN_RETURN/, M.UP],
        [/^DNGN_(OPEN_(CLEAR_)?DOOR|BROKEN_(CLEAR_)?DOOR|V?GATE_(OPEN|BROKEN))/, M.DOOR],
        [/^DNGN_((CLOSED|RUNED|SEALED)_(CLEAR_)?DOOR|V?GATE_(CLOSED|RUNED|SEALED))/, M.DOOR_SHUT],
        [/^(DNGN_CRYSTAL|CRYSTAL_WALL|WALL_CRYSTAL|WALL_DEPTHS_CRYSTAL|WALL_VAULTS_CRYSTAL|WALL_ICE|WALL_ICY|DNGN_WALL_FRIGID|DNGN_WALL_ICY|FLOOR_ICE|DNGN_ICE_THORNS|WALL_EMERALD|DNGN_TRANSPARENT_WALL|DNGN_MIRROR_WALL)/, M.CRYSTAL],
        [/^(DNGN_TREE|DNGN_MANGROVE|DNGN_DEMONIC_TREE|DNGN_DEAD_TREE)/, M.TREE],
        [/^(DNGN_TOXIC_BOG|FLOOR_MUD|LIQUEFACTION)/, M.BOG],
        [/^(FLOOR_GRASS|FLOOR_NECROPOLIS_(SQUARE_)?GRASS|FLOOR_MOSS|FLOOR_VINES|FLOOR_SPROUTING|DNGN_FLOWER_PATCH|DNGN_GARDEN_PATCH|HALO_GRASS)/, M.GRASS],
        [/^FLOOR_LAIR/, M.VERDANT],
        [/^(WALL_|STONE_WALL|ROCK_WALL|METAL_WALL|DNGN_STONE_(WALL|DARK)|DNGN_METAL_(WALL|IRON|ZOT|STEEL)|DNGN_TRANSPARENT_STONE|DNGN_SILVER_WALL|CLEAR_PERMAROCK|SLIMY_TRANSPARENT|DNGN_GRATE|DNGN_WALL_SHADOW|DNGN_FIRST_TRANSPARENT)/, M.WALL],
    ];

    // item / cloud names (main tiles) -> item class
    var ITEM_RULES = [
        [/^GOLD/, I.GOLD],
        [/^(GEM_|RUNE_|UNCOLLECTED_RUNE|ORB$|UNCOLLECTED_ORB|MISC_CRYSTAL_BALL)/, I.GEM],
        [/^(POT_|POTION)/, I.POTION],
        [/^(SCR_|SCROLL|BOOK|PARCHMENT)/, I.PAPER],
        [/^(CORPSE_|FOOD_CHUNK)/, I.CORPSE],
        [/^CLOUD_(FIRE|FOREST_FIRE|FLAME|BLASTMOTES)/, I.CLOUD_FIRE],
        [/^CLOUD_(COLD|FAINT_FROST|FREEZING_WINDS)/, I.CLOUD_COLD],
        [/^CLOUD_/, I.CLOUD],
    ];

    // monster names (without MONS_) -> body plan
    var KIND_RULES = [
        [/VINE_STALKER/, K.NORMAL],
        [/^(SPECTRAL_WEAPON|DANCING_WEAPON|ORB_OF_|BALL_LIGHTNING)/, K.SWIRL],
        [/^(BOULDER$|BLOCK_OF_ICE|CRYSTAL_GUARDIAN|ORB_GUARDIAN_FETUS|TEST_)/, K.STILL],
        [tok("STATUE|PILLAR|DUMMY|GOLEM|TURRET|SENTINEL|PRISM|BATTLESPHERE|SERVITOR|TOME|MORTAR|SPIRE|CONDUIT|IDOL"), K.STILL],
        [tok("ZOMBIE|SKELETON|SKELETAL|MUMMY|LICH|GHOUL|NECROPHAGE|BOG_BODY|SIMULACRUM|SKULL|REVENANT|DRAUGR|VAMPIRE|JIANGSHI|BONE_DRAGON|DEATH_KNIGHT|SOULMONGER"), K.UNDEAD],
        [tok("PLANT|BUSH|FUNGUS|TOADSTOOL|BALLISTOMYCETE|OKLOB|BRIAR_PATCH|VINE|TREANT|MOLD|MOULD|LICHEN|SNAPLASHER|STARFLOWER|MUSHROOM"), K.PLANT],
        [tok("GHOST|WRAITH|PHANTOM|SPECTRAL|SPECTRE|SHADE|SOUL|WISP|POLTERGEIST|EIDOLON|PHANTASMAL|APPARITION"), K.GHOST],
        [tok("JELLY|OOZE|BLOB|SLIME|PUDDING|ROCKSLIME|JELLYFISH|SLUDGEFISH|SLUDGE"), K.OOZE],
        [tok("VORTEX|TWISTER|ELEMENTAL|WELLSPRING|FOXFIRE|SPELLSPARK|EMBER"), K.SWIRL],
        [tok("SNAKE|ADDER|MAMBA|PYTHON|ANACONDA|NAGA|NAGARAJA|EEL|SERPENT|MOCCASIN|LINDWURM|WORM|WURM|TENTACLE|KRAKEN|LEECH"), K.SERPENT],
        [tok("SPIDER|BEE|WASP|HORNET|SCORPION|BEETLE|ANT|ROACH|RADROACH|CLOCKROACH|CENTIPEDE|CRAB|MOSQUITO|SCARAB|TARANTELLA|REDBACK|JOROGUMO|BROODMOTHER|ARACHNE|MOTH|BUTTERFLY|RAT|FLY|FROG|TOAD"), K.SKITTER],
    ];
    var BIG_RE = tok("DRAGON|GIANT|TITAN|HYDRA|JUGGERNAUT|ELEPHANT|HELLEPHANT|MAMMOTH|LEVIATHAN|BEHEMOTH|CYCLOPS|ETTIN|SEISMOSAURUS|MOUNTAINSHELL|COLOSSUS|ANCIENT_CHAMPION|KRAKEN|LINDWURM");

    function first(rules, name)
    {
        for (var i = 0; i < rules.length; i++)
            if (rules[i][0].test(name)) return rules[i][1];
        return 0;
    }

    var mat_of = null, itm_of = null, kind_of = null;

    function classify(name)
    {
        var base = name.replace(/(_\d+)+$/, "");
        if (/^MONS_/.test(base))
        {
            var b = base.slice(5);
            return [0, 0, first(KIND_RULES, b) | (BIG_RE.test(b) ? 16 : 0)];
        }
        return [first(MAT_RULES, base), first(ITEM_RULES, base), 0];
    }

    function build_tables()
    {
        if (mat_of) return;
        var pairs = [], max = 0;
        [dngn, main, tileinfo_player].forEach(function (mod) {
            for (var name in mod)
            {
                var v = mod[name];
                if (typeof v !== "number" || !/^[A-Z][A-Z0-9_]*$/.test(name)
                    || /(^|_)MAX$|^MCACHE_START$|_LOW$|_MID$|_HIGH$/.test(name))
                    continue;
                pairs.push([v, name]);
                if (v > max) max = v;
            }
        });
        pairs.sort(function (a, b) { return a[0] - b[0]; });
        mat_of = new Uint8Array(max + 1);
        itm_of = new Uint8Array(max + 1);
        kind_of = new Uint8Array(max + 1);
        // unnamed indices (tile variants) inherit the previous name's class
        var p = 0, cm = 0, ci = 0, ck = 0;
        for (var idx = 0; idx <= max; idx++)
        {
            if (p < pairs.length && pairs[p][0] === idx)
            {
                cm = ci = ck = 0;
                while (p < pairs.length && pairs[p][0] === idx)
                {
                    var c = classify(pairs[p][1]);
                    cm = cm || c[0];
                    ci = ci || c[1];
                    ck = ck || c[2];
                    p++;
                }
            }
            mat_of[idx] = cm;
            itm_of[idx] = ci;
            kind_of[idx] = ck;
        }
    }

    function lo(v)
    {
        if (typeof v === "number") return v;
        return v && v.length ? v[0] : 0;
    }

    function has_icy_overlay(ov)
    {
        var base = wall.DNGN_WALL_ICY_WALL_OVERLAY;
        if (typeof base !== "number") return false;
        for (var i = 0; i < ov.length; i++)
            if (ov[i] >= base && ov[i] <= base + 3) return true;
        return false;
    }

    function idx_of(v)
    {
        var i = lo(v) & 0xFFFF;
        return i < (mat_of ? mat_of.length : 0) ? i : 0;
    }

    // State -----------------------------------------------------------------
    var data = null, cols = 0, rows = 0;
    var dirty = true, last_sig = "", last_build = 0;
    var prev = null;            // previous build: {vx, vy, cols, mat, mid, dmg}
    var hostiles = [];          // [x, y, threat] awake hostiles in view
    var glancers = [];          // [x, y] awake creatures that may glance
    var forced = [];            // debug [{x, y, ch, val}]
    var stats = { builds: 0, build_ms: 0, uploads_requested: 0 };
    var t_last = 0, t_init = 0, t_lag = 0;   // t_lag: time-scale hook
    var ph_breath = 0, ph_heart = 0;
    var lean = [0, 0];
    var startle = 0, quake = 0;
    // pose pushed by effect modules every frame they animate:
    //   api.emit("player_kick", {x, y, tremor, squash})   (null = release)
    //   x, y   sprite shift/tilt in tiles (map axes, top of the sprite most)
    //   tremor jitter amplitude, squash >0 swells / <0 pinches the sprite
    var kick = null;
    api.on("player_kick", function (k) {
        kick = k ? { x: k.x || 0, y: k.y || 0, tremor: k.tremor || 0,
                     squash: k.squash || 0, t: now() } : null;
    });
    var twitch = { x: 0, y: 0, t: -1e9, dir: 1 }, next_twitch = 0;
    var ripples = [];           // {x, y, t, s, w}
    var mood = { tempo: 1, unrest: 0, ooze: 0, warp: 0, wind: 0.8, gust: 1 };
    var wind_base = 0.6;
    var last_pos = null, last_key = null;


    function now()
    {
        return window.performance ? window.performance.now() : Date.now();
    }

    // every map update marks the scan dirty (shared wrapper in fxkit)
    kit.on_merge(function () { dirty = true; });

    // Map scan --------------------------------------------------------------
    function fg_flags(t)
    {
        try { return enums.prepare_fg_flags(t.fg); }
        catch (e) { return null; }
    }

    function build(vx, vy)
    {
        var t0 = now();
        var n = cols * rows;
        if (!data || data.length !== n * 4)
            data = new Uint8Array(n * 4);
        var mat_a = new Uint8Array(n), dmg_a = new Uint8Array(n);
        var mid_a = new Array(n);
        var same_view = prev && prev.vx === vx && prev.vy === vy
                        && prev.cols === cols && prev.mat.length === n;
        var px = player.pos ? player.pos.x : 1e9;
        var py = player.pos ? player.pos.y : 1e9;
        hostiles = [];
        glancers = [];
        var MAIN_MAX = main.MAIN_MAX || 0;
        var MCACHE = tileinfo_player.MCACHE_START || 1e9;

        for (var r = 0; r < rows; r++)
        {
            for (var c = 0; c < cols; c++)
            {
                var i = r * cols + c, o = i * 4;
                var x = vx + c, y = vy + r;
                var mc = map_knowledge.get(x, y);
                var t = mc.t;
                data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
                if (!t || t.bg === undefined || (lo(t.bg) & UNSEEN_BITS))
                    continue;           // remembered map stays still
                var mat = mat_of[idx_of(t.bg)];
                // Frozen Ramparts: the server overlays icy-wall tiles on the wall
                if (t.ov && (mat === M.WALL || mat === M.CRYSTAL || !mat)
                    && has_icy_overlay(t.ov))
                    mat = M.FROZEN;
                var st = 0, par = 0, itm = 0, kind = 0;
                var fgi = idx_of(t.fg);
                if (x === px && y === py)
                    st = S.PLAYER;
                else if (mc.mon && fgi)
                {
                    var ti = fgi;
                    if (fgi >= MCACHE && t.mcache && t.mcache[0])
                        ti = idx_of(t.mcache[0][0]);
                    var kc = kind_of[ti];
                    kind = kc & 15;
                    var fl = fg_flags(t) || {};
                    if (fl.PARALYSED || fl.NET || fl.WEB) st = S.HELD;
                    else if (fl.STAB) st = S.ASLEEP;
                    else if (fl.FLEEING) st = S.FLEEING;
                    else if (fl.PET) st = S.ALLY;
                    else if (fl.NEUTRAL || fl.GD_NEUTRAL) st = S.NEUTRAL;
                    else if (fl.MAY_STAB) st = S.UNAWARE;
                    else st = S.HOSTILE;
                    var dmg = fl.MDAM_LIGHT ? 1 : fl.MDAM_MOD ? 2
                              : fl.MDAM_HEAVY ? 3
                              : (fl.MDAM_SEV || fl.MDAM_ADEAD) ? 4 : 0;
                    var thr = fl.TRIVIAL ? 1 : fl.EASY ? 2 : fl.TOUGH ? 3
                              : fl.NASTY ? 4 : 0;
                    var mon = mc.mon;
                    var big = (kc & 16)
                              || (mon.typedata && mon.typedata.avghp >= 90);
                    par = dmg | (thr << 3) | (big ? 64 : 0)
                          | (fl.FLYING ? 128 : 0);
                    dmg_a[i] = dmg;
                    mid_a[i] = mon.id;
                    if (st === S.HOSTILE)
                        hostiles.push([x, y, thr]);
                    if ((st === S.HOSTILE || st === S.ALLY || st === S.NEUTRAL
                         || st === S.UNAWARE)
                        && (kind === K.NORMAL || kind === K.SERPENT
                            || kind === K.SKITTER || kind === K.UNDEAD))
                        glancers.push([x, y]);
                    // a monster at the same spot just got hurt: small impact
                    if (same_view && prev.mid[i] === mon.id && mon.id
                        && dmg > prev.dmg[i])
                        add_ripple(x, y, 0.25 + 0.1 * (dmg - prev.dmg[i]), 0.5);
                }
                else if (fgi && fgi < MAIN_MAX)
                    itm = itm_of[fgi];
                if (t.cloud)
                {
                    var cl = itm_of[idx_of(t.cloud)];
                    if (cl >= I.CLOUD) itm = cl;
                }
                mat_a[i] = mat;
                data[o] = mat;
                // a sprite drawn past the top of its cell (two-tile bosses,
                // hydras, tall helmets): how far, in 15ths of a cell, so the
                // shader moves the part in the cell above with it
                var spill = 0;
                if (st && t.sy < 0)
                    spill = Math.max(1, Math.min(15, Math.round(-t.sy / 32 * 15)));
                data[o + 1] = st | (spill << 4);
                data[o + 2] = par;
                data[o + 3] = itm | (kind << 4);
            }
        }
        for (var f = 0; f < forced.length; f++)
        {
            var fe = forced[f];
            var fx = (fe.x == null ? px : fe.x) - vx;
            var fy = (fe.y == null ? py : fe.y) - vy;
            if (fx < 0 || fy < 0 || fx >= cols || fy >= rows) continue;
            var fo = (fy * cols + fx) * 4;
            if (fe.ch === 3)
                data[fo + 3] = fe.kind ? (data[fo + 3] & 15) | (fe.val << 4)
                                       : (data[fo + 3] & 0xF0) | fe.val;
            else
                data[fo + fe.ch] = fe.val;
            if (fe.kind && !(data[fo + 1] & 15))
                data[fo + 1] = (data[fo + 1] & 0xF0) | S.HOSTILE;
        }
        prev = { vx: vx, vy: vy, cols: cols, mat: mat_a, mid: mid_a,
                 dmg: dmg_a };
        stats.builds++;
        stats.build_ms = Math.round((now() - t0) * 100) / 100;
    }

    // Events ----------------------------------------------------------------
    function add_ripple(x, y, s, w)
    {
        if (typeof x !== "number" || typeof y !== "number") return;
        ripples.push({ x: x + 0.5, y: y + 0.5, t: now(), s: s, w: w || 1 });
        if (ripples.length > 3) ripples.shift();
    }

    function ripple_at_player(s, w)
    {
        if (player.pos) add_ripple(player.pos.x, player.pos.y, s, w);
    }

    function status_text(pl)
    {
        return (pl.status || []).map(function (st) {
            return (st.light || "") + " " + (st.text || "");
        }).join("|").replace(/<[^>]*>/g, "").toLowerCase();
    }

    api.on("hud_update", function (pl, prv) {
        if (!prv || now() - t_init < MSG_GRACE) return;
        var same = prv.place === pl.place && prv.depth === pl.depth;
        if (!same)
        {
            // arriving on a new level: a settling wave once the view is there
            window.setTimeout(function () { ripple_at_player(0.8, 2.0); }, 300);
            return;
        }
        if (typeof prv.hp === "number" && pl.hp < prv.hp)
        {
            var frac = (prv.hp - pl.hp) / Math.max(1, pl.hp_max || 1);
            // no radar ring for damage any more: a short, tight wobble of the
            // player tile only; combat draws the blood from "hurt".
            ripple_at_player(Math.max(0.15, Math.min(0.5, frac * 3)), 0.4);
            if (frac > 0.25) quake = Math.max(quake, Math.min(0.8, frac));
            var pois = /pois/.test(status_text(pl));
            api.emit("hurt", {
                ratio: frac, hp_before: prv.hp, hp_after: pl.hp,
                source: pois && frac < 0.12 ? "poison" : "unknown"
            });
        }
        if (typeof prv.xl === "number" && pl.xl > prv.xl)
            ripple_at_player(0.7, 3.0);
    });

    api.on("blink", function (kind, to) {
        if (to) add_ripple(to.x, to.y, kind === "teleport" ? 1 : 0.7, 1.5);
    });

    // Shaft plunge (shaft): rumble while falling, heavy ripple on landing
    api.on("shaft", function (phase) {
        quake = 1;
        startle = Math.max(startle, 0.6);
        if (phase === "land") ripple_at_player(1, 2.0);
    });

    // Message log: shouts startle hostiles, explosions/rumbles shake the view
    var STARTLE_RE = /\b(shouts?|roars?|bellows?|howls?|screams?|yells?|snarls?|You hear an? (?:\w+ )?(?:shout|roar|howl|bellow|scream|yell))\b/i;
    var QUAKE_RE = /\b(explodes?|explosion|You hear an? (?:\w+ )?(?:crash|rumble|rumbling|grinding|clank)|(?:ground|dungeon|walls?) (?:shakes?|rumbles?|trembles?)|crumbles?|collapses?)\b/i;
    // new message-log text (shared observer in fxkit, which skips the
    // first moments of a game and replays)
    kit.on_message(function (text) {
        if (STARTLE_RE.test(text)) startle = 1;
        if (QUAKE_RE.test(text)) quake = Math.max(quake, 1);
    });

    // Mood ------------------------------------------------------------------
    // tempo: creature rhythm speed, unrest: heat shimmer / restless hostiles,
    // ooze: walls flow, warp: the whole view slowly heaves, wind/gust.
    var MOODS = {
        Temple:      { tempo: 0.75, wind: 0.25, gust: 0.3 },
        Lair:        { wind: 1.3 },
        Swamp:       { wind: 1.3, gust: 1.2 },
        Shoals:      { wind: 1.7, gust: 1.4 },
        Spider:      { wind: 0.5 },
        Snake:       { wind: 0.9, unrest: 0.15 },
        Slime:       { wind: 0.3, ooze: 1.0 },
        Crypt:       { tempo: 0.85, wind: 0.15, gust: 0.2 },
        Tomb:        { tempo: 0.8, wind: 0.1, gust: 0.2 },
        Necropolis:  { tempo: 0.85, wind: 0.15 },
        Ossuary:     { tempo: 0.85, wind: 0.15 },
        "Ice Cave":  { wind: 1.4, gust: 1.3 },
        Volcano:     { unrest: 0.8, wind: 0.6 },
        Hell:        { unrest: 0.5, tempo: 1.1 },
        Dis:         { unrest: 0.4, wind: 0.3 },
        Gehenna:     { unrest: 1.0, tempo: 1.15 },
        Cocytus:     { unrest: 0.3, wind: 1.4, gust: 1.4 },
        Tartarus:    { unrest: 0.6, warp: 0.25, tempo: 0.9 },
        Pandemonium: { unrest: 0.5, warp: 0.4, tempo: 1.1 },
        Abyss:       { unrest: 0.6, warp: 1.0, ooze: 0.6, wind: 0.6 },
        Zot:         { unrest: 0.4 },
        Ziggurat:    { unrest: 0.3 },
    };
    var MOOD_DEFAULT = { tempo: 1, unrest: 0, ooze: 0, warp: 0, wind: 0.8,
                         gust: 1 };

    function target_mood()
    {
        var p = String(player.place || "");
        var m = MOODS[p];
        if (!m)
            for (var k in MOODS)
                if (p.indexOf(k) === 0) { m = MOODS[k]; break; }
        return $.extend({}, MOOD_DEFAULT, m || {});
    }

    function place_hash(s)
    {
        var h = 7;
        for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
        return (h & 0xFFFF) / 65536;
    }

    // Per-frame uniforms ------------------------------------------------------
    function f4() { return new Float32Array(4); }
    var U = {
        u_alive_view: new Float32Array(2), u_alive_cells: new Float32Array(2),
        u_alive_t: new Float32Array(1), u_alive_mood: f4(), u_alive_wind: f4(),
        u_alive_amp0: f4(), u_alive_amp1: f4(), u_alive_pl: f4(),
        u_alive_pl2: f4(), u_alive_pl3: f4(), u_alive_rip0: f4(),
        u_alive_rip1: f4(), u_alive_rip2: f4(),
        u_alive_ripw: new Float32Array(3), u_alive_twitch: f4(),
    };
    var uniform_list = Object.keys(U).map(function (k) { return [k, U[k]]; });
    var result = { data: null, cols: 0, rows: 0, dirty: false, amt: 0,
                   uniforms: uniform_list };

    function update_player(dt, t)
    {
        var hpmax = Math.max(1, player.hp_max || 1);
        var r = Math.max(0, Math.min(1, (player.hp || 0) / hpmax));
        var s = status_text(player);
        var rate = 0.25 + (1 - r) * 0.7;           // breaths per second
        var depth = 0.026 - (1 - r) * 0.011;
        var tremor = 0, sway = 0;
        if (/\bhast/.test(s)) rate *= 1.6;
        if (/\bslow/.test(s)) rate *= 0.6;
        if (/berserk/.test(s)) { rate = Math.max(rate, 1.3); depth = 0.04;
                                 tremor = 0.012; }
        if (/\bconf/.test(s)) sway = 0.022;
        var sick = /poison|\bpois\b/.test(s) ? 1 : 0;
        var still = /paraly|petrif|\bpara\b|asleep|sleeping/.test(s);
        if (still) { depth = 0; tremor = 0; sway = 0; }
        var heart = r < 0.5 && !still ? (0.5 - r) / 0.5 : 0;
        var hb_rate = 1.1 + (1 - r) * 0.9;
        ph_breath = (ph_breath + dt * 6.2832 * rate * mood.tempo) % 6.2832;
        ph_heart = (ph_heart + dt * hb_rate) % 1;

        // lean a hair toward the nearest awake hostile (within 7 cells)
        var tx = 0, ty = 0;
        if (player.pos && !still)
        {
            var best = 1e9, bx = 0, by = 0, bt = 0;
            hostiles.forEach(function (h) {
                var dx = h[0] - player.pos.x, dy = h[1] - player.pos.y;
                var d2 = dx * dx + dy * dy;
                if (d2 < best) { best = d2; bx = dx; by = dy; bt = h[2]; }
            });
            if (best <= 49 && best > 0)
            {
                var len = Math.sqrt(best);
                var k = (0.014 + 0.002 * bt) * (r < 0.5 ? 1.4 : 1);
                tx = bx / len * k;
                ty = by / len * k;
            }
        }
        var a = Math.min(1, dt * 1.5);
        lean[0] += (tx - lean[0]) * a;
        lean[1] += (ty - lean[1]) * a;

        // external pose from effect modules ("player_kick": rangedfx recoil)
        var kx = 0, ky = 0, kt = 0, ks = 0;
        if (kick && now() - kick.t < 250)
        {
            kx = kick.x; ky = kick.y; kt = kick.tremor; ks = kick.squash;
        }
        U.u_alive_pl.set([ph_breath, depth, heart * 1.0, ph_heart]);
        U.u_alive_pl2.set([lean[0] + kx, lean[1] + ky, sway,
                           Math.max(tremor, kt)]);
        U.u_alive_pl3.set([sick, startle, quake * 0.6, ks]);
    }

    function update_twitch(t)
    {
        if (t < next_twitch) return;
        if (!glancers.length)
        {
            next_twitch = t + 5000;
            return;
        }
        var g = glancers[Math.floor(Math.random() * glancers.length)];
        twitch = { x: g[0], y: g[1], t: t, dir: Math.random() < 0.5 ? -1 : 1 };
        next_twitch = t + (TWITCH_MIN + Math.random() * (TWITCH_MAX - TWITCH_MIN))
                          * 1000;
    }

    function alive_source(t)
    {
        var dr = dungeon_renderer;
        if (api.settings.alive === false) return null;
        if (api.reduced_motion()) return null;
        if (dr.ui_state == enums.ui.VIEW_MAP) return null;
        if (!dr.cols || !dr.rows || !dr.view || !player.pos) return null;
        build_tables();

        t = typeof t === "number" ? t : now();
        var dt = t_last ? Math.min(0.1, Math.max(0, (t - t_last) / 1000)) : 0;
        t_last = t;
        // Time-scale hook (godfx_odd.js, Cheibriados time dilation):
        // window.sdc_alive_timescale in [0, 1) slows the shader clock and your
        // breathing; t_lag accumulates the lost time so 1 resumes seamlessly.
        var ts = +window.sdc_alive_timescale;
        if (!(ts >= 0 && ts < 1)) ts = 1;
        t_lag = (t_lag + dt * 1000 * (1 - ts)) % 3600000;
        var vx = dr.view.x, vy = dr.view.y;

        // footsteps in water
        var pos = player.pos;
        var key = player.place + ":" + player.depth;
        if (last_pos && key === last_key && (pos.x !== last_pos.x
                                             || pos.y !== last_pos.y))
        {
            var dist = Math.max(Math.abs(pos.x - last_pos.x),
                                Math.abs(pos.y - last_pos.y));
            var pm = mat_of[idx_of((map_knowledge.get(pos.x, pos.y).t || {}).bg)];
            if (dist <= 2 && (pm === M.SHALLOW || pm === M.DEEP))
                add_ripple(pos.x, pos.y, pm === M.SHALLOW ? 0.45 : 0.3, 0.45);
        }
        last_pos = { x: pos.x, y: pos.y };
        last_key = key;

        var sig = vx + "," + vy + "," + dr.cols + "," + dr.rows + ","
                  + pos.x + "," + pos.y;
        if (dr.cols !== cols || dr.rows !== rows)
        {
            cols = dr.cols;
            rows = dr.rows;
            dirty = true;
        }
        if (dirty || sig !== last_sig || t - last_build > REBUILD_MS)
        {
            build(vx, vy);
            dirty = false;
            last_sig = sig;
            last_build = t;
            result.dirty = true;
            stats.uploads_requested++;
        }

        // mood eases toward the current branch's over a few seconds
        var tm = target_mood();
        var ma = Math.min(1, dt * 0.4);
        for (var mk in MOOD_DEFAULT)
            mood[mk] += (tm[mk] - mood[mk]) * ma;
        var ang = place_hash(String(player.place || "")) * 6.2832
                  + 0.5 * Math.sin(t / 90000);
        startle = Math.max(0, startle - dt / 8);
        quake = Math.max(0, quake - dt / 0.7);
        update_player(dt * ts, t);
        update_twitch(t);

        U.u_alive_view.set([vx, vy]);
        U.u_alive_cells.set([cols, rows]);
        U.u_alive_t[0] = (((t - t_lag) % 3600000 + 3600000) % 3600000) / 1000;
        U.u_alive_mood.set([mood.tempo, mood.unrest, mood.ooze, mood.warp]);
        U.u_alive_wind.set([Math.cos(ang), Math.sin(ang), mood.wind * AMP.wind,
                            mood.gust]);
        U.u_alive_amp0.set([AMP.creatures, AMP.liquids, AMP.wind, AMP.flames]);
        U.u_alive_amp1.set([AMP.magic, AMP.glints, AMP.ripples, AMP.player]);
        var rip = [U.u_alive_rip0, U.u_alive_rip1, U.u_alive_rip2];
        ripples = ripples.filter(function (rp) {
            return (t - rp.t) / 1000 < RIPPLE_LIFE;
        });
        for (var i = 0; i < 3; i++)
        {
            var rp = ripples[i];
            if (rp)
            {
                rip[i].set([rp.x, rp.y, (t - rp.t) / 1000, rp.s]);
                U.u_alive_ripw[i] = rp.w;
            }
            else
            {
                rip[i].set([0, 0, 99, 0]);
                U.u_alive_ripw[i] = 1;
            }
        }
        U.u_alive_twitch.set([twitch.x, twitch.y,
                              Math.min(99, (t - twitch.t) / 1000), twitch.dir]);

        result.data = data;
        result.cols = cols;
        result.rows = rows;
        result.amt = STRENGTH;
        return result;
    }

    function reset()
    {
        prev = null;
        dirty = true;
        ripples = [];
        hostiles = [];
        glancers = [];
        lean = [0, 0];
        startle = quake = 0;
        last_pos = null;
        last_key = null;
        t_last = 0;
        next_twitch = now() + TWITCH_MIN * 1000;
    }

    api.on("game_init", function () {
        reset();
        t_init = now();
    });
    api.on("game_cleanup", function () {
        reset();
    });
    api.on("setting", function (key) {
        if (key === "alive") dirty = true;
    });

    api.set_alive_source(alive_source);

    // Debug -----------------------------------------------------------------
    function find_class(name)
    {
        name = String(name || "").toLowerCase();
        var lists = [[MAT_NAMES, 0, false], [ITEM_NAMES, 3, false],
                     [KIND_NAMES, 3, true], [STATE_NAMES, 1, false]];
        for (var i = 0; i < lists.length; i++)
        {
            var j = lists[i][0].indexOf(name);
            if (j > 0 || (j === 0 && lists[i][2]))
                return { ch: lists[i][1], val: j, kind: lists[i][2] };
        }
        throw new Error("unknown class; one of: " + MAT_NAMES.concat(
            ITEM_NAMES, KIND_NAMES, STATE_NAMES).join(", "));
    }

    window.sdc_alive_debug = {
        strength: function (v) {
            if (typeof v === "number" && isFinite(v))
                STRENGTH = Math.max(0, Math.min(8, v));
            return STRENGTH;
        },
        classes: function () {
            var count = {};
            if (data)
                for (var i = 0; i < cols * rows; i++)
                {
                    var o = i * 4;
                    var sto = data[o + 1] & 15;
                    var names = [MAT_NAMES[data[o]], STATE_NAMES[sto],
                                 ITEM_NAMES[data[o + 3] & 15]];
                    if (sto && sto !== S.PLAYER)
                        names.push("kind:" + KIND_NAMES[data[o + 3] >> 4]);
                    names.forEach(function (n) {
                        if (n && n !== "none" && n !== "empty")
                            count[n] = (count[n] || 0) + 1;
                    });
                }
            return { materials: MAT_NAMES, items: ITEM_NAMES,
                     body_plans: KIND_NAMES, states: STATE_NAMES,
                     in_view: count };
        },
        cell: function (x, y) {
            var dr = dungeon_renderer;
            if (!data || !dr.view) return null;
            x = x == null ? player.pos.x : x;
            y = y == null ? player.pos.y : y;
            var c = x - dr.view.x, r = y - dr.view.y;
            if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
            var o = (r * cols + c) * 4;
            var p = data[o + 2];
            return { mat: MAT_NAMES[data[o]],
                     state: STATE_NAMES[data[o + 1] & 15],
                     spill: (data[o + 1] >> 4) / 15,
                     item: ITEM_NAMES[data[o + 3] & 15],
                     body: KIND_NAMES[data[o + 3] >> 4], dmg: p & 7,
                     threat: (p >> 3) & 7, big: !!(p & 64),
                     flying: !!(p & 128), raw: Array.prototype.slice.call(
                         data, o, o + 4) };
        },
        force: function (name, x, y) {
            var c = find_class(name);
            forced.push({ x: x, y: y, ch: c.ch, val: c.val, kind: c.kind });
            dirty = true;
            return forced.length;
        },
        clear: function () { forced = []; dirty = true; },
        ripple: function (x, y, s, w) {
            add_ripple(x == null ? player.pos.x : x,
                       y == null ? player.pos.y : y, s || 0.8, w || 1);
        },
        twitch: function () { next_twitch = 0; },
        stats: function () {
            return $.extend({}, stats, {
                cols: cols, rows: rows, enabled: api.settings.alive !== false,
                reduced_motion: api.reduced_motion(),
                mood: $.extend({}, mood), ripples: ripples.length,
                hostiles: hostiles.length, glancers: glancers.length,
                player: Array.prototype.slice.call(U.u_alive_pl),
                lean: lean.slice(), startle: startle, quake: quake,
            });
        },
    };

    return {};
});
