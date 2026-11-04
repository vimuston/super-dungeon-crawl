// X3 HP/MP bar reactions. Other modules ask for a pulse, this one animates the
// stock bars (bars.js / bars.css) from the outside: short-lived spans are
// appended to the bar's .sdc-track and removed when their animation ends, so
// bars.js never needs to know. Cheap: <= 3 live elements per pulse.
//
// Contract for every other module (they may already emit this):
//   api.emit("bar_pulse", bar, kind, color)
//     bar   "hp" | "mp"
//     kind  "fill" (bar surges up), "drain" (falls away), "flash" (glint)
//     color "r,g,b" string (healing = green "125,255,176")
//
//   fill   bright band sweeps left -> right along the bar, glow bloom
//   drain  shimmer falls out of the right end of the fill, dark nick
//   flash  quick white-ish glint across the whole bar
//
// Self trigger (hud_update diff): HP gain >= 25% of max in one update ->
// "fill" green. Skipped when another module just pulsed the same bar, so a
// heal that also emits bar_pulse does not double up.
// Reduced motion: a plain colour flash instead of the sweeps.
// Debug: window.sdc_barfx_test(bar = "hp", kind = "fill", color = "125,255,176")
define(["./sdc_api", "./fxkit"], function (api, kit) {
    "use strict";

    var HEAL = "125,255,176";
    var DEDUPE = 350;            // ms: same bar pulsed by someone else
    var last = { hp: -1e9, mp: -1e9 };
    var DEFAULT = { hp: "255,77,77", mp: "77,166,255" };

    function track_of(bar)
    {
        return document.querySelector("#sdc_vitals .sdc-" + bar
                                      + " .sdc-track");
    }

    function part(track, css, frames, opts)
    {
        var el = document.createElement("span");
        el.className = "bfx-part";
        el.style.cssText = css;
        track.appendChild(el);
        var a = el.animate(frames, {
            duration: opts.duration, delay: opts.delay || 0,
            easing: opts.easing || "ease-out", fill: "both"
        });
        var done = function () {
            if (el.parentNode) el.parentNode.removeChild(el);
        };
        a.onfinish = done;
        a.oncancel = done;
        return el;
    }

    function pulse(bar, kind, color)
    {
        var track = track_of(bar);
        if (!track || !track.animate) return;
        color = color || DEFAULT[bar] || "255,255,255";
        var c = function (a) { return kit.rgba(color, a); };
        var still = kit.reduced();

        if (still)
        {
            part(track, "left:0;right:0;background:" + c(0.8) + ";"
                 + "z-index:3;", [{ opacity: 0.9 }, { opacity: 0 }],
                 { duration: 450 });
            return;
        }
        if (kind === "fill")
        {
            part(track, "left:0;width:30%;z-index:3;mix-blend-mode:screen;"
                 + "background:linear-gradient(90deg,transparent," + c(0.95)
                 + ",rgba(255,255,255,0.9),transparent);"
                 + "box-shadow:0 0 8px " + c(0.9) + ";",
                 [{ transform: "translateX(-100%)", opacity: 1 },
                  { transform: "translateX(333%)", opacity: 0.2 }],
                 { duration: 650, easing: "cubic-bezier(.3,.6,.4,1)" });
            part(track, "left:-2px;right:-2px;top:-3px;bottom:-3px;z-index:1;"
                 + "border-radius:2px;box-shadow:0 0 12px 3px " + c(0.85)
                 + ";", [{ opacity: 0 }, { opacity: 1, offset: 0.25 },
                         { opacity: 0 }], { duration: 800, easing: "ease-out" });
        }
        else if (kind === "drain")
        {
            // shimmer dripping down off the bar + a dark nick at the end
            part(track, "left:40%;right:0;top:0;bottom:0;z-index:3;"
                 + "background:linear-gradient(90deg,transparent," + c(0.7)
                 + ");mix-blend-mode:screen;",
                 [{ transform: "translateY(0)", opacity: 0.9 },
                  { transform: "translateY(9px)", opacity: 0 }],
                 { duration: 600, easing: "ease-in" });
            part(track, "right:0;width:3px;z-index:3;background:rgba(0,0,0,.85);"
                 + "box-shadow:0 0 5px " + c(0.9) + ";",
                 [{ opacity: 1, transform: "scaleY(1.6)" },
                  { opacity: 0, transform: "scaleY(1)" }],
                 { duration: 500 });
        }
        else
        {
            part(track, "left:0;width:12%;z-index:3;mix-blend-mode:screen;"
                 + "background:linear-gradient(90deg,transparent,"
                 + "rgba(255,255,255,.95)," + c(0.8) + ",transparent);",
                 [{ transform: "translateX(-100%)", opacity: 1 },
                  { transform: "translateX(850%)", opacity: 0 }],
                 { duration: 380, easing: "ease-in-out" });
        }
    }

    api.on("bar_pulse", function (bar, kind, color) {
        if (bar !== "hp" && bar !== "mp") return;
        last[bar] = kit.now();
        pulse(bar, kind, color);
    });

    api.on("hud_update", function (pl, prev) {
        if (!pl || !prev) return;
        var max = Number(pl.hp_max), d = Number(pl.hp) - Number(prev.hp);
        if (!(max > 0) || !(d >= 0.25 * max)) return;
        // let other emitters (heal potion etc.) win; they run in the same
        // dispatch, so wait a beat before deciding
        setTimeout(function () {
            if (kit.now() - last.hp > DEDUPE) api.emit("bar_pulse", "hp", "fill", HEAL);
        }, 60);
    });

    window.sdc_barfx_test = function (bar, kind, color) {
        api.emit("bar_pulse", bar || "hp", kind || "fill", color || (
            (bar || "hp") === "hp" ? HEAL : DEFAULT.mp));
    };

    return {};
});
