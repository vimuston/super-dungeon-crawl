// Unexplored edge: the border between explored ground and never-seen black
// gets soft, blurred black tentacles that curl, sway and reach a little way
// onto the known map, like the dark is feeling its way in.
//
// How it works
// - This module only builds a cols x rows RGBA mask texture (one texel per
//   view cell, row 0 = top; R = 255 for a never-seen cell) whenever the map
//   or the view changes, plus a few uniforms each frame.
// - crt.js samples it with LINEAR filtering in the CRT shader (fogedge()),
//   on the map-space uv after the 2.5D transform, so it follows curvature,
//   rotation and zoom. The shader domain-warps and blurs the mask with
//   flowing noise and adds ridged-noise filaments (the tentacles), all in
//   world cell coordinates so they stay put while the view scrolls.
// - Strength: setting "fogedge_amount" (0-200 %, 0 = off; under 100 fades
//   the dark, over 100 it reaches further onto the map).
//   prefers-reduced-motion freezes the motion (shape stays).
//
// Debug (browser console):
//   sdc_fogedge_debug.stats()       build count / time
//   sdc_fogedge_debug.cell(x, y)    1 if the cell counts as unexplored
define(["./sdc_api", "./map_knowledge", "./dungeon_renderer", "./enums",
        "./tileinfo-dngn", "./fxkit"],
function (api, map_knowledge, dungeon_renderer, enums, dngn, kit) {
    "use strict";

    var REBUILD_MS = 500;       // safety rebuild even without map updates

    api.register_option({ key: "fogedge_amount", label: "Unexplored edge",
                          default: 100,
                          range: { min: 0, max: 200, step: 5 } });

    var data = null, cols = 0, rows = 0;
    var dirty = true, last_sig = "", last_build = 0;
    var t_still = 0;
    var stats = { builds: 0, build_ms: 0 };
    var result = { data: null, cols: 0, rows: 0, dirty: false, amt: 1,
                   vx: 0, vy: 0, t: 0 };

    function now()
    {
        return window.performance ? window.performance.now() : Date.now();
    }

    function lo(v)
    {
        if (typeof v === "number") return v;
        return v && v.length ? v[0] : 0;
    }

    // never seen: no tile at all, or the renderer's own black (<= DNGN_UNSEEN)
    function unexplored(x, y)
    {
        var mc = map_knowledge.get(x, y);
        var t = mc && mc.t;
        if (!t || t.bg === undefined) return true;
        return (lo(t.bg) & 0xFFFF) <= (dngn.DNGN_UNSEEN || 0);
    }

    kit.on_merge(function () { dirty = true; });

    function build(vx, vy)
    {
        var t0 = now();
        var n = cols * rows;
        if (!data || data.length !== n * 4)
            data = new Uint8Array(n * 4);
        for (var r = 0; r < rows; r++)
            for (var c = 0; c < cols; c++)
            {
                var o = (r * cols + c) * 4;
                data[o] = unexplored(vx + c, vy + r) ? 255 : 0;
                data[o + 1] = data[o + 2] = 0;
                data[o + 3] = 255;
            }
        stats.builds++;
        stats.build_ms = Math.round((now() - t0) * 100) / 100;
    }

    function source(t)
    {
        var dr = dungeon_renderer;
        var amount = Number(api.settings.fogedge_amount);
        if (!isFinite(amount)) amount = 100;
        if (amount <= 0) return null;
        if (dr.ui_state == enums.ui.VIEW_MAP || !dr.cols || !dr.rows
            || !dr.view)
            return null;
        t = typeof t === "number" ? t : now();
        var vx = dr.view.x, vy = dr.view.y;
        var sig = vx + "," + vy + "," + dr.cols + "," + dr.rows;
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
        if (!api.reduced_motion())
            t_still = (t / 1000) % 3600;
        result.data = data;
        result.cols = cols;
        result.rows = rows;
        result.vx = vx;
        result.vy = vy;
        result.t = t_still;
        result.amt = Math.min(2, amount / 100);
        return result;
    }

    api.set_fog_source(source);
    api.on("game_init", function () { dirty = true; last_sig = ""; });

    window.sdc_fogedge_debug = {
        stats: function () { return stats; },
        cell: function (x, y) { return unexplored(x, y) ? 1 : 0; },
    };

    return { source: source };
});
