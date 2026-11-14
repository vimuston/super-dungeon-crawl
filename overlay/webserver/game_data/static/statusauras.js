// Status auras on the X1 engine (statusfx.js): haste / slow,
// Ozo's Armour (icy glow), Death's Door and
// Sublimation of Blood. No regeneration effect lives here.
//
// Triggers (status light = lower-case base light, from crawl's status.cc):
//   haste    "Fast" (also "Fast+Slow")     speed-line streaks + short light
//                                          trails behind the player tile
//   slow     "Slow" (also "Fast+Slow")     api.grade desaturate/cool tint and
//                                          two laggy ghosts trailing the player
//   invis    no aura: the player sprite is drawn translucent here (cell
//            renderer hook) and ripples like heat haze in alive.js; "You
//            flicker for a moment." stutters it solid/translucent (~1.3 s)
//   ozo      Ozo's Armour = icy armour has NO status light, so it runs on
//            messages: "A film of ice covers your body!" / "Your icy armour
//            thickens." start it; "Your icy armour melts away.", "...
//            evaporates.", "... cracks and falls away as you move." end it.
//            The player tile glows icy: a round breathing glow, frost
//            twinkles, and a soft thaw puff when it ends.
//   ddoor    "DDoor" (Death's Door)        greyscale + dark vignette grade, a
//                                          flat-line ECG strip near the bottom
//                                          of the view; on end a restored-colour
//                                          flash
//   sublimation  message "You draw magical energy from your own body!"
//                red motes fly from the player to the MP bar and
//                api.emit("bar_pulse","mp","fill","190,30,50") (barfx animates).
// Anything missing (player off screen, MP bar absent) is skipped silently.
// Reduced motion: static tile glows, no streaks/ghost lag/bursts/motes.
// Layer: the shared "aura" layer (z-index 4). Transform/opacity animations only.
// Debug: window.sdc_statusauras_test(name, seconds = 5)
//   name: haste | slow | ice | ddoor | sublimation | flicker (while invisible)
define(["./sdc_api", "./fxkit", "./statusfx", "./cell_renderer",
        "./dungeon_renderer", "./player", "./map_knowledge"],
function (api, kit, statusfx, cell_renderer, dungeon_renderer, player,
          map_knowledge) {
    "use strict";

    // Invisibility: crawl only sends the "trans" flag for invisible monsters,
    // so the player sprite stays opaque. Draw it translucent ourselves
    // (cell_renderer already draws dolls at reduced alpha when cell.trans);
    // alive.js adds the heat-haze ripple in the shader.
    var invis_on = false;
    var INVIS_ALPHA = 0.25;       // x stock 0.55 = ~0.14 opacity
    (function () {
        var proto = cell_renderer.DungeonCellRenderer.prototype;
        var orig = proto.do_render_cell, orig_dp = proto.draw_player;
        // stock trans alpha is 0.55; scale the doll parts further to ~0.14
        proto.draw_player = function () {
            if (!this.sdc_invis) return orig_dp.apply(this, arguments);
            var a = this.ctx.globalAlpha;
            this.ctx.globalAlpha = a * INVIS_ALPHA;
            try { return orig_dp.apply(this, arguments); }
            finally { this.ctx.globalAlpha = a; }
        };
        proto.do_render_cell = function (cx, cy, x, y, map_cell, cell) {
            if (!invis_on || flick_solid || !cell || !player.pos
                || cx !== player.pos.x
                || cy !== player.pos.y || cell.trans)
                return orig.apply(this, arguments);
            cell.trans = 1;
            this.sdc_invis = true;
            try { return orig.apply(this, arguments); }
            finally { delete cell.trans; this.sdc_invis = false; }
        };
    })();

    function redraw_player()
    {
        if (player.pos && map_knowledge.get(player.pos.x, player.pos.y))
            try { dungeon_renderer.render_loc(player.pos.x, player.pos.y); }
            catch (e) { /* view not ready */ }
    }

    // "You flicker for a moment." (invisibility running out): the sprite
    // stutters between solid and translucent for a moment
    var flick_solid = false, flick_timer = null;
    var FLICK = [70, 90, 60, 140, 50, 110, 80, 200, 60, 90, 120, 260];
    function flicker()
    {
        if (flick_timer) clearTimeout(flick_timer);
        var i = 0;
        (function step() {
            if (i >= FLICK.length || !invis_on)
            {
                flick_timer = null;
                if (flick_solid) { flick_solid = false; redraw_player(); }
                return;
            }
            flick_solid = !flick_solid;
            redraw_player();
            flick_timer = setTimeout(step, FLICK[i++]);
        })();
    }
    kit.on_message(function (text) {
        if (/You flicker for a moment/i.test(text) && !kit.reduced())
            flicker();
    });

    function invis_check(pl)
    {
        var on = (pl.status || []).some(function (st) {
            return /^invis/i.test(st.light || "");
        });
        if (on === invis_on) return;
        invis_on = on;
        redraw_player();
    }
    api.on("hud_update", invis_check);

    var defs = {};                 // id -> definition (also used by the tester)
    var burst = { n: 0, cap: 24 }; // live elements outside any aura root
    var ice_flag = false, ice_t = 0;
    var ICE_MAX_MS = 150000;       // safety net if an end message was missed
    var SUB_RGB = "190,30,50";

    // Helpers ----------------------------------------------------------------

    function sync_vars(ctx, a)
    {
        var key = a.cw + "x" + a.ch;
        if (ctx.data.vk === key) return;
        ctx.data.vk = key;
        ctx.root.style.setProperty("--cw", a.cw + "px");
        ctx.root.style.setProperty("--ch", a.ch + "px");
    }

    // tile-sized element centred on the anchor (sized by CSS from --cw/--ch)
    function tile(ctx, cls)
    {
        var el = document.createElement("div");
        el.className = "sa-tile " + cls;
        el.style.display = "none";
        ctx.root.appendChild(el);
        return el;
    }

    function place(el, a, ox, oy)
    {
        if (!a) { el.style.display = "none"; return; }
        el.style.display = "";
        el.style.transform = kit.at(a.x - a.cw / 2 + (ox || 0),
                                    a.y - a.ch / 2 + (oy || 0));
    }

    // animated throwaway element; counter = {n, cap} bounds live elements
    function fly(parent, css, frames, opts, counter)
    {
        if (counter.n >= counter.cap) return null;
        var el = kit.mk(parent, css);
        counter.n++;
        var done = false;
        function end()
        {
            if (done) return;
            done = true;
            counter.n--;
            if (el.parentNode) el.parentNode.removeChild(el);
        }
        try
        {
            kit.anim(el, frames, opts).onfinish = end;
            setTimeout(end, (opts.duration || 500) + (opts.delay || 0) + 300);
        }
        catch (e) { end(); return null; }
        return el;
    }

    // movement since the previous frame in px, or null
    function moved(ctx, a)
    {
        var d = ctx.data, res = null;
        if (a && d.px !== undefined)
        {
            var dx = a.x - d.px, dy = a.y - d.py;
            if (Math.abs(dx) + Math.abs(dy) > a.cw * 0.4)
                res = { dx: dx, dy: dy, ox: d.px, oy: d.py };
        }
        d.px = a ? a.x : undefined;
        d.py = a ? a.y : undefined;
        return res;
    }

    function def(d)
    {
        defs[d.id] = d;
        statusfx.register(d);
    }

    // S1: haste ----------------------------------------------------------------

    def({
        id: "haste",
        match: /^(fast|haste)/,
        start: function (ctx) {
            ctx.data.live = { n: 0, cap: 14 };
            ctx.data.dir = -1;
            ctx.data.glow = tile(ctx, "sa-haste-glow"
                                 + (kit.reduced() ? " sa-still" : ""));
        },
        frame: function (ctx, t) {
            var a = ctx.anchor, d = ctx.data;
            if (!a) { place(d.glow, null); return; }
            sync_vars(ctx, a);
            place(d.glow, a);
            var m = moved(ctx, a);
            if (kit.reduced()) return;
            if (m)
            {
                if (Math.abs(m.dx) > a.cw * 0.2) d.dir = m.dx > 0 ? 1 : -1;
                // short light trail left on the tile just vacated
                var ox = m.ox - a.cw / 2, oy = m.oy - a.ch / 2;
                fly(ctx.root, "width:" + a.cw + "px;height:" + a.ch + "px;"
                    + "box-sizing:border-box;border-radius:30%;"
                    + "border:1px solid rgba(170,225,255,.7);"
                    + "background:rgba(120,200,255,.28);",
                    [{ opacity: 0.8, transform: kit.at(ox, oy) + "scale(1)" },
                     { opacity: 0, transform: kit.at(ox, oy) + "scale(.75)" }],
                    { duration: 280 }, d.live);
            }
            if (t - (d.last || 0) < 110) return;
            d.last = t;
            var w = a.cw * kit.rnd(0.5, 1.1);
            var y = a.y + kit.rnd(-0.4, 0.4) * a.ch;
            var x0 = a.x + d.dir * a.cw * 0.3;
            fly(ctx.root, "width:" + w + "px;height:2px;border-radius:2px;"
                + "background:linear-gradient(" + (d.dir > 0 ? "270deg" : "90deg")
                + ",rgba(150,215,255,0),rgba(200,238,255,.95));",
                [{ opacity: 0.9, transform: kit.at(x0 - w / 2, y) },
                 { opacity: 0, transform: kit.at(x0 - d.dir * a.cw * 1.4
                                                 - w / 2, y) + "scaleX(.35)" }],
                { duration: 340, easing: "ease-in" }, d.live);
        },
        cleanup: function (ctx) { ctx.data.glow = null; }
    });

    // S1: slow ----------------------------------------------------------------

    def({
        id: "slow",
        match: /^(slow|fast\+slow)$/,
        start: function (ctx) {
            var d = ctx.data;
            api.grade("slow", { desat: 0.3, tint: [0.82, 0.88, 1.0],
                                tint_a: 0.14 });
            d.g = [{ el: tile(ctx, "sa-ghost"), k: 0.13, x: null, y: null },
                   { el: tile(ctx, "sa-ghost sa-ghost2"), k: 0.06,
                     x: null, y: null }];
        },
        frame: function (ctx) {
            var a = ctx.anchor, d = ctx.data;
            if (!a || kit.reduced())
            {
                d.g.forEach(function (g) { place(g.el, null); g.x = null; });
                return;
            }
            sync_vars(ctx, a);
            d.g.forEach(function (g) {
                if (g.x === null) { g.x = a.x; g.y = a.y; }
                // each ghost eases toward the player: visible only while behind
                g.x += (a.x - g.x) * g.k;
                g.y += (a.y - g.y) * g.k;
                var dist = Math.abs(a.x - g.x) + Math.abs(a.y - g.y);
                g.el.style.opacity = Math.min(0.55, dist / a.cw * 0.7);
                place(g.el, { x: g.x, y: g.y, cw: a.cw, ch: a.ch });
            });
        },
        cleanup: function () { api.grade("slow", null); }
    });

    // S4: Ozo's Armour ----------------------------------------------------------------

    // Ozo's Armour: the player tile glows icy (a round breathing glow, frost
    // twinkles); ending leaves a soft thaw puff
    function ozo_start(ctx)
    {
        var d = ctx.data;
        var el = tile(ctx, "sa-ozo");
        el.appendChild(document.createElement("b")).className = "sa-ozo-glow";
        el.appendChild(document.createElement("b")).className = "sa-ozo-core";
        for (var i = 0; i < 5; i++)
        {
            var t = document.createElement("i");
            t.className = "sa-ozo-tw sa-ozo-tw" + i;
            el.appendChild(t);
        }
        d.el = el;
        if (!ctx.initial && !kit.reduced())
            kit.anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 600 });
    }

    function ozo_frame(ctx)
    {
        var a = ctx.anchor, d = ctx.data;
        if (!a) { place(d.el, null); return; }
        sync_vars(ctx, a);
        place(d.el, a);
    }

    function ozo_stop(ctx)
    {
        var a = ctx.anchor;
        if (!a || kit.reduced()) return;
        var r = a.cw * 1.4;
        fly(kit.layer("aura"),
            "width:" + r * 2 + "px;height:" + r * 2 + "px;border-radius:50%;"
            + "background:radial-gradient(circle,rgba(220,245,255,.55) 0,"
            + "rgba(140,210,255,.3) 40%,rgba(120,190,255,0) 70%);"
            + "mix-blend-mode:screen;",
            [{ opacity: 1, transform: kit.at(a.x - r, a.y - r) + "scale(.7)" },
             { opacity: 0, transform: kit.at(a.x - r, a.y - r - a.ch * 0.2)
                                      + "scale(1.5)" }],
            { duration: 650 }, burst);
    }

    def({
        id: "ozo",
        // icy armour has no light: driven by messages
        match: { test: function (n) {
            return ice_flag && kit.now() - ice_t < ICE_MAX_MS;
        } },
        start: ozo_start, frame: ozo_frame, stop: ozo_stop
    });

    kit.on_message(function (text) {
        if (/A film of ice covers your body|Your icy armour thickens/i
            .test(text))
        {
            ice_flag = true;
            ice_t = kit.now();
        }
        else if (/Your icy armour (melts away|evaporates|cracks and falls)/i
                 .test(text))
            ice_flag = false;
    });

    // S6: Death's Door ----------------------------------------------------------------

    function restore_flash()
    {
        if (kit.reduced()) return;
        var vr = kit.view_rect();
        fly(kit.layer("aura"), "width:" + vr.width + "px;height:"
            + vr.height + "px;"
            + "background:radial-gradient(ellipse at 50% 50%,"
            + "rgba(235,255,240,.55),rgba(150,255,190,.18) 60%,transparent 85%);"
            + "mix-blend-mode:screen;",
            [{ opacity: 1, transform: kit.at(vr.left, vr.top) },
             { opacity: 0, transform: kit.at(vr.left, vr.top) }],
            { duration: 800, easing: "ease-out" }, burst);
    }

    def({
        id: "ddoor",
        match: /^ddoor/,
        start: function (ctx) {
            var d = ctx.data;
            api.grade("ddoor", { desat: 0.92, vig: [0, 0, 0], vig_a: 0.4,
                                 tint: [0.9, 0.92, 1.0], tint_a: 0.1 });
            var strip = document.createElement("div");
            strip.className = "sa-ecg";
            var line = document.createElement("div");
            line.className = "sa-ecg-line";
            var dot = document.createElement("div");
            dot.className = "sa-ecg-dot" + (kit.reduced() ? " sa-still" : "");
            strip.appendChild(line);
            strip.appendChild(dot);
            ctx.root.appendChild(strip);
            d.strip = strip;
            d.vr_t = -1e9;
        },
        frame: function (ctx, t) {
            var d = ctx.data;
            if (t - d.vr_t > 500)           // follow window / HUD changes
            {
                d.vr_t = t;
                var vr = kit.view_rect();
                var w = Math.min(280, vr.width * 0.5);
                d.strip.style.width = w + "px";
                d.strip.style.transform = kit.at(vr.left + (vr.width - w) / 2,
                                                 vr.top + vr.height - 64);
            }
            if (!kit.reduced())             // slow, faint vignette breathing
                api.grade("ddoor", { desat: 0.92, vig: [0, 0, 0],
                    vig_a: 0.36 + 0.06 * Math.sin(t / 700),
                    tint: [0.9, 0.92, 1.0], tint_a: 0.1 });
        },
        stop: function () { restore_flash(); },
        cleanup: function () { api.grade("ddoor", null); }
    });

    // S6: Sublimation of Blood ----------------------------------------------------------

    function sublimate()
    {
        api.emit("bar_pulse", "mp", "fill", SUB_RGB);
        if (kit.reduced()) return;
        var a = kit.anchor_of(kit.player_pos());
        var bar = document.querySelector("#sdc_vitals .sdc-mp");
        var br = bar && bar.getBoundingClientRect();
        if (!a || !br || br.width < 4) return;
        var layer = kit.layer("aura");
        var tx = br.left + br.width / 2, ty = br.top + br.height / 2;
        for (var i = 0; i < 10; i++)
        {
            var sz = kit.rnd(3, 6);
            var x0 = a.x + kit.rnd(-0.4, 0.4) * a.cw - sz / 2;
            var y0 = a.y + kit.rnd(-0.4, 0.4) * a.ch - sz / 2;
            var mx = (x0 + tx) / 2 + kit.rnd(-60, 60);
            var my = (y0 + ty) / 2 + kit.rnd(-60, 60);
            fly(layer, "width:" + sz + "px;height:" + sz + "px;"
                + "border-radius:50%;background:rgb(" + SUB_RGB + ");"
                + "box-shadow:0 0 6px rgba(" + SUB_RGB + ",.9);",
                [{ opacity: 0, transform: kit.at(x0, y0) + "scale(.5)" },
                 { opacity: 1, transform: kit.at(mx, my) + "scale(1)",
                   offset: 0.45 },
                 { opacity: 0, transform: kit.at(tx - sz / 2, ty - sz / 2)
                                          + "scale(.4)" }],
                { duration: 700, delay: i * 55, easing: "ease-in-out" }, burst);
        }
    }

    kit.on_message(function (text) {
        if (/You draw magical energy from your own body/i.test(text))
            sublimate();
    });

    // reset flags / leftovers between games ---------------------------------------------

    function reset() { ice_flag = false; burst.n = 0; }
    api.on("game_init", reset);
    api.on("game_cleanup", reset);

    // Debug helper ------------------------------------------------------------------------

    var tests = [];
    api.on("frame", function (t) {
        tests.forEach(function (T) {
            T.ctx.anchor = kit.anchor_of(kit.player_pos());
            if (T.def.frame)
                try { T.def.frame(T.ctx, t); } catch (e) { console.error(e); }
        });
    });

    window.sdc_statusauras_test = function (name, seconds) {
        if (name === "sublimation") { sublimate(); return; }
        if (name === "flicker") { flicker(); return; }
        var id = { haste: "haste", slow: "slow",
                   ice: "ozo", ddoor: "ddoor" }[name];
        var d = id && defs[id];
        if (!d) return;
        var root = document.createElement("div");
        root.className = "sdc-aura sdc-aura-" + id;
        root.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;";
        kit.layer("aura").appendChild(root);
        var ctx = { root: root, anchor: kit.anchor_of(kit.player_pos()),
                    light: name, t0: kit.now(), data: {}, initial: false };
        var T = { def: d, ctx: ctx };
        tests.push(T);
        if (d.start) d.start(ctx);
        setTimeout(function () {
            tests.splice(tests.indexOf(T), 1);
            if (d.stop) d.stop(ctx);
            if (d.cleanup) d.cleanup(ctx);
            if (root.parentNode) root.parentNode.removeChild(root);
        }, (seconds || 5) * 1000);
    };

    return {};
});
