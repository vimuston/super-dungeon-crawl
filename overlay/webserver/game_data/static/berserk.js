// Berserk presentation, layered over the game's own flat red tint.
//
// Beats (status light "Berserk"/"Bers", driven by hud_update):
//   onset     hard flash, shockwave ring from the player tile (shader),
//             big jagged BERSERK title + RAAAGH glitch (DOM, ~1.1 s)
//   sustained rage tremor + hit impulses (shader uv shake, dungeon only),
//             heartbeat blood-vein vignette / red-orange grade (shader),
//             embers drifting up the screen edges (DOM)
//   end       "crash": rage decays and colours drain over ~1.5 s with one
//             slump shake, then every uniform is exactly 0 and DOM removed.
// Shader state travels through api.set_fx(); crt.js uploads it as uniforms.
// Without GL (sdc-nogl) only the DOM parts + a CSS vignette show.
// prefers-reduced-motion: no shake/pulse/shockwave, static mild vignette.
// Debug: window.sdc_berserk_test(seconds = 6)
define(["jquery", "./sdc_api", "./player", "./dungeon_renderer", "./enums",
        "./cell_renderer", "./view_data", "./display", "./fxkit"],
function ($, api, player, dungeon_renderer, enums, cell_renderer, view_data,
          display, kit) {
    "use strict";

    var RISE = 0.3, FALL = 1.5, TITLE_MS = 1150, BEAT_HZ = 1.8;
    var EMBERS = 10;

    var layer = null, title = null, vigel = null, flash = null;
    var real = false, test_on = false, test_timer = 0;
    var active = false;       // rage currently on
    var t_on = 0, t_off = 0;  // ms timestamps
    var fading = false;
    var impulse = { x: 0, y: 0, t: -1e9, amp: 0 };
    var slump = { t: -1e9 };
    var last_hp = null;
    var done_timer = 0, title_timer = 0;

    function now()
    {
        return window.performance ? window.performance.now() : Date.now();
    }

    function strip(s)
    {
        return String(s || "").replace(/<[^>]*>/g, "").trim();
    }

    function is_berserk(pl)
    {
        var st = (pl && pl.status) || [];
        for (var i = 0; i < st.length; i++)
        {
            var w = strip(st[i] && st[i].light).split(/[\s(]/)[0];
            if (w === "Berserk" || w === "Bers")
                return true;
        }
        try
        {
            if (pl && typeof pl.has_status === "function"
                && pl.has_status("berserk"))
                return true;
        }
        catch (e) { /* ignore */ }
        return false;
    }

    function in_map()
    {
        return dungeon_renderer && dungeon_renderer.ui_state == enums.ui.VIEW_MAP;
    }

    // player position as uv in the dungeon canvas (y down), or null
    function player_uv()
    {
        var dr = dungeon_renderer, pos = player.pos;
        if (!dr || !dr.cols || !dr.rows || !dr.view || !pos) return null;
        var fx = (pos.x - dr.view.x + 0.5) / dr.cols;
        var fy = (pos.y - dr.view.y + 0.5) / dr.rows;
        if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return null;
        return { x: fx, y: fy };
    }

    function build()
    {
        if (layer && document.body.contains(layer)) return;
        layer = document.createElement("div");
        layer.id = "sdc_berserk";
        vigel = document.createElement("div");
        vigel.className = "bz-vig";
        layer.appendChild(vigel);
        for (var i = 0; i < EMBERS; i++)
        {
            var e = document.createElement("div");
            e.className = "bz-ember";
            var left = i % 2 ? 2 + Math.random() * 10 : 88 + Math.random() * 10;
            e.style.left = left.toFixed(1) + "%";
            e.style.setProperty("--bz-t", (2.4 + Math.random() * 2).toFixed(2) + "s");
            e.style.setProperty("--bz-d", (-Math.random() * 4).toFixed(2) + "s");
            e.style.setProperty("--bz-s", (3 + Math.random() * 4).toFixed(1) + "px");
            e.style.setProperty("--bz-dx", ((Math.random() - 0.5) * 60).toFixed(0) + "px");
            layer.appendChild(e);
        }
        flash = document.createElement("div");
        flash.className = "bz-flash";
        layer.appendChild(flash);
        title = document.createElement("div");
        title.className = "bz-title";
        title.innerHTML = '<span class="bz-t1" data-text="BERSERK">BERSERK</span>'
                          + '<span class="bz-t2">RAAAGH</span>';
        layer.appendChild(title);
        (document.getElementById("normal") || document.body).appendChild(layer);
        place(true);
    }

    function destroy()
    {
        if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
        layer = title = vigel = flash = null;
        document.body.classList.remove("sdc-berserk");
    }

    var last_rect = "";
    function place(force)
    {
        if (!layer) return;
        var c = document.getElementById("dungeon");
        if (!c) return;
        var r = c.getBoundingClientRect();
        var key = [r.left, r.top, r.width, r.height].map(Math.round).join(",");
        if (key === last_rect && !force) return;
        last_rect = key;
        var s = layer.style;
        s.left = r.left + "px";
        s.top = r.top + "px";
        s.width = r.width + "px";
        s.height = r.height + "px";
        s.setProperty("--bz-w", r.width.toFixed(0) + "px");
        s.setProperty("--bz-h", r.height.toFixed(0) + "px");
    }

    function show_title()
    {
        if (!title) return;
        var p = player_uv();
        // upper third normally; lower third if the player stands up there
        title.style.top = (p && p.y < 0.38) ? "76%" : "17%";
        title.classList.remove("bz-go");
        flash.classList.remove("bz-go");
        void title.offsetWidth;
        title.classList.add("bz-go");
        if (!api.reduced_motion()) flash.classList.add("bz-go");
        if (title_timer) window.clearTimeout(title_timer);
        title_timer = window.setTimeout(function () {
            title_timer = 0;
            if (title) title.classList.remove("bz-go");
            if (flash) flash.classList.remove("bz-go");
        }, TITLE_MS + 150);
    }

    function kick(amp)
    {
        if (api.reduced_motion()) return;
        var a = Math.random() * 6.283;
        impulse.x = Math.cos(a);
        impulse.y = Math.sin(a);
        impulse.t = now();
        impulse.amp = amp;
    }

    // watch the message log for blows landed / received while raging
    var HIT = /\b(hit|hits|bites?|claws?|slash|slices?|crush|pierces?|punche?s?|kicks?|stabs?|smites?|wounds?|bludgeons?|whips?|stings?|gores?|butts?|mauls?)\b/i;
    kit.on_message(function (text) {
        if (active && HIT.test(text)) kick(2.0 + Math.random() * 1.5);
    });

    function start()
    {
        if (done_timer) { window.clearTimeout(done_timer); done_timer = 0; }
        var was_fading = fading;
        active = true;
        fading = false;
        t_on = now();
        build();
        layer.classList.remove("bz-off");
        document.body.classList.add("sdc-berserk");
        // cells drawn before now carry the game's red flash: repaint them
        display.invalidate();
        if (!was_fading)
        {
            show_title();
            kick(3.5);
        }
    }

    function stop()
    {
        if (!active) return;
        active = false;
        fading = true;
        t_off = now();
        slump.t = t_off;
        if (layer) layer.classList.add("bz-off");
        if (done_timer) window.clearTimeout(done_timer);
        done_timer = window.setTimeout(finish, FALL * 1000 + 250);
    }

    function finish()
    {
        done_timer = 0;
        if (active) return;
        fading = false;
        api.set_fx(null);
        destroy();
        display.invalidate();
    }

    function sync()
    {
        var want = real || test_on;
        if (want && !active) start();
        else if (!want && active) stop();
    }

    function noise(t, a)
    {
        return (Math.sin(t * 7.3 + a) + 0.6 * Math.sin(t * 11.1 + a * 2.1)
                + 0.5 * Math.sin(t * 3.7 + a * 0.7)) / 2.1;
    }

    api.on("frame", function () {
        if (!active && !fading) return;
        var t = now();
        if (layer) place(false);
        var rage, crash = 0;
        if (active)
            rage = Math.min(1, (t - t_on) / (RISE * 1000));
        else
        {
            var k = (t - t_off) / (FALL * 1000);
            if (k >= 1) { finish(); return; }
            rage = 1 - k;
            crash = Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) * (1 - k);
        }
        var reduced = api.reduced_motion();
        var fx = { rage: reduced ? Math.min(rage, 1) * 0.5 : rage,
                   beat: 0, shock_r: 0, shock_a: 0, px: 0.5, py: 0.5,
                   crash: crash, sx: 0, sy: 0 };
        var p = player_uv();
        if (p) { fx.px = p.x; fx.py = p.y; }
        if (!reduced)
        {
            var s = t / 1000;
            var ph = (s * BEAT_HZ) % 1;
            var beat = Math.exp(-ph * 7) * 0.9
                       + (ph > 0.28 ? Math.exp(-(ph - 0.28) * 8) * 0.6 : 0);
            fx.beat = Math.min(1, beat) * rage;
            // shockwave: first 0.9 s of onset
            var age = (t - t_on) / 1000;
            if (active && age < 0.9)
            {
                fx.shock_r = age * 1.1;
                fx.shock_a = (1 - age / 0.9) * 1.0;
            }
            var dpr = window.devicePixelRatio || 1;
            var amp = (0.5 + 0.7 * (0.5 + 0.5 * Math.sin(s * 1.3))) * rage * dpr;
            var sx = noise(s, 0) * amp, sy = noise(s, 5.3) * amp;
            var ia = (t - impulse.t) / 1000;
            if (ia < 0.35)
            {
                var dec = Math.exp(-ia * 11) * Math.cos(ia * 55);
                sx += impulse.x * impulse.amp * dpr * dec;
                sy += impulse.y * impulse.amp * dpr * dec;
            }
            var sa = (t - slump.t) / 1000;
            if (!active && sa < 0.5)
                sy += 3.0 * dpr * Math.sin(sa / 0.5 * Math.PI) * (1 - sa / 0.5);
            fx.sx = sx;
            fx.sy = sy;
        }
        api.set_fx(fx);
        if (vigel)
            vigel.style.opacity = (0.35 + 0.65 * fx.beat) * rage;
    });

    api.on("hurt", function () {
        if (active) kick(2.5 + Math.random());
    });

    api.on("hud_update", function (pl) {
        var hp = Number(pl.hp);
        if (active && last_hp !== null && hp < last_hp)
            kick(2.2 + Math.random() * 1.3);
        last_hp = isNaN(hp) ? null : hp;
        var b = is_berserk(pl);
        if (b === real) return;
        real = b;
        sync();
    });

    api.on("game_cleanup", function () {
        real = test_on = false;
        last_hp = null;
        if (test_timer) window.clearTimeout(test_timer);
        test_timer = 0;
        if (done_timer) window.clearTimeout(done_timer);
        if (title_timer) window.clearTimeout(title_timer);
        done_timer = title_timer = 0;
        active = fading = false;
        api.set_fx(null);
        destroy();
    });

    // The game tints every cell in line of sight flat red while berserk
    // (view.cc viewmap_flash_colour -> per-cell "flash"). That stops at the
    // sight boundary and flattens the picture, so the red flash is never
    // drawn; the shader paints the whole screen instead (crt.js). It is
    // dropped unconditionally, not only once berserk is known: on the first
    // round the flash can reach the map before the player's status does.
    (function () {
        var proto = cell_renderer.DungeonCellRenderer.prototype;
        if (proto.render_flash.sdc_berserk) return;
        var orig = proto.render_flash;
        proto.render_flash = function (x, y, map_cell) {
            if (map_cell && map_cell.flc)
            {
                var c = view_data.get_flash_colour(map_cell.flc, map_cell.fla);
                if (c && c.r > 120 && c.g < 90 && c.b < 90) return;
            }
            return orig.apply(this, arguments);
        };
        proto.render_flash.sdc_berserk = true;
    })();

    window.sdc_berserk_test = function (seconds)
    {
        var s = Number(seconds);
        if (!(s > 0)) s = 6;
        if (test_timer) window.clearTimeout(test_timer);
        test_on = true;
        sync();
        test_timer = window.setTimeout(function () {
            test_timer = 0;
            test_on = false;
            sync();
        }, s * 1000);
    };

    return {};
});
