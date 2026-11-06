// Shared plumbing for the Super Dungeon Crawl modules: persisted settings, an
// option registry (rendered in the settings panel by crt.js) and a tiny event bus.
//
// Feature modules (crt_splash, light, stats, bars, ...)
// require this module, never crt.js itself.
//
// Events emitted by crt.js:
//   "game_init"            HUD DOM has been (re)built
//   "game_cleanup"         leaving the game
//   "hud_update" (player, prev)
//                          after every player-state change. `prev` is a
//                          shallow snapshot of the previous update
//                          ({hp, hp_max, mp, mp_max, xl, status: [...],
//                          poison_survival, adjusted_noise, ...}), or null
//                          on the first update of a game.
//   "frame" (t)            ~30 fps while the game view is visible
//   "setting" (key, value) a setting changed
//
// Helpers: warn(where, err) logs a survived error (rate-limited);
// reduced_motion() is prefers-reduced-motion.
// Emitted by blink.js:
//   "blink" (kind, to, from) a blink/teleport effect played ("blink" |
//                          "teleport"; to/from = map coords or null)
define(["jquery"], function ($) {
    "use strict";

    var STORE_KEY = "sdc-settings";
    var settings = {};
    var options = [];       // [{key, label, choices: [[value, label]], default}]
    var handlers = {};
    var light_source = null;

    function load()
    {
        var stored = null;
        try
        {
            stored = JSON.parse(window.localStorage.getItem(STORE_KEY));
        }
        catch (e) { warn("settings load", e); }   // blocked storage / bad JSON
        if (stored && typeof stored === "object")
            $.extend(settings, stored);
    }

    function save()
    {
        try
        {
            window.localStorage.setItem(STORE_KEY, JSON.stringify(settings));
        }
        catch (e) { warn("settings save", e); }   // private mode / full quota
    }

    // Report an error a module chose to survive (an effect that failed must
    // not break the game): logged to the console, at most 3 times per `where`.
    var warned = {};
    function warn(where, err)
    {
        var n = warned[where] = (warned[where] || 0) + 1;
        if (n <= 3 && window.console)
            console.warn("sdc: " + where + (n === 3 ? " (muting further reports)" : ""),
                         err);
    }

    // prefers-reduced-motion, live (the OS setting can change mid-game)
    var reduce_mq = window.matchMedia
        && window.matchMedia("(prefers-reduced-motion: reduce)");
    function reduced_motion()
    {
        return !!(reduce_mq && reduce_mq.matches);
    }

    // Declare a setting with a default. If `choices` is given the option is
    // listed in the settings panel ([value, label] pairs; booleans work too);
    // `tab` puts an option crt.js does not place itself on a tab of that name.
    function register_option(opt)
    {
        if (!(opt.key in settings))
            settings[opt.key] = opt.default;
        if (opt.choices)
        {
            var valid = opt.choices.some(function (c) {
                return c[0] === settings[opt.key];
            });
            if (!valid)
                settings[opt.key] = opt.default;
            options = options.filter(function (o) { return o.key !== opt.key; });
            options.push(opt);
        }
        else if (opt.range)
        {
            // slider option: range = {min, max, step}
            var v = Number(settings[opt.key]);
            if (!isFinite(v))
                v = opt.default;
            settings[opt.key] = Math.max(opt.range.min,
                                         Math.min(opt.range.max, v));
            options = options.filter(function (o) { return o.key !== opt.key; });
            options.push(opt);
        }
        return settings[opt.key];
    }

    function get(key)
    {
        return settings[key];
    }

    function set(key, value)
    {
        settings[key] = value;
        save();
        emit("setting", key, value);
    }

    function on(name, fn)
    {
        (handlers[name] = handlers[name] || []).push(fn);
    }

    function emit(name)
    {
        var args = Array.prototype.slice.call(arguments, 1);
        (handlers[name] || []).forEach(function (fn) {
            try
            {
                fn.apply(null, args);
            }
            catch (e)
            {
                console.error("sdc: " + name + " handler failed", e);
            }
        });
    }

    // The lighting module provides a function returning a canvas (or null)
    // that is composited additively by the CRT shader; see crt.js frame().
    // The canvas covers exactly the dungeon canvas area (any resolution).
    function set_light_source(fn)
    {
        light_source = fn;
    }

    function get_light_source()
    {
        return light_source;
    }

    // Extra light emitters from effect modules: fn() returns an array of
    // {x, y, cls, f} in map coords (cls = a light.js class name, f = gain),
    // or null. Drawn by light.js each frame; fn=null removes the contributor.
    var light_extras = {};
    function light_extra(name, fn)
    {
        if (fn) light_extras[name] = fn; else delete light_extras[name];
    }
    function get_light_extras() { return light_extras; }

    // Commands registered by crt.js, runnable by UI modules (toolbar):
    //   "toggle:map" | "toggle:monsters" | "toggle:stats" | "toggle:hud"
    //   "toggle:filter" (cycles curved/flat/off) | "panel" (settings panel)
    var commands = {};
    function register_command(name, fn)
    {
        commands[name] = fn;
    }

    function command(name)
    {
        if (commands[name])
            commands[name]();
    }

    // Line-of-sight mask provider: fn() -> null or
    //   {canvas, px, py, amount}
    // canvas covers the dungeon canvas area; red = 1 inside the player's LOS
    // (soft edges); px/py = player centre in uv (0..1, y down); amount 0..1.
    var los_source = null;
    function set_los_source(fn)
    {
        los_source = fn;
    }

    function get_los_source()
    {
        return los_source;
    }

    // Living-tiles provider (alive.js): fn(t) -> null or
    //   {data: Uint8Array (cols*rows*4, row 0 = top), cols, rows,
    //    dirty (crt.js uploads, then clears it), amt (master strength),
    //    uniforms: [[name, Float32Array(1..4)], ...]}
    // null = effect off (u_alive_amt = 0).
    var alive_source = null;
    function set_alive_source(fn)
    {
        alive_source = fn;
    }

    function get_alive_source()
    {
        return alive_source;
    }

    // Unexplored-edge mask (fogedge.js): fn(t) -> null or
    //   {data: Uint8Array (cols*rows*4, row 0 = top, R = 255 never seen),
    //    cols, rows, dirty (crt.js uploads, then clears it), amt (0..1),
    //    vx, vy (map coords of the top-left cell), t (seconds)}.
    var fog_source = null;
    function set_fog_source(fn) { fog_source = fn; }
    function get_fog_source() { return fog_source; }

    // 2.5D view provider (depth.js): fn(t) -> null or
    //   {data: Uint8Array (cols*rows*4, row 0 = top), cols, rows,
    //    dirty (crt.js uploads, then clears it), amt (0..1 fade), h (wall
    //    height, cells)}; unmap(u, v) maps a screen uv (y down) to the uv the
    //    shader shows there (mouse picking). null = effect off.
    var depth_source = null, depth_unmap = null, depth_fwd = null;
    function set_depth_source(fn, unmap, fwd)
    {
        depth_source = fn;
        depth_unmap = unmap || null;
        depth_fwd = fwd || null;
    }

    function get_depth_source()
    {
        return depth_source;
    }

    function depth_unmap_uv(u, v)
    {
        return depth_unmap ? depth_unmap(u, v) : [u, v];
    }

    // forward: texture uv of a flat floor point -> [screen u, v, cell width
    // scale, cell height scale] in the 2.5D view; identity when it is off
    function depth_map_uv(u, v)
    {
        return depth_fwd ? depth_fwd(u, v) : [u, v, 1, 1];
    }

    // --- screen-fx store (berserk.js): a plain object read by crt.js
    // every frame and uploaded as shader uniforms. Fields (all optional,
    // missing = 0): rage 0..1, beat 0..1, shock_r, shock_a, px, py (player
    // uv, y down), crash 0..1, sx, sy (dungeon shake, device px).
    var fx = null;
    function set_fx(obj)
    {
        fx = obj || null;
    }

    function get_fx()
    {
        return fx;
    }
    // --- end screen-fx store

    // --- screen-grade channel: many modules may colour/distort the whole
    // dungeon view at once. Each contributor owns a name and calls
    // grade(name, {...}) every frame it is active (or once with a value it
    // animates itself); grade(name, null) removes it. Fields (all optional):
    //   desat 0..1   toward greyscale          invert 0..1  colour inversion
    //   tint [r,g,b] multiplicative colour     tint_a 0..1  how much of it
    //   vig [r,g,b]  edge-vignette colour      vig_a 0..1   its strength
    //   wobble 0..1  sinusoidal wobble         smear 0..1   chroma smear
    //   hue          hue rotation, turns       sx, sy       shake, device px
    // Contributions combine: desat/invert/tint_a/vig_a/wobble/smear = max,
    // tint/vig colours = weight-averaged, hue/sx/sy = summed.
    var grades = {};
    function grade(name, obj)
    {
        if (obj) grades[name] = obj; else delete grades[name];
    }

    function get_grade()
    {
        var o = { desat: 0, invert: 0, tint_a: 0, vig_a: 0, wobble: 0,
                  smear: 0, hue: 0, sx: 0, sy: 0,
                  tint: [1, 1, 1], vig: [0, 0, 0] };
        var tw = 0, vw = 0, t = [0, 0, 0], v = [0, 0, 0];
        for (var k in grades)
        {
            var g = grades[k];
            o.desat = Math.max(o.desat, g.desat || 0);
            o.invert = Math.max(o.invert, g.invert || 0);
            o.wobble = Math.max(o.wobble, g.wobble || 0);
            o.smear = Math.max(o.smear, g.smear || 0);
            o.hue += g.hue || 0;
            o.sx += g.sx || 0;
            o.sy += g.sy || 0;
            if (g.tint && g.tint_a)
            {
                o.tint_a = Math.max(o.tint_a, g.tint_a);
                for (var i = 0; i < 3; i++) t[i] += g.tint[i] * g.tint_a;
                tw += g.tint_a;
            }
            if (g.vig && g.vig_a)
            {
                o.vig_a = Math.max(o.vig_a, g.vig_a);
                for (var j = 0; j < 3; j++) v[j] += g.vig[j] * g.vig_a;
                vw += g.vig_a;
            }
        }
        if (tw) o.tint = [t[0] / tw, t[1] / tw, t[2] / tw];
        if (vw) o.vig = [v[0] / vw, v[1] / vw, v[2] / vw];
        return o;
    }
    // --- end screen-grade channel

    // Player tile on screen (crt_splash.js provides it): fn() -> null or
    //   {x, y, cw, ch} in client px (tile centre and size, as displayed
    //   through the curved screen).
    var anchor_source = null;
    function set_player_anchor(fn)
    {
        anchor_source = fn;
    }

    function player_anchor()
    {
        return anchor_source ? anchor_source() : null;
    }

    // Long-press claims (mobile.js asks before its stock describe):
    // on_hold(fn), fn(x, y) -> true if it took the hold at client px x/y.
    // hold(x, y) asks each claimant in order; the first taker wins.
    var hold_fns = [];
    function on_hold(fn)
    {
        hold_fns.push(fn);
    }

    function hold(x, y)
    {
        for (var i = 0; i < hold_fns.length; i++)
        {
            try
            {
                if (hold_fns[i](x, y)) return true;
            }
            catch (e) { warn("hold", e); }
        }
        return false;
    }

    // CRT barrel strength per "Curvature" level (shader k). Modules that map
    // screen positions through the curved screen use curve_k().
    var CURVES = { subtle: 0.02, low: 0.04, medium: 0.06, high: 0.08,
                   max: 0.10 };
    function curve_k()
    {
        return CURVES[settings.curve_amount] || CURVES.medium;
    }

    load();

    return {
        settings: settings,
        register_option: register_option,
        options: function () { return options; },
        get: get,
        set: set,
        save: save,
        on: on,
        emit: emit,
        set_light_source: set_light_source,
        get_light_source: get_light_source,
        light_extra: light_extra,
        get_light_extras: get_light_extras,
        curve_k: curve_k,
        register_command: register_command,
        command: command,
        set_los_source: set_los_source,
        get_los_source: get_los_source,
        set_alive_source: set_alive_source,
        get_alive_source: get_alive_source,
        set_depth_source: set_depth_source,
        get_depth_source: get_depth_source,
        set_fog_source: set_fog_source,
        get_fog_source: get_fog_source,
        depth_unmap: depth_unmap_uv,
        depth_map: depth_map_uv,
        set_fx: set_fx,
        grade: grade,
        get_grade: get_grade,
        get_fx: get_fx,
        set_player_anchor: set_player_anchor,
        player_anchor: player_anchor,
        on_hold: on_hold,
        hold: hold,
        warn: warn,
        reduced_motion: reduced_motion,
    };
});
