// Mobile UI: a touch layout over the same CRT view, for phones (and the
// android/ WebView wrapper). Styles live in mobile.css; everything is
// scoped to body.sdc-mobile, so desktop is untouched.
//
//   - vitals: the HP/MP panel shrinks to a small pill (top-left). Tapping
//     it opens the character sheet: stats card, a "%" button and the
//     customizable quick buttons (default: o explore, Tab fight).
//   - tools (top-right): a grid of commands that are awkward without a
//     keyboard (find, god, known items, lookup, ...), Esc / Enter, the
//     on-screen keyboard, minimap and settings.
//   - messages: the message pane is hidden; new messages show in a small
//     translucent bubble above the bottom bar that fades out. Tap the bubble
//     for the recent log (or to answer --more--). Text prompts bring the
//     pane back automatically. y/n prompts get Yes / No buttons.
//   - big thumb buttons: Fight (Tab) bottom-left, Explore (o) bottom-right.
//   - dungeon touch: tap = click a tile (travel / attack), swipe = one step
//     in 8 directions (a long swipe runs), long-press = describe.
//
// Options:
//   "mobile"         auto / on / off. Auto = touch screen or the wrapper.
//   "msg_fade"       seconds the message bubble stays up.
//   "mobile_zoom"    dungeon zoom step (Tools: Zoom +/-, pinch).
//   "mobile_pin"     also pin the quick buttons on screen (bottom-right).
//   "mobile_buttons" [{label, keys}] quick buttons (edited in the sheet).
//
// Key specs (quick buttons, tools): space-separated tokens. Named keys Tab,
// Esc, Enter, Space, Bksp; Ctrl+X for control keys; anything else is typed
// as characters ("za" = z then a).
//
// The wrapper (android/) calls window.sdcBack() for the back button and
// exposes window.SdcNative ({isLocal(), manageSaves()}).
define(["jquery", "comm", "./sdc_api", "./dungeon_renderer", "./enums", "./options"],
function ($, comm, api, renderer, enums, options) {
    "use strict";

    api.register_option({ key: "mobile", label: "Mobile UI", default: "on",
                          choices: [["auto", "Auto"], ["on", "On"],
                                    ["off", "Off"]] });
    api.register_option({ key: "msg_fade", label: "Message fade (s)",
                          default: 5, range: { min: 2, max: 15, step: 1 } });
    api.register_option({ key: "mobile_pin", label: "Pin quick buttons",
                          default: false,
                          choices: [[true, "On"], [false, "Off"]] });
    // Stock webtiles shrinks tiles until a 17-cell diameter fits, which is
    // ~20px on a landscape phone. Zoom k shows 17/k cells across the short
    // side instead (fit_to is wrapped below; click mapping stays stock).
    var ZOOMS = [1, 1.5, 2, 3, 4];
    api.register_option({ key: "mobile_zoom", label: "Dungeon zoom",
                          default: 0,
                          choices: [[0, "Fit"], [1, "1.5x"], [2, "2x"],
                                    [3, "3x"], [4, "4x"]] });
    var DEFAULT_BUTTONS = [{ label: "Explore", keys: "o" },
                           { label: "Fight", keys: "Tab" }];
    api.register_option({ key: "mobile_buttons", default: DEFAULT_BUTTONS });

    var TOOLS = [
        ["Find", "Ctrl+F"], ["God", "^"], ["Known items", "\\"],
        ["Lookup", "?/"], ["In view", "Ctrl+X"], ["Look", "x"],
        ["Map", "X"], ["Travel", "G"], ["History", "Ctrl+P"],
        ["Inventory", "i"], ["Spells", "I"], ["Abilities", "a"],
        ["Skills", "m"], ["Character", "%"], ["Rest", "5"],
        ["Wait", "s"], ["Pick up", "g"], ["Up <", "<"], ["Down >", ">"],
        ["Esc", "Esc"], ["Enter", "Enter"],
    ];

    var NAMED = { tab: 9, esc: 27, escape: 27, enter: 13, ret: 13,
                  space: 32, bksp: 8, backspace: 8 };

    // Detection ---------------------------------------------------------------

    function native_shell()
    {
        return !!window.SdcNative || /SuperDC/.test(navigator.userAgent);
    }

    function active()
    {
        var m = api.get("mobile");
        if (m === "on") return true;
        if (m === "off") return false;
        var coarse = window.matchMedia
            && window.matchMedia("(pointer: coarse)").matches;
        return native_shell()
            || (coarse && "ontouchstart" in document.documentElement);
    }

    // The server's client.html forces width=860, which makes phones zoom out
    // and scroll. Remember it so turning the mobile UI off restores it.
    var stock_viewport = null;
    function apply_mode()
    {
        var on = active();
        if (document.body)
            document.body.classList.toggle("sdc-mobile", on);
        document.documentElement.classList.toggle("sdc-mobile", on);
        var meta = document.querySelector("meta[name=viewport]");
        if (!meta)
        {
            meta = document.createElement("meta");
            meta.name = "viewport";
            document.head.appendChild(meta);
        }
        if (stock_viewport === null)
            stock_viewport = meta.content || "";
        meta.content = on
            ? "width=device-width, initial-scale=1, maximum-scale=1,"
              + " user-scalable=no, viewport-fit=cover"
            : stock_viewport;
        if (!on)
            close_all();
    }

    function zoom_step()
    {
        var z = Number(api.get("mobile_zoom"));
        return Math.max(0, Math.min(ZOOMS.length - 1, z || 0));
    }

    var stock_fit = renderer.fit_to;
    renderer.fit_to = function (width, height, min_diameter)
    {
        var k = ZOOMS[zoom_step()];
        if (k === 1 || !active() || this.ui_state === enums.ui.VIEW_MAP
            || options_glyphs())
            return stock_fit.apply(this, arguments);
        var size = Math.max(8, Math.floor(Math.min(width, height)
                                          / (min_diameter / k)));
        this.set_cell_size(size, size);
        this.set_size(Math.floor(width / this.cell_width),
                      Math.floor(height / this.cell_height));
    };

    function options_glyphs()
    {
        return options.get("tile_display_mode") === "glyphs";
    }

    function set_zoom(step)
    {
        step = Math.max(0, Math.min(ZOOMS.length - 1, step));
        if (step === zoom_step()) return;
        api.set("mobile_zoom", step);
    }

    function zoom_label()
    {
        var k = ZOOMS[zoom_step()];
        return k === 1 ? "Fit" : k + "x";
    }

    // Keys --------------------------------------------------------------------

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

    function buttons()
    {
        var b = api.get("mobile_buttons");
        return Array.isArray(b) ? b : DEFAULT_BUTTONS.slice();
    }

    function buzz()
    {
        try
        {
            if (navigator.vibrate) navigator.vibrate(12);
        }
        catch (e) { /* vibration blocked or unsupported: just skip it */ }
    }

    // DOM ---------------------------------------------------------------------

    var editing = false;

    function key_button(label, keys, after)
    {
        return $("<button type='button' class='sdc-m-btn'>")
            .text(label)
            .attr("title", keys)
            .on("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                buzz();
                if (after) after();
                send_keys(keys);
            });
    }

    function build()
    {
        $("#sdc_m_sheet, #sdc_m_toolbtn, #sdc_m_tools, #sdc_m_bubble,"
          + " #sdc_m_pin, #sdc_m_logclose, .sdc-m-big").remove();
        var normal = $("#normal");

        // the two thumb buttons: fight bottom-left, explore bottom-right
        key_button("Fight", "Tab", close_all)
            .attr("id", "sdc_m_fight").addClass("sdc-m-big")
            .appendTo(normal);
        key_button("Explore", "o", close_all)
            .attr("id", "sdc_m_explore").addClass("sdc-m-big")
            .appendTo(normal);

        $("<div id='sdc_m_sheet' class='sdc-panel'>")
            .appendTo($("#sdc_corner"));
        render_sheet();

        $("<button type='button' id='sdc_m_toolbtn' aria-label='Tools'>")
            .html("&#9776;")
            .on("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                toggle_tools();
            })
            .appendTo(normal);
        $("<div id='sdc_m_tools' class='sdc-panel'>").appendTo(normal);
        render_tools();

        $("<div id='sdc_m_bubble'>")
            .on("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                if (more_pending())
                    send_keys("Enter");
                else
                    toggle_log(true);
            })
            .appendTo(normal);

        $("<div id='sdc_m_pin'>").appendTo(normal);
        render_pin();

        $("<button type='button' id='sdc_m_logclose' aria-label='Close'>")
            .html("&times;")
            .on("click", function (ev) {
                ev.preventDefault();
                toggle_log(false);
            })
            .appendTo(normal);

        // tap the pill / statuses: open or close the sheet
        normal.off("click.sdcm")
            .on("click.sdcm", "#sdc_vitals, #sdc_statuses", function (ev) {
                if (!active()) return;
                ev.preventDefault();
                toggle_sheet();
            });

        watch_messages();
    }

    function render_sheet()
    {
        var sheet = $("#sdc_m_sheet").empty();
        if (!sheet.length) return;
        var row = $("<div class='sdc-m-row'>").appendTo(sheet);
        row.append(key_button("% Character", "%", close_all));
        buttons().forEach(function (b, i) {
            var btn = key_button(b.label, b.keys, close_all);
            if (editing)
            {
                btn.addClass("sdc-m-del").off("click")
                    .on("click", function (ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        var list = buttons().slice();
                        list.splice(i, 1);
                        api.set("mobile_buttons", list);
                        render_sheet();
                        render_pin();
                    });
            }
            row.append(btn);
        });
        $("<button type='button' class='sdc-m-btn sdc-m-ghost'>")
            .text(editing ? "Done" : "Edit")
            .on("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                editing = !editing;
                render_sheet();
            })
            .appendTo(row);
        if (editing)
            sheet.append(add_form());
    }

    // label + keys inputs; typing here must not reach the game
    function add_form()
    {
        var form = $("<form class='sdc-m-form'>");
        var label = $("<input type='text' placeholder='Label' maxlength='12'>");
        var keys = $("<input type='text' placeholder='Keys, e.g. za or Ctrl+F'>");
        form.append(label, keys,
                    $("<button type='submit' class='sdc-m-btn'>").text("Add"),
                    $("<div class='sdc-m-hint'>").text(
                        "Tap a button to remove it. Keys: Tab Esc Enter"
                        + " Space, Ctrl+X, or characters."));
        form.find("input").attr({ autocomplete: "off", autocapitalize: "off",
                                  autocorrect: "off", spellcheck: "false" })
            .on("keydown keypress keyup input", function (ev) {
                ev.stopPropagation();
            });
        form.on("submit", function (ev) {
            ev.preventDefault();
            var l = label.val().trim(), k = keys.val().trim();
            if (!k) return;
            var list = buttons().slice();
            list.push({ label: l || k, keys: k });
            api.set("mobile_buttons", list);
            render_sheet();
            render_pin();
        });
        return form;
    }

    function render_pin()
    {
        var pin = $("#sdc_m_pin").empty();
        buttons().forEach(function (b) {
            pin.append(key_button(b.label, b.keys));
        });
    }

    function render_tools()
    {
        var tools = $("#sdc_m_tools").empty();
        var grid = $("<div class='sdc-m-grid'>").appendTo(tools);
        TOOLS.forEach(function (t) {
            grid.append(key_button(t[0], t[1], close_all));
        });
        function action(label, fn)
        {
            grid.append($("<button type='button' class='sdc-m-btn sdc-m-ghost'>")
                .text(label)
                .on("click", function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    fn();
                }));
        }
        function zoom_btn(text, d)
        {
            grid.append($("<button type='button' class='sdc-m-btn sdc-m-ghost'>")
                .text(text)
                .on("click", function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    buzz();
                    set_zoom(zoom_step() + d);
                }));
        }
        zoom_btn("Zoom +", 1);
        zoom_btn("Zoom −", -1);
        grid.append($("<div class='sdc-m-hint sdc-m-zoomnow'>")
            .text("Zoom: " + zoom_label()));
        action("Keyboard", function () { close_all(); keyboard(); });
        action("Log", function () { close_all(); toggle_log(true); });
        action("Minimap", function () {
            document.body.classList.toggle("sdc-m-map");
            close_all();
        });
        action("Monsters", function () {
            api.command("toggle:monsters");
            document.body.classList.add("sdc-m-map");
            close_all();
        });
        action("Settings", function () { close_all(); api.command("panel"); });
        if (window.SdcNative && window.SdcNative.isLocal
            && window.SdcNative.isLocal())
            action("Saves", function () { window.SdcNative.manageSaves(); });
    }

    function toggle_sheet(force)
    {
        var b = document.body.classList;
        var open = force === undefined ? !b.contains("sdc-m-open") : force;
        if (open)
            b.remove("sdc-m-tools");
        else if (editing)
        {
            editing = false;
            render_sheet();
        }
        b.toggle("sdc-m-open", open);
    }

    function toggle_tools(force)
    {
        var b = document.body.classList;
        var open = force === undefined ? !b.contains("sdc-m-tools") : force;
        if (open)
            toggle_sheet(false);
        b.toggle("sdc-m-tools", open);
    }

    function toggle_log(open)
    {
        document.body.classList.toggle("sdc-m-log", open);
        if (open)
        {
            var c = document.getElementById("messages_container");
            if (c) c.scrollTop = c.scrollHeight;
            hide_bubble(true);
        }
    }

    function close_all()
    {
        if (!document.body) return;
        toggle_sheet(false);
        toggle_tools(false);
        $("#sdc_panel").remove();
    }

    // The stock helper input (game.js) turns typing into text_input / Esc.
    // It stays focusable but invisible in the mobile layout.
    function keyboard()
    {
        var input = $("#mobile_input input");
        if (!input.length) return;
        $("#mobile_input").show();
        if (input.is(":focus"))
            input.blur();
        else
            input.trigger("mousedown").focus();
    }

    // Android back button: close our overlays first, then Esc.
    window.sdcBack = function () {
        var b = document.body.classList;
        if (b.contains("sdc-m-log"))
            toggle_log(false);
        else if (b.contains("sdc-m-open") || b.contains("sdc-m-tools")
                 || $("#sdc_panel").length)
            close_all();
        else
            send_keys("Esc");
    };

    // Message bubble ----------------------------------------------------------

    var recent = [];        // .game_message elements shown in the bubble
    var fade_timer = null;
    var msg_observer = null;
    var MAX_LINES = 4;

    // The whole pane is watched: game.js's layout swaps #messages for a
    // clone (that swap adds no .game_message nodes, so it is ignored).
    function watch_messages()
    {
        recent = [];
        if (msg_observer)
            msg_observer.disconnect();
        var pane = document.getElementById("message_pane");
        if (!pane) return;
        msg_observer = new MutationObserver(function (records) {
            var changed = false;
            records.forEach(function (r) {
                if (r.type === "attributes")
                {
                    changed = changed || r.target.id === "more";
                    return;
                }
                Array.prototype.forEach.call(r.addedNodes, function (n) {
                    if (n.nodeType === 1 && n.classList.contains("game_message"))
                    {
                        recent.push(n);
                        changed = true;
                    }
                });
            });
            if (changed)
                show_bubble();
        });
        msg_observer.observe(pane, { childList: true, subtree: true,
                                     attributes: true,
                                     attributeFilter: ["style"] });
        // messages that arrived before the HUD was built (reconnect)
        if (more_pending())
        {
            recent = $("#messages .game_message").slice(-2).toArray();
            show_bubble();
        }
    }

    // #more's own display (the whole pane is hidden in the mobile layout)
    function more_pending()
    {
        var more = document.getElementById("more");
        return !!more && window.getComputedStyle(more).display !== "none";
    }

    var YN_RE = /[(\[]\s*y\s*\/\s*n\s*[)\]]|[(\[]y\/n\/q[)\]]/i;

    function last_text()
    {
        var last = recent[recent.length - 1];
        return last ? last.textContent : "";
    }

    function hide_now() { hide_bubble(true); }

    function prompt_pending()
    {
        if (more_pending()) return true;
        var text = last_text();
        return /\?\s*(\(y\/n\)|\[[^\]]*\])?\s*_?\s*$/i.test(text)
            || /\(y\/n\)/i.test(text);
    }

    function show_bubble()
    {
        if (!active()) return;
        var bubble = document.getElementById("sdc_m_bubble");
        if (!bubble) return;
        recent = recent.filter(function (n) { return n.isConnected; })
                       .slice(-MAX_LINES);
        if (!recent.length && !more_pending())
        {
            hide_bubble(true);
            return;
        }
        bubble.innerHTML = "";
        recent.forEach(function (n) {
            var line = n.cloneNode(true);
            line.removeAttribute("id");
            $(line).find(".prefix_glyph, #text_cursor, input").remove();
            line.className = "sdc-m-line";
            bubble.appendChild(line);
        });
        var pinned = prompt_pending();
        if (more_pending())
        {
            var more = document.createElement("div");
            more.className = "sdc-m-more";
            more.textContent = "-- tap for more --";
            bubble.appendChild(more);
        }
        else if (pinned && YN_RE.test(last_text()))
        {
            // yes/no prompts: answer with a tap, no keyboard needed
            var yn = document.createElement("div");
            yn.className = "sdc-m-yn";
            yn.appendChild(key_button("Yes", "y", hide_now)[0]);
            yn.appendChild(key_button("No", "n", hide_now)[0]);
            bubble.appendChild(yn);
        }
        bubble.classList.remove("sdc-m-fade");
        bubble.classList.add("sdc-m-show");
        bubble.classList.toggle("sdc-m-prompt", pinned);
        place_bubble();
        clearTimeout(fade_timer);
        if (!pinned)
        {
            var secs = Number(api.get("msg_fade")) || 5;
            fade_timer = setTimeout(function () { hide_bubble(false); },
                                    secs * 1000);
        }
    }

    function hide_bubble(now)
    {
        clearTimeout(fade_timer);
        var bubble = document.getElementById("sdc_m_bubble");
        if (!bubble) return;
        if (now)
        {
            bubble.classList.remove("sdc-m-show", "sdc-m-fade");
            recent = [];
            return;
        }
        bubble.classList.add("sdc-m-fade");
        fade_timer = setTimeout(function () {
            bubble.classList.remove("sdc-m-show", "sdc-m-fade");
            recent = [];
        }, 700);
    }

    // Bottom-centre, just above the quick-use bar and the thumb buttons
    // (whichever is higher), so it never covers the player.
    var last_place = "";
    function place_bubble()
    {
        var bubble = document.getElementById("sdc_m_bubble");
        if (!bubble || !bubble.classList.contains("sdc-m-show")) return;
        var w = window.innerWidth, h = window.innerHeight;
        var bw = bubble.offsetWidth, bh = bubble.offsetHeight;
        var floor = h;
        ["action-panel", "sdc_m_fight", "sdc_m_explore"].forEach(function (id) {
            var el = document.getElementById(id);
            // not offsetParent: it is null for position:fixed elements
            var r = el && window.getComputedStyle(el).display !== "none"
                && el.getBoundingClientRect();
            if (r && r.height > 0 && r.top < floor)
                floor = r.top;
        });
        var x = (w - bw) / 2;
        var y = floor - bh - 8;
        x = Math.round(Math.max(6, Math.min(w - bw - 6, x)));
        y = Math.round(Math.max(48, Math.min(h - bh - 6, y)));
        var key = x + "," + y;
        if (key === last_place) return;
        last_place = key;
        // left/top, not transform: the fade-in animation owns transform
        bubble.style.left = x + "px";
        bubble.style.top = y + "px";
    }

    // Dungeon touch: tap / swipe / long-press ---------------------------------

    var LONG_MS = 450;
    var SLOP = 18;          // px of movement before a touch becomes a swipe
    var DIRS = ["l", "n", "j", "b", "h", "y", "k", "u"];  // from +x, clockwise
    var touch = null;

    function dungeon_target(el)
    {
        return el && (el.id === "sdc_screen" || el.id === "dungeon");
    }

    // two-finger pinch on the dungeon steps the zoom
    var pinch = null;
    function span(ev)
    {
        var a = ev.touches[0], b = ev.touches[1];
        return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }

    function on_touchstart(ev)
    {
        if (active() && ev.touches.length === 2 && dungeon_target(ev.target))
        {
            cancel_touch();
            pinch = { d0: span(ev), done: false };
            return;
        }
        if (pinch) return;
        if (!active() || ev.touches.length !== 1
            || !dungeon_target(ev.target))
        {
            cancel_touch();
            return;
        }
        var t = ev.touches[0];
        touch = { x: t.clientX, y: t.clientY, target: ev.target,
                  moved: false, long: false, timer: null };
        touch.timer = setTimeout(long_press, LONG_MS);
        close_all();
    }

    function on_touchmove(ev)
    {
        if (pinch)
        {
            ev.preventDefault();
            if (ev.touches.length === 2 && !pinch.done)
            {
                var r = span(ev) / pinch.d0;
                if (r > 1.3 || r < 0.77)
                {
                    pinch.done = true;
                    set_zoom(zoom_step() + (r > 1 ? 1 : -1));
                }
            }
            return;
        }
        if (!touch) return;
        ev.preventDefault();
        var t = ev.touches[0];
        var dx = t.clientX - touch.x, dy = t.clientY - touch.y;
        if (!touch.moved && dx * dx + dy * dy > SLOP * SLOP)
        {
            touch.moved = true;
            clearTimeout(touch.timer);
        }
        touch.dx = dx;
        touch.dy = dy;
    }

    function on_touchend(ev)
    {
        if (pinch)
        {
            // swallow the lifted fingers; ignore until all are up
            if (ev.touches.length === 0) pinch = null;
            ev.preventDefault();
            return;
        }
        if (!touch) return;
        var t = touch;
        cancel_touch();
        if (ev.type === "touchcancel") return;
        if (t.long)
            ev.preventDefault();
        else if (more_pending())
        {
            // any tap or swipe answers --more--
            ev.preventDefault();
            send_keys("Enter");
        }
        else if (t.moved)
        {
            // no synthesized click after a swipe
            ev.preventDefault();
            swipe(t.dx, t.dy);
        }
        // plain tap: the browser's synthesized mouse events do the click
    }

    function cancel_touch()
    {
        if (touch && touch.timer)
            clearTimeout(touch.timer);
        touch = null;
    }

    function swipe(dx, dy)
    {
        var sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
        var key = DIRS[(sector + 8) % 8];
        // a long swipe (over a third of the short screen side) runs
        var run = Math.sqrt(dx * dx + dy * dy)
            > Math.min(window.innerWidth, window.innerHeight) / 3;
        send_keys(run ? key.toUpperCase() : key);
    }

    // right-click at the touch point = describe (through crt.js's mouse
    // forwarding when the curved screen is on top)
    function long_press()
    {
        if (!touch) return;
        touch.long = true;
        buzz();
        var init = { bubbles: true, cancelable: true, view: window,
                     clientX: touch.x, clientY: touch.y,
                     button: 2, buttons: 2 };
        touch.target.dispatchEvent(new MouseEvent("mousemove", init));
        touch.target.dispatchEvent(new MouseEvent("mousedown", init));
        init.buttons = 0;
        touch.target.dispatchEvent(new MouseEvent("mouseup", init));
    }

    function on_contextmenu(ev)
    {
        // Chrome's own long-press menu; the describe is sent by long_press()
        if (active() && dungeon_target(ev.target))
        {
            ev.preventDefault();
            ev.stopPropagation();
        }
    }

    var opts = { capture: true, passive: false };
    document.addEventListener("touchstart", on_touchstart, opts);
    document.addEventListener("touchmove", on_touchmove, opts);
    document.addEventListener("touchend", on_touchend, opts);
    document.addEventListener("touchcancel", on_touchend, opts);
    document.addEventListener("contextmenu", on_contextmenu, true);

    // Defenses in the pill -----------------------------------------------------
    // AC / EV / SH as a third line inside #sdc_vitals (closed sheet only; CSS
    // hides it when open, the full card shows them there). Only rebuilt when
    // a value changes, so its pop / "+N" float plays exactly once.
    var DEF_KEYS = ["ac", "ev", "sh"];
    var def_last = null, def_who = null;

    function def_row()
    {
        var row = document.getElementById("sdc_m_def");
        var vitals = document.getElementById("sdc_vitals");
        if (!row && vitals)
        {
            row = document.createElement("div");
            row.id = "sdc_m_def";
            vitals.appendChild(row);
        }
        return row;
    }

    function update_defenses(player)
    {
        var row = def_row();
        if (!row || player[DEF_KEYS[0]] == null) return;
        if (player.name !== def_who) { def_who = player.name; def_last = null; }
        DEF_KEYS.forEach(function (k) {
            var v = Number(player[k]) || 0;
            var chip = row.querySelector("[data-k='" + k + "']");
            if (!chip)
            {
                chip = document.createElement("span");
                chip.className = "sdc-m-d";
                chip.setAttribute("data-k", k);
                var ico = document.querySelector(
                    "#sdc_stats .sdc-ico[data-ico='" + k + "']");
                if (ico) chip.appendChild(ico.cloneNode(true));
                var n = document.createElement("b");
                chip.appendChild(n);
                row.appendChild(chip);
            }
            var num = chip.querySelector("b");
            // keep stock colouring (boosted / degenerated defense)
            var src = document.querySelector(
                "#sdc_stats .st-chip[data-k='" + k + "'] .sdc-num");
            num.className = src ? src.className : "";
            num.textContent = v;
            chip.classList.toggle("sdc-m-zero", v === 0);
            var old = def_last ? def_last[k] : null;
            if (old == null || old === v) return;
            var up = v > old;
            chip.classList.remove("sdc-m-up", "sdc-m-down");
            void chip.offsetWidth;      // restart the animation
            chip.classList.add(up ? "sdc-m-up" : "sdc-m-down");
            var f = document.createElement("i");
            f.className = "sdc-m-float";
            f.textContent = (up ? "+" : "−") + Math.abs(v - old);
            chip.appendChild(f);
            setTimeout(function () { f.remove(); }, 1300);
        });
        def_last = {};
        DEF_KEYS.forEach(function (k) { def_last[k] = Number(player[k]) || 0; });
        mirror_counter(row);
    }

    // The turn / speed chip from the stats card (the "Turn counter" option),
    // copied after the defenses. The card is rendered before hud_update, so
    // it is already current here.
    function mirror_counter(row)
    {
        var old = row.querySelector(".sdc-m-counter");
        var src = document.querySelector(
            "#sdc_stats .st-speed, #sdc_stats .st-turns");
        if (!src)
        {
            if (old) old.remove();
            return;
        }
        var chip = src.cloneNode(true);
        chip.classList.add("sdc-m-d", "sdc-m-counter");
        if (old) row.replaceChild(chip, old);
        else row.appendChild(chip);
    }
    api.on("hud_update", function (player) {
        try { update_defenses(player); }
        catch (e) { console.error("sdc: mobile defenses", e); }
    });

    // Lifecycle ---------------------------------------------------------------

    api.on("game_init", function () {
        apply_mode();
        build();
        document.body.classList.toggle("sdc-m-pinned",
                                       !!api.get("mobile_pin"));
        if (zoom_step())
            api.command("relayout");
    });
    api.on("game_cleanup", function () {
        if (msg_observer)
            msg_observer.disconnect();
        clearTimeout(fade_timer);
        cancel_touch();
        $(document.body).removeClass("sdc-m-open sdc-m-tools sdc-m-log");
    });
    api.on("frame", place_bubble);
    api.on("setting", function (key) {
        if (key === "mobile")
        {
            apply_mode();
            api.command("relayout");
        }
        else if (key === "mobile_zoom")
        {
            render_tools();
            api.command("relayout");
        }
        else if (key === "mobile_buttons")
        {
            render_sheet();
            render_pin();
        }
        else if (key === "mobile_pin")
            document.body.classList.toggle("sdc-m-pinned", !!api.get(key));
    });
    if (document.body)
        apply_mode();

    return {
        active: active,
        send_keys: send_keys,
    };
});
