// HUD toggle buttons (map, monsters, stats, CRT filter, HUD, settings) as an
// icon row above the minimap, top right (#right_column).
// Styles live in toolbar.css. Slots run commands registered by crt.js
// through sdc_api (api.command("toggle:map") etc.).
//
// Slot size is fitted to the minimap width (check_size): one row of six.
// Buttons show only icons (names are in the tooltips).
define(["jquery", "./sdc_api"], function ($, api) {
    "use strict";

    // 24x24 line icons, drawn with currentColor (green phosphor via CSS)
    var SVG_HEAD = "<svg class='sdc-ab-icon' viewBox='0 0 24 24' "
                   + "fill='none' stroke='currentColor' stroke-width='1.6' "
                   + "stroke-linecap='round' stroke-linejoin='round' "
                   + "aria-hidden='true'>";
    var ICONS = {
        // unrolled map with a compass mark
        map: "<path d='M3 6l5-2 8 2 5-2v14l-5 2-8-2-5 2z'/>"
             + "<path d='M8 4v14M16 6v14'/>"
             + "<path d='M12 9.5l1 2.5-1 2.5-1-2.5z' fill='currentColor'/>",
        // skull
        monsters: "<path d='M12 3c-4.4 0-7.5 3-7.5 7 0 2.4 1.1 4.1 2.8 5.1"
                  + "V19h9.4v-2.9c1.7-1 2.8-2.7 2.8-5.1 0-4-3.1-7-7.5-7z'/>"
                  + "<circle cx='9' cy='11' r='1.7' fill='currentColor'/>"
                  + "<circle cx='15' cy='11' r='1.7' fill='currentColor'/>"
                  + "<path d='M12 13.5l-1 2h2z'/>"
                  + "<path d='M10 19v2M14 19v2'/>",
        // character sheet: scroll with bars
        stats: "<rect x='5' y='3' width='14' height='18' rx='1.5'/>"
               + "<path d='M8 8h4M8 12h7M8 16h5'/>"
               + "<path d='M14 8h2' stroke-width='2.4'/>",
        // CRT monitor; screen variant chosen by data-state on the slot
        filter: "<rect x='2.5' y='3.5' width='19' height='14' rx='2'/>"
                + "<path class='sdc-ab-curved' d='M5.5 7.5q6.5-2 13 0"
                + "q1 3 0 6q-6.5 2-13 0q-1-3 0-6z'/>"
                + "<rect class='sdc-ab-flat' x='5.5' y='6.5' width='13'"
                + " height='8'/>"
                + "<path class='sdc-ab-off' d='M6 6.5l12 8M18 6.5l-12 8'/>"
                + "<path d='M9 21h6M12 17.5V21'/>",
        // layout grid: frame with panels
        hud: "<rect x='3' y='3' width='18' height='18' rx='1.5'/>"
             + "<path d='M3 15h18M15 3v12M9 15v6'/>"
             + "<rect x='16.5' y='4.5' width='3' height='3' "
             + "fill='currentColor' stroke='none'/>",
        // gear
        panel: "<circle cx='12' cy='12' r='3'/>"
               + "<path d='M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"
               + "M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1"
               + "M16.6 7.4l2.1-2.1'/>"
               + "<circle cx='12' cy='12' r='6.2'/>",
    };


    var SLOTS = [
        { cmd: "toggle:map", key: "map", icon: "map", label: "MAP",
          hotkey: "M", tip: "Minimap" },
        { cmd: "toggle:monsters", key: "monsters", icon: "monsters",
          label: "MON", hotkey: "L", tip: "Monster list" },
        { cmd: "toggle:stats", key: "stats", icon: "stats", label: "STAT",
          hotkey: "S", tip: "Stats card" },
        { cmd: "toggle:filter", key: "filter", icon: "filter", label: "CRT",
          hotkey: "C", tip: "CRT filter (curved / flat / off)" },
        { cmd: "toggle:hud", key: "hud", icon: "hud", label: "HUD",
          hotkey: "H", tip: "HUD / classic layout" },
        { cmd: "panel", icon: "panel", label: "SET", hotkey: "O",
          tip: "Settings" },
    ];


    var MAX_SLOT = 30;   // px, widest slot
    var GAP = 3;         // keep in sync with toolbar.css
    var PAD = 10;        // horizontal padding + border of the bar


    var active = false;
    var frame_count = 0;

    function build()
    {
        active = true;
        $("#sdc_toolbar").remove();
        var bar = $("<div id='sdc_toolbar' class='sdc-actionbar'>");
        SLOTS.forEach(function (s) {
            var tip = s.tip + " (Alt+" + s.hotkey + ")";
            var btn = $("<button type='button' class='sdc-ab-slot'>")
                .attr("data-cmd", s.cmd).attr("data-key", s.key || null)
                .attr("data-tip", tip).attr("aria-label", tip)
                .attr("tabindex", "-1");
            btn.html(SVG_HEAD + ICONS[s.icon] + "</svg>"
                     + "<span class='sdc-ab-key'>" + s.hotkey + "</span>");
            bar.append(btn);
        });
        bar.on("mousedown", "button", function (ev) {
            // mousedown + preventDefault keeps keyboard focus on the game
            ev.preventDefault();
            if (ev.which && ev.which !== 1)
                return;
            press(this);
            api.command(this.getAttribute("data-cmd"));
        });
        // keep clicks, wheel and context menus out of the game underneath
        bar.on("mousedown mouseup click dblclick contextmenu wheel",
               function (ev) {
            ev.stopPropagation();
            if (ev.type === "contextmenu")
                ev.preventDefault();
        });
        $("#right_column").prepend(bar);
        refresh();
        check_size();
        // layout may not exist yet (minimap width 0), and the frame loop is
        // throttled when the page is hidden: also measure from timers
        [250, 1000, 3000].forEach(function (ms) {
            setTimeout(check_size, ms);
        });
    }

    window.addEventListener("resize", function () {
        setTimeout(check_size, 50);
    });

    // press feedback that doesn't depend on :active (which preventDefault
    // on mousedown suppresses in some browsers)
    function press(btn)
    {
        btn.classList.remove("sdc-ab-pressed");
        void btn.offsetWidth;   // restart the animation
        btn.classList.add("sdc-ab-pressed");
        setTimeout(function () {
            btn.classList.remove("sdc-ab-pressed");
        }, 220);
    }

    function refresh()
    {
        $("#sdc_toolbar [data-key]").each(function () {
            var key = this.getAttribute("data-key");
            var val = api.get(key);
            var on = key === "filter" ? val !== "off" : val;
            this.classList.toggle("on", !!on);
            if (key === "filter")
            {
                this.setAttribute("data-state", val);
            }
        });
    }

    // fit the row to the minimap width: 6 across, else 3 + 3
    function check_size()
    {
        var bar = document.getElementById("sdc_toolbar");
        if (!bar)
            return;
        var w = 0;
        var ids = ["minimap_block", "right_column"];
        for (var i = 0; i < ids.length && !(w > 0); i++)
        {
            var el = document.getElementById(ids[i]);
            w = el ? el.getBoundingClientRect().width : 0;
        }
        if (!(w > 0))
            return;
        // One row of six. Target ~30 css px at 100% zoom, shrinking only
        // gently as the page zoom / devicePixelRatio grows (so zooming in
        // doesn't blow the buttons up), and never wider than the minimap.
        var n = SLOTS.length;
        var dpr = window.devicePixelRatio || 1;
        var slot = Math.round(30 / Math.pow(dpr, 0.65));
        var fit = Math.floor((w - PAD - GAP * (n - 1)) / n);
        slot = Math.max(18, Math.min(MAX_SLOT, slot, fit));
        var cols = n;
        var font = Math.max(6, Math.min(8, Math.round(slot * 0.32 * 10) / 10));
        if (bar.getAttribute("data-slot") !== String(slot)
            || bar.getAttribute("data-cols") !== String(cols))
        {
            bar.setAttribute("data-slot", slot);
            bar.setAttribute("data-cols", cols);
            bar.style.setProperty("--sdc-ab-slot", slot + "px");
            bar.style.setProperty("--sdc-ab-cols", cols);
            bar.style.setProperty("--sdc-ab-font", font + "px");
        }
    }

    api.on("game_init", build);
    api.on("setting", refresh);
    api.on("frame", function () {
        if (++frame_count % 30 === 0)
            check_size();
    });
    api.on("game_cleanup", function () {
        active = false;
        $("#sdc_toolbar").remove();
    });

    return {};
});
