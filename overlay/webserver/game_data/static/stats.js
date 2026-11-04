// Bottom-right stats card. Styles live in stats.css.
//
// The card is always the compact "strip" layout: render($card, player, h)
// where $card is the emptied #sdc_stats element (its data-skin attribute
// is "strip", for CSS) and `h` holds helpers:
//   h.copy(id)  jQuery clone of a stock #stats element without ids, keeping
//               the colour classes player.js put on it (stats_ac, stats_str,
//               stats_weapon, stats_quiver, stats_doom, ...)
//   h.text(id)  trimmed text of a stock #stats element
//   h.noise()   {level: "quiet"|"loud"|"veryloud"|"superloud"|"blank",
//                pct: 0..100}
//
// The card is rebuilt from scratch on every player update, so value-change
// effects (flashes, arrows, bar growth) are driven by a module-level change
// log: each tracked value remembers when it last changed, and freshly built
// elements resume their CSS animation with a negative animation-delay.
define(["jquery", "./sdc_api"], function ($, api) {
    "use strict";

    // true = turn count (kept as the old "On" value), "speed" = game time the
    // last action took
    api.register_option({ key: "turn_counter", label: "Turn counter",
                          default: false,
                          choices: [[true, "Turns"], ["speed", "Speed"],
                                    [false, "Off"]] });

    // last action's game time ---------------------------------------------
    // player.time is in aut (10 = one normal-speed turn). The card renders
    // on a debounced HUD update that can span several player messages (key
    // repeat, travel), so the per-message player.time_delta that stock
    // player.js computes is used; the render-to-render difference is only a
    // fallback. A jump of more than MAX_ACTION_AUT is a multi-action update
    // (rest, travel, explore: the server holds back time while running),
    // not one move, so it keeps the previous reading -- except a multi-turn
    // action (putting on / taking off armour, memorising, ...): the server
    // does not redraw during the delay either, so it also arrives as one
    // jump, but it ends with a "You finish ..." message. The player update
    // and its messages arrive together, in either order on our side, so a
    // long jump and a "You finish" line within PAIR_MS of each other count.

    var MAX_ACTION_AUT = 30;
    var PAIR_MS = 600;
    var speed_prev_time = null;
    var speed_last = null;       // aut the last single action took
    var long_jump = null;        // {aut, t}: a long jump awaiting its message
    var finish_t = -Infinity;    // when the last "You finish ..." arrived

    function track_speed(player)
    {
        var t = player.time;
        if (typeof t !== "number" || !isFinite(t))
            return;
        if (speed_prev_time == null || t < speed_prev_time)
        {
            speed_last = null;   // first update, or a new game
            long_jump = null;
        }
        else if (t > speed_prev_time)
        {
            var d = player.time_delta;
            if (typeof d !== "number" || !(d > 0) || d > t - speed_prev_time)
                d = t - speed_prev_time;
            long_jump = null;
            if (d <= MAX_ACTION_AUT || Date.now() - finish_t < PAIR_MS)
                speed_last = d;
            else
                long_jump = { aut: d, t: Date.now() };
        }
        speed_prev_time = t;
    }

    // a "You finish ..." line after its (already rendered) long jump: take
    // the jump and redraw just the chip; mobile.js mirrors it on
    // "stats_counter"
    api.on("message", function (text) {
        if (!/^You finish /.test(text))
            return;
        finish_t = Date.now();
        if (!long_jump || finish_t - long_jump.t >= PAIR_MS)
            return;
        speed_last = long_jump.aut;
        long_jump = null;
        if (api.get("turn_counter") !== "speed")
            return;
        $("#sdc_stats .st-speed").replaceWith(speed_chip());
        api.emit("stats_counter");
    });

    function speed_chip()
    {
        var $el = $("<span class='st-speed'>").append(icon("speed"));
        if (speed_last == null)
            return $el.attr("data-rate", "none")
                .attr("title", "Last action: -").append("-");
        var turns = speed_last / 10;
        var rate = speed_last < 10 ? "fast" : speed_last === 10 ? "normal"
                 : speed_last < 15 ? "slow" : "vslow";
        return $el.attr("data-rate", rate)
            .attr("title", "Last action: " + turns.toFixed(1) + " turns ("
                  + speed_last + " aut)")
            .append(turns.toFixed(1));
    }

    // value-change tracking ---------------------------------------------------

    var FLASH_MS = 900;     // matches the flash keyframes in stats.css
    var TRACKED = ["xl", "progress", "ac", "ev", "sh", "str", "int", "dex",
                   "doom", "contam", "where"];
    var BAD_WHEN_UP = { doom: true, contam: true };
    var last_values = null;
    var last_who = null;
    var changes = {};       // key -> {dir: "up"|"down"|"new", t, from}

    function tracked_value(player, k)
    {
        if (k === "where")
            return player.place ? player.place + ":" + player.depth : null;
        return player[k];
    }

    function track(player)
    {
        var now = Date.now();
        // new character (or a new game: turn count went backwards)
        var who = String(player.name);
        if (who !== last_who
            || (last_values && num(player.turn) < num(last_values.turn)))
        {
            last_who = who;
            last_values = null;
            changes = {};
        }
        if (last_values)
        {
            TRACKED.forEach(function (k) {
                var a = last_values[k], b = tracked_value(player, k);
                if (a === b || a == null || b == null) return;
                var dir = "new";
                if (typeof a === "number" && typeof b === "number")
                    dir = b > a ? "up" : "down";
                changes[k] = { dir: dir, t: now, from: a };
            });
        }
        last_values = { turn: player.turn };
        TRACKED.forEach(function (k) {
            last_values[k] = tracked_value(player, k);
        });
    }

    // the change of `key` if it happened less than `ms` ago
    function recent(key, ms)
    {
        var c = changes[key];
        if (!c) return null;
        var age = Date.now() - c.t;
        if (age >= (ms || FLASH_MS)) return null;
        return { dir: c.dir, age: age, from: c.from };
    }

    function mood(key, dir)
    {
        if (dir === "new") return "new";
        var good = dir === "up";
        if (BAD_WHEN_UP[key]) good = !good;
        return good ? "good" : "bad";
    }

    // webtiles ships jQuery 1.8, whose .css() knows neither custom
    // properties nor SVG classes, so set inline styles directly
    function set_style($el, prop, value)
    {
        $el.each(function () { this.style.setProperty(prop, value); });
        return $el;
    }

    function resume($el, age)
    {
        return set_style($el, "animation-delay", -Math.round(age) + "ms");
    }

    // flatten a list of jQuery objects (nulls skipped) into one collection;
    // jQuery 1.8 .append() can't take arrays of jQuery objects
    function collect(list)
    {
        return $($.map(list, function (x) { return x ? x.get() : null; }));
    }

    // Adds a pop/flash to $el if `key` changed recently.
    function flash($el, key)
    {
        var c = recent(key);
        if (!c) return $el;
        return resume($el.addClass("sdc-fx sdc-" + mood(key, c.dir)), c.age);
    }

    // A floating up/down arrow marker for a recent change of `key` (or null).
    function arrow(key)
    {
        var c = recent(key);
        if (!c || c.dir === "new") return null;
        return resume($("<span class='sdc-delta'>")
            .addClass("sdc-" + mood(key, c.dir))
            .text(c.dir === "up" ? "▲" : "▼"), c.age);
    }

    // XP animation: {from: previous %, age} (from 0 after a level up) or null
    function xp_change()
    {
        var lv = recent("xl");
        if (lv && lv.dir === "up") return { from: 0, age: lv.age };
        var c = recent("progress");
        if (c && typeof c.from === "number")
            return { from: clamp(c.from, 0, 100), age: c.age };
        return null;
    }

    // Animates a freshly built XP bar fill from its previous percentage.
    function grow_xp($fill)
    {
        var c = xp_change();
        if (!c) return $fill;
        set_style($fill.addClass("sdc-grow"), "--sdc-from", c.from + "%");
        return resume($fill, c.age);
    }

    // small helpers -----------------------------------------------------------

    function num(v)
    {
        return typeof v === "number" && isFinite(v) ? v : 0;
    }

    function clamp(v, lo, hi)
    {
        return Math.max(lo, Math.min(hi, v));
    }

    function show(v)
    {
        return v == null || v === "" ? "-" : String(v);
    }

    function place(player, h)
    {
        var p = h.text("stats_place");
        if (p) return p;
        if (!player.place) return "";
        return player.place + (player.depth ? ":" + player.depth : "");
    }

    // colour classes player.js put on a stock element (and its inner span)
    function stock_class(h, id)
    {
        var c = h.copy(id);
        return ((c.attr("class") || "") + " "
                + (c.children("span").first().attr("class") || "")).trim();
    }

    // value of str/int/dex with its stock colour, "/max" when drained
    function stat_value(player, h, key)
    {
        var v = $("<span class='sdc-num'>").addClass(stock_class(h, "stats_" + key))
            .text(show(player[key]));
        var max = player[key + "_max"];
        if (typeof max === "number" && typeof player[key] === "number"
            && player[key] < max)
        {
            v.append($("<small class='sdc-max'>").text("/" + max));
        }
        return v;
    }

    function def_value(player, h, key)
    {
        return $("<span class='sdc-num'>").addClass(stock_class(h, "stats_" + key))
            .text(show(player[key]));
    }

    // 16x16 outline icons, stroked in currentColor (stroke styles in CSS)
    var ICON_PATHS = {
        // cuirass: shoulders, neck scoop, arm holes, tapered waist,
        // centre ridge and pectoral line
        ac: "<path d='M3 2.5H6Q8 4.8 10 2.5H13L13.6 5.6Q11.5 6.4 11.5 8.6"
            + "L12 13Q8 14.8 4 13L4.5 8.6Q4.5 6.4 2.4 5.6Z'/>"
            + "<path d='M8 5.6V13.6M5.2 8.8Q8 10.2 10.8 8.8'/>",
        // stick figure sprinting with a forward lean + motion lines
        ev: "<circle cx='11' cy='2.6' r='1.5'/>"
            + "<path d='M10 5 7.5 9.2M5.5 6.6 7.2 4.6 10 5 12 7 14.2 6.2"
            + "M9.6 14.4 10.2 10.8 7.5 9.2 5.6 11.6 2.2 11.8'/>"
            + "<path class='sdc-ico-faint' d='M1 4H3.4M.8 8.2H3'/>",
        // heater shield, quartered
        sh: "<path d='M2.5 2.5H13.5V7Q13.5 12 8 14.7Q2.5 12 2.5 7Z'/>"
            + "<path class='sdc-ico-faint' d='M8 2.5V14.6M2.5 7H13.5'/>",
        // flexed arm: bicep bulge, raised forearm, fist
        str: "<path d='M1.5 9Q6.5 3.4 10 9.4L9.4 5.6Q8.8 2.1 11.3 2"
             + "Q13.7 2 13.4 4.6L13.8 10.6Q14 13.5 11 13.5H1.5'/>"
             + "<path class='sdc-ico-faint' d='M9.6 4.4H12.2'/>",
        // bare footprint: sole with arch + five toes
        dex: "<path d='M6.8 6.2C9.5 5.6 12.2 6.6 12 9C11.8 10.8 11 11.8 10.8 13.2"
             + "C10.6 14.8 9.4 15.4 8.2 15.3C6.9 15.2 6.3 14.1 6.6 12.8"
             + "C6.9 11.5 6.2 10.6 5.3 9.4C4.4 8 5 6.6 6.8 6.2Z'/>"
             + "<circle cx='5.4' cy='3.4' r='1.3'/><circle cx='8.2' cy='2.5' r='.9'/>"
             + "<circle cx='10.5' cy='2.9' r='.8'/><circle cx='12.3' cy='4' r='.7'/>"
             + "<circle cx='13.6' cy='5.6' r='.6'/>",
        // brain from above: two lobed hemispheres, fissure, folds
        int: "<path d='M8 2.5C6.5 1.5 4 2 3.6 3.8C2 4.2 1.5 6 2.3 7.2"
             + "C1.4 8.6 2 10.6 3.6 11C3.8 12.8 6 13.8 8 13"
             + "C10 13.8 12.2 12.8 12.4 11C14 10.6 14.6 8.6 13.7 7.2"
             + "C14.5 6 14 4.2 12.4 3.8C12 2 9.5 1.5 8 2.5Z'/>"
             + "<path d='M8 2.5V13'/>"
             + "<path class='sdc-ico-faint' d='M5.2 5.6C6.4 5.6 6.6 7 5.5 7.6"
             + "M3.8 9.2C5 8.8 6.1 9.6 6 10.8M10.8 5.6C9.6 5.6 9.4 7 10.5 7.6"
             + "M12.2 9.2C11 8.8 9.9 9.6 10 10.8'/>",
        // stopwatch: dial, crown button, hand
        speed: "<circle cx='8' cy='9.2' r='5.3'/>"
               + "<path d='M6.4 1.6H9.6M8 1.6V3.9M8 9.2 10.2 6.6'/>"
               + "<path class='sdc-ico-faint' d='M12.4 3.6 13.6 4.8'/>",
    };

    function icon(name)
    {
        return $("<svg class='sdc-ico' viewBox='0 0 16 16' aria-hidden='true'>"
                 + (ICON_PATHS[name] || "") + "</svg>")
            .attr("data-ico", name);
    }

    // doom / contam tags (only when non-zero)
    function hazard_tags(player, h, cls)
    {
        var out = [];
        if (num(player.doom) > 0)
            out.push(flash($("<span>").addClass(cls).attr("title", "Doom")
                .append("DOOM ", h.copy("stats_doom").contents()), "doom"));
        if (num(player.contam) > 0)
            out.push(flash($("<span>").addClass(cls)
                .attr("title", "Magical contamination")
                .append("CONTAM ", h.copy("stats_contam").contents()), "contam"));
        return collect(out);
    }

    // noise as `n` pips/segments
    function noise_pips(noise, n, cls)
    {
        var $m = $("<span>").addClass(cls).attr("data-level", noise.level);
        var lit = noise.level === "blank" ? 0 : Math.ceil(noise.pct * n / 100 - 0.001);
        for (var i = 0; i < n; ++i)
            $m.append($("<i>").toggleClass("on", i < lit));
        return $m;
    }

    // strip: two compact lines -- XL/place/noise, then icon + number pairs ----

    var STRIP_TITLES = {
        ac: "Armour Class", ev: "Evasion", sh: "Shield",
        str: "Strength", int: "Intelligence", dex: "Dexterity",
    };

    function strip($card, player, h)
    {
        var xp = clamp(num(player.progress), 0, 100);
        var $fill = grow_xp($("<span class='st-xp-fill'>").css("width", xp + "%"));
        var noise = h.noise();

        var chip = function (key, value) {
            return flash($("<span class='st-chip'>").attr("data-k", key), key)
                .attr("title", STRIP_TITLES[key])
                .append(icon(key), value, arrow(key));
        };

        $card.append($("<div class='st-row st-info'>").append(
            flash($("<span class='st-xl'>"), "xl")
                .attr("title", "Experience level " + show(player.xl)
                      + " (" + xp + "% to next)")
                .append($("<span class='st-k'>").text("XL"),
                        $("<b>").text(show(player.xl)),
                        $("<span class='st-xp'>").append($fill)),
            flash($("<span class='st-place'>"), "where")
                .text(place(player, h)),
            $("<span class='st-noise'>").attr("data-level", noise.level)
                .attr("title", noise.level === "blank" ? "Silenced" : "Noise")
                .append(noise_pips(noise, 5, "st-pips")),
            api.get("turn_counter") === "speed" ? speed_chip()
            : api.get("turn_counter")
                ? $("<span class='st-turns'>").attr("title", "Turn")
                    .text("T" + show(player.turn))
                : null,
            hazard_tags(player, h, "st-tag")));

        $card.append($("<div class='st-row st-nums'>").append(
            chip("ac", def_value(player, h, "ac")),
            chip("ev", def_value(player, h, "ev")),
            chip("sh", def_value(player, h, "sh")),
            $("<span class='st-sep'>"),
            chip("str", stat_value(player, h, "str")),
            chip("int", stat_value(player, h, "int")),
            chip("dex", stat_value(player, h, "dex"))));
    }

    function render($card, player, h)
    {
        try
        {
            track(player);
            track_speed(player);
        }
        catch (e)
        {
            changes = {};
        }
        $card.attr("data-skin", "strip");
        try
        {
            strip($card, player, h);
        }
        catch (e)
        {
            console.error("sdc: stats strip failed", e);
            $card.empty();
        }
    }

    return {
        render: render,
    };
});
