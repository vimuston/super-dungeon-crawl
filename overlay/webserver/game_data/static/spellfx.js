// Spell damage numbers: every spell element gets its own number style and
// motion, so a fireball, a frost bolt and a chaos surge never look like a
// sword hit. Used by combat.js (which finds the target tile, draws the
// number element and calls prepare() + play()).
//
// Spell hit lines come from beam.cc ("The bolt of fire hits the goblin for 9!",
// the " for N" is added by patches/spell-damage-numbers.patch). The beam name
// is the exact zap-data.h / spl-*.cc / mon-cast.cc name; family_of() maps it:
//
//   fire    flame tongues + embers, number flickers and rises
//   lava    molten slam: dark crust chunks, orange drips
//   cold    number snaps in, shivers, freezes, shatters; frost spokes
//           (ice spikes for shards / thorns / icicles / hail)
//   elec    jittering digits, forked lightning strike from above, sparks
//   poison  number sags and drips, green bubbles pop
//   acid    number melts from the bottom, sizzle pops, puddle
//   earth   slams in from above, rock chunks, dust ring, cracks
//   force   number zips in with afterimages, shock rings
//   necro   ghostly rise, drain motes pulled inwards, wisps
//   chaos   every digit twists differently + hue cycles, glitch slices,
//           spinning vortex
//   holy    rotating rays, halo ring, sparkles, calm rise
//   air     number spirals in a gust, wind arcs
//   steam   puffs, hot wobble
//   water   jelly splash, droplets, floor ripples
//   shadow  condensing darkness, melting tendrils
//   blood   heartbeat thumps, jagged cracks, droplets
//   anti    dispel: digits dissolve into pixels, collapsing dashed field
//
// Reduced motion: handled by the caller (plain fade, family colours stay).
define([], function () {
    "use strict";

    var MAXP = 90;       // concurrent particle elements
    var np = 0;

    // Name -> family ---------------------------------------------------------

    var SPELL_NAMES = ("acid spray|agony|arc of electricity|ball of acid|ball of mud|ball of steam|beam of energy|beckoning|beckoning whirlwind|billowing rust|blast|blast of calcifying dust|blast of choking fumes|blast of cleansing flame|blast of cold|blast of flame|blast of poison|blast of rock|blast of sand|blast of wind|blazing flames|blinding ray|blood arrow|bolt of acid|bolt of antimagic|bolt of cold|bolt of devastation|bolt of dispelling energy|bolt of electricity|bolt of energy|bolt of fire|bolt of flesh|bolt of light|bolt of lightning|bolt of magma|bolt of negative energy|bolt of poison|bomblet|buggy blast|burst of rock shards|concentrated momentum|concussive blast|condensed magic|creeping shadow|creeping shadows|crushing gravity|crystal spear|crystallising shot|curse of agony|damnation|destabilizing rupture|detonation|dizzying spores|doom bolt|drain life|explosive embers|falling rubble|fiery blast|fiery breath|fiery plasma|fireball|flame wave|flash freeze|flashing steel|fortress blast|foul vapour|foxfire|fragment of death|freeze|freezing gust|frigid blast|ghostly fireball|glacial breath|glimmering dart|glob of acid|glob of lava|glob of mercury|gout of destruction|grasping water|great blast of fire|hail|harpoon shot|ice thorns|iceblast|icy flash freeze|iron shot|jagged bones|kinetic grapnel|klown pie|lance of force|living lightning|magic dart|magical storm|malign ofering|malmutate|mass of rock|mystic blast|noxious fumes|nullifying energy|orb of electricity|phantom echo|piercing cold|poison arrow|poison gas|puff of flame|puff of frost|pyre arrow|ray of shadow|rebounding bolt of cold|rebounding bolt of fire|refrigeration|rocky spike|rupture|salvo of frigid ice|salvo of icicles|scorching wind|searing blast|searing ray|seething chaos|seismic shockwave|shadow bullet|shadowball|shadowy lightning|shard of frigid ice|shard of hardened shadow|shard of ice|shards of blighted ice|shockwave|shooting star|shred|slug dart|sonic wave|splash of acid|splash of poison|spray of metal splinters|spray of wooden splinters|sticky flame|sting|stinking cloud|stone arrow|stunning burst|surge of chaos|surge of energy|swarm of vampire bats|torrent of water|toxic sludge|umbral torchlight|unravelling|volatile concoction|volley of spikes|volley of thorns|wave of devouring shadow|whirling bolas|zap|"
        + "arc of chaos|plasma beam|thunderbolt|great icy blast|golden flame|blast of fire|barrage of energy|frost|flame surge|seracfall|blast of magma|blast of ice|cutting wind|blast of rubble|burning spray|vile air|wave of grief|howling sorrow|spectral mist").split("|");
    var SPELL_SET = {};
    SPELL_NAMES.forEach(function (n) { SPELL_SET[n] = true; });
    // anything shaped like "<bolt/blast/..> of X" is a beam too
    var BEAM_SHAPE = /^(?:rebounding |great |greater )?(?:bolt|blast|ray|beam|ball|orb|wave|breath|burst|spray|salvo|volley|surge|glob|puff|shards?|arc|flash|torrent|gout|splash|lance|storm|cloud|gust|fragment|curse|swarm) of /;
    // bare physical ammunition ("dart", "+2 javelin"): not a spell
    var BARE = /^(?:[+-]\d+ )?(?:large |sling )?(?:dart|arrow|bolt|javelin|stone|rock|bullet|slug|needle|tomahawk|boomerang|pebble|spear|dagger|net)s?$/;
    // branded ammunition ("flaming arrow", "poisoned dart")
    var BRAND = /^(?:[+-]\d+ )?(flaming|flame|frost|frozen|poisoned|venomous|curare-tipped|electric|sparking|chaos|disintegrating|exploding|explosive|silver|dispersal|penetrating|steel|blessed)\b/;
    var BRAND_FAM = { flaming: "fire", flame: "fire", frost: "cold", frozen: "cold",
                      poisoned: "poison", venomous: "poison",
                      "curare-tipped": "poison", electric: "elec",
                      sparking: "elec", chaos: "chaos", exploding: "fire",
                      explosive: "fire", blessed: "holy", silver: "holy",
                      disintegrating: "force", dispersal: "air",
                      penetrating: "force", steel: "earth" };

    // order matters: specific substances before generic shapes
    var RULES = [
        ["anti",   /antimagic|dispel|nullif|unravel|disrupt/],
        ["chaos",  /chaos|malmutate|buggy|klown|mutat|porkalator|\*\*\*\*/],
        ["blood",  /blood|haemo|agony|flesh|vampire bat|\bpain\b|shred|rupture|burning spray/],
        ["shadow", /shadow|umbral|phantom/],
        ["necro",  /negative|death|drain|malign|doom|ghostly|devour|bones?\b|grief|sorrow|spectral|vile|curse/],
        ["holy",   /cleansing|bolt of light$|golden|holy|blessed/],
        ["lava",   /lava|magma/],
        ["steam",  /steam/],
        ["cold",   /cold|frost|frigid|\bice\b|iceblast|icy|icicle|freez|flash freeze|glacial|hail|refrigerat|chill|seracfall|rime/],
        ["fire",   /fire|flame|fiery|blaz|burn|ember|plasma|sear|scorch|pyre|damnation|star\b|foxfire|sticky/],
        ["elec",   /lightning|electric|thunder|\bzap\b|arc of|stunning|spark|storm/],
        ["acid",   /acid|rust|corro/],
        ["poison", /poison|venom|sting|noxious|fume|stinking|toxic|sludge|vapour|spore|mercury|gas|choking|concoction|slug/],
        ["water",  /water|torrent|splash|rain|tide/],
        ["air",    /wind|gust|whirl|sonic|momentum|beckon|gale|air\b|breeze/],
        ["earth",  /rock|stone|sand|mud|rubble|earth|crystal|iron|splinter|spike|thorn|metal|shot|seismic|bolas|harpoon|steel|bomblet|grapnel|gravity|fortress|calcifying|dust|spear|arrow/],
        ["force",  /force|dart|magic|mystic|concussive|energy|kinetic|condensed|glimmer|surge|burst|blast|echo|shockwave|devastation|destruction|detonation|salvo|volley|ray|bolt|beam|orb|zap/]
    ];

    // returns family name or null (not a spell: leave it to the melee look)
    function family_of(name)
    {
        name = String(name || "").toLowerCase().replace(/^(?:the )/, "").trim();
        if (!name || BARE.test(name)) return null;
        var b = BRAND.exec(name);
        if (b && !SPELL_SET[name]) return BRAND_FAM[b[1]] || null;
        if (!SPELL_SET[name] && !BEAM_SHAPE.test(name)) return null;
        for (var i = 0; i < RULES.length; i++)
            if (RULES[i][1].test(name)) return RULES[i][0];
        return "force";
    }

    var SPIKY = /shard|spike|icicle|thorn|hail|spear|crystal|splinter/;
    var BOOM = /fireball|explo|detonat|blast|burst|great|gout|bomblet|seracfall|storm/;

    var WORDS = {
        fire:   ["FWOOSH", "SIZZLE", "WHUMP"],  lava:   ["GLORP", "SPLORCH"],
        cold:   ["KRRRK", "SHATTER", "BRRR"],    elec:   ["ZZZAP", "KRAKOW", "BZZT"],
        poison: ["BLORP", "SSSSS", "GLUG"],      acid:   ["SSSSIZ", "FSSSH"],
        earth:  ["KRUNCH", "THOOM", "CRACK"],    force:  ["WHUMP", "KA-POW", "BWOOM"],
        necro:  ["WHISPER", "HOOOO", "SIPHON"],  chaos:  ["GLITCH", "WARBLE", "~?!~"],
        holy:   ["SMITE", "RADIANCE", "SHINE"],  air:    ["WHOOSH", "FWEEE"],
        steam:  ["PSSSHH", "HISS"],              water:  ["SPLASH", "SPLOOSH"],
        shadow: ["UMBRA", "DARKEN"],             blood:  ["THUMP", "SQUELCH"],
        anti:   ["FZZT", "UNSPUN", "NULL"]
    };

    // Number element ----------------------------------------------------------

    var CHARS = { chaos: 1, elec: 1, anti: 1 };

    function prepare(el, fam, text)
    {
        el.className += " cb-sp cb-sp-" + fam;
        if (!CHARS[fam]) { el.textContent = text; return; }
        el.textContent = "";
        for (var i = 0; i < text.length; i++)
        {
            var s = document.createElement("span");
            s.className = "cb-ch";
            s.textContent = text.charAt(i);
            el.appendChild(s);
        }
    }

    // Particle helpers --------------------------------------------------------

    function rnd(a, b) { return a + Math.random() * (b - a); }
    function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
    function t2(x, y, extra)
    {
        return "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) "
               + (extra || "");
    }

    function make(H, a)
    {
        var P = {};
        // box centred on the tile centre + (dx, dy)
        P.box = function (w, h, dx, dy, extra) {
            return "left:" + (a.x + (dx || 0) - w / 2) + "px;top:"
                   + (a.y + (dy || 0) - h / 2) + "px;width:" + w
                   + "px;height:" + h + "px;" + (extra || "");
        };
        // one-shot particle; skipped above the cap
        P.p = function (css, frames, opts) {
            if (np >= MAXP) return null;
            np++;
            var el = H.mk(css);
            H.fx_anim(el, frames, opts, function () { np--; });
            return el;
        };
        // sampled keyframes: fn(t in 0..1) -> {x, y, s, sx, sy, r, o, f}
        P.path = function (n, fn) {
            var out = [];
            for (var i = 0; i <= n; i++)
            {
                var t = i / n, v = fn(t);
                var sc = v.s !== undefined ? v.s : 1;
                var f = { offset: t, opacity: v.o !== undefined ? v.o : 1,
                          transform: t2(v.x || 0, v.y || 0,
                                        "rotate(" + (v.r || 0) + "deg) "
                                        + (v.sk ? "skewX(" + v.sk + "deg) " : "")
                                        + "scale(" + (v.sx !== undefined ? v.sx : sc)
                                        + "," + (v.sy !== undefined ? v.sy : sc)
                                        + ")") };
                if (v.f) f.filter = v.f;
                out.push(f);
            }
            return out;
        };
        P.ring = function (col, w, h, dx, dy, dur, delay, bw) {
            P.p(P.box(w, h, dx, dy, "border:" + (bw || 3) + "px solid " + col
                      + ";border-radius:50%;box-sizing:border-box;"
                      + "box-shadow:0 0 8px " + col),
                [{ transform: "scale(0.2)", opacity: 0.95 },
                 { transform: "scale(1)", opacity: 0 }],
                { duration: dur, delay: delay || 0, easing: "ease-out" });
        };
        P.glow = function (col, scale, dur, blend) {
            P.p(P.box(a.cw * scale, a.cw * scale, 0, 0,
                      "border-radius:50%;background:radial-gradient(circle,"
                      + col + ",transparent 70%);mix-blend-mode:"
                      + (blend || "screen")),
                [{ transform: "scale(0.3)", opacity: 1 },
                 { transform: "scale(1.1)", opacity: 0 }],
                { duration: dur });
        };
        P.dot = function (col, sz, dx, dy, ex, ey, dur, delay, glow, ease) {
            P.p(P.box(sz, sz, dx, dy, "border-radius:50%;background:" + col
                      + (glow ? ";box-shadow:0 0 " + sz + "px " + glow : "")),
                [{ transform: t2(0, 0), opacity: 1 },
                 { transform: t2(ex, ey), opacity: 0 }],
                { duration: dur, delay: delay || 0, easing: ease || "ease-out" });
        };
        // ballistic droplets (gravity)
        P.drops = function (n, col, hl, spread, speed, glow) {
            for (var i = 0; i < n; i++)
            {
                var ang = -Math.PI / 2 + rnd(-spread, spread);
                var sp = a.cw * rnd(0.7, 1.5) * speed;
                var vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
                var gr = a.ch * rnd(3, 4.5), sz = Math.max(3, a.cw * rnd(0.07, 0.14));
                var fr = [], steps = 7;
                for (var s = 0; s <= steps; s++)
                {
                    var u = s / steps;
                    fr.push({ transform: t2(vx * u, vy * u + 0.5 * gr * u * u),
                              opacity: s === steps ? 0 : 1 });
                }
                P.p(P.box(sz, sz * 1.2, 0, 0, "border-radius:50% 50% 50% 50%/"
                          + "65% 65% 35% 35%;background:radial-gradient(circle at "
                          + "35% 30%," + hl + "," + col + " 60%);"
                          + (glow ? "box-shadow:0 0 5px " + glow : "")),
                    fr, { duration: rnd(420, 640), easing: "linear" });
            }
        };
        P.chunks = function (n, cols, glow, spread, grav) {
            for (var i = 0; i < n; i++)
            {
                var ang = -Math.PI / 2 + rnd(-spread, spread);
                var sp = a.cw * rnd(0.8, 1.7);
                var sz = Math.max(4, a.cw * rnd(0.1, 0.22));
                var poly = "polygon(" + [0, 1, 2, 3, 4].map(function (k) {
                    var th = k / 5 * 6.283 + rnd(-0.4, 0.4), r = rnd(0.35, 0.5);
                    return (50 + Math.cos(th) * r * 100).toFixed(0) + "% "
                           + (50 + Math.sin(th) * r * 100).toFixed(0) + "%";
                }).join(",") + ")";
                var vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
                var gr = a.ch * (grav || 4), spin = rnd(-420, 420), fr = [];
                for (var s = 0; s <= 8; s++)
                {
                    var u = s / 8;
                    fr.push({ transform: t2(vx * u, vy * u + 0.5 * gr * u * u,
                                            "rotate(" + spin * u + "deg)"),
                              opacity: s === 8 ? 0 : 1 });
                }
                P.p(P.box(sz, sz, 0, 0, "background:" + pick(cols)
                          + ";clip-path:" + poly
                          + (glow ? ";filter:drop-shadow(0 0 3px " + glow + ")" : "")),
                    fr, { duration: rnd(520, 780), easing: "linear" });
            }
        };
        P.star = function (col, sz, dx, dy, delay, dur) {
            P.p(P.box(sz, sz, dx, dy, "background:" + col + ";clip-path:polygon("
                      + "50% 0,60% 40%,100% 50%,60% 60%,50% 100%,40% 60%,0 50%,"
                      + "40% 40%);filter:drop-shadow(0 0 3px " + col + ")"),
                [{ transform: "scale(0) rotate(0deg)", opacity: 0 },
                 { transform: "scale(1) rotate(45deg)", opacity: 1, offset: 0.4 },
                 { transform: "scale(0) rotate(90deg)", opacity: 0 }],
                { duration: dur || 520, delay: delay || 0, easing: "linear" });
        };
        return P;
    }

    // Families ---------------------------------------------------------------
    // S: {a, el, fs, inc, sev, big, dir, spiky, boom, H, done}

    var FX = {};

    FX.fire = function (S, P) {
        var a = S.a, u = a.cw, dur = S.big ? 950 : 780;
        H_anim(S, P.path(16, function (t) {
            var pop = t < 0.14 ? 0.4 + t / 0.14 * (S.big ? 1.3 : 1.0)
                      : (S.big ? 1.7 : 1.4) - Math.min(1, (t - 0.14) / 0.4) * 0.3;
            return { x: Math.sin(t * 22) * u * 0.05, y: -a.ch * (0.05 + t * 0.85),
                     s: pop, o: t < 0.05 ? t * 20 : t > 0.72 ? (1 - t) / 0.28 : 1,
                     f: "brightness(" + (1.1 + 0.5 * Math.sin(t * 45)).toFixed(2)
                        + ")" };
        }), dur);
        P.glow("rgba(255,150,40,0.9)", 2.2, 360);
        var n = S.big ? 11 : 7;
        for (var i = 0; i < n; i++)
        {
            var w = u * rnd(0.14, 0.26), h = w * rnd(1.8, 2.8), sw = rnd(-6, 6);
            P.p(P.box(w, h, rnd(-0.45, 0.45) * u, a.ch * rnd(0.05, 0.3),
                      "transform-origin:50% 100%;border-radius:50% 50% 50% 50%/"
                      + "70% 70% 30% 30%;background:radial-gradient(ellipse at 50% 80%,"
                      + "#fff6b0,#ffb020 40%,#ff4a10 70%,transparent 100%);"
                      + "mix-blend-mode:screen"),
                [{ transform: t2(0, 0, "scale(0.3)"), opacity: 0 },
                 { transform: t2(sw, -h * 1.1, "scale(1,1.1)"), opacity: 1,
                   offset: 0.35 },
                 { transform: t2(-sw, -h * 2.6, "scale(0.25)"), opacity: 0 }],
                { duration: rnd(420, 700), delay: rnd(0, 160) });
        }
        for (i = 0; i < 9; i++)
            P.dot(pick(["#ffd060", "#ff9020", "#fff0a0"]), Math.max(2.5, u * 0.05),
                  rnd(-0.4, 0.4) * u, 0, rnd(-0.5, 0.5) * u,
                  -a.ch * rnd(0.8, 1.7), rnd(500, 900), rnd(0, 200), "#ff7a10",
                  "ease-out");
        if (S.boom) { P.ring("#ffb030", u * 2.4, u * 2.4, 0, 0, 480, 0, 4);
                      P.ring("#ff5a10", u * 1.6, u * 1.6, 0, 0, 380, 60, 3); }
    };

    FX.lava = function (S, P) {
        slam(S, P, ["#2b1208", "#4a1a08", "#ff5a14", "#ffa030"], "#ff4a00");
        for (var i = 0; i < 4; i++)
            P.p(P.box(S.a.cw * 0.09, S.a.cw * 0.2, rnd(-0.35, 0.35) * S.a.cw,
                      S.a.ch * 0.15, "border-radius:50% 50% 50% 50%/65% 65% 35% 35%;"
                      + "background:#ff7a1e;box-shadow:0 0 6px #ff4a00"),
                [{ transform: t2(0, 0), opacity: 1 },
                 { transform: t2(0, S.a.ch * 0.9, "scaleY(1.6)"), opacity: 0 }],
                { duration: rnd(600, 900), delay: rnd(150, 350),
                  easing: "ease-in" });
    };

    FX.cold = function (S, P) {
        var a = S.a, u = a.cw, dur = 1000, shiv = [];
        H_anim(S, P.path(20, function (t) {
            if (t < 0.1) return { s: 2 - t * 7, o: t * 10 };
            var x = 0, y = 0;
            if (t < 0.5) { x = (Math.round(t * 40) % 2 ? 1 : -1) * u * 0.045;
                           y = (Math.round(t * 27) % 2 ? 1 : -1) * u * 0.02; }
            var rise = t < 0.5 ? 0 : -a.ch * 0.08 * Math.min(1, (t - 0.5) * 3);
            return { x: x, y: y + rise, s: t < 0.5 ? 1.3 : 1.2,
                     o: t > 0.78 ? Math.max(0, 1 - (t - 0.78) / 0.04) : 1,
                     f: t < 0.5 ? "none" : "brightness(1.35) saturate(0.7)" };
        }), dur);
        window.setTimeout(function () {
            for (var i = 0; i < 12; i++)
            {
                var sz = Math.max(4, u * rnd(0.1, 0.2));
                var ex = rnd(-0.7, 0.7) * u, ey = a.ch * rnd(0.5, 1.2);
                P.p(P.box(sz, sz * 1.3, rnd(-0.4, 0.4) * u, rnd(-0.2, 0.2) * a.ch,
                          "background:" + pick(["#e8fbff", "#9fe6ff", "#5cc8ff"])
                          + ";clip-path:polygon(50% 0,100% 100%,0 100%);"
                          + "filter:drop-shadow(0 0 3px #8fe)"),
                    [{ transform: t2(0, 0, "rotate(0deg)"), opacity: 1 },
                     { transform: t2(ex, ey, "rotate(" + rnd(-400, 400) + "deg)"),
                       opacity: 0 }], { duration: rnd(420, 640),
                                        easing: "ease-in" });
            }
            P.glow("rgba(190,240,255,0.9)", 1.8, 260);
        }, dur * 0.78);
        // frost spokes with diamond tips
        for (var k = 0; k < 6; k++)
        {
            var ang = k * 60 + rnd(-8, 8), L = u * rnd(0.5, 0.8);
            P.p(P.box(L, 2, 0, 0, "transform-origin:0 50%;left:" + a.x + "px;"
                      + "background:linear-gradient(90deg,#fff,#7fdcff,transparent)"
                      + ";box-shadow:0 0 5px #7fdcff"),
                [{ transform: "rotate(" + ang + "deg) scaleX(0)", opacity: 1 },
                 { transform: "rotate(" + ang + "deg) scaleX(1)", opacity: 1,
                   offset: 0.3 },
                 { transform: "rotate(" + ang + "deg) scaleX(1)", opacity: 0 }],
                { duration: 700 });
        }
        if (S.spiky)
            for (k = 0; k < 6; k++)
            {
                var h = a.ch * rnd(0.5, 0.95), w = u * rnd(0.12, 0.2);
                P.p(P.box(w, h, (k - 2.5) * u * 0.2, a.ch * 0.45 - h / 2,
                          "transform-origin:50% 100%;background:linear-gradient("
                          + "#fff,#8fe3ff 55%,#2a8fd0);clip-path:polygon(50% 0,"
                          + "100% 100%,0 100%)"),
                    [{ transform: "scaleY(0)", opacity: 1 },
                     { transform: "scaleY(1)", opacity: 1, offset: 0.2 },
                     { transform: "scaleY(1)", opacity: 1, offset: 0.7 },
                     { transform: "scaleY(1)", opacity: 0 }],
                    { duration: 760, delay: k * 25 });
            }
        for (k = 0; k < 7; k++)
            P.star("#e8fbff", Math.max(5, u * 0.12), rnd(-0.6, 0.6) * u,
                   rnd(-0.6, 0.4) * a.ch, rnd(0, 400), 520);
    };

    FX.elec = function (S, P) {
        var a = S.a, u = a.cw, dur = 620;
        H_anim(S, P.path(16, function (t) {
            return { x: t < 0.7 ? rnd(-0.07, 0.07) * u : 0,
                     y: t < 0.7 ? rnd(-0.05, 0.05) * u - a.ch * t * 0.15 : -a.ch * 0.1,
                     sk: t < 0.7 ? rnd(-14, 14) : 0, s: 1.35 - t * 0.25,
                     o: t < 0.75 ? (Math.random() < 0.18 ? 0.35 : 1)
                        : (1 - t) / 0.25,
                     f: Math.random() < 0.3 ? "brightness(2.2)" : "none" };
        }), dur);
        Array.prototype.forEach.call(S.el.children, function (ch, i) {
            if (ch.animate)
                ch.animate(P.path(14, function (t) {
                    return { y: rnd(-1, 1) * u * 0.07 * (1 - t),
                             r: rnd(-10, 10) * (1 - t), o: Math.random() < 0.12 ? 0.4 : 1 };
                }), { duration: dur, fill: "both", easing: "linear", delay: i * 12 });
        });
        var bw = u * 1.3, bh = a.ch * 2.4;
        for (var b = 0; b < 2; b++)
        {
            var pts = [], x = bw / 2 + rnd(-0.1, 0.1) * bw, segs = 7, i;
            for (i = 0; i <= segs; i++)
            {
                pts.push((i === segs ? bw / 2 : x).toFixed(1) + ","
                         + (bh * i / segs).toFixed(1));
                x = bw / 2 + rnd(-0.32, 0.32) * bw;
            }
            var fork = [], fx = pts[3].split(",");
            fork.push(fx[0] + "," + fx[1]);
            fork.push((+fx[0] + rnd(-1, 1) * bw * 0.4).toFixed(1) + ","
                      + (+fx[1] + bh * 0.2).toFixed(1));
            fork.push((+fx[0] + rnd(-1, 1) * bw * 0.5).toFixed(1) + ","
                      + (+fx[1] + bh * 0.38).toFixed(1));
            var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + bw
                + '" height="' + bh + '" style="overflow:visible;filter:'
                + 'drop-shadow(0 0 5px #6ab4ff)">'
                + '<polyline points="' + pts.join(" ") + '" fill="none" stroke="#5aa0ff" '
                + 'stroke-width="7" stroke-opacity="0.5" stroke-linejoin="round"/>'
                + '<polyline points="' + pts.join(" ") + '" fill="none" stroke="#fff" '
                + 'stroke-width="2.5" stroke-linejoin="round"/>'
                + '<polyline points="' + fork.join(" ") + '" fill="none" stroke="#cfe6ff" '
                + 'stroke-width="2" stroke-linejoin="round"/></svg>';
            var holder = P.p("left:" + (a.x - bw / 2) + "px;top:" + (a.y - bh + a.ch * 0.1)
                             + "px;width:" + bw + "px;height:" + bh + "px",
                [{ opacity: 1 }, { opacity: 0.15 }, { opacity: 1 }, { opacity: 0.05 },
                 { opacity: 0.8 }, { opacity: 0 }],
                { duration: 300, delay: b * 120, easing: "steps(1)" });
            if (holder) holder.innerHTML = svg;
        }
        P.glow("rgba(180,215,255,0.95)", 2.4, 240);
        for (i = 0; i < 9; i++)
        {
            var an = rnd(0, 360), L = u * rnd(0.2, 0.45);
            P.p(P.box(L, 2, 0, 0, "left:" + a.x + "px;transform-origin:0 50%;"
                      + "background:linear-gradient(90deg,#fff,#ffe870,transparent)"),
                [{ transform: "rotate(" + an + "deg) translateX(" + u * 0.15
                              + "px)", opacity: 1 },
                 { transform: "rotate(" + an + "deg) translateX(" + u * 0.7
                              + "px)", opacity: 0 }],
                { duration: rnd(160, 300), delay: rnd(0, 250) });
        }
    };

    FX.poison = function (S, P) {
        var a = S.a, u = a.cw, dur = 1000;
        H_anim(S, P.path(16, function (t) {
            var pop = t < 0.12 ? 0.5 + t / 0.12 * 0.9 : 1.4 - Math.min(1, t * 1.1) * 0.3;
            var sag = Math.max(0, t - 0.35) / 0.65;
            return { x: Math.sin(t * 9) * u * 0.06, y: a.ch * 0.5 * sag * sag - a.ch * 0.1,
                     sx: pop * (1 - sag * 0.15), sy: pop * (1 + sag * 0.7),
                     o: t > 0.7 ? (1 - t) / 0.3 : 1 };
        }), dur);
        P.p(P.box(u * 1.5, u * 1.1, 0, a.ch * 0.1, "border-radius:50%;"
                  + "background:radial-gradient(circle,rgba(90,200,50,0.6),"
                  + "transparent 70%)"),
            [{ transform: "scale(0.3)", opacity: 0.9 },
             { transform: "scale(1.2)", opacity: 0 }], { duration: 700 });
        for (var i = 0; i < 5; i++)
            P.p(P.box(u * 0.08, u * 0.16, rnd(-0.4, 0.4) * u, a.ch * 0.15,
                      "border-radius:50% 50% 50% 50%/65% 65% 35% 35%;"
                      + "background:#59c02d;box-shadow:0 0 5px #8dea4a"),
                [{ transform: t2(0, 0, "scaleY(0.4)"), opacity: 1 },
                 { transform: t2(rnd(-3, 3), a.ch * rnd(0.7, 1.1), "scaleY(1.5)"),
                   opacity: 0 }],
                { duration: rnd(600, 900), delay: rnd(150, 450),
                  easing: "ease-in" });
        for (i = 0; i < 7; i++)
        {
            var d = Math.max(5, u * rnd(0.08, 0.17)), bx = rnd(-0.5, 0.5) * u;
            P.p(P.box(d, d, bx, a.ch * 0.3, "border-radius:50%;box-sizing:border-box;"
                      + "border:1.5px solid #9bf070;background:rgba(90,200,60,0.25)"),
                [{ transform: t2(0, 0, "scale(0.5)"), opacity: 0.9 },
                 { transform: t2(rnd(-5, 5), -a.ch * rnd(0.5, 0.9), "scale(1)"),
                   opacity: 0.9, offset: 0.8 },
                 { transform: t2(rnd(-5, 5), -a.ch * 1.0, "scale(1.7)"), opacity: 0 }],
                { duration: rnd(600, 950), delay: rnd(0, 350), easing: "linear" });
        }
    };

    FX.acid = function (S, P) {
        var a = S.a, u = a.cw, dur = 900;
        H_anim(S, P.path(16, function (t) {
            var pop = t < 0.14 ? 0.5 + t / 0.14 * 0.9 : 1.4 - Math.min(1, t * 0.7) * 0.2;
            var melt = Math.max(0, t - 0.3) / 0.7;
            return { y: a.ch * 0.55 * melt * melt, sx: pop * (1 + melt * 0.25),
                     sy: pop * (1 - melt * 0.8), o: t > 0.75 ? (1 - t) / 0.25 : 1,
                     f: "blur(" + (melt * 2.2).toFixed(1) + "px) brightness("
                        + (1 + melt * 0.5).toFixed(2) + ")" };
        }), dur);
        P.p(P.box(u * 1.6, u * 0.5, 0, a.ch * 0.38, "border-radius:50%;"
                  + "background:radial-gradient(ellipse,rgba(200,255,40,0.85),"
                  + "rgba(110,160,10,0.4) 60%,transparent 75%)"),
            [{ transform: "scale(0.2)", opacity: 0 },
             { transform: "scale(1)", opacity: 0.9, offset: 0.4 },
             { transform: "scale(1.15)", opacity: 0 }], { duration: 900 });
        for (var i = 0; i < 6; i++)
        {
            var w = Math.max(3, u * 0.06);
            P.p(P.box(w, w * 3, rnd(-0.45, 0.45) * u, a.ch * 0.1,
                      "border-radius:40%;background:linear-gradient(#e8ff60,#9cd000);"
                      + "box-shadow:0 0 4px #c8ff00"),
                [{ transform: t2(0, 0, "scaleY(0.3)"), opacity: 1 },
                 { transform: t2(0, a.ch * rnd(0.6, 1.2), "scaleY(1.2)"), opacity: 0 }],
                { duration: rnd(500, 850), delay: rnd(100, 400), easing: "ease-in" });
        }
        for (i = 0; i < 9; i++)
        {
            var d = Math.max(3, u * rnd(0.04, 0.1));
            P.p(P.box(d, d, rnd(-0.55, 0.55) * u, rnd(-0.35, 0.3) * a.ch,
                      "border-radius:50%;background:radial-gradient(#fff,#d8ff3a 60%,"
                      + "transparent)"),
                [{ transform: "scale(0)", opacity: 1 },
                 { transform: "scale(1.5)", opacity: 1, offset: 0.4 },
                 { transform: "scale(0)", opacity: 0 }],
                { duration: rnd(200, 360), delay: rnd(0, 520) });
        }
    };

    // shared by earth + lava: heavy slam from above with debris and cracks
    function slam(S, P, cols, glow)
    {
        var a = S.a, u = a.cw, dur = 880;
        H_anim(S, [
            { transform: t2(0, -a.ch * 1.3, "scale(2)"), opacity: 0, offset: 0 },
            { transform: t2(0, -a.ch * 0.3, "scale(1.5)"), opacity: 1, offset: 0.13,
              easing: "ease-in" },
            { transform: t2(0, 0, "scale(1.7,0.65)"), opacity: 1, offset: 0.18 },
            { transform: t2(0, -a.ch * 0.06, "scale(1.25,1.2)"), opacity: 1,
              offset: 0.28 },
            { transform: t2(u * 0.02, 0, "scale(1.2)"), opacity: 1, offset: 0.7 },
            { transform: t2(0, a.ch * 0.6, "scale(1.1)"), opacity: 0 }], dur);
        window.setTimeout(function () {
            P.chunks(S.big ? 11 : 8, cols, glow, 1.25, 4.2);
            for (var i = 0; i < 3; i++)
                P.p(P.box(u * 0.9, u * 0.5, rnd(-0.3, 0.3) * u, a.ch * 0.3,
                          "border-radius:50%;background:radial-gradient("
                          + "rgba(190,170,140,0.55),transparent 70%)"),
                    [{ transform: t2(0, 0, "scale(0.3)"), opacity: 0.8 },
                     { transform: t2(rnd(-1, 1) * u * 0.5, -a.ch * 0.2, "scale(1.8)"),
                       opacity: 0 }], { duration: 560, delay: i * 40 });
            P.ring(glow || "#b8a080", u * 2.2, u * 0.8, 0, a.ch * 0.35, 420, 0, 3);
            for (i = 0; i < 5; i++)
            {
                var ang = 20 + i * 35 + rnd(-8, 8), L = u * rnd(0.4, 0.8);
                P.p(P.box(L, 2, 0, 0, "left:" + a.x + "px;top:" + (a.y + a.ch * 0.3)
                          + "px;transform-origin:0 50%;background:" + (glow || "#2a1c10")
                          + ";box-shadow:0 0 4px " + (glow || "#000")),
                    [{ transform: "rotate(" + ang + "deg) scaleX(0)", opacity: 1 },
                     { transform: "rotate(" + ang + "deg) scaleX(1)", opacity: 1,
                       offset: 0.2 },
                     { transform: "rotate(" + ang + "deg) scaleX(1)", opacity: 0 }],
                    { duration: 700 });
            }
        }, dur * 0.17);
    }

    FX.earth = function (S, P) {
        slam(S, P, ["#8a7a66", "#5a4a38", "#b8a488", "#3a2e22"], null);
    };

    FX.force = function (S, P) {
        var a = S.a, u = a.cw, dur = 760, d = S.dir || 1;
        H_anim(S, [
            { transform: t2(-d * u * 1.7, 0, "skewX(" + (-d * 30) + "deg) scale(2.4,0.8)"),
              opacity: 0, offset: 0 },
            { transform: t2(d * u * 0.08, 0, "scale(1.6)"), opacity: 1, offset: 0.14 },
            { transform: t2(-d * u * 0.03, -a.ch * 0.05, "scale(1.3)"), opacity: 1,
              offset: 0.26 },
            { transform: t2(0, -a.ch * 0.2, "scale(1.15)"), opacity: 1, offset: 0.7 },
            { transform: t2(0, -a.ch * 0.6, "scale(1)"), opacity: 0 }], dur);
        for (var i = 1; i <= 3; i++)
        {
            var g = H_clone(S);
            if (g)
                H_run(g, [{ transform: t2(-d * u * (1.7 + i * 0.3), 0,
                                          "skewX(" + (-d * 30) + "deg) scale(2.4,0.8)"),
                            opacity: 0 },
                          { transform: t2(-d * u * i * 0.18, 0, "scale(1.5)"),
                            opacity: 0.4 / i, offset: 0.2 },
                          { transform: t2(-d * u * i * 0.1, -a.ch * 0.1, "scale(1.2)"),
                            opacity: 0 }], { duration: 480, delay: i * 35 });
        }
        P.ring("#ff7cf0", u * 2.2, u * 2.2, 0, 0, 480, 0, 4);
        P.ring("#b04cff", u * 1.5, u * 1.5, 0, 0, 420, 90, 3);
        P.glow("rgba(255,120,255,0.9)", 2, 280);
        for (i = 0; i < 8; i++)
        {
            var an = i * 45 + rnd(-10, 10);
            P.p(P.box(u * 0.45, 3, 0, 0, "left:" + a.x + "px;transform-origin:0 50%;"
                      + "background:linear-gradient(90deg,#fff,#ff7cf0,transparent)"),
                [{ transform: "rotate(" + an + "deg) translateX(" + u * 0.2
                              + "px) scaleX(0.3)", opacity: 1 },
                 { transform: "rotate(" + an + "deg) translateX(" + u * 0.8
                              + "px) scaleX(1)", opacity: 0 }], { duration: 320 });
        }
    };

    FX.necro = function (S, P) {
        var a = S.a, u = a.cw, dur = 1100;
        H_anim(S, P.path(20, function (t) {
            return { x: Math.sin(t * 10) * u * 0.14, y: -a.ch * t * 0.95,
                     s: t < 0.2 ? 0.6 + t * 3 : 1.2 - (t - 0.2) * 0.45,
                     o: t < 0.2 ? t * 4.5 : t > 0.6 ? (1 - t) / 0.4 : 0.95,
                     f: "blur(" + (Math.max(0, t - 0.55) * 7).toFixed(1) + "px)" };
        }), dur);
        for (var i = 0; i < 12; i++)
        {
            var an = rnd(0, 6.283), r = u * rnd(0.9, 1.5);
            P.dot(pick(["#b070ff", "#6a2cc0", "#d8b8ff"]), Math.max(3, u * 0.07),
                  Math.cos(an) * r, Math.sin(an) * r * 0.8, -Math.cos(an) * r,
                  -Math.sin(an) * r * 0.8, rnd(380, 600), rnd(0, 380), "#8a3cff",
                  "ease-in");
        }
        P.p(P.box(u * 1.8, u * 1.8, 0, 0, "border-radius:50%;background:"
                  + "radial-gradient(circle,rgba(24,0,40,0.75),transparent 70%)"),
            [{ transform: "scale(1.4)", opacity: 0 },
             { transform: "scale(0.7)", opacity: 1, offset: 0.4 },
             { transform: "scale(1.3)", opacity: 0 }], { duration: 800 });
        for (i = 0; i < 4; i++)
        {
            var g = H_clone(S);
            if (g)
                H_run(g, [{ transform: t2(0, 0, "scale(1.2)"), opacity: 0.35 },
                          { transform: t2(rnd(-1, 1) * u * 0.7, -a.ch * rnd(0.8, 1.5),
                                          "scale(0.7)"), opacity: 0 }],
                      { duration: 900, delay: 100 + i * 90 });
        }
    };

    FX.chaos = function (S, P) {
        var a = S.a, u = a.cw, dur = 900, n = S.el.children.length;
        H_anim(S, P.path(14, function (t) {
            return { x: Math.sin(t * 30) * u * 0.05, y: -a.ch * t * 0.5,
                     r: Math.sin(t * 9) * 25 * (1 - t), s: t < 0.12 ? 0.3 + t * 11 : 1.6 - t * 0.5,
                     o: t > 0.78 ? (1 - t) / 0.22 : 1 };
        }), dur);
        Array.prototype.forEach.call(S.el.children, function (ch, i) {
            var h0 = rnd(0, 360), sw = rnd(180, 420) * (Math.random() < 0.5 ? -1 : 1);
            if (ch.animate)
                ch.animate(P.path(12, function (t) {
                    var k = t < 0.8 ? 1 : (1 - t) / 0.2;
                    return { x: rnd(-1, 1) * u * 0.1 * k, y: rnd(-1, 1) * u * 0.14 * k,
                             r: rnd(-120, 120) * k + sw * t * (1 - t),
                             sx: 1 + rnd(-0.6, 0.9) * k, sy: 1 + rnd(-0.6, 0.9) * k,
                             sk: rnd(-40, 40) * k,
                             f: "hue-rotate(" + Math.round(h0 + t * 720) + "deg)" };
                }), { duration: dur, fill: "both", easing: "linear",
                      delay: i * 30 });
        });
        P.p(P.box(u * 2.2, u * 2.2, 0, 0, "border-radius:50%;background:"
                  + "conic-gradient(#f33,#fd3,#3f6,#3df,#63f,#f3d,#f33);"
                  + "-webkit-mask-image:radial-gradient(circle,transparent 42%,"
                  + "#000 44%,#000 70%,transparent 72%);mask-image:radial-gradient("
                  + "circle,transparent 42%,#000 44%,#000 70%,transparent 72%);"
                  + "mix-blend-mode:screen"),
            [{ transform: "rotate(0deg) scale(0.3)", opacity: 0.9 },
             { transform: "rotate(540deg) scale(1.3)", opacity: 0 }],
            { duration: 800, easing: "ease-out" });
        for (var i = 0; i < 5; i++)
            P.p(P.box(u * rnd(0.3, 1.0), rnd(2, 5), rnd(-0.3, 0.3) * u,
                      rnd(-0.4, 0.4) * a.ch, "background:hsl(" + Math.round(rnd(0, 360))
                      + ",100%,60%);mix-blend-mode:screen"),
                [{ opacity: 0, transform: t2(-u * 0.3, 0) },
                 { opacity: 1, transform: t2(u * 0.2, 0), offset: 0.3 },
                 { opacity: 0, transform: t2(u * 0.4, 0) }],
                { duration: rnd(140, 300), delay: rnd(0, 500), easing: "steps(3)" });
        for (i = 0; i < 9; i++)
        {
            var an = rnd(0, 6.283), r = u * rnd(0.7, 1.5), sz = Math.max(4, u * rnd(0.08, 0.18));
            P.p(P.box(sz, sz, 0, 0, "background:hsl(" + Math.round(rnd(0, 360))
                      + ",100%,60%);clip-path:polygon(" + pick(["50% 0,100% 100%,0 100%",
                      "50% 0,100% 50%,50% 100%,0 50%", "0 0,100% 20%,70% 100%"]) + ")"),
                [{ transform: t2(0, 0, "rotate(0deg)"), opacity: 1 },
                 { transform: t2(Math.cos(an) * r, Math.sin(an) * r,
                                 "rotate(" + rnd(-720, 720) + "deg) scale(0.2)"),
                   opacity: 0 }], { duration: rnd(500, 850) });
        }
    };

    FX.holy = function (S, P) {
        var a = S.a, u = a.cw, dur = 1000;
        H_anim(S, P.path(14, function (t) {
            return { y: -a.ch * (0.05 + t * 0.7),
                     s: t < 0.15 ? 0.6 + t * 6 : 1.5 - t * 0.35,
                     o: t < 0.08 ? t * 12 : t > 0.7 ? (1 - t) / 0.3 : 1,
                     f: "brightness(" + (1.15 + 0.25 * Math.sin(t * 14)).toFixed(2) + ")" };
        }), dur);
        P.p(P.box(u * 3, u * 3, 0, 0, "border-radius:50%;background:"
                  + "repeating-conic-gradient(rgba(255,240,170,0.85) 0 8deg,"
                  + "transparent 8deg 24deg);-webkit-mask-image:radial-gradient("
                  + "circle,#000,transparent 68%);mask-image:radial-gradient("
                  + "circle,#000,transparent 68%);mix-blend-mode:screen"),
            [{ transform: "rotate(0deg) scale(0.4)", opacity: 0 },
             { transform: "rotate(18deg) scale(0.9)", opacity: 0.95, offset: 0.3 },
             { transform: "rotate(40deg) scale(1.25)", opacity: 0 }], { duration: 900 });
        P.glow("rgba(255,244,190,0.95)", 2.4, 500);
        P.p(P.box(u * 1.1, u * 0.35, 0, -a.ch * 0.5, "border-radius:50%;"
                  + "box-sizing:border-box;border:3px solid #ffe680;"
                  + "box-shadow:0 0 10px #ffd84a"),
            [{ transform: t2(0, -a.ch * 0.3, "scale(1.4)"), opacity: 0 },
             { transform: t2(0, 0, "scale(1)"), opacity: 1, offset: 0.35 },
             { transform: t2(0, -a.ch * 0.4, "scale(0.9)"), opacity: 0 }],
            { duration: 900 });
        for (var i = 0; i < 8; i++)
            P.star(pick(["#fffbe0", "#ffe680", "#fff"]), Math.max(6, u * rnd(0.12, 0.22)),
                   rnd(-0.7, 0.7) * u, rnd(-0.9, 0.4) * a.ch, rnd(0, 500), 560);
    };

    FX.air = function (S, P) {
        var a = S.a, u = a.cw, dur = 900;
        H_anim(S, P.path(18, function (t) {
            var th = t * 6.283 * 1.4, r = u * 0.5 * (1 - t * 0.55);
            return { x: Math.cos(th + 3.14) * r, y: Math.sin(th + 3.14) * r * 0.5 - a.ch * t * 0.5,
                     r: th * 22, s: 0.6 + Math.sin(Math.min(1, t * 1.6) * 3.14) * 0.8,
                     o: t < 0.1 ? t * 10 : t > 0.75 ? (1 - t) / 0.25 : 1 };
        }), dur);
        var d = S.dir || 1;
        for (var i = 0; i < 6; i++)
        {
            var w = u * rnd(0.9, 1.6), h = a.ch * rnd(0.2, 0.4);
            P.p(P.box(w, h, 0, (i - 2.5) * a.ch * 0.22, "box-sizing:border-box;"
                      + "border-top:2px solid rgba(235,252,255,0.9);border-radius:50%;"
                      + "clip-path:inset(0 0 55% 0)"),
                [{ transform: t2(-d * u * 1.3, 0, "rotate(" + (-d * 8) + "deg)"),
                   opacity: 0 },
                 { transform: t2(0, 0, "rotate(" + (d * 2) + "deg)"), opacity: 0.9,
                   offset: 0.45 },
                 { transform: t2(d * u * 1.3, 0, "rotate(" + (d * 8) + "deg)"),
                   opacity: 0 }], { duration: rnd(420, 620), delay: i * 45,
                                    easing: "linear" });
        }
        for (i = 0; i < 8; i++)
        {
            var an = rnd(0, 6.283), sp = rnd(0, 1) > 0.5 ? 1 : -1, d2 = Math.max(2.5, u * 0.05);
            var fr = [];
            for (var s = 0; s <= 10; s++)
            {
                var t = s / 10, th = an + sp * t * 5, r = u * (0.3 + t * 0.7);
                fr.push({ transform: t2(Math.cos(th) * r, Math.sin(th) * r * 0.6),
                          opacity: s === 10 ? 0 : 0.85 });
            }
            P.p(P.box(d2, d2, 0, 0, "border-radius:50%;background:#e8fbff"),
                fr, { duration: rnd(520, 800), easing: "linear" });
        }
    };

    FX.steam = function (S, P) {
        var a = S.a, u = a.cw, dur = 900;
        H_anim(S, P.path(16, function (t) {
            return { x: Math.sin(t * 24) * u * 0.04 * (1 - t), y: -a.ch * t * 0.6,
                     s: t < 0.12 ? 0.5 + t * 9 : 1.55 - t * 0.35,
                     o: t > 0.7 ? (1 - t) / 0.3 : 1,
                     f: "blur(" + (Math.max(0, t - 0.5) * 4).toFixed(1) + "px)" };
        }), dur);
        for (var i = 0; i < 6; i++)
        {
            var w = u * rnd(0.5, 0.9);
            P.p(P.box(w, w, rnd(-0.4, 0.4) * u, a.ch * rnd(0, 0.3),
                      "border-radius:50%;background:radial-gradient(circle,"
                      + "rgba(255,255,255,0.8),rgba(255,255,255,0.25) 55%,transparent 72%)"),
                [{ transform: t2(0, 0, "scale(0.3)"), opacity: 0 },
                 { transform: t2(rnd(-5, 5), -a.ch * 0.4, "scale(1)"), opacity: 0.85,
                   offset: 0.3 },
                 { transform: t2(rnd(-12, 12), -a.ch * 1.3, "scale(1.8)"), opacity: 0 }],
                { duration: rnd(600, 950), delay: i * 60 });
        }
        P.glow("rgba(255,170,110,0.7)", 1.8, 300);
    };

    FX.water = function (S, P) {
        var a = S.a, u = a.cw, dur = 900;
        var jelly = [[1.6, 0.7], [0.85, 1.35], [1.25, 0.85], [0.95, 1.1], [1.1, 1],
                     [1.05, 1.05]];
        H_anim(S, P.path(18, function (t) {
            var k = Math.min(jelly.length - 1, Math.floor(t * 6)), j = jelly[k];
            return { y: -a.ch * (0.1 + t * 0.5) + (t > 0.7 ? (t - 0.7) * a.ch * 1.5 : 0),
                     sx: t < 0.05 ? 0.4 : j[0], sy: t < 0.05 ? 0.4 : j[1],
                     o: t > 0.72 ? (1 - t) / 0.28 : 1 };
        }), dur);
        P.drops(11, "#2a8ad8", "#cfeeff", 1.3, 1.1, "#6ac8ff");
        for (var i = 0; i < 3; i++)
            P.ring("#9ad8ff", u * 1.9, u * 0.7, 0, a.ch * 0.38, 620, i * 130, 2);
        P.glow("rgba(110,200,255,0.8)", 1.8, 300);
    };

    FX.shadow = function (S, P) {
        var a = S.a, u = a.cw, dur = 1000;
        H_anim(S, P.path(16, function (t) {
            var melt = Math.max(0, t - 0.4) / 0.6;
            return { y: a.ch * 0.35 * melt, sx: (t < 0.2 ? 2.2 - t * 5 : 1.2) * (1 - melt * 0.15),
                     sy: (t < 0.2 ? 2.2 - t * 5 : 1.2) * (1 + melt * 0.8),
                     o: t < 0.1 ? t * 10 : t > 0.75 ? (1 - t) / 0.25 : 1,
                     f: "blur(" + (melt * 3).toFixed(1) + "px)" };
        }), dur);
        P.p(P.box(u * 2.2, u * 2.2, 0, 0, "border-radius:50%;background:"
                  + "radial-gradient(circle,rgba(10,0,20,0.9),rgba(40,10,70,0.4) 50%,"
                  + "transparent 72%)"),
            [{ transform: "scale(1.8)", opacity: 0 },
             { transform: "scale(0.8)", opacity: 1, offset: 0.25 },
             { transform: "scale(1.4)", opacity: 0 }], { duration: 900 });
        for (var i = 0; i < 6; i++)
        {
            var w = Math.max(4, u * 0.08), h = a.ch * rnd(0.7, 1.3);
            P.p(P.box(w, h, (i - 2.5) * u * 0.17, a.ch * 0.2 + h / 2,
                      "transform-origin:50% 0;background:linear-gradient(#0a0014,"
                      + "#3a1068 60%,transparent);border-radius:50%"),
                P.path(10, function (t) {
                    return { x: Math.sin(t * 8 + i) * u * 0.06, sy: Math.min(1, t * 3),
                             sx: 1 - t * 0.4, o: t > 0.6 ? (1 - t) / 0.4 : 1 };
                }), { duration: 800, delay: 150 + i * 50, easing: "linear" });
        }
        for (i = 0; i < 5; i++)
            P.dot("#6a2cc0", Math.max(3, u * 0.06), rnd(-0.5, 0.5) * u, 0,
                  rnd(-0.3, 0.3) * u, -a.ch * rnd(0.6, 1.3), rnd(600, 900),
                  rnd(0, 300), "#9a5cff", "ease-out");
    };

    FX.blood = function (S, P) {
        var a = S.a, u = a.cw, dur = 860;
        H_anim(S, [
            { transform: t2(0, 0, "scale(0.5)"), opacity: 0, offset: 0 },
            { transform: t2(0, 0, "scale(1.7)"), opacity: 1, offset: 0.1 },
            { transform: t2(0, 0, "scale(1.2)"), opacity: 1, offset: 0.24 },
            { transform: t2(0, 0, "scale(1.8)"), opacity: 1, offset: 0.36 },
            { transform: t2(0, -a.ch * 0.05, "scale(1.25)"), opacity: 1, offset: 0.5 },
            { transform: t2(0, -a.ch * 0.1, "scale(1.3)"), opacity: 1, offset: 0.72 },
            { transform: t2(0, a.ch * 0.5, "scale(1.05)"), opacity: 0 }], dur);
        for (var i = 0; i < 6; i++)
        {
            var ang = i * 60 + rnd(-15, 15), L = u * rnd(0.5, 0.9);
            var seg = "polygon(0 40%,25% 0,45% 70%,70% 20%,100% 50%,100% 70%,70% 40%,"
                      + "45% 100%,25% 30%,0 60%)";
            P.p(P.box(L, 7, 0, 0, "left:" + a.x + "px;transform-origin:0 50%;"
                      + "background:linear-gradient(90deg,#ff4a4a,#8a0010);clip-path:" + seg),
                [{ transform: "rotate(" + ang + "deg) scaleX(0)", opacity: 1 },
                 { transform: "rotate(" + ang + "deg) scaleX(1)", opacity: 1,
                   offset: 0.25 },
                 { transform: "rotate(" + ang + "deg) scaleX(1)", opacity: 0 }],
                { duration: 700 });
        }
        P.drops(10, "#a00f1c", "#ff7a7a", 1.2, 1.1, "#ff4a4a");
        P.glow("rgba(255,40,50,0.8)", 1.8, 260);
        P.ring("#c01822", u * 1.6, u * 1.6, 0, 0, 360, 0, 3);
        P.ring("#c01822", u * 1.6, u * 1.6, 0, 0, 360, 220, 3);
    };

    FX.anti = function (S, P) {
        var a = S.a, u = a.cw, dur = 900, n = S.el.children.length;
        H_anim(S, P.path(12, function (t) {
            return { y: -a.ch * t * 0.25, s: t < 0.12 ? 0.6 + t * 9 : 1.6 - t * 0.5,
                     o: t > 0.82 ? (1 - t) / 0.18 : 1 };
        }), dur);
        Array.prototype.forEach.call(S.el.children, function (ch, i) {
            var w = ch.offsetWidth, h = ch.offsetHeight;
            if (ch.animate)
                ch.animate(P.path(12, function (t) {
                    var cut = t > 0.4 ? rnd(0, 45) * (t - 0.4) / 0.6 : 0;
                    return { x: t > 0.4 ? rnd(-1, 1) * u * 0.1 * t : 0,
                             o: t > 0.4 && Math.random() < t * 0.6 ? 0.2 : 1,
                             f: "grayscale(" + Math.min(1, t * 2) + ")",
                             sx: 1, sy: 1 - cut / 100 };
                }), { duration: dur, fill: "both", easing: "steps(1)", delay: i * 40 });
            for (var k = 0; k < 6; k++)
            {
                var sz = Math.max(3, u * 0.07);
                P.p(P.box(sz, sz, (i - (n - 1) / 2) * w + rnd(-0.4, 0.4) * w,
                          rnd(-0.4, 0.4) * h, "background:" + pick(["#dfe6ff", "#9aa8ff",
                          "#fff"])),
                    [{ transform: t2(0, 0), opacity: 1 },
                     { transform: t2(rnd(-1, 1) * u * 0.7, rnd(-0.6, 0.4) * a.ch),
                       opacity: 0 }], { duration: rnd(300, 500),
                                        delay: 300 + rnd(0, 350), easing: "steps(4)" });
            }
        });
        P.p(P.box(u * 2.4, u * 2.4, 0, 0, "border-radius:50%;box-sizing:border-box;"
                  + "border:2px dashed #cfd8ff;box-shadow:0 0 8px #9aa8ff"),
            [{ transform: "rotate(0deg) scale(1.3)", opacity: 0 },
             { transform: "rotate(-90deg) scale(1)", opacity: 1, offset: 0.2 },
             { transform: "rotate(-300deg) scale(0.25)", opacity: 0 }],
            { duration: 700, easing: "ease-in" });
    };

    // Glue ---------------------------------------------------------------------

    function H_anim(S, frames, dur)
    {
        S.H.fx_anim(S.el, frames, { duration: dur, easing: "linear" }, S.done);
    }

    // translucent copy of the number (afterimages / ghosts)
    function H_clone(S)
    {
        if (np >= MAXP) return null;
        var c = S.el.cloneNode(true);
        c.style.visibility = "";
        S.el.parentNode.appendChild(c);
        np++;
        return c;
    }
    function H_run(c, frames, opts)
    {
        opts.fill = "both";
        if (!opts.easing) opts.easing = "ease-out";
        var an = c.animate(frames, opts);
        an.onfinish = function () {
            if (c.parentNode) c.parentNode.removeChild(c);
            np--;
        };
    }

    // S: {a, el, fs, inc, sev, big, dir, name, H}
    function play(fam, S)
    {
        var fn = FX[fam];
        if (!fn) return false;
        S.spiky = SPIKY.test(S.name || "");
        S.boom = BOOM.test(S.name || "");
        fn(S, make(S.H, S.a));
        return true;
    }

    return { family_of: family_of, prepare: prepare, play: play,
             words: function (fam) { return pick(WORDS[fam] || ["ZAP"]); },
             families: Object.keys(FX) };
});
