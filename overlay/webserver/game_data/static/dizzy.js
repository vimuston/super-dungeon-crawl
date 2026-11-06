// Confusion effect: cartoon "dizzy" stars orbiting above the player's head,
// a wobbling double ring on the player's tile and a faint violet/yellow
// vignette pulse. Nothing transforms the dungeon canvas itself.
//
// Trigger: the "Conf" status light (hud_update) while it is active.
// Layer: #sdc_dizzy, fixed, z-index 4 (above the dungeon, below the HUD).
// Debug: window.sdc_dizzy_test(seconds = 4)
define(["jquery", "./sdc_api", "./player", "./dungeon_renderer", "./enums",
        "./fxkit"],
function ($, api, player, dungeon_renderer, enums, kit) {
    "use strict";

    var POS_INTERVAL = 90;     // ms between repositioning checks

    var layer = null;
    var root = null;
    var vig = null;
    var active = false;
    var test_timer = 0;
    var last_pos_t = 0;
    var last_key = "";
    var conf_status = false;

    var STARS = [
        // r: x radius (tiles), ry: y radius, t: half period s, d: phase s
        { r: 0.62, ry: 0.16, t: 0.85, d: 0.0, sz: 0.30, c: "#fff4a0" },
        { r: 0.55, ry: 0.14, t: 1.10, d: -0.3, sz: 0.24, c: "#c9a8ff" },
        { r: 0.68, ry: 0.18, t: 0.95, d: -0.6, sz: 0.27, c: "#fff4a0" },
        { r: 0.50, ry: 0.13, t: 1.30, d: -0.2, sz: 0.22, c: "#d8c0ff" },
    ];

    function now()
    {
        return window.performance ? window.performance.now() : Date.now();
    }

    function strip(s)
    {
        return String(s || "").replace(/<[^>]*>/g, "").trim();
    }

    function is_confused(pl)
    {
        var st = (pl && pl.status) || [];
        for (var i = 0; i < st.length; i++)
        {
            var s = st[i];
            if (!s) continue;
            if (strip(s.light).split(/[\s(]/)[0] === "Conf")
                return true;
        }
        try
        {
            if (pl && typeof pl.has_status === "function"
                && pl.has_status("confused"))
            {
                return true;
            }
        }
        catch (e) { /* ignore */ }
        return false;
    }

    // Geometry (same mapping as blink.js) ---------------------------------

    // shared tile -> screen mapping (CRT curve and the 2.5D camera)
    function anchor_of(pos) { return kit.anchor_of(pos); }

    // DOM ---------------------------------------------------------------------

    function build()
    {
        if (layer && document.body.contains(layer))
            return;
        layer = document.createElement("div");
        layer.id = "sdc_dizzy";
        vig = document.createElement("div");
        vig.className = "dz-vig";
        layer.appendChild(vig);

        root = document.createElement("div");
        root.className = "dz-root dz-hide";
        var r1 = document.createElement("div");
        r1.className = "dz-ring";
        var r2 = document.createElement("div");
        r2.className = "dz-ring dz-ring2";
        root.appendChild(r1);
        root.appendChild(r2);
        STARS.forEach(function (s) {
            var x = document.createElement("div");
            x.className = "dz-x";
            var st = document.createElement("div");
            st.className = "dz-s";
            x.style.setProperty("--dz-t", s.t + "s");
            x.style.setProperty("--dz-d", s.d + "s");
            x.style.setProperty("--dz-r", "calc(var(--dz-cw) * " + s.r + ")");
            st.style.setProperty("--dz-ry",
                                 "calc(var(--dz-ch) * " + s.ry + ")");
            st.style.setProperty("--dz-sz",
                                 "calc(var(--dz-cw) * " + s.sz + ")");
            st.style.setProperty("--dz-c", s.c);
            x.appendChild(st);
            root.appendChild(x);
        });
        layer.appendChild(root);
        (document.getElementById("normal") || document.body)
            .appendChild(layer);
    }

    function destroy()
    {
        if (layer && layer.parentNode)
            layer.parentNode.removeChild(layer);
        layer = root = vig = null;
        last_key = "";
    }

    function place()
    {
        if (!root) return;
        var a = player.pos ? anchor_of(player.pos) : null;
        var map = dungeon_renderer
                  && dungeon_renderer.ui_state == enums.ui.VIEW_MAP;
        vig.style.display = map ? "none" : "";
        if (!a)
        {
            root.classList.add("dz-hide");
            last_key = "";
            return;
        }
        var key = Math.round(a.x) + "," + Math.round(a.y) + ","
                  + Math.round(a.cw);
        if (key === last_key && !root.classList.contains("dz-hide"))
            return;
        last_key = key;
        root.classList.remove("dz-hide");
        var cw = Math.max(16, a.cw), ch = Math.max(16, a.ch);
        root.style.setProperty("--dz-cw", cw.toFixed(1) + "px");
        root.style.setProperty("--dz-ch", ch.toFixed(1) + "px");
        root.style.transform = "translate(" + a.x.toFixed(1) + "px,"
                               + a.y.toFixed(1) + "px)";
    }

    // State -------------------------------------------------------------------

    function sync()
    {
        var on = !!(conf_status || test_timer);
        if (on === active && (!on || layer)) return;
        active = on;
        if (on)
        {
            build();
            layer.classList.remove("dz-off");
            place();
        }
        else if (layer)
        {
            layer.classList.add("dz-off");
            var l = layer;
            window.setTimeout(function () {
                if (!active && layer === l) destroy();
            }, 450);
        }
    }

    api.on("hud_update", function (pl) {
        var c = is_confused(pl);
        if (c === conf_status) return;
        conf_status = c;
        sync();
    });

    api.on("frame", function () {
        if (!active || !layer) return;
        var t = now();
        if (t - last_pos_t < POS_INTERVAL) return;
        last_pos_t = t;
        place();
    });

    api.on("game_cleanup", function () {
        conf_status = false;
        if (test_timer)
            window.clearTimeout(test_timer);
        test_timer = 0;
        active = false;
        destroy();
    });

    window.sdc_dizzy_test = function (seconds)
    {
        var s = Number(seconds);
        if (!(s > 0)) s = 4;
        if (test_timer)
            window.clearTimeout(test_timer);
        test_timer = window.setTimeout(function () {
            test_timer = 0;
            sync();
        }, s * 1000);
        sync();
    };

    return {};
});
