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
//   lightning   "Lightning arcs from your <hand>!" (Lightning Rod, thunderbolt)
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
// Debug: window.sdc_wandfx_test("polymorph" | "charm" | "paralyse" |
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
    var C_WHITE = "235,245,255";

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

    function bolt(x0, y0, x1, y1, color, w)
    {
        // jagged polyline as a rotated chain of segments
        var segs = 7, px = x0, py = y0;
        var dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy);
        var nx = -dy / (len || 1), ny = dx / (len || 1);
        for (var i = 1; i <= segs; i++)
        {
            var f = i / segs, j = i === segs ? 0 : kit.rnd(-1, 1) * len * 0.06;
            var qx = x0 + dx * f + nx * j, qy = y0 + dy * f + ny * j;
            var sl = Math.sqrt((qx - px) * (qx - px) + (qy - py) * (qy - py));
            var ang = Math.atan2(qy - py, qx - px);
            spawn("left:" + px + "px;top:" + (py - w / 2) + "px;width:" + sl
                  + "px;height:" + w + "px;transform-origin:0 50%;"
                  + "background:" + kit.rgba(color, 1) + ";box-shadow:0 0 10px "
                  + kit.rgba(color, 0.9),
                  [{ transform: "rotate(" + ang + "rad)", opacity: 1 },
                   { transform: "rotate(" + ang + "rad)", opacity: 1, offset: 0.4 },
                   { transform: "rotate(" + ang + "rad)", opacity: 0 }],
                  { duration: 320, easing: "linear" });
            px = qx; py = qy;
        }
    }

    function fx_lightning(targets)
    {
        var r = kit.view_rect();
        run_grade("wandfx_zap", 150, function (k) {
            return { invert: 0.7 * (1 - k), tint: [0.8, 0.9, 1.4],
                     tint_a: 0.6 * (1 - k) };
        });
        if (kit.reduced())
        {
            spawn("left:" + r.left + "px;top:" + r.top + "px;width:" + r.width
                  + "px;height:" + r.height + "px;background:rgba(220,235,255,0.25)",
                  [{ opacity: 0.6 }, { opacity: 0 }], { duration: 300 });
            return;
        }
        // forked bolts from the top of the view to a few ground points
        var c = center();
        var n = 3;
        for (var i = 0; i < n; i++)
        {
            var x = r.left + r.width * (0.15 + 0.7 * (i + kit.rnd(0, 1)) / n);
            bolt(x, r.top, x + kit.rnd(-60, 60), r.top + r.height * kit.rnd(0.5, 1),
                 C_WHITE, 3);
        }
        spawn("left:" + r.left + "px;top:" + r.top + "px;width:" + r.width
              + "px;height:" + r.height + "px;background:rgba(200,220,255,0.35)",
              [{ opacity: 0.9 }, { opacity: 0.15, offset: 0.4 }, { opacity: 0 }],
              { duration: 500, easing: "linear" });
        (targets || []).forEach(function (m) {
            var a = tile_of(m);
            if (a) bolt(a.x + kit.rnd(-20, 20), r.top, a.x, a.y, C_YEL, 4);
        });
        ring(c.x, c.y, C_YEL, c.cw * 0.4, c.cw * 2, 400, 2);
    }

    // Dispatch ------------------------------------------------------------------

    var TILE = [
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
         function (t) {
             var hit = [];
             kit.monsters().forEach(function (m) {
                 if (hit.length < 4 && m.x !== undefined) hit.push(m);
             });
             fx_lightning(hit.slice(0, 3));
         }],
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
                      slow: mark_slow, confuse: mark_confuse,
                      sleep: mark_sleep };
        try
        {
            if (tiles[kind]) mark_at(fake, tiles[kind]);
            else if (kind === "paralyse") mark_at(fake, mark_freeze, "255,230,120");
            else if (kind === "petrify") mark_at(fake, mark_freeze, "180,180,170");
            else if (kind === "mindburst") fx_mindburst();
            else if (kind === "lightning") fx_lightning(nearest ? [nearest] : []);
        }
        catch (e) { /* fail soft */ }
    };

    return {};
});
