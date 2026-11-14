// Orb menu (mobile): long-press your own character to open a ring of orbs
// around it. Styles live in orbmenu.css.
//
//   inner ring   the user's orbs (default: the Spells, Evoke and Abilities
//                categories, then Pick up, Map, Rest, Look) and an edit
//                orb (+). Every orb but + can be removed, moved or replaced.
//   outer ring   sliding onto a category fans its items out around it:
//                memorised spells (z + letter), evocable items (V + letter)
//                or abilities (a + letter), plus a "menu" orb that opens the
//                stock z / V / a menu.
//
// Gesture: keep the finger down after the long-press and slide onto an orb;
// lifting on a spell / item / ability / action uses it. Lifting without
// having left the character (or on a category) leaves the menu open for
// taps; a tap on empty space, the back button or another long-press closes
// it. In tap mode, long-pressing an inner-ring orb opens the editor with
// that orb picked for replacement.
//
// Data: player.spells, player.talents (every ability) and player.evokables
// come from the locally patched crawl binary (webtiles-spells.patch).
// Older binaries: the Spells orb opens the stock z menu, Abilities lists the
// god invocations (player.abilities, webtiles-abilities.patch) and Evoke
// guesses from the inventory (wands, misc evokers, baubles).
//
// Always on in the mobile UI. Option: "orb_items" [{cat} | {label, keys}]
// (edited from the + orb; replaces the old "orb_actions"). Keys use
// the mobile.js key spec (Tab, Esc, Enter, Space, Bksp, Ctrl+X, or
// characters).
//
// The long-press reaches this module through api.hold() (mobile.js asks
// every claimant before it sends the stock describe).
//
// Debug: sdc_orbmenu_test() opens the menu (fake spells if the binary sends
// none; their activation is only logged), sdc_orbmenu_test(false) closes it.
define(["jquery", "comm", "client", "./sdc_api", "./player", "./enums",
        "./options", "./cell_renderer", "./util", "./fxkit"],
function ($, comm, client, api, player, enums, options, cr, util, fxkit) {
    "use strict";

    // the old on/off option ("orb_menu") is gone: drop a stored choice
    if ("orb_menu" in api.settings)
    {
        delete api.settings.orb_menu;
        api.save();
    }
    // category orbs: a sub-ring of spells / evocables / abilities, or the
    // stock menu key when the binary sends no list
    var CATS = {
        spells: { label: "Spells", glyph: "✶", fallback: "z" },
        evoke: { label: "Evoke", glyph: "⚡", fallback: "V" },
        abilities: { label: "Abilities", glyph: "☼", fallback: "a" },
    };
    var CAT_ORDER = ["spells", "evoke", "abilities"];
    var DEFAULT_ITEMS = [{ cat: "spells" }, { cat: "evoke" },
                         { cat: "abilities" },
                         { label: "Pick up", keys: "g" },
                         { label: "Map", keys: "X" },
                         { label: "Rest", keys: "5" },
                         { label: "Look", keys: "x" }];
    // older versions kept only the action orbs, in "orb_actions"
    if (!("orb_items" in api.settings)
        && Array.isArray(api.settings.orb_actions))
    {
        api.settings.orb_items = DEFAULT_ITEMS.slice(0, 3)
            .concat(api.settings.orb_actions);
        delete api.settings.orb_actions;
        api.save();
    }
    api.register_option({ key: "orb_items", default: DEFAULT_ITEMS });

    // one-tap additions in the editor
    var PRESETS = [
        ["Pick up", "g"], ["Map", "X"], ["Rest", "5"], ["Wait", "s"],
        ["Look", "x"], ["Travel", "G"], ["Explore", "o"], ["Fight", "Tab"],
        ["Fire", "f"], ["Quaff", "q"], ["Read", "r"],
        ["Inventory", "i"], ["Find", "Ctrl+F"], ["Up <", "<"],
        ["Down >", ">"], ["Pray", "p"], ["Character", "%"],
    ];

    var NAMED = { tab: 9, esc: 27, escape: 27, enter: 13, ret: 13,
                  space: 32, bksp: 8, backspace: 8 };

    var GOD_COLOURS = {
        "Zin": "#ffffff", "The Shining One": "#ffe866", "Kikubaaqudgha": "#c06cff",
        "Yredelemnul": "#d04040", "Xom": "#ff66cc", "Vehumet": "#66b3ff",
        "Okawaru": "#ffbf47", "Makhleb": "#ff5533", "Sif Muna": "#5c8cff",
        "Trog": "#ff4040", "Nemelex Xobeh": "#cc66ff", "Elyvilon": "#ffffff",
        "Lugonu": "#b04cff", "Beogh": "#ff8c40", "Jiyva": "#7cff5c",
        "Fedhas": "#a8e04c", "Cheibriados": "#e0c070", "Ashenzari": "#c0a0ff",
        "Dithmenos": "#9a9ab0", "Qazlal": "#ffaa55", "Ru": "#ffbf47",
        "Gozag": "#ffd700", "Hepliaklqana": "#66e0ff", "Uskayaw": "#ff6fa8",
        "Wu Jian": "#ffd27a", "Ignis": "#ff7a2e",
    };

    var SLACK = 10;         // px around an orb that still counts as on it
    var REPLACE_MS = 550;   // long-press on a ring orb: replace it

    // menu state while open
    var m = null;
    var fake_spells = null, fake_evok = null;

    // Keys ---------------------------------------------------------------------

    function send_keys(spec)
    {
        String(spec || "").trim().split(/\s+/).forEach(function (tok) {
            if (!tok) return;
            var named = NAMED[tok.toLowerCase()];
            var ctrl = /^ctrl\+(.)$/i.exec(tok);
            if (named)
                comm.send_message("key", { keycode: named });
            else if (ctrl)
                comm.send_message("key", {
                    keycode: ctrl[1].toUpperCase().charCodeAt(0) - 64 });
            else
            {
                for (var i = 0; i < tok.length; i++)
                    comm.send_message("input", { text: tok.charAt(i) });
            }
        });
    }

    function buzz(ms)
    {
        try
        {
            if (navigator.vibrate) navigator.vibrate(ms || 8);
        }
        catch (e) { /* vibration blocked or unsupported: just skip it */ }
    }

    function command_mode()
    {
        if (client.is_watching && client.is_watching()) return false;
        var g = window.game;
        return !(g && typeof g.get_input_mode === "function"
                 && g.get_input_mode() !== enums.mouse_mode.COMMAND);
    }

    // the user's inner ring: {cat} and {label, keys} entries
    function actions()
    {
        var a = api.get("orb_items");
        if (!Array.isArray(a)) return DEFAULT_ITEMS.slice();
        return a.filter(function (x) {
            return x && (x.cat ? CATS[x.cat] : x.keys);
        });
    }

    function entry_label(a)
    {
        return a.cat ? CATS[a.cat].label : (a.label || a.keys);
    }

    function spell_list()
    {
        var s = fake_spells || player.spells;
        if (!Array.isArray(s)) return null;     // binary without the patch
        return s.filter(function (x) { return x && x.name; });
    }

    // every ability (player.talents); older binaries send only the god
    // invocations (player.abilities)
    function ability_list()
    {
        var a = Array.isArray(player.talents) ? player.talents
            : player.abilities;
        if (!Array.isArray(a)) return [];
        return a.filter(function (x) { return x && x.name; });
    }

    // evocable inventory items (player.evokables); without them, guess from
    // the inventory: wands, misc evokers and baubles (object_class_type)
    var EVOKE_TYPES = { 3: 1, 11: 1, 19: 1 };
    function evoke_list()
    {
        var e = fake_evok || player.evokables;
        if (Array.isArray(e))
            return e.filter(function (x) { return x && x.name && x.key; });
        var out = [];
        Object.keys(player.inv || {}).forEach(function (k) {
            var it = player.inv[k], i = Number(k);
            if (!it || !it.quantity || !EVOKE_TYPES[it.base_type]
                || !(i >= 0 && i < 52)) return;
            out.push({ key: String.fromCharCode(i < 26 ? 97 + i : 39 + i),
                       name: it.name || "item", usable: !it.useless });
        });
        out.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
        return out;
    }

    function god_colour()
    {
        return GOD_COLOURS[String(player.god || "")] || "#ffbf47";
    }

    // "Magic Dart" -> "MD", "Rest" -> "Re"
    function glyph(name)
    {
        // items: "wand of flame (6)" -> "Fl", not "WO"
        var n = String(name).replace(/\(.*?\)/g, " ");
        var of = n.lastIndexOf(" of ");
        if (of >= 0 && n.slice(of + 4).trim()) n = n.slice(of + 4);
        var w = n.replace(/[<>]/g, " ").split(/\s+/)
            .filter(Boolean);
        if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
        var s = w[0] || String(name).trim() || "?";
        return s[0].toUpperCase() + (s[1] || "");
    }

    // Menu model -----------------------------------------------------------------

    // inner ring entries: {kind: "cat"|"act"|"edit", ...}
    function root_items()
    {
        var items = [];
        actions().forEach(function (a) {
            if (a.cat)
            {
                var c = CATS[a.cat];
                var it = { kind: "cat", id: a.cat, label: c.label,
                           glyph: c.glyph, fallback: c.fallback,
                           god: a.cat === "abilities"
                                && !!player.god && player.god !== "No God" };
                // known to be empty (no spells, nothing to evoke): dimmed
                var sub = sub_items(it);
                if (sub && sub.length <= 1) it.usable = false;
                items.push(it);
                return;
            }
            items.push({ kind: "act", label: a.label || a.keys,
                         keys: a.keys, glyph: glyph(a.label || a.keys) });
        });
        items.push({ kind: "edit", label: "Edit", glyph: "+" });
        return items;
    }

    function sub_of(kind, x)
    {
        return { kind: kind, label: x.name, key: x.key, fail: x.fail,
                 mp: x.mp, usable: x.usable !== false, tile: x.tile,
                 tex: x.tex, glyph: glyph(x.name), god: !!x.god };
    }

    // outer ring entries of a category, ending in an orb for the stock menu;
    // null = the binary sends no list (the category orb opens that menu)
    function sub_items(cat)
    {
        var list, kind, menu;
        if (cat.id === "spells")
        {
            list = spell_list(); kind = "spell"; menu = "Spell menu";
        }
        else if (cat.id === "evoke")
        {
            list = evoke_list(); kind = "evoke"; menu = "Evoke menu";
        }
        else
        {
            list = ability_list(); kind = "ability"; menu = "All abilities";
            // old binary: god abilities only, so never "known empty"
            if (!Array.isArray(player.talents) && !list.length) return null;
        }
        if (!list) return null;
        return list.map(function (x) { return sub_of(kind, x); })
            .concat([{ kind: "menu", label: menu, keys: cat.fallback,
                       glyph: "☰" }]);
    }

    // Layout ---------------------------------------------------------------------

    function sizes(n_root)
    {
        var w = window.innerWidth, h = window.innerHeight;
        var short = Math.min(w, h);
        var S = Math.round(Math.max(44, Math.min(60, short * 0.13)));
        var R = Math.max(short * 0.19, S * 1.15,
                         n_root * (S + 10) / (2 * Math.PI));
        var s = Math.round(S * 0.82);
        var R2 = R + S / 2 + s / 2 + 12;
        return { S: S, R: R, s: s, R2: R2 };
    }

    // angles (radians, 0 = right, clockwise on screen) for n items fanned
    // around `mid` on rings starting at radius r0; returns [{a, r}]
    function fan(n, mid, r0, size)
    {
        var out = [];
        var r = r0, left = n;
        while (left > 0)
        {
            var step = (size + 6) / r;
            var cap = Math.max(1, Math.floor(2 * Math.PI / step));
            var k = Math.min(left, cap);
            if (k === cap) step = 2 * Math.PI / k;
            var a0 = mid - step * (k - 1) / 2;
            for (var i = 0; i < k; i++)
                out.push({ a: a0 + step * i, r: r });
            left -= k;
            r += size + 6;
        }
        return out;
    }

    function clamp(v, lo, hi)
    {
        return lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
    }

    // Icons ------------------------------------------------------------------------

    function has_tile(it)
    {
        return typeof it.tile === "number" && it.tile >= 0
               && typeof it.tex === "number"
               && options.get("tile_display_mode") === "tiles";
    }

    function draw_tile(canvas, it)
    {
        var r = new cr.DungeonCellRenderer();
        util.init_canvas(canvas, r.cell_width, r.cell_height);
        canvas.style.width = "";
        canvas.style.height = "";
        r.init(canvas);
        r.draw_from_texture(it.tile, 0, 0, it.tex, 0, 0, undefined, false);
    }

    function make_orb(it, cls, size)
    {
        var el = document.createElement("div");
        el.className = "sdc-orb " + cls + " sdc-orb-" + it.kind;
        el.style.width = el.style.height = size + "px";
        var face = document.createElement("span");
        face.className = "sdc-orb-face";
        var drawn = false;
        if (has_tile(it))
        {
            var c = document.createElement("canvas");
            c.className = "sdc-orb-ic";
            face.appendChild(c);
            try { draw_tile(c, it); drawn = true; }
            catch (e) { face.removeChild(c); }   // tiles not ready: glyph
        }
        if (!drawn)
        {
            var g = document.createElement("span");
            g.className = "sdc-orb-gl";
            g.style.fontSize = Math.round(size * (it.glyph.length > 1
                                                  ? 0.36 : 0.5)) + "px";
            g.textContent = it.glyph;
            face.appendChild(g);
        }
        el.appendChild(face);
        if (it.key)
        {
            var k = document.createElement("span");
            k.className = "sdc-orb-key";
            k.textContent = it.key;
            el.appendChild(k);
        }
        if (it.fail > 0)
        {
            var f = document.createElement("span");
            f.className = "sdc-orb-fail";
            f.textContent = it.fail + "%";
            el.appendChild(f);
        }
        if (cls === "sdc-orb-root")
        {
            var l = document.createElement("span");
            l.className = "sdc-orb-lbl";
            l.textContent = it.label;
            el.appendChild(l);
        }
        if (it.usable === false)
            el.classList.add("sdc-orb-off");
        if (it.god)
            el.style.setProperty("--sdc-orb-god", god_colour());
        return el;
    }

    function place(el, cx, cy, dx, dy, i)
    {
        el.style.left = cx + "px";
        el.style.top = cy + "px";
        el.style.setProperty("--dx", dx.toFixed(1) + "px");
        el.style.setProperty("--dy", dy.toFixed(1) + "px");
        el.style.setProperty("--i", i);
    }

    // Open / close ---------------------------------------------------------------

    function player_point()
    {
        var a = fxkit.anchor_of(player.pos);
        return a && isFinite(a.x) && isFinite(a.y) ? a : null;
    }

    // api.hold claimant: a long-press on (or right next to) the player
    function on_hold(x, y)
    {
        if (!document.body.classList.contains("sdc-mobile")) return false;
        if (!command_mode()) return false;
        var a = player_point();
        if (!a) return false;
        var reach = Math.max(28, Math.max(a.cw, a.ch) * 0.8);
        if (Math.hypot(x - a.x, y - a.y) > reach) return false;
        open(a, true);
        return true;
    }

    function open(a, dragging)
    {
        close();
        var items = root_items();
        var z = sizes(items.length);
        // the deepest fan decides how much room the menu needs
        var deepest = 0;
        items.forEach(function (it) {
            if (it.kind !== "cat") return;
            var sub = sub_items(it);
            if (!sub) return;
            var f = fan(sub.length, 0, z.R2, z.s);
            deepest = Math.max(deepest, f[f.length - 1].r);
        });
        var need = Math.max(z.R + z.S / 2 + 16, deepest + z.s / 2 + 6);
        var w = window.innerWidth, h = window.innerHeight;
        var cx = clamp(a.x, need, w - need);
        var cy = clamp(a.y, need, h - need);

        var root = document.createElement("div");
        root.id = "sdc_orb";
        root.className = "sdc-orb-in";
        var core = document.createElement("div");
        core.className = "sdc-orb-core";
        core.style.left = a.x + "px";
        core.style.top = a.y + "px";
        core.style.width = core.style.height
            = Math.round(Math.max(a.cw, a.ch, 24) * 1.2) + "px";
        root.appendChild(core);
        var cap = document.createElement("div");
        cap.className = "sdc-orb-cap";
        root.appendChild(cap);

        m = { el: root, cap: cap, cx: cx, cy: cy, px: a.x, py: a.y,
              z: z, roots: [], subs: [], open_cat: null, hot: null,
              dragging: !!dragging, left_core: false, editing: false };

        var step = 2 * Math.PI / items.length;
        items.forEach(function (it, i) {
            var ang = -Math.PI / 2 + step * i;
            var el = make_orb(it, "sdc-orb-root", z.S);
            var dx = Math.cos(ang) * z.R, dy = Math.sin(ang) * z.R;
            place(el, cx, cy, dx, dy, i);
            root.appendChild(el);
            // idx: position in orb_items (the edit orb has none)
            m.roots.push({ it: it, el: el, x: cx + dx, y: cy + dy,
                           r: z.S / 2, ang: ang,
                           idx: it.kind === "edit" ? -1 : i });
        });

        document.body.appendChild(root);
        void root.offsetWidth;
        root.classList.remove("sdc-orb-in");
        document.body.classList.add("sdc-orb-open");
        caption(null);
    }

    function close()
    {
        if (!m) return;
        clearTimeout(m.press);
        $(m.el).remove();
        m = null;
        $("#sdc_orb_edit").remove();
        document.body.classList.remove("sdc-orb-open");
    }

    function expand(entry)
    {
        if (m.open_cat === entry) return;
        m.subs.forEach(function (s) { $(s.el).remove(); });
        m.subs = [];
        m.roots.forEach(function (r) {
            r.el.classList.toggle("sdc-orb-open", r === entry);
        });
        m.open_cat = entry;
        var list = entry && sub_items(entry.it);
        if (!list) return;
        var z = m.z;
        fan(list.length, entry.ang, z.R2, z.s).forEach(function (p, i) {
            var it = list[i];
            var el = make_orb(it, "sdc-orb-sub sdc-orb-in", z.s);
            var dx = Math.cos(p.a) * p.r, dy = Math.sin(p.a) * p.r;
            // grow out of the category orb
            place(el, m.cx, m.cy, dx, dy, i);
            el.style.setProperty("--ox", (entry.x - m.cx - dx).toFixed(1) + "px");
            el.style.setProperty("--oy", (entry.y - m.cy - dy).toFixed(1) + "px");
            m.el.appendChild(el);
            m.subs.push({ it: it, el: el, x: m.cx + dx, y: m.cy + dy,
                          r: z.s / 2 });
        });
        void m.el.offsetWidth;
        m.subs.forEach(function (s) { s.el.classList.remove("sdc-orb-in"); });
    }

    function caption(entry)
    {
        var it = entry && entry.it;
        if (!it)
        {
            m.cap.style.display = "none";
            return;
        }
        var bits = [];
        if (it.mp) bits.push(it.mp + " MP");
        if (it.kind === "spell" || it.kind === "ability")
            bits.push(it.fail > 0 ? it.fail + "% fail" : "no fail");
        if (it.usable === false)
            bits.push(it.kind === "cat" ? "none" : "unusable");
        if (it.kind === "act") bits.push(it.keys);
        m.cap.textContent = "";
        var b = document.createElement("b");
        b.textContent = it.label;
        m.cap.appendChild(b);
        if (bits.length)
        {
            var s = document.createElement("span");
            s.textContent = bits.join(" · ");
            m.cap.appendChild(s);
        }
        m.cap.style.display = "block";
        // just outside the menu: above it, or below when that runs off the
        // top of the screen
        var outer = m.z.R + m.z.S / 2 + 16;
        m.subs.forEach(function (s) {
            outer = Math.max(outer, Math.hypot(s.x - m.cx, s.y - m.cy)
                                    + s.r + 10);
        });
        var above = m.cy - outer - 6;
        var below = above - m.cap.offsetHeight < 4;
        m.cap.style.left = clamp(m.cx, m.cap.offsetWidth / 2 + 4,
                                 window.innerWidth - m.cap.offsetWidth / 2 - 4)
                           + "px";
        m.cap.style.top = (below ? m.cy + outer + 6 : above) + "px";
        m.cap.classList.toggle("sdc-orb-cap-below", below);
    }

    // Hit testing / hover -------------------------------------------------------

    function hit(x, y)
    {
        var best = null, bd = 1e9;
        m.subs.concat(m.roots).forEach(function (o) {
            var d = Math.hypot(x - o.x, y - o.y);
            if (d < o.r + SLACK && d < bd) { best = o; bd = d; }
        });
        return best;
    }

    function hover(x, y)
    {
        var o = hit(x, y);
        if (Math.hypot(x - m.px, y - m.py) > m.z.R * 0.5) m.left_core = true;
        if (o === m.hot) return o;
        if (m.hot) m.hot.el.classList.remove("sdc-orb-hot", "sdc-orb-hold");
        m.hot = o;
        if (o)
        {
            o.el.classList.add("sdc-orb-hot");
            buzz(6);
            if (o.it.kind === "cat") expand(o);
        }
        caption(o);
        return o;
    }

    function refuse(o)
    {
        o.el.classList.remove("sdc-orb-nope");
        void o.el.offsetWidth;
        o.el.classList.add("sdc-orb-nope");
        buzz(30);
    }

    // finger lifted on `o` (null = nothing)
    function release(o)
    {
        if (!o)
        {
            // a plain long-press: stay open for taps
            if (m.dragging && !m.left_core) { m.dragging = false; return; }
            close();
            return;
        }
        var it = o.it;
        if (it.kind === "cat")
        {
            if (!sub_items(it)) { close(); send_keys(it.fallback); return; }
            expand(o);
            m.dragging = false;
            return;
        }
        if (it.kind === "edit") { open_editor(); return; }
        var prefix = { spell: "z", ability: "a", evoke: "V" }[it.kind];
        if (prefix && (!it.usable || !it.key))
        {
            refuse(o);
            m.dragging = false;
            return;
        }
        if (!command_mode()) { close(); return; }
        close();
        buzz(14);
        var keys = prefix ? prefix + it.key : it.keys;
        if (fake_spells && prefix)
        {
            // debug lists never reach the game
            if (window.console) console.log("sdc orbmenu test: " + keys);
            return;
        }
        send_keys(keys);
    }

    // Touch (and mouse, for desktop testing) -----------------------------------

    function pt(ev)
    {
        var t = (ev.changedTouches && ev.changedTouches[0])
            || (ev.touches && ev.touches[0]) || ev;
        return [t.clientX, t.clientY];
    }

    function in_editor(ev)
    {
        return !!(ev.target && ev.target.closest
                  && ev.target.closest("#sdc_orb_edit"));
    }

    function on_start(ev)
    {
        if (!m || in_editor(ev)) return;
        if (ev.cancelable) ev.preventDefault();
        ev.stopPropagation();
        if (m.editing) { close_editor(); return; }
        m.dragging = true;
        clearTimeout(m.press);
        m.press = 0;
        m.left_core = true;     // a fresh tap: lifting on nothing closes
        var p = pt(ev);
        var o = hover(p[0], p[1]);
        // long-press an inner-ring orb (a fresh touch, not the slide from
        // the character): replace it in the editor
        if (o && o.idx >= 0)
        {
            o.el.classList.add("sdc-orb-hold");
            m.press = setTimeout(function () {
                if (!m || m.hot !== o || !m.dragging) return;
                o.el.classList.remove("sdc-orb-hold");
                buzz(20);
                open_editor(o.idx);
            }, REPLACE_MS);
        }
    }

    function on_move(ev)
    {
        if (!m || !m.dragging || in_editor(ev)) return;
        if (ev.cancelable) ev.preventDefault();
        var p = pt(ev);
        hover(p[0], p[1]);
    }

    function on_end(ev)
    {
        if (!m || !m.dragging || in_editor(ev)) return;
        if (ev.cancelable) ev.preventDefault();
        ev.stopPropagation();
        clearTimeout(m.press);
        if (ev.type === "touchcancel") { close(); return; }
        var p = pt(ev);
        var o = hover(p[0], p[1]);
        if (o) o.el.classList.remove("sdc-orb-hold");
        release(o);
    }

    var topts = { capture: true, passive: false };
    document.addEventListener("touchstart", on_start, topts);
    document.addEventListener("touchmove", on_move, topts);
    document.addEventListener("touchend", on_end, topts);
    document.addEventListener("touchcancel", on_end, topts);
    // mouse: only once the menu is up (desktop testing); no drag-open
    document.addEventListener("mousedown", function (ev) {
        if (m && !in_editor(ev) && ev.target.closest
            && ev.target.closest("#sdc_orb")) on_start(ev);
    }, true);
    document.addEventListener("mousemove", function (ev) {
        if (m && m.dragging && !in_editor(ev)) on_move(ev);
    }, true);
    document.addEventListener("mouseup", function (ev) {
        if (m && m.dragging && !in_editor(ev)) on_end(ev);
    }, true);
    document.addEventListener("keydown", function (ev) {
        if (m && !m.editing && ev.key === "Escape") { close(); ev.preventDefault(); }
    }, true);

    // Editor -----------------------------------------------------------------------

    function stop(ev) { ev.stopPropagation(); }

    // sel: index of the orb to replace (long-press in the ring), or none
    function open_editor(sel)
    {
        if (!m) return;
        clearTimeout(m.press);
        m.editing = true;
        m.dragging = false;
        ed_sel = typeof sel === "number" ? sel : -1;
        m.el.classList.add("sdc-orb-dim");
        caption(null);
        $("#sdc_orb_edit").remove();
        var p = $("<div id='sdc_orb_edit' class='sdc-panel'>")
            .on("keydown keypress keyup input", stop)
            .appendTo(document.body);
        render_editor(p);
    }

    function close_editor()
    {
        $("#sdc_orb_edit").remove();
        if (!m) return;
        // rebuild the ring with the new actions, same spot
        var a = { x: m.px, y: m.py, cw: 0, ch: 0 };
        var pa = player_point();
        if (pa) a = pa;
        open(a, false);
    }

    // editor selection: index of the orb being replaced, or -1 (add)
    var ed_sel = -1;

    function set_actions(list)
    {
        api.set("orb_items", list);
        render_editor($("#sdc_orb_edit"));
    }

    // add an entry, or put it in place of the selected one
    function put(entry)
    {
        var l = actions().slice();
        if (ed_sel >= 0 && ed_sel < l.length) l[ed_sel] = entry;
        else l.push(entry);
        ed_sel = -1;
        set_actions(l);
    }

    function chip(text, cls, fn)
    {
        return $("<button type='button'>").addClass("sdc-orb-chip " + (cls || ""))
            .text(text)
            .on("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                fn();
            });
    }

    function render_editor(p)
    {
        if (!p.length) return;
        p.empty();
        var list = actions();
        if (ed_sel >= list.length) ed_sel = -1;
        $("<div class='sdc-orb-ed-h'>")
            .text("Orbs — tap one here to replace it").appendTo(p);
        var cur = $("<div class='sdc-orb-ed-row'>").appendTo(p);
        list.forEach(function (a, i) {
            var c = $("<span class='sdc-orb-chip sdc-orb-ed-cur'>")
                .toggleClass("sdc-orb-ed-cat", !!a.cat)
                .toggleClass("sdc-orb-ed-sel", i === ed_sel);
            if (i > 0)
            {
                c.append(chip("‹", "sdc-orb-ed-mv", function () {
                    var l = actions().slice();
                    var t = l[i - 1]; l[i - 1] = l[i]; l[i] = t;
                    ed_sel = -1;
                    set_actions(l);
                }).attr("aria-label", "Move left"));
            }
            c.append(chip(a.cat ? CATS[a.cat].glyph + " " + entry_label(a)
                                : entry_label(a), "sdc-orb-ed-name",
                          function () {
                              ed_sel = ed_sel === i ? -1 : i;
                              render_editor(p);
                          }).attr("aria-label", "Replace"));
            if (!a.cat) c.append($("<i>").text(a.keys));
            c.append(chip("×", "sdc-orb-ed-mv sdc-orb-ed-x", function () {
                var l = actions().slice();
                l.splice(i, 1);
                ed_sel = -1;
                set_actions(l);
            }).attr("aria-label", "Remove"));
            cur.append(c);
        });
        if (!list.length)
            cur.append($("<span class='sdc-orb-ed-none'>").text("none"));

        $("<div class='sdc-orb-ed-h'>")
            .text(ed_sel >= 0 ? "Replace " + entry_label(list[ed_sel])
                                + " with" : "Add").appendTo(p);
        var pre = $("<div class='sdc-orb-ed-row'>").appendTo(p);
        // missing categories first, so Spells / Evoke / Abilities can
        // always come back
        CAT_ORDER.forEach(function (id) {
            if (list.some(function (a) { return a.cat === id; })) return;
            pre.append(chip(CATS[id].glyph + " " + CATS[id].label,
                            "sdc-orb-ed-pre sdc-orb-ed-cat",
                            function () { put({ cat: id }); }));
        });
        PRESETS.forEach(function (ps) {
            var have = list.some(function (a) { return a.keys === ps[1]; });
            if (have) return;
            pre.append(chip(ps[0], "sdc-orb-ed-pre", function () {
                put({ label: ps[0], keys: ps[1] });
            }));
        });

        var form = $("<form class='sdc-orb-ed-form'>").appendTo(p);
        var label = $("<input type='text' placeholder='Label' maxlength='12'>");
        var keys = $("<input type='text' placeholder='Keys, e.g. za or Ctrl+F'>");
        form.append(label, keys,
                    $("<button type='submit' class='sdc-orb-chip'>").text("Add"));
        form.find("input").attr({ autocomplete: "off", autocapitalize: "off",
                                  autocorrect: "off", spellcheck: "false" });
        form.on("submit", function (ev) {
            ev.preventDefault();
            var l = label.val().trim(), k = keys.val().trim();
            if (!k) return;
            put({ label: l || k, keys: k });
        });

        $("<div class='sdc-orb-ed-hint'>").text(
            "Tip: in the ring, long-press an orb to replace it.").appendTo(p);
        var foot = $("<div class='sdc-orb-ed-row sdc-orb-ed-foot'>").appendTo(p);
        foot.append(chip("Reset", "sdc-orb-ed-ghost", function () {
            ed_sel = -1;
            set_actions(DEFAULT_ITEMS.slice());
        }), chip("Done", "", close_editor));
    }

    // Wiring -----------------------------------------------------------------------

    api.on_hold(on_hold);

    // the Android back button closes the menu first
    var prev_back = null;
    function hook_back()
    {
        if (window.sdcBack === back) return;
        prev_back = window.sdcBack;
        window.sdcBack = back;
    }
    function back()
    {
        if (m)
        {
            if (m.editing) close_editor(); else close();
            return true;
        }
        return prev_back ? prev_back.apply(this, arguments) : false;
    }

    api.on("game_init", function () { close(); hook_back(); });
    api.on("game_cleanup", close);
    api.on("setting", function (key) {
        if (key === "mobile") close();
    });
    $(window).on("resize orientationchange", function () {
        if (m && !m.editing) close();
    });

    window.sdc_orbmenu_test = function (show) {
        if (show === false)
        {
            fake_spells = fake_evok = null;
            close();
            return;
        }
        if (!Array.isArray(player.evokables))
        {
            fake_evok = [{ key: "e", name: "wand of flame (6)" },
                         { key: "f", name: "wand of digging (3)" },
                         { key: "k", name: "phial of floods",
                           usable: false }];
        }
        if (!Array.isArray(player.spells))
        {
            fake_spells = ["Magic Dart", "Foxfire", "Blink", "Freeze",
                           "Call Imp", "Sting", "Mephitic Cloud",
                           "Iskenderun's Mystic Blast", "Swiftness"]
                .map(function (n, i) {
                    return { key: String.fromCharCode(97 + i), name: n,
                             fail: (i * 7) % 40, mp: 1 + (i % 4),
                             usable: i !== 6 };
                });
        }
        var a = player_point() || { x: window.innerWidth / 2,
                                    y: window.innerHeight / 2, cw: 32, ch: 32 };
        open(a, false);
    };
});
