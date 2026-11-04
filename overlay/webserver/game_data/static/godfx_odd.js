// Odd gods: Xom, Lugonu, Cheibriados, Dithmenos, Ru, Hepliaklqana.
// DOM bits live in the "godfx_odd" fxkit layer; whole-view colour/distortion
// goes through api.grade("odd_*") tweens (removed when they finish).
//
// Triggers (strings from the crawl source this mod builds: god-abil.cc,
// xom.cc, abyss.cc, monster.cc, spl-selfench.cc, duration-data.h):
//   Xom      any log line naming Xom ("Xom snickers.", "Xom grants you a
//            gift!", "You hear Xom's ...", "Xom is interested." ...), "...
//            erupts in a glittering mayhem of colour.", or joining Xom (the
//            god splash): one random flourish - hue shimmer, inversion
//            flash, wobble, rainbow vignette or confetti. Throttled.
//   Lugonu   "<mon> is devoured by a tear in reality." (Banish): spatial
//            crack + black hole at the monster's last tile;
//            "Lugonu's Hand of Corruption reaches out!" (Corrupt): violet
//            tile-warp spreading over the floor + wobble + violet vignette;
//            "You are cast (deeper) into the Abyss!" / leaving the Abyss
//            (place change; Abyss Exit): hole at / crack around you.
//            (Bend Space and Lugonu's Hurl Damnation no longer exist.)
//   Cheibriados  "You can feel time thicken for a moment." (Slouch),
//            "You warp the flow of time around you!" (Temporal Distortion),
//            "The flow of time bends around you." (Bend Time), "You step out
//            of the flow of time." .. "You return to the normal time flow."
//            (Step From Time): time dilation - chroma smear, desaturated
//            blue grade, living tiles slowed (window.sdc_alive_timescale).
//   Dithmenos  "You swap places with your shadow ..." (Shadowslip): black
//            blur trail from where you stood; status light "Nightfall"
//            (Primordial Nightfall): dark outline aura (statusfx);
//            "You grasp <mon>'s shadow with your own ..." (Aphotic
//            Marionette): a shadow thread to it. (Shadow Step / Shadow Form
//            no longer exist.) (Silence is drawn by light.js as a soft
//            purple glow over the stock aura.)
//   Ru       "Ru believes you are ready to make a new sacrifice." or joining
//            Ru: tension overlay; "Ru asks you to <sacrifice>." releases it;
//            "You are restored by drawing out deep reserves ..." (Draw Out
//            Power): green inward rings; "You perform a powerful leap!"
//            (Power Leap) / "You reveal the great annihilating truth to
//            your foes!" (Apocalypse): ground crater + radial shockwave;
//            "You focus your inner power and ..." (retribution): small ring.
//   Hepliaklqana  your ancestor ("<name> the knight|elementalist|hexer|
//            ancestor", friendly) gets a spectral outline while in view;
//            "<X> swap(s) with <ancestor>!" (Transference): a flash line.
// prefers-reduced-motion: no wobble/smear/shake/confetti/particles; only
// soft colour grades and static rings.
// Debug: window.sdc_godfx_odd_test(god) - "xom", "lugonu", "corrupt",
//   "chei", "timestep", "dith", "ru", "sacrifice", "apocalypse",
//   "hep" (omit = cycle through all).
define(["./sdc_api", "./fxkit", "./statusfx", "./player", "./map_knowledge",
        "./dungeon_renderer"],
function (api, kit, statusfx, player, map_knowledge, dungeon_renderer) {
    "use strict";

    var C_GREEN = "125,255,176", C_VIOLET = "176,96,255",
        C_BLUE = "120,170,255",
        C_GOLD = "255,200,90", C_SPECTRE = "200,240,255";
    var XOM_GAP = 1200;                  // ms between Xom flourishes
    var TIMESTEP_MAX = 40000;            // ms cap if the end line is missed

    var tweens = {};                     // grade name -> {t0, dur, fn}
    var last_xom = -1e9;
    var pos_now = null, pos_prev = null, pos_moved = -1e9;
    var mon_cache = [], mon_cache_t = -1e9;
    var tstep = null;

    function god() { return kit.strip(player.god || ""); }
    function env(k) { return Math.sin(Math.PI * Math.max(0, Math.min(1, k))); }
    function layer() { return kit.layer("godfx_odd"); }
    function px_tile(a) { return Math.max(8, Math.min(a.cw, a.ch)); }

    // Grade tweens: fn(k 0..1, ms) -> grade object, every frame for dur ms.
    function tween(name, dur, fn)
    {
        tweens[name] = { t0: kit.now(), dur: dur, fn: fn };
    }

    function end_tween(name)
    {
        delete tweens[name];
        api.grade(name, null);
    }

    function shake(amp)
    {
        if (kit.reduced()) return null;
        var d = window.devicePixelRatio || 1;
        return function (k) {
            var a = amp * d * (1 - k) * (1 - k);
            return { sx: kit.rnd(-a, a), sy: kit.rnd(-a, a) };
        };
    }

    function el(cls, a, size, css)
    {
        var d = kit.mk(layer(), "width:" + size + "px;height:" + size
                       + "px;margin:" + (-size / 2) + "px 0 0 "
                       + (-size / 2) + "px;" + (css || ""));
        d.className = "sdc-odd " + cls;
        d.style.transform = kit.at(a.x, a.y);
        return d;
    }

    function gone(anim, d)
    {
        anim.onfinish = function () {
            if (d.parentNode) d.parentNode.removeChild(d);
        };
    }

    function ring(a, color, from, to, dur, width, delay)
    {
        var s = px_tile(a) * to;
        var d = el("sdc-odd-ring", a, s, "border:" + (width || 2)
                   + "px solid " + kit.rgba(color, 0.9) + ";box-shadow:0 0 "
                   + "10px " + kit.rgba(color, 0.6) + ";");
        var at = kit.at(a.x, a.y);
        gone(kit.anim(d, [
            { transform: at + "scale(" + (from / to) + ")", opacity: 0.95 },
            { transform: at + "scale(1)", opacity: 0 }],
            { duration: dur, delay: delay || 0 }), d);
        return d;
    }

    function here() { return kit.anchor_of(kit.player_pos()); }

    // Map helpers ------------------------------------------------------------

    function scan()
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
                               att: mc.mon.att, x: x, y: y });
            }
        return out;
    }

    function refresh_cache()
    {
        var m = scan();
        if (m.length) { mon_cache = m; mon_cache_t = kit.now(); }
    }

    // "The orc" / "Sigmund" / "your shadow" -> nearest matching monster pos
    function find_mon(who, list)
    {
        var n = String(who || "").toLowerCase()
                .replace(/^(the|an?|your)\s+/, "").replace(/'s?$/, "").trim();
        if (!n) return null;
        var p = kit.player_pos() || { x: 0, y: 0 }, best = null, bd = 1e9;
        (list || scan()).forEach(function (m) {
            if (m.name !== n && m.name.indexOf(n + " the ") !== 0
                && m.name.indexOf(n) < 0)
                return;
            var d = Math.abs(m.x - p.x) + Math.abs(m.y - p.y);
            if (d < bd) { bd = d; best = m; }
        });
        return best;
    }

    function find_mon_any(who)
    {
        return find_mon(who) || (kit.now() - mon_cache_t < 3000
                                 ? find_mon(who, mon_cache) : null);
    }

    // Xom (G5) ---------------------------------------------------------------

    var XOM = [
        function shimmer() {
            tween("odd_xom", 1300, function (k) {
                return { hue: k < 1 ? k * k * (3 - 2 * k) : 0,
                         vig: [1, 0.3, 0.9], vig_a: 0.3 * env(k) };
            });
        },
        function invert() {
            tween("odd_xom", 520, function (k) {
                var f = k < 0.5 ? env(k * 2) : env(k * 2 - 1) * 0.6;
                return { invert: 0.85 * f };
            });
        },
        function wobble() {
            if (kit.reduced()) return XOM[0]();
            tween("odd_xom", 1500, function (k) {
                return { wobble: 0.7 * env(k), hue: 0.08 * Math.sin(k * 12) };
            });
        },
        function rainbow() {
            tween("odd_xom", 1700, function (k) {
                var h = k * 6.2832 * 1.5;
                return { vig: [0.5 + 0.5 * Math.sin(h), 0.5 + 0.5 * Math.sin(h + 2.1),
                               0.5 + 0.5 * Math.sin(h + 4.2)],
                         vig_a: 0.55 * env(k) };
            });
        },
        function confetti() {
            var a = here();
            if (!a || kit.reduced()) return XOM[3]();
            var t = px_tile(a);
            for (var i = 0; i < 26; i++)
            {
                var c = "hsl(" + Math.floor(kit.rnd(0, 360)) + ",95%,62%)";
                var d = el("sdc-odd-confetti", a, t * 0.22,
                           "background:" + c + ";border-radius:1px;");
                var ang = kit.rnd(-Math.PI, 0), v = t * kit.rnd(1.5, 4);
                var dx = Math.cos(ang) * v, dy = Math.sin(ang) * v;
                var at = kit.at(a.x, a.y), spin = kit.rnd(-720, 720);
                gone(kit.anim(d, [
                    { transform: at + "rotate(0deg)", opacity: 1 },
                    { transform: kit.at(a.x + dx, a.y + dy) + "rotate("
                                 + spin / 2 + "deg)", opacity: 1, offset: 0.35 },
                    { transform: kit.at(a.x + dx * 1.4, a.y + dy + t * 3.5)
                                 + "rotate(" + spin + "deg)", opacity: 0 }],
                    { duration: kit.rnd(1100, 1700), easing: "linear" }), d);
            }
            tween("odd_xom", 900, function (k) { return { hue: 0.06 * env(k) }; });
        }
    ];

    function xom(force)
    {
        var t = kit.now();
        if (!force && t - last_xom < XOM_GAP) return;
        last_xom = t;
        kit.pick(XOM)();
    }

    // Lugonu (G11) -----------------------------------------------------------

    function crack(a, big)
    {
        var t = px_tile(a) * (big ? 2.2 : 1.4);
        var n = big ? 9 : 6;
        for (var i = 0; i < n; i++)
        {
            var len = t * kit.rnd(0.6, 1.1);
            var d = kit.mk(layer(), "width:" + len + "px;height:2px;"
                           + "margin-top:-1px;transform-origin:0 50%;");
            d.className = "sdc-odd sdc-odd-crack";
            var at = kit.at(a.x, a.y) + "rotate(" + (i * 360 / n
                     + kit.rnd(-18, 18)) + "deg) ";
            gone(kit.anim(d, [
                { transform: at + "scaleX(0)", opacity: 1 },
                { transform: at + "scaleX(1)", opacity: 1, offset: 0.25 },
                { transform: at + "scaleX(1)", opacity: 0 }],
                { duration: big ? 1600 : 1200 }), d);
        }
    }

    // black hole that opens, swallows some motes, and closes
    function hole(a, big)
    {
        var t = px_tile(a), s = t * (big ? 3 : 1.8);
        var d = el("sdc-odd-hole", a, s);
        var at = kit.at(a.x, a.y);
        gone(kit.anim(d, [
            { transform: at + "scale(0) rotate(0deg)", opacity: 0 },
            { transform: at + "scale(1) rotate(120deg)", opacity: 1,
              offset: 0.3 },
            { transform: at + "scale(0.85) rotate(260deg)", opacity: 1,
              offset: 0.75 },
            { transform: at + "scale(0) rotate(400deg)", opacity: 0 }],
            { duration: big ? 1900 : 1400, easing: "ease-in-out" }), d);
        if (!kit.reduced())
            for (var i = 0; i < (big ? 16 : 10); i++)
            {
                var ang = kit.rnd(0, 6.2832), r = t * kit.rnd(1.2, big ? 3 : 2);
                var m = el("sdc-odd-mote", a, Math.max(3, t * 0.12));
                gone(kit.anim(m, [
                    { transform: kit.at(a.x + Math.cos(ang) * r,
                                        a.y + Math.sin(ang) * r), opacity: 0 },
                    { transform: kit.at(a.x + Math.cos(ang + 1.2) * r * 0.5,
                                        a.y + Math.sin(ang + 1.2) * r * 0.5),
                      opacity: 1, offset: 0.5 },
                    { transform: at + "scale(0.2)", opacity: 0 }],
                    { duration: kit.rnd(700, 1200), delay: kit.rnd(100, 400),
                      easing: "ease-in" }), m);
            }
        var sh = shake(big ? 2.5 : 1.2);
        tween("odd_lug", big ? 1800 : 1200, function (k) {
            var o = sh ? sh(k) : {};
            o.vig = [0.35, 0.05, 0.6];
            o.vig_a = (big ? 0.5 : 0.25) * env(k);
            return o;
        });
    }

    function banish(who)
    {
        var m = find_mon_any(who);
        var a = m ? kit.anchor_of(m) : here();
        if (!a) return;
        crack(a, false);
        hole(a, false);
    }

    function corrupt()
    {
        var a = here();
        tween("odd_corrupt", 3600, function (k) {
            var e = env(Math.min(1, k * 1.6)) * (k < 0.3 ? 1 : 1 - (k - 0.3) / 0.7);
            e = Math.max(e, env(k) * 0.6);
            return { wobble: kit.reduced() ? 0 : 0.45 * env(k),
                     vig: [0.55, 0.12, 0.85], vig_a: 0.6 * e,
                     tint: [0.85, 0.7, 1], tint_a: 0.25 * env(k) };
        });
        if (!a) return;
        var t = px_tile(a), n = kit.reduced() ? 10 : 22;
        var p = kit.player_pos();
        for (var i = 0; i < n; i++)
        {
            // cells on rings of growing radius; later = further
            var r = 1 + (i / n) * 7, ang = kit.rnd(0, 6.2832);
            var c = kit.anchor_of({ x: Math.round(p.x + Math.cos(ang) * r),
                                    y: Math.round(p.y + Math.sin(ang) * r) });
            if (!c) continue;
            var d = el("sdc-odd-warp", c, t * 1.1);
            var at = kit.at(c.x, c.y), sk = kit.rnd(-14, 14);
            gone(kit.anim(d, [
                { transform: at + "scale(0.2) skew(0deg)", opacity: 0 },
                { transform: at + "scale(1) skew(" + sk + "deg," + (-sk / 2)
                             + "deg)", opacity: 0.8, offset: 0.35 },
                { transform: at + "scale(1.15) skew(" + (-sk) + "deg)",
                  opacity: 0 }],
                { duration: 1500, delay: (i / n) * 1500 }), d);
        }
        ring(a, C_VIOLET, 0.2, 9, 1600, 3);
    }

    // Cheibriados (G15) ------------------------------------------------------

    function dilate_obj(s)
    {
        var red = kit.reduced();
        window.sdc_alive_timescale = 1 - 0.8 * s;
        return { smear: red ? 0 : 0.35 * s, desat: 0.45 * s,
                 tint: [0.72, 0.84, 1], tint_a: 0.4 * s,
                 vig: [0.15, 0.25, 0.55], vig_a: 0.3 * s };
    }

    // short dilation: ramp up, hold, ramp down
    function dilate(dur)
    {
        tween("odd_chei", dur, function (k, ms) {
            var s = Math.min(1, ms / 400, (dur - ms) / 700);
            return dilate_obj(Math.max(0, s));
        });
        var a = here();
        if (a) ring(a, C_BLUE, 0.3, 5, Math.min(dur, 2400), 2);
    }

    function timestep(on)
    {
        if (on)
        {
            tstep = { t0: kit.now(), off: 0 };
            tween("odd_chei", TIMESTEP_MAX, function (k, ms) {
                var s = Math.min(1, ms / 500);
                if (tstep && tstep.off)
                    s = Math.min(s, 1 - (kit.now() - tstep.off) / 700);
                if (s <= 0) { tstep = null; return null; }
                return dilate_obj(s);
            });
            var a = here();
            if (a) ring(a, C_BLUE, 1.5, 0.2, 900, 2);
        }
        else if (tstep && !tstep.off)
        {
            tstep.off = kit.now();
            var b = here();
            if (b) ring(b, C_BLUE, 0.2, 4, 900, 2);
        }
    }

    // Dithmenos (G17) --------------------------------------------------------

    function shadow_trail(from, to)
    {
        var a = from && kit.anchor_of(from), b = to && kit.anchor_of(to);
        if (!b) return;
        var t = px_tile(b);
        if (!a) a = b;
        var n = kit.reduced() ? 3 : 7;
        for (var i = 0; i <= n; i++)
        {
            var f = i / n;
            var c = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
            var d = el("sdc-odd-shade", c, t * (0.9 + 0.3 * (1 - f)));
            gone(kit.anim(d, [{ opacity: 0.85 }, { opacity: 0 }],
                          { duration: 700 + i * 90, delay: f * 120 }), d);
        }
        tween("odd_dith", 700, function (k) {
            return { vig: [0, 0, 0.02], vig_a: 0.45 * env(k) };
        });
    }

    function marionette(who)
    {
        var m = find_mon(who), a = here();
        var b = m && kit.anchor_of(m);
        if (!a || !b) return;
        thread(a, b, "sdc-odd-thread", 1300);
        ring(b, "20,10,30", 1.4, 0.4, 900, 3);
    }

    function thread(a, b, cls, dur)
    {
        var dx = b.x - a.x, dy = b.y - a.y;
        var len = Math.sqrt(dx * dx + dy * dy);
        var d = kit.mk(layer(), "width:" + len + "px;height:3px;"
                       + "margin-top:-1.5px;transform-origin:0 50%;");
        d.className = "sdc-odd " + cls;
        var at = kit.at(a.x, a.y) + "rotate(" + Math.atan2(dy, dx) + "rad) ";
        gone(kit.anim(d, [
            { transform: at + "scaleX(0)", opacity: 1 },
            { transform: at + "scaleX(1)", opacity: 1, offset: 0.25 },
            { transform: at + "scaleX(1)", opacity: 0 }],
            { duration: dur }), d);
    }

    statusfx.register({
        id: "odd-nightfall",
        match: /^nightfall/,
        start: function (ctx) {
            var o = document.createElement("div");
            o.className = "sdc-odd-night";
            ctx.root.appendChild(o);
            ctx.data.el = o;
            if (!ctx.initial)
                tween("odd_night", 1400, function (k) {
                    return { vig: [0, 0, 0], vig_a: 0.7 * env(k), desat: 0.3 * env(k) };
                });
        },
        frame: function (ctx, t) {
            var o = ctx.data.el, a = ctx.anchor;
            if (!o) return;
            if (!a) { o.style.display = "none"; return; }
            var s = px_tile(a) * 1.5;
            var p = kit.reduced() ? 1 : 1 + 0.06 * Math.sin(kit.now() / 520);
            o.style.display = "";
            o.style.width = o.style.height = s + "px";
            o.style.transform = kit.at(a.x - s / 2, a.y - s / 2) + "scale("
                                + p.toFixed(3) + ")";
        },
        cleanup: function (ctx) { ctx.data.el = null; }
    });

    // Ru (G20) ---------------------------------------------------------------

    function tension_on(dur)
    {
        var a = here();
        tween("odd_ru", dur, function (k, ms) {
            var beat = kit.reduced() ? 0.5
                       : 0.5 + 0.5 * Math.sin(ms / 1000 * 6.2832 * 0.9);
            var e = Math.min(1, ms / 600, (dur - ms) / 900);
            return { vig: [0.5, 0.2, 0.04], vig_a: (0.25 + 0.2 * beat) * e,
                     desat: 0.2 * e };
        });
        if (a)
        {
            var d = el("sdc-odd-ru-circle", a, px_tile(a) * 5);
            var at = kit.at(a.x, a.y);
            gone(kit.anim(d, [
                { transform: at + "scale(1.4) rotate(0deg)", opacity: 0 },
                { transform: at + "scale(1) rotate(40deg)", opacity: 0.9,
                  offset: 0.3 },
                { transform: at + "scale(0.5) rotate(90deg)", opacity: 0 }],
                { duration: Math.min(dur, 4500), easing: "ease-in-out" }), d);
        }
    }

    function sacrifice()
    {
        end_tween("odd_ru");
        var a = here();
        tween("odd_ru", 900, function (k) {
            return { vig: [1, 0.78, 0.35], vig_a: 0.6 * (1 - k), desat: 0.4 * (1 - k) };
        });
        if (a)
        {
            ring(a, C_GOLD, 0.3, 6, 900, 3);
            ring(a, C_GOLD, 0.2, 3.5, 700, 2, 120);
        }
    }

    function crater(big)
    {
        var a = here();
        if (!a) return;
        var t = px_tile(a), s = t * (big ? 6 : 3);
        var d = el("sdc-odd-crater", a, s);
        var at = kit.at(a.x, a.y);
        gone(kit.anim(d, [
            { transform: at + "scale(0.3)", opacity: 0 },
            { transform: at + "scale(1)", opacity: 0.85, offset: 0.12 },
            { transform: at + "scale(1)", opacity: 0.6, offset: 0.6 },
            { transform: at + "scale(1.05)", opacity: 0 }],
            { duration: big ? 2600 : 1800 }), d);
        ring(a, C_GOLD, 0.3, big ? 14 : 6, big ? 1100 : 750, 3);
        if (big) ring(a, "255,240,220", 0.2, 10, 1300, 2, 180);
        if (!kit.reduced())
            for (var i = 0; i < (big ? 12 : 7); i++)
            {
                var ang = kit.rnd(0, 6.2832), r = t * kit.rnd(1, big ? 4 : 2);
                var m = el("sdc-odd-debris", a, Math.max(3, t * 0.16));
                gone(kit.anim(m, [
                    { transform: at, opacity: 1 },
                    { transform: kit.at(a.x + Math.cos(ang) * r,
                                        a.y + Math.sin(ang) * r - t * 0.6),
                      opacity: 0.9, offset: 0.6 },
                    { transform: kit.at(a.x + Math.cos(ang) * r * 1.1,
                                        a.y + Math.sin(ang) * r * 1.1),
                      opacity: 0 }],
                    { duration: kit.rnd(600, 950) }), m);
            }
        var sh = shake(big ? 4 : 2.2);
        tween("odd_ru_quake", big ? 1300 : 700, function (k) {
            var o = sh ? sh(k) : {};
            if (big) { o.vig = [1, 0.75, 0.4]; o.vig_a = 0.45 * env(k); }
            return o;
        });
    }

    function draw_power()
    {
        var a = here();
        if (!a) return;
        for (var i = 0; i < 3; i++)
            ring(a, C_GREEN, 4, 0.3, 800, 2, i * 160);
        tween("odd_ru_heal", 900, function (k) {
            return { vig: [0.49, 1, 0.69], vig_a: 0.3 * env(k) };
        });
    }

    // Hepliaklqana (G21) -----------------------------------------------------

    var ANCESTOR = / the (ancestor|knight|elementalist|hexer)$/;
    var anc = { el: null, pos: null, t: -1e9 };

    function ancestor_frame()
    {
        if (!/^hepliaklqana/i.test(god()))
        {
            if (anc.el) { anc.el.parentNode && anc.el.parentNode.removeChild(anc.el);
                          anc.el = null; }
            return;
        }
        var t = kit.now();
        if (t - anc.t > 300)
        {
            anc.t = t;
            anc.pos = null;
            scan().some(function (m) {
                if (m.att === 4 && ANCESTOR.test(m.name))
                {
                    anc.pos = { x: m.x, y: m.y, name: m.name };
                    return true;
                }
                return false;
            });
        }
        var a = anc.pos && kit.anchor_of(anc.pos);
        if (!a)
        {
            if (anc.el) anc.el.style.display = "none";
            return;
        }
        if (!anc.el || !anc.el.parentNode)
        {
            anc.el = kit.mk(layer(), "");
            anc.el.className = "sdc-odd sdc-odd-ancestor";
        }
        var s = px_tile(a) * 1.05;
        var f = kit.reduced() ? 0.75
                : 0.6 + 0.25 * Math.sin(t / 700) + 0.1 * Math.sin(t / 97);
        anc.el.style.display = "";
        anc.el.style.width = anc.el.style.height = s + "px";
        anc.el.style.opacity = f.toFixed(2);
        anc.el.style.transform = kit.at(a.x - s / 2, a.y - s / 2);
    }

    function transference(victim, ancestor_name)
    {
        var av = /^you$/i.test(victim) ? kit.player_pos() : null;
        var m1 = av || find_mon(victim);
        var m2 = find_mon(ancestor_name) || anc.pos;
        var a = m1 && kit.anchor_of(m1), b = m2 && kit.anchor_of(m2);
        if (!a || !b) return;
        thread(a, b, "sdc-odd-swap", 650);
        ring(a, C_SPECTRE, 0.2, 2, 500, 2);
        ring(b, C_SPECTRE, 0.2, 2, 500, 2);
        tween("odd_hep", 350, function (k) {
            return { vig: [0.8, 0.95, 1], vig_a: 0.35 * (1 - k) };
        });
    }

    // Triggers ---------------------------------------------------------------

    var RULES = [
        [/erupts in a glittering mayhem of colou?r|\bXom\b/, function () { xom(); }],
        [/^(.+?) (?:is|are) devoured by a tear in reality/, function (m) { banish(m[1]); }],
        [/Hand of Corruption reaches out/, corrupt],
        [/You are cast (?:deeper )?into the Abyss/, function () {
            var a = here();
            if (a) hole(a, true);
        }],
        [/You can feel time thicken for a moment/, function () { dilate(1800); }],
        [/You warp the flow of time around you/, function () { dilate(2800); }],
        [/The flow of time bends around you/, function () { dilate(1600); }],
        [/You step out of the flow of time/, function () { timestep(true); }],
        [/You return to the normal time flow/, function () { timestep(false); }],
        [/You swap places with your shadow/, function () {
            var p = kit.player_pos();
            var from = kit.now() - pos_moved < 1500 ? pos_prev : null;
            shadow_trail(from, p);
        }],
        [/You grasp (.+?) shadow with your own/, function (m) { marionette(m[1]); }],
        [/Ru believes you are ready to make a new sacrifice/, function () {
            tension_on(5000);
        }],
        [/^Ru asks you to /, sacrifice],
        [/You are restored by drawing out deep reserves of power/, draw_power],
        [/You perform a powerful leap/, function () { crater(false); }],
        [/You reveal the great annihilating truth/, function () { crater(true); }],
        [/You focus your inner power and/, function () {
            var a = here();
            if (a) ring(a, C_GOLD, 0.3, 3, 600, 2);
        }],
        [/^(You|.+?) swaps? with (.+?)!/, function (m) {
            if (/^hepliaklqana/i.test(god())) transference(m[1], m[2]);
        }]
    ];

    kit.on_message(function (text) {
        // a fresh chunk may hold several sentences
        var parts = String(text).replace(/([.!?])\s+(?=[A-Z"])/g, "$1\n")
                    .split("\n");
        parts.forEach(function (s) {
            for (var i = 0; i < RULES.length; i++)
            {
                var m = RULES[i][0].exec(s);
                if (!m) continue;
                try { RULES[i][1](m); }
                catch (e) { console.error("sdc godfx_odd:", e); }
            }
        });
    });

    api.on("hud_update", function (pl, prev) {
        var p = kit.player_pos();
        if (p && (!pos_now || p.x !== pos_now.x || p.y !== pos_now.y))
        {
            pos_prev = pos_now;
            pos_now = p;
            pos_moved = kit.now();
        }
        if (/^lugonu/i.test(god())) refresh_cache();
        if (!prev) return;
        var g = kit.strip(pl.god || ""), pg = kit.strip(prev.god || "");
        if (g !== pg && /^xom/i.test(g)) xom(true);
        if (g !== pg && /^ru$/i.test(g)) tension_on(3500);   // pre-ritual
        if (prev.place === "Abyss" && pl.place && pl.place !== "Abyss")
            window.setTimeout(function () {
                var a = here();
                if (a) { crack(a, true); ring(a, C_VIOLET, 0.2, 6, 900, 3); }
            }, 120);
    });


    api.on("frame", function () {
        var t = kit.now();
        Object.keys(tweens).forEach(function (name) {
            var tw = tweens[name], ms = t - tw.t0, o = null;
            try { if (ms < tw.dur) o = tw.fn(Math.min(1, ms / tw.dur), ms); }
            catch (e) { console.error("sdc godfx_odd:", e); }
            if (o) api.grade(name, o);
            else
            {
                if (name === "odd_chei") window.sdc_alive_timescale = 1;
                end_tween(name);
            }
        });
        ancestor_frame();
    });

    function reset()
    {
        Object.keys(tweens).forEach(end_tween);
        window.sdc_alive_timescale = 1;
        tstep = null;
        anc.el = null;
        anc.pos = null;
        pos_now = pos_prev = null;
        mon_cache = [];
    }
    api.on("game_init", reset);
    api.on("game_cleanup", reset);

    var TESTS = {
        xom: function () { xom(true); },
        lugonu: function () {
            var p = kit.player_pos();
            var a = p && kit.anchor_of({ x: p.x + 2, y: p.y });
            if (a) { crack(a, false); hole(a, false); }
        },
        corrupt: corrupt,
        chei: function () { dilate(2800); },
        timestep: function () {
            timestep(true);
            window.setTimeout(function () { timestep(false); }, 5000);
        },
        dith: function () {
            var p = kit.player_pos();
            if (p) shadow_trail({ x: p.x - 4, y: p.y }, p);
        },
        ru: function () { tension_on(5000); },
        sacrifice: sacrifice,
        apocalypse: function () { crater(true); },
        leap: function () { crater(false); },
        hep: function () {
            var p = kit.player_pos();
            if (!p) return;
            if (!anc.pos) anc.pos = { x: p.x + 3, y: p.y };
            transference("You", null);
        }
    };
    var test_i = 0;
    window.sdc_godfx_odd_test = function (g)
    {
        var keys = Object.keys(TESTS);
        var k = g ? String(g).toLowerCase() : keys[test_i++ % keys.length];
        if (!TESTS[k]) return "one of: " + keys.join(", ");
        TESTS[k]();
        return k;
    };

    return {};
});
