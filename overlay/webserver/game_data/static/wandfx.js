// Wand / evokable effects for items that do no direct damage (spellfx covers
// damage numbers): polymorph, charm/enslave, hexes (paralyse, petrify, slow,
// confuse, sleep), mindburst, Lightning Rod.
//
// Triggers (game message text via fxkit.on_message; wordings checked against
// the local crawl source: mon-poly.cc, beam.cc, spl-transloc.cc, evoke.cc):
//   polymorph   "<mon> evaporates and reforms as / changes into / grows a
//               second head / liquefies into ..."
//   charm       "<mon> is charmed!"
//   paralyse    "<mon> becomes paralysed!" / "is paralysed."
//   petrify     "<mon> begins to petrify."
//   slow        "<mon> seems to slow down."   confuse "appears confused."
//   sleep       "<mon> falls asleep!" / "looks drowsy..."
//   mindburst   "<mon> mind(s) blasted" / "is blasted smooth" / "Your mind
//               is blasted!" (Wand of Mindburst)
//   lightning   "Lightning arcs from your <hand>!" (Chain Lightning, Lightning
//               Rod): arcs from the player to the nearest monster, then
//               hop to monsters within 3 tiles, generation by generation
//   freeze      "You freeze <mon>!" (Freeze spell, spl-damage.cc; no damage
//               number): the target ices over fast, Ozo's Armour style
// Not in this crawl version (dropped): Fan of Gales, Lamp of Fire, Stone of
// Tartarus (all removed or only a rune).
//
// The target tile is the visible monster whose name appears in the message
// (longest match; "into a <name>" for polymorph, using the previous monster
// snapshot when the old name is gone); else the monster nearest the player.
// Screen effects go through api.grade (names "wandfx_*"), HP/MP bar reaction
// through api.emit("bar_pulse", "mp", "drain", "176,128,255").
//
// Layer: #sdc_wandfx (fxkit.layer). prefers-reduced-motion: no shake, no
// glitch/spiral motion; marks fade in and out statically, no screen flashes.
// Debug: window.sdc_wandfx_test("polymorph" | "charm" | "freeze" | "paralyse" |
//        "petrify" | "slow" | "confuse" | "sleep" | "mindburst" |
//        "lightning")
define(["./sdc_api", "./fxkit"], function (api, kit) {
    "use strict";

    var MAX_LIVE = 40;
    var snap = [], snap_t = 0;       // previous monster snapshot
    var envs = [];                   // grade envelopes {name, t0, dur, fn}

    var C_PINK = "255,120,200", C_VIOLET = "176,128,255";
    var C_ICE = "170,225,255", C_BLUE = "70,150,255";
    var C_YEL = "255,235,130";

    // Helpers -----------------------------------------------------------------

    function layer() { return kit.layer("wandfx"); }

    // short-lived element in our layer, removed when it ends (capped)
    function spawn(css, frames, opts)
    {
        return kit.spawn("wandfx", css, frames, opts, MAX_LIVE);
    }

    // run a screen grade for dur ms: fn(k 0..1) -> grade object
    function run_grade(name, dur, fn)
    {
        if (kit.reduced()) return;
        for (var i = envs.length - 1; i >= 0; i--)
            if (envs[i].name === name) envs.splice(i, 1);
        envs.push({ name: name, t0: kit.now(), dur: dur, fn: fn });
    }

    api.on("frame", function () {
        if (!envs.length) return;
        var t = kit.now();
        for (var i = envs.length - 1; i >= 0; i--)
        {
            var e = envs[i], k = (t - e.t0) / e.dur;
            if (k >= 1)
            {
                api.grade(e.name, null);
                envs.splice(i, 1);
            }
            else
            {
                var g = null;
                try { g = e.fn(Math.max(0, k)); } catch (x) { g = null; }
                api.grade(e.name, g);
            }
        }
    });

    function clear_grades()
    {
        envs.forEach(function (e) { api.grade(e.name, null); });
        envs = [];
    }

    function center()
    {
        var p = kit.player_pos();
        var a = p && kit.anchor_of(p);
        if (a) return a;
        var r = kit.view_rect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2,
                 cw: 32, ch: 32 };
    }

    function ring(x, y, color, r0, r1, ms, w, delay)
    {
        spawn("left:" + (x - r0) + "px;top:" + (y - r0) + "px;width:"
              + (2 * r0) + "px;height:" + (2 * r0) + "px;border-radius:50%;"
              + "box-sizing:border-box;border:" + (w || 2) + "px solid "
              + kit.rgba(color, 0.9) + ";box-shadow:0 0 10px "
              + kit.rgba(color, 0.6),
              [{ transform: "scale(1)", opacity: 0.9 },
               { transform: "scale(" + (r1 / r0) + ")", opacity: 0 }],
              { duration: ms, delay: delay || 0, easing: "ease-out" });
    }

    function far_reach()
    {
        var r = kit.view_rect();
        return Math.sqrt(r.width * r.width + r.height * r.height) / 2;
    }

    // Targets -----------------------------------------------------------------

    function snapshot()
    {
        var t = kit.now();
        if (t - snap_t < 250) return;
        snap_t = t;
        var m = kit.monsters();
        if (m.length) snap = m;
    }
    api.on("frame", snapshot);

    function find_target(text, extra_pat)
    {
        var low = text.toLowerCase();
        var best = null, bl = 0;
        var lists = [kit.monsters(), snap];
        for (var li = 0; li < lists.length && !best; li++)
            lists[li].forEach(function (m) {
                var n = m.name.replace(/^(the|a|an) /, "");
                if (n.length > bl && low.indexOf(n) >= 0)
                {
                    best = m;
                    bl = n.length;
                }
            });
        if (extra_pat)
        {
            var mm = extra_pat.exec(low);
            if (mm && mm[1])
                kit.monsters().forEach(function (m) {
                    if (m.name.indexOf(mm[1].trim()) >= 0
                        && m.name.length > 0 && !best_is(best, m))
                        best = best || m;
                });
        }
        if (best) return best;
        return kit.nearest_monster();
    }
    function best_is(a, b) { return a && b && a.x === b.x && a.y === b.y; }

    function tile_of(m)
    {
        return m ? kit.anchor_of({ x: m.x, y: m.y }) : null;
    }

    // Per-tile marks ----------------------------------------------------------

    function mark_polymorph(a)
    {
        var s = Math.max(a.cw, a.ch);
        var cols = ["255,60,120", "60,255,200", "255,240,80", "170,100,255"];
        var n = kit.reduced() ? 1 : 4;
        for (var i = 0; i < n; i++)
        {
            var dx = kit.rnd(-0.18, 0.18) * s, dy = kit.rnd(-0.5, 0.5) * s;
            spawn("left:" + (a.x - s * 0.5) + "px;top:" + (a.y - s * 0.07)
                  + "px;width:" + s + "px;height:" + (s * 0.14) + "px;"
                  + "background:" + kit.rgba(cols[i % 4], 0.6)
                  + ";mix-blend-mode:screen",
                  [{ transform: kit.at(-dx * 3, dy) + "scaleX(1.3)", opacity: 0 },
                   { transform: kit.at(dx, dy * 0.6) + "scaleX(0.9)", opacity: 0.9, offset: 0.35 },
                   { transform: kit.at(-dx * 2, dy * 0.3) + "scaleX(1.2)", opacity: 0.8, offset: 0.7 },
                   { transform: kit.at(0, 0) + "scaleX(1)", opacity: 0 }],
                  { duration: 620, delay: i * 70, easing: "steps(6)" });
        }
        ring(a.x, a.y, C_VIOLET, s * 0.3, s * 1.1, 560, 2, 120);
        // hue-cycling glow block over the tile
        var el = spawn("left:" + (a.x - s / 2) + "px;top:" + (a.y - s / 2)
                       + "px;width:" + s + "px;height:" + s + "px;"
                       + "background:rgba(255,255,255,0.35);mix-blend-mode:color",
                       [{ filter: "hue-rotate(0deg)", opacity: 0.9 },
                        { filter: "hue-rotate(540deg)", opacity: 0.6, offset: 0.7 },
                        { filter: "hue-rotate(720deg)", opacity: 0 }],
                       { duration: 700, easing: "linear" });
        return el;
    }

    function mark_charm(a)
    {
        var s = Math.max(a.cw, a.ch);
        ring(a.x, a.y, C_PINK, s * 0.2, s * 1.3, 700, 2);
        var n = kit.reduced() ? 2 : 5;
        for (var i = 0; i < n; i++)
        {
            var dx = kit.rnd(-0.45, 0.45) * s;
            spawn("left:" + (a.x - s * 0.2) + "px;top:" + (a.y - s * 0.2)
                  + "px;font-size:" + (s * 0.42) + "px;line-height:1;"
                  + "color:" + kit.rgba(C_PINK, 1) + ";text-shadow:0 0 6px "
                  + kit.rgba(C_PINK, 0.9),
                  [{ transform: kit.at(dx, s * 0.2) + "scale(0.5)", opacity: 0 },
                   { transform: kit.at(dx, -s * 0.2) + "scale(1)", opacity: 1, offset: 0.25 },
                   { transform: kit.at(dx * 1.4, -s * 1.1) + "scale(0.9)", opacity: 0 }],
                  { duration: 1000, delay: i * 90 }).textContent = "♥";
        }
    }

    function mark_freeze(a, color)      // paralyse / petrify: stiff lines
    {
        var s = Math.max(a.cw, a.ch);
        var n = kit.reduced() ? 3 : 6;
        for (var i = 0; i < n; i++)
        {
            var x = a.x + (i - (n - 1) / 2) * s * 0.17;
            spawn("left:" + x + "px;top:" + (a.y - s * 0.5) + "px;width:2px;"
                  + "height:" + s + "px;background:" + kit.rgba(color, 0.9)
                  + ";box-shadow:0 0 6px " + kit.rgba(color, 0.7),
                  [{ transform: "scaleY(0)", opacity: 0 },
                   { transform: "scaleY(1)", opacity: 0.95, offset: 0.2 },
                   { transform: "scaleY(1)", opacity: 0.7, offset: 0.7 },
                   { transform: "scaleY(1)", opacity: 0 }],
                  { duration: 900, delay: i * 25, easing: "linear" });
        }
        spawn("left:" + (a.x - s / 2) + "px;top:" + (a.y - s / 2) + "px;"
              + "width:" + s + "px;height:" + s + "px;box-sizing:border-box;"
              + "border:2px solid " + kit.rgba(color, 0.85),
              [{ opacity: 0 }, { opacity: 0.9, offset: 0.15 }, { opacity: 0 }],
              { duration: 900, easing: "linear" });
    }

    function mark_slow(a)
    {
        var s = Math.max(a.cw, a.ch);
        for (var i = 0; i < 3; i++)
            ring(a.x, a.y, C_BLUE, s * 0.9, s * 0.2, 1100, 2, i * 260);
    }

    function mark_confuse(a)
    {
        var s = Math.max(a.cw, a.ch);
        var n = kit.reduced() ? 2 : 4;
        for (var i = 0; i < n; i++)
        {
            var el = spawn("left:" + (a.x - 4) + "px;top:" + (a.y - s * 0.55)
                           + "px;width:8px;height:8px;border-radius:50%;"
                           + "background:" + kit.rgba(C_YEL, 1)
                           + ";box-shadow:0 0 6px " + kit.rgba(C_YEL, 0.9),
                           [{ transform: kit.at(s * 0.4, 0), opacity: 0 },
                            { transform: kit.at(0, s * 0.08), opacity: 1, offset: 0.25 },
                            { transform: kit.at(-s * 0.4, 0), opacity: 1, offset: 0.5 },
                            { transform: kit.at(0, -s * 0.08), opacity: 1, offset: 0.75 },
                            { transform: kit.at(s * 0.4, 0), opacity: 0 }],
                           { duration: 1100, delay: i * 140, easing: "linear" });
            if (el) el.style.top = (a.y - s * 0.55) + "px";
        }
    }

    function mark_sleep(a)
    {
        var s = Math.max(a.cw, a.ch);
        for (var i = 0; i < 3; i++)
        {
            var el = spawn("left:" + (a.x + s * 0.1) + "px;top:" + (a.y - s * 0.5)
                           + "px;font:bold " + (s * (0.3 + i * 0.1))
                           + "px monospace;color:" + kit.rgba(C_ICE, 1)
                           + ";text-shadow:0 0 6px " + kit.rgba(C_BLUE, 0.9),
                           [{ transform: kit.at(0, 0), opacity: 0 },
                            { transform: kit.at(s * 0.2, -s * 0.3), opacity: 1, offset: 0.3 },
                            { transform: kit.at(s * 0.5, -s * 0.9), opacity: 0 }],
                           { duration: 1400, delay: i * 320 });
            if (el) el.textContent = "Z";
        }
    }

    // Freeze: the target ices over fast (frost closes in, Ozo-style icy
    // glow + core + twinkles), holds briefly, then thaws off in a puff
    function mark_chill(a)
    {
        var s = Math.max(a.cw, a.ch), red = kit.reduced();
        var DUR = 1500;
        var g = s * 1.9;                          // outer glow size
        spawn("left:" + (a.x - g / 2) + "px;top:" + (a.y - g / 2) + "px;"
              + "width:" + g + "px;height:" + g + "px;border-radius:50%;"
              + "background:radial-gradient(circle,rgba(150,225,255,.75) 0,"
              + "rgba(80,190,255,.55) 30%,rgba(50,140,255,.24) 55%,"
              + "rgba(50,140,255,0) 75%);mix-blend-mode:screen",
              red ? [{ opacity: 0 }, { opacity: 0.9, offset: 0.15 },
                     { opacity: 0.9, offset: 0.75 }, { opacity: 0 }]
                  : [{ transform: "scale(.5)", opacity: 0 },
                     { transform: "scale(1.06)", opacity: 1, offset: 0.12 },
                     { transform: "scale(.95)", opacity: 0.75, offset: 0.4 },
                     { transform: "scale(1.04)", opacity: 0.95, offset: 0.65 },
                     { transform: "scale(1.3)", opacity: 0 }],
              { duration: DUR, easing: "ease-out" });
        var c = s * 1.2;                          // bright frosted core
        spawn("left:" + (a.x - c / 2) + "px;top:" + (a.y - c / 2) + "px;"
              + "width:" + c + "px;height:" + c + "px;border-radius:50%;"
              + "background:radial-gradient(circle,rgba(230,250,255,.7) 0,"
              + "rgba(120,215,255,.4) 45%,rgba(110,205,255,0) 72%);"
              + "mix-blend-mode:screen",
              [{ opacity: 0 }, { opacity: 1, offset: 0.1 },
               { opacity: 0.7, offset: 0.7 }, { opacity: 0 }],
              { duration: DUR, easing: "linear" });
        if (red) return;
        // frost closing in on the target
        ring(a.x, a.y, C_ICE, s * 1.1, s * 0.35, 220, 2);
        // twinkles around the tile
        var tw = [[-0.38, -0.32], [0.36, -0.2], [-0.22, 0.38],
                  [0.24, 0.32], [0.02, -0.58]];
        tw.forEach(function (p, i) {
            spawn("left:" + (a.x + p[0] * s - 5) + "px;top:"
                  + (a.y + p[1] * s - 5) + "px;width:11px;height:11px;"
                  + "background:linear-gradient(#e8f8ff,#e8f8ff) center/1px 100% no-repeat,"
                  + "linear-gradient(#e8f8ff,#e8f8ff) center/100% 1px no-repeat;"
                  + "filter:drop-shadow(0 0 3px #bfe8ff)",
                  [{ transform: "scale(.3) rotate(0deg)", opacity: 0 },
                   { transform: "scale(1) rotate(45deg)", opacity: 1, offset: 0.45 },
                   { transform: "scale(.3) rotate(90deg)", opacity: 0 }],
                  { duration: 700, delay: 80 + i * 110, easing: "ease-in-out" });
        });
        // thaw puff at the end
        var r = s * 1.4;
        spawn("left:" + (a.x - r) + "px;top:" + (a.y - r) + "px;width:"
              + r * 2 + "px;height:" + r * 2 + "px;border-radius:50%;"
              + "background:radial-gradient(circle,rgba(220,245,255,.5) 0,"
              + "rgba(140,210,255,.28) 40%,rgba(120,190,255,0) 70%);"
              + "mix-blend-mode:screen",
              [{ opacity: 0, transform: "scale(.7)" },
               { opacity: 0.9, transform: "translateY(0) scale(.9)", offset: 0.2 },
               { opacity: 0, transform: "translateY(" + (-s * 0.25) + "px) scale(1.5)" }],
              { duration: 650, delay: DUR - 450, easing: "ease-out" });
    }

    function mark_at(m, fn, a2)
    {
        var a = tile_of(m);
        if (a) fn(a, a2);
    }

    // Screen / player effects ---------------------------------------------------

    function fx_mindburst()
    {
        api.emit("bar_pulse", "mp", "drain", C_VIOLET);
        var c = center();
        if (!kit.reduced())
            for (var i = 0; i < 3; i++)
                ring(c.x, c.y, C_VIOLET, far_reach() * (0.9 - i * 0.2),
                     c.cw * 0.4, 520, 2, i * 90);
        run_grade("wandfx_mind", 520, function (k) {
            var e = Math.sin(k * Math.PI);          // squeeze in, release out
            return { vig: [60, 20, 120], vig_a: 0.85 * e,
                     tint: [0.8, 0.7, 1], tint_a: 0.3 * e,
                     desat: 0.25 * e };
        });
    }

    // Chain Lightning's arc order (spl-damage.cc): the closest monster first,
    // then every unhit monster within ARC_DIST (Chebyshev) of each victim,
    // one generation per step. Returns [[{from:{x,y}, to:m}, ...], ...].
    var ARC_DIST = 3, MAX_ARCS = 12;
    function chain_of(mons)
    {
        var p = kit.player_pos();
        if (!p || !mons.length) return [];
        function gd(a, b)
        {
            return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        }
        var seed = null, bd = 1e9;
        mons.forEach(function (m) {
            var d = gd(m, p);
            if (d > 0 && d < bd) { bd = d; seed = m; }
        });
        if (!seed) return [];
        var seen = [seed], gens = [[{ from: p, to: seed }]], n = 1;
        var cur = [seed];
        while (cur.length && n < MAX_ARCS)
        {
            var next = [], gen = [];
            cur.forEach(function (src) {
                mons.forEach(function (m) {
                    if (n >= MAX_ARCS || seen.indexOf(m) >= 0
                        || gd(m, p) === 0 || gd(m, src) > ARC_DIST) return;
                    seen.push(m);
                    next.push(m);
                    gen.push({ from: src, to: m });
                    n++;
                });
            });
            if (gen.length) gens.push(gen);
            cur = next;
        }
        return gens;
    }

    // one jagged, flickering arc between two screen points (SVG polyline
    // with a soft blue sheath, a white core and a couple of side forks)
    function arc(x0, y0, x1, y1, delay)
    {
        var dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) return;
        var nx = -dy / len, ny = dx / len, pad = 24;
        var segs = Math.max(5, Math.round(len / 14)), pts = [], i;
        for (i = 0; i <= segs; i++)
        {
            var f = i / segs, j = (i === 0 || i === segs) ? 0
                    : kit.rnd(-1, 1) * Math.min(18, len * 0.12);
            pts.push([x0 + dx * f + nx * j, y0 + dy * f + ny * j]);
        }
        var minx = Math.min(x0, x1) - pad, miny = Math.min(y0, y1) - pad;
        function line(list)
        {
            return list.map(function (q) {
                return (q[0] - minx).toFixed(1) + "," + (q[1] - miny).toFixed(1);
            }).join(" ");
        }
        var forks = "";
        for (i = 0; i < 2; i++)
        {
            var k = 1 + Math.floor(kit.rnd(0, segs - 1)), b = pts[k];
            var side = kit.rnd(0, 1) < 0.5 ? -1 : 1, fl = kit.rnd(8, 18);
            var ex = b[0] + dx / len * fl * 0.8 + nx * side * fl;
            var ey = b[1] + dy / len * fl * 0.8 + ny * side * fl;
            forks += '<polyline points="' + line([b, [(b[0] + ex) / 2 + kit.rnd(-3, 3),
                     (b[1] + ey) / 2 + kit.rnd(-3, 3)], [ex, ey]])
                     + '" fill="none" stroke="#cfe6ff" stroke-width="1.5"/>';
        }
        var w = Math.abs(dx) + 2 * pad, h = Math.abs(dy) + 2 * pad;
        var el = spawn("left:" + minx + "px;top:" + miny + "px;width:" + w
                       + "px;height:" + h + "px",
            [[0, 0], [0.04, 1], [0.25, 0.25], [0.38, 1], [0.6, 0.15],
             [0.72, 0.85], [0.9, 0], [1, 0]].map(function (f) {
                return { offset: f[0], opacity: f[1], easing: "steps(1)" };
            }),
            { duration: 380, delay: delay, easing: "linear" });
        if (!el) return;
        el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w
            + '" height="' + h + '" style="overflow:visible;filter:'
            + 'drop-shadow(0 0 6px #6ab4ff)">'
            + '<polyline points="' + line(pts) + '" fill="none" stroke="#5aa0ff" '
            + 'stroke-width="7" stroke-opacity="0.45" stroke-linejoin="round"/>'
            + '<polyline points="' + line(pts) + '" fill="none" stroke="#fff" '
            + 'stroke-width="2.5" stroke-linejoin="round"/>' + forks + '</svg>';
    }

    function zap_flash(a, delay, big)
    {
        var s = Math.max(a.cw, a.ch) * (big ? 1.6 : 1.2);
        spawn("left:" + (a.x - s / 2) + "px;top:" + (a.y - s / 2) + "px;width:"
              + s + "px;height:" + s + "px;border-radius:50%;mix-blend-mode:screen;"
              + "background:radial-gradient(circle,rgba(235,245,255,0.95),"
              + "rgba(110,170,255,0.5) 40%,transparent 70%)",
              [{ transform: "scale(0.3)", opacity: 0 },
               { transform: "scale(1)", opacity: 1, offset: 0.15 },
               { transform: "scale(1.2)", opacity: 0 }],
              { duration: 320, delay: delay, easing: "ease-out" });
    }

    // Lightning arcs out of the player's hand to the nearest monster, then
    // hops monster to monster the way Chain Lightning actually travels.
    function fx_lightning()
    {
        run_grade("wandfx_zap", 160, function (k) {
            return { tint: [0.85, 0.95, 1.3], tint_a: 0.35 * (1 - k) };
        });
        var c = center();
        var gens = chain_of(kit.monsters());
        if (kit.reduced())
        {
            gens.forEach(function (g) {
                g.forEach(function (h) {
                    var a = tile_of(h.to);
                    if (a) zap_flash(a, 0, false);
                });
            });
            return;
        }
        var STEP = 140;
        zap_flash(c, 0, false);
        gens.forEach(function (g, gi) {
            g.forEach(function (h) {
                var a0 = gi === 0 ? c : tile_of(h.from), a1 = tile_of(h.to);
                if (!a0 || !a1) return;
                arc(a0.x, a0.y, a1.x, a1.y, gi * STEP);
                // second strand on the same hop: reads as crackling, not a line
                arc(a0.x, a0.y, a1.x, a1.y, gi * STEP + 90);
                zap_flash(a1, gi * STEP + 30, gi === 0);
            });
        });
        if (!gens.length)            // nothing in reach: a fizzle at the hand
            ring(c.x, c.y, C_ICE, c.cw * 0.3, c.cw * 1.2, 300, 2);
    }

    // Dispatch ------------------------------------------------------------------

    var TILE = [
        [/^You freeze (?!yourself)/,
         function (m) { mark_at(m, mark_chill); }],
        [/evaporates and reforms as|changes into|grows a second head|liquefies into/i,
         function (m) { mark_at(m, mark_polymorph); }, /(?:into|as) an? ([a-z' -]+)/],
        [/\bis charmed/i,
         function (m) { mark_at(m, mark_charm); }],
        [/becomes paralysed|\bis paralysed\./i,
         function (m) { mark_at(m, mark_freeze, "255,230,120"); }],
        [/begins to petrify/i,
         function (m) { mark_at(m, mark_freeze, "180,180,170"); }],
        [/seems to slow down|seems to be slow for longer/i,
         function (m) { mark_at(m, mark_slow); }],
        [/appears confused/i,
         function (m) { mark_at(m, mark_confuse); }],
        [/falls asleep!|looks drowsy/i,
         function (m) { mark_at(m, mark_sleep); }]
    ];

    var SCREEN = [
        [/mind\w* (?:is|are) blasted|blasted smooth/i,
         function () { fx_mindburst(); }],
        [/lightning arcs from your/i,
         function () { fx_lightning(); }],
    ];

    var last_fire = {};
    function once(key, gap)
    {
        var t = kit.now();
        if (t - (last_fire[key] || -1e9) < gap) return false;
        last_fire[key] = t;
        return true;
    }

    function handle(text)
    {
        try
        {
            for (var i = 0; i < TILE.length; i++)
                if (TILE[i][0].test(text))
                {
                    if (once("t" + i, 250))
                        TILE[i][1](find_target(text, TILE[i][2]));
                    return;
                }
            for (var j = 0; j < SCREEN.length; j++)
                if (SCREEN[j][0].test(text))
                {
                    if (once("s" + j, 600)) SCREEN[j][1](text);
                    return;
                }
        }
        catch (e) { /* fail soft */ }
    }

    kit.on_message(handle);

    api.on("game_cleanup", function () {
        clear_grades();
        snap = [];
    });

    window.sdc_wandfx_test = function (kind)
    {
        kind = kind || "polymorph";
        var p = kit.player_pos(), nearest = kit.nearest_monster();
        var fake = nearest ? { x: nearest.x, y: nearest.y }
                           : (p ? { x: p.x + 2, y: p.y } : null);
        var tiles = { polymorph: mark_polymorph, charm: mark_charm,
                      freeze: mark_chill,
                      slow: mark_slow, confuse: mark_confuse,
                      sleep: mark_sleep };
        try
        {
            if (tiles[kind]) mark_at(fake, tiles[kind]);
            else if (kind === "paralyse") mark_at(fake, mark_freeze, "255,230,120");
            else if (kind === "petrify") mark_at(fake, mark_freeze, "180,180,170");
            else if (kind === "mindburst") fx_mindburst();
            else if (kind === "lightning") fx_lightning();
        }
        catch (e) { /* fail soft */ }
    };

    return {};
});
