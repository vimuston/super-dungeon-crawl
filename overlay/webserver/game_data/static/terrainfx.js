// Terrain effects: passwall ripples, apportation beam and digging debris. Everything is a small DOM overlay in the
// shared fxkit layers (tile positions go through fxkit.anchor_of, so they
// follow the curved CRT screen).
//
// Triggers
//   Passwall      no game message exists, so: the player moved and the tile
//                 left / entered (or any tile between) is a wall tile (wall
//                 tiles are remembered from map_knowledge). Each wall tile
//                 gets stone rings + a sheen, tinted by the wall type
//                 (stone, crystal, ice, metal, slime, ...), staggered along
//                 the walked path.
//   Apportation   message "Yoink! You pull the item(s) towards yourself."
//                 The source is the tile that lost an item in the last ~2.5 s
//                 (map_knowledge diff); a tractor beam of dashes and a
//                 travelling orb runs from there to the player.
//   Digging       a map diff: a tile that was a wall and is now floor/rubble
//                 (Dig, wand of digging, Shatter, Lee's Rapid Deconstruction).
//                 Per batch: cracks race from the player along the dug tiles,
//                 dust sprays along the line and debris falls at each tile.
//
// Quiet on level change and for ~1.5 s after one (map redraws look like diffs).
// Reduced motion: single soft fade per event, no particles.
// Layers: #sdc_terrainfx (transient fx), via fxkit.
// Debug: window.sdc_terrainfx_test("passwall"|"apport"|
//        "dig"|"clear", x, y)   (x, y map coords, default: next to the player)
define(["./sdc_api", "./fxkit", "./map_knowledge", "./player", "./tileinfo-dngn"],
function (api, kit, map_knowledge, player, dngn) {
    "use strict";

    var MAX_LIVE = 70;            // transient fx elements alive at once
    var SETTLE = 1500;            // quiet ms after a level change
    var BATCH_MAX = 25;           // more wall->floor diffs than this = redraw
    var UNSEEN_BITS = 0x00020000 | 0x00040000;  // MM_UNSEEN | UNSEEN

    var APPORT_RE = /^Yoink! You pull the items? /;

    // Tile tables -------------------------------------------------------------
    // bg tile index -> wall tint id (0 = not a wall) / floor-like flag.
    var TINTS = [null,
        "176,168,150",     // 1 stone / rock
        "170,226,255",     // 2 crystal
        "190,236,255",     // 3 ice
        "170,186,205",     // 4 metal
        "140,220,110",     // 5 slime
        "210,120,80"];     // 6 hot rock / lava
    var wall_of = null, floor_of = null;

    function lo(v)
    {
        if (typeof v === "number") return v;
        return v && v.length ? v[0] : 0;
    }

    function wall_tint_of(name)
    {
        if (/CRYSTAL/.test(name)) return 2;
        if (/ICE|FRIGID|ICY/.test(name)) return 3;
        if (/METAL|IRON|STEEL|ZOT/.test(name)) return 4;
        if (/SLIME|SLIMY/.test(name)) return 5;
        if (/LAVA|VOLCAN|HELL|GEHENNA|BRIMSTONE/.test(name)) return 6;
        return 1;
    }

    function build_tables()
    {
        if (wall_of) return;
        var max = 0, pairs = [], name, v;
        for (name in dngn)
        {
            v = dngn[name];
            if (typeof v !== "number" || !/^[A-Z][A-Z0-9_]*$/.test(name)
                || /(^|_)MAX$|_LOW$|_MID$|_HIGH$/.test(name)) continue;
            pairs.push([v, name]);
            if (v > max) max = v;
        }
        wall_of = new Uint8Array(max + 1);
        floor_of = new Uint8Array(max + 1);
        pairs.forEach(function (p) {
            var n = p[1].replace(/(_\d+)+$/, "");
            if (/(^|_)WALL(_|$)|^DNGN_(PERMAROCK|ROCK)|ROCK_WALL/.test(n)
                && !/DOOR|TORCH|OVERLAY|GONE|PORTAL|STATUE|GATE|ALTAR|SHADOW/.test(n))
                wall_of[p[0]] = wall_of[p[0]] || wall_tint_of(n);
            else if (/FLOOR|RUBBLE/.test(n) && !/WALL|OVERLAY/.test(n))
                floor_of[p[0]] = 1;
        });
    }

    function bg_idx(t)
    {
        return t && t.bg !== undefined ? (lo(t.bg) & 0xFFFF) : 0;
    }

    function seen_bg(t)
    {
        return t && t.bg !== undefined && !(lo(t.bg) & UNSEEN_BITS);
    }

    // Per-level state ---------------------------------------------------------
    var level_key = null, key_time = 0;
    var walls = {};               // cell key -> tint id of remembered walls
    var items = {};               // cell key -> 1 while a non-monster fg shows
    var lost = [];                // [{x, y, t}] cells that just lost an item
    var last_pos = null;
    var dug_pending = [];         // wall->floor cells awaiting the next flush
    var dug_timer = 0;
    var init_time = 0;

    function ckey(x, y) { return (y + 512) * 2048 + (x + 512); }

    function settled()
    {
        return kit.now() - key_time > SETTLE && kit.now() - init_time > SETTLE;
    }

    function clear_level()
    {
        walls = {};
        items = {};
        lost = [];
        last_pos = null;
        dug_pending = [];
    }

    function check_level()
    {
        var key = player.place + ":" + player.depth;
        if (key === level_key) return;
        level_key = key;
        key_time = kit.now();
        clear_level();
    }

    // Helpers -----------------------------------------------------------------

    function tile_anchor(x, y) { return kit.anchor_of({ x: x, y: y }); }

    // Transform string for an offset animation keyframe around (cx, cy).
    function fr(cx, cy, w, h, dx, dy, s, rot, o, offset)
    {
        var f = { transform: kit.at(cx - w / 2 + dx, cy - h / 2 + dy)
                  + "rotate(" + (rot || 0) + "deg) scale(" + s + ")",
                  opacity: o };
        if (offset !== undefined) f.offset = offset;
        return f;
    }

    // Spawn one transient element, auto-removed when its animation ends.
    function spawn(css, w, h, frames, opts)
    {
        return kit.spawn("terrainfx", "width:" + w + "px;height:" + h
                         + "px;" + css, frames, opts, MAX_LIVE);
    }

    function line(a, b)
    {
        var out = [], x = a.x, y = a.y;
        var dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
        var sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
        var err = dx - dy, n = 0;
        while (n++ < 40)
        {
            out.push({ x: x, y: y });
            if (x === b.x && y === b.y) break;
            var e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x += sx; }
            if (e2 < dx) { err += dx; y += sy; }
        }
        return out;
    }

    // Soft one-shot glow used by reduced motion
    function calm(an, rgb)
    {
        if (!an) return;
        var d = Math.max(an.cw, an.ch);
        spawn("border-radius:50%;background:radial-gradient(circle,"
              + kit.rgba(rgb, 0.55) + ",transparent 70%)", d, d,
              [fr(an.x, an.y, d, d, 0, 0, 1, 0, 0),
               fr(an.x, an.y, d, d, 0, 0, 1, 0, 0.8, 0.3),
               fr(an.x, an.y, d, d, 0, 0, 1, 0, 0)],
              { duration: 600, easing: "linear" });
    }

    // Passwall ---------------------------------------------------------------

    function ripple(x, y, tint, delay)
    {
        var an = tile_anchor(x, y);
        if (!an) return;
        var rgb = TINTS[tint] || TINTS[1];
        if (kit.reduced()) { calm(an, rgb); return; }
        var s = Math.round(an.cw * 0.9), i;
        // liquid-looking sheen first, then three expanding rings
        spawn("border-radius:50%;mix-blend-mode:screen;background:"
              + "radial-gradient(circle," + kit.rgba(rgb, 0.65) + ","
              + kit.rgba(rgb, 0.2) + " 55%,transparent 75%)", s, s,
              [fr(an.x, an.y, s, s, 0, 0, 0.5, 0, 0),
               fr(an.x, an.y, s, s, 0, 0, 1.25, 0, 0.9, 0.35),
               fr(an.x, an.y, s, s, 0, 0, 1.6, 0, 0)],
              { duration: 700, delay: delay, easing: "ease-out" });
        for (i = 0; i < 3; i++)
        {
            spawn("border-radius:50%;box-sizing:border-box;border:2px solid "
                  + kit.rgba(rgb, 0.85) + ";box-shadow:0 0 8px "
                  + kit.rgba(rgb, 0.6) + ",inset 0 0 6px " + kit.rgba(rgb, 0.4),
                  s, s,
                  [fr(an.x, an.y, s, s, 0, 0, 0.25, 0, 0.9),
                   fr(an.x, an.y, s, s, 0, 0, 1.9 + i * 0.3, 0, 0)],
                  { duration: 650 + i * 120, delay: delay + i * 140,
                    easing: "cubic-bezier(.15,.6,.3,1)" });
        }
    }

    function passwall_step(a, b)
    {
        var path = line(a, b), n = 0;
        for (var i = 0; i < path.length; i++)
        {
            var p = path[i];
            var tint = walls[ckey(p.x, p.y)];
            if (!tint)
            {
                var mc = map_knowledge.get(p.x, p.y);
                tint = mc && mc.t ? wall_of[bg_idx(mc.t)] : 0;
            }
            if (tint) ripple(p.x, p.y, tint, n++ * 110);
            if (n > 8) break;
        }
    }

    // Apportation ---------------------------------------------

    function recent_loss()
    {
        var t = kit.now(), pp = kit.player_pos(), best = null;
        for (var i = lost.length - 1; i >= 0; i--)
        {
            var l = lost[i];
            if (t - l.t > 2500) break;
            if (pp && l.x === pp.x && l.y === pp.y) continue;
            best = l;
            break;
        }
        return best;
    }

    function tractor(src, dst)
    {
        var A = tile_anchor(src.x, src.y), B = tile_anchor(dst.x, dst.y);
        if (!A || !B) return;
        var rgb = "120,230,255";
        if (kit.reduced())
        {
            calm(B, rgb);
            return;
        }
        var dx = B.x - A.x, dy = B.y - A.y;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len < 4) { calm(B, rgb); return; }
        var ang = Math.atan2(dy, dx) * 180 / Math.PI;
        var th = Math.max(5, Math.round(A.ch * 0.2));
        // dashed beam, dashes marching toward the player
        var beam = spawn("transform-origin:0 50%;mix-blend-mode:screen;"
            + "background:repeating-linear-gradient(90deg," + kit.rgba(rgb, 0.9)
            + " 0,rgba(235,252,255,0.95) 7px,transparent 7px,transparent 16px);"
            + "background-size:16px 100%;box-shadow:0 0 8px " + kit.rgba(rgb, 0.7),
            len, th,
            [{ transform: "translate(" + A.x + "px," + (A.y - th / 2)
                          + "px) rotate(" + ang + "deg) scaleX(0.05)",
               opacity: 0 },
             { transform: "translate(" + A.x + "px," + (A.y - th / 2)
                          + "px) rotate(" + ang + "deg) scaleX(1)",
               opacity: 0.95, offset: 0.2 },
             { transform: "translate(" + A.x + "px," + (A.y - th / 2)
                          + "px) rotate(" + ang + "deg) scaleX(1)",
               opacity: 0.8, offset: 0.75 },
             { transform: "translate(" + A.x + "px," + (A.y - th / 2)
                          + "px) rotate(" + ang + "deg) scaleX(1)",
               opacity: 0 }],
            { duration: 620, easing: "linear" });
        if (beam)
            try
            {
                beam.animate([{ backgroundPosition: "0 0" },
                              { backgroundPosition: "-80px 0" }],
                             { duration: 620, easing: "linear" });
            }
            catch (e) { /* cosmetic */ }
        // travelling orb
        var o = Math.max(8, Math.round(A.cw * 0.3));
        spawn("border-radius:50%;mix-blend-mode:screen;background:"
              + "radial-gradient(circle,#fff," + kit.rgba(rgb, 0.8)
              + " 50%,transparent 75%)", o, o,
              [fr(A.x, A.y, o, o, 0, 0, 0.6, 0, 0.9),
               fr(A.x, A.y, o, o, dx, dy, 1.2, 0, 1, 0.85),
               fr(A.x, A.y, o, o, dx, dy, 2.2, 0, 0)],
              { duration: 560, easing: "cubic-bezier(.5,0,.9,.6)" });
        // source ring and arrival ring
        [[A, 0, 1.5, 0.3], [B, 480, 0.3, 1.6]].forEach(function (r) {
            var s = Math.round(r[0].cw * 0.9);
            spawn("border-radius:50%;box-sizing:border-box;border:2px solid "
                  + kit.rgba(rgb, 0.9) + ";box-shadow:0 0 8px " + kit.rgba(rgb, 0.7),
                  s, s,
                  [fr(r[0].x, r[0].y, s, s, 0, 0, r[2], 0, 0.9),
                   fr(r[0].x, r[0].y, s, s, 0, 0, r[3], 0, 0)],
                  { duration: 420, delay: r[1] });
        });
    }

    function apport()
    {
        var pp = kit.player_pos(), src = recent_loss();
        if (!pp) return;
        if (src) tractor(src, pp);
        else calm(tile_anchor(pp.x, pp.y), "120,230,255");
    }

    // Digging -----------------------------------------------------------------

    function dig_burst(cells)
    {
        var pp = kit.player_pos();
        cells = cells.slice(0, 12);
        if (!cells.length) return;
        if (pp)
            cells.sort(function (a, b) {
                return Math.max(Math.abs(a.x - pp.x), Math.abs(a.y - pp.y))
                     - Math.max(Math.abs(b.x - pp.x), Math.abs(b.y - pp.y));
            });
        var reduced = kit.reduced();
        var P = pp ? tile_anchor(pp.x, pp.y) : null;
        var prev = P ? { x: P.x, y: P.y } : null;
        var dust = "205,185,150";
        cells.forEach(function (c, i) {
            var an = tile_anchor(c.x, c.y);
            if (!an) return;
            var tint = c.tint || 1, rgb = TINTS[tint] || TINTS[1];
            if (reduced) { calm(an, dust); return; }
            var delay = i * 70, j;
            // crack racing in from the previous tile
            if (prev)
            {
                var dx = an.x - prev.x, dy = an.y - prev.y;
                var len = Math.sqrt(dx * dx + dy * dy);
                if (len > 3)
                {
                    var ang = Math.atan2(dy, dx) * 180 / Math.PI;
                    var tr = "translate(" + prev.x + "px," + prev.y + "px) rotate("
                             + ang + "deg) ";
                    spawn("transform-origin:0 50%;background:linear-gradient(90deg,"
                          + "rgba(255,240,210,0.95)," + kit.rgba(rgb, 0.7)
                          + ");box-shadow:0 0 6px rgba(255,225,170,0.8)",
                          len, 2,
                          [{ transform: tr + "scaleX(0)", opacity: 1 },
                           { transform: tr + "scaleX(1)", opacity: 1, offset: 0.4 },
                           { transform: tr + "scaleX(1)", opacity: 0 }],
                          { duration: 450, delay: delay, easing: "ease-out" });
                }
            }
            prev = { x: an.x, y: an.y };
            // dust puffs rising off the tile
            for (j = 0; j < 3; j++)
            {
                var d = Math.round(an.cw * kit.rnd(0.7, 1.1));
                var ox = kit.rnd(-0.3, 0.3) * an.cw;
                spawn("border-radius:50%;background:radial-gradient(circle,"
                      + kit.rgba(dust, 0.75) + "," + kit.rgba(dust, 0.25)
                      + " 55%,transparent 72%)", d, d,
                      [fr(an.x, an.y, d, d, ox, 0, 0.4, 0, 0),
                       fr(an.x, an.y, d, d, ox, -an.ch * 0.25, 0.9, 0, 0.85, 0.3),
                       fr(an.x, an.y, d, d, ox * 1.5, -an.ch * 0.8, 1.5, 0, 0)],
                      { duration: kit.rnd(650, 950), delay: delay + j * 60,
                        easing: "ease-out" });
            }
            // falling debris
            for (j = 0; j < 5; j++)
            {
                var sz = Math.max(3, Math.round(an.cw * kit.rnd(0.08, 0.16)));
                var px = kit.rnd(-0.4, 0.4) * an.cw;
                var drift = px * kit.rnd(0.6, 1.8);
                spawn("background:" + kit.rgba(rgb, 0.95)
                      + ";box-shadow:inset -1px -1px 0 rgba(0,0,0,0.35)",
                      sz, sz,
                      [fr(an.x, an.y, sz, sz, px, -an.ch * 0.45, 1, 0, 0),
                       fr(an.x, an.y, sz, sz, px, -an.ch * 0.4, 1,
                          kit.rnd(-40, 40), 1, 0.1),
                       fr(an.x, an.y, sz, sz, drift, an.ch * 0.55, 0.8,
                          kit.rnd(-260, 260), 0)],
                      { duration: kit.rnd(520, 780), delay: delay + j * 40,
                        easing: "cubic-bezier(.4,0,.9,.6)" });
            }
        });
        // dust spray along the line from the player to the last dug tile
        if (!reduced && pp)
        {
            var path = line(pp, cells[cells.length - 1]);
            for (var k = 1; k < path.length && k < 10; k++)
            {
                var pa = tile_anchor(path[k].x, path[k].y);
                if (!pa) continue;
                var s = Math.round(pa.cw * 0.55);
                spawn("border-radius:50%;background:" + kit.rgba(dust, 0.5),
                      s, s,
                      [fr(pa.x, pa.y, s, s, 0, 0, 0.3, 0, 0),
                       fr(pa.x, pa.y, s, s, kit.rnd(-6, 6), -pa.ch * 0.2, 1, 0, 0.7, 0.3),
                       fr(pa.x, pa.y, s, s, kit.rnd(-10, 10), -pa.ch * 0.5, 1.6, 0, 0)],
                      { duration: 600, delay: k * 50, easing: "ease-out" });
            }
        }
    }

    function flush_dug()
    {
        dug_timer = 0;
        var cells = dug_pending;
        dug_pending = [];
        if (!cells.length || cells.length > BATCH_MAX) return;
        try { dig_burst(cells); }
        catch (e) { console.error("sdc terrainfx:", e); }
    }

    // Map observation ---------------------------------------------------------

    function note_cell(mc, batch)
    {
        if (!mc || !mc.t) return;
        var t = mc.t, x = mc.x, y = mc.y, k = ckey(x, y);
        // walls (remembered), wall -> floor diffs
        if (seen_bg(t))
        {
            var idx = bg_idx(t), w = wall_of[idx] || 0, was = walls[k];
            if (w) walls[k] = w;
            else if (was)
            {
                delete walls[k];
                if (floor_of[idx] && settled())
                    batch.push({ x: x, y: y, tint: was });
            }
        }
        // items that vanish (apportation / corpse used)
        var fg = lo(t.fg) & 0xFFFF;
        if (fg && !mc.mon) items[k] = 1;
        else if (items[k])
        {
            delete items[k];
            lost.push({ x: x, y: y, t: kit.now() });
            if (lost.length > 8) lost.shift();
        }
    }

    kit.on_merge(function () {
        if (!wall_of) return;
        check_level();
        var dirty = map_knowledge.dirty(), batch = [];
        for (var i = 0; i < dirty.length; i++)
            note_cell(map_knowledge.get(dirty[i].x, dirty[i].y), batch);
        if (batch.length)
        {
            dug_pending = dug_pending.concat(batch);
            if (!dug_timer)
                dug_timer = window.setTimeout(flush_dug, 90);
        }
    });

    // Messages and frames -----------------------------------------------------

    kit.on_message(function (text) {
        try
        {
            if (APPORT_RE.test(text))
                window.setTimeout(apport, 120);
        }
        catch (e) { console.error("sdc terrainfx:", e); }
    });

    api.on("frame", function () {
        try
        {
            if (!wall_of) return;
            check_level();
            var pp = kit.player_pos();
            if (pp && settled())
            {
                if (last_pos && (pp.x !== last_pos.x || pp.y !== last_pos.y)
                    && Math.max(Math.abs(pp.x - last_pos.x),
                                Math.abs(pp.y - last_pos.y)) <= 12)
                    passwall_step(last_pos, pp);
            }
            last_pos = pp;
        }
        catch (e) { console.error("sdc terrainfx:", e); }
    });

    api.on("game_init", function () {
        init_time = kit.now();
        level_key = null;
        clear_level();
        if (dug_timer) { window.clearTimeout(dug_timer); dug_timer = 0; }
        build_tables();
    });

    api.on("game_cleanup", function () {
        if (dug_timer) { window.clearTimeout(dug_timer); dug_timer = 0; }
        clear_level();
    });

    try { build_tables(); }
    catch (e) { console.error("sdc terrainfx init:", e); }

    // Debug -------------------------------------------------------------------

    window.sdc_terrainfx_test = function (kind, x, y)
    {
        var pp = kit.player_pos();
        if (!pp) return "no player";
        if (typeof x !== "number") { x = pp.x + 2; y = pp.y; }
        switch (kind)
        {
        case "passwall":
            for (var i = 0; i < 5; i++)
                ripple(pp.x + 1 + i, pp.y, 1 + (i % 6), i * 110);
            break;
        case "apport":
            tractor({ x: x, y: y }, pp);
            break;
        case "dig":
            dig_burst([{ x: x, y: y, tint: 1 }, { x: x + 1, y: y, tint: 1 },
                       { x: x + 2, y: y, tint: 1 }]);
            break;
        case "clear":
            clear_level();
            break;
        default:
            return "kinds: passwall apport dig clear";
        }
        return kind;
    };

    return {};
});
