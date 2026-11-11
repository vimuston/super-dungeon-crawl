// 2.5D view: the dungeon is seen from a slightly slanted angle instead of
// straight down. Done entirely in the CRT shader (crt.js FRAG, "2.5D" block);
// this module only builds a cols x rows RGBA data texture (one texel per view
// cell) when the map changes, and eases the effect in and out.
//
// Middle mouse button on the view: drag sideways = rotate, up/down = zoom,
// click = reset (rotation 12, zoom 100%). Shift + drag up/down = perspective,
// Shift + click = reset perspective (90%). All are also sliders in the
// settings panel.
// "Rotation" turns the view (yaw, degrees) about the screen centre; walls
// still rise toward the top of the screen. Creatures share the map canvas,
// so they turn with it (they cannot be billboarded).
// The "Perspective" slider scales the camera tilt: a ground-plane projection
// (far rows narrower and shorter), how much things stand up, and shadow
// strength. "Wall height" is separate.
//
//   walls      rise toward the camera: each wall cell is drawn `height`
//              (a fraction of a tile) higher, so its top covers a thin strip
//              of the cell behind it, and a darker front face fills the gap
//              at its foot. Floor in front of a wall gets a contact shadow.
//   creatures  (and you) stand up: stretched a few % from the feet, with a
//   features   soft shadow ellipse on the floor under them. Trees, statues,
//              fountains and altars stand up too.
//   items      lie on the floor with a smaller, fainter shadow.
//   liquids    low slabs with a dark front edge: shallow water and lava
//              stand a little higher than deep water.
//   clouds     fog, poison, fire... float a little above the floor; all but
//              fire cast a faint shadow.
//
// Lives in the crt.js shader (runs with the CRT filter on or off). Off = shader skips
// the whole block (u_depth_amt = 0). To remove the feature entirely, delete
// this file, its "./depth" entry in crt.js, the "2.5D" blocks marked
// "// depth:" in crt.js, and set_depth_source in sdc_api.js.
//
// Data texture (NEAREST, row 0 = top row of the view):
//   R = wall (255) / shallow water, lava (128) / deep water (90)
//   G = creature (255) / item (128)
//   B = upright feature (255)       A = cloud (255) / fire cloud (100)
//
// Debug (browser console): sdc_depth_debug.stats()
define(["jquery", "./sdc_api", "./map_knowledge", "./dungeon_renderer",
        "./enums", "./player", "./tileinfo-dngn", "./tileinfo-main", "./fxkit"],
function ($, api, map_knowledge, dungeon_renderer, enums, player, dngn, main,
          kit) {
    "use strict";

    var REBUILD_MS = 2000;      // safety rebuild interval
    var FADE_S = 0.35;          // seconds to ease in / out
    var PERSP = 0.7;            // ground tilt at 100% perspective (crt.js shader)

    api.register_option({ key: "depth", label: "2.5D view", default: true,
                          choices: [[true, "On"], [false, "Off"]] });
    api.register_option({ key: "depth_persp", label: "Perspective",
                          default: 90, range: { min: 0, max: 100, step: 5 },
                          hint: ["Shift + middle mouse drag up/down",
                                 "Three-finger swipe up/down"] });
    api.register_option({ key: "depth_rot", label: "Rotation",
                          default: -1, range: { min: -45, max: 45, step: 1 },
                          hint: ["Middle mouse drag sideways",
                                 "Two-finger twist or sideways swipe"] });
    api.register_option({ key: "depth_rot_lock", label: "Lock rotation",
                          default: false,
                          choices: [[false, "Off"], [true, "On (0°)"]],
                          hint: ["Middle mouse drag no longer rotates",
                                 "Twists and sideways swipes no longer rotate"] });
    api.register_option({ key: "depth_zoom", label: "Zoom",
                          default: 139, range: { min: 50, max: 200, step: 5 },
                          hint: ["Middle mouse drag up/down",
                                 "Two-finger pinch"] });
    api.register_option({ key: "depth_height", label: "Wall height",
                          default: 36, range: { min: 4, max: 40, step: 1 } });

    // Classes ---------------------------------------------------------------
    // walls: stone/metal/crystal/ice walls, wall-mounted torches, closed doors
    var WALL_RE = /WALL|PERMAROCK|^ROCK_|TORCH/;
    var NOT_WALL_RE = /UNSEEN|_GONE$|_EXPIRED$|DOOR|GATE|ARCH|WAVE|FLOOR|SHADOW/;
    // closed doors and gates are as tall as walls; open ones stay flat
    var DOOR_SHUT_RE = /^DNGN_((CLOSED|RUNED|SEALED)_(CLEAR_)?DOOR|V?GATE_(CLOSED|RUNED|SEALED))/;
    var UPRIGHT_RE = /TREE|MANGROVE|STATUE|FOUNTAIN|PILLAR|ALTAR|IDOL|STALAGMITE|OBELISK/;
    var NOT_UPRIGHT_RE = /_GONE$|DRY_FOUNTAIN|PETRIFIED/;

    // liquids are low slabs at two levels: shallow water and lava stand a
    // little higher than deep water
    var DEEP_RE = /^(DNGN_DEEP_WATER|SHOALS_DEEP_WATER|DNGN_OPEN_SEA|WAVE_DEEP|DNGN_STARWATER)/;
    var HIGH_RE = /^(DNGN_LAVA|DNGN_SHALLOW_WATER|SHOALS_SHALLOW_WATER)/;
    var FIRE_CLOUD_RE = /^CLOUD_(FIRE|FOREST_FIRE|FLAME|BLASTMOTES)/;
    var LIQUID_FRAC = 0.45;     // high liquid level, fraction of wall height
                                // (deep water is half of that)

    var wall_of = null, upright_of = null, liquid_of = null, cloud_of = null;

    // Per-tile-index class table for one tile module. `classify(base_name)`
    // returns a small int; unnamed indices (tile variants) inherit the
    // previous name's class.
    function class_table(mod, classify)
    {
        var pairs = [], max = 0;
        for (var name in mod)
        {
            var v = mod[name];
            if (typeof v !== "number" || !/^[A-Z][A-Z0-9_]*$/.test(name)
                || /(^|_)MAX$|_LOW$|_MID$|_HIGH$|^DNGN_FIRST|^MCACHE_START$/.test(name))
                continue;
            pairs.push([v, name]);
            if (v > max) max = v;
        }
        pairs.sort(function (a, b) { return a[0] - b[0]; });
        var table = new Uint8Array(max + 1);
        var p = 0, cur = 0;
        for (var idx = 0; idx <= max; idx++)
        {
            if (p < pairs.length && pairs[p][0] === idx)
            {
                cur = 0;
                while (p < pairs.length && pairs[p][0] === idx)
                {
                    cur = cur || classify(pairs[p][1].replace(/(_\d+)+$/, ""));
                    p++;
                }
            }
            table[idx] = cur;
        }
        return table;
    }

    function build_tables()
    {
        if (wall_of) return;
        wall_of = class_table(dngn, function (n) {
            return (WALL_RE.test(n) && !NOT_WALL_RE.test(n))
                   || DOOR_SHUT_RE.test(n) ? 1 : 0;
        });
        upright_of = class_table(dngn, function (n) {
            return UPRIGHT_RE.test(n) && !NOT_UPRIGHT_RE.test(n)
                   && !WALL_RE.test(n) ? 1 : 0;
        });
        // 1 = shallow water / lava, 2 = deep water
        liquid_of = class_table(dngn, function (n) {
            if (/_GONE$|_EXPIRED$/.test(n)) return 0;
            return DEEP_RE.test(n) ? 2 : HIGH_RE.test(n) ? 1 : 0;
        });
        // 1 = cloud, 2 = fire cloud
        cloud_of = class_table(main, function (n) {
            return FIRE_CLOUD_RE.test(n) ? 2 : /^CLOUD_/.test(n) ? 1 : 0;
        });
    }

    function lo(v)
    {
        if (typeof v === "number") return v;
        return v && v.length ? v[0] : 0;
    }

    function idx_of(v, table)
    {
        var i = lo(v) & 0xFFFF;
        return i < table.length ? i : 0;
    }

    // State -----------------------------------------------------------------
    var data = null, cols = 0, rows = 0;
    var dirty = true, last_sig = "", last_build = 0;
    var amt = 0, t_last = 0;
    var stats = { builds: 0, build_ms: 0 };
    var result = { data: null, cols: 0, rows: 0, dirty: false, amt: 0, h: 0,
                   p: 0, rot: 0, hl: 0, zoom: 1 };

    function now()
    {
        return window.performance ? window.performance.now() : Date.now();
    }

    // every map update marks the scan dirty (shared wrapper in fxkit)
    kit.on_merge(function () { dirty = true; });

    function build(vx, vy)
    {
        var t0 = now();
        var n = cols * rows;
        if (!data || data.length !== n * 4)
            data = new Uint8Array(n * 4);
        var px = player.pos ? player.pos.x : 1e9;
        var py = player.pos ? player.pos.y : 1e9;
        var MAIN_MAX = main.MAIN_MAX || 0;

        for (var r = 0; r < rows; r++)
        {
            for (var c = 0; c < cols; c++)
            {
                var o = (r * cols + c) * 4;
                var x = vx + c, y = vy + r;
                data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
                var mc = map_knowledge.get(x, y);
                var t = mc && mc.t;
                // remembered (out of sight) cells count too; never-seen
                // cells have no tile and classify as floor
                if (!t || t.bg === undefined)
                    continue;
                var bi = idx_of(t.bg, wall_of);
                if (wall_of[bi])
                {
                    data[o] = 255;
                    continue;
                }
                var lq = liquid_of[bi < liquid_of.length ? bi : 0];
                if (lq)
                    data[o] = lq === 2 ? 90 : 128;
                if (upright_of[bi])
                    data[o + 2] = 255;
                if (t.cloud)
                {
                    var ci = lo(t.cloud) & 0xFFFF;
                    var cc = ci < cloud_of.length ? cloud_of[ci] : 0;
                    if (cc) data[o + 3] = cc === 2 ? 100 : 255;
                }
                var fgi = lo(t.fg) & 0xFFFF;
                if (x === px && y === py)
                    data[o + 1] = 255;
                else if (mc.mon && fgi)
                    data[o + 1] = 255;
                else if (fgi && fgi < MAIN_MAX)
                    data[o + 1] = 128;
            }
        }
        stats.builds++;
        stats.build_ms = Math.round((now() - t0) * 100) / 100;
    }

    function wall_at(c, r)
    {
        if (!data || c < 0 || r < 0 || c >= cols || r >= rows) return false;
        return data[(r * cols + c) * 4] > 200;
    }

    // 0 = no liquid, 1 = high (shallow water, lava), 2 = low (deep water)
    function liquid_at(c, r)
    {
        if (!data || c < 0 || r < 0 || c >= cols || r >= rows) return 0;
        var v = data[(r * cols + c) * 4];
        return v > 114 && v < 178 ? 1 : v > 77 && v <= 114 ? 2 : 0;
    }

    // Source position (uv, y down) the shader shows at screen uv (u, v), for
    // mouse picking: a raised wall top is drawn over the cell behind it, so a
    // pointer on that strip means the wall cell.
    function unmap(u, v)
    {
        if (!amt || !cols || !rows) return [u, v];
        // same chain as the shader (v is y down): zoom, perspective, yaw about
        // the view centre, then the wall top's extrusion toward screen-up
        var z = 1 + (zoom() - 1) * amt;
        u = 0.5 + (u - 0.5) / z;
        v = 0.5 + (v - 0.5) / z;
        var d = 1 + PERSP * persp() * amt * (v - 0.5);
        u = 0.5 + (u - 0.5) / d;
        v = 0.5 + (v - 0.5) / d;
        var ph = rot() * amt, c = Math.cos(ph), s = Math.sin(ph);
        var dx = u * cols - cols / 2, dy = v * rows - rows / 2;
        var gx = cols / 2 + c * dx - s * dy, gy = rows / 2 + s * dx + c * dy;
        var h = height() * amt;
        var hx = -s * h, hy = c * h;
        if (wall_at(Math.floor(gx + hx), Math.floor(gy + hy)))
        {
            gx += hx;
            gy += hy;
        }
        else if (liquid_at(Math.floor(gx - s * h * LIQUID_FRAC),
                           Math.floor(gy + c * h * LIQUID_FRAC)) === 1)
        {
            gx -= s * h * LIQUID_FRAC;
            gy += c * h * LIQUID_FRAC;
        }
        else if (liquid_at(Math.floor(gx - s * h * LIQUID_FRAC / 2),
                           Math.floor(gy + c * h * LIQUID_FRAC / 2)))
        {
            gx -= s * h * LIQUID_FRAC / 2;
            gy += c * h * LIQUID_FRAC / 2;
        }
        return [gx / cols, gy / rows];
    }

    // Inverse of unmap for a flat floor point: the screen uv (y down) where
    // texture uv (u, v) is shown, plus the cell width / height scale there
    // (zoom, perspective), so overlays can sit on tiles in the 2.5D view.
    // Wall extrusion is ignored (it only moves wall tops).
    function map(u, v)
    {
        if (!amt || !cols || !rows) return [u, v, 1, 1];
        var z = 1 + (zoom() - 1) * amt;
        var ph = rot() * amt, c = Math.cos(ph), s = Math.sin(ph);
        var ex = u * cols - cols / 2, ey = v * rows - rows / 2;
        var dx = c * ex + s * ey, dy = -s * ex + c * ey;
        var u1 = (dx + cols / 2) / cols, v1 = (dy + rows / 2) / rows;
        var k = 1 - PERSP * persp() * amt * (v1 - 0.5);
        var u2 = 0.5 + (u1 - 0.5) / k, v2 = 0.5 + (v1 - 0.5) / k;
        return [0.5 + (u2 - 0.5) * z, 0.5 + (v2 - 0.5) * z, z / k, z / (k * k)];
    }

    function height()
    {
        var v = Number(api.settings.depth_height);
        return (isFinite(v) ? v : 20) / 100;
    }

    function rot()
    {
        if (api.settings.depth_rot_lock === true) return 0;
        var v = Number(api.settings.depth_rot);
        return (isFinite(v) ? v : 12) * Math.PI / 180;
    }

    function zoom()
    {
        var v = Number(api.settings.depth_zoom);
        return Math.max(0.5, Math.min(2, (isFinite(v) ? v : 100) / 100));
    }

    function persp()
    {
        var v = Number(api.settings.depth_persp);
        return Math.max(0, Math.min(1, (isFinite(v) ? v : 60) / 100));
    }

    function depth_source(t)
    {
        var dr = dungeon_renderer;
        var want = api.settings.depth !== false;
        t = typeof t === "number" ? t : now();
        var dt = t_last ? Math.min(0.1, Math.max(0, (t - t_last) / 1000)) : 0;
        t_last = t;
        if (dr.ui_state == enums.ui.VIEW_MAP || !dr.cols || !dr.rows
            || !dr.view || !player.pos)
            want = false;
        amt = want ? Math.min(1, amt + dt / FADE_S)
                   : Math.max(0, amt - dt / FADE_S);
        if (amt <= 0) return null;

        build_tables();
        var vx = dr.view.x, vy = dr.view.y;
        var sig = vx + "," + vy + "," + dr.cols + "," + dr.rows + ","
                  + player.pos.x + "," + player.pos.y;
        if (dr.cols !== cols || dr.rows !== rows)
        {
            cols = dr.cols;
            rows = dr.rows;
            dirty = true;
        }
        if (dirty || sig !== last_sig || t - last_build > REBUILD_MS)
        {
            build(vx, vy);
            dirty = false;
            last_sig = sig;
            last_build = t;
            result.dirty = true;
        }
        result.data = data;
        result.cols = cols;
        result.rows = rows;
        result.amt = amt;
        result.h = height();
        result.hl = result.h * LIQUID_FRAC;
        result.p = persp();
        result.rot = rot();
        result.zoom = zoom();
        return result;
    }

    api.on("game_init", function () {
        dirty = true;
        last_sig = "";
    });
    api.on("setting", function (key) {
        if (/^depth/.test(key)) dirty = true;
    });

    // Alt+P: toggle (Alt+D would focus the browser address bar). Capture
    // phase, like the crt.js hotkeys: the game's own keydown handler would
    // otherwise see the P too (put on jewellery).
    function handle_keydown(ev)
    {
        if (!ev.altKey || ev.ctrlKey || ev.metaKey
            || (ev.key || "").toLowerCase() !== "p"
            || !document.getElementById("dungeon"))
            return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        api.set("depth", api.settings.depth === false);
    }
    document.removeEventListener("keydown", handle_keydown, true);
    document.addEventListener("keydown", handle_keydown, true);

    // Middle mouse button on the game view: drag sideways to rotate, up/down
    // to zoom, click (no drag) to reset both. With Shift held, up/down sets
    // the perspective instead and a click resets it. Capture phase, so crt.js
    // never forwards the middle button to the game.
    var drag = null;
    var DRAG_DEG = 0.25, DRAG_ZOOM = 0.4;   // deg per px, zoom % per px
    var DRAG_PERSP = 0.3;                   // perspective % per px
    var CLICK_PX = 4, CLICK_MS = 350;

    function on_screen(ev)
    {
        return ev.target && ev.target.id === "sdc_screen";
    }

    document.addEventListener("mousedown", function (ev) {
        if (ev.button !== 1 || !on_screen(ev) || api.settings.depth === false)
            return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        drag = { x: ev.clientX, y: ev.clientY, t: now(), moved: false,
                 rot: Number(api.settings.depth_rot) || 0,
                 zoom: Number(api.settings.depth_zoom) || 100,
                 persp: Number(api.settings.depth_persp) || 0,
                 shift: ev.shiftKey };
    }, true);

    window.addEventListener("mousemove", function (ev) {
        if (!drag) return;
        if (ev.shiftKey !== drag.shift)
        {
            // Shift pressed / released mid-drag: restart the vertical axis
            // from here so neither value jumps
            drag.shift = ev.shiftKey;
            drag.y = ev.clientY;
            drag.zoom = Number(api.settings.depth_zoom) || 100;
            drag.persp = Number(api.settings.depth_persp) || 0;
        }
        var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > CLICK_PX) drag.moved = true;
        if (!drag.moved) return;
        // 0.1 steps: whole degrees / percents step visibly on a slow drag
        if (api.settings.depth_rot_lock !== true)
            api.settings.depth_rot = Math.max(-45, Math.min(45,
                Math.round((drag.rot + dx * DRAG_DEG) * 10) / 10));
        if (drag.shift)
            api.settings.depth_persp = Math.max(0, Math.min(100,
                Math.round((drag.persp - dy * DRAG_PERSP) * 10) / 10));
        else
            api.settings.depth_zoom = Math.max(50, Math.min(200,
                Math.round((drag.zoom - dy * DRAG_ZOOM) * 10) / 10));
    });

    window.addEventListener("mouseup", function (ev) {
        if (!drag || ev.button !== 1) return;
        if (!drag.moved && now() - drag.t < CLICK_MS)
        {
            if (ev.shiftKey)
                api.settings.depth_persp = 90;
            else
            {
                api.settings.depth_rot = 12;
                api.settings.depth_zoom = 100;
            }
        }
        drag = null;
        api.save();
    });

    // no autoscroll / paste on the middle button
    ["auxclick", "contextmenu"].forEach(function (type) {
        document.addEventListener(type, function (ev) {
            if (ev.button === 1 && on_screen(ev)) ev.preventDefault();
        }, true);
    });

    api.set_depth_source(depth_source, unmap, map);

    window.sdc_depth_debug = {
        stats: function () {
            return $.extend({ cols: cols, rows: rows, amt: amt,
                              enabled: api.settings.depth !== false }, stats);
        },
    };
});
