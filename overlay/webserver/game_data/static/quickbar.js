// Quick-use action bar: moves the stock webtiles action panel (#action-panel,
// the item/ability slot canvas drawn by action_panel.js) from the top-left
// corner to the bottom centre of the dungeon view and frames it like an
// action bar. Styles live in quickbar.css.
//
// Mouse: action_panel.js maps the mouse to a slot with raw ev.clientX/clientY,
// assuming the canvas sits at the viewport origin. Once the panel is moved
// that would pick the wrong slot, so mouse events on the canvas get their
// clientX/Y rewritten to canvas-relative values in a capture listener,
// before jQuery builds its event object. pageX/pageY (used to place the
// tooltip and settings popup) are left alone. Both the canvas css size and
// the stock hit-test use css pixels (32 * scale/100 per slot), so this holds
// at any devicePixelRatio.
//
// Size: the stock action_panel_scale is left alone (default 100%, 32px
// slots). Older versions of this mod forced it larger; a persisted override
// is reset to 100 once.
//
// Names: a caption row (DOM, pointer-events none) sits under (horizontal) or
// beside (vertical) the canvas, aligned to the slots by replicating the
// stock inventory filter/sort.
//
// God abilities: the locally patched crawl binary sends player.abilities
// (see the god abilities section); they get a highlighted group of DOM slots
// at the front of the bar.
define(["jquery", "comm", "client", "./sdc_api", "./options", "./player",
        "./cell_renderer", "./enums", "./tileinfo-gui", "./util"],
function ($, comm, client, api, options, player, cr, enums, gui, util) {
    "use strict";

    // The bar always sits at the bottom centre with its names shown (these
    // used to be the "quickbar_pos" / "quickbar_names" options); drop stale
    // stored choices.
    if ("quickbar_pos" in api.settings || "quickbar_names" in api.settings)
    {
        delete api.settings.quickbar_pos;
        delete api.settings.quickbar_names;
        api.save();
    }

    var NUM_RESERVED = 2;       // stock: close + game menu
    var CAP_ROW = 14;           // caption row height (horizontal bar)
    var CAP_COL = 78;           // caption column width (vertical bar)
    var MOUSE_EVENTS = ["mousemove", "mousedown", "mouseup", "click",
                        "mouseenter", "mouseleave", "contextmenu"];
    var frame_count = 0;
    var have_options = false;
    var scale_reset_done = false;
    var caps_key = "";

    function hud_on()
    {
        return document.body.classList.contains("sdc-hud");
    }

    function moved()
    {
        return hud_on();
    }

    function remap(ev)
    {
        var canvas = ev.target;
        if (!canvas || canvas.id !== "action-panel" || !moved()) return;
        var r = canvas.getBoundingClientRect();
        var x = ev.clientX - r.left - canvas.clientLeft;
        var y = ev.clientY - r.top - canvas.clientTop;
        try
        {
            Object.defineProperty(ev, "clientX", { value: x });
            Object.defineProperty(ev, "clientY", { value: y });
        }
        catch (e) { api.warn("quickbar mouse remap", e); }
        dock_mouse(ev.type, canvas, x, y);
    }

    MOUSE_EVENTS.forEach(function (type) {
        document.addEventListener(type, remap, true);
    });

    // touch: dragging a finger along the bar runs the dock bell under it
    // (like hovering with a mouse); lifting it settles the bar and picks
    // nothing. A plain tap still clicks through the browser's synthesized
    // mouse events, which are kept out of the dock (no mouseleave would ever
    // follow them, leaving the bar magnified).
    var TOUCH_SLOP = 8;         // px before a touch on the bar is a drag
    var qb_touch = null;
    var touch_until = 0;        // synthesized mouse events end by then (ms)

    function bar_target(el)
    {
        return el && (el.id === "action-panel"
                      || (ab.el && ab.el.contains(el)));
    }

    // finger x -> slot units over the whole bar (god abilities first)
    function touch_u(x)
    {
        var canvas = document.getElementById("action-panel");
        if (!canvas) return null;
        var pitch = canvas.clientHeight;
        if (pitch <= 0 || canvas.clientWidth < pitch) return null;
        var r = canvas.getBoundingClientRect();
        var na = ab.pitch === pitch ? ab_dock_n() : 0;
        var n = Math.round(canvas.clientWidth / pitch);
        if (na && ab.el && x < r.left)
        {
            var ar = ab.el.getBoundingClientRect();
            var ax = x - ar.left - ab.el.clientLeft;
            return Math.max(0, Math.min(na - 0.001, ax / ab.pitch));
        }
        var u = (x - r.left - canvas.clientLeft) / pitch;
        return na + Math.max(0, Math.min(n - 0.001, u));
    }

    function on_qb_touchstart(ev)
    {
        if (ev.touches.length !== 1 || !moved() || !bar_target(ev.target))
        {
            qb_touch = null;
            return;
        }
        touch_until = Date.now() + 1000;
        var t = ev.touches[0];
        qb_touch = { x: t.clientX, y: t.clientY, drag: false };
    }

    function on_qb_touchmove(ev)
    {
        if (!qb_touch) return;
        if (ev.touches.length !== 1)
        {
            qb_touch = null;
            dock_cursor_set("mouseleave", null);
            return;
        }
        var t = ev.touches[0];
        var dx = t.clientX - qb_touch.x, dy = t.clientY - qb_touch.y;
        if (!qb_touch.drag && dx * dx + dy * dy < TOUCH_SLOP * TOUCH_SLOP)
            return;
        qb_touch.drag = true;
        ev.preventDefault();
        touch_until = Date.now() + 1000;
        var u = touch_u(t.clientX);
        if (u !== null) dock_cursor_set("mousemove", u);
    }

    function on_qb_touchend(ev)
    {
        if (!qb_touch) return;
        var drag = qb_touch.drag;
        qb_touch = null;
        touch_until = Date.now() + 1000;
        if (drag)
        {
            // no click after a scrub
            if (ev.cancelable) ev.preventDefault();
            dock_cursor_set("mouseleave", null);
        }
    }

    var touch_opts = { capture: true, passive: false };
    document.addEventListener("touchstart", on_qb_touchstart, touch_opts);
    document.addEventListener("touchmove", on_qb_touchmove, touch_opts);
    document.addEventListener("touchend", on_qb_touchend, touch_opts);
    document.addEventListener("touchcancel", on_qb_touchend, touch_opts);

    function from_touch()
    {
        return Date.now() < touch_until;
    }

    // god abilities --------------------------------------------------------
    //
    // player.abilities (local crawl patch, webtiles-abilities.patch): the god
    // invocations in the `a` menu's order, [{key, name, fail, usable, tile,
    // tex, god}]. They get their own highlighted group of DOM slots at the
    // front of the bar (left of a horizontal canvas, above a vertical one),
    // joined to it with a divider. The stock canvas is shifted right by half
    // the group width (body var --sdc-qb-ab-shift) so the whole bar stays
    // centred. Bottom position only; with no abilities nothing changes.
    // Activation sends the game keys `a` then the ability letter.

    var AB_DIV = 12;            // divider width between abilities and items
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
    var ab = { el: null, list: [], key: "", gw: 0, n: 0, horizontal: true,
               pitch: 0 };
    var ab_fake = null;

    function ab_list()
    {
        var a = ab_fake || player.abilities;
        if (!Array.isArray(a)) return [];
        return a.filter(function (x) { return x && x.name; });
    }

    function ab_god_colour()
    {
        return GOD_COLOURS[String(player.god || "")] || "#ffbf47";
    }

    // "Line Pass" -> "LP", "Stomp" -> "St"
    function ab_glyph(name)
    {
        var w = String(name).split(/\s+/).filter(Boolean);
        if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
        var s = w[0] || "?";
        return s[0].toUpperCase() + (s[1] || "");
    }

    function ab_has_tile(a)
    {
        return typeof a.tile === "number" && a.tile >= 0
               && typeof a.tex === "number"
               && options.get("tile_display_mode") === "tiles";
    }

    function ab_draw_icon(canvas, a)
    {
        var renderer = new cr.DungeonCellRenderer();
        util.init_canvas(canvas, renderer.cell_width, renderer.cell_height);
        canvas.style.width = "";
        canvas.style.height = "";
        renderer.init(canvas);
        renderer.draw_from_texture(a.tile, 0, 0, a.tex, 0, 0, undefined,
                                   false);
    }

    // inner markup of an ability slot (the bar button and its dock copy);
    // returns true if an icon canvas needs drawing
    function ab_fill(el, a, pitch)
    {
        var html = "";
        var icon = ab_has_tile(a);
        if (icon)
            html += "<canvas class=\"sdc-ab-ic\"></canvas>";
        html += "<span class=\"sdc-ab-gl\" style=\"font-size:"
            + Math.round(pitch * 0.4) + "px;line-height:" + pitch + "px"
            + (icon ? ";display:none" : "") + "\">"
            + esc(ab_glyph(a.name)) + "</span>";
        if (a.key)
            html += "<span class=\"sdc-ab-k\">" + esc(a.key) + "</span>";
        if (a.fail > 0)
            html += "<span class=\"sdc-ab-f\">" + esc(a.fail) + "%</span>";
        if (!a.usable)
            html += "<span class=\"sdc-ab-lk\"></span>";
        el.innerHTML = html;
        el.classList.add("sdc-ab");
        el.classList.toggle("off", !a.usable);
        if (icon)
        {
            try { ab_draw_icon(el.firstChild, a); }
            catch (e)
            {
                // tile sheet not ready / unknown tile: text glyph instead
                $(el.firstChild).remove();
                $(el).children(".sdc-ab-gl").css("display", "");
            }
        }
    }

    function ab_tip_text(a)
    {
        return a.name + (a.key ? " [" + a.key + "]" : "")
            + " — " + (a.fail > 0 ? a.fail + "% fail" : "no fail")
            + ", " + (a.usable ? "usable" : "unusable");
    }

    // tooltip: its own element (the group is hidden while the dock runs),
    // above the slot and clear of the dock's magnified height
    function ab_show_tip(btn, a)
    {
        if (!a) return;
        var tip = document.getElementById("sdc_qb_abtip");
        if (!tip)
        {
            tip = document.createElement("div");
            tip.id = "sdc_qb_abtip";
            document.getElementById("normal").appendChild(tip);
        }
        tip.textContent = ab_tip_text(a);
        tip.classList.toggle("off", !a.usable);
        tip.style.setProperty("--sdc-qb-god", ab_god_colour());
        var r = btn.getBoundingClientRect();
        tip.style.display = "block";
        if (ab.horizontal)
        {
            tip.style.left = (r.left + r.width / 2) + "px";
            tip.style.top = (r.top - r.height * DOCK_MAX - 8) + "px";
            tip.setAttribute("data-dir", "h");
        }
        else
        {
            tip.style.left = (r.left - 6) + "px";
            tip.style.top = (r.top + r.height / 2) + "px";
            tip.setAttribute("data-dir", "v");
        }
    }

    function ab_hide_tip()
    {
        $("#sdc_qb_abtip").hide();
    }

    function ab_activate(a, btn)
    {
        if (!a) return;
        var refuse = function () {
            if (!btn) return;
            btn.classList.remove("nope");
            void btn.offsetWidth;
            btn.classList.add("nope");
        };
        if (!a.usable || !a.key) { refuse(); return; }
        if (client.is_watching && client.is_watching()) return;
        var g = window.game;
        if (g && typeof g.get_input_mode === "function"
            && g.get_input_mode() !== enums.mouse_mode.COMMAND)
        {
            refuse();
            return;
        }
        if (ab_fake)
        {
            // debug abilities never reach the game
            if (window.console) console.log("sdc abilities test: a" + a.key);
            return;
        }
        // the game reads input in order: `a` opens the ability menu, the
        // letter picks the ability
        comm.send_message("input", { text: "a" });
        comm.send_message("input", { text: a.key });
    }

    function ab_mouse(ev)
    {
        if (!ab.el || !ab.horizontal || !ab.n || !ab.pitch) return;
        if (from_touch()) return;
        if (ev.type === "mouseleave")
        {
            dock_cursor_set("mouseleave", null);
            return;
        }
        var r = ab.el.getBoundingClientRect();
        var x = ev.clientX - r.left - ab.el.clientLeft;
        var u = Math.max(0, Math.min(ab.n - 0.001, x / ab.pitch));
        dock_cursor_set(ev.type, u);
    }

    function ab_ensure_el()
    {
        if (ab.el && document.body.contains(ab.el)) return ab.el;
        $("#sdc_qb_ab").remove();
        var el = document.createElement("div");
        el.id = "sdc_qb_ab";
        document.getElementById("normal").appendChild(el);
        ab.el = el;
        ab.key = "";
        var pick = function (btn) {
            return ab.list[Number(btn.getAttribute("data-i"))];
        };
        $(el).on("mousedown", "button", function (ev) {
            // keep keyboard focus where it is (the game)
            ev.preventDefault();
        }).on("click", "button", function (ev) {
            ev.preventDefault();
            ab_activate(pick(this), this);
        }).on("keydown", "button", function (ev) {
            if (ev.which !== 13 && ev.which !== 32) return;
            ev.preventDefault();
            ev.stopPropagation();
            ab_activate(pick(this), this);
        }).on("mouseenter", "button", function () {
            ab_show_tip(this, pick(this));
        }).on("mouseleave", "button", ab_hide_tip)
          .on("contextmenu", function (ev) { ev.preventDefault(); })
          .on("mousemove mousedown mouseup mouseleave", ab_mouse);
        return el;
    }

    function ab_set_shift(px)
    {
        var cur = document.body.style.getPropertyValue("--sdc-qb-ab-shift");
        var next = px ? px + "px" : "";
        if (cur === next) return false;
        if (next) document.body.style.setProperty("--sdc-qb-ab-shift", next);
        else document.body.style.removeProperty("--sdc-qb-ab-shift");
        return true;
    }

    function ab_hide()
    {
        if (ab.el) ab.el.style.display = "none";
        if (ab.n) ab_hide_tip();
        ab.n = 0;
        ab.gw = 0;
        ab_set_shift(0);
        document.body.removeAttribute("data-sdc-qbab");
    }

    // Builds/sizes the group for the current list. Returns true if the
    // canvas was shifted (so its rect must be measured again).
    function ab_sync(horizontal, pitch)
    {
        var list = ab_list();
        if (!list.length || pitch <= 0)
        {
            var was = ab.n > 0;
            ab.list = [];
            ab_hide();
            return was;
        }
        var el = ab_ensure_el();
        var n = list.length;
        var gw = 2 + n * pitch + AB_DIV;
        ab.list = list;
        ab.n = n;
        ab.gw = gw;
        ab.pitch = pitch;
        ab.horizontal = horizontal;
        document.body.setAttribute("data-sdc-qbab", horizontal ? "h" : "v");
        var key = JSON.stringify(list) + "|" + pitch + "|" + horizontal
                  + "|" + player.god + "|" + options.get("tile_display_mode");
        if (key !== ab.key)
        {
            ab.key = key;
            el.setAttribute("data-dir", horizontal ? "h" : "v");
            el.style.setProperty("--sdc-qb-god", ab_god_colour());
            el.style.setProperty("--sdc-qb-pitch", pitch + "px");
            ab_hide_tip();
            el.innerHTML = "<span class=\"dv\">✦</span>";
            list.forEach(function (a, i) {
                var b = document.createElement("button");
                b.type = "button";
                b.setAttribute("data-i", i);
                b.setAttribute("aria-label", ab_tip_text(a));
                b.style.width = pitch + "px";
                b.style.height = pitch + "px";
                if (horizontal) b.style.left = (i * pitch) + "px";
                else b.style.top = (i * pitch) + "px";
                ab_fill(b, a, pitch);
                el.appendChild(b);
            });
            dk_dirty = true;
        }
        return ab_set_shift(horizontal ? Math.round(gw / 2) : 0);
    }

    function ab_place(r, horizontal)
    {
        if (!ab.n || !ab.el) return;
        var st = ab.el.style;
        st.display = "block";
        if (horizontal)
        {
            st.left = (r.left - ab.gw) + "px";
            st.top = r.top + "px";
            st.width = ab.gw + "px";
            st.height = r.height + "px";
        }
        else
        {
            st.left = r.left + "px";
            st.top = (r.top - ab.gw) + "px";
            st.width = r.width + "px";
            st.height = ab.gw + "px";
        }
    }

    // number of ability slots taking part in the dock bell
    function ab_dock_n()
    {
        return (ab.n && ab.horizontal && ab.el
                && ab.el.style.display !== "none") ? ab.n : 0;
    }

    // debug: fake god abilities (null restores the real ones)
    window.sdc_abilities_test = function (names) {
        if (names === null || names === false)
            ab_fake = null;
        else
        {
            names = Array.isArray(names) && names.length ? names
                    : ["Stomp", "Line Pass", "Grand Finale"];
            ab_fake = names.map(function (name, i) {
                var id = "ABILITY_USKAYAW_"
                         + String(name).toUpperCase().replace(/\W+/g, "_");
                var tile = typeof gui[id] === "number" ? gui[id] : -1;
                return {
                    key: String.fromCharCode(97 + i),
                    name: String(name),
                    fail: i === 1 ? 20 : 0,
                    usable: i !== names.length - 1 || names.length < 2,
                    tile: tile,
                    tex: tile >= 0 ? enums.texture.GUI : -1,
                    god: true,
                };
            });
        }
        caps_key = "";
        sync_frame();
        return ab_list();
    };

    // scale ----------------------------------------------------------------

    // the items the stock panel shows, in its order
    function panel_items()
    {
        var inv = Object.values(player.inv || {}).filter(function (item) {
            return item.quantity && item.action_panel_order >= 0;
        });
        inv.sort(function (a, b) {
            if (a.action_panel_order === b.action_panel_order)
                return a.sub_type - b.sub_type;
            return a.action_panel_order - b.action_panel_order;
        });
        return inv;
    }

    // one-time cleanup of a scale persisted by earlier versions of this mod
    function reset_old_scale()
    {
        if (scale_reset_done || !have_options) return;
        scale_reset_done = true;
        var flag = "sdc_qb_scale_reset";
        try
        {
            if (window.localStorage.getItem(flag)) return;
            window.localStorage.setItem(flag, "1");
        }
        catch (e) { /* no storage (private mode): reset again next time */ }
        var cur = options.get("action_panel_scale");
        if (cur !== null && cur !== undefined && cur !== 100)
            options.set("action_panel_scale", 100);
    }

    options.add_listener(function () {
        have_options = true;
        reset_old_scale();
    });


    // dock magnification ---------------------------------------------------
    //
    // While the cursor is over (or an item bounce is running on) the bar, the
    // stock canvas is hidden with opacity 0 (still in place, still receiving
    // every mouse event) and #sdc_qb_dock shows one small canvas per slot,
    // a pixel copy of that slot's rect, scaled with a bell around the cursor.
    // Hit-testing stays on the unscaled stock canvas. Horizontal bar only.

    var DOCK_MAX = 0.75;        // peak magnification - 1
    var DOCK_MAX_TOUCH = 1.4;   // same under a finger (it hides the icon)
    var DOCK_SIGMA = 1.1;       // bell width in slots
    var DOCK_TAU = 0.045;       // lerp time constant (s)
    var QUIVER_AMP = 2.5;       // degrees
    var QUIVER_PERIOD = 0.9;    // s
    var QUIVER_DECAY = 1.2;     // s
    var BOUNCE_AMP = 7;         // px
    var BOUNCE_LEN = 0.55;      // s

    var dk = { el: null, bg: null, label: null, slots: [], ctxs: [],
               n: 0, pitch: 0, active: false };
    var dk_cur = [];            // current scale per slot
    var dk_q0 = [];             // quiver start time per slot (s)
    var dk_b0 = [];             // bounce start time per slot (s)
    var dk_cursor = null;       // cursor position in slot units, or null
    var dk_sim_until = 0;
    var dk_hover = -1;
    var dk_dirty = true;
    var dk_raf = 0;
    var dk_last = 0;
    var dk_broken = false;
    var dk_snap = null;

    function reduced_motion()
    {
        return api.reduced_motion();
    }

    // the stock canvas if the dock can run on it right now, else null
    function dock_canvas()
    {
        if (dk_broken || !hud_on() || !moved()) return null;
        if (document.body.classList.contains("sdc-mapview")) return null;
        var canvas = document.getElementById("action-panel");
        if (!canvas || canvas.classList.contains("hidden")) return null;
        var r = canvas.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.width < r.height) return null;
        if (canvas.clientHeight <= 0 || canvas.clientWidth <= 0
            || canvas.width <= 0 || canvas.height <= 0) return null;
        if (window.getComputedStyle(canvas).display === "none") return null;
        return canvas;
    }

    function dock_deactivate()
    {
        document.body.classList.remove("sdc-qb-dock");
        dk.active = false;
        dk_last = 0;
        if (dk_raf)
        {
            window.cancelAnimationFrame(dk_raf);
            dk_raf = 0;
        }
    }

    function dock_fail()
    {
        dk_broken = true;
        dock_deactivate();
        $("#sdc_qb_dock").remove();
        dk.el = null;
        dk.slots = [];
        dk.ctxs = [];
    }

    function dock_request()
    {
        if (!dk_raf && !dk_broken)
            dk_raf = window.requestAnimationFrame(dock_tick);
    }

    // n slots in all, the first na of them god abilities (DOM copies of the
    // ability buttons), the rest pixel copies of the stock canvas
    function dock_build(n, na)
    {
        na = na || 0;
        if (!dk.el || !document.body.contains(dk.el) || na !== dk.na)
        {
            $("#sdc_qb_dock").remove();
            dk.el = document.createElement("div");
            dk.el.id = "sdc_qb_dock";
            dk.abg = document.createElement("div");
            dk.abg.className = "abg";
            dk.mk = document.createElement("div");
            dk.mk.className = "mk";
            dk.mk.textContent = "✦";
            dk.bg = document.createElement("div");
            dk.bg.className = "bg";
            dk.label = document.createElement("div");
            dk.label.className = "lab";
            dk.el.appendChild(dk.abg);
            dk.el.appendChild(dk.bg);
            dk.el.appendChild(dk.mk);
            dk.el.appendChild(dk.label);
            document.getElementById("normal").appendChild(dk.el);
            dk.slots = [];
            dk.ctxs = [];
            dk.n = 0;
            dk.na = na;
            dk.abkey = "";
            for (var a = 0; a < na; ++a)
            {
                var as = document.createElement("div");
                as.className = "slot";
                dk.el.insertBefore(as, dk.mk);
                dk.slots.push(as);
                dk.ctxs.push(null);
                dk_cur[dk.n] = 1;
                dk.n++;
            }
            dk.abg.style.display = na ? "block" : "none";
            dk.mk.style.display = na ? "block" : "none";
            if (na && ab.el)
                dk.el.style.setProperty("--sdc-qb-god",
                    ab.el.style.getPropertyValue("--sdc-qb-god"));
        }
        if (n < na) n = na;
        while (dk.n > n)
        {
            dk.el.removeChild(dk.slots.pop());
            dk.ctxs.pop();
            dk.n--;
        }
        while (dk.n < n)
        {
            var slot = document.createElement("div");
            slot.className = "slot";
            var c = document.createElement("canvas");
            slot.appendChild(c);
            dk.el.insertBefore(slot, dk.label);
            dk.slots.push(slot);
            dk.ctxs.push(c.getContext("2d"));
            dk_cur[dk.n] = 1;
            dk.n++;
        }
    }

    // pixel copy of every slot rect of the stock canvas
    function dock_copy(canvas, pitch)
    {
        var ratio = canvas.width / canvas.clientWidth;
        var sw = pitch * ratio;
        var sh = canvas.height;
        var w = Math.max(1, Math.round(sw));
        var h = Math.max(1, Math.round(sh));
        var na = dk.na || 0;
        if (na && dk.abkey !== ab.key)
        {
            dk.abkey = ab.key;
            for (var a = 0; a < na; ++a)
                if (ab.list[a]) ab_fill(dk.slots[a], ab.list[a], pitch);
        }
        for (var i = na; i < dk.n; ++i)
        {
            var c = dk.slots[i].firstChild;
            if (c.width !== w) c.width = w;
            if (c.height !== h) c.height = h;
            var ctx = dk.ctxs[i];
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(canvas, (i - na) * sw, 0, sw, sh, 0, 0, w, h);
        }
    }

    function dock_layout(canvas, r, pitch, now)
    {
        var n = dk.n;
        var na = dk.na || 0;
        // unscaled gap between the ability group and the items: the
        // divider plus the canvas' left border
        var gap = na ? AB_DIV + canvas.clientLeft : 0;
        var cw = canvas.clientWidth;
        var rest = na ? na * pitch + gap + cw : cw;
        var total = gap;
        var i;
        for (i = 0; i < n; ++i) total += pitch * dk_cur[i];
        // the bar widens symmetrically about its rest centre
        var pos = (rest - total) / 2;
        var reduce = reduced_motion();
        dk.el.style.left = (r.left + canvas.clientLeft
                            - (na ? ab.gw : 0)) + "px";
        dk.el.style.top = (r.top + canvas.clientTop) + "px";
        dk.el.style.width = rest + "px";
        dk.el.style.height = pitch + "px";
        dk.bg.style.top = "-2px";
        dk.bg.style.height = (pitch + 4) + "px";
        if (na)
        {
            dk.abg.style.left = (pos - 2) + "px";
            dk.abg.style.top = "-2px";
            dk.abg.style.height = (pitch + 4) + "px";
        }
        else
        {
            dk.bg.style.left = (pos - 2) + "px";
            dk.bg.style.width = (total + 4) + "px";
        }
        var hover_cx = null;
        for (i = 0; i < n; ++i)
        {
            if (na && i === na)
            {
                // end of the ability group: divider, then the item frame
                dk.abg.style.width = (pos + AB_DIV - parseFloat(dk.abg.style.left))
                                     + "px";
                dk.mk.style.left = (pos + AB_DIV / 2) + "px";
                dk.mk.style.top = "0px";
                dk.mk.style.height = pitch + "px";
                dk.mk.style.lineHeight = pitch + "px";
                pos += gap;
                dk.bg.style.left = (pos - 2) + "px";
                dk.bg.style.width = ((rest - total) / 2 + total - pos + 4)
                                    + "px";
            }
            var s = dk_cur[i];
            var w = pitch * s;
            var center = pos + w / 2;
            pos += w;
            var rot = 0, ty = 0;
            if (!reduce)
            {
                if (dk_q0[i] !== undefined)
                {
                    var qt = now - dk_q0[i];
                    var qd = Math.exp(-qt / QUIVER_DECAY);
                    if (qd > 0.03)
                        rot = QUIVER_AMP * qd
                              * Math.sin(2 * Math.PI * qt / QUIVER_PERIOD);
                }
                if (dk_b0[i] !== undefined)
                {
                    var bt = now - dk_b0[i];
                    if (bt >= 0 && bt < BOUNCE_LEN)
                        ty = -BOUNCE_AMP
                             * Math.abs(Math.sin(Math.PI * 2 * bt / BOUNCE_LEN))
                             * (1 - bt / BOUNCE_LEN);
                }
            }
            // slots keep their rest box and scale about the bottom centre,
            // so position by the centre of the (scaled) share of the bar
            var st = dk.slots[i].style;
            st.left = (center - pitch / 2) + "px";
            st.width = pitch + "px";
            st.height = pitch + "px";
            st.zIndex = String(Math.round(s * 100));
            st.transform = "translateY(" + ty.toFixed(2) + "px) rotate("
                           + rot.toFixed(2) + "deg) scale(" + s.toFixed(3)
                           + ")";
            var hot = (i === dk_hover && dk_cursor !== null);
            if (hot !== dk.slots[i].classList.contains("hot"))
                dk.slots[i].classList.toggle("hot", hot);
            if (hot) hover_cx = center;
        }
        // caption of the hovered slot (the stock strip is hidden meanwhile)
        var text = "";
        var caps = document.getElementById("sdc_qb_caps");
        if (hover_cx !== null && caps && caps.style.display !== "none"
            && caps.children[dk_hover])
            text = caps.children[dk_hover].textContent;
        if (text)
        {
            if (dk.label.textContent !== text) dk.label.textContent = text;
            dk.label.style.display = "block";
            dk.label.style.left = hover_cx + "px";
            // under a finger: above the magnified icon, not below the bar
            var up = from_touch();
            if (up !== dk.label.classList.contains("up"))
                dk.label.classList.toggle("up", up);
            dk.label.style.top = (up ? pitch * (1 - (dk_cur[dk_hover] || 1)) - 6
                                     : pitch + 4) + "px";
        }
        else
            dk.label.style.display = "none";
    }

    function dock_tick(ts)
    {
        dk_raf = 0;
        try
        {
            var canvas = dock_canvas();
            if (!canvas)
            {
                dock_deactivate();
                return;
            }
            var now = ts / 1000;
            var dt = dk_last ? Math.min(0.1, Math.max(0.001, now - dk_last))
                             : 0.016;
            dk_last = now;
            var pitch = canvas.clientHeight;
            var n = Math.round(canvas.clientWidth / pitch);
            if (n < 1 || n > 48)
            {
                dock_deactivate();
                return;
            }
            var na = ab.pitch === pitch ? ab_dock_n() : 0;
            n += na;
            if (dk_sim_until && Date.now() > dk_sim_until)
            {
                dk_sim_until = 0;
                dk_cursor = null;
            }
            var reduce = reduced_motion();
            var r = canvas.getBoundingClientRect();
            if (n !== dk.n || na !== (dk.na || 0) || pitch !== dk.pitch
                || !dk.el || !document.body.contains(dk.el))
            {
                dock_build(n, na);
                dk.pitch = pitch;
                dk_dirty = true;
            }
            var was_active = dk.active;
            if (dk_dirty || !was_active)
            {
                dock_copy(canvas, pitch);
                dk_dirty = false;
            }
            var hov = -1;
            if (dk_cursor !== null)
                hov = Math.max(0, Math.min(n - 1, Math.floor(dk_cursor)));
            if (hov !== dk_hover)
            {
                dk_hover = hov;
                if (hov >= 0 && !reduce) dk_q0[hov] = now;
            }
            var k = reduce ? 1 : 1 - Math.exp(-dt / DOCK_TAU);
            var settled = true;
            for (var i = 0; i < n; ++i)
            {
                var target = 1;
                if (dk_cursor !== null)
                {
                    var tmax = from_touch() ? DOCK_MAX_TOUCH : DOCK_MAX;
                    if (reduce)
                        target = (i === hov) ? 1 + tmax / 3 : 1;
                    else
                    {
                        var d = dk_cursor - (i + 0.5);
                        target = 1 + tmax * Math.exp(-d * d
                                 / (2 * DOCK_SIGMA * DOCK_SIGMA));
                    }
                }
                var c = dk_cur[i] === undefined ? 1 : dk_cur[i];
                c += (target - c) * k;
                if (Math.abs(target - c) < 0.002) c = target;
                else settled = false;
                dk_cur[i] = c;
            }
            var live = !settled;
            if (!reduce)
            {
                for (var j = 0; j < n; ++j)
                {
                    if (dk_b0[j] !== undefined && now - dk_b0[j] < BOUNCE_LEN)
                        live = true;
                    if (dk_q0[j] !== undefined
                        && Math.exp(-(now - dk_q0[j]) / QUIVER_DECAY) > 0.03)
                        live = true;
                }
            }
            if (dk_cursor === null && !live)
            {
                // fully at rest: hand back to the stock canvas
                dock_deactivate();
                return;
            }
            dock_layout(canvas, r, pitch, now);
            if (!was_active)
            {
                document.body.classList.add("sdc-qb-dock");
                dk.active = true;
            }
            if (live || dk_sim_until) dock_request();
            else dk_last = 0;
        }
        catch (e)
        {
            dock_fail();
        }
    }

    function dock_mouse(type, canvas, x, y)
    {
        if (dk_broken || from_touch()) return;
        if (type === "mouseleave")
        {
            dk_cursor = null;
            dk_dirty = true;
            if (dk.active) dock_request();
            return;
        }
        if (type === "contextmenu") return;
        var pitch = canvas.clientHeight;
        if (pitch <= 0 || canvas.clientWidth < canvas.clientHeight) return;
        // slot units count the god ability slots in front of the canvas
        var na = ab.pitch === pitch ? ab_dock_n() : 0;
        dock_cursor_set(type, na + x / pitch);
    }

    // u: cursor position in slot units over the whole bar, or null
    function dock_cursor_set(type, u)
    {
        if (dk_broken) return;
        if (u === null)
        {
            dk_cursor = null;
            dk_dirty = true;
            if (dk.active) dock_request();
            return;
        }
        dk_sim_until = 0;
        var changed = dk_cursor === null
                      || Math.floor(u) !== Math.floor(dk_cursor);
        dk_cursor = u;
        // a click/press may redraw the stock canvas too
        if (type !== "mousemove" || changed) dk_dirty = true;
        dock_request();
    }

    // bounce a slot when an item appears or its quantity changes
    function dock_inv_check()
    {
        if (dk_broken) return;
        var items = panel_items();
        var snap = {};
        var changed = [];
        items.forEach(function (it, idx) {
            var key = it.name + "|" + it.base_type + "|" + it.sub_type;
            if (snap[key] !== undefined) key += "#" + idx;
            snap[key] = it.quantity;
            if (dk_snap && dk_snap[key] !== it.quantity)
                changed.push(ab_dock_n() + NUM_RESERVED + idx);
        });
        var first = !dk_snap;
        dk_snap = snap;
        if (first || !changed.length || changed.length > 3) return;
        if (!dock_canvas()) return;
        var now = window.performance.now() / 1000;
        changed.forEach(function (i) { dk_b0[i] = now; });
        dk_dirty = true;
        dock_request();
    }

    // debug: simulate a hover on a slot for ~2 s
    window.sdc_dock_test = function (slot) {
        dk_cursor = (Number(slot) || 0) + 0.5;
        dk_sim_until = Date.now() + 2000;
        dk_dirty = true;
        dock_request();
    };

    // names ----------------------------------------------------------------

    // "a +0 war axe" -> "war axe", "3 potions of curing" -> "curing"
    function short_name(name)
    {
        var s = String(name || "");
        s = s.replace(/\s*[\(\{][^\)\}]*[\)\}]/g, "");
        s = s.replace(/^(?:an?|the|\d+)\s+/i, "");
        s = s.replace(/^[+-]\d+\s+/, "");
        s = s.replace(/^(?:[\w'-]+\s+){0,2}?(?:scrolls?|potions?|wands?|staffs?|staves|rods?|rings?|amulets?|books?|tomes?|decks?|orbs?|lanterns?|horns?|boxes|phials?|sacks?|figurines?|tins?)\s+of\s+/i, "");
        return $.trim(s);
    }

    function esc(t)
    {
        return $("<div>").text(t).html();
    }

    function hide_caps()
    {
        $("#sdc_qb_caps").hide();
        document.body.removeAttribute("data-sdc-qbcap");
    }

    function sync_caps(canvas, r, horizontal, pitch)
    {
        if (pitch <= 0)
        {
            hide_caps();
            return;
        }
        var caps = document.getElementById("sdc_qb_caps");
        if (!caps)
        {
            caps = document.createElement("div");
            caps.id = "sdc_qb_caps";
            document.getElementById("normal").appendChild(caps);
        }
        var border = canvas.clientLeft || 0;
        var length = horizontal ? canvas.clientWidth : canvas.clientHeight;
        var slots = Math.floor(length / pitch + 0.01);
        var names = ["CLOSE", "MENU"];
        panel_items().forEach(function (item) {
            names.push(short_name(item.name));
        });
        names = names.slice(0, slots);
        // god abilities in front, sharing the strip
        var off = ab.n ? ab.gw : 0;
        var ab_names = ab.n ? ab.list.map(function (a) { return a.name; })
                            : [];

        document.body.setAttribute("data-sdc-qbcap", horizontal ? "h" : "v");
        caps.style.display = "block";
        var key = [horizontal ? "h" : "v", pitch, border, r.left, r.top,
                   r.width, r.height, off].concat(ab_names, names).join("|");
        if (key === caps_key) return;
        caps_key = key;

        caps.setAttribute("data-dir", horizontal ? "h" : "v");
        caps.className = pitch < 40 ? "small" : "";
        if (horizontal)
        {
            caps.style.left = (r.left - off) + "px";
            caps.style.top = r.bottom + "px";
            caps.style.width = (r.width + off) + "px";
            caps.style.height = CAP_ROW + "px";
        }
        else
        {
            caps.style.left = r.right + "px";
            caps.style.top = (r.top - off) + "px";
            caps.style.width = CAP_COL + "px";
            caps.style.height = (r.height + off) + "px";
        }
        var html = "";
        ab_names.forEach(function (n, i) {
            var pos = border + i * pitch;
            var st = horizontal
                ? "left:" + pos + "px;width:" + pitch + "px"
                : "top:" + pos + "px;height:" + pitch + "px;line-height:"
                  + pitch + "px";
            html += "<span style=\"" + st + "\" class=\"ab\">" + esc(n)
                + "</span>";
        });
        names.forEach(function (n, i) {
            var pos = off + border + i * pitch;
            var st = horizontal
                ? "left:" + pos + "px;width:" + pitch + "px"
                : "top:" + pos + "px;height:" + pitch + "px;line-height:"
                  + pitch + "px";
            html += "<span style=\"" + st + "\""
                + (i < NUM_RESERVED ? " class=\"res\"" : "") + ">"
                + esc(n) + "</span>";
        });
        caps.innerHTML = html;
    }

    // frame ----------------------------------------------------------------

    function apply()
    {
        document.body.setAttribute("data-sdc-quickbar", "bottom");
        sync_frame();
    }

    // The frame is a sibling overlay (a canvas can't have ::before) sized to
    // the canvas, with one divider per slot. Slots are square tiles, so the
    // slot pitch is the canvas' css height for a horizontal panel.
    function sync_frame()
    {
        var canvas = document.getElementById("action-panel");
        var frame = document.getElementById("sdc_qb_frame");
        if (!canvas || !hud_on())
        {
            if (frame) frame.style.display = "none";
            hide_caps();
            ab_hide();
            return;
        }
        var r = canvas.getBoundingClientRect();
        var hidden = r.width === 0 || canvas.classList.contains("hidden")
                     || window.getComputedStyle(canvas).display === "none";
        var horizontal = r.width >= r.height;
        var pitch = horizontal ? canvas.clientHeight : canvas.clientWidth;
        if (hidden)
        {
            // also the minimised "+" state
            if (frame) frame.style.display = "none";
            hide_caps();
            ab_hide();
            return;
        }
        if (!moved())
        {
            // stock top-left position: no frame, captions still work
            if (frame) frame.style.display = "none";
            ab_hide();
            sync_caps(canvas, r, horizontal, pitch);
            return;
        }
        if (ab_sync(horizontal, pitch))
            r = canvas.getBoundingClientRect();     // the canvas was shifted
        ab_place(r, horizontal);
        if (!frame)
        {
            frame = document.createElement("div");
            frame.id = "sdc_qb_frame";
            document.getElementById("normal").appendChild(frame);
        }
        frame.style.display = "block";
        frame.style.left = r.left + "px";
        frame.style.top = r.top + "px";
        frame.style.width = r.width + "px";
        frame.style.height = r.height + "px";
        frame.style.setProperty("--sdc-qb-pitch", pitch + "px");
        frame.setAttribute("data-dir", horizontal ? "h" : "v");
        sync_caps(canvas, r, horizontal, pitch);
    }

    api.on("game_init", function () {
        reset_old_scale();
        apply();
    });
    api.on("setting", function (key) {
        if (key === "hud")
        {
            caps_key = "";
            apply();
        }
    });
    api.on("hud_update", function () {
        sync_frame();
        dk_dirty = true;
        if (dk.active) dock_request();
        try { dock_inv_check(); } catch (e) { dock_fail(); }
    });
    api.on("frame", function () {
        // the panel resizes itself when the inventory changes
        if (++frame_count % 10 === 0)
        {
            sync_frame();
            if (dk.active)
            {
                dk_dirty = true;
                if (!dock_canvas()) dock_deactivate();
                else dock_request();
            }
        }
    });
    api.on("game_cleanup", function () {
        $("#sdc_qb_frame, #sdc_qb_caps").remove();
        caps_key = "";
        ab_hide();
        $("#sdc_qb_ab, #sdc_qb_abtip").remove();
        ab.el = null;
        ab.list = [];
        ab.key = "";
        dock_deactivate();
        $("#sdc_qb_dock").remove();
        dk.el = null;
        dk.slots = [];
        dk.ctxs = [];
        dk.n = 0;
        dk_snap = null;
        dk_cursor = null;
        document.body.removeAttribute("data-sdc-quickbar");
        document.body.removeAttribute("data-sdc-qbcap");
    });

    return {};
});
