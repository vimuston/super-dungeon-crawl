// Mobile UI: a touch layout over the same CRT view, for phones (and the
// android/ WebView wrapper). Styles live in mobile.css; everything is
// scoped to body.sdc-mobile, so desktop is untouched.
//
//   - vitals: the HP/MP panel shrinks to a small pill (top-left). Tapping
//     it enlarges the layout (name line + full stats card); a second tap
//     opens the character sheet (%) and shrinks it back to the pill.
//   - macros (Tools > Macros): user-defined key sequences, each with an
//     optional emoji shown in place of the label; pinned ones stack
//     bottom-right above Explore.
//   - quick row (top-right, left of Tools): Items (i), Spells (I; the
//     Memorise list M when no spell is known yet) and Skills (m). The
//     spell popup itself has Known / Learn tabs (mobilemenus.js).
//   - tools (top-right): a grid of commands, most used first (spells,
//     skills, abilities, innate, character, stairs, pick up, ...), Esc /
//     Enter, the on-screen keyboard, minimap and settings. Find opens its
//     own panel: a search box, recent searches and one-tap presets.
//   - tap your own tile = pick up (g); on stairs = take them (< / >); on an
//     altar = pray there (>, opens the join popup); on a shop = enter it.
//   - messages: the message pane is hidden; new messages show in a small
//     translucent bubble bottom-left above the bottom bar that fades out.
//     Tap the bubble for the recent log (or to answer --more--). Text
//     prompts bring the pane back automatically. y/n prompts get Yes / No buttons,
//     targeting prompts (invisibility with monsters in view, targeted
//     scrolls, aimed spells) Confirm / Cancel;
//     lettered choices in the log (Gozag's merchants and potions, Nemelex's
//     Draw Three, ally orders, Hepliaklqana's ancestor) get one button each.
//   - big thumb buttons: Fight (Tab) bottom-left, Explore (o) bottom-right.
//   - dungeon touch: tap = click a tile (travel / attack), swipe = one step
//     in 8 directions (a long swipe runs), long-press = describe.
//   - map view (X, or a Find result): tap the cursor = travel there; tap
//     elsewhere = move the cursor there (tap it again to travel). The < / >
//     buttons beside Close map jump the cursor to the next up / down stairs.
//   - blink targeting ("Blink to where?", "Hop to where?"): the cells you
//     can land on are tinted; tap one to go there. A tap anywhere else does
//     nothing (crawl would cancel the blink).
//
// Options:
//   "mobile"         auto / on / off. Auto = touch screen or the wrapper.
//   "msg_fade"       seconds the message bubble stays up.
//   "mobile_zoom"    tile zoom step, gesture-only (pinch with 2.5D off;
//                    with 2.5D on the tiles stay at Fit and pinch drives
//                    the 2.5D zoom). Not in the settings panel.
//   "mobile_macros"  [{label, keys, icon, pin, img?, spell?, char?}] macros
//                    (Tools > Macros), kept across characters. Spell pins
//                    (Pin in the spell menu, mobilemenus.js) add img (the
//                    spell tile as a data URL), spell (its name: cast as z +
//                    its current letter) and char (the character's name);
//                    they are dropped for a new character or another one.
//                    Migrated once from the old "mobile_buttons" list.
//
// Key specs (macros, tools): space-separated tokens. Named keys Tab,
// Esc, Enter, Space, Bksp; Ctrl+X for control keys; anything else is typed
// as characters ("za" = z then a).
//
// The wrapper (android/) calls window.sdcBack() for the back button and
// exposes window.SdcNative ({isLocal(), manageSaves()}).
define(["jquery", "comm", "./sdc_api", "./dungeon_renderer", "./enums", "./options",
        "./player", "./view_data", "./map_knowledge"],
function ($, comm, api, renderer, enums, options, player, view_data,
          map_knowledge) {
    "use strict";

    api.register_option({ key: "mobile", label: "Mobile UI", default: "auto",
                          choices: [["auto", "Auto"], ["on", "On"],
                                    ["off", "Off"]] });
    // It shipped "on" by default, which put desktop browsers in the mobile
    // UI too, and the whole settings object is stored, so an untouched "on"
    // is indistinguishable from a chosen one: switch everyone to Auto once
    // (touch devices and the app still get the mobile UI).
    if (!api.settings.mobile_auto_v2)
    {
        if (api.settings.mobile === "on") api.settings.mobile = "auto";
        api.settings.mobile_auto_v2 = true;
        api.save();
    }
    api.register_option({ key: "msg_fade", label: "Message fade (s)",
                          default: 5, range: { min: 2, max: 15, step: 1 } });
    // Stock webtiles shrinks tiles until a 17-cell diameter fits, which is
    // ~20px on a landscape phone. Zoom k shows 17/k cells across the short
    // side instead (fit_to is wrapped below; click mapping stays stock).
    // Gesture-only (no panel row): 0 = Fit.
    var ZOOMS = [1, 1.5, 2, 3, 4];
    api.register_option({ key: "mobile_zoom", default: 0 });
    // the panel setting is gone: start everyone from Fit once
    if (!api.settings.mobile_zoom_v2)
    {
        api.settings.mobile_zoom = 0;
        api.settings.mobile_zoom_v2 = true;
        api.save();
    }
    // Macros: no defaults (Fight / Explore have their own thumb buttons).
    api.register_option({ key: "mobile_macros", default: null });
    migrate_macros();

    // Most used first. A function instead of keys opens a panel. Items,
    // Spells and Skills live on the quick row (QUICK) instead.
    var TOOLS = [
        ["Abilities", "a"], ["Innate", "A"], ["Up <", "<"], ["Down >", ">"],
        ["Character", "%"], ["Shopping list", "$"], ["Pick up", "g"],
        ["Rest", "5"],
        ["Wait", "s"], ["Find", function () { toggle_find(true); }],
        ["Macros", function () { toggle_macros(true); }], ["Map", "X"],
        ["Travel", "G"], ["Look", "x"], ["In view", "Ctrl+X"],
        ["God", "^"], ["Known items", "\\"], ["Lookup", "?/"],
        ["Enter", "Enter"], ["Esc", "Esc"], ["History", "Ctrl+P"],
    ];

    // Find (Ctrl+F) presets: crawl matches item names plus class prefixes
    // ("weapon", "artefact", ...) and dungeon features.
    var FIND_PRESETS = [
        ["Stairs", "stair"], ["Altars", "altar"], ["Shops", "shop"],
        ["Portals", "portal"], ["Runes", "rune"], ["Artefacts", "artefact"],
        ["Potions", "potion"], ["Scrolls", "scroll"], ["Wands", "wand"],
        ["Jewellery", "jewellery"], ["Armour", "armour"],
        ["Weapons", "weapon"], ["Books", "book"], ["Staves", "staff"],
        ["Everything", "."],
    ];
    var FIND_RECENT_MAX = 6;
    api.register_option({ key: "mobile_find_recent", default: [] });

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

    // client.html lays the (responsive) lobby out at device width. In game,
    // the mobile UI keeps that; with it off, use stock webtiles' fixed 860px
    // page, which the desktop game layout expects.
    var DESKTOP_VIEWPORT = "width=860, initial-scale=1.0";
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
        meta.content = on
            ? "width=device-width, initial-scale=1, maximum-scale=1,"
              + " user-scalable=no, viewport-fit=cover"
            : DESKTOP_VIEWPORT;
        if (!on)
            close_all();
    }

    // with 2.5D on, pinch drives its camera zoom and the tiles stay at Fit
    function zoom_step()
    {
        if (api.settings.depth !== false) return 0;
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

    function macros()
    {
        var m = api.get("mobile_macros");
        return Array.isArray(m) ? m : [];
    }

    function set_macros(list)
    {
        api.set("mobile_macros", list);
    }

    // One-time: the old sheet quick buttons become macros, minus the stock
    // Explore / Fight pair; the old global "pin" setting becomes per macro.
    function migrate_macros()
    {
        if (Array.isArray(api.get("mobile_macros"))) return;
        var old = api.get("mobile_buttons"), pin = !!api.get("mobile_pin");
        var list = (Array.isArray(old) ? old : []).filter(function (b) {
            return b && b.keys
                && !(b.label === "Explore" && b.keys === "o")
                && !(b.label === "Fight" && b.keys === "Tab");
        }).map(function (b) {
            return { label: b.label || b.keys, keys: b.keys, icon: "",
                     pin: pin };
        });
        api.set("mobile_macros", list);
    }

    // the keys a macro sends; a pinned spell is cast by its current letter
    // (letters can be reassigned), falling back to the one it was pinned with
    function macro_keys(m)
    {
        if (!m.spell || !Array.isArray(player.spells)) return m.keys;
        for (var i = 0; i < player.spells.length; i++)
        {
            var x = player.spells[i];
            if (x && x.name === m.spell && x.key) return "z" + x.key;
        }
        return m.keys;
    }

    function macro_img(m)
    {
        return $("<img class='sdc-m-mimg' alt=''>").attr("src", m.img);
    }

    // what a macro button shows: its tile or emoji if it has one, else the
    // label
    function macro_button(m, after)
    {
        var btn = key_button(m.icon || m.label,
                             function () { return macro_keys(m); }, after);
        if (m.img)
            btn.text("").append(macro_img(m)).addClass("sdc-m-imgbtn")
                .attr({ title: m.label, "aria-label": m.label });
        else if (m.icon)
            btn.addClass("sdc-m-emoji")
                .attr({ title: m.label + " (" + m.keys + ")",
                        "aria-label": m.label });
        return btn;
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

    var editing = -1;       // index of the macro in the edit form, or -1

    function key_button(label, keys, after)
    {
        return $("<button type='button' class='sdc-m-btn'>")
            .text(label)
            .attr("title", typeof keys === "function" ? null : keys)
            .on("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                buzz();
                if (after) after();
                var k = typeof keys === "function" ? keys() : keys;
                if (k) send_keys(k);
            });
    }

    function build()
    {
        $("#sdc_m_toolbtn, #sdc_m_quick, #sdc_m_tools, #sdc_m_bubble, #sdc_m_macros,"
          + " #sdc_m_pin, #sdc_m_logclose, #sdc_m_find, #sdc_m_mapclose,"
          + " .sdc-m-mapstair,"
          + " .sdc-m-big").remove();
        var normal = $("#normal");

        // the two thumb buttons: fight bottom-left, explore bottom-right
        key_button("Fight", "Tab", close_all)
            .attr("id", "sdc_m_fight").addClass("sdc-m-big")
            .appendTo(normal);
        key_button("Explore", "o", close_all)
            .attr("id", "sdc_m_explore").addClass("sdc-m-big")
            .appendTo(normal);
        // map view (X) hides the thumb buttons; this is its way out
        key_button("Close map", "Esc", close_all)
            .attr("id", "sdc_m_mapclose").appendTo(normal);
        // and its stairs finders: < / > jump the map cursor to the next up /
        // down staircase on the level (crawl's own map keys); tap the cursor
        // to travel there
        [["<", "Next up stairs", "sdc_m_mapup"],
         [">", "Next down stairs", "sdc_m_mapdown"]].forEach(function (b) {
            key_button(b[0], b[0])
                .attr({ id: b[2], "aria-label": b[1] })
                .addClass("sdc-m-mapstair").appendTo(normal);
        });

        $("<button type='button' id='sdc_m_toolbtn' aria-label='Tools'>")
            .html("&#9776;")
            .on("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                toggle_tools();
            })
            .appendTo(normal);
        build_quick().appendTo(normal);
        $("<div id='sdc_m_tools' class='sdc-panel'>").appendTo(normal);
        render_tools();
        $("<div id='sdc_m_find' class='sdc-panel'>").appendTo(normal);
        $("<div id='sdc_m_macros' class='sdc-panel'>").appendTo(normal);

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

        // tap the pill / statuses: enlarge the vitals + stats card; tap
        // again (pill, statuses or the open stats card) for the character
        // sheet (%), back to the pill underneath
        normal.off("click.sdcm")
            .on("click.sdcm", "#sdc_vitals, #sdc_statuses, #sdc_stats",
                function (ev) {
                if (!active()) return;
                ev.preventDefault();
                var was_open = document.body.classList.contains("sdc-m-open");
                toggle_vitals();
                if (was_open && command_mode())
                    send_keys("%");
            });

        watch_messages();
    }

    // Quick row -----------------------------------------------------------------
    // The menus opened most often, one tap away beside the Tools button.

    var QUICK_SVG = "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor'"
                    + " stroke-width='1.7' stroke-linecap='round'"
                    + " stroke-linejoin='round' aria-hidden='true'>";
    var QUICK = [
        // backpack
        { label: "Items", keys: "i",
          icon: "<path d='M8 7V5.5a4 4 0 0 1 8 0V7'/>"
                + "<rect x='4.5' y='7' width='15' height='14' rx='3'/>"
                + "<path d='M8.5 13h7v4h-7z'/>" },
        // open book with a star
        { label: "Spells", keys: spells_keys,
          icon: "<path d='M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5"
                + "C14 18 17 17.5 20.5 18V5C17 4.5 14 5 12 6.5zM12 6.5v13'/>"
                + "<path d='M16.3 8.5l.6 1.3 1.4.2-1 1 .2 1.4-1.2-.7-1.2.7.2-1.4"
                + "-1-1 1.4-.2z' fill='currentColor' stroke-width='0.8'/>" },
        // rising bars
        { label: "Skills", keys: "m",
          icon: "<path d='M4 20h16'/><rect x='5.5' y='13' width='3' height='5'/>"
                + "<rect x='10.5' y='9' width='3' height='9'/>"
                + "<rect x='15.5' y='5' width='3' height='13'/>" },
    ];

    // Known spells, or straight to the library while none is known yet
    // (I only prints "You don't know any spells." then).
    function spells_keys()
    {
        return Array.isArray(player.spells) && !player.spells.length
            ? "M" : "I";
    }

    function build_quick()
    {
        var row = $("<div id='sdc_m_quick'>");
        QUICK.forEach(function (q) {
            $("<button type='button' class='sdc-m-btn sdc-m-quick'>")
                .attr("aria-label", q.label)
                .html(QUICK_SVG + q.icon + "</svg><span>" + q.label
                      + "</span>")
                .on("click", function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    buzz();
                    close_all();
                    send_keys(typeof q.keys === "function" ? q.keys()
                                                            : q.keys);
                })
                .appendTo(row);
        });
        return row;
    }

    // Macros panel -----------------------------------------------------------
    // A list of macros (run / pin / edit / delete) and a form to add or edit
    // one. Opened from Tools > Macros; pinned macros stack bottom-right.

    function small_button(html, label, fn, cls)
    {
        return $("<button type='button' class='sdc-m-btn sdc-m-ghost'>")
            .addClass(cls || "")
            .html(html)
            .attr({ title: label, "aria-label": label })
            .on("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                buzz();
                fn();
            });
    }

    function render_macros()
    {
        var panel = $("#sdc_m_macros").empty();
        if (!panel.length) return;
        var head = $("<div class='sdc-m-mhead'>").appendTo(panel);
        head.append($("<span>").text("Macros"),
                    small_button("&times;", "Close",
                                 function () { toggle_macros(false); }));
        var list = macros();
        if (!list.length)
            panel.append($("<div class='sdc-m-hint'>").text(
                "No macros yet. Add one below."));
        list.forEach(function (m, i) {
            var row = $("<div class='sdc-m-mrow'>").appendTo(panel);
            var run = macro_button(m, close_all).addClass("sdc-m-mrun");
            if (m.img || m.icon)
                run.text("").append(m.img ? macro_img(m)
                                    : $("<span class='sdc-m-micon'>").text(m.icon),
                                    $("<span>").text(m.label));
            run.append($("<span class='sdc-m-mkeys'>").text(m.keys));
            row.append(run,
                small_button("&#128204;", m.pin ? "Unpin" : "Pin", function () {
                    var l = macros().slice();
                    l[i] = $.extend({}, l[i], { pin: !l[i].pin });
                    set_macros(l);
                }, m.pin ? "sdc-m-on" : ""),
                small_button("&#9998;", "Edit", function () {
                    editing = i;
                    render_macros();
                }, editing === i ? "sdc-m-on" : ""),
                small_button("&times;", "Delete", function () {
                    var l = macros().slice();
                    l.splice(i, 1);
                    if (editing === i) editing = -1;
                    else if (editing > i) editing--;
                    set_macros(l);
                }, "sdc-m-del"));
        });
        panel.append(macro_form());
    }

    // icon + label + keys inputs; typing here must not reach the game
    function macro_form()
    {
        var cur = editing >= 0 ? macros()[editing] : null;
        if (!cur) editing = -1;
        var form = $("<form class='sdc-m-form'>");
        var icon = $("<input type='text' class='sdc-m-iconin'"
                     + " placeholder='Emoji' maxlength='16'>");
        var label = $("<input type='text' placeholder='Label' maxlength='12'>");
        var keys = $("<input type='text' placeholder='Keys, e.g. za or Ctrl+F'>");
        if (cur)
        {
            icon.val(cur.icon || "");
            label.val(cur.label);
            keys.val(cur.keys);
        }
        form.append(icon, label, keys,
                    $("<button type='submit' class='sdc-m-btn'>")
                        .text(cur ? "Save" : "Add"));
        if (cur)
            form.append(small_button("Cancel", "Cancel editing", function () {
                editing = -1;
                render_macros();
            }));
        form.append($("<div class='sdc-m-hint'>").text(
            "Emoji (optional) replaces the label on the button. Keys: Tab Esc"
            + " Enter Space Bksp, Ctrl+X, or characters. 📌 pins a"
            + " macro on screen."));
        form.find("input").attr({ autocomplete: "off", autocapitalize: "off",
                                  autocorrect: "off", spellcheck: "false" })
            .on("keydown keypress keyup input", function (ev) {
                ev.stopPropagation();
            });
        form.on("submit", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            var k = keys.val().trim();
            if (!k) return;
            var m = $.extend({}, cur || {},
                             { label: label.val().trim() || k, keys: k,
                               icon: icon.val().trim(),
                               pin: cur ? !!cur.pin : false });
            // edited keys: no longer resolved from the spell's name
            if (cur && cur.spell && k !== cur.keys) delete m.spell;
            var l = macros().slice();
            if (cur) l[editing] = m;
            else l.push(m);
            editing = -1;
            set_macros(l);
        });
        return form;
    }

    function render_pin()
    {
        var pin = $("#sdc_m_pin").empty();
        macros().forEach(function (m) {
            if (m.pin) pin.append(macro_button(m));
        });
    }

    function toggle_macros(open)
    {
        var b = document.body.classList;
        if (open)
        {
            toggle_vitals(false);
            toggle_find(false);
            b.remove("sdc-m-tools");
            editing = -1;
            render_macros();
            b.add("sdc-m-macros");
        }
        else if (b.contains("sdc-m-macros"))
        {
            b.remove("sdc-m-macros");
            editing = -1;
            var el = document.activeElement;
            if (el && $(el).closest("#sdc_m_macros").length) el.blur();
        }
    }

    function render_tools()
    {
        var tools = $("#sdc_m_tools").empty();
        var grid = $("<div class='sdc-m-grid'>").appendTo(tools);
        TOOLS.forEach(function (t) {
            if (typeof t[1] === "function")
                grid.append($("<button type='button' class='sdc-m-btn'>")
                    .text(t[0])
                    .on("click", function (ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        buzz();
                        t[1]();
                    }));
            else
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

    // Find panel ---------------------------------------------------------------
    // A text box plus search history and presets as one-tap chips. Sends
    // Ctrl+F, the text and Enter, so there is no on-screen keyboard dance.

    function find_recent()
    {
        var r = api.get("mobile_find_recent");
        return Array.isArray(r) ? r : [];
    }

    function run_find(text)
    {
        text = String(text || "").trim();
        if (!text) return;
        var list = find_recent().filter(function (t) { return t !== text; });
        list.unshift(text);
        api.set("mobile_find_recent", list.slice(0, FIND_RECENT_MAX));
        close_all();
        // Type only once crawl shows its "Search for what?" prompt: if Ctrl+F
        // is swallowed (a pending --more--, a leftover results popup) the text
        // would run as commands ("altar" -> a = abilities). No prompt: Esc
        // clears whatever ate it and Ctrl+F is tried once more, else give up.
        var token = ++find_token;
        // a popup only while another layout is open (a results list),
        // otherwise an input in the message pane (msgwin_get_line)
        function prompt_up()
        {
            return !!document.querySelector(
                "#ui-stack .msgwin-get-line input,"
                + " #messages .game_message input");
        }
        function attempt(tries_left)
        {
            if (tries_left < 2) send_keys("Esc");
            send_keys("Ctrl+F");
            var started = Date.now();
            (function poll() {
                if (token !== find_token) return;
                if (prompt_up())
                {
                    for (var i = 0; i < text.length; i++)
                        comm.send_message("input", { text: text.charAt(i) });
                    send_keys("Enter");
                    return;
                }
                if (Date.now() - started < 1500)
                    setTimeout(poll, 40);
                else if (tries_left > 1)
                    attempt(tries_left - 1);
            })();
        }
        attempt(2);
    }
    var find_token = 0;

    function find_chip(label, text)
    {
        return $("<button type='button' class='sdc-m-btn'>")
            .text(label)
            .attr("title", text)
            .on("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                buzz();
                run_find(text);
            });
    }

    function render_find()
    {
        var panel = $("#sdc_m_find").empty();
        if (!panel.length) return null;
        var form = $("<form class='sdc-m-form sdc-m-findform'>");
        var input = $("<input type='search' enterkeyhint='search'"
                      + " placeholder='Item or feature'>");
        input.attr({ autocomplete: "off", autocapitalize: "off",
                     autocorrect: "off", spellcheck: "false" })
            .on("keydown keypress keyup input", function (ev) {
                ev.stopPropagation();
                if (ev.type === "keydown" && ev.key === "Escape")
                    toggle_find(false);
            });
        var close = $("<button type='button' class='sdc-m-btn sdc-m-ghost'>")
            .html("&times;")
            .attr("aria-label", "Close")
            .on("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                toggle_find(false);
            });
        form.append(input,
                    $("<button type='submit' class='sdc-m-btn'>").text("Find"),
                    close);
        form.on("submit", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            input.blur();
            run_find(input.val());
        });
        panel.append(form);
        var recent_list = find_recent();
        if (recent_list.length)
        {
            panel.append($("<div class='sdc-m-findhead'>").text("Recent"));
            var row = $("<div class='sdc-m-findchips'>").appendTo(panel);
            recent_list.forEach(function (t) { row.append(find_chip(t, t)); });
        }
        panel.append($("<div class='sdc-m-findhead'>").text("Quick"));
        var grid = $("<div class='sdc-m-findgrid'>").appendTo(panel);
        FIND_PRESETS.forEach(function (p) {
            grid.append(find_chip(p[0], p[1]));
        });
        panel.append($("<div class='sdc-m-hint'>").text(
            "Lists everything you have seen; tap a result to travel there."
            + " Combine terms with && or ||, exclude with !"));
        return input;
    }

    function toggle_find(open)
    {
        var b = document.body.classList;
        if (open)
        {
            toggle_vitals(false);
            toggle_macros(false);
            b.remove("sdc-m-tools");
            var input = render_find();
            b.add("sdc-m-find");
            // still inside the tap, so phones raise the keyboard
            if (input) input.trigger("focus");
        }
        else if (b.contains("sdc-m-find"))
        {
            b.remove("sdc-m-find");
            var el = document.activeElement;
            if (el && $(el).closest("#sdc_m_find").length) el.blur();
        }
    }

    // enlarged vitals: name line, labels and the full stats card
    function toggle_vitals(force)
    {
        var b = document.body.classList;
        var open = force === undefined ? !b.contains("sdc-m-open") : force;
        if (open)
            b.remove("sdc-m-tools");
        b.toggle("sdc-m-open", open);
    }

    function toggle_tools(force)
    {
        var b = document.body.classList;
        var open = force === undefined ? !b.contains("sdc-m-tools") : force;
        if (open)
        {
            toggle_vitals(false);
            // one menu at a time: the quick-use bar's MENU slot opens
            // crawl's game menu, which Tools would cover; Esc it first
            var top = $("#ui-stack").children(".ui-popup").last();
            if (top.find(".menu_game_menu").length)
                send_keys("Esc");
        }
        b.toggle("sdc-m-tools", open);
    }

    // ...and the other way round: any popup crawl pushes (the game menu,
    // inventory, ...) closes Tools, which would otherwise sit on top of it.
    var stack_observer = null, observed_stack = null;
    function watch_stack()
    {
        var stack = document.getElementById("ui-stack");
        if (!stack || stack === observed_stack) return;
        if (stack_observer) stack_observer.disconnect();
        observed_stack = stack;
        stack_observer = new MutationObserver(function (records) {
            for (var i = 0; i < records.length; i++)
            {
                var added = records[i].addedNodes;
                for (var j = 0; j < added.length; j++)
                {
                    if (added[j].classList
                        && added[j].classList.contains("ui-popup"))
                    {
                        toggle_tools(false);
                        return;
                    }
                }
            }
        });
        stack_observer.observe(stack, { childList: true });
    }

    function toggle_log(open)
    {
        document.body.classList.toggle("sdc-m-log", open);
        if (open)
        {
            $("#sdc_m_logclose").appendTo("#message_pane");
            var c = document.getElementById("messages_container");
            if (c) c.scrollTop = c.scrollHeight;
            hide_bubble(true);
        }
    }

    function close_all()
    {
        if (!document.body) return;
        toggle_vitals(false);
        toggle_tools(false);
        toggle_find(false);
        toggle_macros(false);
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
                 || b.contains("sdc-m-find") || b.contains("sdc-m-macros")
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
            dress_msg_input();
        });
        msg_observer.observe(pane, { childList: true, subtree: true,
                                     attributes: true,
                                     attributeFilter: ["style"] });
        dress_msg_input();
        // messages that arrived before the HUD was built (reconnect)
        if (more_pending())
        {
            recent = $("#messages .game_message").slice(-2).toArray();
            show_bubble();
        }
    }

    // Text prompts typed into the message pane (msgwin_get_line: renaming
    // Hepliaklqana's ancestor, annotations, ...): a touch bar under the
    // input. textinput.js submits on an Enter keydown and cancels on Esc,
    // so the buttons trigger exactly those.
    function msg_input()
    {
        return $("#messages .game_message input.text").last();
    }

    function dress_msg_input()
    {
        var pane = document.getElementById("message_pane");
        if (!pane) return;
        var bar = document.getElementById("sdc_m_inbar");
        var on = active() && msg_input().length > 0;
        if (!on)
        {
            if (bar) bar.remove();
            return;
        }
        if (bar && bar.parentNode === pane) return;
        function key(code)
        {
            return function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                buzz();
                msg_input().trigger($.Event("keydown",
                                            { which: code, keyCode: code }));
            };
        }
        function b(label, cls, fn)
        {
            return $("<button type='button' class='sdc-m-btn'>")
                .addClass(cls).text(label).on("click", fn);
        }
        bar = $("<div id='sdc_m_inbar'>");
        bar.append(b("Keyboard", "", function (ev) {
            ev.preventDefault();
            msg_input().trigger("focus");
        }));
        bar.append(b("Clear", "", function (ev) {
            ev.preventDefault();
            msg_input().val("").trigger("focus");
        }));
        bar.append(b("Cancel", "", key(27)));
        bar.append(b("OK", "sdc-m-inbar-ok", key(13)));
        $(pane).append(bar);
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

    // Level-up stat gain ("Increase (S)trength, (I)ntelligence, or
    // (D)exterity?"): three big cards, current value -> value after the
    // gain. Crawl has no cancel here and wants capitals unless
    // easy_confirm = all, so the cards always send S / I / D.
    var STAT_RE = /Increase \(s\)trength, \(i\)ntelligence, or \(d\)exterity\?/i;
    var STATS = [["str", "Str", "Strength", "S"],
                 ["int", "Int", "Intelligence", "I"],
                 ["dex", "Dex", "Dexterity", "D"]];

    function stat_picker()
    {
        // "a dramatic increase" = Divine attributes (+4), otherwise +2
        var gain = recent.some(function (n) {
            return /dramatic increase in your attributes/i.test(n.textContent);
        }) ? 4 : 2;
        var box = document.createElement("div");
        box.className = "sdc-m-statpick";
        STATS.forEach(function (s) {
            var cur = Number(player[s[0]]);
            var max = Number(player[s[0] + "_max"]);
            var b = key_button("", s[3], hide_now);
            b.addClass("sdc-m-stat").attr("aria-label", "Increase " + s[2]);
            b.append($("<span class='sdc-m-stat-name'>").text(s[1]));
            if (isFinite(cur))
            {
                b.append($("<span class='sdc-m-stat-cur'>").text(cur));
                b.append($("<span class='sdc-m-stat-new'>")
                    .text("→ " + (cur + gain)));
                // drained: show the base value it restores to
                if (isFinite(max) && max > cur)
                    b.append($("<span class='sdc-m-stat-max'>")
                        .text("max " + max + " → " + (max + gain)));
            }
            else
                b.append($("<span class='sdc-m-stat-new'>").text("+" + gain));
            box.appendChild(b[0]);
        });
        return box;
    }

    // Lettered choices printed into the message log. Each kind becomes one
    // big button per choice (sending its letter); the choice lines leave
    // the bubble and only the question stays, as its caption.
    //   - "[x] text" lines right above a question: Gozag's "Fund which
    //     merchant?" ("  [a]   973 gold - Cranius' Magic Scroll Boutique"),
    //     "Purchase which effect?" ("  [a] - 420 gold - heal wounds, ...").
    //   - Nemelex's Draw Three: "You draw... (choose one card, ? for their
    //     descriptions)" then "a - Velocity" lines. No cancel; ? describes.
    //   - orders (t): "What are your orders?", " t - Shout!", "Orders for
    //     allies: a - Attack new target.", "r - Retreat!  s - Stop
    //     attacking." ..., " Anything else - Cancel."
    //   - Hepliaklqana's ancestor: "Was X a) male, b) female, or c)
    //     neither? (Currently male.)"; anything but a letter keeps it.
    var CHOICE_RE = /^[^\[]*\[([a-z])\]\s+(?:-\s+)?(\S.*)$/i;
    var GOLD_RE = /^(\d+) gold - (.+)$/;
    var DRAW_RE = /^You draw\.\.\. \(choose one card/;
    var CARD_RE = /^([a-z]) - (\S.*)$/;
    var ORDERS_RE = /^What are your orders\?$/;
    var ORDERS_END_RE = /^Anything else - Cancel\.?$/;
    var ORDER_RE = /([a-z]) - (.+?)(?=\s+[a-z] - |$)/g;
    var GENDER_RE = /a\) (\w+), b\) (\w+),? or c\) (\w+)\?(?:\s*\(Currently (\w+)\.\))?/;

    function msg_text(n)
    {
        var c = n.cloneNode(true);
        $(c).find(".prefix_glyph, #text_cursor, input").remove();
        return c.textContent.replace(/\s+/g, " ").trim();
    }

    // message lines above n (top first) while ok(text) holds
    function lines_above(n, ok)
    {
        var out = [];
        for (n = n.previousElementSibling; n; n = n.previousElementSibling)
        {
            if (!n.classList.contains("game_message") || !ok(msg_text(n)))
                break;
            out.unshift(n);
        }
        return out;
    }

    // -> {head: question line, list: [{key, text, cls}],
    //     extra: [[label, keys]]} or null
    function letter_choices()
    {
        var last = recent[recent.length - 1];
        if (!last || !last.isConnected) return null;
        var t = msg_text(last), m, list = [], nodes;

        if ((m = GENDER_RE.exec(t)))
        {
            [1, 2, 3].forEach(function (i) {
                list.push({ key: "abc"[i - 1], text: m[i],
                            cls: m[i] === m[4] ? "sdc-m-choice-cur" : "" });
            });
            return { head: last, list: list, extra: [["Keep", "Esc"]] };
        }

        if (ORDERS_END_RE.test(t))
        {
            nodes = lines_above(last, function (x) { return !ORDERS_RE.test(x); });
            var head = nodes.length ? nodes[0].previousElementSibling
                                    : last.previousElementSibling;
            if (!head || !ORDERS_RE.test(msg_text(head))) return null;
            nodes.forEach(function (n) {
                var x = msg_text(n).replace(/^Orders for allies:\s*/, "");
                ORDER_RE.lastIndex = 0;
                while ((m = ORDER_RE.exec(x)))
                    list.push({ key: m[1], text: m[2].replace(/\.$/, "") });
            });
            return list.length ? { head: head, list: list,
                                   extra: [["Cancel", "Esc"]] }
                               : null;
        }

        if (CARD_RE.test(t))
        {
            nodes = lines_above(last, function (x) { return CARD_RE.test(x); });
            nodes.push(last);
            var draw = nodes[0].previousElementSibling;
            if (!draw || !DRAW_RE.test(msg_text(draw))) return null;
            nodes.forEach(function (n) {
                m = CARD_RE.exec(msg_text(n));
                list.push({ key: m[1], text: m[2] });
            });
            return { head: draw, list: list, extra: [["Describe cards", "?"]] };
        }

        if (!prompt_pending() || YN_RE.test(t) || CHOICE_RE.test(t)) return null;
        nodes = lines_above(last, function (x) { return CHOICE_RE.test(x); });
        if (nodes.length < 2) return null;
        nodes.forEach(function (n) {
            m = CHOICE_RE.exec(msg_text(n));
            list.push({ key: m[1], text: m[2] });
        });
        return { head: last, list: list, extra: [] };
    }

    function choice_picker(ch)
    {
        var gold = Number(player.gold);
        var box = document.createElement("div");
        box.className = "sdc-m-choices";
        ch.list.forEach(function (c) {
            var b = key_button("", c.key, hide_now);
            b.addClass("sdc-m-choice " + (c.cls || ""));
            b.append($("<span class='sdc-m-choice-key'>").text(c.key));
            var g = GOLD_RE.exec(c.text);
            b.append($("<span class='sdc-m-choice-name'>")
                .text(g ? g[2] : c.text));
            if (g)
            {
                var price = Number(g[1]);
                b.append($("<span class='sdc-m-choice-price'>")
                    .text(price + " gold"));
                // crawl just says "not enough gold" and asks again
                if (isFinite(gold) && price > gold)
                    b.addClass("sdc-m-choice-poor");
            }
            else if (c.cls === "sdc-m-choice-cur")
                b.append($("<span class='sdc-m-choice-price'>").text("current"));
            box.appendChild(b[0]);
        });
        if (ch.extra.length)
        {
            var row = document.createElement("div");
            row.className = "sdc-m-yn";
            ch.extra.forEach(function (e) {
                // ? opens a popup and the list comes back: keep the bubble
                row.appendChild(key_button(e[0], e[1],
                                           e[1] === "?" ? null : hide_now)[0]);
            });
            box.appendChild(row);
        }
        return box;
    }

    function prompt_pending()
    {
        if (more_pending()) return true;
        var text = last_text();
        return /\?\s*(\(y\/n\)|\[[^\]]*\])?\s*_?\s*$/i.test(text)
            || /\(y\/n\)/i.test(text);
    }

    // Targeting prompts (crawl's direction chooser) that wait for a confirm
    // rather than y/n: quaffing invisibility with monsters in view
    // ("Confirm quaff"), targeted scrolls, aimed spells. They print a key
    // hint line ("Press: ? - help, ..."), possibly followed by the cursor's
    // description ("Confirm quaff: an orc"). Look mode (x) prints one too,
    // but with describe / travel: no buttons there. Enter selects and Esc
    // cancels in every targeter.
    var TARGET_HINT_RE = /Press: \? - help/;
    function targeting_pending()
    {
        var n = recent.length;
        for (var i = n - 1; i >= 0 && i >= n - 2; i--)
        {
            var t = recent[i].textContent;
            if (!TARGET_HINT_RE.test(t)) continue;
            if (/v - describe|\. - travel/.test(t)) return false;
            return i === n - 1 || /\S: \S/.test(recent[n - 1].textContent);
        }
        return false;
    }

    function show_bubble()
    {
        if (!active()) return;
        var bubble = document.getElementById("sdc_m_bubble");
        if (!bubble) return;
        var choices = !more_pending() && letter_choices();
        // only the question above the buttons (the list may be longer
        // than the bubble keeps)
        if (choices) recent = [choices.head];
        recent = recent.filter(function (n) { return n.isConnected; })
                       .slice(-MAX_LINES);
        if (!recent.length && !more_pending())
        {
            hide_bubble(true);
            return;
        }
        bubble.innerHTML = "";
        var aiming = !choices && !more_pending() && targeting_pending();
        var pinned = !!choices || aiming || prompt_pending();
        recent.forEach(function (n) {
            var line = n.cloneNode(true);
            line.removeAttribute("id");
            $(line).find(".prefix_glyph, #text_cursor, input").remove();
            line.className = "sdc-m-line";
            bubble.appendChild(line);
        });
        if (more_pending())
        {
            var more = document.createElement("div");
            more.className = "sdc-m-more";
            more.textContent = "-- tap for more --";
            bubble.appendChild(more);
        }
        else if (choices)
            bubble.appendChild(choice_picker(choices));
        else if (aiming)
        {
            var aim = document.createElement("div");
            aim.className = "sdc-m-yn";
            aim.appendChild(key_button("Confirm", "Enter", hide_now)[0]);
            aim.appendChild(key_button("Cancel", "Esc", hide_now)[0]);
            bubble.appendChild(aim);
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
        else if (pinned && STAT_RE.test(last_text()))
            bubble.appendChild(stat_picker());
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

    // Bottom-left, just above the quick-use bar and the thumb buttons
    // (whichever is higher), so it never covers the player or the pinned
    // macros stacked over Explore.
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
        var x = 12;
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

    // Two fingers on the dungeon. With the 2.5D view on they drive its camera
    // (like the middle mouse drag in depth.js): pinch = zoom, twist = rotate,
    // both fingers swiping sideways = rotate. The first clear motion picks
    // the mode for that gesture. A third finger switches to perspective
    // (three fingers swiping up/down), undoing what the two did so far.
    // With 2.5D off, a pinch steps the tile zoom instead. With "Lock
    // rotation" on, twists and sideways swipes leave the rotation alone.
    var pinch = null;
    var CAM_PERSP = 0.3, CAM_DEG = 0.25;    // % / deg per px of parallel swipe
    function span(ev)
    {
        var a = ev.touches[0], b = ev.touches[1];
        return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
    function twist(ev)
    {
        var a = ev.touches[0], b = ev.touches[1];
        return Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
    }
    function mid(ev)
    {
        var n = Math.min(3, ev.touches.length), x = 0, y = 0;
        for (var i = 0; i < n; i++)
        {
            x += ev.touches[i].clientX;
            y += ev.touches[i].clientY;
        }
        return [x / n, y / n];
    }
    function setting_num(key, dflt)
    {
        var v = Number(api.settings[key]);
        return isFinite(v) ? v : dflt;
    }
    function clamp(v, lo, hi)
    {
        return Math.max(lo, Math.min(hi, Math.round(v * 10) / 10));
    }

    function camera_move(ev)
    {
        var p = pinch;
        if (p.mode === "lifted") return;
        var m = mid(ev);
        if (p.mode === "persp")
        {
            if (ev.touches.length !== 3) return;
            api.settings.depth_persp = clamp(p.persp - (m[1] - p.m0[1])
                                             * CAM_PERSP, 0, 100);
            p.changed = true;
            return;
        }
        if (ev.touches.length !== 2) return;
        var mx = m[0] - p.m0[0], my = m[1] - p.m0[1];
        var r = span(ev) / p.d0;
        var tw = twist(ev) - p.a0;
        tw = Math.atan2(Math.sin(tw), Math.cos(tw));    // wrap to -pi..pi
        if (!p.mode)
        {
            var spread = Math.abs(r - 1) * p.d0;        // px of pinch
            var turn = Math.abs(tw) * p.d0 / 2;         // px of finger arc
            var slide = Math.hypot(mx, my);
            if (Math.max(spread, turn, slide) < SLOP) return;
            p.mode = slide > spread && slide > turn ? "pan" : "pinch";
        }
        var lock = api.settings.depth_rot_lock === true;
        if (p.mode === "pan")
        {
            if (lock) return;
            api.settings.depth_rot = clamp(p.rot + mx * CAM_DEG, -45, 45);
        }
        else
        {
            api.settings.depth_zoom = clamp(p.zoom * r, 50, 200);
            // positive rotation turns the view counter-clockwise on screen,
            // so the map follows the fingers
            if (!lock)
                api.settings.depth_rot = clamp(p.rot - tw * 180 / Math.PI,
                                               -45, 45);
        }
        p.changed = true;
    }

    function start_persp(ev)
    {
        if (pinch.mode === "lifted") return;
        api.settings.depth_rot = pinch.rot;
        api.settings.depth_zoom = pinch.zoom;
        pinch.mode = "persp";
        pinch.m0 = mid(ev);
    }

    function on_touchstart(ev)
    {
        if (pinch && pinch.camera && ev.touches.length === 3)
        {
            start_persp(ev);
            return;
        }
        if (active() && dungeon_target(ev.target)
            && (ev.touches.length === 2 || (ev.touches.length === 3 && !pinch)))
        {
            cancel_touch();
            pinch = { d0: Math.max(1, span(ev)), done: false,
                      camera: api.settings.depth !== false,
                      a0: twist(ev), m0: mid(ev), mode: null, changed: false,
                      rot: setting_num("depth_rot", 0),
                      zoom: setting_num("depth_zoom", 100),
                      persp: setting_num("depth_persp", 90) };
            if (pinch.camera && ev.touches.length === 3)
                start_persp(ev);
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
            if (pinch.camera)
                camera_move(ev);
            else if (ev.touches.length === 2 && !pinch.done)
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
        // the map's < / > buttons: ours alone, before ui.js's click-outside
        // handler (from Find the results popup is still open under the map,
        // and a tap outside it would send Esc)
        var stair_btn = active() && ev.type === "touchend"
            && $(ev.target).closest(".sdc-m-mapstair")[0];
        if (stair_btn)
        {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            $(stair_btn).trigger("click");
            return;
        }
        if (pinch)
        {
            // swallow the lifted fingers; ignore until all are up
            if (ev.touches.length === 0)
            {
                if (pinch.changed) api.save();
                pinch = null;
            }
            else if (pinch.camera && (ev.touches.length === 1
                                      || pinch.mode === "persp"))
                pinch.mode = "lifted";   // a finger up: stop moving
            ev.preventDefault();
            return;
        }
        if (!touch) return;
        var t = touch;
        cancel_touch();
        if (ev.type === "touchcancel") return;
        if (map_view())
        {
            // ours alone: no synthesized mouse events, no ui.js handlers
            // (registered after this one, so they never see it)
            ev.preventDefault();
            ev.stopImmediatePropagation();
            if (t.moved)
                swipe(t.dx, t.dy);
            else if (!t.long)
                map_tap(t.target, t.x, t.y);
            return;
        }
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
        else if (aim.on)
        {
            // ours alone: only valid cells reach crawl
            ev.preventDefault();
            ev.stopImmediatePropagation();
            aim_tap(t.target, t.x, t.y);
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
        // another module may take the hold (orbmenu.js: on the player)
        if (api.hold(touch.x, touch.y)) return;
        if (map_view()) return;     // a mousedown would close the map (ui.js)
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

    // Tap your own tile = pick up (g), take the stairs you stand on (< / >,
    // like local tiles' click on self), pray at the altar or enter the shop
    // you stand on. Wraps the stock mouse handler: the
    // event is already unwarped by crt.js, so the same cell maths apply.
    var stock_mouse = renderer.handle_mouse;

    // dungeon_feature_type values (TAG_MAJOR_VERSION 34) whose stairs
    // direction (terrain.cc feat_stair_direction) is up; down is the same
    // for the down stairs, hatches, branch / portal entrances, Abyss gates
    // (54 enter, 55 exit, 61 exit through, 132 abyssal stair), Pan gates and
    // transporters (171). Shops and altars count as "down" there but aren't
    // stairs.
    var STAIRS_UP = [46, 47, 48, 49, 60, 62, 67, 175, 194, 210, 217, 222]
        .concat(range(86, 102), range(149, 159), range(198, 201));
    var STAIRS_DOWN = [42, 43, 44, 45, 54, 55, 57, 58, 59, 61, 63, 64, 66,
                       132, 171, 174, 193, 209, 216, 221]
        .concat(range(50, 53), range(69, 85), range(139, 148));
    function range(a, b)
    {
        var out = [];
        for (var i = a; i <= b; i++) out.push(i);
        return out;
    }
    // altars (DNGN_ALTAR_*, same version): ">" kneels there and opens the
    // god's join popup (main.cc _take_stairs). Not DNGN_UNKNOWN_ALTAR (130).
    var ALTARS = [160, 161, 162, 170, 195].concat(range(103, 121), range(165, 168));
    // DNGN_ENTER_SHOP: ">" opens the shop (not 41, DNGN_ABANDONED_SHOP)
    var SHOP = 40;
    function stairs_key(pos)
    {
        var f = map_knowledge.get(pos.x, pos.y).f;
        if (f === SHOP || ALTARS.indexOf(f) >= 0) return ">";
        if (STAIRS_UP.indexOf(f) >= 0) return "<";
        if (STAIRS_DOWN.indexOf(f) >= 0) return ">";
        return null;
    }
    function command_mode()
    {
        var g = window.game;    // global set by game.js (circular import)
        return !!g && typeof g.get_input_mode === "function"
            && g.get_input_mode() === enums.mouse_mode.COMMAND;
    }
    // Map view (X / Find): webtiles crawl ignores clicks there (only local
    // tiles handles them), so steer the map cursor with keys instead. Taps
    // are handled in on_touchend: from Find the results popup is still open
    // under the map, and ui.js's click-outside handler would send Esc.
    var MAP_STEP = { "-1,-1": "y", "0,-1": "k", "1,-1": "u", "-1,0": "h",
                     "1,0": "l", "-1,1": "b", "0,1": "j", "1,1": "n" };
    function map_view()
    {
        return renderer.ui_state === enums.ui.VIEW_MAP && !!renderer.view;
    }

    // dungeon cell under a screen point: through crt.js's curved screen the
    // same way its mouse forwarding does (depth is off in the map view)
    function cell_at(target, px, py)
    {
        var canvas = document.getElementById("dungeon");
        if (!canvas) return null;
        if (target && target.id === "sdc_screen")
        {
            var r = target.getBoundingClientRect();
            var k = api.settings.filter === "curved" ? api.curve_k() : 0;
            var cx = ((px - r.left) / r.width) * 2 - 1;
            var cy = ((py - r.top) / r.height) * 2 - 1;
            var f = (1 + k * (cx * cx + cy * cy)) / (1 + k);
            var du = api.depth_unmap((cx * f + 1) / 2, (cy * f + 1) / 2);
            px = r.left + du[0] * r.width;
            py = r.top + du[1] * r.height;
        }
        var s = renderer.scaled_size(px, py);
        var c = renderer.scaled_size();
        return { x: Math.floor(s.width / c.width) + renderer.view.x,
                 y: Math.floor(s.height / c.height) + renderer.view.y };
    }

    function map_tap(target, px, py)
    {
        var cell = cell_at(target, px, py);
        var cur = view_data.cursor_locs[enums.CURSOR_MAP];
        if (!cell || !cur) return;
        var x = cell.x, y = cell.y;
        var dx = x - cur.x, dy = y - cur.y;
        buzz();
        // within a cell of the cursor counts as a hit (fingers are fat and
        // map cells small): travel to the cursor
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1)
        {
            send_keys(".");
            return;
        }
        var keys = "";
        while (dx || dy)
        {
            var sx = Math.sign(dx), sy = Math.sign(dy);
            keys += MAP_STEP[sx + "," + sy];
            dx -= sx;
            dy -= sy;
        }
        send_keys(keys);
    }

    // Blink targeting -------------------------------------------------------
    // crawl's targeter takes a click as "select here"; a cell it can't use
    // (wall, monster, unseen, behind glass, your own tile) ends the prompt
    // as a cancel, and the scroll's choice is lost to a fat finger. While a
    // "<Verb> to where?" prompt is up, crawl marks every seen cell it would
    // refuse as out of range (TILE_FLAG_OOR, option darken_beyond_range), so
    // the rest are exactly the valid landing spots: tint those and only let
    // taps on them through.
    var AIM_RE = /^\w+ to where\?$/;
    var AIM_TINT = "102, 240, 255";
    var aim = { on: false };

    function targeting()
    {
        var g = window.game;
        return !!g && typeof g.can_target === "function" && g.can_target();
    }

    // the prompt is the last message, or followed by its "Press: ..." help
    function aim_prompt()
    {
        var ms = document.querySelectorAll("#messages .game_message");
        for (var i = ms.length - 1; i >= Math.max(0, ms.length - 3); i--)
        {
            var t = msg_text(ms[i]);
            if (AIM_RE.test(t)) return true;
            if (!/^Press:/.test(t)) return false;
        }
        return false;
    }

    function aim_ok(x, y)
    {
        if (player.pos && x === player.pos.x && y === player.pos.y)
            return false;
        var mc = map_knowledge.get(x, y);
        if (!mc || !mc.t || !map_knowledge.visible(mc)) return false;
        return !enums.prepare_bg_flags(mc.t.bg || 0).OOR;
    }

    function redraw_view()
    {
        var v = renderer.view;
        if (!v || !renderer.cols) return;
        for (var y = v.y; y < v.y + renderer.rows; y++)
            for (var x = v.x; x < v.x + renderer.cols; x++)
                renderer.render_grid_cell(x, y);
    }

    function set_aim(on)
    {
        if (aim.on === on) return;
        aim.on = on;
        redraw_view();
    }

    // every frame: a blink prompt opened or closed? Once seen the tint stays
    // until the prompt ends (moving the cursor prints descriptions under it).
    function aim_poll()
    {
        if (!active() || !targeting())
            set_aim(false);
        else if (!aim.on && aim_prompt())
            set_aim(true);
    }

    function aim_tap(target, px, py)
    {
        var cell = cell_at(target, px, py);
        if (!cell) return;
        if (!aim_ok(cell.x, cell.y))
        {
            if (navigator.vibrate) navigator.vibrate([15, 40, 15]);
            return;
        }
        buzz();
        var loc = { x: cell.x, y: cell.y };
        renderer.last_sent_cursor = loc;
        comm.send_message("target_cursor", loc);
        comm.send_message("click_cell", { x: loc.x, y: loc.y, button: 1 });
    }

    // Tint drawn into the dungeon canvas as each cell renders (so it goes
    // through the CRT warp and the 2.5D view): a soft fill, and an outline
    // on the edges that border a cell you can't blink to.
    function draw_aim(r, cx, cy, x, y)
    {
        var s = r.scaled_size(), w = s.width, h = s.height, ctx = r.ctx;
        var lw = Math.max(1, Math.round(w / 16));
        ctx.save();
        ctx.fillStyle = "rgba(" + AIM_TINT + ", 0.16)";
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = "rgba(" + AIM_TINT + ", 0.7)";
        if (!aim_ok(cx, cy - 1)) ctx.fillRect(x, y, w, lw);
        if (!aim_ok(cx, cy + 1)) ctx.fillRect(x, y + h - lw, w, lw);
        if (!aim_ok(cx - 1, cy)) ctx.fillRect(x, y, lw, h);
        if (!aim_ok(cx + 1, cy)) ctx.fillRect(x + w - lw, y, lw, h);
        ctx.restore();
    }

    (function () {
        // render_cursors ends every cell render (DungeonCellRenderer)
        var proto = renderer;
        while (proto && !Object.prototype.hasOwnProperty.call(proto,
                                                              "render_cursors"))
            proto = Object.getPrototypeOf(proto);
        if (!proto || proto.render_cursors.sdc_aim) return;
        var orig = proto.render_cursors;
        proto.render_cursors = function (cx, cy, x, y) {
            if (aim.on && this.ctx && aim_ok(cx, cy))
            {
                try { draw_aim(this, cx, cy, x, y); }
                catch (e) { api.warn("mobile aim tint", e); }
            }
            return orig.apply(this, arguments);
        };
        proto.render_cursors.sdc_aim = true;
    })();

    renderer.handle_mouse = function (ev)
    {
        if (ev.type === "mousedown" && ev.button === 0 && active()
            && !ev.shiftKey && !ev.ctrlKey && player.pos && this.view
            && this.ui_state !== enums.ui.VIEW_MAP && command_mode()
            && options.get("tile_web_mouse_control"))
        {
            var scaled = this.scaled_size(ev.clientX, ev.clientY);
            var cell = this.scaled_size();
            var x = Math.floor(scaled.width / cell.width) + this.view.x;
            var y = Math.floor(scaled.height / cell.height) + this.view.y;
            if (x === player.pos.x && y === player.pos.y)
            {
                buzz();
                send_keys(stairs_key(player.pos) || "g");
                return;
            }
        }
        return stock_mouse.apply(this, arguments);
    };

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
        reset_spell_pins(player);
    });

    // Macros persist across characters; spell pins (m.spell) belong to the
    // character they were pinned on. On the first update of each game: a
    // brand-new character (turn 0) drops all spell pins, resuming another
    // character drops pins tagged with a different name, and the remaining
    // ones get tagged with this character. The drop runs once per game, so a
    // pin made at turn 0 survives; new pins are tagged on the next update.
    var pins_checked = false;
    function reset_spell_pins(player)
    {
        if (player.turn == null || !player.name) return;
        var first = !pins_checked;
        pins_checked = true;
        var fresh = first && Number(player.turn) === 0, changed = false;
        var list = macros().filter(function (m) {
            if (!m || !m.spell) return true;
            var keep = !first
                || (!fresh && (!m.char || m.char === player.name));
            if (!keep) changed = true;
            return keep;
        }).map(function (m) {
            if (!m.spell || m.char) return m;
            changed = true;
            return $.extend({}, m, { char: player.name });
        });
        if (changed)
        {
            editing = -1;
            set_macros(list);
        }
    }

    // Lifecycle ---------------------------------------------------------------

    api.on("game_init", function () {
        pins_checked = false;
        apply_mode();
        build();
        watch_stack();
        if (zoom_step())
            api.command("relayout");
    });
    api.on("game_cleanup", function () {
        if (msg_observer)
            msg_observer.disconnect();
        clearTimeout(fade_timer);
        cancel_touch();
        $(document.body).removeClass("sdc-m-open sdc-m-tools sdc-m-log"
                                     + " sdc-m-find sdc-m-macros");
    });
    api.on("frame", place_bubble);
    api.on("frame", aim_poll);
    api.on("setting", function (key) {
        if (key === "mobile")
        {
            apply_mode();
            api.command("relayout");
        }
        else if (key === "mobile_zoom" || key === "depth")
            api.command("relayout");
        else if (key === "mobile_macros")
        {
            if (document.body.classList.contains("sdc-m-macros"))
                render_macros();
            render_pin();
        }
    });
    if (document.body)
        apply_mode();

    return {
        active: active,
        send_keys: send_keys,
    };
});
