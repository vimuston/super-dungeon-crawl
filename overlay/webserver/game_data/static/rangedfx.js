// Ranged firing feel: when you shoot or throw, your character reacts with the
// weapon's own "haptic" beat instead of a projectile trail (the stock missile
// animation is left alone).
//
//   bow        the string is drawn tight (you lean back, a faint glowing bow
//              and string bend, a tension shiver), then released: the string
//              snaps forward and vibrates, you spring forward and settle
//   crossbow   already cocked: a heavy thunk, sharp short kick back, the
//              prod flexes and snaps, a small view jolt
//   hand cannon BANG: big kick back with a swell, muzzle flash and light,
//              shock ring, sparks, a lingering smoke cloud, view shake
//   sling      a quick whirl over your head (the sprite circles, a blurred
//              strap arc), then a whip release toward the target
//   throws     (darts, javelins, tomahawks, boomerangs, nets, rocks) a wind-up
//              lean back and a lunge forward; heavier items lunge harder
// The launcher's / ammo's brand tints the bow, string and release burst
// (embers for flaming, frost for freezing, sparks for electrocution, ...),
// and plays faintly over your own tile while you shoot (crackling arcs,
// rising embers, frost glints, drips, ...).
// Coglins holding two launchers fire both: the other hand's beat follows
// ~170 ms later, each drawn a little off to its own side with its own brand.
//
// Sprite motion goes through alive.js ("player_kick" event: tilt/shift,
// tremor, squash in the CRT shader), so it needs "Living tiles" on; the
// overlays (layer #sdc_rangedfx, one canvas) work either way.
//
// Trigger: whichever comes first of
//   - a cell next to you newly showing a missile tile (cell.t.ov MI_*), which
//     also gives the firing direction and the missile kind, or
//   - the "You shoot/throw <ammo>." message (direction: nearest monster,
//     corrected when the missile cell shows up during the wind-up).
// prefers-reduced-motion: no sprite motion, no shake; overlays only, brief.
// Option "ranged_feel" (settings panel).
// Debug: sdc_rangedfx_test("bow" | "xbow" | "cannon" | "sling" | "dart" |
//        "javelin" | "spin" | "net" | "rock", brand, dx, dy, kind2, brand2)
//        e.g. ("bow", "flame"), ("cannon", null, -1, 0) or a coglin volley
//        ("sling", "elec", 1, 0, "cannon", "flame")
define(["./sdc_api", "./fxkit", "./player", "./map_knowledge",
        "./tileinfo-main"],
function (api, kit, player, map_knowledge, main) {
    "use strict";

    api.register_option({ key: "ranged_feel", label: "Ranged firing feel",
                          default: true,
                          choices: [[true, "On"], [false, "Off"]] });

    var MAX_PARTS = 160;
    var ov_seen = {};                   // "x,y" -> had a missile overlay
    var shots = [];                     // firing animations in progress
    var parts = [];                     // particles (screen space)
    var last_dir_t = 0;                 // last missile-cell trigger

    // Brands -----------------------------------------------------------------------
    // c: main, c2: hot / light, fx: release particle style
    var BRANDS = {
        none:     { c: "215,228,240", c2: "255,255,255", fx: null },
        flame:    { c: "255,120,30",  c2: "255,235,160", fx: "ember" },
        freeze:   { c: "120,205,255", c2: "240,255,255", fx: "frost" },
        elec:     { c: "140,175,255", c2: "255,255,255", fx: "spark" },
        poison:   { c: "110,225,70",  c2: "220,255,170", fx: "drip" },
        venom:    { c: "60,215,140",  c2: "200,255,220", fx: "drip" },
        chaos:    { c: "255,80,200",  c2: "120,230,255", fx: "chaos" },
        holy:     { c: "255,215,110", c2: "255,255,235", fx: "glint" },
        drain:    { c: "150,80,215",  c2: "230,200,255", fx: "smoke" },
        pain:     { c: "220,35,65",   c2: "255,170,170", fx: "drip" },
        silver:   { c: "220,230,255", c2: "255,255,255", fx: "glint" },
        steel:    { c: "185,200,220", c2: "255,255,255", fx: "spark" },
        pierce:   { c: "170,205,255", c2: "255,255,255", fx: "glint" },
        disperse: { c: "185,120,255", c2: "245,225,255", fx: "glint" },
        speed:    { c: "255,240,150", c2: "255,255,255", fx: "glint" },
        acid:     { c: "185,235,45",  c2: "245,255,175", fx: "drip" },
        distort:  { c: "195,140,255", c2: "255,235,255", fx: "glint" },
        anti:     { c: "150,150,235", c2: "255,255,255", fx: "smoke" },
        shadow:   { c: "130,70,220",  c2: "225,195,255", fx: "ember" },
        explode:  { c: "255,140,40",  c2: "255,245,180", fx: "ember" }
    };

    var BRAND_RE = [
        ["shadow",  /\bfoul ?flame\b/],
        ["flame",   /\b(?:flam(?:e|ing|es)|fiery|fire)\b|\{flame/],
        ["freeze",  /\b(?:freez(?:e|ing)|frost(?:y)?|icy|cold)\b|\{freeze/],
        ["elec",    /\belectrocut|\belec\b|\blightning\b|\bshocking\b/],
        ["venom",   /\bvenom|\bcurare\b|\bcurar/],
        ["poison",  /\bpoison/],
        ["chaos",   /\bchaos\b|\bchaotic\b/],
        ["holy",    /\bholy wrath\b|\bholy\b/],
        ["drain",   /\bdraining\b|\bdrain\b/],
        ["pain",    /\bpain\b|\bvampirism\b|\bvamp\b/],
        ["silver",  /\bsilver\b/],
        ["steel",   /\bsteel\b/],
        ["pierce",  /\bpenetrat/],
        ["disperse", /\bdispersal\b|\bdisperse\b/],
        ["speed",   /\bof speed\b|\bspeed\b/],
        ["acid",    /\bacid\b|\bcorrod/],
        ["distort", /\bdistortion\b|\bdistort\b/],
        ["anti",    /\bantimagic\b/],
        ["explode", /\bexploding\b/]
    ];

    function brand_of(text)
    {
        for (var i = 0; i < BRAND_RE.length; i++)
            if (BRAND_RE[i][1].test(text)) return BRAND_RE[i][0];
        return null;
    }

    // Kinds -------------------------------------------------------------------------
    var tile_list = null;
    function missile_kind(v)
    {
        if (!tile_list)
        {
            tile_list = [];
            for (var n in main)
                if (typeof main[n] === "number" && /^[A-Z][A-Z0-9_]*$/.test(n))
                    tile_list.push([main[n], n]);
            tile_list.sort(function (a, b) { return a[0] - b[0]; });
        }
        var idx = (typeof v === "number" ? v : (v && v.length ? v[0] : 0))
                  & 0xFFFF;
        var lo = 0, hi = tile_list.length - 1, best = null;
        while (lo <= hi)
        {
            var mid = (lo + hi) >> 1;
            if (tile_list[mid][0] <= idx) { best = tile_list[mid]; lo = mid + 1; }
            else hi = mid - 1;
        }
        if (!best || !/^MI_/.test(best[1]) || idx - best[0] > 24) return null;
        var nm = best[1];
        if (/^MI_ARROW/.test(nm)) return "bow";
        if (/^MI_BOLT/.test(nm)) return "xbow";
        if (/^MI_SLUG/.test(nm)) return "cannon";
        if (/^MI_(SLING|STONE)/.test(nm)) return "sling";
        if (/^MI_DART|^MI_NEEDLE/.test(nm)) return "dart";
        if (/^MI_JAVELIN/.test(nm)) return "javelin";
        if (/^MI_(BOOMERANG|TOMAHAWK)/.test(nm)) return "spin";
        if (/^MI_THROWING_NET/.test(nm)) return "net";
        if (/^MI_LARGE_ROCK/.test(nm)) return "rock";
        return "dart";
    }

    function item_name(i)
    {
        var it = (i !== undefined && i !== null && i >= 0 && player.inv)
                 ? player.inv[i] : null;
        return it && it.name ? String(it.name).toLowerCase() : "";
    }

    function wielded() { return item_name(player.weapon_index); }

    // launchers in hand: [{kind, brand}], main hand first. Coglins can hold
    // two (sling + hand cannon, ...) and fire both with one command
    // (throw.cc _construct_player_ranged_beams), in random order.
    function launchers()
    {
        var out = [];
        [player.weapon_index, player.offhand_index].forEach(function (i, n) {
            if (n && i === player.weapon_index) return;
            var w = item_name(i), k = launcher_kind(w);
            if (k) out.push({ kind: k, brand: brand_of(w) });
        });
        return out;
    }

    function launcher_kind(w)
    {
        if (/hand cannon/.test(w)) return "cannon";
        if (/crossbow|arbalest/.test(w)) return "xbow";
        if (/\bsling\b/.test(w)) return "sling";
        if (/\bbow\b|longbow|shortbow|orcbow/.test(w)) return "bow";
        return null;
    }

    var LAUNCHED = { bow: 1, xbow: 1, cannon: 1, sling: 1 };

    var NOUNS = [
        ["net",     /\bnet\b/],
        ["spin",    /boomerang|tomahawk|chakram/],
        ["javelin", /javelin|\bspear\b|trident/],
        ["rock",    /large rock|\brock\b|boulder/],
        ["dart",    /\bdart|needle/],
        ["cannon",  /\bslug\b/],
        ["xbow",    /\bbolt\b/],
        ["bow",     /\barrow/],
        ["sling",   /sling bullet|\bstone\b|pebble|\bbullet\b/]
    ];

    // brand of the held launcher of this kind (main hand first)
    function launcher_brand(kind)
    {
        var ls = launchers();
        for (var i = 0; i < ls.length; i++)
            if (ls[i].kind === kind) return ls[i].brand;
        return null;
    }

    function kind_of(text, w)
    {
        var low = text.toLowerCase(), k = null, i;
        for (i = 0; i < NOUNS.length && !k; i++)
            if (NOUNS[i][1].test(low)) k = NOUNS[i][0];
        // the ammo names one of the launchers in hand (either hand)
        if (k && LAUNCHED[k] && launchers().some(function (l) {
                return l.kind === k; }))
            return k;
        var lk = launcher_kind(w);
        if (lk && (!k || LAUNCHED[k])) return lk;
        return k || lk || "dart";
    }

    // Timelines ---------------------------------------------------------------------
    // pre: ms before the release (draw / whirl / wind-up), post: settle ms
    var TL = {
        bow:     { pre: 110, post: 520 },
        xbow:    { pre: 0,   post: 420 },
        cannon:  { pre: 0,   post: 650 },
        sling:   { pre: 190, post: 420 },
        dart:    { pre: 60,  post: 300 },
        javelin: { pre: 110, post: 420 },
        spin:    { pre: 90,  post: 380 },
        net:     { pre: 110, post: 420 },
        rock:    { pre: 150, post: 480 }
    };

    // Helpers -----------------------------------------------------------------------
    function rgba(c, a) { return "rgba(" + c + "," + (a < 0 ? 0 : a > 1 ? 1 : a) + ")"; }
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function ease_in(u) { return u * u; }
    function ease_out(u) { return 1 - (1 - u) * (1 - u); }
    // damped spring starting at 1, crossing zero with an overshoot
    function spring(t, tau, w) { return Math.exp(-t / tau) * Math.cos(t * w); }

    function nearest_dir()
    {
        var p = kit.player_pos();
        if (!p) return null;
        var best = null, bd = 1e9;
        kit.monsters().forEach(function (m) {
            var d = Math.abs(m.x - p.x) + Math.abs(m.y - p.y);
            if (d > 0 && d < bd) { bd = d; best = m; }
        });
        return best ? norm(best.x - p.x, best.y - p.y) : { x: 1, y: 0 };
    }

    function norm(x, y)
    {
        var l = Math.sqrt(x * x + y * y) || 1;
        return { x: x / l, y: y / l };
    }

    // Canvas ------------------------------------------------------------------------
    var cv = null, cx = null, dpr = 1, raf = 0, last_t = 0;

    function canvas()
    {
        var host = kit.layer("rangedfx");
        if (!cv || cv.parentNode !== host)
        {
            cv = document.createElement("canvas");
            cv.style.cssText = "position:absolute;left:0;top:0;width:100%;"
                               + "height:100%;pointer-events:none;";
            host.appendChild(cv);
            cx = cv.getContext("2d");
        }
        dpr = Math.min(2, window.devicePixelRatio || 1);
        var w = Math.round(window.innerWidth * dpr);
        var h = Math.round(window.innerHeight * dpr);
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        return cx;
    }

    function kick_loop()
    {
        if (!raf) { last_t = kit.now(); raf = window.requestAnimationFrame(frame); }
    }

    // Particles ---------------------------------------------------------------------
    function part(p)
    {
        if (parts.length >= MAX_PARTS) parts.shift();
        p.age = 0;
        p.drag = p.drag === undefined ? 3 : p.drag;
        p.g = p.g || 0;
        p.rot = p.rot || 0;
        p.vr = p.vr || 0;
        parts.push(p);
    }

    // brand burst at (x, y) heading (ux, uy), cw = tile px
    function brand_burst(br, x, y, ux, uy, cw, n)
    {
        if (!br.fx) return;
        for (var i = 0; i < n; i++)
        {
            var sp = rnd(0.6, 1.8) * cw, an = Math.atan2(uy, ux) + rnd(-0.9, 0.9);
            var vx = Math.cos(an) * sp, vy = Math.sin(an) * sp;
            var c = Math.random() < 0.4 ? br.c2 : br.c;
            switch (br.fx)
            {
            case "ember":
                part({ x: x, y: y, vx: vx * 0.6, vy: vy * 0.6 - 0.5 * cw,
                       g: -0.6 * cw, life: rnd(350, 700), s: rnd(0.04, 0.08) * cw,
                       ty: "ember", c: c, add: 1 });
                break;
            case "frost":
                part({ x: x, y: y, vx: vx * 0.5, vy: vy * 0.5, g: 0.3 * cw,
                       life: rnd(450, 800), s: rnd(0.05, 0.08) * cw,
                       ty: "flake", c: c, vr: rnd(-5, 5), add: 1 });
                break;
            case "spark":
                part({ x: x, y: y, vx: vx * 1.4, vy: vy * 1.4, drag: 6,
                       life: rnd(120, 260), s: rnd(0.12, 0.22) * cw,
                       ty: "spark", c: c, add: 1 });
                break;
            case "drip":
                part({ x: x, y: y, vx: vx * 0.4, vy: vy * 0.4, g: 2.4 * cw,
                       drag: 1.5, life: rnd(350, 600), s: rnd(0.035, 0.06) * cw,
                       ty: "drop", c: c, add: 1 });
                break;
            case "chaos":
                part({ x: x, y: y, vx: vx, vy: vy, life: rnd(300, 600),
                       s: rnd(0.04, 0.08) * cw, ty: "chaos", h: rnd(0, 360),
                       vr: rnd(-6, 6), add: 1 });
                break;
            case "glint":
                part({ x: x, y: y, vx: vx * 0.5, vy: vy * 0.5, drag: 4,
                       life: rnd(300, 600), s: rnd(0.08, 0.15) * cw,
                       ty: "glint", c: c, add: 1 });
                break;
            case "smoke":
                part({ x: x, y: y, vx: vx * 0.3, vy: vy * 0.3, drag: 2,
                       life: rnd(450, 800), s: rnd(0.15, 0.28) * cw,
                       ty: "smoke", c: "45,15,75", grow: 1.5 });
                break;
            }
        }
    }

    function hsl(h, a) { return "hsla(" + (h % 360) + ",100%,65%," + a + ")"; }

    function draw_parts(g, dt)
    {
        for (var i = parts.length - 1; i >= 0; i--)
        {
            var p = parts[i];
            p.age += dt;
            if (p.age >= p.life) { parts.splice(i, 1); continue; }
            var s = dt / 1000, f = Math.exp(-p.drag * s);
            p.vx *= f; p.vy *= f;
            p.vy += p.g * s;
            p.x += p.vx * s; p.y += p.vy * s;
            p.rot += p.vr * s;
            var a = 1 - p.age / p.life;
            var x = p.x * dpr, y = p.y * dpr, r = p.s * dpr;
            g.globalCompositeOperation = p.add ? "lighter" : "source-over";
            if (p.ty === "ember")
            {
                var gr = g.createRadialGradient(x, y, 0, x, y, r * 3);
                gr.addColorStop(0, rgba("255,255,230", a));
                gr.addColorStop(0.25, rgba(p.c, a * 0.9));
                gr.addColorStop(1, rgba(p.c, 0));
                g.fillStyle = gr;
                g.beginPath(); g.arc(x, y, r * 3, 0, 6.283); g.fill();
            }
            else if (p.ty === "smoke")
            {
                var rr = r * (1 + (p.grow || 1.2) * p.age / p.life);
                var gs = g.createRadialGradient(x, y, 0, x, y, rr);
                gs.addColorStop(0, rgba(p.c, (p.alpha || 0.45) * a));
                gs.addColorStop(1, rgba(p.c, 0));
                g.fillStyle = gs;
                g.beginPath(); g.arc(x, y, rr, 0, 6.283); g.fill();
            }
            else if (p.ty === "flake")
            {
                g.save(); g.translate(x, y); g.rotate(p.rot);
                g.strokeStyle = rgba(p.c, a);
                g.lineWidth = Math.max(1, r * 0.35);
                g.beginPath();
                for (var q = 0; q < 3; q++)
                {
                    var an = q * 1.047;
                    g.moveTo(-Math.cos(an) * r, -Math.sin(an) * r);
                    g.lineTo(Math.cos(an) * r, Math.sin(an) * r);
                }
                g.stroke();
                g.restore();
            }
            else if (p.ty === "spark" || p.ty === "drop")
            {
                var sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
                var L = Math.min(r * (p.ty === "drop" ? 4 : 2.5),
                                 sp * 0.03 * dpr + r);
                g.strokeStyle = rgba(p.c, a);
                g.lineCap = "round";
                g.lineWidth = p.ty === "drop" ? r * 1.4 : Math.max(1, dpr * 1.2);
                g.beginPath();
                g.moveTo(x, y);
                g.lineTo(x - p.vx / sp * L, y - p.vy / sp * L);
                g.stroke();
            }
            else if (p.ty === "arc")
            {
                // tiny jagged crackle, re-jittered every frame
                var ca = Math.cos(p.an), sa = Math.sin(p.an), segs = 4;
                g.save();
                g.shadowColor = rgba(p.c, a);
                g.shadowBlur = 4 * dpr;
                g.strokeStyle = rgba(p.c, a);
                g.lineWidth = Math.max(1, dpr * 0.9);
                g.lineJoin = "round";
                g.beginPath();
                for (var q2 = 0; q2 <= segs; q2++)
                {
                    var f2 = (q2 / segs - 0.5) * 2 * r;
                    var j2 = (q2 && q2 < segs) ? rnd(-0.35, 0.35) * r : 0;
                    var ax = x + ca * f2 - sa * j2, ay = y + sa * f2 + ca * j2;
                    if (q2) g.lineTo(ax, ay); else g.moveTo(ax, ay);
                }
                g.stroke();
                g.restore();
            }
            else if (p.ty === "chaos")
            {
                g.save(); g.translate(x, y); g.rotate(p.rot);
                g.fillStyle = hsl(p.h + p.age * 0.6, a);
                g.fillRect(-r, -r, r * 2, r * 2);
                g.restore();
            }
            else if (p.ty === "glint")
            {
                var tw = Math.sin(Math.PI * p.age / p.life);
                g.strokeStyle = rgba(p.c, tw);
                g.lineWidth = Math.max(1, dpr);
                g.beginPath();
                g.moveTo(x - r * tw, y); g.lineTo(x + r * tw, y);
                g.moveTo(x, y - r * tw * 1.4); g.lineTo(x, y + r * tw * 1.4);
                g.stroke();
            }
            else                                   // dust mote
            {
                g.fillStyle = rgba(p.c, a * 0.7);
                g.beginPath(); g.arc(x, y, Math.max(0.8, r), 0, 6.283); g.fill();
            }
        }
        g.globalCompositeOperation = "source-over";
    }

    // Overlay pieces ----------------------------------------------------------------

    function glow_stroke(g, col, a, w, blur, fn)
    {
        g.save();
        g.globalCompositeOperation = "lighter";
        g.lineCap = "round"; g.lineJoin = "round";
        g.shadowColor = rgba(col, a);
        g.shadowBlur = blur * dpr;
        g.strokeStyle = rgba(col, a);
        g.lineWidth = Math.max(1, w * dpr);
        g.beginPath();
        fn();
        g.stroke();
        g.restore();
    }

    // A bow held toward (ux, uy): limbs arc in front of you, string between
    // the tips; pull: 0 rest .. 1 full draw; vib: string offset at release
    function draw_bow(g, s, P, ux, uy, cw, pull, vib, a)
    {
        var nx = -uy, ny = ux;
        var reach = cw * 0.34, half = cw * 0.42, bend = cw * (0.12 + 0.10 * pull);
        var gx = P.x + ux * reach, gy = P.y + uy * reach;           // grip
        var t1 = { x: gx + nx * half - ux * bend, y: gy + ny * half - uy * bend };
        var t2 = { x: gx - nx * half - ux * bend, y: gy - ny * half - uy * bend };
        var sx = gx - ux * (bend + cw * 0.36 * pull) + ux * vib;    // string mid
        var sy = gy - uy * (bend + cw * 0.36 * pull) + uy * vib;
        var br = s.br;
        var limb = br.fx ? br.c : "235,215,170";
        glow_stroke(g, limb, 0.85 * a, 2.2, 6 * (br.fx ? 1.6 : 1), function () {
            g.moveTo(t1.x * dpr, t1.y * dpr);
            g.quadraticCurveTo((gx + ux * cw * 0.1) * dpr, (gy + uy * cw * 0.1) * dpr,
                               t2.x * dpr, t2.y * dpr);
        });
        glow_stroke(g, br.c2, 0.9 * a, 1.1, 4, function () {
            g.moveTo(t1.x * dpr, t1.y * dpr);
            g.lineTo(sx * dpr, sy * dpr);
            g.lineTo(t2.x * dpr, t2.y * dpr);
        });
        return { x: sx, y: sy };
    }

    // a crossbow prod: a short stiff arc that flexes back and snaps
    function draw_prod(g, s, P, ux, uy, cw, flex, a)
    {
        var nx = -uy, ny = ux;
        var reach = cw * 0.42, half = cw * 0.36;
        var gx = P.x + ux * reach, gy = P.y + uy * reach;
        var bend = cw * (0.06 + 0.14 * flex);
        var t1 = { x: gx + nx * half - ux * bend, y: gy + ny * half - uy * bend };
        var t2 = { x: gx - nx * half - ux * bend, y: gy - ny * half - uy * bend };
        var br = s.br, limb = br.fx ? br.c : "200,210,225";
        glow_stroke(g, limb, 0.9 * a, 3, 6, function () {
            g.moveTo(t1.x * dpr, t1.y * dpr);
            g.quadraticCurveTo(gx * dpr, gy * dpr, t2.x * dpr, t2.y * dpr);
        });
        var sm = cw * 0.05 * (1 - flex);
        glow_stroke(g, br.c2, 0.8 * a, 1.2, 4, function () {
            g.moveTo(t1.x * dpr, t1.y * dpr);
            g.quadraticCurveTo((gx - ux * (bend + sm)) * dpr,
                               (gy - uy * (bend + sm)) * dpr,
                               t2.x * dpr, t2.y * dpr);
        });
    }

    // expanding ring / arc (front-facing when ux given)
    function ring(g, x, y, r, col, a, w, ux, uy, spread)
    {
        glow_stroke(g, col, a, w, 6, function () {
            if (ux !== undefined)
            {
                var an = Math.atan2(uy, ux);
                g.arc(x * dpr, y * dpr, r * dpr, an - spread, an + spread);
            }
            else
                g.arc(x * dpr, y * dpr, r * dpr, 0, 6.283);
        });
    }

    function radial(g, x, y, r, c_in, c_out, a)
    {
        g.save();
        g.globalCompositeOperation = "lighter";
        var gr = g.createRadialGradient(x * dpr, y * dpr, 0, x * dpr, y * dpr, r * dpr);
        gr.addColorStop(0, rgba(c_in, a));
        gr.addColorStop(0.35, rgba(c_out, a * 0.7));
        gr.addColorStop(1, rgba(c_out, 0));
        g.fillStyle = gr;
        g.beginPath(); g.arc(x * dpr, y * dpr, r * dpr, 0, 6.283); g.fill();
        g.restore();
    }

    // spiky muzzle flash toward (ux, uy)
    function muzzle_star(g, x, y, ux, uy, r, a, col)
    {
        var an0 = Math.atan2(uy, ux);
        g.save();
        g.globalCompositeOperation = "lighter";
        g.translate(x * dpr, y * dpr);
        g.rotate(an0);
        var gr = g.createRadialGradient(r * 0.3 * dpr, 0, 0, r * 0.3 * dpr, 0, r * dpr);
        gr.addColorStop(0, rgba("255,255,240", a));
        gr.addColorStop(0.4, rgba(col, a * 0.85));
        gr.addColorStop(1, rgba(col, 0));
        g.fillStyle = gr;
        g.beginPath();
        var n = 9;
        for (var i = 0; i <= n * 2; i++)
        {
            var t = i / (n * 2) * 6.283;
            var fwd = Math.max(0, Math.cos(t));               // longer forward
            var rr = (i % 2 ? 0.3 : 0.55 + 0.45 * fwd * fwd + rnd(-0.08, 0.08)) * r;
            var px = Math.cos(t) * rr * (1 + fwd * 0.8), py = Math.sin(t) * rr * 0.75;
            if (i === 0) g.moveTo(px * dpr, py * dpr); else g.lineTo(px * dpr, py * dpr);
        }
        g.closePath();
        g.fill();
        g.restore();
    }

    // Shots -------------------------------------------------------------------------
    // shot: {kind, brand, br, dir {x,y} (map axes), t0, rel (ms of release),
    //        released, locked (dir from the missile cell), fx_done{}}

    // branded shots keep the tile sparkle a little past the settle
    var AURA_TAIL = 260;

    function set_brand(s, brand)
    {
        s.brand = brand;
        s.br = BRANDS[brand] || BRANDS.none;
        s.end = s.base_end + (s.br.fx ? AURA_TAIL : 0);
    }

    // skip: fraction of the wind-up already over (missile seen in flight)
    function start(kind, brand, dir, locked, skip)
    {
        if (!api.get("ranged_feel")) return null;
        var tl = TL[kind] || TL.dart;
        var s = { kind: kind, dir: dir || { x: 1, y: 0 },
                  t0: kit.now() - tl.pre * (skip || 0), rel: tl.pre,
                  base_end: tl.pre + tl.post, locked: !!locked, fx: {},
                  side: 0, aura_acc: 0 };
        set_brand(s, brand);
        shots.push(s);
        kick_loop();
        return s;
    }

    // ms between a coglin's two launchers going off
    var DUAL_GAP = 170;

    // start a shot; with two launchers in hand, the other one follows
    // DUAL_GAP ms later (its own kind, brand and hand side)
    function start_volley(kind, brand, dir, locked, skip)
    {
        var ls = LAUNCHED[kind] ? launchers() : [];
        var i = ls.length > 1 && ls[1].kind === kind && ls[0].kind !== kind
                ? 1 : 0;
        if (ls.length && ls[i].kind === kind && !brand) brand = ls[i].brand;
        var s = start(kind, brand, dir, locked, skip);
        if (!s || ls.length < 2) return s;
        var o = ls[1 - i];
        var s2 = start(o.kind, o.brand, s.dir, locked);
        // released DUAL_GAP after the first (its wind-up may overlap)
        s2.t0 = s.t0 + s.rel + DUAL_GAP - s2.rel;
        s.side = i ? -1 : 1;            // main hand +1, off hand -1
        s2.side = -s.side;
        s.mate = s2; s2.mate = s;
        return s;
    }

    function alive(s, t) { return t - s.t0 < s.end; }

    function active_shot(t)
    {
        for (var i = shots.length - 1; i >= 0; i--)
            if (t - shots[i].t0 < shots[i].rel + 120) return shots[i];
        return null;
    }

    // a live shot of this kind not yet matched to trigger `flag`
    // ("cell" = its missile tile, "msg" = its "You shoot" line)
    function unclaimed(kind, flag, t)
    {
        for (var i = 0; i < shots.length; i++)
        {
            var s = shots[i];
            if (s.kind === kind && !s[flag] && alive(s, t)) return s;
        }
        return null;
    }

    function aim(s, dir)
    {
        if (s.locked) return;
        s.dir = dir;
        s.locked = true;
        if (s.mate && !s.mate.locked) { s.mate.dir = dir; s.mate.locked = true; }
    }

    // per-frame sprite pose of one shot: {x, y, tremor, squash} in tiles
    function pose(s, t)
    {
        var d = s.dir, pre = s.rel, u, r = t - pre;
        var back = 0, tremor = 0, squash = 0, ox = 0, oy = 0;
        switch (s.kind)
        {
        case "bow":
            if (t < pre) { u = ease_in(t / pre); back = -0.05 * u;
                           tremor = 0.008 * u; squash = -0.025 * u; }
            else { back = -0.05 * spring(r, 85, 0.05);
                   squash = 0.02 * Math.exp(-r / 60); }
            break;
        case "xbow":
            back = -0.075 * spring(t, 55, 0.06);
            squash = 0.03 * Math.exp(-t / 45);
            tremor = 0.006 * Math.exp(-t / 50);
            break;
        case "cannon":
            back = -0.12 * spring(t, 80, 0.035);
            squash = 0.07 * Math.exp(-t / 55);
            tremor = 0.012 * Math.exp(-t / 70);
            break;
        case "sling":
            if (t < pre)
            {
                // whirl: the sprite top circles, speeding up (2 turns)
                u = t / pre;
                var ph = 6.283 * 2 * u * u + Math.atan2(d.y, d.x) + Math.PI;
                var amp = 0.035 * (0.4 + 0.6 * u);
                ox = Math.cos(ph) * amp; oy = Math.sin(ph) * amp * 0.6;
            }
            else { back = 0.05 * spring(r, 70, 0.05); }
            break;
        case "rock":
            if (t < pre) { u = ease_in(t / pre); back = -0.06 * u; squash = -0.04 * u; }
            else { back = 0.07 * spring(r, 80, 0.04); squash = 0.04 * Math.exp(-r / 60); }
            break;
        default:                                   // dart, javelin, spin, net
            var big = s.kind === "javelin" || s.kind === "net" ? 1.4
                      : s.kind === "dart" ? 0.7 : 1;
            if (t < pre) { u = ease_in(t / pre); back = -0.045 * big * u;
                           squash = -0.015 * big * u; }
            else back = 0.055 * big * spring(r, 65, 0.05);
        }
        return { x: d.x * back + ox, y: d.y * back + oy, tremor: tremor,
                 squash: squash };
    }

    // view shake (device px) of a shot at time t
    function shake(s, t)
    {
        var r = t - s.rel;
        if (r < 0) return null;
        var A = s.kind === "cannon" ? 6 * Math.exp(-r / 90)
              : s.kind === "xbow" ? 2.2 * Math.exp(-r / 50)
              : s.kind === "rock" ? 2 * Math.exp(-r / 70) : 0;
        if (A < 0.2) return null;
        // mostly along the firing axis (recoil), plus jitter
        return { sx: -s.dir.x * A * Math.cos(r * 0.09) + rnd(-0.4, 0.4) * A,
                 sy: s.dir.y * A * Math.cos(r * 0.09) + rnd(-0.4, 0.4) * A };
    }

    // overlay drawing + one-off emissions of a shot
    function draw_shot(g, s, t, red, dt)
    {
        var P0 = kit.anchor_of(kit.player_pos());
        if (!P0) return;
        var cw = P0.cw, d = s.dir, br = s.br;
        // screen direction (same axes as the map, y down)
        var sd = norm(d.x, d.y), ux = sd.x, uy = sd.y;
        // two launchers: each hand's weapon sits a little off to its side
        var P = { x: P0.x - uy * s.side * cw * 0.17,
                  y: P0.y + ux * s.side * cw * 0.17, cw: cw };
        var r = t - s.rel, released = r >= 0;
        var fade = released ? Math.max(0, 1 - r / (s.base_end - s.rel)) : 1;
        if (br.fx && !red) aura(s, P0, P, t, dt);
        if (t >= s.base_end) return 0;
        var mx = P.x + ux * cw * 0.5, my = P.y + uy * cw * 0.5;   // muzzle

        if (released && !s.fx.rel)
        {
            s.fx.rel = true;
            release_fx(s, P, mx, my, ux, uy, cw, red);
        }

        switch (s.kind)
        {
        case "bow":
            var pull = released ? 0 : ease_out(t / s.rel);
            var vib = released ? cw * 0.22 * spring(r, 55, 0.09) : 0;
            var a = released ? Math.max(0, 1 - r / 380) : Math.min(1, t / 40);
            if (a > 0) draw_bow(g, s, P, ux, uy, cw, pull, vib, a);
            if (released && r < 220)              // twang: fine vibration lines
            {
                var k = r / 220;
                ring(g, P.x + ux * cw * 0.2, P.y + uy * cw * 0.2,
                     cw * (0.35 + 0.5 * k), br.c2, 0.6 * (1 - k), 1, ux, uy, 0.7);
            }
            break;
        case "xbow":
            var flex = released ? Math.max(0, spring(r, 40, 0.11)) : 1;
            var a2 = Math.max(0, 1 - r / 360);
            if (a2 > 0) draw_prod(g, s, P, ux, uy, cw, flex, a2);
            if (r < 200)
            {
                var k2 = r / 200;
                ring(g, mx, my, cw * (0.15 + 0.55 * k2), br.c, 0.8 * (1 - k2), 2,
                     ux, uy, 0.9);
            }
            break;
        case "cannon":
            if (r < 110)
            {
                var k3 = r / 110;
                muzzle_star(g, mx, my, ux, uy, cw * (0.55 + 0.5 * k3),
                            1 - k3, br.fx ? br.c : "255,175,60");
            }
            if (r < 60)
                radial(g, P.x, P.y, cw * 2.4, "255,240,210", "255,170,80",
                       0.35 * (1 - r / 60));
            if (r < 320)
            {
                var k4 = r / 320;
                ring(g, mx, my, cw * (0.2 + 1.5 * ease_out(k4)), "255,230,200",
                     0.7 * (1 - k4), 2.5 * (1 - k4) + 0.5);
            }
            break;
        case "sling":
            if (!released)
            {
                // blurred strap arc whirling over your head
                var u = t / s.rel;
                var ph = 6.283 * 2 * u * u;
                var hr = cw * 0.38, hx = P.x, hy = P.y - cw * 0.3;
                var col = br.fx ? br.c : "220,200,160";
                glow_stroke(g, col, 0.55 + 0.35 * u, 1.6, 6, function () {
                    g.ellipse(hx * dpr, hy * dpr, hr * dpr, hr * 0.45 * dpr, 0,
                              ph, ph + 1.2 + 2 * u);
                });
                // the stone at the strap's end
                var ex = hx + Math.cos(ph + 1.2 + 2 * u) * hr;
                var ey = hy + Math.sin(ph + 1.2 + 2 * u) * hr * 0.45;
                radial(g, ex, ey, cw * 0.12, br.c2, col, 0.9);
            }
            else if (r < 200)
            {
                var k5 = r / 200;
                ring(g, P.x + ux * cw * 0.25, P.y + uy * cw * 0.25 - cw * 0.15,
                     cw * (0.3 + 0.5 * k5), br.fx ? br.c : "230,220,190",
                     0.7 * (1 - k5), 1.6, ux, uy, 1.1);
            }
            break;
        default:                                         // throws
            if (released && r < 220)
            {
                var k6 = r / 220, big = s.kind === "javelin" || s.kind === "rock"
                                        || s.kind === "net";
                ring(g, P.x + ux * cw * 0.3, P.y + uy * cw * 0.3,
                     cw * (0.25 + (big ? 0.7 : 0.45) * k6),
                     br.fx ? br.c : "230,235,245", 0.65 * (1 - k6),
                     big ? 2 : 1.3, ux, uy, big ? 1.0 : 0.7);
                if (s.kind === "spin")
                    ring(g, P.x, P.y, cw * (0.45 + 0.2 * k6), br.c2,
                         0.5 * (1 - k6), 1.2, Math.cos(r * 0.05), Math.sin(r * 0.05), 1.3);
            }
        }
        return fade;
    }

    // Brand sparkle on your own tile: while a branded shot is drawn and just
    // after, the weapon's element plays faintly over your sprite (crackling
    // arcs for electrocution, embers rising off flaming, frost glints, ...).
    // P0: tile centre, P: the firing hand's spot (dual launchers).
    function aura(s, P0, P, t, dt)
    {
        var br = s.br, cw = P0.cw, r = t - s.rel;
        if (t < 0) return;
        // intensity: builds through the wind-up, peaks at release, decays
        var lv = r < 0 ? 0.45 + 0.55 * (s.rel ? t / s.rel : 1)
                       : Math.exp(-r / 300);
        if (lv < 0.04) return;
        var n = 0;
        if (r >= 0 && !s.fx.aura) { s.fx.aura = true; n = 4; }    // release pop
        s.aura_acc += 26 * lv * dt / 1000;                      // ~26/s peak
        n += Math.floor(s.aura_acc);
        s.aura_acc -= Math.floor(s.aura_acc);
        for (var i = 0; i < n; i++)
        {
            // mostly over the sprite, biased toward the firing hand
            var x = (Math.random() < 0.6 ? P.x : P0.x) + rnd(-0.36, 0.36) * cw;
            var y = P0.y + rnd(-0.42, 0.3) * cw;
            var c = Math.random() < 0.45 ? br.c2 : br.c;
            if (s.brand === "elec")
            {
                part({ x: x, y: y, vx: 0, vy: 0, life: rnd(70, 150),
                       s: rnd(0.12, 0.24) * cw, an: rnd(0, 6.283),
                       ty: "arc", c: c, add: 1 });
                continue;
            }
            switch (br.fx)
            {
            case "ember":
                part({ x: x, y: y, vx: rnd(-0.1, 0.1) * cw,
                       vy: -rnd(0.2, 0.5) * cw, g: -0.25 * cw, drag: 1.5,
                       life: rnd(380, 700), s: rnd(0.022, 0.04) * cw,
                       ty: "ember", c: c, add: 1 });
                break;
            case "frost":
                if (Math.random() < 0.5)
                    part({ x: x, y: y, vx: rnd(-0.05, 0.05) * cw,
                           vy: rnd(0.02, 0.12) * cw, drag: 1, life: rnd(450, 800),
                           s: rnd(0.03, 0.05) * cw, ty: "flake", c: c,
                           vr: rnd(-3, 3), add: 1 });
                else
                    part({ x: x, y: y, vx: 0, vy: 0, life: rnd(260, 480),
                           s: rnd(0.05, 0.09) * cw, ty: "glint", c: c, add: 1 });
                break;
            case "spark":                            // steel
                part({ x: x, y: y, vx: rnd(-0.6, 0.6) * cw, vy: rnd(-0.6, 0.2) * cw,
                       drag: 6, life: rnd(90, 180), s: rnd(0.06, 0.12) * cw,
                       ty: "spark", c: c, add: 1 });
                break;
            case "drip":
                part({ x: x, y: y, vx: 0, vy: rnd(0, 0.1) * cw, g: 1.1 * cw,
                       drag: 1.5, life: rnd(380, 600), s: rnd(0.02, 0.034) * cw,
                       ty: "drop", c: c, add: 1 });
                break;
            case "chaos":
                part({ x: x, y: y, vx: rnd(-0.2, 0.2) * cw, vy: rnd(-0.2, 0.2) * cw,
                       life: rnd(260, 480), s: rnd(0.025, 0.045) * cw,
                       ty: "chaos", h: rnd(0, 360), vr: rnd(-6, 6), add: 1 });
                break;
            case "glint":
                part({ x: x, y: y, vx: 0, vy: -rnd(0, 0.08) * cw, life: rnd(300, 560),
                       s: rnd(0.05, 0.1) * cw, ty: "glint", c: c, add: 1 });
                break;
            case "smoke":
                part({ x: x, y: y + 0.15 * cw, vx: rnd(-0.08, 0.08) * cw,
                       vy: -rnd(0.12, 0.25) * cw, drag: 1.2, life: rnd(450, 800),
                       s: rnd(0.08, 0.13) * cw, ty: "smoke", c: "45,15,75",
                       grow: 1.3, alpha: 0.32 });
                break;
            }
        }
    }

    // one-off particles / light at the moment of release
    function release_fx(s, P, mx, my, ux, uy, cw, red)
    {
        var br = s.br, i;
        if (red) return;
        if (s.kind === "cannon")
        {
            for (i = 0; i < 9; i++)
                part({ x: mx, y: my, vx: (ux * rnd(0.3, 1.1) + rnd(-0.5, 0.5)) * cw,
                       vy: (uy * rnd(0.3, 1.1) + rnd(-0.5, 0.5)) * cw - 0.2 * cw,
                       drag: 2.2, life: rnd(900, 1600), s: rnd(0.16, 0.32) * cw,
                       ty: "smoke", c: "160,158,160", grow: 2.2, alpha: 0.5 });
            for (i = 0; i < 10; i++)
                part({ x: mx, y: my, vx: (ux * rnd(1, 3.5) + rnd(-1.2, 1.2)) * cw,
                       vy: (uy * rnd(1, 3.5) + rnd(-1.2, 1.2)) * cw, g: 1.8 * cw,
                       drag: 3, life: rnd(150, 350), s: rnd(0.1, 0.18) * cw,
                       ty: "spark", c: "255,215,130", add: 1 });
            flash_light(s, "fire", 2.2, 160);
        }
        else if (s.kind === "xbow")
        {
            for (i = 0; i < 4; i++)
                part({ x: P.x + rnd(-0.3, 0.3) * cw, y: P.y + cw * 0.4,
                       vx: rnd(-0.5, 0.5) * cw, vy: -rnd(0.05, 0.2) * cw,
                       drag: 2.5, life: rnd(400, 700), s: rnd(0.1, 0.18) * cw,
                       ty: "smoke", c: "130,115,95" });
        }
        else if (s.kind === "rock")
        {
            for (i = 0; i < 6; i++)
                part({ x: P.x + rnd(-0.35, 0.35) * cw, y: P.y + cw * 0.4,
                       vx: rnd(-0.7, 0.7) * cw, vy: -rnd(0.05, 0.3) * cw,
                       drag: 2.5, life: rnd(450, 800), s: rnd(0.12, 0.22) * cw,
                       ty: "smoke", c: "130,115,95" });
        }
        else if (!br.fx)
        {
            // plain: a few pale air motes kicked forward
            for (i = 0; i < 5; i++)
                part({ x: mx, y: my, vx: (ux * rnd(0.6, 1.6) + rnd(-0.4, 0.4)) * cw,
                       vy: (uy * rnd(0.6, 1.6) + rnd(-0.4, 0.4)) * cw, drag: 5,
                       life: rnd(200, 380), s: rnd(0.02, 0.035) * cw, ty: "mote",
                       c: "230,240,255", add: 1 });
        }
        brand_burst(br, mx, my, ux, uy, cw, s.kind === "cannon" ? 12 : 9);
        if (br.fx) flash_light(s, { ember: "fire", frost: "cold", spark: "elec",
                                    drip: "poison", glint: "holy", smoke: "dark",
                                    chaos: "magic" }[br.fx] || "magic", 1.0, 220);
    }

    // brief light at the player through light.js
    var lights = [];
    function flash_light(s, cls, f, ms)
    {
        var p = kit.player_pos();
        if (!p) return;
        lights.push({ x: p.x + Math.round(s.dir.x), y: p.y + Math.round(s.dir.y),
                      cls: cls, f: f, t0: kit.now(), ms: ms });
    }
    api.light_extra("rangedfx", function () {
        if (!lights.length) return null;
        var t = kit.now();
        lights = lights.filter(function (l) { return t - l.t0 < l.ms; });
        return lights.map(function (l) {
            return { x: l.x, y: l.y, cls: l.cls,
                     f: l.f * (1 - (t - l.t0) / l.ms) };
        });
    });

    // Frame -------------------------------------------------------------------------
    function frame()
    {
        raf = 0;
        var now = kit.now(), dt = Math.min(50, now - last_t);
        last_t = now;
        var g = canvas();
        g.clearRect(0, 0, cv.width, cv.height);
        var red = kit.reduced();
        var px = 0, py = 0, tr = 0, sq = 0, sx = 0, sy = 0, any = false;
        for (var i = shots.length - 1; i >= 0; i--)
        {
            var s = shots[i], t = now - s.t0;
            if (t >= s.end) { shots.splice(i, 1); continue; }
            if (t < 0) continue;                     // queued off-hand shot
            any = true;
            try
            {
                draw_shot(g, s, t, red, dt);
                if (!red)
                {
                    var p = pose(s, t);
                    px += p.x; py += p.y;
                    tr = Math.max(tr, p.tremor); sq += p.squash;
                    var sh = shake(s, t);
                    if (sh) { sx += sh.sx; sy += sh.sy; }
                }
            }
            catch (e) { window.sdc_rangedfx_err = e; }
        }
        api.emit("player_kick", any && !red
                 ? { x: px, y: py, tremor: tr, squash: sq } : null);
        api.grade("rangedfx", (sx || sy) ? { sx: sx, sy: sy } : null);
        draw_parts(g, dt);
        if (shots.length || parts.length)
            raf = window.requestAnimationFrame(frame);
        else
            g.clearRect(0, 0, cv.width, cv.height);
    }

    // Triggers ----------------------------------------------------------------------

    function adj(a, b)
    {
        return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    }

    var pending = null;                 // message info seen before the missile

    // a missile tile appeared next to you: fire now (or aim the wind-up)
    function on_missile(kind, cell, pl)
    {
        var t = kit.now();
        var dir = norm(cell.x - pl.x, cell.y - pl.y);
        // the second missile of a dual-launcher volley (or a message-started
        // shot of this kind): aim it, don't start another
        var s = unclaimed(kind, "cell", t);
        if (s) { s.cell = true; aim(s, dir); return; }
        s = active_shot(t);
        if (s && !s.locked)
        {
            aim(s, dir);
            s.cell = true;
            if (!s.from_msg_kind) s.kind = kind;
            return;
        }
        if (t - last_dir_t < 150) return;            // same volley
        var brand = LAUNCHED[kind] ? launcher_brand(kind) : null;
        if (pending && t - pending.t < 1200 && pending.kind === kind)
            brand = pending.brand || brand;
        // the missile is already on its way: skip most of the wind-up
        var ns = start_volley(kind, brand, dir, true, 0.6);
        if (ns) ns.cell = true;
    }

    function note_cells()
    {
        var dirty = map_knowledge.dirty();
        var pl = kit.player_pos();
        var best = null;
        for (var i = 0; i < dirty.length; i++)
        {
            var d = dirty[i], key = d.x + "," + d.y;
            var mc = map_knowledge.get(d.x, d.y);
            var kind = null;
            if (mc && mc.t && mc.t.ov)
                for (var j = 0; j < mc.t.ov.length && !kind; j++)
                    kind = missile_kind(mc.t.ov[j]);
            var was = ov_seen[key];
            if (kind) ov_seen[key] = true; else delete ov_seen[key];
            if (kind && !was && pl && !(d.x === pl.x && d.y === pl.y)
                && adj(pl, d) <= 1 && !best)
                best = { x: d.x, y: d.y, kind: kind };
        }
        if (best)
        {
            on_missile(best.kind, best, pl);
            last_dir_t = kit.now();
        }
    }

    function hook_merge()
    {
        if (map_knowledge.merge.sdc_rangedfx) return;
        var orig = map_knowledge.merge;
        var wrapped = function () {
            var res = orig.apply(this, arguments);
            try { if (api.get("ranged_feel")) note_cells(); }
            catch (e) {}
            return res;
        };
        for (var k in orig)
            if (/^sdc_/.test(k)) wrapped[k] = orig[k];
        wrapped.sdc_rangedfx = true;
        map_knowledge.merge = wrapped;
    }

    var LAUNCH_RE = /^You (shoot|throw)\s+(.*?)(?: into the darkness)?\.?$/;

    function launch(text)
    {
        if (!api.get("ranged_feel")) return;
        var m = LAUNCH_RE.exec(text);
        if (!m) return;
        var t = kit.now();
        var w = wielded();
        var kind = kind_of(m[2], w);
        var brand = brand_of(m[2]) || (LAUNCHED[kind] ? launcher_brand(kind) : null);
        pending = { t: t, brand: brand, kind: kind };
        // the missile (or the other launcher's line) already started this
        // shot: just refine the brand
        var s = unclaimed(kind, "msg", t) || active_shot(t)
                || (shots.length && t - shots[shots.length - 1].t0 < 400
                    ? shots[shots.length - 1] : null);
        if (s)
        {
            s.msg = true;
            if (brand && !s.brand) set_brand(s, brand);
            return;
        }
        var ns = start_volley(kind, brand, nearest_dir(), false);
        if (ns) { ns.from_msg_kind = true; ns.msg = true; }
    }

    kit.on_message(function (text) { launch(text); });

    // Lifecycle ---------------------------------------------------------------------
    function reset()
    {
        ov_seen = {};
        shots = [];
        parts = [];
        lights = [];
        pending = null;
        api.emit("player_kick", null);
        api.grade("rangedfx", null);
        if (cx && cv) cx.clearRect(0, 0, cv.width, cv.height);
    }
    api.on("game_init", function () { hook_merge(); reset(); });
    api.on("game_cleanup", reset);
    hook_merge();

    // Debug -------------------------------------------------------------------------
    // kind2/brand2: a second (off-hand) launcher, as a coglin volley
    window.sdc_rangedfx_test = function (kind, brand, dx, dy, kind2, brand2)
    {
        var dir = (dx || dy) ? norm(dx || 0, dy || 0) : nearest_dir();
        if (!dir) return "no player";
        var s = start(kind || "bow", brand || null, dir, true);
        if (s && kind2)
        {
            var s2 = start(kind2, brand2 || null, dir, true);
            s2.t0 = s.t0 + s.rel + DUAL_GAP - s2.rel;
            s.side = 1; s2.side = -1; s.mate = s2; s2.mate = s;
        }
        return (kind || "bow") + "/" + (brand || "none")
               + (kind2 ? " + " + kind2 + "/" + (brand2 || "none") : "");
    };
    window.sdc_rangedfx_state = function ()
    {
        return { shots: shots.map(function (s) {
                     return { kind: s.kind, brand: s.brand, dir: s.dir };
                 }), parts: parts.length, raf: !!raf };
    };

    return {};
});
