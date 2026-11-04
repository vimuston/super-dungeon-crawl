// Environmental lighting: a soft light map for fire, lava, torches,
// lightning, cold, poison, magic/portals, holy halos, glowing monsters and
// spell bolts/explosions in flight. crt.js uploads the canvas returned by our
// light source as a texture and composites it in the CRT shader.
//
// How it works
// - At init every tile index of the dngn/main/player tile sets is classified
//   once by its *name* (tileinfo-*.js exports, e.g. DNGN_LAVA, CLOUD_FIRE_1,
//   BOLT_STRONG_ELEC, MONS_FIRE_ELEMENTAL) into a light class.
// - Every frame the visible cells (plus a small margin so off-screen lava
//   still bleeds in) are scanned from map_knowledge: bg (features), fg
//   (monsters/items), cloud, ov (bolt/zap overlays), halo / orb_glow /
//   sanctuary / disjunction fields and the screen "flash" colour.
// - Bolts/explosions are transient, so every map update (fxkit.on_merge) is
//   checked to
//   catch every intermediate beam step, and each lit cell keeps a fading
//   afterglow (~350ms) after the tile disappears.
// - Lights are additive radial-gradient sprites (one pre-rendered sprite per
//   class) on an opaque black low-res canvas (LIGHT_PX px per cell); rgb is
//   the accumulated light, alpha is always 1.
//
// Debug (browser console):
//   sdc_light_debug.emitters()           emitters drawn in the last frame
//   sdc_light_debug.test("fire")         forced emitter at the player
//   sdc_light_debug.test("elec", x, y)   ... at map coords x, y
//   sdc_light_debug.burst("blue")        one-off bolt flash at the player
//   sdc_light_debug.clear()              remove forced emitters
//   sdc_light_debug.classify(idx)        class name of a tile index
//   sdc_light_debug.stats()              timing / counts
//   sdc_light_debug.canvas()             the light canvas (append to see)
define(["jquery", "./sdc_api", "./map_knowledge", "./dungeon_renderer",
        "./enums", "./player", "./view_data", "./tileinfo-dngn",
        "./tileinfo-main", "./tileinfo-player", "./cell_renderer", "./fxkit"],
function ($, api, map_knowledge, dungeon_renderer, enums, player, view_data,
          dngn, main, tileinfo_player, cell_renderer, kit) {
    "use strict";

    var LIGHT_PX = 8;           // light map pixels per dungeon cell
    var MARGIN = 3;             // cells scanned outside the view
    var AFTERGLOW = 350;        // ms a transient light fades out over
    var FLASH_FADE = 300;       // ms the screen flash light fades out over

    var UNSEEN_BITS = 0x00020000 | 0x00040000;  // MM_UNSEEN | UNSEEN

    // Light classes ---------------------------------------------------------
    // rgb: light colour, r: radius in cells, i: intensity (sprite alpha),
    // anim: flicker | slow | strobe | pulse | none
    var CLASS_DEFS = [
        ["fire",    [255, 118,  30], 2.6, 0.45, "flicker"],
        ["lava",    [255,  78,  12], 2.2, 0.16, "slow"],
        ["torch",   [255, 158,  64], 4.2, 0.70, "flicker"],
        ["elec",    [150, 190, 255], 3.0, 0.60, "strobe"],
        ["cold",    [140, 215, 255], 2.4, 0.30, "pulse"],
        ["poison",  [110, 255,  70], 2.2, 0.24, "pulse"],
        ["magic",   [185, 100, 255], 2.6, 0.34, "pulse"],
        ["holy",    [255, 236, 190], 2.6, 0.34, "pulse"],
        ["halo",    [255, 236, 180], 2.0, 0.16, "slow"],
        ["orb",     [255,  90, 220], 2.2, 0.26, "pulse"],
        ["dark",    [140,  60, 200], 2.0, 0.18, "pulse"],
        ["altar",   [255, 226, 170], 2.2, 0.22, "pulse"],
        ["silence", [165,  95, 255], 2.0, 0.16, "slow"],
        // plain-coloured bolts / explosions (BOLT_DEFAULT_<colour>)
        ["blue",    [ 80, 110, 255], 2.6, 0.45, "none"],
        ["green",   [ 90, 255,  90], 2.6, 0.45, "none"],
        ["cyan",    [ 80, 240, 255], 2.6, 0.45, "none"],
        ["red",     [255,  70,  50], 2.6, 0.45, "none"],
        ["magenta", [255,  80, 255], 2.6, 0.45, "none"],
        ["yellow",  [255, 230,  90], 2.6, 0.45, "none"],
        ["white",   [255, 255, 255], 2.6, 0.45, "none"],
        // fountains (soft blue water shimmer)
        ["water",   [ 90, 150, 255], 2.4, 0.32, "pulse"],
    ];
    var CLASSES = [null];       // id -> def (id 0 = no light)
    var CLASS_ID = {};
    CLASS_DEFS.forEach(function (d) {
        var c = { id: CLASSES.length, name: d[0], rgb: d[1], r: d[2], i: d[3],
                  anim: d[4], sprite: null };
        CLASS_ID[c.name] = c.id;
        CLASSES.push(c);
    });

    // Burst multipliers for transient lights (bolts, zaps, explosions)
    var BURST_I = 2.0, BURST_R = 1.15;

    // Name -> class rules (first match wins). Names have trailing variant
    // numbers stripped (CLOUD_FIRE_2 -> CLOUD_FIRE) before matching.
    var RULES = [
        // --- spell bolts / zaps / explosions (main tiles, via cell.ov) ---
        [/^BOLT_DEFAULT_BLACK/, null],
        [/^BOLT_DEFAULT_(BLUE|GREEN|CYAN|RED|MAGENTA|YELLOW|WHITE)/,
         function (m) { return m[1].toLowerCase(); }],
        [/^BOLT_.*(FROSTFIRE|FLAME|MAGMA|FIRE|IGNITE|SEARING|BOMBLET|FORTRESS|HAEMOCLASM|SIROCCO)/, "fire"],
        [/^BOLT_.*(DAMNATION)/, "red"],
        [/^BOLT_.*(ELEC|ZAP|PLASMA|ARC|LIGHTNING|STORM|TEMPEST|_AIR|JADE_CHARGE_AIR)/, "elec"],
        [/^BOLT_.*(FROST|ICE|ICICLE|PERMAFROST)/, "cold"],
        [/^BOLT_.*(POISON|MEPHITIC|STING|CONTAM|IRRADIATE|BOG|LIQUEFY_GREEN|ALEMBIC|SLIME)/, "poison"],
        [/^BOLT_.*(DRAIN|GLOOM|DOOM|SHADOW|CORRUPTION|ANTIMAGIC|OBLIVION|UMBRAL|ENTROPIC|SAP_MAGIC|OSTRACISE)/, "dark"],
        [/^BOLT_.*(LIGHT|MYSTIC|MAGIC_DART|CHAOS|WARP|FORCE_LANCE|CRYSTAL|QUINTESSENCE|MANIFOLD|SINGING|PHANTOM|SHATTER|SUNDERING|BECKONING|PIE|POTION|BLOOD_ARROW|FLESH)/, "magic"],

        // --- clouds ---
        [/^CLOUD_(FIRE|FOREST_FIRE|FLAME|BLASTMOTES)/, "fire"],
        [/^CLOUD_(STORM|ELECTRICITY)/, "elec"],
        [/^CLOUD_(COLD|FAINT_FROST)/, "cold"],
        [/^CLOUD_(POISON|MEPHITIC|MIASMA|FAINT_MIASMA|ACID)/, "poison"],
        [/^CLOUD_(TLOC_ENERGY|MAGIC_TRAIL|CHAOS|SPECTRAL|GLIMMER|MAGNETISED_DUST)/, "magic"],
        [/^CLOUD_GOLD_DUST/, "holy"],

        // --- dungeon features ---
        [/_GONE|_EXPIRED|DRY_FOUNTAIN|_INACTIVE|ZOT_CLOSED/, null],
        [/^DNGN_LAVA/, "lava"],
        [/TORCH|FOUNTAIN_NOVELTY_LANTERN/, "torch"],
        [/^DNGN_(FOUNTAIN$|FOUNTAIN_NOVELTY_(FANCY|OCTOPODE|XOM))/, "water"],
        [/^(FIERY_CONDUIT|DNGN_DRAGON_VEIN_FIRE|DNGN_ZOT_FIRE_STATUE|DNGN_PORTAL_VOLCANO|DNGN_ENTER_GEHENNA|DNGN_ENTER_HELL|DNGN_ALTAR_(MAKHLEB|IGNIS))/, "fire"],
        [/^(STORM_CONDUIT|DNGN_DRAGON_VEIN_AIR|DNGN_ALTAR_QAZLAL)/, "elec"],
        [/^(ICY_CONDUIT|DNGN_DRAGON_VEIN_ICE|DNGN_ZOT_WINTER_STATUE|DNGN_PORTAL_ICE_CAVE|DNGN_PORTAL_GLACIAL_CHASM|DNGN_ENTER_COCYTUS|DNGN_SPARKLING_FOUNTAIN)/, "cold"],
        [/^(DNGN_ALTAR_JIYVA|GLOWING_MOLD)/, "poison"],
        [/^DNGN_ALTAR_(SHINING_ONE|ZIN|ELYVILON)/, "holy"],
        [/^DNGN_ALTAR_(VEHUMET|SIF_MUNA|XOM|NEMELEX_XOBEH|LUGONU|ECUMENICAL)/, "magic"],
        [/^DNGN_ALTAR_(KIKUBAAQUDGHA|YREDELEMNUL|DITHMENOS)/, "dark"],
        [/^DNGN_ALTAR_/, "altar"],
        [/^(ARCANE_CONDUIT|DIMENSIONAL_CONDUIT|SOUL_CONDUIT|ALCHEMICAL_CONDUIT|MISFORTUNE_CONDUIT|DNGN_ZOT_ENTROPY_STATUE)/, "magic"],
        [/^DNGN_(PORTAL|STARRY_PORTAL|ENTER_ABYSS|EXIT_ABYSS|ABYSSAL_STAIR|ENTER_PANDEMONIUM|TRANSIT_PANDEMONIUM|EXIT_PANDEMONIUM|ENTER_ZOT_OPEN|TELEPORTER|TRANSPORTER$|TRAP_TELEPORT|TRAP_ZOT|TRAP_GOLUBRIA|BINDING_SIGIL|RUNELIGHT|DIMENSION_EDGE|MYSTIC_CAGE|ENIGMATIC_DYNAMO|NASCENCE_CIRCUIT|STARWATER|DISCO_BALL|UNKNOWN_PORTAL)/, "magic"],
        [/^ORB_GLOW/, "orb"],

        // --- items ---
        [/^(ORB|UNCOLLECTED_ORB)$/, "orb"],
        [/^UNCOLLECTED_RUNE_/, "magic"],
        // offhand orbs (orb of energy etc.): the tile carries no ego, so
        // every floor orb gets the glow
        [/^ARM_ORB(_RANDART)?$/, "magic"],

        // --- monsters ---
        [/^MONS_(FIRE_ELEMENTAL|FIRE_VORTEX|ORB_OF_FIRE|SOLAR_EMBER|FOXFIRE|EFREET|BALRUG|SALAMANDER|FIRE_CRAB|FIRE_BAT|HELL_HOUND|HELL_HOG|HELLEPHANT|LAVA_SNAKE|FIRE_GIANT|FIRE_DRAGON|BLAZEHEART|BRIMSTONE_FIEND|SUN_DEMON|SUNNIER_DEMON|HELLION|HELL_SENTINEL|HELLFIRE_MORTAR|FIRESPITTER|FIRE_ELEMENTALIST|JADE_CRYSTAL_FIRE|SERPENT_OF_HELL_GEHENNA|CEREBOV|JACK_O_LANTERN|FLAME_CULT|GLOWING_ORANGE_BRAIN|HELLWING)/, "fire"],
        [/^MONS_(BALL_LIGHTNING|SPARK_WASP|ELECTRIC_EEL|ELECTRIC_GOLEM|STORM_DRAGON|LIGHTNING_SPIRE|DRACONIAN_STORMCALLER)/, "elec"],
        [/^MONS_(ICE_BEAST|ORB_OF_WINTER|ICE_FIEND|ICE_DEVIL|ICE_DRAGON|BLOCK_OF_ICE|ICE_STATUE|HOARFROST|SERPENT_OF_HELL_COCYTUS|JADE_CRYSTAL_ICE|LIVING_SPELL_ICE|IRONBOUND_FROSTHEART|SPLINTERFROST|FROSTBOUND_TOME|SIMULACRUM)/, "cold"],
        [/^MONS_(ANGEL|DAEVA|SERAPH|SUN_MOTH|SHINING_EYE|GOLDEN_EYE|STARFLOWER)/, "holy"],
        [/^MONS_(ORB_OF_ENTROPY|ORB_OF_DESTRUCTION|SPELLSPARK|STAR_JELLY$|WILL_O_THE_WISP|SOUL_WISP|GLOWMURK|LOST_SOUL|WRETCHED_STAR|STARCURSED|SHOOTING_STAR|GLOWING_SHAPESHIFTER|ORB_SPIDER|SPECTRAL_)/, "magic"],
    ];

    // Tile index -> class id, and -> "is a transient bolt" flag
    var cls_of = null;
    var burst_of = null;

    function classify_name(name)
    {
        var base = name.replace(/(_\d+)+$/, "");
        for (var i = 0; i < RULES.length; i++)
        {
            var m = RULES[i][0].exec(base);
            if (!m) continue;
            var res = RULES[i][1];
            if (typeof res === "function") res = res(m);
            return res ? (CLASS_ID[res] || 0) : 0;
        }
        return 0;
    }

    function build_tables()
    {
        if (cls_of) return;
        var pairs = [];
        var max = 0;
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
        cls_of = new Uint8Array(max + 1);
        burst_of = new Uint8Array(max + 1);
        // Unnamed indices (if any) inherit the previous name's class.
        // Synonyms (e.g. SYM_BOLT_OFS = BOLT_DEFAULT_BLUE) share an index:
        // any classified name of the index wins.
        var p = 0, cur = 0, cur_burst = 0;
        for (var idx = 0; idx <= max; idx++)
        {
            if (p < pairs.length && pairs[p][0] === idx)
            {
                cur = 0;
                cur_burst = 0;
            }
            while (p < pairs.length && pairs[p][0] === idx)
            {
                cur = cur || classify_name(pairs[p][1]);
                if (/^BOLT_/.test(pairs[p][1])) cur_burst = 1;
                p++;
            }
            cls_of[idx] = cur;
            burst_of[idx] = cur_burst;
        }
    }

    function lo(v)
    {
        // raw tile values are numbers, [lo, hi] arrays, or arrays already
        // decorated by enums.prepare_*_flags
        if (typeof v === "number") return v;
        return v && v.length ? v[0] : 0;
    }

    function tile_class(v)
    {
        var idx = lo(v) & 0xFFFF;
        return idx && idx < cls_of.length ? cls_of[idx] : 0;
    }

    function tile_burst(v)
    {
        var idx = lo(v) & 0xFFFF;
        return idx && idx < burst_of.length ? burst_of[idx] : 0;
    }

    // Sprites ---------------------------------------------------------------
    var SPRITE = 64;

    function sprite(c)
    {
        if (c.sprite) return c.sprite;
        var s = document.createElement("canvas");
        s.width = s.height = SPRITE;
        var g = s.getContext("2d");
        var h = SPRITE / 2;
        var grad = g.createRadialGradient(h, h, 0, h, h, h);
        var rgb = c.rgb[0] + "," + c.rgb[1] + "," + c.rgb[2];
        grad.addColorStop(0, "rgba(" + rgb + ",1)");
        grad.addColorStop(0.25, "rgba(" + rgb + ",0.6)");
        grad.addColorStop(0.55, "rgba(" + rgb + ",0.22)");
        grad.addColorStop(1, "rgba(" + rgb + ",0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, SPRITE, SPRITE);
        c.sprite = s;
        return s;
    }

    // Animation -------------------------------------------------------------
    function hash2(x, y)
    {
        var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return n - Math.floor(n);
    }

    function anim_value(kind, t, ph)
    {
        switch (kind)
        {
        case "flicker":
            return 0.78 + 0.12 * Math.sin(t * 0.011 + ph * 6.283)
                        + 0.10 * Math.sin(t * 0.029 + ph * 17.0);
        case "slow":
            return 0.82 + 0.18 * Math.sin(t * 0.0022 + ph * 6.283);
        case "strobe":
            var step = Math.floor(t / 70);
            var r = hash2(step, ph * 97.0);
            return r > 0.6 ? 1.15 : (r > 0.25 ? 0.55 : 0.3);
        case "pulse":
            return 0.85 + 0.15 * Math.sin(t * 0.004 + ph * 6.283);
        default:
            return 1;
        }
    }

    // State -----------------------------------------------------------------
    var canvas = null, ctx = null;
    var glows = new Map();      // key -> {x, y, c, t} transient afterglows
    var flash = null;           // {r, g, b, a, t} screen flash light
    var forced = [];            // debug emitters [{x, y, c, burst}]
    var last_n_static = 0;
    var last_sig = null, last_static = false, last_result = null;
    var stats = { scan_ms: 0, draw_ms: 0, emitters: 0, glows: 0, frames: 0 };

    function glow_key(x, y, c)
    {
        return ((y + 512) * 2048 + (x + 512)) * 64 + c;
    }

    function note_glow(x, y, c, now)
    {
        var k = glow_key(x, y, c);
        var g = glows.get(k);
        if (g) g.t = now;
        else glows.set(k, { x: x, y: y, c: c, t: now });
    }

    function note_flash(mc, now)
    {
        var col = view_data.get_flash_colour(mc.flc, mc.fla);
        if (!col || !col.a) return;
        if (!flash || flash.r !== col.r || flash.g !== col.g
            || flash.b !== col.b || now - flash.t > FLASH_FADE)
            flash = { since: now };
        flash.r = col.r; flash.g = col.g; flash.b = col.b;
        flash.a = col.a / 255;
        flash.t = now;
    }

    // Transient cell content (bolts in ov, bolt-ish fg, flash) of one cell
    function note_transient(mc, now)
    {
        var t = mc.t;
        if (t)
        {
            if (t.ov)
            {
                for (var i = 0; i < t.ov.length; i++)
                {
                    var c = tile_class(t.ov[i]);
                    if (c && tile_burst(t.ov[i])) note_glow(mc.x, mc.y, c, now);
                }
            }
            if (t.fg && tile_burst(t.fg))
            {
                var cf = tile_class(t.fg);
                if (cf) note_glow(mc.x, mc.y, cf, now);
            }
        }
        if (mc.flc) note_flash(mc, now);
    }

    // Catch every intermediate beam step: messages can arrive faster than
    // our ~30fps frame loop.
    kit.on_merge(function () {
        if (!cls_of) return;
        var now = performance.now();
        var dirty = map_knowledge.dirty();
        for (var i = 0; i < dirty.length; i++)
        {
            var d = dirty[i];
            note_transient(map_knowledge.get(d.x, d.y), now);
        }
    });

    // The stock square HALO_RANGE tile (Shining One aura) and the SILENCED
    // tile (silence aura) are replaced by a round, soft light below.
    (function () {
        var proto = cell_renderer.DungeonCellRenderer.prototype;
        if (proto.draw_dngn.sdc_halo) return;
        var orig = proto.draw_dngn;
        proto.draw_dngn = function (idx) {
            if (idx === dngn.HALO_RANGE || idx === dngn.SILENCED) return;
            return orig.apply(this, arguments);
        };
        proto.draw_dngn.sdc_halo = true;
    })();

    // Light map -------------------------------------------------------------
    function ensure_canvas(cols, rows)
    {
        var w = cols * LIGHT_PX, h = rows * LIGHT_PX;
        if (!canvas)
        {
            canvas = document.createElement("canvas");
            ctx = canvas.getContext("2d");
        }
        if (canvas.width !== w || canvas.height !== h)
        {
            canvas.width = w;
            canvas.height = h;
            last_sig = null;
        }
    }

    // Emitter list reused across frames: flat arrays to avoid garbage
    var em_x = [], em_y = [], em_c = [], em_f = [];   // f: intensity factor
    var em_n = 0;

    function push(x, y, c, f)
    {
        em_x[em_n] = x; em_y[em_n] = y; em_c[em_n] = c; em_f[em_n] = f;
        em_n++;
    }

    // Aura cells (Shining One halo, silence) form a square or disc; fade them
    // out radially from the centre so the glow reads as a soft disc.
    var halo_x = [], halo_y = [], halo_n = 0;
    var sil_x = [], sil_y = [], sil_n = 0;
    function push_disc(xs, ys, n, cls, gain)
    {
        if (!n) return;
        var cx = 0, cy = 0, i;
        for (i = 0; i < n; i++) { cx += xs[i]; cy += ys[i]; }
        cx /= n; cy /= n;
        var rmax = 0;
        for (i = 0; i < n; i++)
            rmax = Math.max(rmax, Math.hypot(xs[i] - cx, ys[i] - cy));
        rmax += 0.8;
        for (i = 0; i < n; i++)
        {
            var d = Math.hypot(xs[i] - cx, ys[i] - cy) / rmax;
            var f = 1 - d * d;
            if (f > 0.05) push(xs[i], ys[i], cls, gain * f);
        }
    }
    function push_halo()
    {
        push_disc(halo_x, halo_y, halo_n, CLASS_ID.halo, 1.6);
        push_disc(sil_x, sil_y, sil_n, CLASS_ID.silence, 1.6);
    }

    function light_source()
    {
        var dr = dungeon_renderer;
        if (dr.ui_state == enums.ui.VIEW_MAP) return null;
        var cols = dr.cols, rows = dr.rows;
        if (!cols || !rows || !dr.view) return null;
        build_tables();

        var t0 = performance.now();
        var now = t0;
        var vx = dr.view.x, vy = dr.view.y;
        em_n = 0;
        halo_n = 0;
        sil_n = 0;
        var sig = (vx * 31 + vy + 1000) | 0;
        var animated = false;

        // scan persistent emitters. Webtiles map coordinates are relative
        // to the player's origin and go negative, so don't clamp to 0..gxm.
        var x0 = vx - MARGIN;
        var x1 = vx + cols + MARGIN;
        var y0 = vy - MARGIN;
        var y1 = vy + rows + MARGIN;
        for (var y = y0; y < y1; y++)
        {
            for (var x = x0; x < x1; x++)
            {
                var mc = map_knowledge.get(x, y);
                var t = mc.t;
                if (!t) continue;
                if (lo(t.bg) & UNSEEN_BITS) continue;
                var c;
                if (t.bg && (c = tile_class(t.bg))) push(x, y, c, 1);
                if (t.fg)
                {
                    if ((c = tile_class(t.fg)) && !tile_burst(t.fg))
                        push(x, y, c, 1);
                    else if (t.mcache && t.mcache[0]
                             && (c = tile_class(t.mcache[0][0])))
                        push(x, y, c, 1);
                }
                if (t.cloud && (c = tile_class(t.cloud))) push(x, y, c, 1);
                if (t.halo == enums.HALO_RANGE)
                {
                    halo_x[halo_n] = x; halo_y[halo_n] = y; halo_n++;
                }
                if (t.silenced)
                {
                    sil_x[sil_n] = x; sil_y[sil_n] = y; sil_n++;
                }
                if (t.orb_glow) push(x, y, CLASS_ID.orb, 0.5 + 0.25 * t.orb_glow);
                if (t.sanctuary) push(x, y, CLASS_ID.halo, 1.5);
                if (t.disjunct) push(x, y, CLASS_ID.magic, 0.6);
                if (t.quad_glow) push(x, y, CLASS_ID.magic, 0.6);
                if (t.ov || mc.flc) note_transient(mc, now);
            }
        }
        push_halo();
        for (var fi = 0; fi < forced.length; fi++)
        {
            var fe = forced[fi];
            var fx = fe.x == null ? player.pos.x : fe.x;
            var fy = fe.y == null ? player.pos.y : fe.y;
            push(fx, fy, fe.c, 1);
        }
        var n_static = last_n_static = em_n;

        // emitters contributed by effect modules (animated, so after the
        // static block: they force a redraw every frame while present)
        var extras = api.get_light_extras();
        for (var en in extras)
        {
            var list = extras[en]();
            if (!list) continue;
            for (var ei = 0; ei < list.length; ei++)
            {
                var ex = list[ei], ec = CLASS_ID[ex.cls];
                if (ec) push(ex.x, ex.y, ec, ex.f);
            }
        }

        // transient afterglows
        glows.forEach(function (g, k) {
            var age = now - g.t;
            if (age > AFTERGLOW)
            {
                glows.delete(k);
                return;
            }
            var f = 1 - age / AFTERGLOW;
            push(g.x, g.y, g.c, BURST_I * f * f);
        });
        var flash_f = 0;
        if (flash)
        {
            var fage = now - flash.t;
            if (fage > FLASH_FADE) flash = null;
            else
            {
                flash_f = 1 - fage / FLASH_FADE;
                // a lingering flash (e.g. berserk's red view tint) settles
                // down to a faint ambient tint
                if (now - flash.since > 800) flash_f *= 0.3;
            }
        }
        stats.scan_ms = performance.now() - t0;

        if (em_n === 0 && !flash_f)
        {
            last_sig = null;
            stats.emitters = 0;
            return null;
        }

        // skip redraw when only unchanged static lights are visible
        for (var s = 0; s < n_static; s++)
        {
            sig = (sig * 31 + em_x[s] * 7 + em_y[s] * 131 + em_c[s]) | 0;
            if (CLASSES[em_c[s]].anim !== "none") animated = true;
        }
        if (em_n > n_static || flash_f) animated = true;
        if (!animated && last_static && sig === last_sig && last_result
            && canvas.width === cols * LIGHT_PX
            && canvas.height === rows * LIGHT_PX)
        {
            return last_result;
        }

        var t1 = performance.now();
        ensure_canvas(cols, rows);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = "lighter";

        if (flash_f)
        {
            ctx.globalAlpha = Math.min(1, flash.a * 0.55 * flash_f);
            ctx.fillStyle = "rgb(" + flash.r + "," + flash.g + ","
                            + flash.b + ")";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        for (var e = 0; e < em_n; e++)
        {
            var cl = CLASSES[em_c[e]];
            var ex = em_x[e], ey = em_y[e];
            var burst = e >= n_static;
            var ph = hash2(ex, ey);
            var a = anim_value(burst ? "none" : cl.anim, now, ph);
            var alpha = cl.i * em_f[e] * a;
            var rad = cl.r * (burst ? BURST_R : 1)
                      * (cl.anim === "flicker" ? 0.94 + 0.06 * a : 1);
            var size = rad * 2 * LIGHT_PX;
            var cx = (ex - vx + 0.5) * LIGHT_PX;
            var cy = (ey - vy + 0.5) * LIGHT_PX;
            if (cx + size < 0 || cy + size < 0 || cx - size > canvas.width
                || cy - size > canvas.height)
                continue;
            var spr = sprite(cl);
            // alpha > 1: draw again for the remainder
            while (alpha > 0.004)
            {
                ctx.globalAlpha = Math.min(1, alpha);
                ctx.drawImage(spr, cx - size / 2, cy - size / 2, size, size);
                alpha -= 1;
            }
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";

        stats.draw_ms = performance.now() - t1;
        stats.emitters = em_n;
        stats.glows = glows.size;
        stats.frames++;
        last_sig = sig;
        last_static = !animated;
        last_result = canvas;
        return canvas;
    }

    function reset()
    {
        glows.clear();
        flash = null;
        last_sig = null;
        last_result = null;
        em_n = 0;
    }

    api.on("game_init", function () {
        build_tables();
        reset();
    });
    api.on("game_cleanup", reset);

    api.set_light_source(light_source);

    // Line of sight mask -----------------------------------------------------
    // White where the cell is currently in view, blurred so the edge of
    // sight is soft. The shader lights the inside like a lantern and turns
    // the remembered map outside cold and foggy.
    var LOS_PX = 8;             // mask pixels per cell
    var los_raw = document.createElement("canvas");
    var los_soft = document.createElement("canvas");
    var los_sig = null;
    var los_result = { canvas: los_soft, px: 0.5, py: 0.5, amount: 1 };

    function los_source()
    {
        var dr = dungeon_renderer;
        if (dr.ui_state == enums.ui.VIEW_MAP) return null;
        var cols = dr.cols, rows = dr.rows;
        if (!cols || !rows || !dr.view) return null;

        var vx = dr.view.x, vy = dr.view.y;
        var w = cols * LOS_PX, h = rows * LOS_PX;
        if (los_raw.width !== w || los_raw.height !== h)
        {
            los_raw.width = los_soft.width = w;
            los_raw.height = los_soft.height = h;
            los_sig = null;
        }

        // signature of the visible set so the mask is only redrawn on change
        var sig = vx + "," + vy + "," + cols + "," + rows + ":";
        var bits = [];
        var any = false;
        for (var y = vy; y < vy + rows; y++)
        {
            var rbits = "";
            for (var x = vx; x < vx + cols; x++)
            {
                var t = map_knowledge.get(x, y).t;
                var seen = t && t.bg !== undefined && !(lo(t.bg) & UNSEEN_BITS);
                rbits += seen ? "1" : "0";
                any = any || seen;
            }
            bits.push(rbits);
        }
        if (!any) return null;   // e.g. before the first map update
        sig += bits.join("|");

        if (sig !== los_sig)
        {
            los_sig = sig;
            var g = los_raw.getContext("2d");
            g.fillStyle = "#000";
            g.fillRect(0, 0, w, h);
            g.fillStyle = "#fff";
            for (var r = 0; r < rows; r++)
            {
                var line = bits[r];
                for (var c = 0; c < cols; c++)
                    if (line.charCodeAt(c) === 49)
                        g.fillRect(c * LOS_PX, r * LOS_PX, LOS_PX, LOS_PX);
            }
            var s = los_soft.getContext("2d");
            s.fillStyle = "#000";
            s.fillRect(0, 0, w, h);
            s.filter = "blur(" + Math.round(LOS_PX * 0.7) + "px)";
            s.drawImage(los_raw, 0, 0);
            s.filter = "none";
        }

        los_result.px = (player.pos.x - vx + 0.5) / cols;
        los_result.py = (player.pos.y - vy + 0.5) / rows;
        return los_result;
    }

    api.set_los_source(los_source);

    // Debug -----------------------------------------------------------------
    function class_id(name)
    {
        var id = CLASS_ID[name || "fire"];
        if (!id) throw new Error("unknown light class; one of: "
                                 + Object.keys(CLASS_ID).join(", "));
        return id;
    }

    window.sdc_light_debug = {
        classes: function () { return Object.keys(CLASS_ID); },
        // emitters of the last drawn frame (map coords, class, factor)
        emitters: function () {
            var out = [];
            for (var i = 0; i < em_n; i++)
                out.push({ x: em_x[i], y: em_y[i], cls: CLASSES[em_c[i]].name,
                           burst: i >= last_n_static,
                           f: Math.round(em_f[i] * 100) / 100 });
            return out;
        },
        test: function (cls, x, y) {
            forced.push({ c: class_id(cls), x: x, y: y });
            return forced.length;
        },
        burst: function (cls, x, y) {
            build_tables();
            note_glow(x == null ? player.pos.x : x,
                      y == null ? player.pos.y : y,
                      class_id(cls || "white"), performance.now());
        },
        clear: function () { forced = []; reset(); },
        classify: function (idx) {
            build_tables();
            var c = cls_of[idx & 0xFFFF];
            return c ? CLASSES[c].name : null;
        },
        // all tile names mapped to a class, grouped by class (slow)
        mapping: function () {
            var out = {};
            [dngn, main, tileinfo_player].forEach(function (mod) {
                for (var name in mod)
                {
                    if (typeof mod[name] !== "number") continue;
                    var c = classify_name(name);
                    if (!c) continue;
                    var k = CLASSES[c].name;
                    (out[k] = out[k] || []).push(name);
                }
            });
            return out;
        },
        stats: function () { return $.extend({}, stats); },
        canvas: function () { return canvas; },
    };

    return {};
});
