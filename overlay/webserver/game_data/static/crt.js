// Super Dungeon Crawl: phosphor-screen post-processing and a minimal floating HUD for
// the webtiles client. Hooked into game.js by scripts/patch_client.py.
//
// Hotkeys (Alt+key is never sent to crawl):
//   Alt+M  minimap on/off          Alt+L  monster list on/off
//   Alt+S  stats card on/off       Alt+C  CRT filter: curved / flat / off
//   Alt+H  CRT HUD layout <-> classic webtiles layout
//   Alt+O  settings panel (options registered by the feature modules)
//
// Feature modules talk to this one only through sdc_api.js.
define(["jquery", "./player", "./util", "./enums", "./dungeon_renderer",
        "./sdc_api", "./bars", "./stats", "./crt_splash",
        "./light", "./toolbar",
        "./quickbar", "./clouds", "./blink", "./dizzy", "./poison", "./shaft", "./combat","./berserk",
        "./statusfx", "./statusauras", "./summonfx", "./terrainfx", "./wandfx",
        "./beamfx", "./rangedfx", "./barfx", "./itemfx", "./godfx_support", "./godfx_dark",
        "./godfx_martial", "./godfx_odd",
        "./alive", "./depth", "./mobile"],
function ($, player, util, enums, dungeon_renderer, api, bars, stats_card) {
    "use strict";

    var FILTER_MODES = ["curved", "flat", "off"];
    api.register_option({ key: "hud", default: true });
    api.register_option({ key: "filter", label: "CRT filter", default: "curved",
                          choices: FILTER_MODES.map(function (m) {
                              return [m, m]; }) });
    api.register_option({ key: "curve_amount", label: "Curvature",
                          default: "high",
                          choices: [["subtle", "Subtle"], ["low", "Low"],
                                    ["medium", "Medium"], ["high", "High"],
                                    ["max", "Max"]] });
    api.register_option({ key: "chroma_bleed", label: "Chroma bleed",
                          default: true,
                          choices: [[true, "On"], [false, "Off"]] });
    api.register_option({ key: "bleed_amount", label: "Bleed strength",
                          default: 100,
                          range: { min: 0, max: 100, step: 5 } });
    api.register_option({ key: "scan_sweep", label: "Scanline sweep", default: false,
                          choices: [[true, "On"], [false, "Off"]] });
    api.register_option({ key: "map", default: true });
    api.register_option({ key: "monsters", default: false });
    api.register_option({ key: "stats", default: true });
    var settings = api.settings;
    var relayout = null;

    function save_settings()
    {
        api.save();
    }

    // Layout hooks (called from game.js) ------------------------------------

    // The mobile UI (mobile.js) always uses the HUD layout and replaces
    // the message pane with a floating bubble.
    function mobile()
    {
        return document.body.classList.contains("sdc-mobile");
    }

    function hud_active()
    {
        return settings.hud || mobile();
    }

    function messages_overlay()
    {
        return mobile();
    }

    function minimap_width(window_width, window_height)
    {
        // cells are square: height = gym * floor(width / gxm)
        var by_height = window_height * 0.32 * enums.gxm / enums.gym;
        var w = Math.min(window_width * 0.17, by_height);
        return Math.round(Math.max(160, Math.min(320, w)));
    }

    function after_layout()
    {
        apply_classes();
        if (settings.hud)
            $("#monster_list").css("width", $("#minimap_block").width() || "");
        schedule_hud_update();
    }

    // HUD panels anchor to the dungeon canvas edges. Layout can run while
    // #normal is hidden (zero rects), so this is refreshed from the frame loop.
    var anchor = { right: -1, bottom: -1 };
    function update_anchor(r)
    {
        if (r.width === 0 || (r.right === anchor.right
                              && r.bottom === anchor.bottom))
            return;
        anchor.right = r.right;
        anchor.bottom = r.bottom;
        var root = document.documentElement.style;
        root.setProperty("--sdc-dungeon-right", r.right + "px");
        root.setProperty("--sdc-dungeon-bottom", r.bottom + "px");
    }

    function set_relayout(fn)
    {
        relayout = fn;
    }

    function apply_classes()
    {
        var b = document.body.classList;
        b.toggle("sdc-hud", hud_active());
        b.toggle("sdc-nomap", !settings.map);
        b.toggle("sdc-monsters", settings.monsters);
        b.toggle("sdc-nostats", !settings.stats);
        b.toggle("sdc-filter", settings.filter !== "off");
        b.toggle("sdc-nosweep", settings.scan_sweep === false);
    }

    // Toggles -----------------------------------------------------------------

    function toggle(key)
    {
        if (key === "filter")
        {
            var i = FILTER_MODES.indexOf(settings.filter);
            settings.filter = FILTER_MODES[(i + 1) % FILTER_MODES.length];
        }
        else
            settings[key] = !settings[key];
        save_settings();
        setting_changed(key);
    }

    function setting_changed(key)
    {
        apply_classes();
        api.emit("setting", key, settings[key]);
        // HUD and minimap changes alter the dungeon/minimap geometry
        if ((key === "hud" || key === "map" || key === "monsters") && relayout)
            relayout();
        else
            after_layout();
    }

    ["map", "monsters", "stats", "filter", "hud"].forEach(function (k) {
        api.register_command("toggle:" + k, function () { toggle(k); });
    });
    api.register_command("panel", function () { toggle_panel(); });
    api.register_command("relayout", function () {
        apply_classes();
        if (relayout)
            relayout();
    });

    var hotkeys = { m: "map", l: "monsters", s: "stats", c: "filter", h: "hud" };

    function handle_keydown(ev)
    {
        if (!ev.altKey || ev.ctrlKey || ev.metaKey || !in_game_view()) return;
        var k = (ev.key || "").toLowerCase();
        if (k !== "o" && !hotkeys[k]) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (k === "o")
            toggle_panel();
        else
            toggle(hotkeys[k]);
    }

    // Settings panel: one row per option registered with a label, grouped by
    // PANEL_SECTIONS (unlisted keys land in "Other"). PANEL_DEPENDS greys a
    // row out while its parent setting has the given value.
    var PANEL_SECTIONS = [
        ["CRT screen", ["filter", "curve_amount", "chroma_bleed", "bleed_amount",
                        "scan_sweep"]],
        ["2.5D view", ["depth", "depth_persp", "depth_rot", "depth_zoom",
                       "depth_height"]],
        ["Effects", ["alive", "combat_text", "splash"]],
        ["Interface", ["hud_pos", "quickbar_pos", "quickbar_names"]],
        ["Mobile", ["mobile", "msg_fade", "mobile_pin", "mobile_zoom"]],
        ["Other", []]
    ];
    var PANEL_DEPENDS = {
        curve_amount: ["filter", "off"], chroma_bleed: ["filter", "off"],
        bleed_amount: ["chroma_bleed", false], scan_sweep: ["filter", "off"],
        depth_persp: ["depth", false], depth_rot: ["depth", false],
        depth_zoom: ["depth", false], depth_height: ["depth", false],
        msg_fade: ["mobile", "off"],
        mobile_pin: ["mobile", "off"], mobile_zoom: ["mobile", "off"]
    };
    var collapsed_sections = settings.panel_collapsed || {};

    function refresh_deps(panel, key)
    {
        panel.find(".sdc-sub[data-dep='" + key + "']").each(function () {
            var opt_key = $(this).data("opt");
            var dep = PANEL_DEPENDS[opt_key];
            $(this).toggleClass("off", settings[key] === dep[1]);
        });
    }

    function toggle_panel()
    {
        var panel = $("#sdc_panel");
        if (panel.length)
        {
            panel.remove();
            return;
        }
        panel = $("<div id='sdc_panel' class='sdc-panel'>")
            .append($("<div class='sdc-panel-title'>")
                .text("CRT settings  (Alt+O to close)")
                .append($("<button type='button' class='sdc-panel-close'>")
                    .attr("aria-label", "Close").text("×")
                    .on("mousedown", function (ev) { ev.preventDefault(); })
                    .on("click", function () { panel.remove(); })));
        var bodies = {};
        PANEL_SECTIONS.forEach(function (sec) {
            var collapsed = !!collapsed_sections[sec[0]];
            var body = $("<div class='sdc-sec-body'>").toggle(!collapsed);
            var head = $("<div class='sdc-sec-head'>")
                .toggleClass("shut", collapsed)
                .text(sec[0])
                .on("mousedown", function (ev) {
                    ev.preventDefault();
                    var shut = body.is(":visible");
                    body.toggle(!shut);
                    head.toggleClass("shut", shut);
                    collapsed_sections[sec[0]] = shut;
                    settings.panel_collapsed = collapsed_sections;
                    save_settings();
                });
            bodies[sec[0]] = body;
            panel.append(head, body);
        });
        function add(opt, row)
        {
            var name = "Other";
            PANEL_SECTIONS.forEach(function (sec) {
                if (sec[1].indexOf(opt.key) >= 0) name = sec[0];
            });
            var dep = PANEL_DEPENDS[opt.key];
            if (dep)
            {
                row.addClass("sdc-sub").attr("data-dep", dep[0]).data("opt", opt.key);
                row.toggleClass("off", settings[dep[0]] === dep[1]);
            }
            bodies[name].append(row);
        }
        api.options().forEach(function (opt) {
            if (!opt.label) return;
            var row = $("<div class='sdc-opt'>")
                .append($("<span class='sdc-k'>").text(opt.label));
            if (opt.range)
            {
                var val = $("<span class='sdc-k'>")
                    .css({ flex: "0 0 34px", textAlign: "right" })
                    .text(settings[opt.key]);
                $("<input type='range'>")
                    .attr({ min: opt.range.min, max: opt.range.max,
                            step: opt.range.step || 1 })
                    .val(settings[opt.key])
                    .css({ flex: "1 1 120px", minWidth: "120px",
                           accentColor: "#6dffa8", cursor: "pointer" })
                    .on("input change", function () {
                        settings[opt.key] = Number(this.value);
                        val.text(this.value);
                        save_settings();
                        setting_changed(opt.key);
                    })
                    // keep keyboard focus on the game after dragging
                    .on("mouseup", function () { this.blur(); })
                    .appendTo(row);
                row.append(val);
                add(opt, row);
                return;
            }
            opt.choices.forEach(function (c) {
                $("<button>").text(c[1])
                    .toggleClass("on", settings[opt.key] === c[0])
                    .on("mousedown", function (ev) {
                        ev.preventDefault();
                        settings[opt.key] = c[0];
                        save_settings();
                        row.find("button").removeClass("on");
                        $(this).addClass("on");
                        refresh_deps(panel, opt.key);
                        setting_changed(opt.key);
                    })
                    .appendTo(row);
            });
            add(opt, row);
        });
        PANEL_SECTIONS.forEach(function (sec) {
            if (!bodies[sec[0]].children().length)
                bodies[sec[0]].prev().add(bodies[sec[0]]).remove();
        });
        $("#normal").append(panel);
    }

    function in_game_view()
    {
        return $("#normal").is(":visible");
    }

    // HUD ---------------------------------------------------------------------

    var hud_update_pending = false;
    var stats_observer = null;

    function build_hud()
    {
        $("#sdc_vitals, #sdc_corner, #sdc_tip, #sdc_panel").remove();
        prev_snapshot = null;
        status_key = null;

        $("#normal").append(
            '<div id="sdc_vitals" class="sdc-panel">'
            + '<div class="sdc-name"></div>'
            + bars.build()
            + '</div>'
            + '<div id="sdc_corner">'
            + '<div id="sdc_statuses"></div>'
            + '<div id="sdc_stats" class="sdc-panel"></div>'
            + '</div>'
            + '<div id="sdc_tip" style="display:none"></div>');

        if (stats_observer)
            stats_observer.disconnect();
        stats_observer = new MutationObserver(schedule_hud_update);
        stats_observer.observe(document.getElementById("stats"), {
            subtree: true, childList: true, characterData: true,
            attributes: true,
        });
        apply_classes();
    }

    function schedule_hud_update()
    {
        if (hud_update_pending) return;
        hud_update_pending = true;
        window.requestAnimationFrame(function () {
            hud_update_pending = false;
            update_hud();
        });
    }

    // copy of a stock stats element (keeps its colour classes) without ids
    function copy(id)
    {
        var el = $("#" + id).clone();
        el.removeAttr("id").find("[id]").removeAttr("id");
        return el;
    }

    var stat_helpers = {
        copy: copy,
        text: function (id) { return $("#" + id).text().trim(); },
        noise: function () {
            return {
                level: $("#stats_noise").attr("data-level") || "quiet",
                pct: Math.max(0, Math.min(100, player.adjusted_noise / 10)),
            };
        },
    };

    var SNAPSHOT_KEYS = ["hp", "hp_max", "real_hp_max", "mp", "mp_max",
        "poison_survival", "xl", "progress", "ac", "ev", "sh", "str", "int",
        "dex", "adjusted_noise", "noise", "place", "depth", "gold", "piety_rank",
        "god", "turn", "time", "doom", "contam"];
    var prev_snapshot = null;
    var status_key = null;   // signature of the rendered status badges

    function snapshot()
    {
        var s = {};
        SNAPSHOT_KEYS.forEach(function (k) { s[k] = player[k]; });
        s.status = player.status.map(function (st) { return $.extend({}, st); });
        return s;
    }

    function update_hud()
    {
        if (!player.name) return;

        // vitals --------------------------------------------------------------
        var name = $("#sdc_vitals .sdc-name").empty();
        name.append($("<span class='sdc-who'>").text(player.name),
                    " ", $("<span>").text(player.species_display_name
                        + (player.god ? " of " + player.god : "")),
                    " ", copy("stats_piety"));

        var hp_ratio = bars.update(player);
        document.body.classList.toggle("sdc-hp-warn",
                                       hp_ratio <= 0.5 && hp_ratio > 0.25);
        document.body.classList.toggle("sdc-hp-danger", hp_ratio <= 0.25);

        // status lights -------------------------------------------------------
        // Rebuilt only when the set of lights changes: rebuilding on every
        // update replays the badges' fade-in each move (they seem to blink).
        // Only badges that are new since the last build animate.
        var tip = $("#sdc_tip");
        var lights = player.status.filter(function (st) { return st.light; });
        var key = lights.map(function (st) {
            return [st.light, st.col, st.use_html ? 1 : 0, st.desc || ""].join("");
        }).join("");
        if (key !== status_key)
        {
            var seen = {};
            $("#sdc_statuses .sdc-status").each(function () {
                seen[this.getAttribute("data-light")] = true;
            });
            var statuses = $("#sdc_statuses").empty();
            tip.hide();
            lights.forEach(function (st) {
                var badge = $("<span class='sdc-status'>")
                    .addClass("fg" + st.col)
                    .attr("data-light", st.light);
                if (status_key !== null && !seen[st.light])
                    badge.addClass("sdc-status-new");
                if (st.use_html)
                    badge.html(util.formatted_string_to_html(st.light));
                else
                    badge.text(st.light);
                if (st.desc)
                {
                    badge.on("mouseenter mousemove", function (ev) {
                        tip.html(util.formatted_string_to_html(st.desc)).show();
                        tip.css({
                            right: (window.innerWidth - ev.clientX + 12) + "px",
                            bottom: (window.innerHeight - ev.clientY + 12) + "px",
                        });
                    }).on("mouseleave", function () { tip.hide(); });
                }
                statuses.append(badge);
            });
            status_key = key;
        }

        // stats card ----------------------------------------------------------
        try
        {
            stats_card.render($("#sdc_stats").empty(), player, stat_helpers);
        }
        catch (e)
        {
            console.error("sdc: stats card render failed", e);
        }

        var snap = snapshot();
        api.emit("hud_update", player, prev_snapshot);
        prev_snapshot = snap;
    }

    // CRT post-processing (WebGL) --------------------------------------------


    var VERT = [
        "attribute vec2 a_pos;",
        "varying vec2 v_uv;",
        "void main() {",
        "  v_uv = a_pos * 0.5 + 0.5;",
        "  gl_Position = vec4(a_pos, 0.0, 1.0);",
        "}"].join("\n");

    // Living tiles (alive.js owns the data; motions documented there).
    // alive(uv) returns a displacement in cell units (x right, y = up) and
    // sets a_mul/a_add (tiny brightness/colour changes). Two texel reads:
    // this cell and the one below (for heat haze rising from lava/fire).
    // Displacements fade to 0 at cell edges (win/yw) unless the field is
    // continuous in map space (water, wind, ripples, warp), so no seams.
    var ALIVE_GLSL = [
        "vec3 a_add; vec3 a_mul;",
        "float awind(vec2 p) {",
        "  float s = dot(p, u_alive_wind.xy);",
        "  float T = u_alive_t;",
        "  float base = 0.5 * sin(T * 0.9 + s * 0.35) + 0.3 * sin(T * 1.7 + s * 0.8 + p.y * 0.3);",
        // gust bands travelling along the wind direction
        "  float g = 0.5 + 0.5 * sin(s * 0.16 - T * 0.5);",
        "  g *= g; g *= g; g *= g;",
        "  return u_alive_wind.z * (0.3 * base + u_alive_wind.w * g * (0.75 + 0.25 * sin(T * 3.1 + s)));",
        "}",
        "vec2 arip(vec2 p, vec4 r, float wid) {",
        "  if (r.w <= 0.0) return vec2(0.0);",
        "  vec2 d = p - r.xy;",
        "  float dist = length(d) + 0.001;",
        "  float x = dist - r.z * 6.0 * wid;",
        "  float env = exp(-x * x / (wid * wid * 0.6)) * exp(-r.z * 1.6) / (1.0 + dist * 0.12);",
        "  a_add += vec3(0.04, 0.05, 0.045) * env * r.w * (wid > 2.5 ? 2.5 : 1.0);",
        "  return d / dist * env * sin(x * 5.0 / wid) * r.w * 0.045;",
        "}",
        "vec2 aflame(vec2 wp, float up, float h) {",
        "  float T = u_alive_t;",
        "  float n = vnoise(vec2(wp.x * 4.0, wp.y * 3.0 + T * 3.0));",
        "  return vec2(sin(T * 8.0 + wp.y * 10.0 + h * 6.0) * 0.012, (n - 0.5) * 0.05 * up);",
        "}",
        "vec2 alive(vec2 uv) {",
        "  vec2 g = vec2(uv.x, 1.0 - uv.y) * u_alive_cells;",   // cells, y down
        "  vec2 ci = floor(g);",
        "  vec2 f = g - ci;",                                  // in-cell 0..1
        "  vec2 tc = (ci + 0.5) / u_alive_cells;",
        "  vec4 A = floor(texture2D(u_alive, tc) * 255.0 + 0.5);",
        "  vec4 B = floor(texture2D(u_alive, tc + vec2(0.0, 1.0 / u_alive_cells.y)) * 255.0 + 0.5);",
        "  float T = u_alive_t;",
        "  vec2 w = ci + u_alive_view;",       // map cell (phases are world-anchored)
        "  vec2 wp = w + f;",                  // continuous map position
        "  float h = hash(w);",
        "  float win = sin(3.1416 * f.x) * sin(3.1416 * f.y);",
        "  float yw = smoothstep(0.0, 0.22, f.y);",
        "  float up = (1.0 - f.y) * yw;",      // 0 at the feet, most near the head
        "  float mat = A.r, st = A.g, par = A.b;",
        "  float itm = mod(A.a, 16.0), kind = floor(A.a / 16.0);",
        "  vec2 d = vec2(0.0);",
        // world-wide fields: event ripples, abyss warp, quake, hellish shimmer
        "  d += (arip(wp, u_alive_rip0, u_alive_ripw.x) + arip(wp, u_alive_rip1, u_alive_ripw.y)",
        "      + arip(wp, u_alive_rip2, u_alive_ripw.z)) * u_alive_amp1.z;",
        "  a_add *= u_alive_amp1.z;",
        "  if (u_alive_mood.w > 0.0)",
        "    d += (vec2(vnoise(wp * 0.35 + vec2(T * 0.05, 0.0)), vnoise(wp * 0.35 + vec2(7.3, -T * 0.04))) - 0.5) * 0.06 * u_alive_mood.w;",
        "  if (u_alive_pl3.z > 0.0)",
        "    d += (vec2(hash(vec2(floor(T * 40.0), 3.7)), hash(vec2(floor(T * 40.0), 9.1))) - 0.5) * 0.05 * u_alive_pl3.z * u_alive_amp1.z;",
        "  if (u_alive_mood.y > 0.0 && mat > 0.5)",
        "    d.x += sin(wp.y * 5.0 + T * 3.0 + wp.x) * 0.004 * u_alive_mood.y;",
        // heat haze: hot cells and the cell above them (fades upward)
        "  float hot = (mat == 3.0 || mat == 6.0 || itm == 7.0) ? 0.7 : 0.0;",
        "  float bi = mod(B.a, 16.0);",
        "  if (B.r == 3.0 || B.r == 6.0 || bi == 7.0) hot = max(hot, 0.7 * f.y);",
        "  if (hot > 0.0) d.x += sin(wp.y * 16.0 + T * 6.5 + wp.x * 2.0) * 0.010 * hot * u_alive_amp0.w;",
        "  if (st == 6.0) {",                          // paralysed / caught: frozen
        "    a_add *= min(u_alive_amt, 1.5);",
        "    return clamp(d, -0.06, 0.06) * u_alive_amt;",
        "  }",
        // --- materials ---
        "  if (mat == 1.0 || mat == 2.0) {",          // water
        "    float k = mat == 1.0 ? 1.0 : 0.55;",
        "    float a1 = sin(wp.x * 2.1 + wp.y * 1.3 + T * 1.6 * k);",
        "    float a2 = sin(-wp.x * 1.4 + wp.y * 2.6 + T * 1.25 * k + 1.7);",
        "    d += vec2(a1, a2) * (mat == 1.0 ? 0.014 : 0.022) * u_alive_amp0.y;",
        "    float c = sin(wp.x * 3.7 + T * 0.9 + sin(wp.y * 2.3 + T * 0.7)) * sin(wp.y * 3.1 - T * 0.8 + sin(wp.x * 1.9 + T * 0.5));",
        "    c = max(c, 0.0); c *= c; c *= c; c *= c;",
        "    a_add += vec3(0.05, 0.07, 0.08) * c * k * u_alive_amp0.y;",
        "    if (st > 0.5 && par < 128.0) d.y += a1 * 0.022 * win * u_alive_amp0.y;",  // waders bob
        "  } else if (mat == 3.0) {",                 // lava
        "    d += (vec2(vnoise(wp * 1.6 + vec2(0.0, T * 0.12)), vnoise(wp * 1.6 + vec2(5.2, 1.3) - vec2(T * 0.1, 0.0))) - 0.5) * 0.05 * u_alive_amp0.y;",
        "    a_mul *= 1.0 + 0.10 * (vnoise(wp * 2.3 + vec2(T * 0.15, -T * 0.07)) - 0.5) * u_alive_amp0.y;",
        "  } else if (mat == 4.0) {",                 // trees
        "    float wv = awind(w + 0.5);",
        "    d.x += (wv * 0.045 + 0.004 * sin(T * 7.0 + h * 40.0 + f.y * 9.0) * wv) * up * u_alive_amp0.z;",
        "  } else if (mat == 5.0) {",                 // wall torch: lick in the flame area
        "    float m = exp(-(f.x - 0.5) * (f.x - 0.5) * 40.0) * (1.0 - smoothstep(0.2, 0.6, f.y));",
        "    d += vec2(sin(T * 9.0 + f.y * 12.0 + h * 6.0) * 0.014, (vnoise(vec2(f.x * 5.0, T * 3.5 + h * 10.0)) - 0.5) * 0.05) * m * u_alive_amp0.w;",
        "  } else if (mat == 6.0) {",                 // fiery features
        "    d += aflame(wp, up, h) * win * u_alive_amp0.w;",
        "  } else if (mat == 7.0) {",                 // crystal / ice
        "    d += (vec2(vnoise(wp * 3.0 + T * 0.25), vnoise(wp * 3.0 + vec2(3.1, 7.7) - T * 0.2)) - 0.5) * 0.022 * u_alive_amp1.x;",
        "    float band = fract((wp.x + wp.y) * 0.07 - T * 0.04) - 0.5;",
        "    a_add += vec3(0.05, 0.07, 0.09) * exp(-band * band * 900.0) * u_alive_amp1.x;",
        "  } else if (mat == 18.0) {",                // frozen ramparts: creeping, chilling ice
        // slow refraction through the ice, wavering sideways as the cold deepens
        "    d += (vec2(vnoise(wp * 4.0 + vec2(T * 0.35, -T * 0.2)), vnoise(wp * 4.0 + vec2(3.1, 7.7) - T * 0.3)) - 0.5) * 0.03 * u_alive_amp1.x;",
        // pale frost sheets drifting diagonally across the walls, in two layers
        "    float fz1 = vnoise(wp * 2.2 + vec2(T * 0.18, -T * 0.10));",
        "    float fz2 = vnoise(wp * 5.0 - vec2(T * 0.25, T * 0.14) + 9.0);",
        "    float sheet = smoothstep(0.35, 0.85, fz1 * 0.65 + fz2 * 0.35);",
        // a slow breathing chill that sweeps over the ice
        "    float chill = 0.65 + 0.35 * sin(T * 0.9 + h * 6.2832 + wp.x * 0.4);",
        "    a_add += vec3(0.05, 0.11, 0.17) * (0.25 + sheet) * chill * u_alive_amp1.x;",
        "    a_mul *= mix(vec3(1.0), vec3(0.88, 1.0, 1.18), 0.85 * u_alive_amp1.x);",
        // cold light sweeping along the surface
        "    float fband = fract((wp.x * 0.8 - wp.y) * 0.16 - T * 0.09) - 0.5;",
        "    a_add += vec3(0.10, 0.15, 0.20) * exp(-fband * fband * 260.0) * u_alive_amp1.x;",
        // twinkling ice crystals: each cell has a few that flash in turn
        "    vec2 sc = floor((wp - w) * 4.0);",
        "    float sh = hash(w * 7.0 + sc);",
        "    float tw = pow(max(0.0, sin(T * (0.9 + sh * 1.6) + sh * 40.0)), 24.0);",
        "    vec2 sf = fract((wp - w) * 4.0) - 0.5;",
        "    float sp = tw * step(0.55, sh) * (1.0 - smoothstep(0.0, 0.33, length(sf)));",
        "    a_add += vec3(0.55, 0.78, 1.0) * sp * u_alive_amp1.x;",
        "  } else if (mat == 8.0) {",                 // walls: ooze in Slime / Abyss
        "    if (u_alive_mood.z > 0.0)",
        "      d += (vec2(vnoise(wp * 0.9 + vec2(T * 0.07, 0.0)), vnoise(wp * 0.9 + vec2(2.7, T * 0.06))) - 0.5) * 0.05 * u_alive_mood.z;",
        "  } else if (mat == 9.0) {",                 // open door stirs in gusts
        "    d.x += awind(w + 0.5) * 0.015 * win * u_alive_amp0.z;",
        "  } else if (mat == 10.0 || mat == 11.0) {", // stairs: pull down / swell up
        "    float p = 0.5 + 0.5 * sin(T * 0.7 * u_alive_mood.x + h * 6.2832);",
        "    d += (f - 0.5) * (mat == 10.0 ? 0.07 : -0.05) * p * win * u_alive_amp1.x;",
        "  } else if (mat == 12.0) {",                // portals: swirl
        "    vec2 c = f - 0.5;",
        "    float a = 0.4 * sin(T * 0.5 + h * 6.0) * (1.0 - smoothstep(0.0, 0.5, length(c)));",
        "    d += (vec2(c.x * cos(a) - c.y * sin(a), c.x * sin(a) + c.y * cos(a)) - c) * u_alive_amp1.x;",
        "    a_mul *= 1.0 + 0.04 * sin(T * 1.1 + h * 6.0) * win * u_alive_amp1.x;",
        "  } else if (mat == 13.0) {",                // altars: slow glow
        "    float p = sin(T * 0.6 + h * 6.2832) * win * u_alive_amp1.x;",
        "    a_mul *= 1.0 + 0.05 * p;",
        "    d.y += 0.012 * p;",
        "  } else if (mat == 14.0) {",                // fountains: rings
        "    vec2 c = f - 0.5;",
        "    float r = length(c) + 0.01;",
        "    d += c / r * sin(r * 28.0 - T * 3.0) * 0.012 * win * u_alive_amp0.y;",
        "  } else if (mat == 15.0) {",                // bog / mud: heave + bubbles
        "    d += (vec2(vnoise(wp * 1.2 + T * 0.08), vnoise(wp * 1.2 - T * 0.07 + 4.0)) - 0.5) * 0.03 * u_alive_amp0.y;",
        "    float cyc = T * 0.25 + h * 7.0;",
        "    float id = floor(cyc), ph = fract(cyc);",
        "    vec2 bc = vec2(hash(w + id), hash(w - id + 3.1)) * 0.6 + 0.2;",
        "    vec2 c = f - bc;",
        "    float r = length(c) + 0.01;",
        "    float e = (r - ph * 0.35) * 18.0;",
        "    d += c / r * exp(-e * e) * (1.0 - ph) * 0.03 * u_alive_amp0.y;",
        "  } else if (mat == 16.0) {",                // grass nods
        "    d.x += awind(wp) * 0.012 * up * u_alive_amp0.z;",
        "  } else if (mat == 19.0) {",                // Lair floor: lighter, lusher green
        "    float lush = 0.75 + 0.5 * vnoise(wp * 0.6);",
        "    a_mul *= vec3(1.02, 1.16, 0.94);",
        "    a_add += vec3(0.02, 0.05, 0.012) * lush;",
        "  }",
        // --- you ---
        "  if (st == 7.0) {",
        "    float P = u_alive_amp1.w;",
        "    float b = sin(u_alive_pl.x) * u_alive_pl.y;",
        "    d += vec2(-(f.x - 0.5) * b * 0.6 * win, b * up) * P;",
        "    float hp = fract(u_alive_pl.w);",
        "    float pulse = exp(-hp * hp * 300.0) + 0.6 * exp(-(hp - 0.17) * (hp - 0.17) * 300.0);",
        "    d -= (f - 0.5) * pulse * u_alive_pl.z * 0.06 * win * P;",
        "    d -= (f - 0.5) * u_alive_pl3.w * win * P;",   // external squash (player_kick)
        "    d.x -= u_alive_pl2.x * up * P;",
        "    d.y -= u_alive_pl2.y * 0.5 * win * P;",
        "    d.x += sin(T * 1.1) * u_alive_pl2.z * up * P;",
        "    d.y += sin(T * 0.73) * u_alive_pl2.z * 0.5 * win * P;",
        "    d += (vec2(hash(vec2(floor(T * 30.0), 1.0)), hash(vec2(floor(T * 30.0), 2.0))) - 0.5) * u_alive_pl2.w * win * P;",
        "    if (u_alive_pl3.x > 0.0) {",
        "      d.x += sin(wp.y * 11.0 + T * 2.3) * 0.008 * u_alive_pl3.x * win * P;",
        "      a_mul *= mix(vec3(1.0), vec3(0.93, 1.05, 0.9), u_alive_pl3.x * win * (0.6 + 0.4 * sin(T * 1.3)) * P);",
        "    }",
        // --- creatures ---
        "  } else if (st > 0.5) {",
        "    float C = u_alive_amp0.x;",
        "    float dmg = mod(par, 8.0), thr = mod(floor(par / 8.0), 8.0);",
        "    float big = mod(floor(par / 64.0), 2.0), fly = floor(par / 128.0);",
        "    float tempo = u_alive_mood.x * (1.0 - 0.35 * big);",
        "    float rate = 0.75 * (1.0 + 0.6 * u_alive_pl3.y + 0.25 * u_alive_mood.y);",
        "    float depth = 0.013 + 0.002 * thr;",
        "    if (st == 1.0) { rate = 0.2; depth = 0.034;",   // asleep (+ rare sigh)
        "      float s = 0.5 + 0.5 * sin(T * 0.05 + h * 30.0); s *= s; s *= s; s *= s;",
        "      depth *= 1.0 + 0.6 * s; }",
        "    else if (st == 8.0) { rate = 0.3; depth = 0.022; }",
        "    else if (st == 4.0) { rate = 0.27; depth = 0.02; }",
        "    else if (st == 5.0) { rate = 2.1; depth = 0.012; }",
        "    else if (st == 3.0) { depth = 0.02; }",
        "    rate *= tempo * (1.0 - 0.07 * dmg);",
        "    depth *= 1.0 + 0.15 * big;",
        "    float ph = st == 3.0 ? u_alive_pl.x : T * rate * 6.2832 + h * 6.2832;",
        "    float b = sin(ph) * depth;",
        "    if (kind == 1.0) {",                           // plants sway
        "      d.x += awind(w + 0.5) * 0.03 * up * u_alive_amp0.z;",
        "    } else if (kind == 2.0) {",                    // statues, golems: still
        "    } else if (kind == 3.0) {",                    // undead: no breath, lurch
        "      float l = max(0.0, sin(T * 0.45 * tempo + h * 6.2832)); l *= l; l *= l; l *= l;",
        "      d.x += l * 0.03 * up * (h > 0.5 ? 1.0 : -1.0) * C;",
        "    } else if (kind == 4.0) {",                    // ghosts float
        "      d += vec2(sin(T * 0.53 + h * 3.0) * 0.015, sin(T * 0.8 + h * 6.0) * 0.03) * win * C;",
        "    } else if (kind == 5.0) {",                    // oozes jiggle
        "      float j = sin(T * 2.4 * tempo + h * 6.2832);",
        "      d.x += (f.x - 0.5) * j * 0.06 * win * C;",
        "      d.y -= j * 0.025 * up * C;",
        "    } else if (kind == 6.0) {",                    // vortices swirl
        "      vec2 c = f - 0.5;",
        "      float a = 0.5 * sin(T * 1.4 + h * 6.0) * (1.0 - smoothstep(0.0, 0.5, length(c)));",
        "      d += (vec2(c.x * cos(a) - c.y * sin(a), c.x * sin(a) + c.y * cos(a)) - c) * C;",
        "    } else {",                                     // breathing
        "      d += vec2(-(f.x - 0.5) * b * 0.6 * win, b * up) * C;",
        "      if (kind == 7.0) d.x += sin(f.y * 9.0 - T * 2.2 * tempo + h * 6.0) * 0.016 * win * C;",
        "      if (kind == 8.0) {",
        "        float burst = step(0.93, hash(w + floor(T * 3.0)));",
        "        d += (vec2(hash(w + floor(T * 24.0)), hash(w.yx + floor(T * 24.0))) - 0.5) * 0.03 * burst * win * C;",
        "      }",
        "    }",
        "    if (st == 5.0) d.x += sin(T * 23.0 + h * 50.0) * 0.006 * win * C;",
        "    if (dmg > 0.5 && kind != 2.0) d.x += sin(T * 0.9 * tempo + h * 6.0) * 0.005 * dmg * up * C;",
        "    if (fly > 0.5 && kind != 2.0) d.y += sin(T * 2.2 * tempo + h * 6.0) * 0.025 * win * C;",
        "    vec2 tw = abs(w - u_alive_twitch.xy);",
        "    if (tw.x + tw.y < 0.5 && u_alive_twitch.z < 0.9) {",
        "      float e = sin(clamp(u_alive_twitch.z / 0.9, 0.0, 1.0) * 3.1416);",
        "      d.x += u_alive_twitch.w * e * e * 0.04 * up * C;",
        "    }",
        "  }",
        // --- items and clouds ---
        "  if (itm == 1.0 || itm == 2.0) {",                // gold / gem glints
        "    float period = itm == 1.0 ? 6.0 : 9.0;",
        "    float cyc = T / period + h * 13.0;",
        "    float id = floor(cyc), tt = fract(cyc) * period;",
        "    if (tt < 0.4) {",
        "      vec2 sp = vec2(hash(w + id), hash(w + id * 1.7 + 3.1)) * 0.5 + 0.25;",
        "      vec2 c = abs(f - sp);",
        "      float s = exp(-c.x * 22.0 - c.y * c.y * 4000.0) + exp(-c.y * 22.0 - c.x * c.x * 4000.0);",
        "      a_add += (itm == 1.0 ? vec3(1.0, 0.9, 0.55) : vec3(0.85, 0.95, 1.0)) * s * sin(tt / 0.4 * 3.1416) * 0.4 * u_alive_amp1.y;",
        "    }",
        "  } else if (itm == 3.0) {",                       // potions slosh
        "    d.x += sin(T * 1.8 + h * 6.0) * 0.012 * smoothstep(0.35, 0.75, f.y) * win * u_alive_amp1.y;",
        "  } else if (itm == 4.0) {",                       // paper flutters in gusts
        "    d.y += awind(w + 0.5) * 0.012 * sin(f.x * 9.0 + T * 6.0) * win * u_alive_amp0.z;",
        "  } else if (itm == 5.0) {",                       // a fly over fresh corpses
        "    float tt = fract(T / 11.0 + h * 5.0) * 11.0;",
        "    float vis = smoothstep(0.0, 0.6, tt) * (1.0 - smoothstep(3.4, 4.0, tt));",
        "    if (vis > 0.0) {",
        "      vec2 fp = vec2(0.5 + 0.22 * cos(T * 5.3 + h * 9.0) + 0.05 * sin(T * 13.0),",
        "                     0.42 + 0.12 * sin(T * 7.1 + h * 4.0) + 0.04 * sin(T * 17.0));",
        "      a_mul *= 1.0 - 0.6 * vis * (1.0 - smoothstep(0.012, 0.035, length(f - fp))) * u_alive_amp1.y;",
        "    }",
        "  } else if (itm == 6.0) {",                       // clouds drift
        "    d += vec2(awind(wp) * 0.6 + sin(T * 0.6 + wp.y * 1.3) * 0.5, sin(T * 0.8 + wp.x * 1.1) * 0.5) * 0.025 * u_alive_amp0.y;",
        "  } else if (itm == 7.0) {",                       // flames
        "    d += aflame(wp, up, h) * u_alive_amp0.w;",
        "  } else if (itm == 8.0) {",                       // frost shimmer
        "    d += (vec2(vnoise(wp * 3.0 + T * 0.6), vnoise(wp * 3.0 - T * 0.5 + 2.0)) - 0.5) * 0.02 * u_alive_amp0.y;",
        "  }",
        // u_alive_amt is the master strength (can exceed 1): displacement
        // scales fully, glints/shading are capped so a_mul can't go negative
        "  a_add *= min(u_alive_amt, 1.5);",
        "  a_mul = mix(vec3(1.0), a_mul, min(u_alive_amt, 1.0));",
        "  return clamp(d, -0.06, 0.06) * u_alive_amt;",
        "}",
    ];

    var FRAG = [
        "precision mediump float;",
        "uniform sampler2D u_tex;",
        "uniform float u_pxs;",   // integer device px per CSS px (mask/scanline pitch)
        "uniform vec2 u_res;",      // output size in device px
        "uniform vec2 u_texel;",    // 1 / source size
        "uniform float u_curve;",
        "uniform float u_time;",
        "uniform float u_danger;",
        // berserk fx (berserk.js via api.get_fx)
        "uniform vec4 u_fx;",         // rage, heartbeat, shock radius, shock amp
        "uniform vec4 u_fxp;",        // shock centre uv (y down), crash, -
        "uniform vec2 u_shake;",      // dungeon shake, device px
        // screen grade (api.grade): desat, invert, tint_a, wobble
        "uniform vec4 u_g1;",
        "uniform vec4 u_gtint;",      // tint rgb, chroma smear
        "uniform vec4 u_gvig;",       // vignette rgb, strength
        "uniform float u_ghue;",      // hue rotation, turns
        "uniform float u_bleed;",     // chroma bleed strength 0..1
        "uniform sampler2D u_light;", // environmental light map (light.js)
        "uniform float u_light_on;",
        "uniform sampler2D u_los;",   // line-of-sight mask (light.js)
        "uniform float u_los_amt;",   // 0 = off
        "uniform vec2 u_player;",     // player centre, uv (y down)
        "uniform float u_aspect;",    // dungeon width / height
        // --- living tiles (alive.js; see its header) ---
        "uniform sampler2D u_alive;", // one texel per view cell, row 0 = top
        "uniform float u_alive_amt;", // 0 = off
        "uniform vec2 u_alive_cells;",// cols, rows
        "uniform vec2 u_alive_view;", // map coords of the top-left cell
        "uniform float u_alive_t;",   // seconds (wraps hourly)
        "uniform vec4 u_alive_mood;", // tempo, unrest, wall ooze, field warp
        "uniform vec4 u_alive_wind;", // dir.xy, strength, gustiness
        "uniform vec4 u_alive_amp0;", // creatures, liquids, wind, flames
        "uniform vec4 u_alive_amp1;", // magic, glints, ripples, player
        "uniform vec4 u_alive_pl;",   // breath phase, depth, heartbeat, beat phase
        "uniform vec4 u_alive_pl2;",  // lean.xy, confusion sway, berserk tremor
        "uniform vec4 u_alive_pl3;",  // sickness, startle, quake
        "uniform vec4 u_alive_rip0;", // ripple: map x, y, age s, strength
        "uniform vec4 u_alive_rip1;",
        "uniform vec4 u_alive_rip2;",
        "uniform vec3 u_alive_ripw;", // ripple widths
        "uniform vec4 u_alive_twitch;", // glance: map x, y, age s, dir
        // depth: 2.5D view (depth.js)
        "uniform sampler2D u_depth;", // R wall, G creature/item, B upright
        "uniform float u_depth_amt;", // 0 = off
        "uniform float u_depth_h;",   // wall height, cells
        "uniform float u_depth_p;",   // perspective strength 0..1
        "uniform float u_depth_rot;", // yaw, radians
        "uniform float u_depth_zoom;", // view zoom, 1 = none
        "uniform float u_depth_hl;",  // liquid height, cells
        "uniform vec2 u_depth_cells;",
        "varying vec2 v_uv;",
        "vec2 warp(vec2 uv) {",
        "  vec2 c = uv * 2.0 - 1.0;",
        "  c *= (1.0 + u_curve * dot(c, c)) / (1.0 + u_curve);",
        "  return c * 0.5 + 0.5;",
        "}",
        "vec3 tap(vec2 uv) { return texture2D(u_tex, uv).rgb; }",
        "float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
        "float vnoise(vec2 p) {",
        "  vec2 i = floor(p), f = fract(p);",
        "  f = f * f * (3.0 - 2.0 * f);",
        "  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),",
        "             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);",
        "}",
    ].concat(ALIVE_GLSL, [
        // depth: cell flags at cell coords c (y down); 0 outside the view
        "vec4 dcell(vec2 c) {",
        "  if (c.x < 0.0 || c.y < 0.0 || c.x >= u_depth_cells.x || c.y >= u_depth_cells.y) return vec4(0.0);",
        "  return texture2D(u_depth, (floor(c) + 0.5) / u_depth_cells);",
        "}",
        "vec2 drot(vec2 v, vec2 cs) { return vec2(cs.x * v.x - cs.y * v.y, cs.y * v.x + cs.x * v.y); }",
        "bool isliq(vec4 c) { return c.r > 0.3 && c.r < 0.7; }",
        "bool ishi(vec4 c) { return c.r > 0.45 && c.r < 0.7; }",   // shallow water, lava
        "float dsh(vec2 f, vec2 ctr, vec2 rad) {",
        "  return 1.0 - smoothstep(0.45, 1.0, length((f - ctr) / rad));",
        "}",
        "void main() {",
        "  vec2 uv = warp(v_uv);",
        "  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {",
        "    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return;",
        "  }",
        // berserk: screen shake, shockwave refraction, heat shimmer
        "  float ring = 0.0;",
        "  uv += vec2(u_shake.x, -u_shake.y) / u_res;",
        "  if (u_fx.w > 0.0) {",
        "    vec2 sp = (vec2(uv.x, 1.0 - uv.y) - u_fxp.xy) * vec2(u_aspect, 1.0);",
        "    float sd = length(sp);",
        "    float rr = (sd - u_fx.z) * 9.0;",
        "    ring = exp(-rr * rr) * u_fx.w;",
        "    uv += vec2(sp.x / u_aspect, -sp.y) / (sd + 0.001) * ring * 0.025;",
        "  }",
        "  if (u_fx.x > 0.0)",
        "    uv.x += sin(uv.y * 70.0 + u_time * 9.0) * 0.0006 * u_fx.x;",
        "  if (u_g1.w > 0.0) {",
        "    uv.x += sin(uv.y * 24.0 + u_time * 2.6) * 0.004 * u_g1.w;",
        "    uv.y += sin(uv.x * 19.0 + u_time * 2.1) * 0.003 * u_g1.w;",
        "  }",
        "  a_add = vec3(0.0); a_mul = vec3(1.0);",
        // depth: 2.5D. Walls are raised by H (their top covers the bottom
        // strip of the cell behind, a dark front face fills the foot);
        // creatures and upright features are stretched up from their feet
        // and everything standing gets a soft floor shadow.
        "  float d_mul = 1.0;",
        "  if (u_depth_amt > 0.0) {",
        "    uv = 0.5 + (uv - 0.5) / mix(1.0, u_depth_zoom, u_depth_amt);",
        "    float kp = u_depth_p * u_depth_amt;",
        // keystone: the far (top) rows show more of the map, the near rows less
        "    uv.x = 0.5 + (uv.x - 0.5) * (1.0 + 0.24 * kp * (uv.y - 0.5));",
        // yaw: the ground is rotated about the view centre (cell coords, y down)
        "    vec2 S = vec2(uv.x, 1.0 - uv.y) * u_depth_cells;",
        "    float ph = u_depth_rot * u_depth_amt;",
        "    vec2 cs = vec2(cos(ph), sin(ph));",
        "    vec2 Cc = u_depth_cells * 0.5;",
        "    vec2 G = Cc + drot(S - Cc, cs);",
        "    float H = u_depth_h * u_depth_amt;",
        "    vec2 hv = drot(vec2(0.0, H), cs);",   // screen-up, in ground coords
        "    vec2 hlv = drot(vec2(0.0, u_depth_hl * u_depth_amt), cs);",
        "    vec2 hdv = hlv * 0.5;",           // deep water sits lower
        "    vec2 gs = G;",
        "    float shade = 1.0;",
        "    if (dcell(G + hv).r > 0.75) {",                       // wall top
        "      gs = G + hv;",
        "      shade = 1.0 + 0.14 * u_depth_amt;",
        "    } else {",
        // wall side: the highest wall cell met on the way up the extrusion
        "      float hit = -1.0;",
        // (a wall's own cell is part of the face too: it must be traced to
        // the edge as well, or the whole sprite shows up a second time)
        "      if (dcell(G).r > 0.75) hit = 0.0;",
        "      for (int i = 0; i < 9; i++) {",
        "        float t = 0.9 - 0.1 * float(i);",
        "        if (dcell(G + hv * t).r > 0.75) { hit = t; break; }",
        "      }",
        // refine to the exact edge of the wall so the side face is smooth
        "      if (hit > 0.0) {",
        "        float tb = hit + 0.1;",
        "        for (int j = 0; j < 4; j++) {",
        "          float tm = 0.5 * (hit + tb);",
        "          if (dcell(G + hv * tm).r > 0.75) hit = tm; else tb = tm;",
        "        }",
        "      }",
        "      if (hit >= 0.0) {",
        "        gs = G + hv * hit;",
        "        shade = mix(1.0, 0.40 + 0.22 * hit, u_depth_amt);",
        "      } else if (ishi(dcell(G + hlv))) {",             // shallow water / lava top
        "        gs = G + hlv;",
        "        shade = 1.0 + 0.05 * u_depth_amt;",
        "      } else if (isliq(dcell(G + hdv))) {",            // deep water top, or a high edge
        "        gs = G + hdv;",
        "        shade = ishi(dcell(G + hdv)) ? 1.0 - 0.42 * u_depth_amt : 1.0 + 0.02 * u_depth_amt;",
        "      } else if (isliq(dcell(G))) {",                     // front edge
        "        shade = 1.0 - (ishi(dcell(G)) ? 0.42 : 0.22) * u_depth_amt;",
        "      } else {",
        "        vec4 c0 = dcell(G);",
        "        vec2 f = fract(G);",
        // creatures and upright features
        "        vec2 fe = floor(G) + vec2(0.5, 0.92);",
        "        bool up = c0.g > 0.9 || c0.b > 0.5;",
        "        float lift = max(c0.g > 0.9 ? 1.0 : 0.0, c0.b > 0.5 ? 0.8 : 0.0) * (0.02 + 0.12 * u_depth_p) * u_depth_amt;",
        // stretch along screen-up from the feet (the sprite turns with the map);
        // the stretch eases off toward the cell top so the sprite's top row
        // still lands on it (a plain stretch would push the head off the cell)
        "        vec2 uu = drot(vec2(0.0, -1.0), cs);",
        "        float du = dot(G - fe, uu);",
        "        if (up) gs = G - uu * du * (lift / (1.0 + lift)) * (1.0 - clamp(du / 0.92, 0.0, 1.0));",
        // clouds (fog, poison, fire...) float a little above the floor
        "        if (!up && c0.a > 0.1)",
        "          gs.y = floor(G.y) + 1.0 + (G.y - floor(G.y) - 1.0) / (1.0 + 0.10 * u_depth_amt);",
        "        vec2 fp = f;",
        "        float sh = 0.0;",
        "        if (c0.g > 0.9) sh = dsh(fp, vec2(0.52, 0.82), vec2(0.38, 0.11)) * 0.62;",
        "        else if (c0.g > 0.3) sh = dsh(f, vec2(0.52, 0.78), vec2(0.24, 0.07)) * 0.48;",
        "        else if (c0.b > 0.5) sh = dsh(fp, vec2(0.52, 0.84), vec2(0.36, 0.10)) * 0.35;",
        "        if (!up && c0.a > 0.5 && sh == 0.0) sh = dsh(f, vec2(0.5, 0.88), vec2(0.44, 0.12)) * 0.3;",
        // contact shadow in front of (below) and right of walls and liquids
        "        vec4 cn = dcell(G - vec2(0.0, 1.0));",
        "        float ao = cn.r > 0.75 ? 1.0 - smoothstep(0.0, 0.34, f.y) : (isliq(cn) ? 0.5 * (1.0 - smoothstep(0.0, 0.2, f.y)) : 0.0);",
        "        ao = max(ao, dcell(G - vec2(1.0, 0.0)).r > 0.75 ? 0.6 * (1.0 - smoothstep(0.0, 0.22, f.x)) : 0.0);",
        "        shade = 1.0 - (sh + ao * 0.38) * (0.6 + 0.8 * u_depth_p) * u_depth_amt;",
        "      }",
        "    }",
        "    uv = vec2(gs.x / u_depth_cells.x, 1.0 - gs.y / u_depth_cells.y);",
        "    vec2 gu = G / u_depth_cells;",
        "    d_mul = (gu.x < 0.0 || gu.x > 1.0 || gu.y < 0.0 || gu.y > 1.0) ? 0.0 : shade;",
        "  }",
        // living tiles: sub-cell displacement of the sample position. Runs on
        // the map-space uv (after the 2.5D transform) so its per-cell tints
        // and licks stay on their tiles when the view is rotated / zoomed.
        "  if (u_alive_amt > 0.0) {",
        "    vec2 ad = alive(uv);",
        "    uv += vec2(ad.x, -ad.y) / u_alive_cells;",
        "  }",
        // chromatic aberration grows towards the edges
        "  vec2 d = (uv - 0.5) * u_texel * (2.2 + 1.5 * u_fx.x + 10.0 * u_gtint.w);",
        "  vec3 col;",
        "  col.r = tap(uv + d).r;",
        "  col.g = tap(uv).g;",
        "  col.b = tap(uv - d).b;",
        // chroma bleed: colour (not brightness) smears sideways to the right,
        // like composite video; strength also lengthens the smear
        "  if (u_bleed > 0.0) {",
        "    vec3 acc = vec3(0.0);",
        "    float wsum = 0.0;",
        "    float reach = 1.2 + 2.4 * u_bleed;",
        "    for (int i = 0; i < 7; i++) {",
        "      float fi = float(i);",
        "      float w = exp(-fi * 0.42);",
        "      acc += tap(uv - vec2(fi * reach, 0.0) * u_texel) * w;",
        "      wsum += w;",
        "    }",
        "    vec3 sm = acc / wsum;",
        "    float y0 = dot(col, vec3(0.299, 0.587, 0.114));",
        "    float ys = dot(sm, vec3(0.299, 0.587, 0.114));",
        "    col = vec3(y0) + mix(col - vec3(y0), sm - vec3(ys), u_bleed);",
        "  }",
        "  col = col * a_mul * d_mul + a_add;",
        // cheap bloom: wide cross + diagonal taps
        "  vec3 glow = vec3(0.0);",
        "  vec2 o = u_texel * 2.5;",
        "  glow += tap(uv + vec2( o.x, 0.0)) + tap(uv + vec2(-o.x, 0.0));",
        "  glow += tap(uv + vec2(0.0,  o.y)) + tap(uv + vec2(0.0, -o.y));",
        "  glow += tap(uv + o) + tap(uv - o);",
        "  glow += tap(uv + vec2(o.x, -o.y)) + tap(uv + vec2(-o.x, o.y));",
        "  glow /= 8.0;",
        "  col += glow * glow * 0.55;",
        // --- line of sight: lantern-lit view vs. cold remembered map ---
        "  if (u_los_amt > 0.0) {",
        "    float los = texture2D(u_los, uv).r;",
        "    vec2 q = vec2(uv.x, 1.0 - uv.y);",               // y down like u_player
        "    vec2 dp = (q - u_player) * vec2(u_aspect, 1.0);",
        "    float flick = 0.95 + 0.035 * sin(u_time * 7.3) + 0.02 * sin(u_time * 12.7 + 1.3);",
        "    float lantern = exp(-dot(dp, dp) * 5.0) * flick;",
        "    float luma = dot(col, vec3(0.299, 0.587, 0.114));",
        // inside: richer colour, lantern warmth falling off from the player
        "    vec3 inside = mix(vec3(luma), col, 1.18) * (1.0 + 0.45 * lantern)",
        "                + vec3(0.10, 0.06, 0.02) * lantern;",
        // outside: drained, cold, dimmer, with slow drifting fog
        "    vec3 cold = mix(col, vec3(luma), 0.72) * vec3(0.58, 0.70, 0.98) * 0.62;",
        "    vec2 fp = q * vec2(u_aspect, 1.0) * 5.0;",
        "    float fog = vnoise(fp + vec2(u_time * 0.07, u_time * 0.03))",
        "              * vnoise(fp * 0.5 - vec2(u_time * 0.02, 0.0));",
        "    cold += vec3(0.05, 0.07, 0.11) * fog * (1.0 - clamp(u_fx.x, 0.0, 1.0));",
        // berserk: the remembered map is red-dim like the rest, not cold blue
        "    cold = mix(cold, mix(col, vec3(luma), 0.3) * vec3(1.05, 0.38, 0.3) * 0.85,",
        "               clamp(u_fx.x, 0.0, 1.0));",
        "    vec3 mixed = mix(cold, inside, los);",
        // faint warm rim where sight ends
        "    float rim = clamp(los * (1.0 - los) * 4.0, 0.0, 1.0);",
        "    mixed += vec3(0.16, 0.11, 0.05) * rim * 0.35;",
        "    col = mix(col, mixed, u_los_amt);",
        "  }",
        // --- environmental lighting (owned by light.js; edit freely) ---
        // light map: rgb = light colour, a = intensity, already blurred
        "  if (u_light_on > 0.5) {",
        "    vec3 L = texture2D(u_light, uv).rgb;",
        // soft wide halo from a few wider taps so light spills further
        "    vec2 lo = u_texel * 24.0;",
        "    vec3 Lw = texture2D(u_light, uv + vec2(lo.x, 0.0)).rgb",
        "            + texture2D(u_light, uv - vec2(lo.x, 0.0)).rgb",
        "            + texture2D(u_light, uv + vec2(0.0, lo.y)).rgb",
        "            + texture2D(u_light, uv - vec2(0.0, lo.y)).rgb;",
        "    L = L + Lw * 0.22;",
        // lit surfaces brighten and take the light's tint; dark floor glows
        "    col += col * L * 2.6 + L * 0.32;",
        "  }",
        // --- end environmental lighting ---
        // aperture-grille phosphor mask
        "  vec2 gfc = floor(gl_FragCoord.xy / u_pxs);",
        "  float m = mod(gfc.x, 3.0);",
        "  vec3 mask = vec3(m < 1.0 ? 1.0 : 0.78, (m >= 1.0 && m < 2.0) ? 1.0 : 0.78, m >= 2.0 ? 1.0 : 0.78);",
        "  col *= mask * 1.18;",
        // scanlines in source-pixel-ish space so they stay crisp
        "  float scan = 0.84 + 0.16 * sin(gfc.y * 3.14159 * 0.66);",
        "  col *= scan;",
        // vignette + rounded tube corners
        "  vec2 e = v_uv * (1.0 - v_uv.yx);",
        "  float vig = pow(clamp(e.x * e.y * 18.0, 0.0, 1.0), 0.28);",
        "  vec2 q = abs(warp(v_uv) - 0.5) * 2.0;",
        "  float corner = 1.0 - smoothstep(0.96, 1.0, max(q.x, q.y));",
        "  col *= vig * corner;",
        // low-HP red bleed at the tube edge
        "  col.r += u_danger * (1.0 - vig) * 0.35 * (0.6 + 0.4 * sin(u_time * 5.0));",
        // berserk: blood-vein vignette on the heartbeat, red-orange midtones,
        // more contrast/saturation; crash = drained grey slump afterwards
        "  if (u_fx.x > 0.0 || ring > 0.0 || u_fxp.z > 0.0) {",
        "    float r = u_fx.x;",
        "    float ly = dot(col, vec3(0.299, 0.587, 0.114));",
        "    col = mix(vec3(ly), col, 1.0 + 0.1 * r);",
        "    col = mix(col, col * col * 1.7, 0.06 * r);",
        "    col *= mix(vec3(1.0), vec3(1.25, 0.62, 0.52), r);",
        "    vec2 vc = v_uv * 2.0 - 1.0;",
        "    float ve = smoothstep(0.3, 1.15, dot(vc, vc) * 0.5);",
        "    float vw = ve * r * (0.35 + 0.25 * u_fx.y);",
        "    col = mix(col, col * vec3(0.6, 0.08, 0.06), vw * 1.3);",
        "    col.r += ve * r * u_fx.y * 0.08;",
        // one red wash over the whole screen (it replaces the game's own
        // line-of-sight-only red flash): lifts unexplored black too
        "    col += vec3(0.17, 0.015, 0.02) * r * corner;",
        "    col += ring * vec3(1.0, 0.5, 0.3) * 0.45;",
        "    col = mix(col, vec3(ly) * vec3(1.0, 0.82, 0.8) * 0.85, u_fxp.z * 0.65);",
        "  }",
        // screen grade (api.grade): hue, desat, invert, tint, vignette
        "  if (u_ghue != 0.0) {",
        "    float ha = u_ghue * 6.28318;",
        "    float hc = cos(ha), hs = sin(ha);",
        "    mat3 hm = mat3(0.299 + 0.701 * hc + 0.168 * hs, 0.299 - 0.299 * hc - 0.328 * hs, 0.299 - 0.3 * hc + 1.25 * hs,",
        "                   0.587 - 0.587 * hc + 0.33 * hs, 0.587 + 0.413 * hc + 0.035 * hs, 0.587 - 0.588 * hc - 1.05 * hs,",
        "                   0.114 - 0.114 * hc - 0.497 * hs, 0.114 - 0.114 * hc + 0.292 * hs, 0.114 + 0.886 * hc - 0.203 * hs);",
        "    col = clamp(hm * col, 0.0, 1.0);",
        "  }",
        "  if (u_g1.x > 0.0)",
        "    col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), u_g1.x);",
        "  if (u_g1.y > 0.0) col = mix(col, 1.0 - col, u_g1.y);",
        "  if (u_g1.z > 0.0) col = mix(col, col * u_gtint.rgb, u_g1.z);",
        "  if (u_gvig.w > 0.0) {",
        "    vec2 gc = v_uv * 2.0 - 1.0;",
        "    col = mix(col, u_gvig.rgb, smoothstep(0.3, 1.2, dot(gc, gc) * 0.5) * u_gvig.w);",
        "  }",
        // flicker + grain
        "  col *= 0.97 + 0.03 * sin(u_time * 60.0);",
        "  col += (hash(gl_FragCoord.xy + u_time) - 0.5) * 0.035;",
        "  gl_FragColor = vec4(col, 1.0);",
        "}"]).join("\n");

    var gl = null, prog = null, tex = null, light_tex = null, los_tex = null;
    var alive_tex = null, alive_size = "", alive_err = false;
    var depth_tex = null, depth_size = "", depth_err = false;
    var screen = null;
    var uni = {};
    var gl_failed = false, raf = null, last_frame = 0;

    function init_gl()
    {
        if (gl || gl_failed) return !!gl;
        screen = document.createElement("canvas");
        screen.id = "sdc_screen";
        try
        {
            gl = screen.getContext("webgl", { alpha: false, antialias: false,
                                               preserveDrawingBuffer: false });
        }
        catch (e) { gl = null; }
        if (!gl)
        {
            gl_failed = true;
            return false;
        }

        var compile = function (type, src) {
            var s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
                throw new Error(gl.getShaderInfoLog(s));
            return s;
        };
        try
        {
            prog = gl.createProgram();
            gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
            gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
                throw new Error(gl.getProgramInfoLog(prog));
        }
        catch (e)
        {
            console.error("sdc: shader setup failed", e);
            gl = null;
            gl_failed = true;
            return false;
        }
        gl.useProgram(prog);

        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER,
                      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
                      gl.STATIC_DRAW);
        var loc = gl.getAttribLocation(prog, "a_pos");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        ["u_tex", "u_pxs", "u_res", "u_texel", "u_curve", "u_time", "u_danger", "u_bleed",
         "u_light", "u_light_on", "u_los", "u_los_amt", "u_player", "u_aspect",
         "u_alive", "u_alive_amt", "u_fx", "u_fxp", "u_shake",
         "u_g1", "u_gtint", "u_gvig", "u_ghue",
         "u_depth", "u_depth_amt", "u_depth_h", "u_depth_p", "u_depth_rot", "u_depth_zoom", "u_depth_hl", "u_depth_cells"]
            .forEach(function (n) { uni[n] = gl.getUniformLocation(prog, n); });

        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        var make_tex = function () {
            var t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return t;
        };
        los_tex = make_tex();
        light_tex = make_tex();
        alive_tex = make_tex();
        // cell data: exact texels, never interpolated
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        depth_tex = make_tex();
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        tex = make_tex();

        bind_mouse_forwarding();
        return true;
    }

    function curve()
    {
        return settings.filter === "curved" ? api.curve_k() : 0;
    }

    function frame(t)
    {
        raf = window.requestAnimationFrame(frame);
        // ~30 fps is plenty for a turn-based game
        if (t - last_frame < 32) return;
        last_frame = t;

        var dungeon = document.getElementById("dungeon");
        var visible = dungeon && in_game_view();
        if (visible)
        {
            update_anchor(dungeon.getBoundingClientRect());
            api.emit("frame", t);
        }
        var active = settings.filter !== "off" && visible
                     && dungeon.width > 0 && dungeon.height > 0;
        document.body.classList.toggle("sdc-mapview",
            dungeon_renderer.ui_state == enums.ui.VIEW_MAP);
        if (!active || !init_gl())
        {
            document.body.classList.remove("sdc-gl");
            return;
        }

        if (!screen.parentNode)
            document.getElementById("normal").appendChild(screen);

        var r = dungeon.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
        if (screen.width !== w || screen.height !== h)
        {
            screen.width = w;
            screen.height = h;
        }
        var st = screen.style;
        st.left = r.left + "px";
        st.top = r.top + "px";
        st.width = r.width + "px";
        st.height = r.height + "px";

        gl.viewport(0, 0, w, h);

        // environmental light map on texture unit 1
        var light_canvas = null;
        var light_fn = api.get_light_source();
        if (light_fn && settings.lighting !== false)
        {
            try { light_canvas = light_fn(); }
            catch (e) { console.error("sdc: light source failed", e); }
        }
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, light_tex);
        if (light_canvas && light_canvas.width > 0)
        {
            try
            {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA,
                              gl.UNSIGNED_BYTE, light_canvas);
            }
            catch (e) { light_canvas = null; }
        }
        gl.uniform1i(uni.u_light, 1);
        gl.uniform1f(uni.u_light_on, light_canvas ? 1 : 0);

        // line-of-sight mask on texture unit 2
        var los = null;
        var los_fn = api.get_los_source();
        if (los_fn)
        {
            try { los = los_fn(); }
            catch (e) { console.error("sdc: los source failed", e); }
        }
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, los_tex);
        if (los && los.canvas && los.canvas.width > 0)
        {
            try
            {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA,
                              gl.UNSIGNED_BYTE, los.canvas);
            }
            catch (e) { los = null; }
        }
        else
            los = null;
        gl.uniform1i(uni.u_los, 2);
        gl.uniform1f(uni.u_los_amt, los ? los.amount : 0);
        gl.uniform2f(uni.u_player, los ? los.px : 0.5, los ? los.py : 0.5);
        gl.uniform1f(uni.u_aspect, dungeon.width / Math.max(1, dungeon.height));
        gl.uniform1f(uni.u_bleed, settings.chroma_bleed === false ? 0
                     : Math.max(0, Math.min(1, (settings.bleed_amount || 0) / 100)));

        update_alive(t);
        update_depth(t);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        try
        {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA,
                          gl.UNSIGNED_BYTE, dungeon);
        }
        catch (e)
        {
            return;
        }
        gl.uniform1i(uni.u_tex, 0);
        gl.uniform1f(uni.u_pxs, Math.max(1, Math.round(dpr)));
        gl.uniform2f(uni.u_res, w, h);
        gl.uniform2f(uni.u_texel, 1 / dungeon.width, 1 / dungeon.height);
        gl.uniform1f(uni.u_curve, curve());
        gl.uniform1f(uni.u_time, t / 1000);
        gl.uniform1f(uni.u_danger,
            document.body.classList.contains("sdc-hp-danger") ? 1 : 0);
        // berserk fx store (api.set_fx); all zero when idle
        var fx = api.get_fx() || {};
        gl.uniform4f(uni.u_fx, fx.rage || 0, fx.beat || 0,
                     fx.shock_r || 0, fx.shock_a || 0);
        gl.uniform4f(uni.u_fxp, fx.px || 0.5, fx.py || 0.5, fx.crash || 0, 0);
        var gr = api.get_grade();
        gl.uniform2f(uni.u_shake, (fx.sx || 0) + gr.sx, (fx.sy || 0) + gr.sy);
        gl.uniform4f(uni.u_g1, gr.desat, gr.invert, gr.tint_a, gr.wobble);
        gl.uniform4f(uni.u_gtint, gr.tint[0], gr.tint[1], gr.tint[2], gr.smear);
        gl.uniform4f(uni.u_gvig, gr.vig[0], gr.vig[1], gr.vig[2], gr.vig_a);
        gl.uniform1f(uni.u_ghue, gr.hue);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        document.body.classList.add("sdc-gl");
        document.body.classList.toggle("sdc-curved", curve() > 0);
    }

    // Living tiles (alive.js) on texture unit 3. The data texture is only
    // re-uploaded when the source rebuilt it; otherwise just uniforms.
    function update_alive(t)
    {
        var a = null;
        var fn = api.get_alive_source();
        if (fn && settings.alive !== false)
        {
            try { a = fn(t); }
            catch (e)
            {
                a = null;
                if (!alive_err) console.error("sdc: alive source failed", e);
                alive_err = true;
            }
        }
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, alive_tex);
        gl.uniform1i(uni.u_alive, 3);
        if (a && a.data && a.cols > 0 && a.rows > 0
            && a.data.length === a.cols * a.rows * 4)
        {
            var size = a.cols + "x" + a.rows;
            if (a.dirty || size !== alive_size)
            {
                try
                {
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, a.cols, a.rows, 0,
                                  gl.RGBA, gl.UNSIGNED_BYTE, a.data);
                    alive_size = size;
                    a.dirty = false;
                }
                catch (e) { a = null; alive_size = ""; }
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            }
        }
        else
            a = null;
        gl.uniform1f(uni.u_alive_amt, a ? a.amt : 0);
        if (!a) return;
        for (var i = 0; i < a.uniforms.length; i++)
        {
            var name = a.uniforms[i][0], v = a.uniforms[i][1];
            if (!(name in uni))
                uni[name] = gl.getUniformLocation(prog, name);
            var loc = uni[name];
            if (!loc) continue;
            if (v.length === 1) gl.uniform1fv(loc, v);
            else if (v.length === 2) gl.uniform2fv(loc, v);
            else if (v.length === 3) gl.uniform3fv(loc, v);
            else gl.uniform4fv(loc, v);
        }
    }

    // depth: 2.5D view data (depth.js) on texture unit 4.
    function update_depth(t)
    {
        var a = null;
        var fn = api.get_depth_source();
        if (fn)
        {
            try { a = fn(t); }
            catch (e)
            {
                a = null;
                if (!depth_err) console.error("sdc: depth source failed", e);
                depth_err = true;
            }
        }
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, depth_tex);
        gl.uniform1i(uni.u_depth, 4);
        if (a && a.data && a.cols > 0 && a.rows > 0
            && a.data.length === a.cols * a.rows * 4)
        {
            var size = a.cols + "x" + a.rows;
            if (a.dirty || size !== depth_size)
            {
                try
                {
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, a.cols, a.rows, 0,
                                  gl.RGBA, gl.UNSIGNED_BYTE, a.data);
                    depth_size = size;
                    a.dirty = false;
                }
                catch (e) { a = null; depth_size = ""; }
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            }
        }
        else
            a = null;
        gl.uniform1f(uni.u_depth_amt, a ? a.amt : 0);
        if (!a) return;
        gl.uniform1f(uni.u_depth_h, a.h);
        gl.uniform1f(uni.u_depth_p, a.p);
        gl.uniform1f(uni.u_depth_rot, a.rot);
        gl.uniform1f(uni.u_depth_zoom, a.zoom);
        gl.uniform1f(uni.u_depth_hl, a.hl);
        gl.uniform2f(uni.u_depth_cells, a.cols, a.rows);
    }

    // The curved screen sits over the (invisible) dungeon canvas. Mouse events
    // are pushed through the same warp as the shader and re-dispatched to the
    // real canvas so clicks land on the tile that is drawn under the cursor.
    function bind_mouse_forwarding()
    {
        var types = ["mousemove", "mousedown", "mouseup", "click", "dblclick",
                     "contextmenu", "wheel"];
        types.forEach(function (type) {
            screen.addEventListener(type, forward_mouse);
        });
        screen.addEventListener("mouseleave", function () {
            var dungeon = document.getElementById("dungeon");
            if (dungeon)
                dungeon.dispatchEvent(new MouseEvent("mouseleave"));
        });
    }

    function forward_mouse(ev)
    {
        var dungeon = document.getElementById("dungeon");
        if (!dungeon) return;
        var r = screen.getBoundingClientRect();
        var k = curve();
        // same warp as the shader (y flipped there, symmetric anyway)
        var cx = ((ev.clientX - r.left) / r.width) * 2 - 1;
        var cy = ((ev.clientY - r.top) / r.height) * 2 - 1;
        var f = (1 + k * (cx * cx + cy * cy)) / (1 + k);
        cx *= f;
        cy *= f;
        if (ev.type === "contextmenu")
            ev.preventDefault();
        if (Math.abs(cx) > 1 || Math.abs(cy) > 1)
        {
            if (ev.type === "mousemove")
                dungeon.dispatchEvent(new MouseEvent("mouseleave"));
            return;
        }
        // depth: a raised wall top is drawn over the cell behind it
        var du = api.depth_unmap((cx + 1) / 2, (cy + 1) / 2);
        if (du[0] < 0 || du[0] > 1 || du[1] < 0 || du[1] > 1)
        {
            if (ev.type === "mousemove")
                dungeon.dispatchEvent(new MouseEvent("mouseleave"));
            return;
        }
        var init = {
            bubbles: true, cancelable: true, view: window,
            clientX: r.left + du[0] * r.width,
            clientY: r.top + du[1] * r.height,
            screenX: ev.screenX, screenY: ev.screenY,
            button: ev.button, buttons: ev.buttons,
            ctrlKey: ev.ctrlKey, shiftKey: ev.shiftKey,
            altKey: ev.altKey, metaKey: ev.metaKey,
        };
        var fwd;
        if (ev.type === "wheel")
        {
            init.deltaX = ev.deltaX;
            init.deltaY = ev.deltaY;
            init.deltaMode = ev.deltaMode;
            fwd = new WheelEvent("wheel", init);
        }
        else
            fwd = new MouseEvent(ev.type, init);
        if (!dungeon.dispatchEvent(fwd))
            ev.preventDefault();
        screen.style.cursor = window.getComputedStyle(dungeon).cursor;
    }

    // Lifecycle ---------------------------------------------------------------

    $(document).off("game_init.sdc").on("game_init.sdc", function () {
        build_hud();
        if (!document.getElementById("sdc_glass"))
            $("body").append('<div id="sdc_glass"></div>');
        document.removeEventListener("keydown", handle_keydown, true);
        document.addEventListener("keydown", handle_keydown, true);
        if (!raf)
            raf = window.requestAnimationFrame(frame);
        api.emit("game_init");
    });

    $(document).off("game_cleanup.sdc").on("game_cleanup.sdc", function () {
        if (raf)
            window.cancelAnimationFrame(raf);
        raf = null;
        if (stats_observer)
            stats_observer.disconnect();
        document.removeEventListener("keydown", handle_keydown, true);
        $("#sdc_glass").remove();
        if (screen && screen.parentNode)
            screen.parentNode.removeChild(screen);
        var b = document.body.classList;
        ["sdc-hud", "sdc-nomap", "sdc-monsters", "sdc-nostats",
         "sdc-filter", "sdc-gl", "sdc-curved", "sdc-mapview",
         "sdc-hp-warn", "sdc-hp-danger", "sdc-nosweep"].forEach(function (c) {
            b.remove(c);
        });
        api.emit("game_cleanup");
    });

    return {
        hud_active: hud_active,
        messages_overlay: messages_overlay,
        minimap_width: minimap_width,
        after_layout: after_layout,
        set_relayout: set_relayout,
        toggle: toggle,
    };
});
