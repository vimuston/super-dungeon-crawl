// Shared plumbing for the effect modules (statusauras, summonfx, godfx, ...):
// one message observer, tile geometry through the curved screen, overlay
// layers, small animation helpers and status on/off events. Feature modules
// require this and sdc_api, never each other.
//
//   fxkit.on_message(fn(text))   every new game message line (plain text, one
//                                call per line; none during the first
//                                MSG_GRACE ms after game_init or on replays)
//   fxkit.anchor_of({x,y})       tile centre in client px {x, y, cw, ch}
//                                (curved-screen corrected) or null off view
//   fxkit.pin(el, pos, a0, ms)   keep container `el` (children laid out around
//                                anchor a0) on map tile `pos` as the view
//                                scrolls, for ms; use for effects that last
//                                longer than a player move
//   fxkit.player_pos()           {x, y} map coords or null
//   fxkit.monsters()             [{name, x, y}] visible monsters (lower case)
//   fxkit.layer(id)              fixed, pointer-less overlay div (z-index 4,
//                                above the dungeon, below the HUD); rebuilt
//                                after game_init. Same id -> same element.
//   fxkit.view_rect()            dungeon canvas rect clamped to the window
//   fxkit.mk(parent, css), fxkit.anim(el, frames, opts), fxkit.at(x, y),
//   fxkit.rgba("r,g,b", a), fxkit.rnd(a, b), fxkit.pick(list), fxkit.now(),
//   fxkit.reduced()              prefers-reduced-motion
//   fxkit.has_light(status, name)  status light by base name (e.g. "Haste")
//   fxkit.on_merge(fn())         after every map_knowledge.merge (a server map
//                                update), with map_knowledge.dirty() listing
//                                the changed cells: catches transient tile
//                                content (bolts, missiles) between frames.
//                                One shared wrapper; callbacks run in order.
//   fxkit.nearest_monster(list?) closest visible monster to the player
//                                (Manhattan distance) or null
//   fxkit.spawn(layer_id, css, frames, opts, max)  animated element in
//                                layer(id), removed when the animation ends;
//                                null once `max` (default 40) are live there
//   fxkit.brand_of(text, loose)  weapon/ammo brand id ("flame", "freeze",
//                                "elec", "venom", "poison", "drain", "vamp",
//                                "pain", "holy", "distort", "chaos", "anti",
//                                "foul", "acid", "silver", "steel", "pierce",
//                                "disperse", "speed", "explode") or null.
//                                Item names: strict ("of flaming", "{flame");
//                                loose also reads words in messages ("fiery")
//
// Events on sdc_api (in addition to those listed there):
//   "message" (text)             same as on_message
//   "status_on" (name, light)    a player status light appeared; name is the
//   "status_off" (name)          lower-case base light ("haste", "berserk",
//                                "shield", ...); fired from hud_update, not
//                                for statuses present at game start
//
// Always check fxkit.reduced() before motion-heavy effects and keep particle
// counts small (<= ~40 live elements per effect).
define(["jquery", "./sdc_api", "./player", "./dungeon_renderer", "./enums",
        "./map_knowledge"],
function ($, api, player, dungeon_renderer, enums, map_knowledge) {
    "use strict";

    var MSG_GRACE = 1500;
    var msg_observer = null, init_time = 0, seen_msg = null;
    var layers = {};

    function now()
    {
        return window.performance ? window.performance.now() : Date.now();
    }
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
    function reduced() { return api.reduced_motion(); }
    function strip(s) { return String(s || "").replace(/<[^>]*>/g, "").trim(); }
    function base_light(light) { return strip(light).split(/[\s(]/)[0]; }

    function has_light(status, name)
    {
        return (status || []).some(function (st) {
            return st && st.light && base_light(st.light) === name;
        });
    }

    // Geometry ----------------------------------------------------------------

    function view_rect()
    {
        var c = document.getElementById("dungeon");
        var r = c && c.getBoundingClientRect();
        if (!r || r.width < 50 || r.height < 50)
            r = { left: 0, top: 0, width: window.innerWidth,
                  height: window.innerHeight };
        var left = Math.max(0, r.left), top = Math.max(0, r.top);
        var right = Math.min(window.innerWidth, r.left + r.width);
        var bottom = Math.min(window.innerHeight, r.top + r.height);
        if (right - left < 50 || bottom - top < 50)
        {
            left = 0; top = 0;
            right = window.innerWidth; bottom = window.innerHeight;
        }
        return { left: left, top: top, width: right - left,
                 height: bottom - top };
    }

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

        // 2.5D view (depth.js): rotation / keystone / zoom move the tiles
        var dm = api.depth_map(fx, fy);
        fx = dm[0]; fy = dm[1];
        cw *= dm[2]; ch *= dm[3];

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

    // Keep an effect on its map tile while the view scrolls (the player
    // moving shifts every tile on screen). `el` is a zero-size container whose
    // children were laid out around `a0` (the anchor_of() result when they
    // were created); it is moved by the tile's offset from a0 every frame,
    // hidden while the tile is off screen, and removed after `ms`.
    var pins = [], pin_raf = 0;

    function pin_tick()
    {
        var t = now();
        pins = pins.filter(function (p) {
            if (t >= p.end || !p.el.parentNode)
            {
                if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
                return false;
            }
            var a = anchor_of(p.pos);
            if (!a)
                p.el.style.visibility = "hidden";
            else
            {
                p.el.style.visibility = "";
                p.el.style.transform = "translate(" + (a.x - p.a0.x) + "px,"
                                       + (a.y - p.a0.y) + "px)";
            }
            return true;
        });
        pin_raf = pins.length ? window.requestAnimationFrame(pin_tick) : 0;
    }

    function pin(el, pos, a0, ms)
    {
        pins.push({ el: el, pos: { x: pos.x, y: pos.y }, a0: a0,
                    end: now() + ms });
        if (!pin_raf) pin_raf = window.requestAnimationFrame(pin_tick);
    }

    function player_pos()
    {
        return player.pos ? { x: player.pos.x, y: player.pos.y } : null;
    }

    function monsters()
    {
        var out = [];
        var dr = dungeon_renderer;
        if (!dr || !dr.view) return out;
        for (var y = dr.view.y; y < dr.view.y + dr.rows; y++)
            for (var x = dr.view.x; x < dr.view.x + dr.cols; x++)
            {
                var mc = map_knowledge.get(x, y);
                if (mc && mc.mon && mc.mon.name)
                    out.push({ name: String(mc.mon.name).toLowerCase(),
                               x: x, y: y });
            }
        return out;
    }

    // Layers and building blocks ---------------------------------------------

    function layer(id)
    {
        var el = layers[id];
        if (el && document.body.contains(el)) return el;
        el = document.createElement("div");
        el.id = "sdc_" + id;
        el.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;"
                           + "z-index:4;pointer-events:none;overflow:hidden;";
        (document.getElementById("normal") || document.body).appendChild(el);
        layers[id] = el;
        return el;
    }

    function rgba(c, a)
    {
        return "rgba(" + c + "," + (a < 0 ? 0 : a > 1 ? 1 : a) + ")";
    }

    var live = {};              // layer id -> live spawn() elements
    function spawn(id, css, frames, opts, max)
    {
        if ((live[id] || 0) >= (max || 40)) return null;
        var el = mk(layer(id), css);
        live[id] = (live[id] || 0) + 1;
        var gone = false;
        var done = function () {
            if (gone) return;
            gone = true;
            if (el.parentNode) el.parentNode.removeChild(el);
            live[id] = Math.max(0, (live[id] || 1) - 1);
        };
        var a;
        try { a = anim(el, frames, opts); }
        catch (e) { a = null; api.warn("spawn " + id, e); }
        if (!a) { done(); return null; }
        a.addEventListener("finish", done);
        a.addEventListener("cancel", done);
        // belt and braces: hidden tabs may never finish the animation
        var n = opts.iterations === undefined ? 1 : opts.iterations;
        if (isFinite(n))
            window.setTimeout(done, (opts.duration || 500) * n
                              + (opts.delay || 0) + (opts.endDelay || 0) + 400);
        return el;
    }

    // Map updates -----------------------------------------------------------

    var merge_fns = [];
    function install_merge()
    {
        if (map_knowledge.merge.sdc_fxkit) return;
        var orig = map_knowledge.merge;
        var wrapped = function () {
            var res = orig.apply(this, arguments);
            for (var i = 0; i < merge_fns.length; i++)
            {
                try { merge_fns[i](); }
                catch (e) { api.warn("map update hook", e); }
            }
            return res;
        };
        wrapped.sdc_fxkit = true;
        map_knowledge.merge = wrapped;
    }
    function on_merge(fn)
    {
        merge_fns.push(fn);
        install_merge();
    }

    function nearest_monster(list)
    {
        var p = player_pos();
        if (!p) return null;
        var best = null, bd = 1e9;
        (list || monsters()).forEach(function (m) {
            var d = Math.abs(m.x - p.x) + Math.abs(m.y - p.y);
            if (d > 0 && d < bd) { bd = d; best = m; }
        });
        return best;
    }

    // Brands ----------------------------------------------------------------
    // [id, strict (item names), loose (message words, ammo)]; first match wins
    var BRANDS = [
        ["foul",     /\bof foul ?flame\b|\{foul ?flame\b/, /\bfoul ?flame\b/],
        ["flame",    /\bof flam(?:e|ing)\b|\{flame\b/, /\b(?:flam(?:e|ing|es)|fiery|fire)\b/],
        ["freeze",   /\bof (?:freezing|frost)\b|\{freeze\b/, /\b(?:freez(?:e|ing)|frost(?:y)?|icy|cold)\b/],
        ["elec",     /\bof electrocution\b|\{elec\b/, /\belectrocut|\blightning\b|\bshocking\b/],
        ["venom",    /\bof venom\b|\{venom\b|\bcurare\b/, /\bvenom|\bcurar/],
        ["poison",   /\bof poison\b|\bpoisoned\b/, /\bpoison/],
        ["drain",    /\bof draining\b|\{drain\b/, /\bdrain(?:ing)?\b/],
        ["vamp",     /\bof vampirism\b|\{vamp\b/, /\bvampiric\b/],
        ["pain",     /\bof pain\b|\{pain\b/, /\bpain\b/],
        ["holy",     /\bof holy wrath\b|\{holy\b/, /\bholy\b/],
        ["distort",  /\bof distortion\b|\{distort\b/, /\bdistort/],
        ["chaos",    /\bof chaos\b|\{chaos\b/, /\bchao(?:s|tic)\b/],
        ["anti",     /\bof antimagic\b|\{antimagic\b/, /\bantimagic\b/],
        ["acid",     /\bof acid\b|\{acid\b|\{corrode\b/, /\bacid\b|\bcorrod/],
        ["silver",   /\bsilver\b/, null],
        ["steel",    /\bsteel\b/, null],
        ["pierce",   /\bof penetration\b|\{penet/, /\bpenetrat/],
        ["disperse", /\bof dispersal\b|\{disperse\b/, /\bdispers(?:al|e)\b/],
        ["speed",    /\bof speed\b|\{speed\b/, null],
        ["explode",  /\bof exploding\b|\bexploding\b/, null]
    ];
    function brand_of(text, loose)
    {
        var t = String(text || "").toLowerCase();
        for (var i = 0; i < BRANDS.length; i++)
        {
            var b = BRANDS[i];
            if (b[1].test(t) || (loose && b[2] && b[2].test(t))) return b[0];
        }
        return null;
    }

    function mk(parent, css)
    {
        var d = document.createElement("div");
        d.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;"
                          + "will-change:transform,opacity;" + (css || "");
        parent.appendChild(d);
        return d;
    }

    function anim(el, frames, opts)
    {
        opts.fill = "both";
        if (opts.easing === undefined) opts.easing = "ease-out";
        return el.animate(frames, opts);
    }

    function at(x, y) { return "translate(" + x + "px," + y + "px) "; }

    // Messages ---------------------------------------------------------------

    function node_text(node)
    {
        var c = node.cloneNode(true);
        var g = c.querySelectorAll(".prefix_glyph");
        for (var i = 0; i < g.length; i++)
            g[i].parentNode.removeChild(g[i]);
        return (c.textContent || "").trim();
    }

    function emit_text(text)
    {
        // stock appends to one element while a line grows; split sentences
        // only loosely: modules get the whole fresh text and test by regex
        if (text) api.emit("message", text);
    }

    function process_msg(el, quiet, in_grace)
    {
        var text = node_text(el);
        var old = seen_msg.get(el);
        if (old === text) return;
        seen_msg.set(el, text);
        if (quiet || in_grace) return;
        var fresh = (old !== undefined && text.indexOf(old) === 0)
                    ? text.slice(old.length) : text;
        emit_text(fresh.trim());
    }

    function seed_all(root)
    {
        var all = root.querySelectorAll
                  ? root.querySelectorAll(".game_message") : [];
        for (var i = 0; i < all.length; i++)
            process_msg(all[i], true, true);
    }

    function owner_msg(n)
    {
        var el = n.nodeType === 1 ? n : n.parentElement;
        return el && el.closest ? el.closest(".game_message") : null;
    }

    function on_nodes(records)
    {
        var grace = now() - init_time < MSG_GRACE;
        records.forEach(function (r) {
            var own = owner_msg(r.target);
            if (own) process_msg(own, false, grace);
            Array.prototype.forEach.call(r.addedNodes, function (node) {
                if (node.nodeType === 1)
                {
                    if (node.classList.contains("game_message"))
                        process_msg(node, false, grace);
                    else if (node.id === "messages"
                             || node.querySelector(".game_message"))
                        seed_all(node);      // bulk re-insert (stock layout())
                    else if (own)
                        process_msg(own, false, grace);
                }
                else if (own)
                    process_msg(own, false, grace);
            });
        });
    }

    function watch()
    {
        if (msg_observer) msg_observer.disconnect();
        seen_msg = window.WeakMap ? new WeakMap() : null;
        var el = document.getElementById("message_pane")
                 || document.getElementById("messages_container")
                 || document.getElementById("normal");
        if (!el || !window.MutationObserver || !seen_msg) return;
        seed_all(el);
        msg_observer = new MutationObserver(on_nodes);
        msg_observer.observe(el, { childList: true, subtree: true });
    }

    // Status on/off events ----------------------------------------------------

    function light_names(status)
    {
        var o = {};
        (status || []).forEach(function (st) {
            if (st && st.light)
                o[base_light(st.light).toLowerCase()] = st.light;
        });
        return o;
    }

    var prev_lights = null;
    api.on("hud_update", function (pl) {
        var cur = light_names(pl && pl.status);
        if (prev_lights)
        {
            Object.keys(cur).forEach(function (n) {
                if (!(n in prev_lights)) api.emit("status_on", n, cur[n]);
            });
            Object.keys(prev_lights).forEach(function (n) {
                if (!(n in cur)) api.emit("status_off", n);
            });
        }
        prev_lights = cur;
    });

    api.on("game_init", function () {
        init_time = now();
        prev_lights = null;
        live = {};
        if (merge_fns.length) install_merge();
        Object.keys(layers).forEach(function (k) {
            var el = layers[k];
            if (el && el.parentNode) el.parentNode.removeChild(el);
        });
        layers = {};
        watch();
    });

    api.on("game_cleanup", function () {
        if (msg_observer) msg_observer.disconnect();
        msg_observer = null;
        Object.keys(layers).forEach(function (k) {
            var el = layers[k];
            if (el && el.parentNode) el.parentNode.removeChild(el);
        });
        layers = {};
    });

    return {
        on_message: function (fn) { api.on("message", fn); },
        anchor_of: anchor_of,
        pin: pin,
        player_pos: player_pos,
        monsters: monsters,
        layer: layer,
        view_rect: view_rect,
        mk: mk, anim: anim, at: at, rgba: rgba,
        rnd: rnd, pick: pick, now: now, reduced: reduced,
        strip: strip, has_light: has_light, base_light: base_light,
        on_merge: on_merge, nearest_monster: nearest_monster, spawn: spawn,
        brand_of: brand_of
    };
});
