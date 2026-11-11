// Off-screen monster arrows: a small glowing chevron sits on the edge of the
// dungeon view pointing at each hostile monster that is in sight but outside
// the visible part of the map (close-up tile zoom, 2.5D zoom). Arrows follow
// the view every frame and vanish once the monster is on screen or out of
// sight.
//
// Setting: "offscreen_arrows" (on/off). Layer: #sdc_offscreen (fxkit.layer).
// Reduced motion: no pulse, plain fade-in.
// Debug (browser console): sdc_offscreen_debug.list()  current targets
//                          sdc_offscreen_debug.why()   per-monster reasoning
define(["./sdc_api", "./fxkit", "./map_knowledge", "./player"],
function (api, kit, map_knowledge, player) {
    "use strict";

    var SCAN_R = 9;          // cells around the player (LOS is at most 8)
    var MAX_ARROWS = 8;
    // stationary things auto-explore ignores
    var IGNORE = /\b(plant|fungus|toadstool|bush|briar patch|withered plant|demonic plant)s?\b/i;

    api.register_option({ key: "offscreen_arrows", label: "Off-screen monster arrows",
                          default: true,
                          choices: [[true, "On"], [false, "Off"]],
                          hint: ["Point at monsters outside a zoomed-in view",
                                 "Point at monsters outside a zoomed-in view"] });

    var pool = [];           // arrow elements, reused
    var targets = [];
    var why = null;          // last update's reasoning, for the debug hook

    function enabled() { return api.settings.offscreen_arrows !== false; }

    function hostiles()
    {
        var out = [];
        var p = player.pos;
        if (!p) return out;
        for (var y = p.y - SCAN_R; y <= p.y + SCAN_R; y++)
            for (var x = p.x - SCAN_R; x <= p.x + SCAN_R; x++)
            {
                var mc = map_knowledge.get(x, y);
                var mon = mc && mc.mon;
                if (!mon || !mon.name || mon.att) continue;   // 0 = hostile
                if (IGNORE.test(String(mon.name))) continue;
                if (!map_knowledge.visible(mc)) continue;     // remembered only
                out.push({ x: x, y: y, name: String(mon.name),
                           d: Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) });
            }
        out.sort(function (a, b) { return a.d - b.d; });
        return out;
    }

    function arrow(i)
    {
        var el = pool[i];
        var layer = kit.layer("offscreen");
        if (el && el.parentNode === layer) return el;
        el = document.createElement("div");
        el.className = "osa-arrow";
        el.innerHTML = '<div class="osa-in"><i></i><i></i></div>';
        layer.appendChild(el);
        pool[i] = el;
        return el;
    }

    function hide_from(n)
    {
        for (var i = n; i < pool.length; i++)
            if (pool[i]) pool[i].style.display = "none";
    }

    // Where the ray from the player to (mx, my) leaves box b (all flat
    // client px); null if the point is inside the box.
    function edge_point(px, py, mx, my, b)
    {
        if (mx >= b.l && mx <= b.r && my >= b.t && my <= b.b) return null;
        var dx = mx - px, dy = my - py, t = 1;
        if (dx > 0) t = Math.min(t, (b.r - px) / dx);
        if (dx < 0) t = Math.min(t, (b.l - px) / dx);
        if (dy > 0) t = Math.min(t, (b.b - py) / dy);
        if (dy < 0) t = Math.min(t, (b.t - py) / dy);
        t = Math.max(0, t);
        return { x: px + dx * t, y: py + dy * t };
    }

    // flat canvas px -> client px through the curved screen
    function client(r, x, y)
    {
        return kit.client_of((x - r.left) / r.width, (y - r.top) / r.height,
                             r, 1, 1);
    }

    // Does element el paint something (so it hides the dungeon under it)?
    // Transparent wrappers (button columns, gesture layers, ...) don't.
    // Cached per element for a second: computed style is not free.
    var paint_cache = new WeakMap();
    function painted(el, t)
    {
        var hit = paint_cache.get(el);
        if (hit && t - hit.t < 1000) return hit.v;
        var v = true;
        if (!/^(IMG|CANVAS|BUTTON|INPUT|TEXTAREA|SELECT|VIDEO|svg)$/.test(el.tagName))
        {
            var cs = window.getComputedStyle(el);
            var bg = cs.backgroundColor, m = /rgba?\(([^)]*)\)/.exec(bg);
            var alpha = m ? m[1].split(",") : [];
            var a = alpha.length > 3 ? parseFloat(alpha[3]) : (m ? 1 : 0);
            var text = false;
            for (var n = el.firstChild; n; n = n.nextSibling)
                if (n.nodeType === 3 && /\S/.test(n.nodeValue)) { text = true; break; }
            v = cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.05
                && (a > 0.05 || cs.backgroundImage !== "none" || text
                    || parseFloat(cs.borderTopWidth) > 0
                    || parseFloat(cs.borderBottomWidth) > 0);
        }
        paint_cache.set(el, { t: t, v: v });
        return v;
    }

    // Is the dungeon hidden at client point c by the HUD (quickbar, thumb
    // buttons, stats panel, message pane, ...)? Overlay layers have no
    // pointer events, so the elements at the point are, top down, maybe
    // some HUD and then the dungeon (its canvas, the GL screen or a
    // container holding them). Only HUD that paints counts.
    // HUD that hit testing can miss (pointer-events: none, or cropped with
    // clip-path, which also drops hits): the quickbar (stock canvas, its
    // DOM dock when god abilities share the bar, captions) and the big
    // thumb buttons. Their rects, refreshed twice a second.
    var PASSIVE_HUD = "#action-panel, #sdc_qb_dock .bg, #sdc_qb_dock .slot,"
                      + " #sdc_qb_caps, .sdc-m-big";
    var passive = [], passive_t = -1e9;
    function passive_rects(t)
    {
        if (t - passive_t < 500) return passive;
        passive_t = t;
        passive = [];
        var els = document.querySelectorAll(PASSIVE_HUD);
        for (var i = 0; i < els.length; i++)
        {
            var b = els[i].getBoundingClientRect();    // 0x0 when hidden
            if (b.width > 0 && b.height > 0) passive.push(b);
        }
        return passive;
    }

    function covered(c, t)
    {
        if (c.x < 0 || c.y < 0 || c.x >= window.innerWidth
            || c.y >= window.innerHeight) return true;
        var pr = passive_rects(t);
        for (var j = 0; j < pr.length; j++)
            if (c.x >= pr[j].left && c.x <= pr[j].right
                && c.y >= pr[j].top && c.y <= pr[j].bottom)
                return true;
        var d = document.getElementById("dungeon");
        var els = document.elementsFromPoint(c.x, c.y);
        for (var i = 0; i < els.length; i++)
        {
            var el = els[i];
            if (el.id === "sdc_screen" || el.id === "dungeon"
                || (d && el.contains(d)))
                return false;
            if (painted(el, t)) return true;
        }
        return false;
    }

    // Move edge point e toward the player (px, py) until the arrow (tip and
    // tail) is clear of the HUD. If it never is before 70% of the way, the
    // arrow stays at the innermost point tried (better partly hidden than
    // missing).
    function clear_of_hud(e, px, py, mx, my, r, size, t)
    {
        var dx = mx - px, dy = my - py, len = Math.sqrt(dx * dx + dy * dy);
        if (!(len > 0)) return null;
        var ux = dx / len, uy = dy / len, step = size * 0.5;
        var ex = e.x, ey = e.y;
        var max = Math.hypot(ex - px, ey - py) * 0.7;
        var x = ex, y = ey;
        for (var s = 0; s * step <= max; s++)
        {
            x = ex - ux * s * step;
            y = ey - uy * s * step;
            if (!covered(client(r, x + ux * size * 0.3, y + uy * size * 0.3), t)
                && !covered(client(r, x - ux * size * 1.2, y - uy * size * 1.2), t))
                return s ? { x: x - ux * step * 0.5, y: y - uy * step * 0.5 }
                         : { x: x, y: y };
        }
        return { x: x, y: y };
    }

    function update()
    {
        var t = kit.now();
        targets = [];
        var pp = enabled() && player.pos && kit.view_uv(player.pos);
        if (!pp) { why = { stop: "no view / off" }; hide_from(0); return; }
        var r = pp.r, vr = kit.view_rect();
        var size = Math.max(30, Math.min(42, pp.cw * 0.75));
        // visible part of the canvas: an arrow tip sits `inset` inside it,
        // and a monster whose tile centre is that far in counts as on screen
        var inset = size * 1.1;
        var vis = { l: vr.left, t: vr.top, r: vr.left + vr.width,
                    b: vr.top + vr.height };
        var box = { l: vis.l + inset, t: vis.t + inset,
                    r: vis.r - inset, b: vis.b - inset };
        if (box.r <= box.l || box.b <= box.t)
        {
            why = { stop: "tiny box", vis: vis };
            hide_from(0);
            return;
        }
        var px = r.left + pp.u * r.width, py = r.top + pp.v * r.height;
        var placed = [], n = 0, list = hostiles();
        why = { vis: vis, player: [Math.round(px), Math.round(py)], mons: [] };
        for (var i = 0; i < list.length && n < MAX_ARROWS; i++)
        {
            var m = kit.view_uv(list[i]);
            if (!m) continue;
            var mx = r.left + m.u * r.width, my = r.top + m.v * r.height;
            var half = Math.min(m.cw, m.ch) * 0.3;
            var w = { name: list[i].name, at: [Math.round(mx), Math.round(my)] };
            why.mons.push(w);
            if (mx >= vis.l + half && mx <= vis.r - half
                && my >= vis.t + half && my <= vis.b - half)
            {
                var cm = client(r, mx, my), top = document.elementFromPoint(cm.x, cm.y);
                w.top = top ? (top.id || top.tagName + "." + top.className) : null;
                if (!covered(cm, t)) { w.on_screen = true; continue; }
            }
            var e = edge_point(px, py, mx, my, box);
            if (!e) e = { x: Math.max(box.l, Math.min(box.r, mx)),
                          y: Math.max(box.t, Math.min(box.b, my)) };
            e = clear_of_hud(e, px, py, mx, my, r, size, t);
            if (!e) continue;
            // nearer monsters were placed first; skip arrows on top of them
            var dup = placed.some(function (q) {
                return Math.abs(q.x - e.x) < size && Math.abs(q.y - e.y) < size;
            });
            w.arrow = [Math.round(e.x), Math.round(e.y)];
            if (dup) { w.dup = true; continue; }
            placed.push(e);
            targets.push(list[i]);
            var c = client(r, e.x, e.y);
            var ang = Math.atan2(my - py, mx - px) * 180 / Math.PI;
            var el = arrow(n++);
            el.style.display = "";
            el.style.setProperty("--osa-s", size.toFixed(1) + "px");
            el.style.transform = "translate(" + c.x.toFixed(1) + "px,"
                                 + c.y.toFixed(1) + "px) rotate("
                                 + ang.toFixed(1) + "deg)";
            el.title = list[i].name;
        }
        hide_from(n);
    }

    // ~30 fps while the game view is visible; hidden views (map, menus)
    // stop the frames, so hide the arrows until they resume
    var stale = 0;
    api.on("frame", function () {
        update();
        window.clearTimeout(stale);
        stale = window.setTimeout(function () { hide_from(0); }, 250);
    });
    api.on("setting", function (key) {
        if (key === "offscreen_arrows" && !enabled()) hide_from(0);
    });
    api.on("game_init", function () { pool = []; });
    api.on("game_cleanup", function () { hide_from(0); pool = []; });

    window.sdc_offscreen_debug = {
        list: function () { return targets.slice(); },
        why: function () { return JSON.stringify(why); },
    };

    return { update: update };
});
