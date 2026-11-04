// Dark / wrathful god effects: torment (every source), Yredelemnul, Makhleb,
// Trog. Built on fxkit (messages, anchors, layers) and statusfx (Trog's Hand).
//
// Triggers (message strings verified against the bundled crawl source):
//   torment    "Your body is wracked with pain!" (player; skull rune), "X
//              convulses!" / "writhes in agony" (monsters: scroll, Symbol of
//              Torment, tormentors, Kiku siphon...): red-black pulse on every
//              visible monster, red vignette + shake, bar_pulse hp drain.
//   Yred       black torch lit / stoked, "You wrap your dark will around",
//              "inexorable grip" (Fathomless Shackles), "sends servants":
//              black-violet chains pulled into the player (not summonfx's
//              green wisps); "You siphon power from X's fading ..." (feed on
//              suffering) = crimson motes + green heal flash + hp fill.
//              (This crawl has no Drain Life / Animate Dead for Yred.)
//   Makhleb    Infernal Legion / Vessel of Slaughter / "destruction surges
//              wildly": ember burst; "X appears in a burst of ..." (Infernal
//              Servant): hell-red floor cracks; "You feel better." while
//              worshipping Makhleb (heal on kill): green motes. Unleash
//              Destruction itself prints no message, so it has no trigger.
//   Trog       status light "Regen Will++" (Trog's Hand, base name "regen"):
//              red player glow + soft vignette, green regenerative motes
//              (statusfx.register); Brothers in Arms: the summoned ally's
//              "goes berserk!" gives a roar shockwave ring only.
// Healing is green (125,255,176). prefers-reduced-motion: one-shot flashes,
// no particles/shake. Everything fails soft.
// Debug: window.sdc_godfx_dark_test(kind) -- kinds: torment, torment_self,
//   chains, drain, destruction, servant, kill_heal, brothers
define(["./sdc_api", "./fxkit", "./statusfx", "./player"],
function (api, kit, statusfx, player) {
    "use strict";

    var GREEN = "125,255,176", RED = "200,20,30", HELL = "255,60,20";
    var VIOLET = "90,30,130", BLACK = "10,0,16", CRIMSON = "170,10,40";
    var MAX_LIVE = 40;
    var grades = {};          // name -> {t0, ms, fn(k)} timed screen grades

    function safe(fn)
    {
        try { fn(); }
        catch (e) { console.error("sdc godfx_dark:", e); }
    }

    function layer() { return kit.layer("godfx_dark"); }

    // short-lived element in our layer, removed when it ends (capped)
    function spawn(css, frames, opts)
    {
        return kit.spawn("godfx_dark", css, frames, opts, MAX_LIVE);
    }

    // Timed screen grade: fn(k) -> grade object, k 0..1 over ms.
    function timed_grade(name, ms, fn)
    {
        grades[name] = { t0: kit.now(), ms: ms, fn: fn };
    }

    api.on("frame", function () {
        var t = kit.now();
        Object.keys(grades).forEach(function (n) {
            var g = grades[n], k = (t - g.t0) / g.ms;
            if (k >= 1)
            {
                delete grades[n];
                api.grade(n, null);
                return;
            }
            safe(function () { api.grade(n, g.fn(k)); });
        });
    });

    function clear_grades()
    {
        Object.keys(grades).forEach(function (n) { api.grade(n, null); });
        grades = {};
    }
    api.on("game_init", clear_grades);
    api.on("game_cleanup", clear_grades);

    function ring(a, color, size, ms, border)
    {
        var d = size * a.cw;
        spawn("width:" + d + "px;height:" + d + "px;margin:" + (-d / 2) + "px;"
              + "border-radius:50%;border:" + (border || 3) + "px solid "
              + kit.rgba(color, 0.9) + ";box-shadow:0 0 14px "
              + kit.rgba(color, 0.7) + ",inset 0 0 12px " + kit.rgba(color, 0.5),
              [{ transform: kit.at(a.x, a.y) + "scale(.1)", opacity: 0.95 },
               { transform: kit.at(a.x, a.y) + "scale(1)", opacity: 0 }],
              { duration: ms, easing: "ease-out" });
    }

    function glow(a, color, ms, size)
    {
        var d = (size || 1.8) * a.cw;
        spawn("width:" + d + "px;height:" + d + "px;margin:" + (-d / 2) + "px;"
              + "border-radius:50%;background:radial-gradient(circle,"
              + kit.rgba(color, 0.8) + " 0%," + kit.rgba(color, 0) + " 70%);",
              [{ transform: kit.at(a.x, a.y) + "scale(.6)", opacity: 0 },
               { transform: kit.at(a.x, a.y) + "scale(1.2)", opacity: 1,
                 offset: 0.3 },
               { transform: kit.at(a.x, a.y) + "scale(1.6)", opacity: 0 }],
              { duration: ms });
    }

    function mote(x0, y0, x1, y1, color, ms, delay, px)
    {
        var s = px || 5;
        spawn("width:" + s + "px;height:" + s + "px;margin:" + (-s / 2) + "px;"
              + "border-radius:50%;background:" + kit.rgba(color, 1)
              + ";box-shadow:0 0 6px " + kit.rgba(color, 0.9),
              [{ transform: kit.at(x0, y0) + "scale(1)", opacity: 0 },
               { transform: kit.at(x0 + (x1 - x0) * 0.2, y0 + (y1 - y0) * 0.2),
                 opacity: 1, offset: 0.15 },
               { transform: kit.at(x1, y1) + "scale(.3)", opacity: 0 }],
              { duration: ms, delay: delay || 0, easing: "ease-in" });
    }

    // Motes streaming from a ring around the player into the player.
    function motes_in(a, color, n, ms)
    {
        for (var i = 0; i < n; i++)
        {
            var ang = kit.rnd(0, 6.283), r = kit.rnd(3, 6) * a.cw;
            mote(a.x + Math.cos(ang) * r, a.y + Math.sin(ang) * r * 0.8,
                 a.x, a.y, color, ms * kit.rnd(0.7, 1), i * 40);
        }
    }

    // Motes rising off the player (regeneration).
    function motes_up(a, color, n, ms)
    {
        for (var i = 0; i < n; i++)
        {
            var x = a.x + kit.rnd(-0.4, 0.4) * a.cw;
            mote(x, a.y + 0.3 * a.ch, x + kit.rnd(-8, 8),
                 a.y - kit.rnd(1, 1.8) * a.ch, color, ms * kit.rnd(0.7, 1.1),
                 i * 60, 4);
        }
    }

    // Banded chain from (x0,y0) to (x1,y1): drawn on, then pulled in.
    function tendril(x0, y0, x1, y1, ms, delay)
    {
        var dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy);
        var rot = "rotate(" + Math.atan2(dy, dx) + "rad) ";
        spawn("width:" + len + "px;height:3px;margin-top:-1.5px;"
              + "transform-origin:0 50%;background:repeating-linear-gradient("
              + "90deg," + kit.rgba(VIOLET, 0.95) + " 0 7px,"
              + kit.rgba(BLACK, 0.9) + " 7px 11px);box-shadow:0 0 8px "
              + kit.rgba(VIOLET, 0.9),
              [{ transform: kit.at(x0, y0) + rot + "scaleX(0)", opacity: 0.95 },
               { transform: kit.at(x0, y0) + rot + "scaleX(1)", opacity: 0.95,
                 offset: 0.55 },
               { transform: kit.at(x0, y0) + rot + "scaleX(1)", opacity: 0 }],
              { duration: ms, delay: delay || 0, easing: "ease-in-out" });
    }

    // Effects ------------------------------------------------------------------

    function fx_torment(self)
    {
        var rm = kit.reduced();
        kit.monsters().forEach(function (m) {
            var a = kit.anchor_of(m);
            if (!a) return;
            safe(function () {
                glow(a, RED, rm ? 500 : 900, 2.2);
                if (!rm) ring(a, BLACK, 2.4, 800, 4);
            });
        });
        var vm = self ? 1 : 0.6;
        timed_grade("godfx_dark_torment", rm ? 600 : 1100, function (k) {
            var e = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
            var o = { vig: [0.55, 0.0, 0.03], vig_a: 0.85 * vm * e,
                      desat: 0.35 * vm * e };
            if (!rm && k < 0.45)
            {
                var s = (1 - k / 0.45) * 7 * vm;
                o.sx = (Math.random() - 0.5) * s;
                o.sy = (Math.random() - 0.5) * s;
            }
            return o;
        });
        var a = kit.anchor_of(kit.player_pos());
        if (self && a)
        {
            glow(a, RED, 900, 2.6);
            // skull rune flash
            var d = a.cw * 1.6;
            var sk = spawn("width:" + d + "px;height:" + d + "px;margin:"
                  + (-d / 2) + "px;font:" + Math.round(d * 0.9)
                  + "px/" + d + "px serif;text-align:center;color:"
                  + kit.rgba("230,40,50", 1) + ";text-shadow:0 0 12px "
                  + kit.rgba(RED, 1) + ",0 0 3px #000",
                  [{ transform: kit.at(a.x, a.y) + "scale(.5)", opacity: 0 },
                   { transform: kit.at(a.x, a.y) + "scale(1.1)", opacity: 1,
                     offset: 0.2 },
                   { transform: kit.at(a.x, a.y) + "scale(1.3)", opacity: 0 }],
                  { duration: rm ? 600 : 950 });
            if (sk) sk.textContent = "☠";
        }
        api.emit("bar_pulse", "hp", "drain", RED);
    }

    function fx_chains(n)
    {
        var a = kit.anchor_of(kit.player_pos());
        if (!a) return;
        glow(a, VIOLET, 900, 2);
        if (kit.reduced()) return;
        for (var i = 0; i < n; i++)
        {
            var ang = kit.rnd(0, 6.283), r = kit.rnd(3, 6) * a.cw;
            tendril(a.x + Math.cos(ang) * r, a.y + Math.sin(ang) * r * 0.8,
                    a.x, a.y, kit.rnd(750, 1000), i * 80);
        }
    }

    function fx_drain()
    {
        var a = kit.anchor_of(kit.player_pos());
        if (!a) return;
        if (!kit.reduced())
        {
            motes_in(a, CRIMSON, 12, 800);
            motes_in(a, BLACK, 6, 800);
        }
        // green heal flash, a beat after the motes land
        setTimeout(function () {
            safe(function () {
                var b = kit.anchor_of(kit.player_pos());
                if (b) glow(b, GREEN, 700, 2.2);
                api.emit("bar_pulse", "hp", "fill", GREEN);
            });
        }, kit.reduced() ? 0 : 600);
    }

    function fx_destruction()
    {
        var a = kit.anchor_of(kit.player_pos());
        if (!a) return;
        glow(a, HELL, 600, 3);
        if (kit.reduced()) return;
        ring(a, HELL, 3, 500, 2);
        for (var i = 0; i < 22; i++)
        {
            var ang = kit.rnd(0, 6.283), r = kit.rnd(1.5, 4) * a.cw;
            var dx = Math.cos(ang) * r, dy = Math.sin(ang) * r;
            var s = kit.rnd(3, 6);
            spawn("width:" + s + "px;height:" + s + "px;border-radius:50%;"
                  + "background:" + kit.pick(["#ff7a1a", "#ffb030", "#e83a10"])
                  + ";box-shadow:0 0 8px #ff5a10",
                  [{ transform: kit.at(a.x, a.y), opacity: 1 },
                   { transform: kit.at(a.x + dx, a.y + dy - 0.5 * a.ch),
                     opacity: 1, offset: 0.5 },
                   { transform: kit.at(a.x + dx * 1.2, a.y + dy - 1.4 * a.ch),
                     opacity: 0 }],
                  { duration: kit.rnd(600, 950),
                    easing: "cubic-bezier(.2,.7,.4,1)" });
        }
    }

    function fx_servant()
    {
        var a = kit.anchor_of(kit.player_pos());
        if (!a) return;
        var n = kit.reduced() ? 2 : 5;
        for (var i = 0; i < n; i++)
        {
            var ox = kit.rnd(-1.8, 1.8) * a.cw, oy = kit.rnd(-1.4, 1.4) * a.ch;
            var len = kit.rnd(0.8, 1.6) * a.cw;
            var base = kit.at(a.x + ox, a.y + oy)
                       + "rotate(" + kit.rnd(0, 3.14) + "rad) ";
            spawn("width:" + len + "px;height:3px;margin-left:" + (-len / 2)
                  + "px;background:linear-gradient(90deg,transparent,"
                  + kit.rgba(HELL, 1) + ",#ffd070,"
                  + kit.rgba(HELL, 1) + ",transparent);box-shadow:0 0 12px "
                  + kit.rgba(HELL, 0.9),
                  [{ transform: base + "scale(0,.4)", opacity: 0 },
                   { transform: base + "scale(1,1.6)", opacity: 1,
                     offset: 0.35 },
                   { transform: base + "scale(1.1,1)", opacity: 0.9,
                     offset: 0.75 },
                   { transform: base + "scale(1.1,.2)", opacity: 0 }],
                  { duration: 1200, delay: i * 90 });
        }
        glow(a, HELL, 1100, 3);
    }

    function fx_kill_heal()
    {
        var a = kit.anchor_of(kit.player_pos());
        if (!a) return;
        glow(a, GREEN, 700, 2);
        if (!kit.reduced()) motes_up(a, GREEN, 9, 900);
        api.emit("bar_pulse", "hp", "fill", GREEN);
    }

    function fx_brothers()
    {
        var a = kit.anchor_of(kit.player_pos());
        if (!a) return;
        ring(a, "255,70,40", 9, 900, 4);
        if (kit.reduced()) return;
        ring(a, "255,170,60", 6, 700, 2);
        timed_grade("godfx_dark_roar", 500, function (k) {
            var s = (1 - k) * 6;
            return { sx: (Math.random() - 0.5) * s,
                     sy: (Math.random() - 0.5) * s,
                     vig: [0.6, 0.1, 0.0], vig_a: 0.4 * (1 - k) };
        });
    }

    // Trog's Hand: status.cc _describe_regen light_text "Regen Will++".
    statusfx.register({
        id: "godfx_trogs_hand",
        match: /^regen$/,
        start: function (ctx) {
            ctx.data.glow = kit.mk(ctx.root,
                "width:70px;height:70px;border-radius:50%;"
                + "background:radial-gradient(circle," + kit.rgba(RED, 0.55)
                + " 0%," + kit.rgba(RED, 0) + " 70%);");
            if (!kit.reduced())
                kit.anim(ctx.data.glow,
                    [{ opacity: 0.6 }, { opacity: 1 }, { opacity: 0.6 }],
                    { duration: 1600, iterations: Infinity,
                      easing: "ease-in-out" });
            api.grade("godfx_trogs_hand",
                      { vig: [0.5, 0.02, 0.02], vig_a: 0.3 });
            ctx.data.next = 0;
        },
        frame: function (ctx) {
            var a = ctx.anchor, g = ctx.data.glow;
            if (!a) { g.style.visibility = "hidden"; return; }
            g.style.visibility = "";
            var sz = a.cw * 2;
            g.style.width = g.style.height = sz + "px";
            g.style.margin = (-sz / 2) + "px";
            g.style.transform = kit.at(a.x, a.y);
            if (kit.reduced()) return;
            var n = kit.now();
            if (n >= ctx.data.next)
            {
                ctx.data.next = n + kit.rnd(250, 450);
                var x = a.x + kit.rnd(-0.4, 0.4) * a.cw;
                mote(x, a.y + 0.3 * a.ch, x + kit.rnd(-6, 6),
                     a.y - kit.rnd(1, 1.6) * a.ch, GREEN, 1000, 0, 4);
            }
        },
        cleanup: function () { api.grade("godfx_trogs_hand", null); }
    });

    // Messages -----------------------------------------------------------------

    // Strings verified against god-abil.cc / ability.cc / spl-goditem.cc /
    // mon-death.cc / message.cc of the bundled (new Yred/Makhleb) crawl.
    var rules = [
        // torment: torment_player (spl-goditem.cc); monsters "convulses!"
        { re: /Your body is wracked with pain/i,
          fn: function () { fx_torment(true); } },
        { re: /convulses!|writhes in agony|bathed in an unholy light/i,
          fn: function () { fx_torment(false); } },
        // Yredelemnul: black torch, bind soul, shackles, servants
        { re: /lift the black torch aloft|black torch howls/i,
          fn: function () { fx_chains(4); } },
        { re: /wrap your dark will around/i,
          fn: function () { fx_chains(6); } },
        { re: /call down Yredelemnul's inexorable grip/i,
          fn: function () { fx_chains(9); } },
        { re: /Yredelemnul sends servants to aid you/i,
          fn: function () { fx_chains(5); } },
        { re: /You siphon power from .* fading/i, fn: fx_drain },
        // Makhleb: legion, vessel of slaughter, infernal servant, kill heal
        { re: /beckon forth the legions of chaos|destruction surges wildly|overwhelming power flowing through you/i,
          fn: fx_destruction },
        { re: /appears in a burst of|answers the call of your/i,
          fn: fx_servant },
        { re: /^You feel better.$/i, fn: function () {
              if (/makhleb/i.test(kit.strip(player.god))) fx_kill_heal();
          } },
        // Trog: summon_berserker prints nothing itself; the ally's
        // "goes berserk!" is the only per-cast line
        { re: /goes berserk!/i, fn: fx_brothers }
    ];

    kit.on_message(function (text) {
        safe(function () {
            for (var i = 0; i < rules.length; i++)
                if (rules[i].re.test(text)) { rules[i].fn(); return; }
        });
    });

    window.sdc_godfx_dark_test = function (kind) {
        var map = {
            torment: function () { fx_torment(false); },
            torment_self: function () { fx_torment(true); },
            chains: function () { fx_chains(6); },
            drain: fx_drain,
            destruction: fx_destruction,
            servant: fx_servant,
            kill_heal: fx_kill_heal,
            brothers: fx_brothers
        };
        var f = map[kind || "torment"];
        if (f) safe(f);
        return Object.keys(map).join(", ");
    };

    return {};
});
