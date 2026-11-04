// Animated cloud overlay: fog, steam, flames, poison etc. drift and swirl
// inside their tiles even while the player is not acting.
//
// How it works
// - At init every CLOUD_* tile index of tileinfo-main is classified once by
//   name into a "kind" (fire, elec, cold, poison, smoke, blacksmoke, steam, mist, magic, dust,
//   gold), each with a tint, a pre-rendered tileable soft-noise texture and
//   two scrolling layers.
// - Each frame the visible, seen cells are scanned for t.cloud. Found cells
//   get a fade-in/out entry, so clouds appear and disappear smoothly.
// - Each cell draws two windows of the (2x2 tiled) kind texture into its
//   tile quad. Window offsets follow world coordinates plus a shared
//   drift/orbit, so neighbouring cells form one continuous drifting field;
//   per-cell phases only modulate alpha (pulse / flame flicker).
// - Alignment: the CRT shader barrel-warps the dungeon ("Curvature" option, api.curve_k()).
//   Here every cell's corners are pushed through the inverse of that warp
//   and the tile is drawn as an affine parallelogram, so the overlay lines
//   up with the curved picture (to within the tiny non-affine residue).
//   Curve is read from body classes sdc-gl + sdc-curved.
//
// Debug (browser console):
//   sdc_clouds_debug.force("fire", x, y)   forced cloud (default player pos)
//   sdc_clouds_debug.clear()               remove forced clouds
//   sdc_clouds_debug.stats()               counts / timing
//   sdc_clouds_debug.kinds()               kind names
//   sdc_clouds_debug.classify(idx)         kind of a cloud tile index
define(["jquery", "./sdc_api", "./map_knowledge", "./dungeon_renderer",
        "./enums", "./player", "./tileinfo-main"],
function ($, api, map_knowledge, dungeon_renderer, enums, player, main) {
    "use strict";

    var MAX_CELLS = 160;        // cap on drawn cells per frame
    var TEX = 96;               // tile size of the noise texture (px)
    var FADE_IN = 0.30, FADE_OUT = 0.45;    // seconds
    var UNSEEN_BITS = 0x00020000 | 0x00040000;  // MM_UNSEEN | UNSEEN

    // Kinds -------------------------------------------------------------------
    // rgb: blob colours; n: blobs per texture; rx/ry: blob radii (px of TEX);
    // a: blob peak alpha. layers: win = window size in texels (a cell shows
    // a win x win window of the texture), sx/sy drift in texels/s, orbit
    // radius R (texels) and angular speed w (rad/s), al = layer alpha.
    // anim: pulse | flicker | strobe; amp = alpha modulation depth.
    var KIND_DEFS = {
        fire: { rgb: [[255, 214, 90], [255, 130, 30], [235, 64, 16]],
                n: 16, rx: 7, ry: 17, a: 0.85,
                layers: [{ win: 40, sx: 2, sy: 46, R: 5, w: 3.1, al: 0.75 },
                         { win: 56, sx: -3, sy: 70, R: 4, w: -4.3, al: 0.5 }],
                anim: "flicker", amp: 0.3, base: 0.85 },
        elec: { rgb: [[200, 225, 255], [130, 170, 255]],
                n: 14, rx: 6, ry: 6, a: 0.8,
                layers: [{ win: 44, sx: 14, sy: -10, R: 5, w: 5.0, al: 0.7 },
                         { win: 60, sx: -18, sy: 12, R: 3, w: -6.0, al: 0.45 }],
                anim: "strobe", amp: 0.5, base: 0.7 },
        cold: { rgb: [[235, 248, 255], [170, 220, 255]],
                n: 12, rx: 15, ry: 12, a: 0.6,
                layers: [{ win: 52, sx: 5, sy: 3, R: 9, w: 0.7, al: 0.6 },
                         { win: 72, sx: -4, sy: 4, R: 7, w: -0.5, al: 0.4 }],
                anim: "pulse", amp: 0.18, base: 0.8 },
        poison: { rgb: [[150, 255, 90], [90, 210, 60], [200, 255, 130]],
                  n: 12, rx: 14, ry: 12, a: 0.6,
                  layers: [{ win: 52, sx: 4, sy: -3, R: 8, w: 0.9, al: 0.6 },
                           { win: 72, sx: -5, sy: 2, R: 6, w: -0.6, al: 0.4 }],
                  anim: "pulse", amp: 0.2, base: 0.8 },
        smoke: { rgb: [[130, 130, 125], [70, 70, 68], [180, 175, 165]],
                 n: 12, rx: 15, ry: 13, a: 0.55,
                 layers: [{ win: 56, sx: 3, sy: -9, R: 6, w: 0.6, al: 0.55 },
                          { win: 76, sx: -3, sy: -6, R: 5, w: -0.4, al: 0.4 }],
                 anim: "pulse", amp: 0.12, base: 0.85 },
        mist: { rgb: [[240, 245, 245], [200, 215, 220]],
                n: 11, rx: 18, ry: 11, a: 0.5,
                layers: [{ win: 60, sx: 7, sy: 0.8, R: 5, w: 0.5, al: 0.55 },
                         { win: 80, sx: -5, sy: -0.6, R: 4, w: -0.35, al: 0.4 }],
                anim: "pulse", amp: 0.15, base: 0.85 },
        magic: { rgb: [[220, 150, 255], [140, 120, 255], [255, 190, 255]],
                 n: 12, rx: 9, ry: 9, a: 0.7,
                 layers: [{ win: 48, sx: 6, sy: 6, R: 10, w: 1.8, al: 0.6 },
                          { win: 64, sx: -7, sy: 5, R: 8, w: -2.2, al: 0.45 }],
                 anim: "pulse", amp: 0.3, base: 0.8 },
        dust: { rgb: [[205, 170, 120], [170, 140, 100], [230, 205, 160]],
                n: 18, rx: 5, ry: 5, a: 0.6,
                layers: [{ win: 48, sx: 9, sy: -3, R: 7, w: 1.1, al: 0.55 },
                         { win: 64, sx: -7, sy: 4, R: 6, w: -1.4, al: 0.4 }],
                anim: "pulse", amp: 0.15, base: 0.85 },
        gold: { rgb: [[255, 236, 150], [255, 200, 80]],
                n: 22, rx: 3.5, ry: 3.5, a: 0.85,
                layers: [{ win: 48, sx: 5, sy: -8, R: 6, w: 1.5, al: 0.6 },
                         { win: 64, sx: -6, sy: -5, R: 5, w: -1.9, al: 0.45 }],
                anim: "pulse", amp: 0.3, base: 0.75 },
        // black smoke (CLOUD_BLACK_SMOKE): heavy dark billows rising slowly,
        // a dim halo under it and a few ember glints at the base
        blacksmoke: { rgb: [[34, 30, 30], [16, 14, 14], [78, 66, 60], [52, 40, 36]],
                n: 13, rx: 14, ry: 15, a: 0.9,
                layers: [{ win: 44, sx: 2, sy: -17, R: 4, w: 0.8, al: 0.85 },
                         { win: 62, sx: -3, sy: -27, R: 6, w: -0.55, al: 0.6 }],
                anim: "pulse", amp: 0.1, base: 0.95,
                halo: { rgb: [0, 0, 0], a: 0.38 },
                embers: { n: 5, rgb: [255, 110, 30], rate: 0.45 } },
        // steam (CLOUD_STEAM shares the GREY/WHITE_SMOKE tile): bright pale
        // billows that rise fast, swell and fade, with a cool-white bloom
        steam: { rgb: [[255, 255, 255], [238, 247, 252], [214, 232, 242]],
                n: 12, rx: 15, ry: 13, a: 0.8,
                layers: [{ win: 50, sx: 3, sy: -38, R: 5, w: 1.0, al: 0.8, swell: 0.16 },
                         { win: 70, sx: -4, sy: -56, R: 4, w: -0.8, al: 0.6, swell: 0.22 }],
                anim: "pulse", amp: 0.2, base: 0.95,
                bloom: { rgb: [225, 242, 255], a: 0.30 } },
    };
    var KIND_NAMES = Object.keys(KIND_DEFS);
    var KINDS = [null];         // id -> def
    var KIND_ID = {};
    KIND_NAMES.forEach(function (name, i) {
        var d = KIND_DEFS[name];
        d.name = name;
        d.id = i + 1;
        d.tex = null;
        d.seed = 1013 + i * 7919;
        KINDS.push(d);
        KIND_ID[name] = d.id;
    });

    // Name -> kind (first match wins), trailing _N variant numbers stripped.
    var RULES = [
        [/^CLOUD_IMMUNE$/, null],
        [/^CLOUD_GOLD_DUST/, "gold"],
        [/^CLOUD_(FIRE|FOREST_FIRE|FLAME|BLASTMOTES)/, "fire"],
        [/^CLOUD_(STORM|ELECTRICITY)/, "elec"],
        [/^CLOUD_(COLD|FREEZING_WINDS|FAINT_FROST|FROST)/, "cold"],
        [/^CLOUD_(POISON|MEPHITIC|MIASMA|FAINT_MIASMA|ACID|DEGENERATION)/, "poison"],
        [/^CLOUD_BLACK_SMOKE/, "blacksmoke"],
        [/^CLOUD_(STEAM|GREY_SMOKE|WHITE_SMOKE)/, "steam"],
        [/SMOKE|^CLOUD_(INK|GLOOM|MISERY)/, "smoke"],
        [/^CLOUD_(TLOC_ENERGY|MAGIC_TRAIL|CHAOS|MUTAGENIC|SPECTRAL|GLIMMER)/, "magic"],
        [/^CLOUD_(DUST|MAGNETISED_DUST|RUST|BATS)/, "dust"],
        [/^CLOUD_/, "mist"],    // MIST, RAIN, STEAM, FOG, PETRIFY, ...
    ];

    var kind_of = null;         // tile index -> kind id

    function classify_name(name)
    {
        var base = name.replace(/(_\d+)+$/, "");
        for (var i = 0; i < RULES.length; i++)
        {
            if (!RULES[i][0].test(base)) continue;
            var k = RULES[i][1];
            return k ? KIND_ID[k] : 0;
        }
        return 0;
    }

    function build_tables()
    {
        if (kind_of) return;
        var max = 0, pairs = [];
        for (var name in main)
        {
            var v = main[name];
            if (typeof v !== "number" || !/^CLOUD_[A-Z0-9_]*$/.test(name))
                continue;
            pairs.push([v, name]);
            if (v > max) max = v;
        }
        kind_of = new Uint8Array(max + 1);
        pairs.forEach(function (p) {
            kind_of[p[0]] = kind_of[p[0]] || classify_name(p[1]);
        });
    }

    function lo(v)
    {
        if (typeof v === "number") return v;
        return v && v.length ? v[0] : 0;
    }

    function cloud_kind(v)
    {
        var idx = lo(v) & 0xFFFF;
        return idx && idx < kind_of.length ? kind_of[idx] : 0;
    }

    // Textures ----------------------------------------------------------------
    function rng(seed)
    {
        var s = seed >>> 0;
        return function () {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    // 2x2 repetition of a seamlessly tiling soft-blob field (TEX px tile)
    function make_texture(d)
    {
        var tile = document.createElement("canvas");
        tile.width = tile.height = TEX;
        var g = tile.getContext("2d");
        var rnd = rng(d.seed);
        for (var i = 0; i < d.n; i++)
        {
            var bx = rnd() * TEX, by = rnd() * TEX;
            var c = d.rgb[Math.floor(rnd() * d.rgb.length)];
            var sc = 0.7 + rnd() * 0.7;
            var rx = d.rx * sc, ry = d.ry * sc;
            var a = d.a * (0.5 + rnd() * 0.5);
            var col = c[0] + "," + c[1] + "," + c[2];
            for (var ox = -TEX; ox <= TEX; ox += TEX)
            {
                for (var oy = -TEX; oy <= TEX; oy += TEX)
                {
                    var cx = bx + ox, cy = by + oy;
                    if (cx + rx < 0 || cx - rx > TEX
                        || cy + ry < 0 || cy - ry > TEX)
                        continue;
                    g.save();
                    g.translate(cx, cy);
                    g.scale(rx, ry);
                    var grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
                    grad.addColorStop(0, "rgba(" + col + "," + a + ")");
                    grad.addColorStop(0.5, "rgba(" + col + "," + (a * 0.4) + ")");
                    grad.addColorStop(1, "rgba(" + col + ",0)");
                    g.fillStyle = grad;
                    g.fillRect(-1, -1, 2, 2);
                    g.restore();
                }
            }
        }
        var big = document.createElement("canvas");
        big.width = big.height = TEX * 2;
        var bg = big.getContext("2d");
        for (var tx = 0; tx < 2; tx++)
            for (var ty = 0; ty < 2; ty++)
                bg.drawImage(tile, tx * TEX, ty * TEX);
        return big;
    }

    // Unit-space radial gradient (centre of the tile, radius 0.55 tiles);
    // created once per kind and reused under each cell's transform.
    function radial(rgb, a)
    {
        var col = rgb[0] + "," + rgb[1] + "," + rgb[2];
        var g = ctx.createRadialGradient(0.5, 0.5, 0, 0.5, 0.5, 0.55);
        g.addColorStop(0, "rgba(" + col + "," + a + ")");
        g.addColorStop(0.55, "rgba(" + col + "," + (a * 0.45) + ")");
        g.addColorStop(1, "rgba(" + col + ",0)");
        return g;
    }

    // State -------------------------------------------------------------------
    var canvas = null, ctx = null;
    var entries = new Map();    // key -> {x, y, k, a, seen}
    var forced = [];            // debug: [{x, y, k}]
    var shown = false;
    var last_t = 0;
    var stats = { cells: 0, drawn: 0, kinds: {}, ms: 0, frames: 0,
                  curved: false, reason: "" };

    function key_of(x, y)
    {
        return ((y + 1024) * 4096 + (x + 1024));
    }

    function hash2(x, y)
    {
        var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return n - Math.floor(n);
    }

    function hide()
    {
        if (shown && canvas)
        {
            canvas.style.display = "none";
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        shown = false;
    }

    function ensure_canvas()
    {
        if (!canvas)
        {
            canvas = document.createElement("canvas");
            canvas.id = "sdc_clouds";
            ctx = canvas.getContext("2d");
        }
        // sit directly after #sdc_screen (above it, below HUD z >= 2);
        // without the GL screen just live in #normal after the dungeon
        var screen = document.getElementById("sdc_screen");
        if (screen && screen.parentNode)
        {
            if (screen.nextSibling !== canvas)
                screen.parentNode.insertBefore(canvas, screen.nextSibling);
        }
        else if (!canvas.parentNode)
        {
            var host = document.getElementById("normal") || document.body;
            host.appendChild(canvas);
        }
    }

    // Inverse of crt.js warp(): source (dungeon) uv -> screen uv. The shader
    // samples source c = o * (1 + k|o|^2) / (1 + k) at output o (c, o in
    // -1..1), so a cell at source c is shown at the o that solves that.
    function unwarp(u, v, k, out)
    {
        var cx = u * 2 - 1, cy = v * 2 - 1;
        if (k > 0)
        {
            var s = Math.sqrt(cx * cx + cy * cy);
            if (s > 1e-6)
            {
                var target = s * (1 + k), rho = s;
                for (var i = 0; i < 5; i++)
                {
                    var f = rho * (1 + k * rho * rho) - target;
                    rho -= f / (1 + 3 * k * rho * rho);
                }
                cx *= rho / s;
                cy *= rho / s;
            }
        }
        out[0] = (cx + 1) * 0.5;
        out[1] = (cy + 1) * 0.5;
    }

    function note(x, y, k, gen)
    {
        var key = key_of(x, y);
        var e = entries.get(key);
        if (!e)
        {
            e = { x: x, y: y, k: k, a: 0, seen: gen };
            entries.set(key, e);
        }
        else
        {
            e.k = k;
            e.seen = gen;
        }
    }

    // Per frame ---------------------------------------------------------------
    var p00 = [0, 0], p10 = [0, 0], p01 = [0, 0];

    function frame(t)
    {
        var dr = dungeon_renderer;
        var dungeon = document.getElementById("dungeon");
        if (!dungeon || !dr.view || !dr.cols || !dr.rows
            || dr.ui_state == enums.ui.VIEW_MAP)
        {
            stats.reason = "no view / map view";
            entries.clear();
            hide();
            return;
        }
        build_tables();
        var t0 = performance.now();
        var dt = last_t ? Math.min(0.25, (t - last_t) / 1000) : 0.033;
        last_t = t;
        var vx = dr.view.x, vy = dr.view.y, cols = dr.cols, rows = dr.rows;
        var gen = ++stats.frames;

        // scan visible cells for clouds
        for (var y = vy; y < vy + rows; y++)
        {
            for (var x = vx; x < vx + cols; x++)
            {
                var mc = map_knowledge.get(x, y);
                var tt = mc && mc.t;
                if (!tt || !tt.cloud) continue;
                if (lo(tt.bg) & UNSEEN_BITS) continue;
                var k = cloud_kind(tt.cloud);
                if (!k) continue;
                note(x, y, k, gen);
            }
        }
        for (var f = 0; f < forced.length; f++)
            note(forced[f].x, forced[f].y, forced[f].k, gen);

        // fade in / out
        var live = [];
        entries.forEach(function (e, key) {
            if (e.seen === gen)
                e.a = Math.min(1, e.a + dt / FADE_IN);
            else
            {
                e.a -= dt / FADE_OUT;
                if (e.a <= 0)
                {
                    entries.delete(key);
                    return;
                }
            }
            if (e.x >= vx && e.x < vx + cols && e.y >= vy && e.y < vy + rows)
                live.push(e);
        });
        stats.cells = live.length;
        if (!live.length)
        {
            stats.reason = "no clouds";
            hide();
            return;
        }

        // canvas geometry: same rect as the dungeon / CRT screen
        ensure_canvas();
        var r = dungeon.getBoundingClientRect();
        if (r.width < 4 || r.height < 4)
        {
            hide();
            return;
        }
        var w = Math.round(r.width), h = Math.round(r.height);
        if (canvas.width !== w || canvas.height !== h)
        {
            canvas.width = w;
            canvas.height = h;
        }
        var st = canvas.style;
        st.left = r.left + "px";
        st.top = r.top + "px";
        st.width = r.width + "px";
        st.height = r.height + "px";
        st.display = "block";
        shown = true;

        var body = document.body.classList;
        var k_curve = body.contains("sdc-gl") && body.contains("sdc-curved")
                      ? api.curve_k() : 0;
        stats.curved = k_curve > 0;
        stats.reason = "drawing";

        var still = api.reduced_motion();
        var secs = still ? 0 : t / 1000;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = true;

        // cap: keep the cells nearest the player
        if (live.length > MAX_CELLS)
        {
            var px = player.pos.x, py = player.pos.y;
            live.sort(function (a, b) {
                return (Math.abs(a.x - px) + Math.abs(a.y - py))
                     - (Math.abs(b.x - px) + Math.abs(b.y - py));
            });
            live.length = MAX_CELLS;
        }

        var kinds = {};
        var drawn = 0;
        for (var i = 0; i < live.length; i++)
        {
            var e = live[i];
            var d = KINDS[e.k];
            if (!d.tex) d.tex = make_texture(d);

            // tile corners in dungeon uv -> screen px
            var u0 = (e.x - vx) / cols, u1 = (e.x - vx + 1) / cols;
            var v0 = (e.y - vy) / rows, v1 = (e.y - vy + 1) / rows;
            unwarp(u0, v0, k_curve, p00);
            unwarp(u1, v0, k_curve, p10);
            unwarp(u0, v1, k_curve, p01);
            ctx.setTransform((p10[0] - p00[0]) * w, (p10[1] - p00[1]) * h,
                             (p01[0] - p00[0]) * w, (p01[1] - p00[1]) * h,
                             p00[0] * w, p00[1] * h);

            // alpha modulation, phase-shifted per cell
            var ph = hash2(e.x, e.y);
            var m;
            if (d.anim === "flicker")
            {
                m = d.base + d.amp * (0.55 * Math.sin(secs * 9.0 + ph * 40.0)
                                      + 0.45 * Math.sin(secs * 23.0 + ph * 91.0));
            }
            else if (d.anim === "strobe")
            {
                var step = Math.floor(secs * 12);
                var rr = hash2(step * 0.37 + ph * 5.0, ph * 97.0);
                m = rr > 0.65 ? 1.2 : (rr > 0.3 ? 0.6 : 0.3);
                if (still) m = d.base;
            }
            else
                m = d.base + d.amp * Math.sin(secs * 1.3 + ph * 6.283);
            var cell_a = Math.max(0, m) * e.a;

            if (d.halo)
            {
                if (!d.halo.grad || d.halo.ctx !== ctx)
                {
                    d.halo.grad = radial(d.halo.rgb, d.halo.a);
                    d.halo.ctx = ctx;
                }
                ctx.globalAlpha = Math.min(1, e.a);
                ctx.fillStyle = d.halo.grad;
                ctx.fillRect(0, 0, 1, 1);
            }

            for (var li = 0; li < d.layers.length; li++)
            {
                var L = d.layers[li];
                var ang = secs * L.w + li * 1.7;
                var win = L.win;
                if (L.swell)    // billow: window breathes, cloud swells/shrinks
                    win *= 1 + L.swell * Math.sin(secs * 0.9 + ph * 6.283 + li * 2.1);
                var wx = e.x * L.win + L.sx * secs + L.R * Math.cos(ang);
                var wy = e.y * L.win + L.sy * secs + L.R * Math.sin(ang);
                wx = ((wx % TEX) + TEX) % TEX;
                wy = ((wy % TEX) + TEX) % TEX;
                if (wx + win > TEX * 2) wx = TEX * 2 - win;
                if (wy + win > TEX * 2) wy = TEX * 2 - win;
                ctx.globalAlpha = Math.min(1, cell_a * L.al);
                ctx.drawImage(d.tex, wx, wy, win, win, 0, 0, 1, 1);
            }

            if (d.bloom)
            {
                if (!d.bloom.grad || d.bloom.ctx !== ctx)
                {
                    d.bloom.grad = radial(d.bloom.rgb, d.bloom.a);
                    d.bloom.ctx = ctx;
                }
                ctx.globalCompositeOperation = "lighter";
                ctx.globalAlpha = Math.min(1, e.a
                    * (0.75 + 0.25 * Math.sin(secs * 1.7 + ph * 6.283)));
                ctx.fillStyle = d.bloom.grad;
                ctx.fillRect(0, 0, 1, 1);
                ctx.globalCompositeOperation = "source-over";
            }

            if (d.embers)
            {
                // tiny glints born near the base, drifting up and fading
                var EM = d.embers;
                ctx.globalCompositeOperation = "lighter";
                ctx.fillStyle = "rgb(" + EM.rgb[0] + "," + EM.rgb[1] + ","
                                + EM.rgb[2] + ")";
                for (var ei = 0; ei < EM.n; ei++)
                {
                    var hh = hash2(e.x * 3.1 + ei * 7.7, e.y * 5.3 + ei * 2.9);
                    var cyc = secs * EM.rate * (0.6 + hh) + hh * 13.0;
                    var life = cyc - Math.floor(cyc);
                    var seed = Math.floor(cyc) + ei * 17;
                    var hx = hash2(seed * 0.91 + e.x, e.y * 1.3 + ei);
                    var ex = 0.12 + 0.76 * hx
                             + 0.04 * Math.sin(secs * 3 + hh * 20);
                    var ey = 0.92 - life * 0.45 * (0.5 + hx);
                    var fl = Math.sin(Math.PI * life)
                             * (0.55 + 0.45 * Math.sin(secs * 17 + hh * 50));
                    if (fl <= 0.02) continue;
                    ctx.globalAlpha = Math.min(1, fl * 0.9 * e.a);
                    ctx.beginPath();
                    ctx.arc(ex, ey, 0.028 + 0.012 * hx, 0, 6.2832);
                    ctx.fill();
                }
                ctx.globalCompositeOperation = "source-over";
            }
            drawn++;
            kinds[d.name] = (kinds[d.name] || 0) + 1;
        }
        ctx.globalAlpha = 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        stats.drawn = drawn;
        stats.kinds = kinds;
        stats.ms = performance.now() - t0;
    }

    function reset()
    {
        entries.clear();
        last_t = 0;
        hide();
    }

    api.on("frame", frame);
    api.on("game_init", function () { build_tables(); reset(); });
    api.on("game_cleanup", function () {
        reset();
        if (canvas && canvas.parentNode)
            canvas.parentNode.removeChild(canvas);
    });

    // Debug -------------------------------------------------------------------
    window.sdc_clouds_debug = {
        force: function (type, x, y) {
            var id = KIND_ID[type || "fire"];
            if (!id)
                throw new Error("unknown kind; one of: " + KIND_NAMES.join(", "));
            forced.push({ k: id,
                          x: x == null ? player.pos.x : x,
                          y: y == null ? player.pos.y : y });
            return forced.length;
        },
        clear: function () { forced = []; },
        stats: function () { return $.extend({}, stats, { forced: forced.length }); },
        kinds: function () { return KIND_NAMES.slice(); },
        classify: function (idx) {
            build_tables();
            var k = kind_of[idx & 0xFFFF];
            return k ? KINDS[k].name : null;
        },
        canvas: function () { return canvas; },
    };

    return {};
});
