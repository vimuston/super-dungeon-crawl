// Item effects: scroll reading, potion quaffing, rune / Orb of Zot pickup.
// Everything is a short overlay in the shared "itemfx" fxkit layer (above the
// dungeon, below the HUD) plus, for whole-screen moods, api.grade channels
// ("itemfx-*") that fade out on their own. Cheap: <= ~30 live elements.
//
// Triggers (fxkit game messages). Wordings checked against the local crawl
// source (item-use.cc / potion.cc / items.cc). Scrolls fire only inside a read
// window opened by "As you read the scroll ..., it crumbles to dust."; potions
// only on effect lines (never on a bare
// "potion of X" mention). Scrolls/potions that no longer exist in this
// crawl (holy word, agility, stamina, degeneration) are not implemented.
//   scrolls  fog ("dissolves into smoke"), noise ("loud clanging noise"),
//            vulnerability ("wave of despondency"), immolation ("inner flame" / "surges with heat"),
//            torment (scroll name / "torment"), summoning ("Wisps of shadow
//            whirl"), acquirement, identify, enchant weapon/armour, brand
//            weapon, fear ("fearsome visage"). Teleportation = blink.js.
//   potions  heal wounds / curing ("You feel much better." / "better"; green,
//            emits bar_pulse hp fill), haste ("speed up"; blue lines),
//            resistance ("You feel protected."), might / brilliance (red /
//            blue), magic ("Magic courses through your body."; emits
//            bar_pulse mp fill), mutation ("You feel extremely strange." ->
//            body.sdc-ifx-glitch + wobble grade), lignification ("woody"),
//            experience. Berserk / invisibility are other modules'.
//   runes    "You pick up the <name> rune and feel its power.": banner +
//            sparkle burst in the rune's colour + screen flash.
//   orb      "You pick up the Orb of Zot!": larger gold banner and mood.
// Events emitted: bar_pulse (see barfx.js).
// Reduced motion: no particles / shakes, only brief flashes and the text.
// Debug: window.sdc_itemfx_test("scroll:noise" | "potion:haste" |
//        "rune:serpentine" | "orb"); a bare name (e.g. "fog", "heal") works.
define(["./sdc_api", "./fxkit"], function (api, kit) {
    "use strict";

    var recent = {};                 // key -> time, dedupe repeated lines
    var pulses = {};                 // grade name -> {t0, dur, g}
    var rgba = kit.rgba, rnd = kit.rnd;

    var RUNES = {
        serpentine: "70,220,90", decaying: "150,170,60",
        barnacled: "60,200,190", gossamer: "235,235,255", slimy: "100,230,60",
        silver: "205,215,230", golden: "255,210,70", iron: "170,180,195",
        obsidian: "150,90,220", icy: "150,225,255", bone: "235,225,190",
        abyssal: "170,60,230", demonic: "255,70,50", fiery: "255,130,30",
        magical: "255,90,230", glowing: "255,255,170", dark: "130,100,200",
        mossy: "110,170,70"
    };

    function ok(key, ms)
    {
        var t = kit.now();
        if (recent[key] && t - recent[key] < (ms || 1200)) return false;
        recent[key] = t;
        return true;
    }

    // Geometry / building blocks ---------------------------------------------

    function centre()
    {
        var a = kit.anchor_of(kit.player_pos());
        if (a) return a;
        var r = kit.view_rect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2,
                 cw: 32, ch: 32 };
    }

    function layer() { return kit.layer("itemfx"); }

    // an element that removes itself when its animation ends
    function life(el, frames, opts)
    {
        var a = kit.anim(el, frames, opts);
        var gone = function () {
            if (el.parentNode) el.parentNode.removeChild(el);
        };
        a.onfinish = gone;
        a.oncancel = gone;
        return a;
    }

    // whole-screen mood through the grade channel, fading over `dur` ms
    function mood(name, g, dur)
    {
        if (kit.reduced() && !g.vig_a) return;
        pulses[name] = { t0: kit.now(), dur: dur, g: g };
    }

    api.on("frame", function () {
        var t = kit.now();
        Object.keys(pulses).forEach(function (n) {
            var p = pulses[n], k = (t - p.t0) / p.dur;
            if (k >= 1) { delete pulses[n]; api.grade(n, null); return; }
            var s = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
            var o = {};
            Object.keys(p.g).forEach(function (f) {
                var v = p.g[f];
                o[f] = (f === "tint" || f === "vig") ? v : v * s;
            });
            api.grade(n, o);
        });
    });
    api.on("game_cleanup", function () {
        Object.keys(pulses).forEach(function (n) { api.grade(n, null); });
        pulses = {};
    });

    function flash(color, ms, a)
    {
        var rgb = color.split(",").map(Number);
        mood("itemfx-flash", { vig: rgb, vig_a: a || 0.7,
                               tint: [0.6 + rgb[0] / 640, 0.6 + rgb[1] / 640,
                                      0.6 + rgb[2] / 640], tint_a: 0.25 },
             ms || 700);
    }

    function label(text, color, y, size, ms)
    {
        var a = centre();
        var el = kit.mk(layer(), "font:bold " + size + "px monospace;"
            + "letter-spacing:4px;white-space:nowrap;color:" + rgba(color, 1)
            + ";text-shadow:0 0 8px " + rgba(color, 0.9) + ",0 0 22px "
            + rgba(color, 0.6) + ";");
        el.textContent = text;
        var x = a.x - text.length * size * 0.4, y0 = a.y + y;
        life(el, [{ transform: kit.at(x, y0 + 10) + "scale(.7)", opacity: 0 },
                  { transform: kit.at(x, y0) + "scale(1)", opacity: 1,
                    offset: 0.2 },
                  { transform: kit.at(x, y0 - 14) + "scale(1)", opacity: 0 }],
             { duration: ms });
    }

    // n dots flying out of (x, y), or drifting up when `rise`
    function sparks(x, y, color, n, spread, ms, rise)
    {
        if (kit.reduced()) return;
        n = Math.min(n, 28);
        for (var i = 0; i < n; i++)
        {
            var s = rnd(3, 7), ang = rnd(0, 6.283), d = rnd(0.3, 1) * spread;
            var dx = rise ? rnd(-spread, spread) * 0.5 : Math.cos(ang) * d;
            var dy = rise ? -d : Math.sin(ang) * d;
            var el = kit.mk(layer(), "width:" + s + "px;height:" + s
                + "px;border-radius:50%;background:" + rgba(color, 1)
                + ";box-shadow:0 0 6px " + rgba(color, 0.9) + ";");
            life(el, [{ transform: kit.at(x, y) + "scale(1)", opacity: 1 },
                      { transform: kit.at(x + dx, y + dy) + "scale(.2)",
                        opacity: 0 }],
                 { duration: ms * rnd(0.7, 1.2), delay: rnd(0, ms * 0.25) });
        }
    }

    function rings(x, y, color, n, size, ms)
    {
        if (kit.reduced()) n = 1;
        for (var i = 0; i < n; i++)
        {
            var el = kit.mk(layer(), "width:" + size + "px;height:" + size
                + "px;margin:" + (-size / 2) + "px 0 0 " + (-size / 2)
                + "px;border-radius:50%;border:2px solid " + rgba(color, 0.9)
                + ";box-shadow:0 0 10px " + rgba(color, 0.6) + ";");
            life(el, [{ transform: kit.at(x, y) + "scale(.1)", opacity: 0.9 },
                      { transform: kit.at(x, y) + "scale(1)", opacity: 0 }],
                 { duration: ms, delay: i * ms * 0.25 });
        }
    }

    function glow(x, y, color, size, ms)
    {
        var el = kit.mk(layer(), "width:" + size + "px;height:" + size
            + "px;margin:" + (-size / 2) + "px 0 0 " + (-size / 2) + "px;"
            + "border-radius:50%;mix-blend-mode:screen;background:radial-"
            + "gradient(circle," + rgba(color, 0.8) + "," + rgba(color, 0)
            + " 70%);");
        life(el, [{ transform: kit.at(x, y) + "scale(.3)", opacity: 0 },
                  { transform: kit.at(x, y) + "scale(1)", opacity: 1,
                    offset: 0.3 },
                  { transform: kit.at(x, y) + "scale(1.3)", opacity: 0 }],
             { duration: ms });
    }

    // An unfurling parchment with drifting runes, tinted per scroll.
    function unfurl(color)
    {
        var a = centre(), w = 34, h = 44;
        var el = kit.mk(layer(), "width:" + w + "px;height:" + h + "px;"
            + "margin:" + (-h / 2) + "px 0 0 " + (-w / 2) + "px;"
            + "border-radius:3px;background:linear-gradient(90deg,"
            + "rgba(230,215,170,.95)," + rgba(color, 0.55)
            + ",rgba(230,215,170,.95));box-shadow:0 0 14px "
            + rgba(color, 0.8) + ";color:rgba(60,40,20,.9);font:11px/12px "
            + "monospace;text-align:center;overflow:hidden;");
        el.textContent = "ᚠᚢᚦᚨᚱᚲᚷ";
        var y = a.y - a.ch * 0.9;
        life(el, [{ transform: kit.at(a.x, y) + "scaleY(.05)", opacity: 0 },
                  { transform: kit.at(a.x, y - 8) + "scaleY(1)", opacity: 1,
                    offset: 0.3 },
                  { transform: kit.at(a.x, y - 22) + "scaleY(1)", opacity: 1,
                    offset: 0.7 },
                  { transform: kit.at(a.x, y - 36) + "scaleY(1.1)",
                    opacity: 0 }], { duration: 1100 });
    }

    // Scrolls ----------------------------------------------------------------

    function puffs(a, color, n)
    {
        if (kit.reduced()) return;
        for (var i = 0; i < Math.min(n, 12); i++)
        {
            var s = rnd(40, 90);
            var el = kit.mk(layer(), "width:" + s + "px;height:" + s
                + "px;margin:" + (-s / 2) + "px 0 0 " + (-s / 2) + "px;"
                + "border-radius:50%;background:radial-gradient(circle,"
                + rgba(color, 0.55) + "," + rgba(color, 0) + " 70%);");
            var dx = rnd(-a.cw * 3, a.cw * 3), dy = rnd(-a.ch * 2, a.ch);
            life(el, [{ transform: kit.at(a.x, a.y) + "scale(.3)", opacity: 0 },
                      { opacity: 1, offset: 0.3,
                        transform: kit.at(a.x + dx * 0.5, a.y + dy * 0.5)
                                   + "scale(1)" },
                      { transform: kit.at(a.x + dx, a.y + dy - 20) + "scale(1.4)",
                        opacity: 0 }],
                 { duration: rnd(1500, 2400), delay: rnd(0, 300) });
        }
    }

    function shield(a, color)
    {
        var el = kit.mk(layer(), "width:48px;height:56px;margin:-28px 0 0 -24px;"
            + "filter:drop-shadow(0 0 6px " + rgba(color, 0.9) + ");");
        el.innerHTML = '<svg viewBox="0 0 48 56" width="48" height="56">'
            + '<path d="M24 2 L44 10 V28 C44 42 34 50 24 54 C14 50 4 42 4 28 '
            + 'V10 Z" fill="' + rgba(color, 0.25) + '" stroke="' + rgba(color, 1)
            + '" stroke-width="2.5"/><path d="M24 4 L20 20 L28 28 L18 40 L24 52"'
            + ' fill="none" stroke="#fff" stroke-width="2"/></svg>';
        life(el, [{ transform: kit.at(a.x, a.y) + "scale(.5)", opacity: 0 },
                  { transform: kit.at(a.x, a.y) + "scale(1.1)", opacity: 1,
                    offset: 0.2 },
                  { transform: kit.at(a.x + 3, a.y + 2) + "scale(1.05)",
                    opacity: 1, offset: 0.35 },
                  { transform: kit.at(a.x, a.y + 24) + "scale(.9)",
                    opacity: 0 }], { duration: 1200 });
    }

    function fire_ring()
    {
        var el = kit.mk(layer(), "left:0;top:0;right:0;bottom:0;"
            + "mix-blend-mode:screen;background:radial-gradient(ellipse at "
            + "50% 50%,transparent 45%,rgba(255,110,20,.55) 80%,"
            + "rgba(255,230,90,.85) 100%);");
        life(el, [{ opacity: 0 }, { opacity: 1, offset: 0.15 },
                  { opacity: 0.55, offset: 0.3 }, { opacity: 0.9, offset: 0.45 },
                  { opacity: 0 }], { duration: 1500, easing: "linear" });
    }

    var SCROLLS = {
        fog: function (a) {
            unfurl("170,175,185");
            puffs(a, "185,190,200", 10);
        },
        noise: function (a) {
            unfurl("255,200,90");
            rings(a.x, a.y, "255,220,120", 3, 360, 1000);
            label("NOISE", "255,225,130", -a.ch * 1.6, 28, 1100);
            mood("itemfx-shake", { sx: 7, sy: 5 }, 450);
        },
        vulnerability: function (a) {
            unfurl("255,110,90");
            shield(a, "255,120,100");
            flash("255,70,60", 600, 0.5);
        },
        immolation: function (a) {
            unfurl("255,130,40");
            fire_ring();
            mood("itemfx-fire", { vig: [255, 110, 20], vig_a: 0.9,
                                  tint: [1, 0.75, 0.55], tint_a: 0.3 }, 1500);
            sparks(a.x, a.y, "255,170,50", 16, 70, 900, true);
        },
        torment: function (a) {
            unfurl("120,40,160");
            mood("itemfx-torment", { invert: 0.7, desat: 0.6,
                                     vig: [120, 0, 40], vig_a: 0.9 }, 900);
            label("TORMENT", "200,60,90", -a.ch * 1.6, 26, 1200);
        },
        fear: function (a) {
            unfurl("200,60,60");
            rings(a.x, a.y, "255,80,70", 2, 260, 900);
            flash("255,60,50", 600, 0.5);
        },
        summoning: function (a) {
            unfurl("120,80,170");
            rings(a.x, a.y, "150,100,220", 2, 120, 1100);
            sparks(a.x, a.y, "170,130,230", 16, 60, 1000, true);
            glow(a.x, a.y, "110,70,170", 140, 1000);
        },
        acquirement: function (a) {
            unfurl("255,215,80");
            label("ACQUIREMENT", "255,222,100", -a.ch * 1.6, 24, 1600);
            sparks(a.x, a.y - 10, "255,220,100", 24, 90, 1300, true);
            flash("255,215,90", 800, 0.5);
        },
        revelation: function (a) {
            unfurl("120,230,220");
            rings(a.x, a.y, "130,240,230", 3, 500, 1200);
        },
        identify: function (a) {
            unfurl("120,200,255");
            sparks(a.x, a.y - 10, "170,225,255", 12, 50, 900, true);
        },
        enchant: function (a) {
            unfurl("140,170,255");
            sparks(a.x, a.y, "190,210,255", 16, 50, 1000, true);
            glow(a.x, a.y, "150,180,255", 100, 900);
        }
    };

    // Potions ----------------------------------------------------------------

    // coloured splash flying from the player toward the vitals panel
    function splash(a, color)
    {
        var v = document.getElementById("sdc_vitals");
        var r = v && v.getBoundingClientRect();
        var tx = r && r.width ? r.left + r.width / 2 : a.x;
        var ty = r && r.width ? r.top + r.height / 2 : a.y - 80;
        glow(a.x, a.y, color, 90, 700);
        if (kit.reduced()) return;
        for (var i = 0; i < 6; i++)
        {
            var s = rnd(6, 11);
            var el = kit.mk(layer(), "width:" + s + "px;height:" + s
                + "px;border-radius:50%;background:" + rgba(color, 0.95)
                + ";box-shadow:0 0 8px " + rgba(color, 0.9) + ";");
            life(el, [{ transform: kit.at(a.x, a.y) + "scale(1)", opacity: 1 },
                      { transform: kit.at(a.x + rnd(-30, 30), a.y - 40)
                                   + "scale(1.2)", opacity: 1, offset: 0.3 },
                      { transform: kit.at(tx + rnd(-20, 20), ty) + "scale(.3)",
                        opacity: 0 }],
                 { duration: rnd(600, 900), delay: i * 50,
                   easing: "cubic-bezier(.4,0,.6,1)" });
        }
    }

    function speed_lines(color)
    {
        if (kit.reduced()) return;
        var r = kit.view_rect();
        for (var i = 0; i < 14; i++)
        {
            var w = rnd(80, 220), y = r.top + rnd(0.1, 0.9) * r.height;
            var el = kit.mk(layer(), "width:" + w + "px;height:2px;"
                + "background:linear-gradient(90deg,transparent,"
                + rgba(color, 0.9) + ");");
            var x0 = r.left + r.width + 20;
            life(el, [{ transform: kit.at(x0, y), opacity: 0 },
                      { opacity: 1, offset: 0.2,
                        transform: kit.at(x0 - r.width * 0.3, y) },
                      { transform: kit.at(r.left - w, y), opacity: 0 }],
                 { duration: rnd(350, 550), delay: rnd(0, 350),
                   easing: "linear" });
        }
    }

    function quaff(color, bar)
    {
        var a = centre();
        splash(a, color);
        if (bar) api.emit("bar_pulse", bar[0], "fill", bar[1]);
        return a;
    }

    function glitch()
    {
        var b = document.body;
        b.classList.add("sdc-ifx-glitch");
        setTimeout(function () { b.classList.remove("sdc-ifx-glitch"); }, 900);
        mood("itemfx-glitch", { wobble: 0.5, smear: 0.6, hue: 0.04 }, 900);
    }

    var POTIONS = {
        heal: function () {
            var a = quaff("125,255,176", ["hp", "125,255,176"]);
            sparks(a.x, a.y, "160,255,200", 10, 40, 900, true);
            flash("110,255,170", 600, 0.35);
        },
        haste: function () {
            quaff("90,170,255");
            speed_lines("130,200,255");
        },
        resistance: function () {
            quaff("150,230,215");
            flash("150,230,215", 800, 0.8);
        },
        might: function () { quaff("255,80,70"); flash("255,70,60", 600, 0.4); },
        brilliance: function () {
            quaff("90,140,255");
            flash("90,130,255", 600, 0.4);
        },
        magic: function () { quaff("90,160,255", ["mp", "90,160,255"]); },
        experience: function () {
            var a = quaff("255,225,110");
            sparks(a.x, a.y, "255,230,120", 16, 70, 1100, true);
            flash("255,220,100", 700, 0.45);
        },
        mutation: function () { quaff("220,90,255"); glitch(); },
        lignification: function () {
            var a = quaff("130,170,70");
            mood("itemfx-wood", { tint: [0.75, 0.6, 0.35], tint_a: 0.4,
                                  vig: [90, 60, 20], vig_a: 0.5 }, 1400);
            sparks(a.x, a.y, "150,110,60", 10, 40, 900);
        }
    };

    // Runes and the Orb -------------------------------------------------------

    function banner(title, sub, color)
    {
        var r = kit.view_rect();
        var el = kit.mk(layer(), "left:" + r.left + "px;width:" + r.width + "px;"
            + "top:" + (r.top + r.height * 0.3) + "px;text-align:center;"
            + "font:bold 34px monospace;letter-spacing:8px;color:"
            + rgba(color, 1) + ";text-shadow:0 0 12px " + rgba(color, 0.95)
            + ",0 0 36px " + rgba(color, 0.7) + ",0 2px 0 rgba(0,0,0,.8);");
        el.textContent = title;
        var s = document.createElement("div");
        s.style.cssText = "font-size:14px;letter-spacing:5px;margin-top:6px;"
                          + "opacity:.85;";
        s.textContent = sub;
        el.appendChild(s);
        life(el, [{ opacity: 0, transform: "scale(1.5)" },
                  { opacity: 1, transform: "scale(1)", offset: 0.12 },
                  { opacity: 1, transform: "scale(1.02)", offset: 0.8 },
                  { opacity: 0, transform: "scale(1.06)" }],
             { duration: 3200 });
    }

    function rune_burst(name, color)
    {
        var a = centre();
        banner(name.toUpperCase() + " RUNE", "RUNE OF ZOT ACQUIRED", color);
        glow(a.x, a.y, color, 320, 1800);
        rings(a.x, a.y, color, 3, 300, 1500);
        sparks(a.x, a.y, color, 28, 130, 1600);
        flash(color, 1400, 0.8);
    }

    function orb_burst()
    {
        var a = centre();
        banner("THE ORB OF ZOT", "ESCAPE WITH IT!", "255,200,60");
        glow(a.x, a.y, "255,170,40", 420, 2200);
        rings(a.x, a.y, "255,120,40", 3, 360, 1600);
        sparks(a.x, a.y, "255,220,90", 28, 170, 1800);
        mood("itemfx-orb", { vig: [255, 160, 30], vig_a: 0.95, hue: 0.03,
                             tint: [1, 0.8, 0.5], tint_a: 0.4 }, 2200);
    }

    // Dispatch ----------------------------------------------------------------

    // Scrolls: only react to a *read*. crawl prints (item-use.cc read()):
    //   "As you read the scroll of fog, it dissolves into smoke."  (fog)
    //   "As you read the scroll labeled XYZ, it crumbles to dust." (unidentified)
    //   "As you read the scroll of X, it crumbles to dust." (known; "thunderously
    //   recite" with Booming Voice). Cancellable scrolls (identify, enchant,
    //   brand, blink) print it after the prompt. Identification lines follow:
    //   "It is a scroll of X." / "This is a scroll of acquirement!".
    // Pickup/look/inventory lines ("You see here a scroll of fog", "k - a scroll
    // of fog.") never match the read line, so they are ignored.
    var READ_RX = /as you (?:read|thunderously recite) the scroll (?:of ([a-z' -]+?)|labell?ed [^,]+?), it (?:crumbles to dust|dissolves into smoke)/;
    var IDENT_RX = /(?:it is|this is) a scroll of ([a-z' -]+?)[.!]/;
    var READ_WINDOW = 2200;
    var SCROLL_NAME = [
        ["fog", /^fog$/], ["noise", /^noise$/],
        ["vulnerability", /^vulnerability$/], ["immolation", /^immolation$/],
        ["torment", /^torment$/], ["fear", /^fear$/],
        ["summoning", /^summoning$/], ["acquirement", /^acquirement$/],
        ["revelation", /^revelation$/], ["identify", /^identify$/],
        ["enchant", /^(?:enchant (?:weapon|armou?r)|brand weapon)$/]
    ];
    // Effect lines, only honoured inside the read window.
    var SCROLL_EFFECT = [
        ["fog", /dissolves into smoke/],
        ["noise", /loud clanging noise/],
        ["vulnerability", /wave of despondency/],
        ["immolation", /inner flame!|surges with heat/],
        ["torment", /your body is wracked with pain|surge of unholy energy/],
        ["fear", /fearsome visage/],
        ["summoning", /wisps of shadow whirl/]
    ];
    // Effect lines emitted only by scroll code (verified), valid without a
    // preceding read line (e.g. the read line scrolled off / was missed).
    var SCROLL_UNIQUE = /loud clanging noise|wave of despondency|fearsome visage|creatures around you are filled with an inner flame|air around you briefly surges with heat/;
    var read_until = 0, read_played = false;

    var POTION_RX = [
        // Effect lines only; a bare "potion of X" (pickup / look / inventory)
        // never triggers. "It was a potion of X." is printed only when quaffing
        // an unidentified potion.
        ["heal", /you feel much better|it was a potion of (?:heal wounds|curing)/],
        ["haste", /you feel yourself speed up|it was a potion of haste/],
        ["resistance", /you feel protected|it was a potion of resistance/],
        ["might", /you feel (?:very mighty|mightier) all of a sudden|it was a potion of might/],
        ["brilliance", /clever all of a sudden|it was a potion of brilliance/],
        ["magic", /magic courses through your body|it was a potion of magic/],
        ["experience", /you feel more experienced|it was a potion of experience/],
        ["mutation", /you feel extremely strange|it was a potion of mutation/],
        ["lignification", /you feel woody|it was a potion of lignification/]
    ];

    function find(list, text)
    {
        for (var i = 0; i < list.length; i++)
            if (list[i][1].test(text)) return list[i][0];
        return null;
    }

    function play(kind, key)
    {
        var a = centre();
        if (kind === "scroll" && SCROLLS[key])
            SCROLLS[key](a);
        else if (kind === "potion" && POTIONS[key])
            POTIONS[key]();
        else if (kind === "rune")
            rune_burst(key, RUNES[key] || "255,215,100");
        else if (kind === "orb")
            orb_burst();
    }

    function on_text(text)
    {
        try
        {
            var t = String(text).toLowerCase();
            var m = /you pick up the ([a-z]+) rune/.exec(t);
            if (m)
            {
                if (ok("rune" + m[1], 4000)) play("rune", m[1]);
                return;
            }
            if (/you pick up the orb of zot/.test(t))
            {
                if (ok("orb", 4000)) play("orb");
                return;
            }
            var now = kit.now(), sc = null;
            var rd = READ_RX.exec(t);
            if (rd)
            {
                read_until = now + READ_WINDOW;
                read_played = false;
                if (rd[1]) sc = find(SCROLL_NAME, rd[1]);
                if (!sc) sc = find(SCROLL_EFFECT, t);   // fog line
            }
            else if (now < read_until)
            {
                var id = IDENT_RX.exec(t);
                if (id) sc = find(SCROLL_NAME, id[1]);
                if (!sc) sc = find(SCROLL_EFFECT, t);
            }
            else if (SCROLL_UNIQUE.test(t))
                sc = find(SCROLL_EFFECT, t);
            if (sc)
            {
                if (!(read_played && now < read_until) && ok("scroll" + sc))
                {
                    read_played = true;
                    play("scroll", sc);
                }
                return;
            }
            var po = find(POTION_RX, t);
            if (po && ok("potion" + po)) play("potion", po);
        }
        catch (e)
        {
            console.error("sdc: itemfx failed", e);
        }
    }

    kit.on_message(on_text);

    window.sdc_itemfx_test = function (what) {
        what = String(what || "scroll:noise");
        if (what === "orb") return play("orb");
        var p = what.split(":"), kind = p[0], key = p[1];
        if (!key)
        {
            key = kind;
            kind = SCROLLS[key] ? "scroll" : POTIONS[key] ? "potion" : "rune";
        }
        play(kind, key);
    };

    return {};
});
