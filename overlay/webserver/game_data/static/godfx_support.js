// Support-god effects: Sif Muna, Elyvilon, Jiyva, Fedhas, Ashenzari, Gozag.
// Everything is a short burst of WAAPI particles in one fxkit layer
// (#sdc_godfx_support); healing/cleansing is green (125,255,176).
//
// Triggers (game messages; crawl source: ability.cc, god-abil.cc):
//   Sif Muna    "You channel some magical energy."  blue bolts spiral into the
//               MP bar (bar_pulse mp fill 90,140,255); Forget Spell has no
//               fixed message, lenient "memory of .. unravel/fade" -> letters
//   Elyvilon    "You are healed." (Heal Self), "You feel purified!"
//               (Purification), "...comforts X" (Heal Other: line to ally),
//               "divine vigour" / "divine shield" (shimmer rings)
//   Jiyva       "Slime begins to ooze from the nearby walls!" (Oozemancy: ooze
//               flows around the player), "A thick mucus forms" (Slimify),
//               lenient mutation-cure text -> purge pulse
//   Fedhas      "A briar patch grows up", "grows from the ground", lenient
//               sunlight / rain / evolution text
//   Ashenzari   "chain yourself with knowledge", "bind .. in chains" (runes),
//               lenient sight/scry text -> spyglass ring
//   Gozag       Call Merchant ("X invites you to visit his shop") / Bribe Branch ("spreads your bribe to"), "shimmering golden
//               clouds"; and while worshipping Gozag a kill message makes a
//               coin burst where a monster just vanished (its corpse is gold)
// Messages not present in the checked crawl version are lenient guesses.
// Debug: window.sdc_godfx_support_test("sif"|"elyvilon"|"jiyva"|"fedhas"|
//        "ashenzari"|"gozag")
define(["./sdc_api", "./fxkit", "./player", "./map_knowledge"],
function (api, kit, player, map_knowledge) {
    "use strict";

    var MAX_LIVE = 44;
    var GREEN = "125,255,176", BLUE = "90,140,255", GOLD = "255,214,80";
    var live = 0;
    var host = null;                 // pinned container for the current effect
    var snap = [], snap_t = 0;       // recent monster positions (Gozag)

    // one particle: class, css, keyframes, timing; removed when done
    function part(cls, css, frames, opts)
    {
        if (live >= MAX_LIVE || kit.reduced()) return null;
        var el = kit.mk(host || kit.layer("godfx_support"), css);
        el.className = cls;
        live++;
        var a = kit.anim(el, frames, opts);
        var done = function () {
            live--;
            if (el.parentNode) el.parentNode.removeChild(el);
        };
        a.onfinish = done;
        a.oncancel = done;
        return el;
    }

    function pa() { return kit.anchor_of(kit.player_pos()); }

    function god_is(name)
    {
        return new RegExp(name, "i").test(kit.strip(player && player.god));
    }

    function dot(x, y, c, size, dx, dy, ms, delay)
    {
        part("gs-dot", "width:" + size + "px;height:" + size + "px;background:"
             + kit.rgba(c, 0.95) + ";box-shadow:0 0 8px " + kit.rgba(c, 0.9),
             [{ transform: kit.at(x, y), opacity: 0 },
              { transform: kit.at(x + dx * 0.4, y + dy * 0.4), opacity: 1,
                offset: 0.2 },
              { transform: kit.at(x + dx, y + dy), opacity: 0 }],
             { duration: ms, delay: delay || 0 });
    }

    function ring(x, y, c, r0, r1, ms, delay)
    {
        part("gs-ring", "width:" + r1 * 2 + "px;height:" + r1 * 2 + "px;"
             + "margin:" + -r1 + "px 0 0 " + -r1 + "px;color:"
             + kit.rgba(c, 0.9),
             [{ transform: kit.at(x, y) + "scale(" + r0 / r1 + ")",
                opacity: 0.9 },
              { transform: kit.at(x, y) + "scale(1)", opacity: 0 }],
             { duration: ms, delay: delay || 0 });
    }

    function bar_rect(sel)
    {
        for (var i = 0; i < sel.length; i++)
        {
            var e = document.querySelector(sel[i]);
            var r = e && e.getBoundingClientRect();
            if (r && r.width > 4) return r;
        }
        return null;
    }

    function tile(a) { return Math.max(24, a ? a.cw : 32); }

    // Sif Muna ---------------------------------------------------------------

    function sif_channel()
    {
        var a = pa();
        if (!a) return;
        var r = bar_rect(["#stats_mp_bar", "#stats_mp", ".mp_bar", "#stats"]);
        var tx = r ? r.left + r.width * 0.5 : a.x;
        var ty = r ? r.top + r.height / 2 : a.y - 120;
        var n = 8, R = tile(a) * 0.9;
        for (var i = 0; i < n; i++)
        {
            var ang = i / n * 6.283;
            var sx = a.x + Math.cos(ang) * R, sy = a.y + Math.sin(ang) * R;
            var mx = a.x + Math.cos(ang + 1.6) * R * 1.6;
            var my = a.y + Math.sin(ang + 1.6) * R * 1.6;
            part("gs-dot", "width:9px;height:9px;background:"
                 + kit.rgba(BLUE, 1) + ";box-shadow:0 0 10px "
                 + kit.rgba(BLUE, 1),
                 [{ transform: kit.at(sx, sy), opacity: 0 },
                  { transform: kit.at(mx, my), opacity: 1, offset: 0.35 },
                  { transform: kit.at(tx, ty), opacity: 0.2 }],
                 { duration: 750, delay: i * 55, easing: "ease-in" });
        }
        ring(a.x, a.y, BLUE, 6, R * 1.8, 600);
        setTimeout(function () { api.emit("bar_pulse", "mp", "fill", BLUE); },
                   650);
    }

    function sif_forget()
    {
        var a = pa();
        if (!a) return;
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh*#?".split("");
        for (var i = 0; i < 9; i++)
        {
            var x = a.x + (i - 4) * 11, y = a.y - a.ch * 0.7;
            var el = part("gs-glyph", "color:" + kit.rgba(BLUE, 1),
                [{ transform: kit.at(x, y) + "rotate(0deg)", opacity: 1 },
                 { transform: kit.at(x + kit.rnd(-14, 14), y + 90)
                   + "rotate(" + kit.rnd(-70, 70) + "deg)", opacity: 0 }],
                { duration: 1100, delay: i * 70, easing: "ease-in" });
            if (el) el.textContent = kit.pick(chars);
        }
    }

    // Elyvilon ---------------------------------------------------------------

    function ely_heal()
    {
        var a = pa();
        if (!a) return;
        ring(a.x, a.y, GREEN, 4, tile(a) * 1.5, 700);
        for (var i = 0; i < 8; i++)
            dot(a.x + kit.rnd(-14, 14), a.y + 8, GREEN, 6, 0,
                -kit.rnd(30, 60), 900, i * 70);
        api.emit("bar_pulse", "hp", "fill", GREEN);
    }

    function ely_purify()
    {
        var a = pa();
        if (!a) return;
        var C = "170,235,255";
        for (var i = 0; i < 3; i++)
            ring(a.x, a.y, i ? C : GREEN, 6, tile(a) * (2.5 + i), 900,
                 i * 160);
        part("gs-wash", "background:radial-gradient(circle at " + a.x + "px "
             + a.y + "px, " + kit.rgba(C, 0.28) + ", transparent 55%)",
             [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }],
             { duration: 1100 });
    }

    function ely_shimmer()
    {
        var a = pa();
        if (!a) return;
        ring(a.x, a.y, GREEN, 8, tile(a) * 1.2, 1100);
        for (var i = 0; i < 10; i++)
        {
            var ang = i / 10 * 6.283, R = tile(a) * 0.8;
            dot(a.x + Math.cos(ang) * R, a.y + Math.sin(ang) * R,
                "220,255,235", 4, 0, -12, 900, i * 60);
        }
    }

    function ely_other(text)
    {
        var a = pa();
        if (!a) return;
        var best = null, bd = 1e9, low = String(text || "").toLowerCase();
        kit.monsters().forEach(function (m) {
            var p = kit.anchor_of(m);
            if (!p) return;
            var d = Math.abs(p.x - a.x) + Math.abs(p.y - a.y);
            if (low.indexOf(m.name) >= 0) d -= 1e6;
            if (d < bd) { bd = d; best = p; }
        });
        if (!best) return;
        var dx = best.x - a.x, dy = best.y - a.y;
        var len = Math.sqrt(dx * dx + dy * dy), ang = Math.atan2(dy, dx);
        var rot = "rotate(" + ang + "rad) ";
        part("gs-line", "width:" + len + "px;background:linear-gradient(90deg,"
             + kit.rgba(GREEN, 0) + "," + kit.rgba(GREEN, 0.95) + ");"
             + "box-shadow:0 0 8px " + kit.rgba(GREEN, 0.8),
             [{ transform: kit.at(a.x, a.y) + rot + "scaleX(0)", opacity: 1 },
              { transform: kit.at(a.x, a.y) + rot + "scaleX(1)", opacity: 1,
                offset: 0.5 },
              { transform: kit.at(a.x, a.y) + rot + "scaleX(1)", opacity: 0 }],
             { duration: 800 });
        ring(best.x, best.y, GREEN, 4, tile(a) * 1.1, 700, 350);
    }

    // Jiyva ------------------------------------------------------------------

    function jiyva_walls()
    {
        var a = pa();
        if (!a) return;
        var C = "120,230,70", R = tile(a);
        // fxkit does not expose wall cells: ooze drips around the player
        // (it reads as flowing off the nearby walls)
        for (var i = 0; i < 14; i++)
        {
            var ang = kit.rnd(0, 6.283), d = R * kit.rnd(1.2, 3);
            var x = a.x + Math.cos(ang) * d, y = a.y + Math.sin(ang) * d;
            part("gs-dot", "width:" + kit.rnd(8, 16) + "px;height:"
                 + kit.rnd(14, 26) + "px;border-radius:50% 50% 50% 50%/40% 40% 60% 60%;"
                 + "background:" + kit.rgba(C, 0.75) + ";box-shadow:0 0 8px "
                 + kit.rgba(C, 0.7),
                 [{ transform: kit.at(x, y) + "scaleY(0.2)", opacity: 0 },
                  { transform: kit.at(x, y) + "scaleY(1)", opacity: 1,
                    offset: 0.25 },
                  { transform: kit.at(x, y + R * 0.8) + "scaleY(1.6)",
                    opacity: 0 }],
                 { duration: 1400, delay: i * 70 });
        }
    }

    function jiyva_purge()
    {
        var a = pa();
        if (!a) return;
        ring(a.x, a.y, "120,230,70", 4, tile(a) * 2, 800);
        ring(a.x, a.y, GREEN, 4, tile(a) * 1.3, 700, 150);
    }

    function jiyva_slimify()
    {
        var a = pa();
        if (!a) return;
        for (var i = 0; i < 6; i++)
            dot(a.x + kit.rnd(-10, 10), a.y - 6, "120,230,70", 7, 0,
                kit.rnd(20, 40), 900, i * 90);
    }

    // Fedhas -----------------------------------------------------------------

    function leaves(n, up)
    {
        var a = pa();
        if (!a) return;
        var C = ["90,200,70", "140,230,80", "60,160,60"], R = tile(a);
        for (var i = 0; i < n; i++)
        {
            var ang = i / n * 6.283, c = kit.pick(C);
            var x0 = a.x + Math.cos(ang) * R * 0.4;
            var y0 = a.y + Math.sin(ang) * R * 0.4;
            var x1 = a.x + Math.cos(ang + 2) * R * 1.8;
            var y1 = a.y + Math.sin(ang + 2) * R * 1.8 + (up ? -20 : 20);
            part("gs-dot", "width:9px;height:5px;border-radius:80% 0;"
                 + "background:" + kit.rgba(c, 0.95),
                 [{ transform: kit.at(x0, y0) + "rotate(0deg)", opacity: 0 },
                  { transform: kit.at((x0 + x1) / 2 + 10, (y0 + y1) / 2 - 10)
                    + "rotate(200deg)", opacity: 1, offset: 0.4 },
                  { transform: kit.at(x1, y1) + "rotate(420deg)", opacity: 0 }],
                 { duration: 1300, delay: i * 50, easing: "ease-in-out" });
        }
    }

    function fedhas_sun()
    {
        var a = pa();
        if (!a) return;
        var tf = kit.at(a.x - 20, a.y - 260);
        part("gs-line", "width:40px;height:60px;transform-origin:50% 0;"
             + "background:linear-gradient(180deg,"
             + kit.rgba("255,244,170", 0.9) + ","
             + kit.rgba("255,244,170", 0) + ")",
             [{ transform: tf + "scaleY(0)", opacity: 0 },
              { transform: tf + "scaleY(4.5)", opacity: 1, offset: 0.3 },
              { transform: tf + "scaleY(4.5)", opacity: 0 }],
             { duration: 1000 });
        ring(a.x, a.y, "255,240,150", 6, tile(a) * 1.6, 900, 250);
    }

    function fedhas_evolve()
    {
        var a = pa();
        if (!a) return;
        for (var i = 0; i < 12; i++)
        {
            var ang = i * 0.9, d = 6 + i * 4;
            dot(a.x + Math.cos(ang) * d, a.y + Math.sin(ang) * d,
                "140,230,80", 6, Math.cos(ang) * 8, -30 - i * 3, 900, i * 60);
        }
    }

    // Ashenzari --------------------------------------------------------------

    function ash_runes()
    {
        var a = pa();
        if (!a) return;
        var runes = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾ"
                    .split("");
        for (var i = 0; i < 8; i++)
        {
            var ang = i / 8 * 6.283, R = tile(a) * 1.1;
            var x = a.x + Math.cos(ang) * R, y = a.y + Math.sin(ang) * R;
            var el = part("gs-glyph", "color:" + kit.rgba("190,120,255", 1),
                [{ transform: kit.at(x, y), opacity: 0 },
                 { transform: kit.at(x, y - 14), opacity: 1, offset: 0.3 },
                 { transform: kit.at(x, y - 40), opacity: 0 }],
                { duration: 1500, delay: i * 80 });
            if (el) el.textContent = kit.pick(runes);
        }
    }

    function ash_spyglass()
    {
        var a = pa();
        if (!a) return;
        ring(a.x, a.y, "190,120,255", 8, tile(a) * 3, 900);
        ring(a.x, a.y, "190,120,255", 8, tile(a) * 2.2, 900, 120);
    }

    // Gozag ------------------------------------------------------------------

    // One spinning coin under gravity: starts at (x, y) with velocity
    // (vx, vy) px/s, bounces twice on the floor line, lies flat, fades.
    // Sampled into keyframes (uniform in time) so the spin, the fall and the
    // squash on the floor all come from one transform. The coin flashes
    // bright whenever it faces the viewer (a glimmer per turn of the spin),
    // and some coins throw a glint where they first hit the floor.
    function coin(x, y, vx, vy, floor, delay, size, sparkle)
    {
        var T = 900, STEP = 30, G = 1500, N = Math.round(T / STEP);
        var spin = kit.rnd(0, 6.283), w = kit.rnd(16, 24);
        var px = x, py = y, bounces = 0, rest = false, hit_at = -1;
        var frames = [];
        for (var i = 0; i <= N; i++)
        {
            var dt = STEP / 1000;
            if (!rest)
            {
                vy += G * dt;
                px += vx * dt;
                py += vy * dt;
                if (py >= floor)
                {
                    py = floor;
                    if (hit_at < 0) hit_at = i * STEP;
                    if (++bounces > 2 || Math.abs(vy) < 110)
                        rest = true;
                    else
                    {
                        vy = -vy * 0.42;
                        vx *= 0.6;
                    }
                }
                spin += w * dt;
            }
            var face = Math.abs(Math.cos(spin));
            var sx = rest ? 1 : Math.max(0.15, face);
            var sy = rest ? 0.72 : 1;
            // glimmer: bright flash while face-on, a last twinkle at rest
            var fl = rest ? 0.35 * (0.5 + 0.5 * Math.sin(i * 1.7))
                          : Math.max(0, (face - 0.82) / 0.18);
            frames.push({ transform: kit.at(px, py) + "scale(" + sx.toFixed(2)
                                     + "," + sy + ")",
                          filter: "brightness(" + (1 + 1.3 * fl).toFixed(2)
                                  + ") drop-shadow(0 0 " + (fl * 6).toFixed(1)
                                  + "px rgba(255,236,150," + fl.toFixed(2)
                                  + "))",
                          opacity: i === 0 ? 0 : (i > N * 0.75
                                   ? Math.max(0, (N - i) / (N * 0.25)) : 1),
                          offset: i / N });
        }
        part("gs-coin", "width:" + size + "px;height:" + size + "px;margin:"
             + -size / 2 + "px 0 0 " + -size / 2 + "px;",
             frames, { duration: T, delay: delay, easing: "linear" });
        if (sparkle && hit_at >= 0)
            glint(px, floor - 2, delay + hit_at, 0.7 + 0.5 * Math.random());
    }

    // four-point twinkle; used for the pop and for landings
    function glint(x, y, delay, k)
    {
        k = k || 1;
        part("gs-glint", "color:#fff4b8;",
             [{ transform: kit.at(x, y) + "scale(0) rotate(0deg)", opacity: 0 },
              { transform: kit.at(x, y) + "scale(" + k + ") rotate(45deg)",
                opacity: 1, offset: 0.35 },
              { transform: kit.at(x, y) + "scale(0) rotate(90deg)", opacity: 0 }],
             { duration: 320, delay: delay });
    }

    // rain: coins fall from above onto the tile; burst: they pop out of it.
    // With pos the whole effect follows that map tile as the view scrolls.
    function coins(x, y, n, rain, pos)
    {
        var floor = y + 12, a0 = { x: x, y: y };
        if (pos)
        {
            host = kit.mk(kit.layer("godfx_support"),
                          "width:0;height:0;will-change:transform;");
            kit.pin(host, pos, a0, 1400);
        }
        for (var i = 0; i < n; i++)
        {
            var size = Math.round(kit.rnd(10, 13));
            if (rain)
            {
                var sx = x + kit.rnd(-26, 26);
                coin(sx, y - kit.rnd(90, 140), kit.rnd(-15, 15), 0,
                     floor + kit.rnd(-8, 8), i * 45, size, i % 3 === 0);
            }
            else
                coin(x + kit.rnd(-6, 6), y - 4, kit.rnd(-90, 90),
                     kit.rnd(-330, -200), floor + kit.rnd(-8, 8), i * 14, size,
                     i % 3 === 0);
        }
        if (!rain) { glint(x, y - 6, 0, 1.3); glint(x + 9, y - 12, 90, 0.8); }
        host = null;
    }

    function gozag_merchant()
    {
        var a = pa();
        if (a) coins(a.x, a.y, 14, true, kit.player_pos());
    }

    function gozag_bribe()
    {
        var a = pa();
        if (a)
        {
            coins(a.x, a.y, 14, false, kit.player_pos());
            ring(a.x, a.y, GOLD, 4, 60, 700);
        }
    }

    var gold_fired = {};      // "x,y" -> time, so one kill pops once

    function gold_pop(m)
    {
        var k = m.x + "," + m.y, t = kit.now();
        if (t - (gold_fired[k] || -1e9) < 800) return;
        var a = kit.anchor_of(m);
        if (!a) return;
        gold_fired[k] = t;
        coins(a.x, a.y, 10, false, m);
    }

    // kill under Gozag: the monster's tile turns to gold. Fired right away
    // from the message, using the last monster snapshot (the monster may
    // already be gone from the live map when the message lands); falls back
    // to a vanished-monster diff when the message names nobody we saw.
    function gozag_kill(text)
    {
        var before = snap;
        if (!before.length || kit.now() - snap_t > 1500) return;
        var lt = String(text || "").toLowerCase();
        var named = before.filter(function (m) {
            return lt.indexOf(m.name) >= 0;
        });
        if (named.length)
        {
            var now_m = kit.monsters(), pl = kit.player_pos() || { x: 0, y: 0 };
            var gone = named.filter(function (m) {
                return !now_m.some(function (o) {
                    return o.x === m.x && o.y === m.y && o.name === m.name;
                });
            });
            var pool = gone.length ? gone : named;
            pool.sort(function (p, q) {
                return Math.max(Math.abs(p.x - pl.x), Math.abs(p.y - pl.y))
                       - Math.max(Math.abs(q.x - pl.x), Math.abs(q.y - pl.y));
            });
            // a blast can kill several of the same kind: pop each vanished
            // one; if none vanished yet, just the nearest
            (gone.length ? pool.slice(0, 5) : [pool[0]]).forEach(gold_pop);
            return;
        }
        setTimeout(function () {
            var now_m = kit.monsters(), n = 0;
            before.forEach(function (m) {
                var still = now_m.some(function (o) {
                    return o.x === m.x && o.y === m.y;
                });
                if (!still && n < 3) { n++; gold_pop(m); }
            });
        }, 120);
    }

    // cheap monster snapshot (taken before a kill message lands)
    // Under Gozag every monster that gives xp leaves gold where it dies, with
    // no message of its own (the death line is just "dies" / "is blown up",
    // and kills by allies or an orb read differently). So also watch for a
    // monster that vanished from its tile while a pile (an item) appeared
    // there: a monster that left or blinked away leaves nothing.
    function has_item(m)
    {
        var mc = map_knowledge.get(m.x, m.y);
        return !!(mc && mc.t && mc.t.fg && !mc.mon);
    }

    function watch_gold(prev, cur)
    {
        var n = 0;
        prev.forEach(function (m) {
            if (n >= 5) return;
            var near = cur.some(function (o) {
                return o.name === m.name && Math.abs(o.x - m.x) <= 2
                       && Math.abs(o.y - m.y) <= 2;
            });
            if (near) return;
            if (has_item(m)) { n++; gold_pop(m); }
            else
                setTimeout(function () { if (has_item(m)) gold_pop(m); }, 250);
        });
    }

    api.on("frame", function () {
        var t = kit.now();
        if (t - snap_t < 150) return;
        try
        {
            var cur = kit.monsters();
            if (snap.length && t - snap_t < 600 && god_is("gozag"))
                watch_gold(snap, cur);
            snap = cur; snap_t = t;
        }
        catch (e) { /* ignore */ }
    });

    // Dispatch ---------------------------------------------------------------

    var RULES = [
        [/You channel some magical energy/, sif_channel],
        [/memory of .*(unravel|fade|vanish)|you (forget|have forgotten) /i,
         sif_forget],
        [/^You are healed\b/, ely_heal],
        [/You feel purified/, ely_purify],
        [/light of Elyvilon comforts/i, ely_other],
        [/divine vigour\.|divine shield (manifests|is renewed)/i, ely_shimmer],
        [/Slime begins to ooze from the nearby walls/, jiyva_walls],
        [/A thick mucus forms/, jiyva_slimify],
        [/mutations? (are|is|has|have) (been )?(removed|cured|purged)|feel (cleansed|less mutated)/i,
         jiyva_purge],
        [/briar patch grows|ballistomycete grows|oklob plant grows/i,
         function () { leaves(12, true); }],
        [/sunlight|burst of sun/i, fedhas_sun],
        [/\brain\b.*(plant|Fedhas)|Fedhas.*\brain\b/i,
         function () { leaves(14, false); }],
        [/Fedhas.*evol|evol.*plant/i, fedhas_evolve],
        [/chain yourself with knowledge|in chains/i, ash_runes],
        [/Ashenzari.*(sight|reveal|show|scry)/i, ash_spyglass],
        // real text (god-abil.cc): "<Shopkeeper> invites you to visit
        // his|her|their|its <shop type> <suffix>."
        [/ invites you to visit (his|her|their|its|your) /i, gozag_merchant],
        // "Gozag spreads your bribe to <branch>!" (not "You can't bribe",
        // "Your bribe of X has been exhausted", or the yes/no prompt)
        [/spreads your bribe to |shimmering golden clouds/i, gozag_bribe],
        [/turns? to gold/i, function (t) { gozag_kill(t); }]
    ];

    kit.on_message(function (text) {
        try {
            RULES.some(function (r) {
                if (r[0].test(text)) { r[1](text); return true; }
                return false;
            });
            if (/\b(kill|slay|destroy|dies|die)\b|\bis (killed|destroyed|blown up|incinerated)|collapses into dust/i
                    .test(text) && god_is("gozag"))
                gozag_kill(text);
        } catch (e) { console.error("sdc godfx_support:", e); }
    });

    window.sdc_godfx_support_test = function (god) {
        var T = {
            sif: [sif_channel, sif_forget],
            elyvilon: [ely_heal, ely_purify, ely_shimmer,
                       function () { ely_other(""); }],
            jiyva: [jiyva_walls, jiyva_slimify, jiyva_purge],
            fedhas: [function () { leaves(12, true); }, fedhas_sun,
                     fedhas_evolve],
            ashenzari: [ash_runes, ash_spyglass],
            gozag: [gozag_merchant, gozag_bribe, function () {
                var a = pa();
                if (a) coins(a.x + 40, a.y, 10, false);
            }]
        };
        (T[god] || []).forEach(function (f, i) {
            setTimeout(function () {
                try { f(); } catch (e) { console.error(e); }
            }, i * 1200);
        });
    };

    return {};
});
