// Martial god effects: Okawaru, Beogh, Qazlal, Wu Jian, Uskayaw.
//
//   Okawaru   Hero / Finesse status lights: a blue (Hero) or gold (Finesse)
//             halo, speed lines and fading afterimages of the player sprite
//             while moving. "Duel" light: an arena ring around the player and
//             the dueled monster with the rest of the view dimmed (a
//             spotlight overlay plus an api.grade vignette) for its duration.
//   Beogh     Smiting: a lightning fist drops onto the target tile. Recall
//             Apostles: call-lines from the player to each recalled follower.
//             Blood for Blood: a red burst and, while the "Pray" light is on,
//             rising embers and a warm tint.
//   Qazlal    Upheaval (element from the message: fire / ice / air / stone),
//             Elemental Force (rings of the four elements around the player),
//             Disaster Area (random-element flicker): elemental rings,
//             particles and a short screen tint by element.
//   Wu Jian   Lunge / Wall Jump: a golden dash trail along the path and an
//             impact flash on the target. Whirlwind: a spiral through the
//             cleared path. Heavenly Storm ("Heavenly (n)" light): golden
//             storm clouds along the screen top with bolts falling.
//   Uskayaw   Stomp: a short screen shake. Grand Finale: a spotlight cone of light-map emitters.
//
// Triggers (strings verified against the local crawl source in WSL,
// ~/dcss-crt-build/crawl, god-abil.cc / god-passive.cc / duration-data.h):
//   status lights  "Hero", "Finesse", "Duel", "Pray" (blood for blood),
//                  "Heavenly (n)"
//   messages       "You enter into single combat with X!", "You smite X",
//                  "X is recalled by the power of Beogh.",
//                  "Your apostles return to your side.",
//                  "You place your hand atop X's lifeless body and utter a
//                  vengeful prayer.", "Magma suddenly erupts from the
//                  ground!", "A blizzard blasts the area with ice!",
//                  "A storm cloud blasts the area with cutting wind!",
//                  "The ground shakes violently, spewing rubble!",
//                  "Clouds arounds you coalesce and take form!" (sic),
//                  "Nature churns violently around you!", "You lunge ... at
//                  X", "You spin and attack X" (whirlwind), "You attack X
//                  from above" (wall jump), "The air is filled with shimmering
//                  golden clouds!", "You stomp with the beat ...".
// Heuristic (no message exists): Wall Jump = the player moves exactly two
// cells in a straight line in one frame while worshipping Wu Jian. Audience and
// Wu Jian's "Martial Strike" are not in this crawl version (martial strikes
// show as lunge/whirlwind); the finale spotlight keys on "X explodes
// violently" while worshipping Uskayaw.
// Upheaval's target is not in any message: the nearest visible monster is used
// as the centre, else the player.
//
// Layer: #sdc_godfx_martial (fixed, z-index 4). Status effects live in the
// shared status-aura layer through statusfx.
// Debug: window.sdc_godfx_martial_test("okawaru" | "beogh" | "qazlal" |
//        "wujian" | "uskayaw"), or one effect: "hero" "finesse" "duel"
//        "smite" "recall" "bfb" "fire" "ice" "air" "stone" "force" "disaster"
//        "lunge" "walljump" "whirlwind" "storm" "stomp" "audience"
define(["./sdc_api", "./fxkit", "./statusfx", "./player"],
function (api, kit, statusfx, player) {
    "use strict";

    var MAX_LIVE = 60;         // elements alive at once, all effects together
    var STOMP_MS = 380;        // Uskayaw stomp shake
    var SPOT_MS = 2200;        // Uskayaw grand finale spotlight

    var C_HERO = "110,170,255";
    var C_GOLD = "255,214,110";
    var C_WHITE = "255,255,255";
    var C_BEOGH = "255,170,60";
    var C_BLOOD = "255,70,50";
    var C_STORM = "255,226,140";
    var C_MAG = "255,90,200";
    var C_CYAN = "100,235,255";
    var ELEM = {
        fire:  { c: "255,120,40",  tint: [1, 0.72, 0.5] },
        ice:   { c: "150,220,255", tint: [0.7, 0.9, 1] },
        stone: { c: "200,165,110", tint: [0.92, 0.82, 0.62] },
        air:   { c: "215,228,255", tint: [0.88, 0.94, 1] }
    };
    var ELEM_NAMES = ["fire", "ice", "stone", "air"];

    var live = 0;
    var timers = [];
    var hist = [];             // recent player positions [{x, y, t}]
    var last_pos = null, last_key = null;
    var duel_name = null;
    var recall_names = [], recall_timer = 0;
    var tint = null;           // {el, t0, dur, a}  qazlal screen tint

    // Helpers -----------------------------------------------------------------

    function layer() { return kit.layer("godfx_martial"); }

    function later(ms, fn)
    {
        var id = window.setTimeout(function () {
            var i = timers.indexOf(id);
            if (i >= 0) timers.splice(i, 1);
            try { fn(); } catch (e) { console.error("sdc godfx_martial:", e); }
        }, ms);
        timers.push(id);
        return id;
    }

    function track(el, life)
    {
        live++;
        later(life + 60, function () {
            live--;
            if (el.parentNode) el.parentNode.removeChild(el);
        });
        return el;
    }

    // absolutely positioned box, w x h px, class cls; null when over budget
    function spawn(parent, cls, w, h, css, life)
    {
        if (live >= MAX_LIVE) return null;
        var el = kit.mk(parent, "width:" + w + "px;height:" + h + "px;"
                                + (css || ""));
        el.className = cls;
        return track(el, life);
    }

    function dist(p, q)
    {
        return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
    }

    function god()
    {
        return String((player && player.god) || "").toLowerCase();
    }

    function find_mon(name)
    {
        var me = kit.player_pos();
        var want = String(name || "").toLowerCase().replace(/^(the|a|an) /, "")
                       .replace(/[.!,]+$/, "").trim();
        var best = null, bd = 1e9;
        kit.monsters().forEach(function (m) {
            if (want && m.name.indexOf(want) < 0 && want.indexOf(m.name) < 0)
                return;
            var d = me ? dist(m, me) : 0;
            if (d < bd) { bd = d; best = m; }
        });
        return best;
    }

    function nearest_mon()
    {
        return find_mon("");
    }

    function jitter(a) { return kit.rnd(-a, a); }

    // Building blocks ---------------------------------------------------------

    // expanding ring, `tiles` = final radius in tiles
    function ring(a, rgb, tiles, dur, thick)
    {
        var w = tiles * 2 * a.cw, h = tiles * 2 * a.ch;
        var el = spawn(layer(), "gm-ring", w, h,
            "border-width:" + (thick || 2) + "px;border-color:"
            + kit.rgba(rgb, 0.9) + ";box-shadow:0 0 12px " + kit.rgba(rgb, 0.6)
            + ",inset 0 0 10px " + kit.rgba(rgb, 0.4) + ";", dur);
        if (!el) return;
        var base = kit.at(a.x - w / 2, a.y - h / 2);
        kit.anim(el, [{ transform: base + "scale(0.15)", opacity: 0.95 },
                      { transform: base + "scale(1)", opacity: 0 }],
                 { duration: dur });
    }

    // soft round flash
    function flash(a, rgb, tiles, dur)
    {
        var w = tiles * 2 * a.cw, h = tiles * 2 * a.ch;
        var el = spawn(layer(), "gm-flash", w, h,
            "background:radial-gradient(circle," + kit.rgba(C_WHITE, 0.9)
            + " 0%," + kit.rgba(rgb, 0.7) + " 35%," + kit.rgba(rgb, 0)
            + " 70%);", dur);
        if (!el) return;
        var base = kit.at(a.x - w / 2, a.y - h / 2);
        kit.anim(el, [{ transform: base + "scale(0.4)", opacity: 1 },
                      { transform: base + "scale(1)", opacity: 0 }],
                 { duration: dur });
    }

    // straight streak from (x1,y1) to (x2,y2); grow = draws itself outward
    function streak(parent, x1, y1, x2, y2, th, rgb, dur, grow)
    {
        var len = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
        if (len < 2) return;
        var el = spawn(parent, "gm-streak", len, th,
            "background:linear-gradient(90deg," + kit.rgba(rgb, 0) + ","
            + kit.rgba(rgb, 0.85) + " 65%," + kit.rgba(C_WHITE, 0.95) + ");"
            + "transform-origin:0 50%;", dur);
        if (!el) return;
        var base = kit.at(x1, y1 - th / 2) + "rotate("
                   + Math.atan2(y2 - y1, x2 - x1) + "rad) ";
        if (grow)
            kit.anim(el, [{ transform: base + "scaleX(0)", opacity: 1 },
                          { transform: base + "scaleX(1)", opacity: 1,
                            offset: 0.4 },
                          { transform: base + "scaleX(1)", opacity: 0 }],
                     { duration: dur, easing: "ease-out" });
        else
            kit.anim(el, [{ transform: base, opacity: 1 },
                          { transform: base, opacity: 0 }],
                     { duration: dur, easing: "ease-in" });
    }

    // jagged lightning bolt as SVG
    function bolt(x1, y1, x2, y2, rgb, dur)
    {
        if (live >= MAX_LIVE) return;
        var NS = "http://www.w3.org/2000/svg";
        var n = 9, pts = [];
        var dx = x2 - x1, dy = y2 - y1;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var nx = -dy / len, ny = dx / len;
        for (var i = 0; i <= n; i++)
        {
            var f = i / n;
            var j = (i === 0 || i === n) ? 0 : jitter(len * 0.045);
            pts.push((x1 + dx * f + nx * j).toFixed(1) + ","
                     + (y1 + dy * f + ny * j).toFixed(1));
        }
        var svg = document.createElementNS(NS, "svg");
        svg.setAttribute("class", "gm-bolt");
        svg.style.cssText = "position:absolute;left:0;top:0;width:"
            + window.innerWidth + "px;height:" + window.innerHeight
            + "px;pointer-events:none;overflow:visible;";
        [[5, 0.35, rgb], [1.6, 1, C_WHITE]].forEach(function (s) {
            var pl = document.createElementNS(NS, "polyline");
            pl.setAttribute("points", pts.join(" "));
            pl.setAttribute("fill", "none");
            pl.setAttribute("stroke-width", s[0]);
            pl.setAttribute("stroke-linejoin", "round");
            pl.setAttribute("stroke", kit.rgba(s[2], s[1]));
            svg.appendChild(pl);
        });
        layer().appendChild(svg);
        track(svg, dur);
        kit.anim(svg, [{ opacity: 1 }, { opacity: 0.25, offset: 0.3 },
                       { opacity: 0.9, offset: 0.45 }, { opacity: 0 }],
                 { duration: dur, easing: "linear" });
    }

    // Screen tint (qazlal) decays toward nothing; stepped from the frame loop.
    function tint_pulse(el_name, a, dur)
    {
        var e = ELEM[el_name];
        tint = { e: e, t0: kit.now(), dur: dur, a: a };
    }

    api.on("frame", function () {
        if (!tint) return;
        var k = 1 - (kit.now() - tint.t0) / tint.dur;
        if (k <= 0)
        {
            tint = null;
            api.grade("godfx_martial", null);
            return;
        }
        api.grade("godfx_martial", { tint: tint.e.tint, tint_a: tint.a * k,
                                     vig: tint.e.tint.map(function (v) {
                                         return v * 0.9; }),
                                     vig_a: tint.a * 0.7 * k });
    });

    // Position history (jump detection, dash trails) ---------------------------

    function path_since(ms)
    {
        var t = kit.now(), out = [];
        for (var i = 0; i < hist.length; i++)
            if (t - hist[i].t <= ms) out.push(hist[i]);
        return out;
    }

    api.on("frame", function () {
        var p = kit.player_pos();
        if (!p) return;
        var key = String(player.place) + ":" + String(player.depth);
        if (key !== last_key)
        {
            last_key = key;
            last_pos = null;
            hist = [];
        }
        if (last_pos && (p.x !== last_pos.x || p.y !== last_pos.y))
        {
            var dx = p.x - last_pos.x, dy = p.y - last_pos.y;
            var ax = Math.abs(dx), ay = Math.abs(dy);
            var straight = (dx === 0 || dy === 0 || ax === ay);
            var d = Math.max(ax, ay);
            var g = god();
            if (straight && d === 2 && g.indexOf("wu jian") >= 0)
                wall_jump(last_pos, p);
        }
        if (!last_pos || p.x !== last_pos.x || p.y !== last_pos.y)
        {
            hist.push({ x: p.x, y: p.y, t: kit.now() });
            if (hist.length > 12) hist.shift();
        }
        last_pos = p;
    });

    // Okawaru -----------------------------------------------------------------

    // copy of the player tile from the dungeon canvas (null if unavailable,
    // e.g. on the curved screen where flat canvas coords differ)
    function sprite_copy(a)
    {
        var c = document.getElementById("dungeon");
        if (!c || !c.width || document.body.classList.contains("sdc-curved"))
            return null;
        try
        {
            var r = c.getBoundingClientRect();
            var sx = c.width / r.width, sy = c.height / r.height;
            var cv = document.createElement("canvas");
            cv.width = Math.max(1, Math.round(a.cw * sx));
            cv.height = Math.max(1, Math.round(a.ch * sy));
            cv.getContext("2d").drawImage(c,
                (a.x - a.cw / 2 - r.left) * sx, (a.y - a.ch / 2 - r.top) * sy,
                cv.width, cv.height, 0, 0, cv.width, cv.height);
            return cv;
        }
        catch (e) { return null; }
    }

    function afterimage(ctx, a, rgb, dx, dy)
    {
        var cv = sprite_copy(a);
        var life = 480;
        var el;
        if (cv)
        {
            if (live >= MAX_LIVE) return;
            cv.className = "gm-after";
            cv.style.cssText = "position:absolute;left:0;top:0;width:" + a.cw
                + "px;height:" + a.ch + "px;filter:drop-shadow(0 0 5px "
                + kit.rgba(rgb, 0.95) + ") saturate(1.5);";
            ctx.root.appendChild(cv);
            el = track(cv, life);
        }
        else
            el = spawn(ctx.root, "gm-ghost", a.cw * 0.7, a.ch * 0.9,
                "background:radial-gradient(ellipse," + kit.rgba(rgb, 0.8)
                + "," + kit.rgba(rgb, 0) + " 70%);", life);
        if (!el) return;
        var bx = a.x - (cv ? a.cw : a.cw * 0.7) / 2;
        var by = a.y - (cv ? a.ch : a.ch * 0.9) / 2;
        kit.anim(el, [{ transform: kit.at(bx, by), opacity: 0.6 },
                      { transform: kit.at(bx - dx * a.cw * 0.7,
                                          by - dy * a.ch * 0.7),
                        opacity: 0 }],
                 { duration: life, easing: "ease-out" });
    }

    function okawaru_def(id, re, rgb, rgb2, line_gap, img_gap)
    {
        return {
            id: id, match: re,
            start: function (ctx) {
                var d = ctx.data;
                d.t_line = d.t_img = 0;
                d.prev = null;
                d.dx = 1; d.dy = 0;
                d.moved = 0;
                d.glow = kit.mk(ctx.root, "");
                d.glow.className = "gm-halo";
                d.glow.style.background = "radial-gradient(circle,"
                    + kit.rgba(rgb, 0.45) + "," + kit.rgba(rgb, 0) + " 70%)";
            },
            frame: function (ctx) {
                var a = ctx.anchor, d = ctx.data;
                if (!a)
                {
                    d.glow.style.opacity = 0;
                    d.prev = null;
                    return;
                }
                d.glow.style.opacity = "";
                var w = a.cw * 2.2, h = a.ch * 2.2;
                d.glow.style.width = w + "px";
                d.glow.style.height = h + "px";
                d.glow.style.transform = kit.at(a.x - w / 2, a.y - h / 2);
                var t = kit.now();
                if (d.prev
                    && (Math.abs(a.x - d.prev.x) > 1
                        || Math.abs(a.y - d.prev.y) > 1))
                {
                    var mx = a.x - d.prev.x, my = a.y - d.prev.y;
                    var m = Math.sqrt(mx * mx + my * my) || 1;
                    d.dx = mx / m; d.dy = my / m;
                    d.moved = t;
                }
                d.prev = { x: a.x, y: a.y };
                if (kit.reduced()) return;
                var moving = t - d.moved < 450;
                if (t - d.t_line > (moving ? line_gap * 0.5 : line_gap))
                {
                    d.t_line = t;
                    var ox = jitter(a.cw * 0.5), oy = jitter(a.ch * 0.45);
                    var len = kit.rnd(1.2, 2.6) * a.cw;
                    var sx = a.x + ox - d.dx * a.cw * 0.4;
                    var sy = a.y + oy - d.dy * a.ch * 0.4;
                    streak(ctx.root, sx, sy, sx - d.dx * len, sy - d.dy * len,
                           kit.rnd(1.5, 2.5), kit.pick([rgb, rgb2]), 340,
                           false);
                }
                if (moving && t - d.t_img > img_gap)
                {
                    d.t_img = t;
                    afterimage(ctx, a, kit.pick([rgb, rgb2]), d.dx, d.dy);
                }
            },
            cleanup: function () {}
        };
    }

    function duel_target()
    {
        return (duel_name && find_mon(duel_name)) || nearest_mon();
    }

    var duel_def = {
        id: "okawaru_duel", match: /^duel/,
        start: function (ctx) {
            var d = ctx.data;
            d.t0 = kit.now();
            d.dim = kit.mk(ctx.root, "width:100vw;height:100vh;");
            d.dim.className = "gm-dim";
            d.ring = kit.mk(ctx.root, "");
            d.ring.className = "gm-arena";
            d.ring_in = document.createElement("div");
            d.ring_in.className = "gm-arena-in" + (kit.reduced()
                                                   ? " gm-still" : "");
            d.ring.appendChild(d.ring_in);
            d.last = "";
        },
        frame: function (ctx) {
            var d = ctx.data, a = ctx.anchor;
            var k = Math.min(1, (kit.now() - d.t0) / 600);
            api.grade("okawaru_duel", { vig: [0, 0, 0.03], vig_a: k * 0.55,
                                        desat: k * 0.2 });
            if (!a)
            {
                d.dim.style.opacity = d.ring.style.opacity = 0;
                return;
            }
            d.dim.style.opacity = d.ring.style.opacity = "";
            var m = duel_target(), b = m ? kit.anchor_of(m) : null;
            var cx = a.x, cy = a.y, r = a.cw * 2.4;
            if (b)
            {
                cx = (a.x + b.x) / 2;
                cy = (a.y + b.y) / 2;
                var dx = a.x - b.x, dy = a.y - b.y;
                r = Math.sqrt(dx * dx + dy * dy) / 2 + a.cw * 1.4;
            }
            var key = cx.toFixed(0) + "," + cy.toFixed(0) + "," + r.toFixed(0)
                      + "," + k.toFixed(2);
            if (key === d.last) return;
            d.last = key;
            d.dim.style.background = "radial-gradient(circle at " + cx + "px "
                + cy + "px,rgba(0,0,0,0) " + r * 0.92 + "px,rgba(2,4,16,"
                + (k * 0.62).toFixed(2) + ") " + r * 1.6 + "px)";
            d.ring.style.width = d.ring.style.height = r * 2 + "px";
            d.ring.style.transform = kit.at(cx - r, cy - r);
        },
        cleanup: function () { api.grade("okawaru_duel", null); }
    };

    statusfx.register(okawaru_def("okawaru_hero", /^hero/, C_HERO, C_GOLD,
                                  160, 90));
    statusfx.register(okawaru_def("okawaru_finesse", /^finesse/, C_GOLD,
                                  C_WHITE, 90, 55));
    statusfx.register(duel_def);

    // Beogh -------------------------------------------------------------------

    var FIST_SVG = '<svg viewBox="0 0 64 80" width="100%" height="100%">'
        + '<defs><linearGradient id="gmf" x1="0" y1="0" x2="0" y2="1">'
        + '<stop offset="0" stop-color="#fff6d8"/><stop offset="1" '
        + 'stop-color="#ff9a30"/></linearGradient></defs>'
        + '<g fill="url(#gmf)" stroke="#6a2a00" stroke-width="2">'
        + '<rect x="12" y="30" width="42" height="40" rx="10"/>'
        + '<circle cx="18" cy="26" r="9"/><circle cx="30" cy="22" r="9"/>'
        + '<circle cx="42" cy="22" r="9"/><circle cx="52" cy="28" r="8"/>'
        + '<rect x="2" y="38" width="16" height="12" rx="6"/></g></svg>';

    function smite(mon)
    {
        var a = mon && kit.anchor_of(mon);
        if (!a) return;
        if (kit.reduced())
        {
            flash(a, C_BEOGH, 1.4, 400);
            return;
        }
        var vr = kit.view_rect();
        var fh = a.ch * 2.4, fw = fh * 0.8;
        var top = vr.top - fh;
        // thin lightning column first, then the fist drops
        bolt(a.x + jitter(a.cw * 0.4), vr.top, a.x, a.y, C_BEOGH, 260);
        var fist = spawn(layer(), "gm-fist", fw, fh, "", 700);
        if (fist)
        {
            fist.innerHTML = FIST_SVG;
            fist.style.filter = "drop-shadow(0 0 10px "
                                + kit.rgba(C_BEOGH, 0.9) + ")";
            kit.anim(fist,
                [{ transform: kit.at(a.x - fw / 2, top), opacity: 0.2 },
                 { transform: kit.at(a.x - fw / 2, a.y - fh * 0.75),
                   opacity: 1, offset: 0.55 },
                 { transform: kit.at(a.x - fw / 2, a.y - fh * 0.6),
                   opacity: 1, offset: 0.7 },
                 { transform: kit.at(a.x - fw / 2, a.y - fh * 0.6),
                   opacity: 0 }],
                { duration: 620, easing: "cubic-bezier(.6,0,.9,.6)" });
        }
        later(340, function () {
            var b = kit.anchor_of(mon) || a;
            flash(b, C_BEOGH, 1.8, 420);
            ring(b, C_GOLD, 1.8, 480, 3);
            for (var i = 0; i < 5; i++)
            {
                var ang = kit.rnd(0, 6.283), r = kit.rnd(0.8, 1.5);
                bolt(b.x, b.y, b.x + Math.cos(ang) * r * b.cw,
                     b.y + Math.sin(ang) * r * b.ch, C_BEOGH, 240);
            }
        });
    }

    function recall(names)
    {
        var me = kit.player_pos(), pa = me && kit.anchor_of(me);
        if (!pa) return;
        var seen = 0;
        kit.monsters().forEach(function (m) {
            if (seen >= 8) return;
            var hit = names.some(function (n) {
                return m.name.indexOf(n) >= 0 || n.indexOf(m.name) >= 0;
            });
            if (!hit) return;
            var b = kit.anchor_of(m);
            if (!b) return;
            seen++;
            if (kit.reduced()) { flash(b, C_BEOGH, 0.9, 400); return; }
            streak(layer(), pa.x, pa.y, b.x, b.y, 3, C_BEOGH, 600, true);
            ring(b, C_BEOGH, 0.9, 520, 2);
            later(300, function () { flash(b, C_GOLD, 0.8, 300); });
        });
        if (!kit.reduced()) ring(pa, C_BEOGH, 1.6, 560, 2);
    }

    function blood_for_blood()
    {
        var me = kit.player_pos(), a = me && kit.anchor_of(me);
        if (!a) return;
        flash(a, C_BLOOD, 2.4, 700);
        if (kit.reduced()) return;
        ring(a, C_BLOOD, 3.2, 800, 3);
        later(220, function () { ring(a, C_BEOGH, 2.4, 700, 2); });
    }

    // While the vengeful prayer lasts: rising embers and a warm tint.
    statusfx.register({
        id: "beogh_bfb", match: /^pray/,
        start: function (ctx) {
            ctx.data.t = 0;
            ctx.data.tw = 0;
        },
        frame: function (ctx) {
            var a = ctx.anchor, d = ctx.data, t = kit.now();
            api.grade("beogh_bfb", { vig: [0.7, 0.1, 0.05],
                vig_a: 0.22 + 0.06 * Math.sin(t / 380) });
            if (!a || kit.reduced() || t - d.t < 110) return;
            d.t = t;
            var ex = a.x + jitter(a.cw * 0.6), ey = a.y + a.ch * 0.3;
            var el = spawn(ctx.root, "gm-ember", 4, 4,
                "background:" + kit.rgba(kit.pick([C_BLOOD, C_BEOGH]), 0.95)
                + ";box-shadow:0 0 6px " + kit.rgba(C_BLOOD, 0.9) + ";", 1100);
            if (el)
                kit.anim(el, [{ transform: kit.at(ex, ey), opacity: 1 },
                              { transform: kit.at(ex + jitter(a.cw * 0.4),
                                                  ey - a.ch * kit.rnd(1.2, 2)),
                                opacity: 0 }],
                         { duration: 1000, easing: "ease-out" });
        },
        cleanup: function () { api.grade("beogh_bfb", null); }
    });

    // Qazlal ------------------------------------------------------------------

    function element_burst(name, a, tiles, big)
    {
        var e = ELEM[name];
        flash(a, e.c, tiles * 0.9, big ? 650 : 450);
        ring(a, e.c, tiles, big ? 700 : 520, 3);
        tint_pulse(name, big ? 0.55 : 0.4, big ? 800 : 550);
        if (kit.reduced()) return;
        var n = big ? 12 : 8;
        for (var i = 0; i < n; i++)
        {
            var ang = kit.rnd(0, 6.283), r = kit.rnd(0.4, tiles);
            var px = a.x + Math.cos(ang) * r * a.cw;
            var py = a.y + Math.sin(ang) * r * a.ch;
            var sz = kit.rnd(4, 9), el;
            if (name === "air")
            {
                var sx = px - a.cw * 0.5, sy = py;
                streak(layer(), sx, sy, sx + a.cw * 1.4, sy + jitter(6),
                       2, e.c, 420, true);
                continue;
            }
            el = spawn(layer(), "gm-bit gm-bit-" + name, sz, sz,
                "background:" + kit.rgba(e.c, 0.95) + ";box-shadow:0 0 6px "
                + kit.rgba(e.c, 0.8) + ";", 900);
            if (!el) continue;
            // fire rises, ice and stone fall, all scatter outward
            var vy = (name === "fire" ? -1 : 1) * a.ch * kit.rnd(0.5, 1.4);
            kit.anim(el, [{ transform: kit.at(px, py), opacity: 1 },
                          { transform: kit.at(px + Math.cos(ang) * a.cw * 0.5,
                                              py + vy), opacity: 0 }],
                     { duration: kit.rnd(600, 880),
                       easing: name === "fire" ? "ease-out" : "ease-in" });
        }
    }

    function upheaval(name)
    {
        var m = nearest_mon();
        var pos = m || kit.player_pos();
        var a = pos && kit.anchor_of(pos);
        if (a) element_burst(name, a, 2.6, true);
    }

    function elemental_force()
    {
        var me = kit.player_pos(), a = me && kit.anchor_of(me);
        if (!a) return;
        ELEM_NAMES.forEach(function (n, i) {
            later(i * 110, function () {
                var ang = i * 1.5708 + 0.8;
                var b = { x: a.x + Math.cos(ang) * a.cw * 1.4,
                          y: a.y + Math.sin(ang) * a.ch * 1.4,
                          cw: a.cw, ch: a.ch };
                element_burst(n, b, 1.0, false);
            });
        });
        ring(a, C_WHITE, 2.2, 700, 2);
    }

    function disaster_area()
    {
        var me = kit.player_pos(), a = me && kit.anchor_of(me);
        if (!a) return;
        var steps = kit.reduced() ? 1 : 7;
        for (var i = 0; i < steps; i++)
            later(i * 120, function () {
                element_burst(kit.pick(ELEM_NAMES), a, kit.rnd(2, 3.4),
                              false);
            });
    }

    // Wu Jian -----------------------------------------------------------------

    function dash_trail(from, to, rgb)
    {
        var a = kit.anchor_of(from), b = kit.anchor_of(to);
        if (!a || !b) return;
        if (kit.reduced()) { flash(b, rgb, 1, 350); return; }
        var th = Math.max(4, a.ch * 0.22);
        streak(layer(), a.x, a.y, b.x, b.y, th, rgb, 480, false);
        for (var i = 0; i < 3; i++)
        {
            var oy = (i - 1) * a.ch * 0.22;
            streak(layer(), a.x, a.y + oy, b.x, b.y + oy, 1.5, C_WHITE,
                   320 + i * 60, false);
        }
        ring(a, rgb, 0.9, 380, 2);
    }

    function impact(mon, rgb)
    {
        var a = mon && kit.anchor_of(mon);
        if (!a) return;
        flash(a, rgb, 1.5, 380);
        if (kit.reduced()) return;
        for (var i = 0; i < 6; i++)
        {
            var ang = i * 1.047 + jitter(0.3);
            streak(layer(), a.x + Math.cos(ang) * a.cw * 0.2,
                   a.y + Math.sin(ang) * a.ch * 0.2,
                   a.x + Math.cos(ang) * a.cw * 1.1,
                   a.y + Math.sin(ang) * a.ch * 1.1, 2.5, rgb, 300, true);
        }
    }

    function lunge(name)
    {
        var path = path_since(800);
        var cur = kit.player_pos();
        var from = path.length ? path[0] : cur;
        if (cur && from) dash_trail(from, cur, C_GOLD);
        impact(find_mon(name), C_WHITE);
    }

    function wall_jump(from, to)
    {
        dash_trail(from, to, C_STORM);
        var a = kit.anchor_of(to);
        if (a) ring(a, C_STORM, 1.6, 520, 3);
    }

    function whirlwind()
    {
        var me = kit.player_pos(), a = me && kit.anchor_of(me);
        if (!a) return;
        var path = path_since(700);
        if (path.length > 1 && me) dash_trail(path[0], me, C_GOLD);
        if (kit.reduced()) { flash(a, C_GOLD, 1.8, 400); return; }
        if (live >= MAX_LIVE) return;
        var NS = "http://www.w3.org/2000/svg";
        var d = "";
        for (var i = 0; i <= 40; i++)
        {
            var f = i / 40, ang = f * 12.5;           // ~2 turns
            var r = (0.4 + f * 1.4);
            d += (i ? "L" : "M") + (a.x + Math.cos(ang) * r * a.cw).toFixed(1)
                 + " " + (a.y + Math.sin(ang) * r * a.ch).toFixed(1);
        }
        var svg = document.createElementNS(NS, "svg");
        svg.style.cssText = "position:absolute;left:0;top:0;width:"
            + window.innerWidth + "px;height:" + window.innerHeight
            + "px;pointer-events:none;overflow:visible;";
        var p = document.createElementNS(NS, "path");
        p.setAttribute("d", d);
        p.setAttribute("fill", "none");
        p.setAttribute("stroke", kit.rgba(C_GOLD, 0.9));
        p.setAttribute("stroke-width", 3);
        p.setAttribute("stroke-linecap", "round");
        p.setAttribute("pathLength", 100);
        p.setAttribute("stroke-dasharray", "100");
        p.style.filter = "drop-shadow(0 0 4px " + kit.rgba(C_GOLD, 0.9) + ")";
        svg.appendChild(p);
        layer().appendChild(svg);
        track(svg, 620);
        kit.anim(p, [{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }],
                 { duration: 360, easing: "ease-out" });
        kit.anim(svg, [{ opacity: 1 }, { opacity: 1, offset: 0.55 },
                       { opacity: 0 }], { duration: 560 });
        ring(a, C_WHITE, 1.9, 480, 2);
    }

    function storm_level()
    {
        var n = 1;
        ((player && player.status) || []).forEach(function (st) {
            var m = st && st.light &&
                    /heavenly\s*\((\d+)\)/i.exec(kit.strip(st.light));
            if (m) n = +m[1];
        });
        return n;
    }

    var storm_def = {
        id: "wu_storm", match: /^heavenly/,
        start: function (ctx) {
            var d = ctx.data, vr = kit.view_rect();
            d.t = 0;
            d.bank = kit.mk(ctx.root, "left:" + vr.left + "px;top:" + vr.top
                + "px;width:" + vr.width + "px;height:" + vr.height * 0.22
                + "px;");
            d.bank.className = "gm-clouds" + (kit.reduced() ? " gm-still" : "");
            for (var i = 0; i < 6; i++)
            {
                var c = document.createElement("div");
                c.className = "gm-cloud";
                c.style.left = (i * 18 - 6) + "%";
                c.style.animationDelay = (-i * 3.1) + "s";
                c.style.opacity = (0.55 + (i % 3) * 0.12).toFixed(2);
                d.bank.appendChild(c);
            }
        },
        frame: function (ctx) {
            var d = ctx.data, t = kit.now(), a = ctx.anchor;
            if (kit.reduced() || t - d.t < 100) return;
            var chance = 0.12 + 0.015 * storm_level();
            d.t = t;
            if (Math.random() > chance) return;
            var vr = kit.view_rect();
            var tx, ty;
            if (a && Math.random() < 0.6)
            {
                tx = a.x + jitter(a.cw * 4);
                ty = a.y + jitter(a.ch * 3);
            }
            else
            {
                tx = vr.left + Math.random() * vr.width;
                ty = vr.top + vr.height * kit.rnd(0.4, 0.9);
            }
            var sx = tx + jitter(vr.width * 0.04), sy = vr.top + vr.height * 0.1;
            bolt(sx, sy, tx, ty, C_STORM, 260);
            flash({ x: tx, y: ty, cw: (a ? a.cw : 32), ch: (a ? a.ch : 32) },
                  C_STORM, 0.9, 300);
        },
        cleanup: function () {}
    };
    statusfx.register(storm_def);

    // Uskayaw -----------------------------------------------------------------

    // Stomp: a short, decaying screen shake
    var shake_t0 = 0;
    function stomp()
    {
        if (kit.reduced()) return;
        shake_t0 = kit.now();
    }

    api.on("frame", function () {
        if (!shake_t0) return;
        var k = 1 - (kit.now() - shake_t0) / STOMP_MS;
        if (k <= 0)
        {
            shake_t0 = 0;
            api.grade("godfx_stomp", null);
            return;
        }
        var amp = 7 * k * k * (window.devicePixelRatio || 1);
        var t = kit.now() / 1000;
        api.grade("godfx_stomp", { sx: Math.sin(t * 61) * amp,
                                   sy: Math.sin(t * 47 + 1.3) * amp * 0.8 });
    });

    // Grand Finale: a spotlight cone of light-map emitters (drawn by
    // light.js in map space, so it tilts with the view like the Shining
    // One halo) fading in over the player and back out.
    var spot_t0 = 0;
    function audience()
    {
        spot_t0 = kit.now();
    }

    api.light_extra("godfx_spotlight", function () {
        if (!spot_t0) return null;
        var u = (kit.now() - spot_t0) / SPOT_MS;
        if (u >= 1) { spot_t0 = 0; return null; }
        var p = kit.player_pos();
        if (!p) return null;
        var env = u < 0.15 ? u / 0.15 : u > 0.65 ? (1 - u) / 0.35 : 1;
        var out = [];
        for (var dy = 0; dy <= 6; dy++)
        {
            var half = 0.5 + dy * 0.42;
            var reach = Math.ceil(half);
            for (var dx = -reach; dx <= reach; dx++)
            {
                var edge = Math.abs(dx) / (half + 0.5);
                var f = (1 - edge * edge) * (1 - dy / 8) * 1.7 * env;
                if (f > 0.05)
                    out.push({ x: p.x + dx, y: p.y - dy, cls: "holy", f: f });
            }
        }
        return out;
    });

    // Messages ----------------------------------------------------------------

    function on_text(text)
    {
        var m;
        if ((m = /single combat with (.+?)[.!]/i.exec(text)))
            duel_name = m[1].toLowerCase().replace(/^(the|a|an) /, "");
        if ((m = /you smite (.+?)(?:[.!]|$)/i.exec(text)))
            smite(find_mon(m[1]));
        if ((m = /(?:^|\s)(.+?) is recalled by the power of beogh/i
                 .exec(text)))
        {
            recall_names.push(m[1].toLowerCase().replace(/^(the|a|an) /, ""));
            if (!recall_timer)
                recall_timer = later(250, function () {
                    var names = recall_names;
                    recall_names = [];
                    recall_timer = 0;
                    recall(names);
                });
        }
        if (/utter a vengeful prayer/i.test(text)) blood_for_blood();
        if (/magma suddenly erupts/i.test(text)) upheaval("fire");
        if (/blizzard blasts the area/i.test(text)) upheaval("ice");
        if (/cutting wind/i.test(text)) upheaval("air");
        if (/ground shakes violently, spewing rubble/i.test(text))
            upheaval("stone");
        if (/clouds? arounds? you coalesce/i.test(text)) elemental_force();
        if (/nature churns violently around you/i.test(text))
            disaster_area();
        if ((m = /you lunge(?: with incredible momentum)? at (.+?)(?:,|\.|$)/i
                 .exec(text)))
            lunge(m[1]);
        if (/you (?:repeatedly )?attack .+ from above/i.test(text))
            impact(nearest_mon(), C_STORM);
        if (/you spin and attack/i.test(text)) whirlwind();
        if (/you stomp with the beat/i.test(text)) stomp();
        if (/\baudience\b/i.test(text)
            && !/no appreciative|not zealous/i.test(text))
            audience();
    }

    kit.on_message(function (text) {
        try { on_text(text); }
        catch (e) { console.error("sdc godfx_martial:", e); }
    });

    function reset()
    {
        timers.forEach(function (id) { window.clearTimeout(id); });
        timers = [];
        live = 0;
        hist = [];
        last_pos = last_key = null;
        duel_name = null;
        recall_names = [];
        recall_timer = 0;
        tint = null;
        api.grade("godfx_martial", null);
    }
    api.on("game_init", reset);
    api.on("game_cleanup", reset);

    // Debug -------------------------------------------------------------------

    // Drives a status definition by hand for `ms` (no real status needed).
    function run_def(def, ms, light)
    {
        var root = document.createElement("div");
        root.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;";
        kit.layer("aura").appendChild(root);
        var ctx = { root: root, anchor: kit.anchor_of(kit.player_pos()),
                    light: light, t0: kit.now(), data: {}, initial: false };
        if (def.start) def.start(ctx);
        var iv = window.setInterval(function () {
            ctx.anchor = kit.anchor_of(kit.player_pos());
            if (def.frame) def.frame(ctx, kit.now());
        }, 33);
        window.setTimeout(function () {
            window.clearInterval(iv);
            if (def.stop) def.stop(ctx);
            if (def.cleanup) def.cleanup(ctx);
            if (root.parentNode) root.parentNode.removeChild(root);
        }, ms);
    }

    var defs_by_id = {};
    [okawaru_def("okawaru_hero", /^hero/, C_HERO, C_GOLD, 160, 90),
     okawaru_def("okawaru_finesse", /^finesse/, C_GOLD, C_WHITE, 90, 55),
     duel_def].forEach(function (d) { defs_by_id[d.id] = d; });

    window.sdc_godfx_martial_test = function (what)
    {
        what = String(what || "okawaru").toLowerCase().replace(/[\s_-]/g, "");
        var me = kit.player_pos();
        var m = nearest_mon();
        var steps = {
            hero: function () { run_def(defs_by_id.okawaru_hero, 5000); },
            finesse: function () { run_def(defs_by_id.okawaru_finesse, 5000); },
            duel: function () { run_def(duel_def, 6000); },
            smite: function () { smite(m); },
            recall: function () {
                if (m) recall([m.name]);
            },
            bfb: blood_for_blood,
            fire: function () { upheaval("fire"); },
            ice: function () { upheaval("ice"); },
            air: function () { upheaval("air"); },
            stone: function () { upheaval("stone"); },
            force: elemental_force,
            disaster: disaster_area,
            lunge: function () {
                if (me) dash_trail({ x: me.x - 2, y: me.y }, me, C_GOLD);
                impact(m || me, C_WHITE);
            },
            walljump: function () {
                if (me) wall_jump({ x: me.x - 2, y: me.y }, me);
            },
            whirlwind: whirlwind,
            storm: function () { run_def(storm_def, 6000); },
            stomp: stomp,
            audience: audience
        };
        var groups = {
            okawaru: ["hero", "finesse", "duel"],
            beogh: ["smite", "recall", "bfb"],
            qazlal: ["fire", "ice", "air", "stone", "force", "disaster"],
            wujian: ["lunge", "walljump", "whirlwind", "storm"],
            uskayaw: ["stomp", "audience"]
        };
        var seq = groups[what] || (steps[what] ? [what] : []);
        var delay = 0;
        seq.forEach(function (k) {
            later(delay, steps[k]);
            delay += (k === "hero" || k === "finesse") ? 5200
                   : (k === "duel" || k === "storm") ? 6200
                   : (k === "stomp") ? 2400 : 1500;
        });
        return seq.join(" > ");
    };

    return {};
});
