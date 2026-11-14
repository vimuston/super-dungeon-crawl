// HP/MP vitals: text-cell bars in the #sdc_vitals panel (drawn like the
// Afterglow HUD: CELLS glyphs, a full block per lit cell and a shaded block
// per empty one, glowing in the bar colour), and where that panel sits.
// Styles live in bars.css.
//
// Contract with crt.js:
//   build()        -> HTML string inserted into #sdc_vitals under the name
//   update(player) -> called on every HUD update; returns hp/hp_max (0..1)
//
// Each cell of .sdc-track is one span; its class says what it shows:
//   sdc-on      current safe value
//   sdc-poison  HP that the current poison will still eat (HP only)
//   sdc-ghost   just lost; drains back to off after a beat
//   sdc-off     empty
//   sdc-cap     max reduced below its real value (drain etc.)
//
// The status badges, the HP/MP panel and the stats card are always one
// merged unit (#sdc_corner); HP/MP sit at the top of the card.
//
// Position: always top-left (it used to be the "hud_pos" option). It is put
// on <body data-sdc-hud-pos>; bars.css anchors #sdc_corner from it (HP bars,
// card, then badges). The unit's height is published as --sdc-corner-h on
// <body>.
define(["jquery", "./sdc_api"], function ($, api) {
    "use strict";

    var POSITION = "top-left";
    // a stale stored choice from the old option
    if ("hud_pos" in api.settings)
    {
        delete api.settings.hud_pos;
        api.save();
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

    // The observer's own resizes (vitals width, --sdc-corner-h) would re-trigger
    // it in the same frame, which browsers report as "ResizeObserver loop
    // completed with undelivered notifications" (a toast in the Android app).
    // Syncing on the next frame breaks that loop.
    var sync_pending = false;
    function sync_later()
    {
        if (sync_pending) return;
        sync_pending = true;
        window.requestAnimationFrame(function () {
            sync_pending = false;
            sync();
        });
    }

    function place()
    {
        document.body.setAttribute("data-sdc-hud-pos", POSITION);

        var vitals = document.getElementById("sdc_vitals");
        var corner = document.getElementById("sdc_corner");
        var stats = document.getElementById("sdc_stats");
        if (vitals && corner && stats && stats.parentNode === corner
            && vitals.nextSibling !== stats)
            corner.insertBefore(vitals, stats);

        if (window.ResizeObserver)
        {
            if (!resize_observer)
                resize_observer = new window.ResizeObserver(sync_later);
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
        if (key === "stats_skin")
            window.requestAnimationFrame(sync);
    });
    if (document.body)
        document.body.setAttribute("data-sdc-hud-pos", POSITION);

    // Markup -------------------------------------------------------------------

    // Last drawn state per bar ("hp"/"mp"), reset whenever the HUD is rebuilt.
    var state = {};

    var CELLS = 10;
    var FULL = "█", SHADE = "░";
    var GHOST_MS = 650;          // how long a lost cell stays lit
    var ghost_timer = {};

    function bar(key, label)
    {
        var cells = "";
        for (var i = 0; i < CELLS; i++)
            cells += '<span class="sdc-c sdc-off">' + SHADE + '</span>';
        return '<div class="sdc-bar sdc-' + key + '">'
            + '<span class="sdc-lbl">' + label + '</span>'
            + '<span class="sdc-track">' + cells + '</span>'
            + '<span class="sdc-val"><span class="sdc-cur"></span>'
            + '<span class="sdc-sep">/</span><span class="sdc-max"></span>'
            + '<span class="sdc-real"></span></span>'
            + '</div>';
    }

    function build()
    {
        state = {};
        Object.keys(ghost_timer).forEach(function (k) {
            clearTimeout(ghost_timer[k]);
        });
        ghost_timer = {};
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

    // How many of the CELLS a value fills. Anything above zero lights at
    // least one cell and anything short of full leaves one dark, so "alive"
    // and "not full" always read at a glance.
    function cells(x, total)
    {
        if (x <= 0) return 0;
        if (x >= total) return CELLS;
        return Math.max(1, Math.min(CELLS - 1, Math.round(x / total * CELLS)));
    }

    function paint($cells, kinds)
    {
        $cells.each(function (i) {
            var k = kinds[i];
            var cls = "sdc-c sdc-" + k;
            if (this.className !== cls)
                this.className = cls;
            var ch = k === "off" || k === "cap" ? SHADE : FULL;
            if (this.textContent !== ch)
                this.textContent = ch;
        });
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
        var $cells = $bar.find(".sdc-c");
        var n_safe = cells(safe, total);
        var n_val = cells(value, total);
        var n_max = cells(max, total);
        // a loss on the same scale leaves the lost cells (plus any trail
        // still showing) lit for a beat; a gain clears the trail
        var lit_before = !prev ? 0
            : ghost_timer[key] ? prev.n_ghost : prev.n_lit;
        var n_ghost = prev && prev.total === total && value < prev.value
            ? Math.max(n_val, lit_before) : n_val;

        function kinds(lit_to)
        {
            var out = [];
            for (var i = 0; i < CELLS; i++)
                out.push(i < n_safe ? "on" : i < n_val ? "poison"
                         : i < lit_to ? "ghost" : i < n_max ? "off" : "cap");
            return out;
        }
        paint($cells, kinds(n_ghost));
        clearTimeout(ghost_timer[key]);
        ghost_timer[key] = null;
        if (n_ghost > n_val)
            ghost_timer[key] = setTimeout(function () {
                ghost_timer[key] = null;
                if (state[key]) state[key].n_ghost = n_val;
                paint($cells, kinds(n_val));
            }, GHOST_MS);

        $bar.find(".sdc-cur").text(value);
        $bar.find(".sdc-max").text(max);
        $bar.find(".sdc-real").text(total > max ? "(" + total + ")" : "");
        $bar.attr("class", "sdc-bar sdc-" + key
                  + (classes ? " " + classes : ""));

        state[key] = { sig: sig, value: value, total: total,
                       n_lit: n_val, n_ghost: n_ghost };
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
