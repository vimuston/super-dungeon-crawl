// Blink / teleport effect: a CRT "dematerialize / rematerialize".
//   blink     short and local: a few phosphor tear bands and an RGB-split
//             glow around the arrival tile, a vertical beam and a violet/cyan
//             ring burst with sparkles; an afterimage collapses at the
//             departure tile.
//   teleport  the same, plus a full-view scan sweep, a flash and wider tears.
//
// Triggers: game messages ("You blink.", "Your surroundings suddenly seem
// different", ...), the "Tele" status light vanishing together with a position
// jump, and a plain position jump (>= 4 cells in one frame, not part of a
// walking/travel streak, same place/depth).
//
// Note: the stock client stamps the previous message's prefix glyph with "_"
// (turn/command marker) when the next player update arrives; when a monster
// acts right after a blink that happens before our MutationObserver runs, so
// the text is read without the .prefix_glyph span and leading junk is ignored.
//
// Layer: #sdc_blink, fixed, z-index 4 (above the dungeon, below the HUD).
// Debug: window.sdc_blink_test("blink" | "teleport")
define(["jquery", "./sdc_api", "./player", "./dungeon_renderer", "./enums"],
function ($, api, player, dungeon_renderer, enums) {
    "use strict";

    var MSG_GRACE = 1500;      // ms after game_init before messages count
    var DEDUPE = 700;          // ms between weak (position jump) effects
    var DEDUPE_STRONG = 250;   // ms between message-triggered effects
    var SETTLE = 900;          // ms after a place/depth change
    var JUMP_CELLS = 4;
    var MAX_FX = 2;

    var layer = null;
    var fx_list = [];
    var msg_observer = null;
    var init_time = 0;
    var last_fire = -1e9;
    var pending = null;        // {kind, strong, from, timer}
    var hist = [];             // [{x, y, t}] previous positions
    var last_pos = null;
    var last_key = null;
    var key_time = 0;
    var streak = 0;
    var last_time = null;      // player.time at last_pos
    var last_move_t = 0;
    var pos_queue = [];
    var cur_pos_val = null;
    var dbg = window.sdc_blink_debug = { log: [], suppressed: [], msgs: [] };

    function dlog(list, source, kind, extra)
    {
        list.push({ source: source, kind: kind, ts: Math.round(now()),
                    info: extra || "" });
        if (list.length > 20) list.shift();
    }

    var reduce_motion = window.matchMedia
        && window.matchMedia("(prefers-reduced-motion: reduce)");

    var C_GREEN = "125,255,176";
    var C_CYAN = "102,240,255";
    var C_VIOLET = "176,128,255";
    var C_MAG = "255,60,210";

    function now()
    {
        return window.performance ? window.performance.now() : Date.now();
    }

    function rnd(a, b)
    {
        return a + Math.random() * (b - a);
    }

    // Always on: no option. Only a non-option condition is kept here.
    function enabled()
    {
        return true;
    }

    function reduced()
    {
        return !!(reduce_motion && reduce_motion.matches);
    }

    function strip(s)
    {
        return String(s || "").replace(/<[^>]*>/g, "").trim();
    }

    function base_light(light)
    {
        return strip(light).split(/[\s(]/)[0];
    }

    function has_light(status, name)
    {
        return (status || []).some(function (st) {
            return st && st.light && base_light(st.light) === name;
        });
    }

    // Geometry ----------------------------------------------------------------

    function ensure_layer()
    {
        if (layer && document.body.contains(layer))
            return layer;
        layer = document.createElement("div");
        layer.id = "sdc_blink";
        (document.getElementById("normal") || document.body)
            .appendChild(layer);
        return layer;
    }

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

    // Tile centre of map position `pos` in client px (+ cell size), curved
    // screen correction as in crt_splash.js; null if unknown / off view.
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

    // Building blocks ---------------------------------------------------------

    function rgba(c, a)
    {
        return "rgba(" + c + "," + a + ")";
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

    function at(x, y)
    {
        return "translate(" + x + "px," + y + "px) ";
    }

    // Effect parts. All coordinates are local to the clipped container.

    function flash_full(box)
    {
        var f = mk(box, "width:100%;height:100%;mix-blend-mode:screen;"
                   + "background:" + rgba("190,255,230", 1));
        anim(f, [{ opacity: 0 }, { opacity: 0.22, offset: 0.25 },
                 { opacity: 0 }], { duration: 340 });
    }

    // RGB-split style flash: whole view when `big`, else a soft glow at `a`
    function rgb_split(box, a, big)
    {
        var bg1, bg2;
        if (big)
        {
            bg1 = rgba(C_CYAN, 0.22);
            bg2 = rgba(C_MAG, 0.18);
        }
        else
        {
            var R = Math.round(a.cw * 5);
            var p = "radial-gradient(circle " + R + "px at " + a.lx + "px "
                    + a.ly + "px, ";
            bg1 = p + rgba(C_CYAN, 0.3) + ", transparent)";
            bg2 = p + rgba(C_MAG, 0.24) + ", transparent)";
        }
        var d = big ? 7 : 5;
        var l1 = mk(box, "width:100%;height:100%;mix-blend-mode:screen;"
                    + "background:" + bg1);
        var l2 = mk(box, "width:100%;height:100%;mix-blend-mode:screen;"
                    + "background:" + bg2);
        anim(l1, [{ transform: at(-d, 0), opacity: 0 },
                  { transform: at(-d * 0.4, 0), opacity: 1, offset: 0.3 },
                  { transform: at(d * 0.5, 0), opacity: 0 }],
             { duration: 380 });
        anim(l2, [{ transform: at(d, 0), opacity: 0 },
                  { transform: at(d * 0.4, 0), opacity: 1, offset: 0.3 },
                  { transform: at(-d * 0.5, 0), opacity: 0 }],
             { duration: 380 });
    }

    // horizontal tear bands. full: across the view at random heights;
    // otherwise `span` px wide, within a few px of row cy, centred on cx.
    function tears(box, vr, n, full, cx, cy, span)
    {
        for (var i = 0; i < n; i++)
        {
            var h = Math.round(rnd(3, 11));
            var w = full ? vr.width : span * rnd(0.6, 1);
            var x = full ? 0 : cx - w / 2 + rnd(-span * 0.1, span * 0.1);
            var y = full ? rnd(0, vr.height - h) : cy + rnd(-36, 36);
            var col = i % 3 === 0 ? C_CYAN : (i % 3 === 1 ? C_GREEN : C_MAG);
            var b = mk(box, "width:" + w + "px;height:" + h + "px;left:" + x
                       + "px;top:" + y + "px;mix-blend-mode:screen;"
                       + "background:" + rgba(col, 0.38) + ";box-shadow:0 0 6px "
                       + rgba(col, 0.6));
            var d = rnd(10, 30) * (Math.random() < 0.5 ? -1 : 1);
            anim(b, [{ transform: at(0, 0), opacity: 0 },
                     { transform: at(d, 0), opacity: 1, offset: 0.25 },
                     { transform: at(-d * 0.6, 0), opacity: 0.8, offset: 0.6 },
                     { transform: at(d * 0.2, 0), opacity: 0 }],
                 { duration: 260, delay: rnd(0, 170), easing: "linear" });
        }
    }

    function sweep(box, vr)
    {
        var hb = Math.max(40, vr.height * 0.18);
        var s = mk(box, "width:100%;height:" + hb + "px;top:" + (-hb) + "px;"
                   + "mix-blend-mode:screen;background:linear-gradient("
                   + "to bottom, transparent 0%, " + rgba(C_GREEN, 0.08)
                   + " 30%, " + rgba(C_GREEN, 0.34) + " 78%, "
                   + "rgba(225,255,245,0.95) 96%, transparent 100%)");
        anim(s, [{ transform: at(0, 0) }, { transform: at(0, vr.height + hb) }],
             { duration: 460, easing: "cubic-bezier(.5,0,.6,1)" });
    }

    function ring(box, a, color, delay, big)
    {
        var s = Math.round(a.cw * (big ? 1.2 : 1.0));
        var r = mk(box, "width:" + s + "px;height:" + s + "px;left:"
                   + (a.lx - s / 2) + "px;top:" + (a.ly - s / 2) + "px;"
                   + "border-radius:50%;border:2px solid " + rgba(color, 0.95)
                   + ";box-shadow:0 0 10px " + rgba(color, 0.9)
                   + ",inset 0 0 8px " + rgba(color, 0.7));
        anim(r, [{ transform: "scale(0.2)", opacity: 0.95 },
                 { transform: "scale(" + (big ? 3.4 : 2.6) + ")", opacity: 0 }],
             { duration: 520, delay: delay || 0,
               easing: "cubic-bezier(.1,.7,.3,1)" });
    }

    // vertical beam; arrive: grows then thins out, depart: collapses
    function beam(box, a, arrive)
    {
        var w = Math.max(6, a.cw * 0.8), h = a.ch * 5;
        var b = mk(box, "width:" + w + "px;height:" + h + "px;left:"
                   + (a.lx - w / 2) + "px;top:" + (a.ly - h / 2) + "px;"
                   + "mix-blend-mode:screen;background:linear-gradient("
                   + "to bottom, transparent, " + rgba(C_CYAN, 0.55) + " 38%, "
                   + "rgba(235,255,250,0.95) 50%, " + rgba(C_VIOLET, 0.55)
                   + " 62%, transparent)");
        var big = "scaleX(1) scaleY(1)", thin = "scaleX(0.08) scaleY(1.05)",
            flat = "scaleX(1) scaleY(0.04)";
        var f = arrive
            ? [{ transform: flat, opacity: 0 },
               { transform: big, opacity: 1, offset: 0.3 },
               { transform: thin, opacity: 0 }]
            : [{ transform: big, opacity: 0 },
               { transform: big, opacity: 0.9, offset: 0.15 },
               { transform: flat, opacity: 0 }];
        anim(b, f, { duration: arrive ? 480 : 380, easing: "ease-out" });
    }

    function sparkles(box, a, n, inward)
    {
        var sz = Math.max(3, Math.round(a.cw * 0.13));
        var cols = [C_VIOLET, C_CYAN, "235,255,250", C_GREEN];
        for (var i = 0; i < n; i++)
        {
            var ang = Math.random() * Math.PI * 2;
            var dist = a.cw * rnd(0.8, 2.3);
            var dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * 0.9;
            var col = cols[i % cols.length];
            var p = mk(box, "width:" + sz + "px;height:" + sz + "px;left:"
                       + (a.lx - sz / 2) + "px;top:" + (a.ly - sz / 2) + "px;"
                       + "background:" + rgba(col, 1) + ";box-shadow:0 0 6px "
                       + rgba(col, 0.9));
            var frames;
            if (inward)
            {
                frames = [
                    { transform: at(dx, dy) + "scale(1)", opacity: 0 },
                    { transform: at(dx * 0.6, dy * 0.6) + "scale(1)",
                      opacity: 1, offset: 0.4 },
                    { transform: at(0, 0) + "scale(0.3)", opacity: 0 }];
            }
            else
            {
                frames = [
                    { transform: at(0, 0) + "scale(1)", opacity: 1 },
                    { transform: at(dx * 0.4, dy * 0.4) + "scale(1)",
                      opacity: 1, offset: 0.15 },
                    { transform: at(dx, dy) + "rotate(" + rnd(-180, 180)
                                 + "deg) scale(0.3)", opacity: 0 }];
            }
            anim(p, frames, { duration: rnd(380, 620), delay: rnd(0, 140),
                              easing: "ease-out" });
        }
    }

    function afterimage(box, a)
    {
        var d = mk(box, "width:" + a.cw + "px;height:" + a.ch + "px;left:"
                   + (a.lx - a.cw / 2) + "px;top:" + (a.ly - a.ch / 2) + "px;"
                   + "box-sizing:border-box;border:1px solid " + rgba(C_CYAN, 0.9)
                   + ";background:" + rgba(C_GREEN, 0.22)
                   + ";box-shadow:0 0 10px " + rgba(C_CYAN, 0.7)
                   + ",inset 0 0 8px " + rgba(C_VIOLET, 0.6)
                   + ";mix-blend-mode:screen");
        anim(d, [{ transform: "scale(1.15)", opacity: 0.95 },
                 { transform: "scale(0.9,1.5)", opacity: 0.6, offset: 0.4 },
                 { transform: "scale(0.1,2.2)", opacity: 0 }],
             { duration: 440, easing: "ease-in" });
        ring(box, a, C_VIOLET, 0, false);
    }

    // Effect ------------------------------------------------------------------

    function play(kind, to, from)
    {
        if (!enabled()) return;
        api.emit("blink", kind, to || null, from || null);   // alive ripple
        var host = ensure_layer();
        var vr = view_rect();
        var tele = kind === "teleport";

        while (fx_list.length >= MAX_FX)
        {
            var old = fx_list.shift();
            if (old.parentNode) old.parentNode.removeChild(old);
        }
        var box = document.createElement("div");
        box.style.cssText = "position:absolute;overflow:hidden;"
            + "pointer-events:none;contain:strict;left:" + vr.left + "px;top:"
            + vr.top + "px;width:" + vr.width + "px;height:" + vr.height + "px";
        host.appendChild(box);
        fx_list.push(box);
        window.setTimeout(function () {
            if (box.parentNode) box.parentNode.removeChild(box);
            var i = fx_list.indexOf(box);
            if (i >= 0) fx_list.splice(i, 1);
        }, 1300);

        if (!box.animate)
            return;

        if (reduced())
        {
            var f = mk(box, "width:100%;height:100%;background:"
                       + rgba("190,255,230", 1));
            f.animate([{ opacity: 0 }, { opacity: 0.22, offset: 0.3 },
                       { opacity: 0 }], { duration: 320 });
            return;
        }

        function local(a)
        {
            if (!a) return null;
            return { lx: a.x - vr.left, ly: a.y - vr.top, cw: a.cw, ch: a.ch };
        }
        var A = local(anchor_of(to));
        var D = from ? local(anchor_of(from)) : null;
        var unit = Math.max(24, vr.width / 30);
        var C = A || { lx: vr.width / 2, ly: vr.height / 2, cw: unit,
                       ch: unit };

        if (tele)
        {
            sweep(box, vr);
            flash_full(box);
            rgb_split(box, C, true);
            tears(box, vr, 7, true);
        }
        else
        {
            rgb_split(box, C, false);
            tears(box, vr, 4, false, C.lx, C.ly, C.cw * 10);
            if (D)
                tears(box, vr, 2, false, D.lx, D.ly, D.cw * 7);
        }

        if (D)
        {
            afterimage(box, D);
            beam(box, D, false);
            sparkles(box, D, tele ? 8 : 6, true);
        }

        // arrival lags the departure a little
        window.setTimeout(function () {
            if (!box.parentNode) return;
            beam(box, C, true);
            ring(box, C, C_CYAN, 0, tele);
            ring(box, C, C_VIOLET, 90, tele);
            sparkles(box, C, tele ? 18 : 12, false);
        }, D ? 110 : 0);
    }

    // Triggering --------------------------------------------------------------

    function request(kind, strong, from, source)
    {
        if (!enabled()) return;
        dlog(dbg.log, source || "?", kind, strong ? "strong" : "weak");
        if (pending)
        {
            if (strong && !pending.strong)
            {
                pending.kind = kind;
                pending.strong = true;
            }
            if (from && !pending.from) pending.from = from;
            return;
        }
        pending = { kind: kind, strong: strong, from: from || null, timer: 0,
                    source: source || "?" };
        pending.timer = window.setTimeout(fire, 90);
    }

    function dist(a, b)
    {
        return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    }

    function fire()
    {
        var p = pending;
        pending = null;
        if (!p || !enabled()) return;
        var t = now();
        if (t - last_fire < (p.strong ? DEDUPE_STRONG : DEDUPE))
        {
            dlog(dbg.suppressed, p.source, p.kind, "dedupe");
            return;
        }
        var cur = player.pos ? { x: player.pos.x, y: player.pos.y } : null;

        var from = p.from;
        if (!from && cur)
        {
            for (var i = hist.length - 1; i >= 0; i--)
            {
                var h = hist[i];
                if (t - h.t > 1500) break;
                if (dist(h, cur) >= 2) { from = { x: h.x, y: h.y }; break; }
            }
        }
        if (!p.strong && !from)
        {
            dlog(dbg.suppressed, p.source, p.kind, "weak without jump");
            return;
        }     // weak hint (Tele light gone) without any jump
        last_fire = t;
        var kind = p.kind;
        if (!p.strong && from && cur)
            kind = dist(from, cur) > 12 ? "teleport" : "blink";
        play(kind, cur, from);
    }

    // game messages: [regex, kind]
    var MESSAGES = [
        [/^You blink\b/, "blink"],
        [/^You (?:are|feel) (?:suddenly )?(?:yanked|pulled|wrenched|warped)\b/,
         "blink"],
        [/^You shift (?:in|through) space\b/, "blink"],
        [/^Your surroundings (?:suddenly |slightly )?(?:seem|look|feel) (?:suddenly |slightly )?different/,
         "teleport"],
        [/^You are hurled (?:through space|out of the way)\b/, "blink"],
        [/^You perform a powerful leap\b/, "blink"],
        [/^You enter a teleport(?:ation)? trap\b/, "teleport"],
        [/^You are yanked forward\b/, "blink"],
        [/^The pull of .* song draws you forwards?\b/, "blink"],
        [/^You are (?:suddenly )?pulled into a different region\b/,
         "teleport"],
        [/^You are banished\b/, "teleport"],
        [/^Your surroundings flicker\b/, "teleport"],
        [/^You (?:feel )?(?:strangely )?disoriented\b/, "teleport"],
        [/^You are suddenly somewhere else\b/, "teleport"],
        [/^You (?:suddenly )?teleport\b/, "teleport"],
        [/^You (?:are|have been) (?:teleported|translocated)\b/, "teleport"],
    ];

    var recent_msg = {};      // sentence -> last handled time

    // A webtiles line can hold several messages ("You blink. The goblin hits
    // you."), so test every sentence, not just the start of the line.
    function handle_message(text)
    {
        text = String(text || "");
        if (text.trim())
        {
            // last messages seen: shows what text accompanies a missed blink
            dbg.msgs.push({ ts: Math.round(now()), text: text.slice(0, 160) });
            if (dbg.msgs.length > 30) dbg.msgs.shift();
        }
        var parts = text.split(/(?<=[.!?])\s+/);
        for (var j = 0; j < parts.length; j++)
        {
            // drop turn-marker glyphs / whitespace / nbsp in front
            var part = parts[j].replace(/^[^A-Za-z]+/, "");
            for (var i = 0; i < MESSAGES.length; i++)
            {
                if (!MESSAGES[i][0].test(part))
                    continue;
                var t = now();
                if (recent_msg[part] && t - recent_msg[part] < 800)
                {
                    dlog(dbg.suppressed, "msg", MESSAGES[i][1], "repeat");
                    return;
                }
                recent_msg[part] = t;
                request(MESSAGES[i][1], true, null, "msg");
                return;
            }
        }
    }

    function node_text(node)
    {
        var c = node.cloneNode(true);
        var g = c.querySelectorAll(".prefix_glyph");
        for (var i = 0; i < g.length; i++)
            g[i].parentNode.removeChild(g[i]);
        return (c.textContent || "").trim();
    }

    // game_message element -> text already handled. Only text that is new
    // since last time is tested, so cosmetic edits (the "_" turn marker),
    // merged lines and cloned nodes don't replay old effects.
    var seen_msg = window.WeakMap ? new WeakMap() : null;
    var in_grace = false;

    function process_msg(el, quiet)
    {
        var text = node_text(el);
        var old = seen_msg ? seen_msg.get(el) : undefined;
        if (old === text) return;
        if (seen_msg) seen_msg.set(el, text);
        if (quiet || in_grace) return;
        var fresh = (old !== undefined && text.indexOf(old) === 0)
                    ? text.slice(old.length) : text;
        handle_message(fresh);
    }

    function seed_all(root)
    {
        var all = root.querySelectorAll ? root.querySelectorAll(".game_message") : [];
        for (var i = 0; i < all.length; i++)
            process_msg(all[i], true);
    }

    function owner_msg(n)
    {
        var el = n.nodeType === 1 ? n : n.parentElement;
        return el && el.closest ? el.closest(".game_message") : null;
    }

    function on_message_nodes(records)
    {
        if (!enabled()) return;
        in_grace = now() - init_time < MSG_GRACE;
        if (in_grace)
            dlog(dbg.suppressed, "msg", "", "grace");
        records.forEach(function (r) {
            var own = owner_msg(r.target);
            if (own)
                process_msg(own);
            Array.prototype.forEach.call(r.addedNodes, function (node) {
                if (node.nodeType === 1)
                {
                    if (node.classList.contains("game_message"))
                        process_msg(node);
                    else if (node.id === "messages"
                             || node.querySelector(".game_message"))
                        seed_all(node);    // bulk re-insert (stock layout())
                    else if (own)
                        process_msg(own);
                }
                else if (own)
                    process_msg(own);
            });
        });
    }

    // Observe a stable ancestor: the stock layout() replaces #messages with
    // a clone, which would leave an observer on #messages itself pointing at
    // a detached element.
    function watch_messages()
    {
        if (msg_observer)
            msg_observer.disconnect();
        var el = document.getElementById("message_pane")
                 || document.getElementById("messages_container")
                 || document.getElementById("normal");
        if (!el || !window.MutationObserver) return;
        seed_all(el);
        msg_observer = new MutationObserver(on_message_nodes);
        msg_observer.observe(el, { childList: true, subtree: true });
    }

    // Position tracking ------------------------------------------------------

    // Every `pos` assignment (one per player message) is queued, so two
    // updates landing between two frames are both seen.
    function drain_pos()
    {
        var q = pos_queue;
        pos_queue = [];
        q.forEach(function (p) { track(p); });
    }

    function hook_pos()
    {
        try
        {
            var d = Object.getOwnPropertyDescriptor(player, "pos");
            if (d && d.get && d.get.sdc_blink) return;
            if (d && d.configurable === false) return;
            cur_pos_val = player.pos;
            var getter = function () { return cur_pos_val; };
            getter.sdc_blink = true;
            Object.defineProperty(player, "pos", {
                configurable: true, enumerable: true, get: getter,
                set: function (v) {
                    cur_pos_val = v;
                    if (v && typeof v.x === "number")
                    {
                        pos_queue.push({ x: v.x, y: v.y });
                        if (pos_queue.length === 1)
                        {
                            if (window.Promise)
                                window.Promise.resolve().then(drain_pos);
                            else
                                window.setTimeout(drain_pos, 0);
                        }
                    }
                }
            });
        }
        catch (e) { /* fall back to frame sampling */ }
    }

    function on_frame()
    {
        var pos = player.pos;
        if (pos && typeof pos.x === "number") track(pos);
    }

    function track(pos)
    {
        if (!pos || typeof pos.x !== "number") return;
        var t = now();
        var key = player.place + ":" + player.depth;
        if (key !== last_key)
        {
            last_key = key;
            key_time = t;
            hist = [];
            last_pos = null;
            streak = 0;
        }
        if (last_pos && (pos.x !== last_pos.x || pos.y !== last_pos.y))
        {
            var d = dist(pos, last_pos);
            var settled = t - key_time > SETTLE && t - init_time > MSG_GRACE;
            // Game time (tenths of aut) spent on this displacement: walking
            // costs >= ~5 per cell even when hasted, so covering d cells in
            // <= 3*d is not walking (a blink/teleport takes ~10 in total).
            // Batched travel/explore redraws cost ~10 per cell, so they fail
            // this test and are still ignored. Replaces the old "walking
            // streak" guard, which also swallowed a blink right after moving.
            var tm = player.time;
            var fast = typeof tm === "number" && typeof last_time === "number"
                       && tm - last_time <= d * 3;
            if (d >= JUMP_CELLS && settled
                && (fast || (typeof tm !== "number" && streak < 3)))
            {
                request(d > 12 ? "teleport" : "blink", false,
                        { x: last_pos.x, y: last_pos.y }, "jump");
            }
            else if (d >= JUMP_CELLS)
            {
                dlog(dbg.suppressed, "jump", "",
                     "streak=" + streak + " settled=" + settled + " d=" + d
                     + " dt=" + (typeof tm === "number"
                                 && typeof last_time === "number"
                                 ? tm - last_time : "?"));
            }
            if (d <= 2 && t - last_move_t < 160)
                streak++;
            else
                streak = 0;
            last_move_t = t;
            hist.push({ x: last_pos.x, y: last_pos.y, t: t });
            if (hist.length > 24) hist.shift();
        }
        last_pos = { x: pos.x, y: pos.y };
        last_time = typeof player.time === "number" ? player.time : null;
    }

    function on_hud_update(pl, prev)
    {
        if (!prev || !enabled()) return;
        if (now() - init_time < MSG_GRACE) return;
        if (has_light(prev.status, "Tele") && !has_light(pl.status, "Tele"))
            request("teleport", false, null, "tele-light");
    }

    // Lifecycle ---------------------------------------------------------------

    function clear_all()
    {
        if (pending && pending.timer)
            window.clearTimeout(pending.timer);
        pending = null;
        fx_list.forEach(function (b) {
            if (b.parentNode) b.parentNode.removeChild(b);
        });
        fx_list = [];
    }

    api.on("game_init", function () {
        clear_all();
        if (layer && layer.parentNode)
            layer.parentNode.removeChild(layer);
        layer = null;
        ensure_layer();
        init_time = now();
        hist = [];
        last_pos = null;
        last_key = null;
        streak = 0;
        pos_queue = [];
        hook_pos();
        watch_messages();
    });

    api.on("game_cleanup", function () {
        clear_all();
        if (msg_observer)
            msg_observer.disconnect();
        msg_observer = null;
        if (layer && layer.parentNode)
            layer.parentNode.removeChild(layer);
        layer = null;
    });

    api.on("frame", on_frame);
    api.on("hud_update", on_hud_update);

    // sdc_blink_test(kind, true): instead append real-looking messages
    // ("You blink." marked with "_", then a monster message) to #messages.
    window.sdc_blink_test = function (kind, via_messages)
    {
        kind = kind === "teleport" ? "teleport" : "blink";
        var box = document.getElementById("messages");
        if (via_messages && box)
        {
            var texts = [kind === "teleport"
                         ? "Your surroundings suddenly seem different."
                         : "You blink.", "The goblin hits you."];
            var els = texts.map(function (tx) {
                var d = document.createElement("div");
                d.className = "game_message";
                d.innerHTML = '<span class="prefix_glyph">&nbsp;</span>';
                d.appendChild(document.createTextNode(tx));
                box.appendChild(d);
                return d;
            });
            var g = els[0].querySelector(".prefix_glyph");
            if (g) g.textContent = "_";   // as new_command() would
            init_time = Math.min(init_time, now() - MSG_GRACE - 1);
            return;
        }
        var cur = player.pos ? { x: player.pos.x, y: player.pos.y } : null;
        var from = cur ? { x: cur.x - 4, y: cur.y - 1 } : null;
        last_fire = now();
        play(kind, cur, from);
    };

    return {};
});
