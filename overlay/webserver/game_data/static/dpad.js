// Super Dungeon Crawl: the always-on d-pad, the mobile UI's "D-pad" control
// scheme (option "mobile_controls", registered by mobile.js). Styles live in
// dpad.css.
//
// Nine keys in a 3x3 grid, styled like the toolbar buttons:
//   - a direction: press = one step (or attack) that way; hold = run that
//     way (Shift + direction; crawl stops the run when something shows up).
//   - the centre: press = wait a turn (s); hold = rest (5).
//   - while crawl's targeter is up (aiming a spell, Look, ...) the
//     directions move the cursor and the centre confirms (Enter).
// The pad sits bottom-left, bottom-centre or bottom-right. The Fight and
// Explore thumb buttons share the room beside it: equal gaps to the screen
// edge, each other and the pad, at most their usual size, stacked when a
// big pad leaves too little width. The quick-use bar and the pinned macros
// move up above the whole group (body var --sdc-dpad-top, px from the
// bottom of the screen).
//
// Options:
//   "dpad_size"     key size in px (34..76)
//   "dpad_pos"      left / middle / right
// Its opacity is the mobile UI's "ui_opacity" (mobile.js / mobile.css).
define(["jquery", "comm", "./sdc_api"],
function ($, comm, api) {
    "use strict";

    api.register_option({ key: "dpad_size", label: "D-pad size",
                          default: 44, range: { min: 34, max: 76, step: 2 } });
    api.register_option({ key: "dpad_pos", label: "D-pad position",
                          default: "right",
                          choices: [["left", "Left"], ["middle", "Middle"],
                                    ["right", "Right"]] });

    var EDGE = 12;          // px from the screen edges (plus safe areas)
    var BIG = 76;           // Fight / Explore at their usual size
    var BIG_MIN = 44;       // below this they stack instead of sitting in a row
    var HOLD_MS = 450;      // press longer than this = run / rest

    // row by row from the top-left; dir = [dx, dy], key = crawl's vi key
    var KEYS = [
        { dir: [-1, -1], key: "y" }, { dir: [0, -1], key: "k" },
        { dir: [1, -1], key: "u" }, { dir: [-1, 0], key: "h" },
        { dir: [0, 0], key: "s" }, { dir: [1, 0], key: "l" },
        { dir: [-1, 1], key: "b" }, { dir: [0, 1], key: "j" },
        { dir: [1, 1], key: "n" }
    ];
    var NAMES = { "-1,-1": "up-left", "0,-1": "up", "1,-1": "up-right",
                  "-1,0": "left", "1,0": "right", "-1,1": "down-left",
                  "0,1": "down", "1,1": "down-right" };

    function on()
    {
        return !!document.body
            && document.body.classList.contains("sdc-mobile")
            && api.get("mobile_controls") === "dpad";
    }

    function targeting()
    {
        var g = window.game;    // global set by game.js
        return !!g && typeof g.can_target === "function" && g.can_target();
    }

    function buzz()
    {
        try
        {
            var ua = navigator.userActivation;
            if (ua && !ua.hasBeenActive) return;
            if (navigator.vibrate) navigator.vibrate(10);
        }
        catch (e) { /* vibration blocked or unsupported */ }
    }

    function send_text(t)
    {
        comm.send_message("input", { text: t });
    }

    // Building ------------------------------------------------------------------

    function arrow(dx, dy)
    {
        var deg = Math.atan2(dy, dx) * 180 / Math.PI;
        return "<svg viewBox='-8 -8 16 16' aria-hidden='true'>"
            + "<path d='M-6.5 0 H6 M1 -5.5 L6.5 0 L1 5.5' transform='rotate("
            + deg + ")'/></svg>";
    }

    function build()
    {
        $("#sdc_m_dpad").remove();
        var pad = $("<div id='sdc_m_dpad' role='group'>")
            .attr("aria-label", "Movement");
        KEYS.forEach(function (k) {
            var centre = !k.dir[0] && !k.dir[1];
            var b = $("<div class='sdc-dp-k' role='button'>")
                .toggleClass("sdc-dp-c", centre)
                .attr("aria-label", centre ? "Wait"
                      : "Move " + NAMES[k.dir[0] + "," + k.dir[1]])
                .html(centre ? "<span class='sdc-dp-wait'>WAIT</span>"
                             + "<span class='sdc-dp-ok'>OK</span>"
                             : arrow(k.dir[0], k.dir[1]));
            wire(b[0], k);
            pad.append(b);
        });
        $("#normal").append(pad);
        layout();
    }

    // Presses ----------------------------------------------------------------
    // Pointer events cover touch and the mouse. The step goes out on the
    // press itself (no waiting to tell a tap from a hold); a hold then adds
    // the run / rest.
    function wire(el, k)
    {
        var timer = null;
        var centre = !k.dir[0] && !k.dir[1];
        function release()
        {
            clearTimeout(timer);
            timer = null;
            el.classList.remove("on");
        }
        el.addEventListener("pointerdown", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.button > 0) return;
            try { el.setPointerCapture(ev.pointerId); }
            catch (e) { /* the pointer is already gone */ }
            el.classList.add("on");
            buzz();
            var aiming = targeting();
            if (centre && aiming)
                comm.send_message("key", { keycode: 13 });
            else
                send_text(k.key);
            clearTimeout(timer);
            if (aiming) return;
            timer = setTimeout(function () {
                timer = null;
                buzz();
                send_text(centre ? "5" : k.key.toUpperCase());
            }, HOLD_MS);
        });
        el.addEventListener("pointerup", release);
        el.addEventListener("pointercancel", release);
        el.addEventListener("lostpointercapture", release);
        // no synthesized clicks / context menu reaching the page under it
        ["click", "contextmenu"].forEach(function (t) {
            el.addEventListener(t, function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
            });
        });
    }

    // Layout -------------------------------------------------------------------

    // env(safe-area-inset-*) as numbers, read through a probe element
    var probe = null;
    function insets()
    {
        if (!probe)
        {
            probe = document.createElement("div");
            probe.style.cssText = "position:fixed;visibility:hidden;"
                + "pointer-events:none;left:0;top:0;width:0;height:0;"
                + "padding:env(safe-area-inset-top) env(safe-area-inset-right)"
                + " env(safe-area-inset-bottom) env(safe-area-inset-left)";
            document.body.appendChild(probe);
        }
        var s = window.getComputedStyle(probe);
        return { l: parseFloat(s.paddingLeft) || 0,
                 r: parseFloat(s.paddingRight) || 0,
                 b: parseFloat(s.paddingBottom) || 0 };
    }

    var BIG_PROPS = ["left", "right", "bottom", "width", "height", "font-size"];
    function reset_big(el)
    {
        BIG_PROPS.forEach(function (p) { el.style.removeProperty(p); });
    }

    function place_big(el, x, bottom, d)
    {
        el.style.left = Math.round(x) + "px";
        el.style.right = "auto";
        el.style.bottom = Math.round(bottom) + "px";
        el.style.width = el.style.height = Math.round(d) + "px";
        el.style.fontSize = Math.max(10, Math.min(13, Math.round(d * 0.17)))
            + "px";
    }

    // Buttons in a region [x0, x1]: a row with equal gaps, or a stack (first
    // at the bottom) when a row would make them smaller than BIG_MIN.
    // Returns the height used.
    function place_group(els, x0, x1, bottom)
    {
        var n = els.length;
        if (!n) return 0;
        var w = x1 - x0;
        var d = Math.min(BIG, (w - (n + 1) * EDGE) / n);
        if (d >= BIG_MIN || n === 1)
        {
            d = Math.max(BIG_MIN, d);
            var gap = (w - n * d) / (n + 1);
            els.forEach(function (el, i) {
                place_big(el, x0 + gap + i * (d + gap), bottom, d);
            });
            return d;
        }
        d = Math.max(BIG_MIN, Math.min(BIG, w - 2 * EDGE));
        els.forEach(function (el, i) {
            place_big(el, x0 + (w - d) / 2, bottom + i * (d + EDGE), d);
        });
        return n * d + (n - 1) * EDGE;
    }

    function shown(id, opt)
    {
        var el = document.getElementById(id);
        return el && api.get(opt) !== false ? el : null;
    }

    function layout()
    {
        var body = document.body;
        if (!body) return;
        var pad = document.getElementById("sdc_m_dpad");
        var fight = document.getElementById("sdc_m_fight");
        var explore = document.getElementById("sdc_m_explore");
        var pin = document.getElementById("sdc_m_pin");
        var active = on() && !!pad;
        body.classList.toggle("sdc-m-dpad", active);
        if (!active)
        {
            [fight, explore].forEach(function (el) { if (el) reset_big(el); });
            if (pin) pin.style.removeProperty("bottom");
            body.style.removeProperty("--sdc-dpad-top");
            return;
        }
        var ins = insets();
        var W = window.innerWidth - ins.l - ins.r;
        var k = Number(api.get("dpad_size")) || 44;
        var g = k >= 60 ? 6 : k >= 44 ? 5 : 4;
        var P = 3 * k + 2 * g;
        var pos = api.get("dpad_pos");
        var bottom = EDGE + ins.b;
        var x = pos === "left" ? EDGE
              : pos === "middle" ? (W - P) / 2 : W - EDGE - P;

        pad.style.setProperty("--k", k + "px");
        pad.style.setProperty("--g", g + "px");
        pad.style.left = Math.round(ins.l + x) + "px";
        pad.style.bottom = bottom + "px";

        var f = shown("sdc_m_fight", "mobile_fight_btn");
        var e = shown("sdc_m_explore", "mobile_explore_btn");
        var h = 0;
        if (pos === "middle")
        {
            h = Math.max(place_group(f ? [f] : [], ins.l, ins.l + x, bottom),
                         place_group(e ? [e] : [], ins.l + x + P,
                                     ins.l + W, bottom));
        }
        else
        {
            // Explore next to the pad, Fight towards the edge
            var row = pos === "left" ? [e, f] : [f, e];
            row = row.filter(Boolean);
            h = pos === "left"
                ? place_group(row, ins.l + x + P, ins.l + W, bottom)
                : place_group(row, ins.l, ins.l + x, bottom);
        }
        var top = bottom + Math.max(P, h);
        body.style.setProperty("--sdc-dpad-top", Math.round(top) + "px");
        if (pin) pin.style.bottom = Math.round(top + EDGE) + "px";
    }

    // the centre key reads OK while the targeter is up
    var was_aiming = null;
    function aim_poll()
    {
        if (!document.body.classList.contains("sdc-m-dpad")) return;
        var a = targeting();
        if (a === was_aiming) return;
        was_aiming = a;
        var pad = document.getElementById("sdc_m_dpad");
        if (pad) pad.classList.toggle("sdc-dp-aim", a);
        var c = pad && pad.querySelector(".sdc-dp-c");
        if (c) c.setAttribute("aria-label", a ? "Confirm" : "Wait");
    }

    // Lifecycle ----------------------------------------------------------------

    var LAYOUT_KEYS = ["mobile", "mobile_controls", "dpad_size", "dpad_pos",
                       "mobile_fight_btn",
                       "mobile_explore_btn", "quickbar_show", "mobile_macros"];

    // after mobile.js (loaded first) has rebuilt the thumb buttons
    api.on("game_init", function () {
        was_aiming = null;
        build();
    });
    api.on("setting", function (key) {
        if (LAYOUT_KEYS.indexOf(key) >= 0)
            layout();
    });
    api.on("frame", aim_poll);
    window.addEventListener("resize", layout);
    window.addEventListener("orientationchange", layout);

    return { layout: layout };
});
