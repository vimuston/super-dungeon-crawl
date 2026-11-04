// HP/MP vitals: slim glowing bars in the #sdc_vitals panel, and where that
// panel sits. Styles live in bars.css.
//
// Contract with crt.js:
//   build()        -> HTML string inserted into #sdc_vitals under the name
//   update(player) -> called on every HUD update; returns hp/hp_max (0..1)
//
// Each bar is a stack of absolutely positioned layers inside .sdc-track:
//   fill    current safe value
//   poison  HP that the current poison will still eat (HP only)
//   cap     max reduced below its real value (drain etc.), hatched end cap
//
// The status badges, the HP/MP panel and the stats card are always one
// merged unit (#sdc_corner); HP/MP sit at the top of the card.
//
// Options:
//   "hud_pos"  top-left / bottom-left / top-center / bottom-center /
//              bottom-right. Put on <body data-sdc-hud-pos>;
//              bars.css anchors #sdc_corner from it (top positions
//              stack HP bars, card, then badges; bottom ones badges on top).
//              The unit's height is published as --sdc-corner-h on <body>
//              so the quick-use bar can sit above it (bottom-center) or below
//              it (top-left).
define(["jquery", "./sdc_api"], function ($, api) {
    "use strict";

    var POSITIONS = [["top-left", "Top left"], ["bottom-left", "Bottom left"],
                     ["top-center", "Top centre"],
                     ["bottom-center", "Bottom centre"],
                     ["bottom-right", "Bottom right"]];

    api.register_option({
        key: "hud_pos",
        label: "Stats & HP position",
        default: "top-left",
        choices: POSITIONS,
    });

    function position()
    {
        var v = api.get("hud_pos");
        var ok = POSITIONS.some(function (c) { return c[0] === v; });
        return ok ? v : "top-left";
    }

    // Placement ----------------------------------------------------------------

    var resize_observer = null;

    // As wide as the stats card (skins differ in width).
    function sync_width()
    {
        var vitals = document.getElementById("sdc_vitals");
        if (!vitals) return;
        var stats = document.getElementById("sdc_stats");
        var w = stats ? stats.offsetWidth : 0;
        if (w > 0)
        {
            var px = Math.max(w, 200) + "px";
            if (vitals.style.width !== px)
                vitals.style.width = px;
            vitals.classList.add("sdc-merged");
        }
        else
        {
            vitals.style.width = "";
            vitals.classList.remove("sdc-merged");
        }
    }

    function sync_height()
    {
        var corner = document.getElementById("sdc_corner");
        var h = corner ? corner.offsetHeight : 0;
        if (document.body)
            document.body.style.setProperty("--sdc-corner-h", h + "px");
    }

    function sync()
    {
        sync_width();
        sync_height();
    }

    function place()
    {
        document.body.setAttribute("data-sdc-hud-pos", position());

        var vitals = document.getElementById("sdc_vitals");
        var corner = document.getElementById("sdc_corner");
        var stats = document.getElementById("sdc_stats");
        if (vitals && corner && stats && stats.parentNode === corner
            && vitals.nextSibling !== stats)
            corner.insertBefore(vitals, stats);

        if (window.ResizeObserver)
        {
            if (!resize_observer)
                resize_observer = new window.ResizeObserver(sync);
            resize_observer.disconnect();
            [stats, corner].forEach(function (n) {
                if (n) resize_observer.observe(n);
            });
        }
        sync();
    }

    api.on("game_init", place);
    api.on("game_cleanup", function () {
        if (resize_observer)
            resize_observer.disconnect();
    });
    api.on("hud_update", sync);
    api.on("setting", function (key) {
        if (key === "hud_pos")
            place();
        else if (key === "stats_skin")
            window.requestAnimationFrame(sync);
    });
    if (document.body)
        document.body.setAttribute("data-sdc-hud-pos", position());

    // Markup -------------------------------------------------------------------

    // Last drawn state per bar ("hp"/"mp"), reset whenever the HUD is rebuilt.
    var state = {};

    function bar(key, label)
    {
        return '<div class="sdc-bar sdc-' + key + '">'
            + '<span class="sdc-lbl">' + label + '</span>'
            + '<span class="sdc-track">'
            + '<span class="sdc-fill"></span>'
            + '<span class="sdc-poison"></span>'
            + '<span class="sdc-cap"></span>'
            + '</span>'
            + '<span class="sdc-val"><span class="sdc-cur"></span>'
            + '<span class="sdc-sep">/</span><span class="sdc-max"></span>'
            + '<span class="sdc-real"></span></span>'
            + '</div>';
    }

    function build()
    {
        state = {};
        return '<div class="sdc-bars">'
            + bar("hp", "HP") + bar("mp", "MP")
            + '</div>';
    }

    // Drawing ------------------------------------------------------------------

    function num(x)
    {
        x = Number(x);
        return isFinite(x) ? Math.round(x) : 0;
    }

    function pct(x, total)
    {
        return (100 * Math.max(0, x) / total).toFixed(3) + "%";
    }

    // Apply css without transitions (initial draw, rescaled max).
    function snap($el, css)
    {
        if (!$el.length) return;
        $el.addClass("sdc-snap").css(css);
        void $el[0].offsetWidth;
        $el.removeClass("sdc-snap");
    }

    // value/max: current and (possibly reduced) maximum; real_max: unreduced
    // maximum; poison_left: what value will be once the poison runs out.
    function set_bar(key, value, max, real_max, poison_left, classes)
    {
        max = Math.max(1, max);
        value = Math.max(0, Math.min(value, max));
        var total = Math.max(max, real_max || 0);
        var safe = value;
        if (poison_left !== undefined && poison_left < value)
            safe = Math.max(0, poison_left);

        var sig = [value, max, total, safe, classes].join(",");
        var prev = state[key];
        if (prev && prev.sig === sig)
            return value / max;

        var $bar = $("#sdc_vitals .sdc-" + key);
        var $fill = $bar.find(".sdc-fill");
        var $poison = $bar.find(".sdc-poison");
        var fill_css = { width: pct(safe, total) };
        var poison_css = { left: pct(safe, total),
                           width: pct(value - safe, total) };

        if (!prev || prev.total !== total)
        {
            // first draw or rescaled: no animation
            snap($fill, fill_css);
            snap($poison, poison_css);
        }
        else
        {
            $fill.css(fill_css);
            $poison.css(poison_css);
        }

        $bar.find(".sdc-cap").css({
            left: pct(max, total),
            width: pct(total - max, total),
        });
        $bar.find(".sdc-cur").text(value);
        $bar.find(".sdc-max").text(max);
        $bar.find(".sdc-real").text(total > max ? "(" + total + ")" : "");
        $bar.attr("class", "sdc-bar sdc-" + key
                  + (classes ? " " + classes : ""));

        state[key] = { sig: sig, value: value, total: total };
        return value / max;
    }

    function update(player)
    {
        try
        {
            // crt.js may have rebuilt the panel since it was last placed
            var vitals = document.getElementById("sdc_vitals");
            var stats = document.getElementById("sdc_stats");
            if (vitals && stats && stats.parentNode
                && vitals.nextSibling !== stats)
                place();
        }
        catch (e)
        {
            console.error("sdc: vitals placement failed", e);
        }

        player = player || {};
        var hp = num(player.hp);
        var poison = player.poison_survival === undefined
            || player.poison_survival === null
            ? undefined : num(player.poison_survival);
        var poisoned = poison !== undefined && poison < hp;

        var hp_ratio = set_bar("hp", hp, num(player.hp_max),
                               num(player.real_hp_max), poison,
                               poisoned ? "poisoned" : "");
        var no_mp = player.species === "Djinni";
        if (!no_mp)
            set_bar("mp", num(player.mp), num(player.mp_max),
                    num(player.real_mp_max), undefined, "");
        // a class rather than .toggle(): jQuery's show() would force
        // display:block over the hiding in the stylesheet
        $("#sdc_vitals .sdc-bars").toggleClass("sdc-nomp", no_mp);
        var r = Number(hp_ratio);
        return isFinite(r) ? Math.max(0, Math.min(1, r)) : 1;
    }

    return {
        build: build,
        update: update,
    };
});
