// X1: data-driven status auras. One engine turns "status light X is on" into
// start / per-frame / stop callbacks, so a status effect is just a definition
// and not a module with its own observers.
//
//   statusfx.register({
//       id: "haste",                    // unique; also the root element class
//       match: /^haste/,                // tested on the lower-case base light
//       start: function (ctx) {},       // light appeared (ctx.initial = true
//                                       //   when it was already on at load)
//       frame: function (ctx, t) {},    // ~30 fps while active (optional)
//       stop:  function (ctx) {},       // light vanished (optional)
//       cleanup: function (ctx) {}      // always last; remove DOM/grade here
//   });
//
// ctx = { root,    // div for this aura inside the shared "aura" layer
//         anchor,  // player tile {x, y, cw, ch} client px (refreshed each
//                  //   frame before frame(); null when off screen)
//         light,   // the raw status light text, e.g. "Haste" / "Slow"
//         t0,      // fxkit.now() at start
//         data }   // free scratch object for the definition
//
// Screen-wide colouring goes through api.grade("<id>", {...}) (see sdc_api);
// call api.grade("<id>", null) in cleanup. Definitions live in the feature
// modules (statusauras.js, godfx_*.js, ...), which require this module.
define(["./sdc_api", "./fxkit", "./player"], function (api, kit, player) {
    "use strict";

    var defs = [];
    var active = {};          // id -> ctx
    var first = true;

    function register(def)
    {
        defs.push(def);
        // a module loaded after game start: pick up a status already on
        if (!first) sync(true);
    }

    function lights_now()
    {
        var out = [];
        ((player && player.status) || []).forEach(function (st) {
            if (st && st.light)
                out.push({ name: kit.base_light(st.light).toLowerCase(),
                           light: kit.strip(st.light) });
        });
        return out;
    }

    function start(def, hit, initial)
    {
        var layer = kit.layer("aura");
        var root = document.createElement("div");
        root.className = "sdc-aura sdc-aura-" + def.id;
        root.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;";
        layer.appendChild(root);
        var ctx = { root: root, anchor: kit.anchor_of(kit.player_pos()),
                    light: hit.light, t0: kit.now(), data: {},
                    initial: !!initial };
        active[def.id] = ctx;
        safe(def.start, ctx);
    }

    function stop(def)
    {
        var ctx = active[def.id];
        if (!ctx) return;
        delete active[def.id];
        safe(def.stop, ctx);
        safe(def.cleanup, ctx);
        if (ctx.root.parentNode) ctx.root.parentNode.removeChild(ctx.root);
    }

    function safe(fn, ctx, t)
    {
        if (!fn) return;
        try { fn(ctx, t); }
        catch (e) { console.error("sdc statusfx:", e); }
    }

    function sync(initial)
    {
        var lights = lights_now();
        defs.forEach(function (def) {
            var hit = null;
            for (var i = 0; i < lights.length && !hit; i++)
                if (def.match.test(lights[i].name)) hit = lights[i];
            if (hit && !active[def.id]) start(def, hit, initial);
            else if (!hit && active[def.id]) stop(def);
        });
    }

    api.on("hud_update", function () {
        sync(first);
        first = false;
    });

    api.on("frame", function (t) {
        defs.forEach(function (def) {
            var ctx = active[def.id];
            if (!ctx) return;
            ctx.anchor = kit.anchor_of(kit.player_pos());
            if (def.frame) safe(def.frame, ctx, t);
        });
    });

    function reset()
    {
        defs.forEach(stop);
        first = true;
    }
    api.on("game_init", reset);
    api.on("game_cleanup", reset);

    return { register: register };
});
