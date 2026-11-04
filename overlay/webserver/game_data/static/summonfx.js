// Summon effects: a CRT "materialise" for summoned allies.
//   S7  summon spells   a flattened rune circle (dashed rings + glyph ticks)
//                       draws under the new creature's tile, then a scanline
//                       curtain wipes away top to bottom with a bright edge
//                       (build-in). Colour by theme: ice cyan, lightning
//                       yellow, demonic red, generic violet.
//   S14 necromancy      green-white soul wisps rise from around the tile into
//                       the new ally (Animate Dead, Death Channel, Simulacrum,
//                       Haunt, Animate Skeleton, ...).
//   W9  evokables       pop + dust burst (Box of Beasts, Sack of Spiders,
//                       Horn of Geryon, Phantom Mirror, Condenser, ...).
//
// Targets are found by diffing fxkit.monsters() (polled every 200 ms): a
// monster that appears near the player with no same-named monster within 2
// cells of an old position is "new". A message trigger (or a strongly
// summon-like name such as "ice beast") then picks the effect kind. Message
// wordings were checked against the local crawl source. Animate Dead only
// sets a duration; zombies raised from later kills are recognised by name for
// 60 s after "You call upon the dead to rise."
//
// Layer: #sdc_summonfx (fxkit.layer). Live elements are capped (MAX_EL).
// Reduced motion: a single short ring fade.
// Debug: window.sdc_summonfx_test("ice"|"lightning"|"demonic"|"generic"|
//        "necro"|"evoke")  plays an effect on the tile east of the player.
define(["./sdc_api", "./fxkit"], function (api, kit) {
    "use strict";

    var POLL = 200;          // ms between monster snapshots
    var NEW_KEEP = 1800;     // ms a "new monster" waits for its trigger
    var TRIG_KEEP = 1800;    // ms a trigger waits for its monster
    var NEAR = 4;            // max cells from player for a summon target
    var MAX_EL = 70;         // cap on live elements
    var live = 0;
    var prev = null;         // last snapshot
    var fresh = [];          // [{x, y, name, t}] new monsters not yet used
    var trig = [];           // [{kind, t}] triggers not yet used
    var timer = null;

    var COLORS = {
        ice: "120,230,255", lightning: "255,235,90", demonic: "255,70,60",
        generic: "176,128,255", necro: "190,255,205", evoke: "230,210,170"
    };
    var GLYPHS = {
        ice: "*+x*", lightning: "/+\\+", demonic: "^v<>",
        generic: "#*#*", necro: "o+o+", evoke: "o+o+"
    };

    // (message text) -> kind. First match wins. Wordings are from the crawl
    // source (spl-summoning.cc, spl-other.cc, evoke.cc, mon-death.cc); no
    // ^ anchors since fxkit may hand over a line with leading junk.
    var MSG = [
        // Summon Ice Beast; Simulacrum
        [/A chill wind blows around you|You sublimate a sliver of .* essence/, "ice"],
        // Forge Lightning Spire; Summon Ball Lightning
        [/An electric hum fills the air|You create some ball lightning/, "lightning"],
        // Call Imp; horrible things / gateway; Horn of Geryon
        [/A tiny devil pulls itself out of the air|terrible monstrosities upon the world|horrible noise fills the air|You produce a hideous howling noise/, "demonic"],
        // Haunt; zombie raised from a kill; shadow wisps
        [/(An insubstantial figure forms|Insubstantial figures form) in the air|rises to serve you!|Wisps of shadow whirl around you|soul wisp/, "necro"],
        // Sack of Spiders, Box of Beasts, Phantom Mirror
        [/You reach into the sack|You open the lid|\.\.\.and .* out!|You reflect .* with the mirror/, "evoke"],
        // Small Mammal/familiars, Forest, sphinxes, scarabs, dragons, ...
        [/appears in a puff of smoke|familiar and it appears|forested plane collides here|answers? (your|its|their) call|call forth a shade|plague of scarabs|(mana viper|prickly colossus|dragon|hydra) appears|arrives to answer your call|dragon horde roars back|gleaming metal champion|conjure a globe of magical energy/, "generic"]
    ];
    // Animate Dead only sets a duration; zombies are raised from later kills.
    var ANIMATE_ARM = /You call upon the dead to rise|dismiss your zombies/;
    var animate_until = 0;
    // Strongly summon-like monster names that need no message.
    var NAMES = [
        [/ice beast|block of ice/, "ice"],
        [/lightning spire|ball lightning/, "lightning"],
        [/spectral|simulacrum|phantom|shade/, "necro"],
        [/sin beast|redback/, "evoke"]
    ];

    function key(m) { return m.x + "," + m.y; }

    function snapshot()
    {
        try { return kit.monsters(); } catch (e) { return []; }
    }

    // Diff old and new snapshots; push newcomers near the player to `fresh`.
    function poll()
    {
        var cur = snapshot();
        var pl = kit.player_pos();
        var t = kit.now();
        if (prev && pl)
        {
            var seen = {};
            prev.forEach(function (m) { seen[key(m)] = m; });
            cur.forEach(function (m) {
                if (seen[key(m)] && seen[key(m)].name === m.name) return;
                // same-named monster nearby before: it just moved
                var moved = prev.some(function (o) {
                    return o.name === m.name && Math.abs(o.x - m.x) <= 2
                           && Math.abs(o.y - m.y) <= 2;
                });
                if (moved) return;
                if (Math.max(Math.abs(m.x - pl.x), Math.abs(m.y - pl.y)) > NEAR)
                    return;
                if (m.x === pl.x && m.y === pl.y) return;
                fresh.push({ x: m.x, y: m.y, name: m.name, t: t });
            });
        }
        prev = cur;
        fresh = fresh.filter(function (f) { return t - f.t < NEW_KEEP; });
        trig = trig.filter(function (g) { return t - g.t < TRIG_KEEP; });
        resolve();
    }

    // Pair fresh monsters with triggers or summon-like names, then play.
    function resolve()
    {
        var left = [], used = false;
        fresh.forEach(function (f) {
            var kind = null, i;
            for (i = 0; i < NAMES.length; i++)
                if (NAMES[i][0].test(f.name)) { kind = NAMES[i][1]; break; }
            if (!kind && animate_until > kit.now() && /zombie|skeleton/.test(f.name))
                kind = "necro";
            if (!kind && trig.length) { kind = trig[0].kind; used = true; }
            if (kind) play(kind, f.x, f.y);
            else left.push(f);
        });
        fresh = left;
        if (used) trig = [];
    }

    kit.on_message(function (text) {
        if (ANIMATE_ARM.test(text)) animate_until = kit.now() + 60000;
        for (var i = 0; i < MSG.length; i++)
            if (MSG[i][0].test(text))
            {
                trig.push({ kind: MSG[i][1], t: kit.now() });
                if (trig.length > 3) trig.shift();
                resolve();
                return;
            }
    });

    // Engine ------------------------------------------------------------------

    function take(n)
    {
        if (live + n > MAX_EL) return false;
        live += n;
        return true;
    }

    // Remove `el` (and its children) when `a` ends; frees `n` cap slots.
    function done(el, a, n)
    {
        a.onfinish = function () {
            if (el.parentNode) el.parentNode.removeChild(el);
            live -= (n || 1);
        };
    }

    // Absolutely placed box of size w x h centred on anchor `a`.
    function el_at(layer, a, w, h, cls, css)
    {
        var d = kit.mk(layer, "width:" + w + "px;height:" + h + "px;"
                       + "left:" + (a.x - w / 2) + "px;top:" + (a.y - h / 2)
                       + "px;" + (css || ""));
        if (cls) d.className = cls;
        return d;
    }

    // Flattened rune circle on the floor: counter-rotating rings + 4 glyphs.
    function rune_circle(layer, a, col, glyphs, dur)
    {
        var cost = 7;
        if (!take(cost)) return;
        var w = a.cw * 1.9, h = a.ch * 1.9;
        // wrapper flattens the circle into a floor ellipse
        var flat = el_at(layer, { x: a.x, y: a.y + a.ch * 0.3 }, w, h, "",
                         "transform:scaleY(.42);");
        var outer = kit.mk(flat, "width:100%;height:100%;");
        outer.className = "sdc-sm-ring";
        outer.style.borderColor = kit.rgba(col, .9);
        outer.style.boxShadow = "0 0 8px " + kit.rgba(col, .7);
        var inner = kit.mk(flat, "left:18%;top:18%;width:64%;height:64%;");
        inner.className = "sdc-sm-ring sdc-sm-ring-in";
        inner.style.borderColor = kit.rgba(col, .8);
        for (var i = 0; i < 4; i++)
        {
            var g = kit.mk(flat, "width:14px;height:14px;color:"
                                 + kit.rgba(col, 1) + ";");
            g.className = "sdc-sm-glyph";
            g.textContent = glyphs.charAt(i);
            var ang = i * Math.PI / 2;
            g.style.left = (w / 2 - 7 + Math.cos(ang) * w * 0.5) + "px";
            g.style.top = (h / 2 - 7 + Math.sin(ang) * h * 0.5) + "px";
        }
        var life = dur + 350;
        done(flat, kit.anim(flat, [
            { opacity: 0, transform: "scaleY(.42) scale(.4)" },
            { opacity: 1, transform: "scaleY(.42) scale(1)", offset: .3 },
            { opacity: 1, transform: "scaleY(.42) scale(1)", offset: .75 },
            { opacity: 0, transform: "scaleY(.42) scale(1.15)" }
        ], { duration: life, easing: "ease-out" }), cost);
        kit.anim(outer, [{ transform: "rotate(0deg)" },
                         { transform: "rotate(180deg)" }],
                 { duration: life, easing: "linear" });
        kit.anim(inner, [{ transform: "rotate(0deg)" },
                         { transform: "rotate(-270deg)" }],
                 { duration: life, easing: "linear" });
    }

    // Scanline curtain wipe revealing the creature (top to bottom).
    function build_in(layer, a, col, delay, dur)
    {
        if (!take(3)) return;
        var w = a.cw, h = a.ch;
        var cur = el_at(layer, a, w, h, "sdc-sm-curtain",
                        "color:" + kit.rgba(col, .9)
                        + ";transform-origin:50% 100%;opacity:0;");
        var edge = el_at(layer, { x: a.x, y: a.y - h / 2 }, w * 1.1, 2,
                         "sdc-sm-edge", "color:" + kit.rgba(col, 1)
                         + ";opacity:0;");
        var wash = el_at(layer, a, w, h, "", "background:" + kit.rgba(col, .35)
                         + ";mix-blend-mode:screen;opacity:0;");
        done(cur, kit.anim(cur, [{ opacity: .9, transform: "scaleY(1)" },
                                 { opacity: .6, transform: "scaleY(0)" }],
                           { duration: dur, delay: delay,
                             easing: "steps(6,end)" }));
        done(edge, kit.anim(edge, [{ opacity: 1, transform: "translateY(0)" },
                                   { opacity: 0,
                                     transform: "translateY(" + h + "px)" }],
                            { duration: dur, delay: delay,
                              easing: "linear" }));
        done(wash, kit.anim(wash, [{ opacity: 0, transform: "scale(1)" },
                                   { opacity: 1, transform: "scale(1.15)",
                                     offset: .5 },
                                   { opacity: 0, transform: "scale(1)" }],
                            { duration: dur + 200, delay: delay }));
    }

    // Soul wisps rising from around the tile into the new ally.
    function wisps(layer, a, col)
    {
        for (var i = 0; i < 10; i++)
        {
            if (!take(1)) return;
            var sx = kit.rnd(-1.6, 1.6) * a.cw, sy = kit.rnd(0.2, 1.2) * a.ch;
            var s = kit.rnd(5, 9);
            var d = el_at(layer, a, s, s, "sdc-sm-dot",
                          "opacity:0;background:" + kit.rgba(col, .95)
                          + ";box-shadow:0 0 8px 2px " + kit.rgba(col, .8)
                          + ";");
            var mx = sx * 0.4 + kit.rnd(-0.5, 0.5) * a.cw;
            done(d, kit.anim(d, [
                { opacity: 0, transform: kit.at(sx, sy) + "scale(.5)" },
                { opacity: 1, transform: kit.at(mx, -a.ch * 0.8) + "scale(1)",
                  offset: .5 },
                { opacity: 0, transform: kit.at(0, 0) + "scale(.3)" }
            ], { duration: kit.rnd(700, 1000), delay: i * 70,
                 easing: "ease-in-out" }));
        }
    }

    // Pop flash + dust puffs.
    function dust(layer, a, col)
    {
        if (take(1))
        {
            var f = el_at(layer, a, a.cw * 1.4, a.ch * 1.4, "sdc-sm-dot",
                          "opacity:0;background:" + kit.rgba(col, .6)
                          + ";mix-blend-mode:screen;");
            done(f, kit.anim(f, [{ opacity: .9, transform: "scale(.2)" },
                                 { opacity: 0, transform: "scale(1.3)" }],
                             { duration: 420 }));
        }
        var n = 8;
        for (var i = 0; i < n; i++)
        {
            if (!take(1)) return;
            var ang = i / n * Math.PI * 2 + kit.rnd(-.3, .3);
            var s = kit.rnd(8, 14);
            var d = el_at(layer, a, s, s, "sdc-sm-dot",
                          "opacity:0;background:" + kit.rgba(col, .55) + ";");
            var r = kit.rnd(.5, 1.1) * a.cw;
            done(d, kit.anim(d, [
                { opacity: .8, transform: kit.at(0, 0) + "scale(.4)" },
                { opacity: 0, transform: kit.at(Math.cos(ang) * r,
                                                Math.sin(ang) * r * .6)
                                          + "scale(1.8)" }
            ], { duration: kit.rnd(450, 700) }));
        }
    }

    function play(kind, mx, my)
    {
        try
        {
            var a = kit.anchor_of({ x: mx, y: my });
            if (!a) return;
            // children are laid out around `a`; the container follows the
            // tile when the view scrolls (the player moving right after)
            var layer = kit.mk(kit.layer("summonfx"),
                               "width:0;height:0;will-change:transform;");
            kit.pin(layer, { x: mx, y: my }, a, 2600);
            var col = COLORS[kind] || COLORS.generic;
            if (kit.reduced())
            {
                if (take(1))
                {
                    var r = el_at(layer, a, a.cw * 1.4, a.ch * 1.4,
                                  "sdc-sm-ring",
                                  "border-color:" + kit.rgba(col, .9) + ";");
                    done(r, kit.anim(r, [{ opacity: 1 }, { opacity: 0 }],
                                     { duration: 600 }));
                }
                return;
            }
            if (kind === "evoke")
            {
                dust(layer, a, col);
                build_in(layer, a, col, 0, 350);
            }
            else if (kind === "necro")
            {
                wisps(layer, a, col);
                build_in(layer, a, col, 400, 500);
            }
            else
            {
                rune_circle(layer, a, col, GLYPHS[kind] || GLYPHS.generic, 600);
                build_in(layer, a, col, 450, 450);
            }
        }
        catch (e) { /* fail soft */ }
    }

    // Poll only while a game is running.
    function start()
    {
        if (!timer) timer = setInterval(poll, POLL);
    }
    function stop()
    {
        if (timer) clearInterval(timer);
        timer = null;
        prev = null; fresh = []; trig = []; live = 0; animate_until = 0;
    }
    api.on("game_init", function () { stop(); start(); });
    api.on("game_cleanup", stop);
    start();

    window.sdc_summonfx_test = function (kind) {
        var pl = kit.player_pos();
        if (!pl) return "no player";
        play(kind || "generic", pl.x + 1, pl.y);
        return "ok";
    };

    return {};
});
