// Combat feedback: blood drops when the player is hurt, and onomatopoeia
// ("KA-CHUNK", "swoosh") on the target tile of melee / ranged attacks.
//   hurt event (alive hud_update) -> blood on the player tile
//   game messages -> classified (see classify) -> word on the target tile
// Message formats from crawl source: melee-attack.cc announce_hit() 3699/
// 3719, player_warn_miss() 2799, monster miss 374; ranged-attack.cc
// announce_hit() 835, miss 245; attack.cc evasion_margin_adverb() 754 and
// attack_strength_punctuation() 739 (HIT_WEAK 7 / MED 18 / STRONG 36).
// The patched binary appends " for N" to attack lines ("You hit the goblin
// for 7!"); every attack becomes an event
//   {dir: "out"|"in", result: "hit"|"miss"|"kill", damage: N|null, sev, verb,
//    target, close}
// Kills carry the number of the hit sentence for the same target within 1.5 s.
// Option combat_text: "numbers" (damage number in the kachunk display font,
// nothing when the damage is unknown; MISS for misses) or "words" (kachunk words,
// swoosh words for misses) or "off" (no numbers/words; the blood from
// `hurt` events is a separate effect and stays).
//
//   who / result   colour (fill / outline)       where     motion
//   OUT hit        gold #ffd94a / brown #3a1c06  target    pops UP + slightly
//                  heavy (>=18): #fff6c8                   right, sparks
//   OUT kill       white-hot #fff / orange glow  target    bigger pop + debris
//   IN  hit        crimson #ff2d2d / #5a0000     you       DROPS with wobble,
//                  "-N"; big hits: slash gash              blood droplets
//   OUT miss       hollow ice-blue, thin italic  target    slides sideways +
//                  opacity 0.75, no impact                 down, dashed arc
//   IN  miss       hollow green-grey             you       slides the other way
//   Miss arc distance: barely 0.3 / closely 0.6 / completely 1.05 tiles.
//   Reduced motion: plain fade, same colours.
// Spell/beam hits ("The bolt of fire hits ...") carry a family and play the
// element-specific effect from spellfx.js instead of the gold melee number.
// Weapon brands: the brand line that follows a hit ("You burn the goblin!",
// "Lightning courses through the orc!", see classify_brand) restyles that
// hit's number in the element (spellfx family) with the element effect, a
// gold underline (cb-brand) and the usual weapon sparks; the number is the
// weapon damage (+ the brand damage if the line carries " for N").
// Targets: one batch per player action (all lines of one "msgs" packet),
// matched against the monster snapshot taken before the action (mon.id,
// damage pips); see "Action batches" below. Cleave / beam hits on several
// same-named monsters each go to a different monster, shown together with
// a 70 ms stagger.
// Layer: #sdc_combat. Debug: window.sdc_combat_test(kind) with kind in
// hit | heavy | kill | miss | hurt | hurt_heavy | in_hit | in_miss
// | num_hit | num_heavy | num_miss | spell_<family>[_in] | brand_<family>;
// also sdc_spell_test_all() and sdc_combat_msg(text)
define(["jquery", "./sdc_api", "./player", "./dungeon_renderer", "./enums",
        "./map_knowledge", "./spellfx", "./fxkit"],
function ($, api, player, dungeon_renderer, enums, map_knowledge, spellfx, kit) {
    "use strict";

    api.register_option({ key: "combat_text", label: "Combat text",
                          default: "numbers",
                          choices: [["numbers", "Numbers"],
                                    ["words", "Words"],
                                    ["off", "Off"]] });

    var MSG_GRACE = 1500;
    var MAX_WORDS = 10;           // a cleave on a crowd needs several at once
    var MAX_BLOOD = 60;

    var layer = null;
    var init_time = 0;
    var words = 0;
    var blood_els = 0;
    var last_hit_msg = -1e9;      // last "mon_hit" message time
    var last_dir = null;
    var last_ppos = null;
    var snap = [];                // [{id, name, x, y, dmg, pet}] last frame
    var tile_t = {};              // "x,y" -> last word time (unbatched only)
    var tile_live = {};          // "x,y" -> [{slot, until}] numbers on screen


    function now()
    {
        return window.performance ? window.performance.now() : Date.now();
    }
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
    function reduced() { return api.reduced_motion(); }

    // Geometry (as blink.js) ----------------------------------------------

    function ensure_layer()
    {
        if (layer && document.body.contains(layer)) return layer;
        layer = document.createElement("div");
        layer.id = "sdc_combat";
        (document.getElementById("normal") || document.body)
            .appendChild(layer);
        return layer;
    }

    // shared tile -> screen mapping (CRT curve and the 2.5D camera)
    function anchor_of(pos) { return kit.anchor_of(pos); }

    // Element helpers ---------------------------------------------------------

    // Each effect is built inside a zero-size host pinned to its map tile, so
    // it follows the view when it scrolls, zooms or rotates mid-animation
    // (mobile pinch / twist). `host` is the one mk() fills right now.
    var host = null;
    var HOST_MS = 3000;             // longer than any combat animation

    function pinned(pos, a, ms)
    {
        var h = document.createElement("div");
        h.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;"
                          + "will-change:transform;";
        ensure_layer().appendChild(h);
        // copy: callers shift their anchor for slots after this
        kit.pin(h, pos, { x: a.x, y: a.y, cw: a.cw, ch: a.ch }, ms || HOST_MS);
        return h;
    }

    // run fn with mk() filling host h
    function into(h, fn)
    {
        var prev = host;
        host = h;
        try { fn(); }
        finally { host = prev; }
    }

    function mk(css, cls, parent)
    {
        var d = document.createElement("div");
        d.className = "cb-el" + (cls ? " " + cls : "");
        d.style.cssText = css || "";
        var p = parent || host;
        (p && p.parentNode ? p : ensure_layer()).appendChild(d);
        return d;
    }

    function fx_anim(el, frames, opts, on_done)
    {
        opts.fill = "both";
        if (!opts.easing) opts.easing = "ease-out";
        var a = el.animate(frames, opts);
        a.onfinish = function () {
            if (el.parentNode) el.parentNode.removeChild(el);
            if (on_done) on_done();
        };
        return a;
    }

    function t2(x, y, extra)
    {
        return "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) "
               + (extra || "");
    }

    // Blood -------------------------------------------------------------------

    function splat(x, y, sz)
    {
        if (blood_els >= MAX_BLOOD) return;
        var w = sz * rnd(1.4, 2.4), h = sz * rnd(0.7, 1.2);
        var el = mk("left:" + (x - w / 2) + "px;top:" + (y - h / 2) + "px;"
                    + "width:" + w + "px;height:" + h + "px;"
                    + "border-radius:50%;background:#7a0b12;"
                    + "box-shadow:" + (sz * 0.9) + "px 0 0 -1px #5a0810");
        blood_els++;
        var r = rnd(0, 180);
        fx_anim(el, [{ transform: "rotate(" + r + "deg) scale(0.4)",
                       opacity: 0.9 },
                     { transform: "rotate(" + r + "deg) scale(1)",
                       opacity: 0.8, offset: 0.15 },
                     { transform: "rotate(" + r + "deg) scale(1)",
                       opacity: 0 }],
                { duration: 1200, easing: "linear" },
                function () { blood_els--; });
    }

    function blood(ratio, source)
    {
        var a = anchor_of(player.pos);
        if (!a || !document.body.animate) return;
        into(pinned(player.pos, a), function () { blood_at(a, ratio, source); });
    }

    function blood_at(a, ratio, source)
    {
        ratio = Math.max(0, Math.min(1, ratio || 0));
        var cw = a.cw, ch = a.ch;

        if (reduced())
        {
            var f = mk("left:" + (a.x - cw / 2) + "px;top:" + (a.y - ch / 2)
                       + "px;width:" + cw + "px;height:" + ch
                       + "px;background:rgba(192,24,34,0.55)");
            fx_anim(f, [{ opacity: 0.7 }, { opacity: 0 }], { duration: 300 });
            return;
        }

        if (source === "poison")
        {
            var d = Math.max(3, cw * 0.1);
            var g = mk("left:" + (a.x - d / 2) + "px;top:" + (a.y - ch * 0.2)
                       + "px;width:" + d + "px;height:" + d * 1.4 + "px;"
                       + "border-radius:50% 50% 50% 50%/60% 60% 40% 40%;"
                       + "background:#2c7a2a;box-shadow:0 0 5px #5cd04a");
            fx_anim(g, [{ transform: t2(0, 0), opacity: 0.9 },
                        { transform: t2(rnd(-4, 4), ch * 0.6), opacity: 0 }],
                    { duration: 600, easing: "ease-in" });
            return;
        }

        // red flash on the tile
        var fl = mk("left:" + (a.x - cw / 2) + "px;top:" + (a.y - ch / 2)
                    + "px;width:" + cw + "px;height:" + ch
                    + "px;background:radial-gradient(circle,rgba(255,74,74,0.8),"
                    + "rgba(192,24,34,0.55));mix-blend-mode:screen");
        fx_anim(fl, [{ opacity: Math.min(1, 0.3 + ratio) }, { opacity: 0 }],
                { duration: 240 });

        // droplets: mostly upward fan with gravity
        var n = Math.min(14, 6 + Math.round(ratio * 16));
        var cols = ["#c01822", "#7a0b12", "#c01822", "#ff4a4a"];
        for (var i = 0; i < n && blood_els < MAX_BLOOD; i++)
        {
            var ang = -Math.PI / 2 + rnd(-1.15, 1.15);
            var sp = cw * rnd(1.1, 2.4) * (0.8 + ratio * 0.7);
            var vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
            var gr = ch * rnd(3.6, 5.4);
            var sz = Math.max(2.5, cw * rnd(0.07, 0.16) * (0.8 + ratio));
            var streak = Math.random() < 0.35 ? rnd(2, 3.2) : 1;
            var dur = rnd(420, 680);
            var el = mk("left:" + (a.x - sz / 2) + "px;top:" + (a.y - sz / 2)
                        + "px;width:" + sz + "px;height:" + sz * streak
                        + "px;border-radius:50%;background:" + pick(cols)
                        + ";box-shadow:0 0 3px rgba(255,74,74,0.6)");
            var fr = [], steps = 7;
            for (var s = 0; s <= steps; s++)
            {
                var u = s / steps;
                var x = vx * u, y = vy * u + 0.5 * gr * u * u;
                var rot = Math.atan2(vy + gr * u, vx) * 180 / Math.PI - 90;
                fr.push({ transform: t2(x, y, "rotate(" + rot.toFixed(0)
                                        + "deg)"),
                          opacity: s === steps ? 0 : 1 });
            }
            var ex = vx, ey = vy + 0.5 * gr;
            blood_els++;
            (function (ex, ey, sz) {
                fx_anim(el, fr, { duration: dur, easing: "linear" },
                        function () {
                    blood_els--;
                    if (ey > 0 || Math.random() < 0.3)
                        splat(a.x + ex, a.y + ey, sz);
                });
            })(ex, ey, sz);
        }

        // gash for big hits
        if (ratio >= 0.2)
        {
            var len = cw * (1.3 + ratio);
            var sl = mk("left:" + (a.x - len / 2) + "px;top:" + (a.y - 2)
                        + "px;width:" + len + "px;height:4px;"
                        + "background:linear-gradient(90deg,transparent,#fff 30%,"
                        + "#ff4a4a 60%,transparent);box-shadow:0 0 8px #c01822");
            fx_anim(sl, [{ transform: "rotate(-32deg) scaleX(0.1)", opacity: 1 },
                         { transform: "rotate(-32deg) scaleX(1)", opacity: 1,
                           offset: 0.35 },
                         { transform: "rotate(-32deg) scaleX(1.05)", opacity: 0 }],
                    { duration: 340 });
        }

        if (ratio > 0.4)
        {
            var ed = mk("left:0;top:0;width:100vw;height:100vh;"
                        + "background:radial-gradient(ellipse at 50% 50%,"
                        + "transparent 55%,rgba(192,24,34,0.55) 100%)",
                        null, ensure_layer());   // screen edge: not pinned
            fx_anim(ed, [{ opacity: 0 }, { opacity: 1, offset: 0.2 },
                         { opacity: 0 }], { duration: 650 });
        }
    }

    // Words / numbers ---------------------------------------------------------

    var POOLS = {
        generic: [["tk", "thwk", "chk"], ["KA-CHUNK", "WHACK", "THUNK"],
                  ["KA-CHUNK!!", "CRUNCH", "SMASH"]],
        cut:     [["shk", "tsk", "chk"], ["SHNK", "SLSH", "THWK"],
                  ["SHLUNK!!", "SLSHH!", "KA-SHNK!!"]],
        pierce:  [["tik", "thip", "tk"], ["THIP", "SKRT", "THUNK"],
                  ["SKEWR!!", "KA-THIP!!", "IMPALE"]],
        blunt:   [["tmp", "thud", "bff"], ["THUD", "CRACK", "WHACK"],
                  ["KA-THUD!!", "CRUNCH", "SMASH"]]
    };
    var MISSES = ["swoosh", "whiff", "shff", "fwsh", "swish"];
    // streak distance from the tile centre (in tile heights) per margin
    var MISS_DIST = { barely: 0.3, closely: 0.62, completely: 1.05 };

    var CUT = /^(slash|slice|cleav|chop|hack|sever|rip|claw|shred|lash|nick|carv|mangl|rend|tear|scratch|flay|dissect|lacerat)/;
    var PIERCE = /^(stab|pierc|impal|skewer|spear|lanc|gor|sting|bit|peck|punctur|jab|prick|spik)/;
    var BLUNT = /^(bludgeon|whack|smash|crush|pummel|thump|punch|kick|headbutt|butt|pound|thrash|batter|hammer|bash|slam|slap|pulveris|clob|club|trampl|squash|whip|tail|stomp|buffet|knock)/;

    function flavour(verb)
    {
        verb = (verb || "").toLowerCase();
        if (CUT.test(verb)) return "cut";
        if (PIERCE.test(verb)) return "pierce";
        if (BLUNT.test(verb)) return "blunt";
        return "generic";
    }

    function word_for(kind, sev, verb)
    {
        if (kind === "kill") return "CRUNCH!";
        if (kind === "miss") return pick(MISSES);
        var tier = sev >= 2 ? 2 : sev;
        var fl = flavour(verb);
        var pool = (fl !== "generic" && Math.random() < 0.6)
                   ? POOLS[fl] : POOLS.generic;
        var w = pick(pool[tier]);
        if (sev >= 3 && w.indexOf("!") < 0) w += "!";
        return w;
    }

    function sev_of_dmg(d)
    {
        return d >= 36 ? 3 : d >= 18 ? 2 : d >= 7 ? 1 : 0;
    }

    function burst(a, heavy, col, spark)
    {
        var n = heavy ? 8 : 5, i;
        for (i = 0; i < n; i++)
        {
            var ang = (i / n) * 360 + rnd(-12, 12);
            var len = a.cw * rnd(0.5, heavy ? 1.2 : 0.8);
            var r = mk("left:" + a.x + "px;top:" + (a.y - 1) + "px;width:"
                       + len + "px;height:3px;transform-origin:0 50%;"
                       + "background:linear-gradient(90deg," + col
                       + ",transparent)");
            fx_anim(r, [{ transform: "rotate(" + ang + "deg) translateX("
                          + a.cw * 0.1 + "px) scaleX(0.2)", opacity: 1 },
                        { transform: "rotate(" + ang + "deg) translateX("
                          + a.cw * 0.35 + "px) scaleX(1)", opacity: 1,
                          offset: 0.4 },
                        { transform: "rotate(" + ang + "deg) translateX("
                          + a.cw * 0.5 + "px) scaleX(0.6)", opacity: 0 }],
                    { duration: 320 });
        }
        for (i = 0; i < (heavy ? 7 : 4); i++)
        {
            var an = Math.random() * Math.PI * 2, d = a.cw * rnd(0.6, 1.4);
            var sp = mk("left:" + (a.x - 1.5) + "px;top:" + (a.y - 1.5)
                        + "px;width:3px;height:3px;background:" + spark
                        + ";box-shadow:0 0 4px " + col);
            fx_anim(sp, [{ transform: t2(0, 0), opacity: 1 },
                         { transform: t2(Math.cos(an) * d,
                                         Math.sin(an) * d + a.ch * 0.3),
                           opacity: 0 }],
                    { duration: rnd(260, 460) });
        }
    }

    function kill_debris(a)
    {
        var kf = mk("left:" + (a.x - a.cw * 0.8) + "px;top:"
                    + (a.y - a.ch * 0.8) + "px;width:" + a.cw * 1.6
                    + "px;height:" + a.ch * 1.6 + "px;border-radius:50%;"
                    + "background:radial-gradient(circle,#fff,"
                    + "rgba(255,160,60,0.6) 40%,transparent 70%);"
                    + "mix-blend-mode:screen");
        fx_anim(kf, [{ transform: "scale(0.3)", opacity: 1 },
                     { transform: "scale(1.2)", opacity: 0 }],
                { duration: 320 });
        for (var i = 0; i < 6; i++)
        {
            var an = rnd(-Math.PI * 0.9, -Math.PI * 0.1);
            var sp = a.cw * rnd(0.8, 1.7), sz = Math.max(3, a.cw * 0.1);
            var db = mk("left:" + (a.x - sz / 2) + "px;top:" + (a.y - sz / 2)
                        + "px;width:" + sz + "px;height:" + sz
                        + "px;background:" + (i % 2 ? "#c01822" : "#d8c8a0"));
            fx_anim(db, [{ transform: t2(0, 0), opacity: 1 },
                         { transform: t2(Math.cos(an) * sp, Math.sin(an) * sp),
                           opacity: 1, offset: 0.5 },
                         { transform: t2(Math.cos(an) * sp * 1.2,
                                         Math.sin(an) * sp + a.ch * 1.2,
                                         "rotate(" + rnd(-300, 300) + "deg)"),
                           opacity: 0 }],
                    { duration: rnd(450, 700) });
        }
    }

    // Dashed curved motion streak passing the tile. side -1 = above the tile
    // (our miss), +1 = below (their miss); dist in tile heights.
    function miss_streak(a, dir, dist, side, col)
    {
        var sw = a.cw * 1.7, sh = a.ch * 0.7;
        var cy = a.y + side * dist * a.ch;
        var st = mk("left:" + (a.x - sw / 2) + "px;top:" + (cy - sh / 2)
                    + "px;width:" + sw + "px;height:" + sh + "px;"
                    + "box-sizing:border-box;border-radius:50%;"
                    + "border-top:2px dashed " + col + ";"
                    + "clip-path:inset(0 0 55% 0)");
        var fl = side > 0 ? " scaleY(-1)" : "";
        fx_anim(st, [{ transform: t2(-dir * a.cw * 0.9, 0,
                                     "rotate(" + (-dir * 14) + "deg)" + fl),
                       opacity: 0 },
                     { transform: t2(0, 0, "rotate(" + (-dir * 5) + "deg)" + fl),
                       opacity: 0.8, offset: 0.4 },
                     { transform: t2(dir * a.cw * 0.9, 0,
                                     "rotate(" + (dir * 6) + "deg)" + fl),
                       opacity: 0 }], { duration: 420, easing: "linear" });
    }

    // ev: {dir: "out"|"in", result: "hit"|"miss"|"kill", damage, sev, verb,
    //      close, fam, spell, brand}; mode forces "numbers"/"words" (debug),
    //      else the option. opt: {batched: skip the per-tile throttle}.
    //      Numbers still on screen on the same tile (this action's or an
    //      earlier one's) push a new one to a free slot beside them.
    // brand: a weapon/missile hit whose brand triggered: the number takes
    //      the element look + effect (fam) and a gold underline (cb-brand)
    //      that marks it as a weapon hit rather than a spell.
    function show_fx(ev, pos, delay, mode, opt)
    {
        opt = opt || {};
        if (window.sdc_combat_trace) window.sdc_combat_trace(ev, pos, delay, opt);
        var a = anchor_of(pos);
        if (!a || !document.body.animate)
        { trace({ ev: "drop", why: "anchor", pos: pos }); return; }
        var a0 = { x: a.x, y: a.y, cw: a.cw, ch: a.ch };
        var key = pos.x + "," + pos.y, t = now();
        var kind = ev.result, incoming = ev.dir === "in";
        if (!opt.batched)
        {
            if (t - (tile_t[key] || 0) < 100 && kind !== "kill") return;
            tile_t[key] = t;
        }
        if (words >= MAX_WORDS)
        { trace({ ev: "drop", why: "max_words", pos: pos }); return; }
        words++;
        mode = mode || api.get("combat_text");
        if (mode === "off") { words--; return; }   // blood still shows
        var numbers = mode !== "words";
        var sev = ev.sev || 0, text, i;
        var fam = kind === "miss" ? null : ev.fam;
        // numbers mode never shows onomatopoeia: no damage figure, no text
        if (numbers && kind !== "miss" && !(ev.damage > 0))
        { words--; return; }
        if (kind === "miss")
            text = numbers ? "MISS" : word_for("miss", 0, "");
        else if (fam && !numbers)
            text = spellfx.words(fam);
        else if (numbers && ev.damage > 0)
        {
            // plain digits (no trailing "!"): severity already shows in the
            // size, colour and burst, and "!" made the numbers hard to read
            text = (incoming ? "-" : "") + ev.damage;
        }
        else
            text = word_for(kind, sev, ev.verb);
        // slot 0 centred, then right / left / further right ..., slightly
        // higher each ring, so a small number never hides under a big one
        var start = t + (delay || 0);
        var live = (tile_live[key] || []).filter(function (e) {
            return e.until > start; });
        var slot = 0;
        while (live.some(function (e) { return e.slot === slot; })) slot++;
        live.push({ slot: slot, until: start + 900 });
        tile_live[key] = live;
        if (slot)
        {
            var ring_n = Math.ceil(slot / 2);
            a.x += (slot % 2 ? 1 : -1) * 0.42 * ring_n * a.cw;
            a.y -= 0.18 * ring_n * a.ch;
        }
        var big = kind !== "miss" && (kind === "kill" || sev >= 2);
        var fs = Math.max(14, Math.round(a.cw * (kind === "miss" ? 0.45
                 : 0.55 + Math.min(3, sev) * 0.09
                   + (kind === "kill" ? 0.2 : 0))
                 * (numbers && kind !== "miss" ? 1.15 : 1)
                 * (fam ? 1.12 : 1)));
        var cls = "cb-word";
        if (fam)                    // colours come from cb-sp-<fam>
            cls += ev.brand ? " cb-brand" : "";
        else if (kind === "miss")
            cls += incoming ? " cb-miss cb-miss-in" : " cb-miss";
        else if (incoming)
            cls += " cb-in" + (big ? " cb-heavy" : "");
        else
            cls += kind === "kill" ? " cb-kill" : big ? " cb-heavy" : "";
        var h = pinned(pos, a0, (delay || 0) + HOST_MS);
        var el = mk("font-size:" + fs + "px;left:" + a.x + "px;top:"
                    + (a.y - a.ch * 0.1) + "px;margin-top:" + (-fs * 0.5)
                    + "px;visibility:hidden;z-index:1", cls, h);
        if (fam) spellfx.prepare(el, fam, text);
        else el.textContent = text;
        el.style.marginLeft = (-el.offsetWidth / 2) + "px";
        var done = function () { words--; };

        var run = function () {
            if (!el.parentNode) { done(); return; }
            el.style.visibility = "";
            if (reduced())
            {
                fx_anim(el, [{ opacity: 0 },
                             { opacity: kind === "miss" ? 0.75 : 1,
                               offset: 0.2 },
                             { opacity: 0 }], { duration: 400 }, done);
                return;
            }
            if (fam)
            {
                var sp = player.pos, sd = last_dir && last_dir.x
                         ? (last_dir.x > 0 ? 1 : -1) : 1;
                var sdir = incoming ? (Math.random() < 0.5 ? -1 : 1)
                           : (sp && pos.x !== sp.x ? (pos.x > sp.x ? 1 : -1)
                              : sd);
                spellfx.play(fam, { a: a, el: el, fs: fs, inc: incoming,
                                    sev: sev, big: sev >= 2 || kind === "kill",
                                    dir: sdir, name: ev.spell, done: done,
                                    H: { mk: function (css, c) {
                                             return mk(css, c, h); },
                                         fx_anim: fx_anim } });
                if (ev.brand && !incoming)
                    burst(a, false, "#fff3b0", "#ffe27a");  // the weapon impact
                if (kind === "kill" && !incoming) kill_debris(a);
                return;
            }
            var rot = rnd(6, 14) * (Math.random() < 0.5 ? -1 : 1);
            if (kind === "miss")
            {
                // out: slides away from the player; in: slides the other way
                var fd = last_dir && last_dir.x ? (last_dir.x > 0 ? 1 : -1) : 1;
                var p = player.pos;
                var dir = incoming ? -fd
                          : (p && pos.x !== p.x ? (pos.x > p.x ? 1 : -1) : fd);
                var side = incoming ? 1 : -1;
                var rr = "rotate(" + (dir * 6) + "deg) ";
                fx_anim(el, [
                    { transform: t2(-dir * a.cw * 0.3, -side * a.ch * 0.05,
                                    rr + "scale(0.9)"), opacity: 0 },
                    { transform: t2(-dir * a.cw * 0.1, 0, rr + "scale(1)"),
                      opacity: 0.75, offset: 0.2 },
                    { transform: t2(dir * a.cw * 1.0, a.ch * 0.3,
                                    rr + "scale(0.95)"), opacity: 0 }],
                    { duration: 640, easing: "ease-in" }, done);
                miss_streak(a, dir, MISS_DIST[ev.close] || 0.5, side,
                            incoming ? "rgba(170,200,180,0.85)"
                                     : "rgba(190,236,255,0.9)");
                return;
            }
            if (incoming)
            {
                // heavy fall + wobble
                var w = rnd(5, 9);
                if (big)
                {
                    var gl = a.cw * (1.4 + sev * 0.2);
                    var gs = mk("left:" + (a.x - gl / 2) + "px;top:"
                                + (a.y - 3) + "px;width:" + gl
                                + "px;height:6px;z-index:0;"
                                + "background:linear-gradient(90deg,"
                                + "transparent,#ff2d2d 25%,#5a0000 60%,"
                                + "transparent);box-shadow:0 0 8px #ff2d2d");
                    fx_anim(gs, [{ transform: "rotate(-28deg) scaleX(0.1)",
                                   opacity: 1 },
                                 { transform: "rotate(-28deg) scaleX(1)",
                                   opacity: 1, offset: 0.3 },
                                 { transform: "rotate(-28deg) scaleX(1.05)",
                                   opacity: 0 }], { duration: 420 });
                }
                fx_anim(el, [
                    { transform: t2(0, -a.ch * 0.35, "rotate(0deg) scale(1.9)"),
                      opacity: 0 },
                    { transform: t2(0, -a.ch * 0.2, "rotate(" + (-w)
                                    + "deg) scale(1.4)"),
                      opacity: 1, offset: 0.12 },
                    { transform: t2(a.cw * 0.06, a.ch * 0.05, "rotate(" + w
                                    + "deg) scale(1.2)"),
                      opacity: 1, offset: 0.35 },
                    { transform: t2(-a.cw * 0.06, a.ch * 0.4, "rotate(" + (-w)
                                    + "deg) scale(1.1)"),
                      opacity: 1, offset: 0.6 },
                    { transform: t2(0, a.ch * 1.1, "rotate(" + (w * 0.5)
                                    + "deg) scale(1)"), opacity: 0 }],
                    { duration: big ? 760 : 620, easing: "ease-in" }, done);
                if (big) burst(a, true, "#ff2d2d", "#ff7a6a");
                return;
            }
            // out: pop up and slightly right
            fx_anim(el, [
                { transform: t2(0, 0, "rotate(" + (-rot) + "deg) scale(0.3)"),
                  opacity: 0 },
                { transform: t2(a.cw * 0.05, -a.ch * 0.05, "rotate(" + rot
                                + "deg) scale(" + (big ? 1.7 : 1.4) + ")"),
                  opacity: 1, offset: 0.16 },
                { transform: t2(a.cw * 0.12, -a.ch * 0.2, "rotate(" + rot * 0.5
                                + "deg) scale(1.1)"), opacity: 1, offset: 0.55 },
                { transform: t2(a.cw * 0.25, -a.ch * 0.7, "rotate(" + rot * 0.3
                                + "deg) scale(1)"), opacity: 0 }],
                { duration: big ? 600 : 460 }, done);
            burst(a, big, "#fff3b0", "#ffe27a");
            if (kind === "kill") kill_debris(a);
        };
        var go = function () { into(h, run); };
        if (delay > 0) window.setTimeout(go, delay);
        else go();
    }

    // Target location ---------------------------------------------------------
    //
    // Monsters are identified by map_knowledge's mon.id (the server's
    // client_id: stable per monster while it is in view), so a snapshot taken
    // before the action can be compared to the map after it:
    //   - dmg: the monster's damage pips (MDAM_* fg flags, 0..4)
    //   - gone: its id vanished (died, or left view)
    // tileweb.cc redraw() sends the player, then "msgs", then "map", so when
    // the message mutation fires, the latest frame snapshot is the state
    // before the action; the post state is read when the batch is resolved.

    function cheb(a, b)
    {
        return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    }

    function norm_name(n)
    {
        return String(n || "").toLowerCase().replace(/^(the|an?|your)\s+/, "")
               .replace(/\s+\(.*\)$/, "").trim();
    }

    function name_match(a, b)
    {
        if (!a || !b) return 0;
        if (a === b) return 2;
        return (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) ? 1 : 0;
    }

    function fg_flags(t)
    {
        try { return t && enums.prepare_fg_flags
                     ? enums.prepare_fg_flags(t.fg) : null; }
        catch (e) { return null; }
    }

    function scan_mons()
    {
        var out = [], dr = dungeon_renderer;
        if (!dr || !dr.view || !dr.cols || !dr.rows) return out;
        for (var y = dr.view.y; y < dr.view.y + dr.rows; y++)
            for (var x = dr.view.x; x < dr.view.x + dr.cols; x++)
            {
                var mc = map_knowledge.get(x, y);
                if (!mc || !mc.mon || !mc.mon.name) continue;
                var fl = fg_flags(mc.t) || {};
                out.push({ id: mc.mon.id || null, name: norm_name(mc.mon.name),
                           x: x, y: y,
                           dmg: fl.MDAM_LIGHT ? 1 : fl.MDAM_MOD ? 2
                                : fl.MDAM_HEAVY ? 3
                                : (fl.MDAM_SEV || fl.MDAM_ADEAD) ? 4 : 0,
                           pet: !!fl.PET });
            }
        return out;
    }

    function fallback_pos()
    {
        var p = player.pos;
        if (!p) return null;
        if (last_dir) return { x: p.x + last_dir.x, y: p.y + last_dir.y };
        return { x: p.x, y: p.y - 1 };
    }

    // closest match by name (adjacent first); the snapshot covers a monster
    // that already vanished from the map (kills). Last resort only: batched
    // events go through resolve() below.
    function locate(name)
    {
        var p = player.pos;
        name = norm_name(name);
        if (!p) return null;
        var best = null, bd = 1e9;
        function consider(l)
        {
            l.forEach(function (m) {
                if (m.x === p.x && m.y === p.y) return;
                if (!name_match(m.name, name)) return;
                var d = cheb(m, p);
                if (d < bd) { bd = d; best = m; }
            });
        }
        if (name && name !== "it" && name !== "something")
        {
            consider(scan_mons());
            if (!best) consider(snap);
        }
        if (best) return { x: best.x, y: best.y };
        return fallback_pos();
    }

    // Wielded weapon(s), from the inventory names ("+2 war axe of freezing",
    // artefacts: "the +3 broad axe of Foo {flame, rF+}")
    function weapon_names()
    {
        var out = [];
        if (!player.inv) return out;
        [player.weapon_index, player.offhand_index].forEach(function (i) {
            var it = (i !== undefined && i !== null && i >= 0) ? player.inv[i]
                     : null;
            if (it && it.name) out.push(String(it.name).toLowerCase());
        });
        return out;
    }
    function weapon_cleaves()
    {
        return weapon_names().some(function (n) { return /axe\b/.test(n); });
    }
    function weapon_reaches()
    {
        return weapon_names().some(function (n) {
            return /\b(spear|trident|halberd|glaive|bardiche|partisan|scythe)\b/
                   .test(n);
        });
    }
    // fxkit brand id -> this module's element family
    var BRAND_FAMILY = { flame: "fire", freeze: "cold", elec: "elec",
                         venom: "poison", drain: "necro", vamp: "blood",
                         pain: "blood", holy: "holy", distort: "force",
                         chaos: "chaos", anti: "anti", foul: "shadow",
                         acid: "acid" };
    function weapon_brand()
    {
        return BRAND_FAMILY[kit.brand_of(weapon_names().join("|"))] || null;
    }

    // Message classification --------------------------------------------------

    var PROJ = "(?:dart|javelin|arrow|bolt|stone|rock|bullet|slug|boomerang|"
               + "needle|tomahawk|pebble|spear|dagger|net)";
    var PROJ_SUBJ = new RegExp("^(?:[+-]\\d+ )?(?:[a-z-]+ )*?" + PROJ + "s?$");
    var KILL_RE = /^You (?:kill|destroy|slay|annihilate|obliterate|dissolve|banish|butcher|finish off)\s+(?:the |an? )?([^,!.]+?)\s*[!.]+$/;
    var MISS_RE = /^You(?: (completely|closely|barely))? miss\s+(?:the |an? )?([^,.!]+?)(?: with .*)?\.$/;
    var HIT_RE = /^You ([a-z-]+) (?:the |an? )?([^,!.]+?)(?: (?:with|using|in|on|for) [^!.]*?)?(?:, [^!.]*?)?(!+|\.)$/;
    var MON_MISS_RE = /^(?:The |An? )?(.+?)(?: (completely|closely|barely))? misses you\.$/;
    var MON_HIT_RE = /^(?:The |An? )?([A-Za-z' -]+?) ([a-z-]+) you\b[^!.]*?(!+|\.)$/;
    var PROJ_HIT_RE = new RegExp("^The (?:[a-z-]+ )*?" + PROJ
        + "s? (pierces through|[a-z ]+?) (?:the |an? )?([^,!.]+?)(?: for \\d+)?(?: and shatters[^!.]*)?(?: for \\d+)?(!+|\\.)$");
    var PROJ_MISS_RE = new RegExp("^The (?:[a-z-]+ )*?" + PROJ
        + "(?: (completely|closely|barely))? misses (?:the |an? )?([^,!.]+?)\\.$");
    var ATK_VERB = /^(hit|slash|slice|stab|pierc|impal|skewer|bludgeon|whack|smash|hack|chop|cleav|crush|pummel|thump|punch|kick|headbutt|butt|claw|bit|slap|sting|touch|pound|thrash|lash|sever|shred|mangl|batter|hammer|bash|spear|lanc|gor|rip|pulveris|slam|nick|peck|squeez|trampl|whip|tail|clob|rend|tear|scratch|spik|stomp|buffet|knock|lacerat|punctur|jab|prick|carv|flay|dissect|constrict|smit|strik|struck)/;
    // auxiliary unarmed attacks land on the primary target (never cleave)
    var AUX_VERB = /^(kick|headbutt|peck|tail-slap|bite|gore|tentacle-slap|pseudopod|touch)/;

    function sev_of(p)
    {
        return p === "." ? 0 : Math.min(3, p.length);
    }

    function stem(v)
    {
        return String(v || "").replace(/(?:es|s)$/, "").toLowerCase();
    }

    // damage number from the patched binary: "... for 7!" (not "for 12 gold")
    function dmg_of(s)
    {
        var m = /\bfor (\d+)(?!\d| gold)/.exec(s);
        return m ? parseInt(m[1], 10) : null;
    }

    // Weapon / missile / staff brand messages (attack.cc apply_damage_brand,
    // calc_elemental_brand_damage, pain_affects_defender, drain_defender,
    // distortion_affects_defender; melee-attack.cc staff_message and the
    // monster AF_FIRE/COLD/ELEC flavours; ranged-attack.cc
    // apply_missile_brand; monster.cc splash_with_acid / drain_magic;
    // beam.cc poison_monster / silver_damages_victim). The stock binary
    // prints no " for N" on these (only the punctuation = strength), so the
    // optional "for N" is only used if a later patch adds it.
    // Returns {k: "brand" | "mon_brand", fam, target, damage, sev, own}
    // (own: the line names the attacker's weapon effect outright, so it may
    // show on its own when no hit line precedes it).
    var B_TAIL = "(?: for (\\d+))?(!+|\\.)$";
    var B_NM = "(?:[Tt]he |[Aa]n? )?(.+?)";
    var B_VERB_FAM = [["fire", /^(?:burn|melt)/], ["cold", /^freez/],
                      ["elec", /^shock/], ["poison", /^envenom/],
                      ["force", /^blast/], ["necro", /^drain/]];
    var B_SVO = new RegExp("^(You|The (.+?)) (burns?|melts?|freezes?|shocks?|"
        + "envenoms?|blasts?|drains?) (?:the |an? )?(.+?)( terribly)?" + B_TAIL);
    var B_SIMPLE = [
        // [re, fam, own, target group, damage group, punct group]
        [new RegExp("^Lightning courses through " + B_NM + B_TAIL), "elec", 1],
        [new RegExp("^" + B_NM + " (?:is|are) electrocuted" + B_TAIL), "elec", 1],
        [new RegExp("^" + B_NM + " (?:is|are) engulfed in flames" + B_TAIL), "fire", 1],
        [new RegExp("^" + B_NM + " (?:is|are) splashed with acid" + B_TAIL), "acid", 0],
        [new RegExp("^" + B_NM + " writhes? in agony" + B_TAIL), "blood", 1],
        [new RegExp("^" + B_NM + " convulses?" + B_TAIL), "holy", 1],
        [new RegExp("^Space warps (?:horribly )?around " + B_NM + B_TAIL), "force", 1],
        [new RegExp("^The ground beneath " + B_NM + " fractures" + B_TAIL), "earth", 1],
        [new RegExp("^" + B_NM + " shrivels? as negative energy consumes [a-z]+" + B_TAIL), "necro", 1],
        [new RegExp("^The silver sears " + B_NM + B_TAIL), "holy", 1],
        [/^(?:[Tt]he |[Aa]n? )?(.+?)(?:'s|') magic leaks into the air()(\.)$/, "anti", 1],
        [/^(?:[Tt]he |[Aa]n? )?(.+?) (?:is poisoned|looks even sicker|looks as sick as possible)()([.!])$/, "poison", 0]
    ];

    function brand_ev(fam, target, d, p, own, extra)
    {
        var inc = /^you$/i.test(target || "");
        var damage = d ? parseInt(d, 10) : null;
        var ev = { k: inc ? "mon_brand" : "brand", fam: fam,
                   target: inc ? null : target, own: !!own, damage: damage,
                   sev: damage !== null ? sev_of_dmg(damage) : sev_of(p || ".") };
        if (extra) ev.sev = Math.min(3, ev.sev + extra);
        return ev;
    }

    function classify_brand(s)
    {
        var m, i;
        if (s === "You feel better.")
            return { k: "brand", fam: "blood", target: null, vamp: true,
                     own: false, damage: null, sev: 0 };
        if ((m = B_SVO.exec(s)))
        {
            var subj = m[2] ? m[2].toLowerCase() : null;     // null = You
            var tgt = m[4].replace(/'s vigour$/, "");
            var fam = null;
            B_VERB_FAM.forEach(function (v) { if (v[1].test(m[3])) fam = v[0]; });
            if (!fam) return null;
            if (!subj)
                return brand_ev(fam, tgt, m[6], m[7], true, m[5] ? 1 : 0);
            // "The arrow burns the goblin!" (missile/launcher brand)
            if (PROJ_SUBJ.test(subj))
            {
                var pe = brand_ev(fam, tgt, m[6], m[7], true, m[5] ? 1 : 0);
                pe.proj = true;
                return pe;
            }
            // a monster's elemental melee on you ("The X burns you!"); never
            // steal a spell beam line ("The bolt of fire burns you")
            if (/^you$/i.test(tgt) && !spellfx.family_of(subj))
                return brand_ev(fam, tgt, m[6], m[7], false);
            return null;
        }
        for (i = 0; i < B_SIMPLE.length; i++)
        {
            var r = B_SIMPLE[i];
            if (!(m = r[0].exec(s))) continue;
            var f = r[1];
            if (f === "holy" && /convulse/.test(s) && weapon_brand() === "shadow")
                f = "shadow";               // foul flame shares the message
            var big = /horribly/.test(s) ? 1 : 0;
            return brand_ev(f, m[1], m[2], m[3], r[2], big);
        }
        return null;
    }

    // Spell / beam hit (beam.cc): "The <beam name> <verb> <target>[ with X]
    // [ but does no damage][ for N][!]". The beam name has spaces, so try each
    // word as the verb until the words before it are a known spell beam.
    function parse_spell(s)
    {
        var m = /^The (.+?)(?: for (\d+))?(!+|\.)$/.exec(s);
        if (!m) return null;
        var body = m[1], dmg = m[2] ? parseInt(m[2], 10) : null;
        if (/ but (?:do|does) no damage$/.test(body)) return null;
        var w = body.split(" ");
        for (var i = 1; i < w.length - 1; i++)
        {
            if (!/^[a-z]+s?$/.test(w[i])) continue;
            var name = w.slice(0, i).join(" "), fam = spellfx.family_of(name);
            if (!fam) continue;
            var rest = w.slice(i + 1).join(" ").replace(/ with [a-z ]+$/, "");
            if (!/^(?:the |an? |you$|your |[A-Z])/.test(rest)) continue;
            var sv = dmg !== null ? sev_of_dmg(dmg) : sev_of(m[3]);
            if (/^(?:you|your lifeless body)$/.test(rest))
                return { k: "mon_hit", fam: fam, spell: name, verb: w[i],
                         sev: sv, damage: dmg };
            return { k: "hit", fam: fam, spell: name, verb: w[i], target: rest,
                     sev: sv, damage: dmg };
        }
        return null;
    }

    function classify(s)
    {
        var m;
        if ((m = classify_brand(s))) return m;
        if (/^The /.test(s) && (m = parse_spell(s))) return m;
        if ((m = KILL_RE.exec(s))) return { k: "kill", target: m[1] };
        if ((m = MISS_RE.exec(s)))
            return { k: "miss", target: m[2], close: m[1] };
        if (!/^You/.test(s) && (m = MON_MISS_RE.exec(s)))
            return { k: "mon_miss", attacker: m[1], close: m[2] };
        if ((m = PROJ_MISS_RE.exec(s)))
            return { k: /^you$/i.test(m[2]) ? "mon_miss" : "miss",
                     target: m[2], close: m[1], proj: true };
        if ((m = PROJ_HIT_RE.exec(s)) && /hit|pierce|strike|slice/.test(m[1]))
        {
            var pd = dmg_of(s);
            var ps = pd !== null ? sev_of_dmg(pd) : sev_of(m[3]);
            if (/^you$/i.test(m[2]))
                return { k: "mon_hit", verb: m[1], sev: ps, damage: pd };
            return { k: "hit", target: m[2], verb: m[1], sev: ps, damage: pd,
                     proj: true };
        }
        if (/^You /.test(s) && (m = HIT_RE.exec(s)))
        {
            if (!ATK_VERB.test(m[1])) return null;
            var d = dmg_of(s);
            return { k: "hit", target: m[2], verb: m[1], damage: d,
                     sev: d !== null ? sev_of_dmg(d) : sev_of(m[3]) };
        }
        if (!/^(You|Your)\b/.test(s) && (m = MON_HIT_RE.exec(s))
            && ATK_VERB.test(stem(m[2])))
        {
            var md = dmg_of(s);
            return { k: "mon_hit", attacker: m[1], verb: m[2], damage: md,
                     sev: md !== null ? sev_of_dmg(md) : sev_of(m[3]) };
        }
        return null;
    }

    // Action batches ----------------------------------------------------------
    //
    // The attack lines of one player action usually arrive in one "msgs"
    // packet, but missile / beam animations split them: "The slug hits the
    // drude for 11!", then "Lightning courses through the drude!" and "You
    // kill the drude!" a few animation frames later. Lines are collected
    // until none has come for FLUSH_MS (at most BATCH_MAX_MS after the
    // first), then resolved at once:
    //   1. strikes: every hit/miss line opens a strike; brand lines and the
    //      kill line attach to the latest strike on the same name (crawl
    //      prints hit -> brand -> kill per defender before moving on to the
    //      next cleave target, melee-attack.cc do_followup_attacks)
    //   2. each strike is matched to a monster from the pre-action snapshot
    //      (resolve()), using range, damage-pip changes, deaths, facing and
    //      exclusion (one cleave/beam strike per monster)
    //   3. numbers play in message order, STAGGER ms apart, each on its own
    //      tile; repeated numbers on one tile are nudged sideways.

    var FLUSH_MS = 110;
    var BATCH_MAX_MS = 400;
    var STAGGER = 70;
    var batch = null;
    var recent_msg = {};

    // Trace ring (debug): window.sdc_combat_log, newest last
    var LOG_MAX = 80;
    var clog = window.sdc_combat_log = [];
    function trace(o)
    {
        o.t = Math.round(now());
        clog.push(o);
        if (clog.length > LOG_MAX) clog.shift();
    }

    function handle_message(text)
    {
        var parts = String(text || "").split(/(?<=[.!?])\s+/);
        var t = now();
        parts.forEach(function (raw) {
            var part = raw.replace(/^[^A-Za-z]+/, "").trim();
            if (!part) return;
            var c = classify(part);
            if (!c) return;
            trace({ ev: "line", text: part, k: c.k, dmg: c.damage });
            if (recent_msg[part] && t - recent_msg[part] < 60)
            { trace({ ev: "dup", text: part }); return; }
            recent_msg[part] = t;
            if (c.k === "mon_hit" || c.k === "mon_brand") last_hit_msg = t;
            if (!batch)
            {
                var p = player.pos;
                batch = { pre: snap, evs: [],
                          ppos: p ? { x: p.x, y: p.y } : null,
                          ppos0: last_ppos ? { x: last_ppos.x, y: last_ppos.y }
                                           : null,
                          dir: last_dir, t0: t, timer: 0 };
            }
            batch.evs.push(c);
            // debounce: wait for the rest of this action's lines
            if (batch.timer) window.clearTimeout(batch.timer);
            batch.timer = window.setTimeout(flush,
                Math.max(0, Math.min(FLUSH_MS, batch.t0 + BATCH_MAX_MS - t)));
        });
    }

    function build_strikes(evs)
    {
        var out = [], inc = [];
        function last_strike(name, pred)
        {
            for (var i = out.length - 1; i >= 0; i--)
                if ((name === null || name_match(out[i].name, name))
                    && (!pred || pred(out[i])))
                    return out[i];
            return null;
        }
        evs.forEach(function (c) {
            var name = norm_name(c.target), s;
            switch (c.k)
            {
            case "hit":
            case "miss":
                s = { k: c.k, name: name, damage: c.damage === undefined
                                                  ? null : c.damage,
                      sev: c.sev || 0, verb: c.verb, close: c.close,
                      fam: c.fam || null, spell: c.spell || null,
                      kind: c.fam ? "spell" : c.proj ? "proj" : "melee",
                      brands: [], kill: false };
                s.aux = s.kind === "melee" && AUX_VERB.test(c.verb || "");
                out.push(s);
                break;
            case "kill":
                s = last_strike(name, function (x) { return !x.kill; });
                if (s) s.kill = true;
                else
                    // the hit (and its number) went out in an earlier batch:
                    // only the kill pop, never the same number twice
                    out.push({ k: "hit", name: name, kill: true, kind: "kill",
                               damage: null, sev: 0, brands: [] });
                break;
            case "brand":
                if (c.vamp)
                {
                    // "You feel better." only counts on a vampiric weapon
                    if (weapon_brand() !== "blood") break;
                    s = last_strike(null, function (x) {
                        return x.kind === "melee" && x.k === "hit"; });
                }
                else
                    s = last_strike(name, function (x) { return x.k === "hit"; });
                if (s) s.brands.push(c);
                else if (c.own && !c.vamp)
                    out.push({ k: "hit", name: name, brand_only: true,
                               kind: c.proj ? "proj" : "melee",
                               damage: null, sev: c.sev, brands: [c],
                               kill: false });
                break;
            case "mon_hit":
            case "mon_miss":
                inc.push({ c: c, brands: [], order: out.length + inc.length });
                break;
            case "mon_brand":
                for (var i = inc.length - 1; i >= 0; i--)
                    if (inc[i].c.k === "mon_hit") { inc[i].brands.push(c); return; }
                if (c.own)
                    inc.push({ c: { k: "mon_hit", sev: c.sev, damage: null },
                               brands: [c], order: out.length + inc.length });
                break;
            }
        });
        return { out: out, inc: inc };
    }

    // candidates: pre-action monsters (+ ones that appeared since), with their
    // position at attack time (px, py), where they are now (x, y), pip change
    // and whether they vanished
    function candidates(pre, post)
    {
        var by_id = {}, at = {}, seen = {}, out = [];
        post.forEach(function (q) {
            if (q.id) by_id[q.id] = q;
            at[q.x + "," + q.y] = q;
        });
        pre.forEach(function (p) {
            var q = p.id ? by_id[p.id] : at[p.x + "," + p.y];
            if (q && !p.id && q.name !== p.name) q = null;
            if (p.id) seen[p.id] = true;
            out.push({ key: p.id ? "i" + p.id : "p" + p.x + "," + p.y,
                       name: p.name, px: p.x, py: p.y,
                       x: q ? q.x : p.x, y: q ? q.y : p.y,
                       dmg0: p.dmg, dmg1: q ? q.dmg : null, gone: !q,
                       pet: p.pet });
        });
        post.forEach(function (q) {
            if (q.id && seen[q.id]) return;
            if (!q.id && pre.some(function (p) {
                return !p.id && p.x === q.x && p.y === q.y; })) return;
            out.push({ key: q.id ? "i" + q.id : "p" + q.x + "," + q.y,
                       name: q.name, px: q.x, py: q.y, x: q.x, y: q.y,
                       dmg0: null, dmg1: q.dmg, gone: false, pet: q.pet,
                       fresh: true });
        });
        return out;
    }

    // Score of strike s landing on candidate c (null = impossible).
    function score(s, c, ctx)
    {
        var nm = name_match(c.name, s.name);
        if (!nm) return null;
        var pp = ctx.ppos, sc = nm === 2 ? 0 : -4;
        if (!pp) return sc;
        var cp = { x: c.px, y: c.py };
        if (cp.x === pp.x && cp.y === pp.y) return null;
        var d = cheb(cp, pp);
        if (ctx.ppos0 && (ctx.ppos0.x !== pp.x || ctx.ppos0.y !== pp.y))
            d = Math.min(d, cheb(cp, ctx.ppos0));   // lunges / moved this turn
        var melee = s.kind === "melee";
        if (melee)
        {
            if (d > 2) return null;
            sc -= d * 0.5 + (d > ctx.reach ? 4 : 0);
            if (ctx.dir && c.px === pp.x + ctx.dir.x && c.py === pp.y + ctx.dir.y)
                sc += 1;
            if (c.pet) sc -= 5;              // should_cleave_into skips allies
        }
        else
            sc -= d * 0.05;
        var hurt = c.dmg0 !== null && c.dmg1 !== null && c.dmg1 > c.dmg0;
        if (s.k === "hit")
        {
            // bigger hits go to bigger pip jumps (cleave: 9 and 4 damage on
            // goblins whose pips moved by 2 and 1)
            if (hurt)
                sc += 5 + (c.dmg1 - c.dmg0)
                          * (s.damage ? Math.min(1, s.damage / 10) : 0.5);
            if (s.kill) sc += c.gone ? 10 : -8;
            else if (c.gone) sc += 1;
        }
        else
        {
            if (c.gone) sc -= 2;
            else if (!hurt) sc += 0.5;
        }
        var u = ctx.used[c.key];
        if (u)
        {
            if (u.killed) sc -= 50;
            else if (ctx.excl && u.groups[s.group]) sc -= 30;
            else if (!ctx.excl && s.group === "melee" && u.groups.melee
                     && nm === 2)
                sc += 3;
        }
        if (c.fresh) sc -= 0.5;
        return sc;
    }

    function resolve(strikes, b, post)
    {
        var cands = candidates(b.pre || [], post);
        var cleave = weapon_cleaves();
        var ctx = { ppos: b.ppos || player.pos, ppos0: b.ppos0, dir: b.dir,
                    reach: weapon_reaches() ? 2 : 1, used: {} };
        var groups = [], gmap = {};
        strikes.forEach(function (s) {
            // penetrating missiles hit a line of monsters (one strike each);
            // plain ones stop at their target, and a coglin's two launchers
            // usually both hit the same one
            s.group = s.kind === "spell" ? "spell:" + s.spell
                      : s.kind === "proj" && /^pierce/.test(s.verb || "")
                        ? "proj_pierce" : s.kind;
            if (!gmap[s.group]) { gmap[s.group] = []; groups.push(s.group); }
            gmap[s.group].push(s);
        });
        function assign(s, c)
        {
            s.cand = c;
            var u = ctx.used[c.key] || (ctx.used[c.key] = { groups: {} });
            u.groups[s.group] = true;
            if (s.kill) u.killed = true;
        }
        groups.forEach(function (g) {
            var list = gmap[g];
            ctx.excl = g === "melee" ? cleave : g !== "proj";
            if (!ctx.excl)
            {
                // one target per action (plus evidence for odd multi-target
                // moves); aux attacks always follow the first melee strike
                var first = null;
                list.forEach(function (s) {
                    if (s.aux && first && name_match(first.name, s.name))
                    { assign(s, first); return; }
                    var best = null, bs = -1e9;
                    cands.forEach(function (c) {
                        var v = score(s, c, ctx);
                        if (v !== null && v > bs) { bs = v; best = c; }
                    });
                    if (best) { assign(s, best); if (!first) first = best; }
                });
                return;
            }
            // exclusive group (cleave / beam / missiles): best pair first
            var aux = list.filter(function (s) { return s.aux; });
            var open = list.filter(function (s) { return !s.aux; });
            while (open.length)
            {
                var bi = -1, bc = null, bv = -1e9;
                open.forEach(function (s, i) {
                    cands.forEach(function (c) {
                        var v = score(s, c, ctx);
                        // ties: earlier message first
                        if (v !== null && (v > bv + 1e-6)) { bv = v; bi = i; bc = c; }
                    });
                });
                if (bi < 0) break;
                assign(open[bi], bc);
                open.splice(bi, 1);
            }
            var prim = list.filter(function (s) { return !s.aux && s.cand; })[0];
            aux.forEach(function (s) {
                if (prim && name_match(prim.name, s.name)) assign(s, prim.cand);
            });
        });
    }

    function flush()
    {
        var b = batch;
        batch = null;
        if (!b || !b.evs.length) return;
        var t = now();
        var st = build_strikes(b.evs);
        resolve(st.out, b, scan_mons());
        var order = 0;
        var all = st.out.map(function (s, i) { return { s: s, i: i }; });
        all.forEach(function (o) {
            var s = o.s;
            var pos = s.cand ? { x: s.cand.x, y: s.cand.y } : locate(s.name);
            trace({ ev: "strike", name: s.name, k: s.k, kill: s.kill,
                    dmg: s.damage, cand: !!s.cand, pos: pos });
            if (!pos) return;
            var bdmg = null, bfam = null, bsev = 0;
            s.brands.forEach(function (br) {
                if (br.damage) bdmg = (bdmg || 0) + br.damage;
                bfam = br.fam;
                bsev = Math.max(bsev, br.sev || 0);
            });
            var dmg = s.damage;
            if (bdmg !== null) dmg = (dmg || 0) + bdmg;
            var ev = { dir: "out", result: s.kill ? "kill" : s.k, damage: dmg,
                       sev: dmg !== null ? sev_of_dmg(dmg)
                            : Math.max(s.sev || 0, bsev),
                       verb: s.verb, target: s.name, close: s.close,
                       fam: s.fam || bfam, spell: s.spell,
                       brand: !s.fam && !!bfam };
            show_fx(ev, pos, Math.min(order, 8) * STAGGER, null,
                    { batched: true });
            order++;
        });
        st.inc.forEach(function (o) {
            var c = o.c;
            if (!player.pos) return;
            var bfam = null, bdmg = null;
            o.brands.forEach(function (br) {
                bfam = br.fam;
                if (br.damage) bdmg = (bdmg || 0) + br.damage;
            });
            var dmg = c.damage === undefined ? null : c.damage;
            if (bdmg !== null) dmg = (dmg || 0) + bdmg;
            var ev = { dir: "in", result: c.k === "mon_hit" ? "hit" : "miss",
                       damage: dmg, sev: c.sev || 0, verb: c.verb,
                       target: c.attacker, close: c.close,
                       fam: c.fam || bfam, spell: c.spell,
                       brand: !c.fam && !!bfam };
            show_fx(ev, { x: player.pos.x, y: player.pos.y },
                    Math.min(order, 8) * STAGGER, null, { batched: true });
            order++;
        });
    }


    // new message-log text, shared with the other modules (fxkit)
    kit.on_message(handle_message);

    // Hurt events -------------------------------------------------------------

    api.on("hurt", function (h) {
        if (now() - init_time < MSG_GRACE) return;
        var t0 = now();
        // the attack message may land just after the HP update
        window.setTimeout(function () {
            var src = h.source;
            if (src === "poison" && last_hit_msg > t0 - 800) src = "hit";
            if (src === "unknown") src = "hit";
            blood(h.ratio, src);
        }, 130);
    });

    // Frame hook: last move direction + monster snapshot ---------------------

    api.on("frame", function () {
        var p = player.pos;
        if (p && typeof p.x === "number")
        {
            if (last_ppos && (p.x !== last_ppos.x || p.y !== last_ppos.y)
                && cheb(p, last_ppos) === 1)
                last_dir = { x: p.x - last_ppos.x, y: p.y - last_ppos.y };
            last_ppos = { x: p.x, y: p.y };
        }
        // every frame (~600 cells, cheap): the snapshot frozen by the next
        // action batch must predate that action's map update
        snap = scan_mons();
    });

    // Lifecycle ---------------------------------------------------------------

    function reset()
    {
        if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
        layer = null;
        words = 0;
        tile_live = {};
        blood_els = 0;
    }

    api.on("game_init", function () {
        reset();
        ensure_layer();
        init_time = now();
        last_dir = null;
        last_ppos = null;
        snap = [];
        batch = null;
    });

    api.on("game_cleanup", function () {
        reset();
    });

    // Debug -------------------------------------------------------------------

    // kind: hit | heavy | kill | miss | hurt | hurt_heavy | in_hit | in_miss
    //       | num_hit | num_heavy | num_miss  (num_* force numbers mode)
    window.sdc_combat_test = function (kind)
    {
        var p = player.pos;
        if (!p) return;
        var up = { x: p.x, y: p.y - 1 }, me = { x: p.x, y: p.y };
        var ev = { dir: "out", result: "hit", damage: 5, sev: 0,
                   verb: "slash" };
        var mode = null, pos = up, group = "OUT gold (target tile, pops up)";
        var omiss = "OUT miss ice-blue hollow (target tile, slides away)";
        if (/^brand_/.test(kind))
        {
            // brand_<family>: a branded weapon hit of that element
            ev.fam = kind.split("_")[1];
            ev.brand = true;
            ev.damage = 11; ev.sev = 1;
            console.log("sdc_combat_test " + kind + ": weapon brand " + ev.fam);
            show_fx(ev, pos, 0, "numbers");
            return;
        }
        if (/^spell_/.test(kind))
        {
            // spell_<family>[_in]: one spell number of that element
            var parts = kind.split("_");
            ev.fam = parts[1];
            ev.spell = { lava: "bolt of magma", cold: "shard of ice",
                         fire: "fireball" }[ev.fam] || "";
            ev.damage = 23; ev.sev = 2; ev.verb = "hits";
            if (parts[2] === "in") { ev.dir = "in"; pos = me; }
            console.log("sdc_combat_test " + kind + ": spell " + ev.fam);
            show_fx(ev, pos, 0, "numbers");
            return;
        }
        switch (kind)
        {
        case "heavy": ev.sev = 3; ev.damage = 41; ev.verb = "smash"; break;
        case "kill": ev.result = "kill"; ev.sev = 2; ev.damage = 20;
            group = "OUT white-hot kill (target tile)"; break;
        case "miss": ev.result = "miss"; ev.damage = null; ev.close = "closely";
            group = omiss; break;
        case "num_hit": mode = "numbers"; ev.damage = 9; ev.sev = 1; break;
        case "num_heavy": mode = "numbers"; ev.damage = 41; ev.sev = 3; break;
        case "num_miss": mode = "numbers"; ev.result = "miss";
            ev.damage = null; ev.close = "completely"; group = omiss; break;
        case "in_hit": ev.dir = "in"; ev.damage = 8; ev.sev = 1; pos = me;
            group = "IN crimson (your tile, drops down)"; break;
        case "in_miss": ev.dir = "in"; ev.result = "miss"; ev.damage = null;
            ev.close = "barely"; pos = me;
            group = "IN miss green-grey hollow (your tile, slides back)";
            break;
        case "hurt": blood(0.12, "hit");
            console.log("sdc_combat_test hurt: blood (IN crimson group)");
            return;
        case "hurt_heavy": blood(0.55, "hit");
            console.log("sdc_combat_test hurt_heavy: blood (IN crimson group)");
            return;
        default: kind = "hit";
        }
        console.log("sdc_combat_test " + kind + ": " + group);
        show_fx(ev, pos, 0, mode);
    };

    // plays every spell family in turn on the tile above you, 1.4 s apart
    window.sdc_spell_test_all = function ()
    {
        spellfx.families.forEach(function (f, i) {
            window.setTimeout(function () {
                window.sdc_combat_test("spell_" + f);
            }, i * 1400);
        });
    };

    // feed a raw game message through the classifier (debug)
    window.sdc_combat_msg = function (text) { handle_message(text); };

    return {};
});
