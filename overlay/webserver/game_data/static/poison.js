// Poison effect: sickly green edge vignette (pulse scales with severity),
// toxic bubbles rising from the player's tile, a throbbing HP bar poison
// section (via body classes styled in poison.css), a tick jolt per
// poison damage and a cleansing shimmer when the poison ends.
//
// Trigger: the "Pois" status light (hud_update). Severity from
// player.poison_survival vs hp / hp_max: mild, heavy (> 25% max HP), lethal.
// Layer: #sdc_poison, fixed, z-index 4 (above the dungeon, below the HUD).
// Debug: window.sdc_poison_test(level = "mild"|"heavy"|"lethal", seconds = 6)
define(["jquery", "./sdc_api", "./player", "./dungeon_renderer", "./enums"],
function ($, api, player, dungeon_renderer, enums) {
    "use strict";

    var POS_INTERVAL = 90;
    var BUBBLES = [
        // x offset (tiles), size (tiles), period s, delay s
        { x: -0.25, s: 0.14, t: 1.9, d: 0.0 },
        { x: 0.10, s: 0.10, t: 2.4, d: -0.8 },
        { x: 0.28, s: 0.16, t: 2.1, d: -1.4 },
        { x: -0.08, s: 0.09, t: 1.7, d: -0.4 },
        { x: 0.0, s: 0.12, t: 2.7, d: -1.9 },
    ];

    var layer = null, root = null, vig = null;
    var level = "";            // "", "mild", "heavy", "lethal" (real state)
    var test_level = "";
    var test_timer = 0;
    var shown = "";            // level currently rendered
    var last_pos_t = 0, last_key = "";
    var last_hp = null;
    var tick_timer = 0;

    function now()
    {
        return window.performance ? window.performance.now() : Date.now();
    }

    function strip(s)
    {
        return String(s || "").replace(/<[^>]*>/g, "").trim();
    }

    function is_poisoned(pl)
    {
        var st = (pl && pl.status) || [];
        for (var i = 0; i < st.length; i++)
        {
            var s = st[i];
            if (s && strip(s.light).split(/[\s(]/)[0] === "Pois")
                return true;
        }
        try
        {
            if (pl && typeof pl.has_status === "function"
                && pl.has_status("poison"))
                return true;
        }
        catch (e) { /* ignore */ }
        return false;
    }

    function severity(pl)
    {
        var hp = Number(pl.hp), max = Number(pl.hp_max);
        var ps = pl.poison_survival;
        if (ps === undefined || ps === null || isNaN(Number(ps)))
            return "mild";
        ps = Number(ps);
        if (ps <= 0) return "lethal";
        if (!isNaN(hp) && hp > ps && max > 0 && (hp - ps) > 0.25 * max)
            return "heavy";
        return "mild";
    }

    // Geometry (same mapping as dizzy.js / blink.js)
    function anchor_of(pos)
    {
        var c = document.getElementById("dungeon");
        var dr = dungeon_renderer;
        if (!c || !dr || !dr.cols || !dr.rows || !dr.view || !pos)
            return null;
        if (dr.ui_state == enums.ui.VIEW_MAP)
            return null;
        var r = c.getBoundingClientRect();
        if (r.width < 50 || r.height < 50) return null;
        var fx = (pos.x - dr.view.x + 0.5) / dr.cols;
        var fy = (pos.y - dr.view.y + 0.5) / dr.rows;
        if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return null;
        var cw = r.width / dr.cols, ch = r.height / dr.rows;
        var b = document.body.classList;
        if (b.contains("sdc-gl") && b.contains("sdc-curved"))
        {
            var k = api.curve_k();
            var tx = fx * 2 - 1, ty = fy * 2 - 1;
            var sx = tx, sy = ty, g = 1;
            for (var i = 0; i < 6; i++)
            {
                g = (1 + k * (sx * sx + sy * sy)) / (1 + k);
                sx = tx / g;
                sy = ty / g;
            }
            fx = (sx + 1) / 2;
            fy = (sy + 1) / 2;
            cw /= g;
            ch /= g;
        }
        return { x: r.left + fx * r.width, y: r.top + fy * r.height,
                 cw: cw, ch: ch };
    }

    function build()
    {
        if (layer && document.body.contains(layer)) return;
        layer = document.createElement("div");
        layer.id = "sdc_poison";
        vig = document.createElement("div");
        vig.className = "pz-vig";
        layer.appendChild(vig);
        root = document.createElement("div");
        root.className = "pz-root pz-hide";
        BUBBLES.forEach(function (b) {
            var o = document.createElement("div");
            o.className = "pz-b";
            o.style.setProperty("--pz-x", "calc(var(--pz-cw) * " + b.x + ")");
            o.style.setProperty("--pz-sz", "calc(var(--pz-cw) * " + b.s + ")");
            o.style.setProperty("--pz-t", b.t + "s");
            o.style.setProperty("--pz-d", b.d + "s");
            root.appendChild(o);
        });
        var drip = document.createElement("div");
        drip.className = "pz-drip";
        root.appendChild(drip);
        layer.appendChild(root);
        (document.getElementById("normal") || document.body)
            .appendChild(layer);
    }

    function destroy()
    {
        if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
        layer = root = vig = null;
        last_key = "";
    }

    function place()
    {
        if (!root) return;
        var map = dungeon_renderer
                  && dungeon_renderer.ui_state == enums.ui.VIEW_MAP;
        vig.style.display = map ? "none" : "";
        var a = player.pos ? anchor_of(player.pos) : null;
        if (!a)
        {
            root.classList.add("pz-hide");
            last_key = "";
            return;
        }
        var key = Math.round(a.x) + "," + Math.round(a.y) + ","
                  + Math.round(a.cw);
        if (key === last_key && !root.classList.contains("pz-hide")) return;
        last_key = key;
        root.classList.remove("pz-hide");
        root.style.setProperty("--pz-cw", Math.max(16, a.cw).toFixed(1) + "px");
        root.style.setProperty("--pz-ch", Math.max(16, a.ch).toFixed(1) + "px");
        root.style.transform = "translate(" + a.x.toFixed(1) + "px,"
                               + a.y.toFixed(1) + "px)";
    }

    function set_body(lv)
    {
        var b = document.body.classList;
        b.toggle("sdc-pois", !!lv);
        b.toggle("sdc-pois-mild", lv === "mild");
        b.toggle("sdc-pois-heavy", lv === "heavy");
        b.toggle("sdc-pois-lethal", lv === "lethal");
    }

    function tick()
    {
        var b = document.body.classList;
        b.remove("sdc-pois-tick");
        void document.body.offsetWidth;
        b.add("sdc-pois-tick");
        if (tick_timer) window.clearTimeout(tick_timer);
        tick_timer = window.setTimeout(function () {
            b.remove("sdc-pois-tick");
        }, 450);
    }

    function sync()
    {
        var want = test_level || level;
        if (want === shown && (!want || layer)) return;
        var was = shown;
        shown = want;
        set_body(want);
        if (want)
        {
            build();
            layer.classList.remove("pz-off", "pz-mild", "pz-heavy",
                                   "pz-lethal", "pz-clean");
            layer.classList.add("pz-" + want);
            place();
        }
        else if (layer)
        {
            layer.classList.remove("pz-mild", "pz-heavy", "pz-lethal");
            layer.classList.add("pz-off");
            if (was) layer.classList.add("pz-clean");
            var l = layer;
            window.setTimeout(function () {
                if (!shown && layer === l) destroy();
            }, 1500);
        }
    }

    api.on("hud_update", function (pl) {
        var pois = is_poisoned(pl);
        var hp = Number(pl.hp);
        if (pois && last_hp !== null && hp < last_hp) tick();
        last_hp = isNaN(hp) ? null : hp;
        var lv = pois ? severity(pl) : "";
        if (lv === level) return;
        level = lv;
        sync();
    });

    api.on("frame", function () {
        if (!shown || !layer) return;
        var t = now();
        if (t - last_pos_t < POS_INTERVAL) return;
        last_pos_t = t;
        place();
    });

    api.on("game_cleanup", function () {
        level = test_level = "";
        last_hp = null;
        if (test_timer) window.clearTimeout(test_timer);
        test_timer = 0;
        shown = "";
        set_body("");
        destroy();
    });

    window.sdc_poison_test = function (lv, seconds)
    {
        lv = String(lv || "mild").toLowerCase();
        if (lv !== "heavy" && lv !== "lethal") lv = "mild";
        var s = Number(seconds);
        if (!(s > 0)) s = 6;
        if (test_timer) window.clearTimeout(test_timer);
        test_level = lv;
        test_timer = window.setTimeout(function () {
            test_timer = 0;
            test_level = "";
            sync();
        }, s * 1000);
        sync();
        window.setTimeout(function () {
            if (test_level) tick();
        }, Math.min(1500, s * 500));
    };

    return {};
});
