// Splash text for nasty/nice events, in the phosphor "terminal" style
// (crt_splash.css): monospace, typed out with a block cursor; area entry
// shows a zone banner, death shows "YOU DIED / SIGNAL LOST".
//
// Events come from hud_update diffs (status lights gained/lost, HP/MP swings,
// XL, stats, AC/EV, place, piety) and a few game messages. Each splash
// appears just north of the player's tile (south if that does not fit), or in
// the centre of the dungeon view when the player's position is unknown; it
// holds briefly, then
// flies into the HUD element it belongs to (the matching status badge or the
// vitals panel) or fades. Banners (zone titles, death, level up, runes) are
// centred in the view.
//
// Debug: window.sdc_splash_test(text, kind, target)
//   kind   nice|heal|magic|epic|rage|travel|nasty|damage|poison|mind
//   target a status light ("Might"), "vitals", or omitted (fade out)
// window.sdc_splash_zone_test(place, depth)
//   place  "Lair", "Orcish Mines", "a bazaar", "Zot" ...; depth 0 = none
// window.sdc_splash_banner_test("death"|"glory")
define(["jquery", "./sdc_api", "./player", "./dungeon_renderer", "./enums"],
function ($, api, player, dungeon_renderer, enums) {
    "use strict";

    api.register_option({
        key: "splash", label: "Splash text", default: "major",
        choices: [["all", "All"], ["major", "Major only"], [false, "Off"]],
    });

    var MAX_ACTIVE = 3;
    var MAX_QUEUE = 4;
    var STAGGER = 110;         // ms between consecutive launches
    var DEDUPE = 900;          // ms: same text is not repeated within this
    var MSG_GRACE = 1500;      // ms after game_init before messages count

    var layer = null;
    var active = [];           // [{el, rect, banner}]
    var queue = [];
    var last_launch = 0;
    var recent = {};           // text -> time
    var pump_timer = null;
    var msg_observer = null;
    var init_time = 0;
    var have_state = false;    // seen a hud_update with prev
    var last_kill = 0;

    var reduce_motion = window.matchMedia
        && window.matchMedia("(prefers-reduced-motion: reduce)");

    var NASTY_KINDS = { nasty: 1, damage: 1, poison: 1, mind: 1 };

    function now()
    {
        return window.performance ? window.performance.now() : Date.now();
    }

    function pick(list)
    {
        return list[Math.floor(Math.random() * list.length)];
    }

    function mode()
    {
        var m = api.get("splash");
        if (m === true) return "all";
        return m || false;
    }

    function reduced()
    {
        return !!(reduce_motion && reduce_motion.matches);
    }

    // Zone titles -------------------------------------------------------------

    // branch shortname (as sent in player.place, minus any article) -> title
    var ZONES = {
        "dungeon": "The Dungeon",
        "temple": "Ecumenical Temple",
        "orcish mines": "Orcish Mines",
        "elven halls": "Elven Halls",
        "dwarven hall": "Dwarven Hall",
        "lair": "Lair of Beasts",
        "swamp": "The Swamp",
        "shoals": "The Shoals",
        "snake pit": "Snake Pit",
        "spider nest": "Spider Nest",
        "slime pits": "Pits of Slime",
        "vaults": "The Vaults",
        "hall of blades": "Hall of Blades",
        "crypt": "The Crypt",
        "tomb": "Tomb of the Ancients",
        "depths": "The Depths",
        "hell": "Vestibule of Hell",
        "dis": "Iron City of Dis",
        "gehenna": "Gehenna",
        "cocytus": "Cocytus",
        "tartarus": "Tartarus",
        "zot": "Realm of Zot",
        "forest": "Enchanted Forest",
        "abyss": "The Abyss",
        "pandemonium": "Pandemonium",
        "ziggurat": "Ziggurat",
        "labyrinth": "Labyrinth",
        "bazaar": "Bazaar",
        "trove": "Treasure Trove",
        "sewer": "The Sewers",
        "ossuary": "Ossuary",
        "bailey": "Bailey",
        "gauntlet": "Gauntlet",
        "ice cave": "Ice Cave",
        "volcano": "Volcano",
        "wizlab": "Wizard's Laboratory",
        "desolation": "Desolation of Salt",
        "arena": "The Arena",
        "crucible": "Crucible of Flesh",
        "necropolis": "Necropolis",
        "gulch": "Gutter Gulch",
    };
    // abbreviations (debug hook, older servers)
    var ZONE_ABBR = {
        "d": "dungeon", "orc": "orcish mines", "elf": "elven halls",
        "dwarf": "dwarven hall", "snake": "snake pit", "spider": "spider nest",
        "slime": "slime pits", "blade": "hall of blades", "geh": "gehenna",
        "coc": "cocytus", "tar": "tartarus", "pan": "pandemonium",
        "zig": "ziggurat", "lab": "labyrinth", "icecv": "ice cave",
        "vestibule": "hell",
    };

    function zone_title(place)
    {
        var p = strip(place).replace(/^(the|an?)\s+/i, "");
        var k = p.toLowerCase();
        k = ZONE_ABBR[k] || k;
        return ZONES[k] || p;
    }

    function zone_event(place, depth, branch_change)
    {
        return {
            text: strip(place).toUpperCase() + (depth ? ":" + depth : ""),
            kind: "travel", major: branch_change,
            size: branch_change ? 2.6 : 1.8, prio: branch_change ? 6 : 2,
            banner: "zone",
            zone: { title: zone_title(place), depth: depth || 0,
                    minor: !branch_change },
        };
    }

    // Status lights ------------------------------------------------------------

    // base light word (before any " (3)" counter) -> splash
    // major: shown in "Major only" mode. Trailing "!" is stripped for display.
    var GAIN = {
        "Might":     { text: "MIGHT!", kind: "nice", major: true },
        "Fast":      { text: "HASTE!", kind: "nice", major: true },
        "Berserk":   { text: "BERSERK", kind: "rage",
                       major: true },
        "Hero":      { text: "HEROISM!", kind: "nice", major: true },
        "Finesse":   { text: "FINESSE!", kind: "nice", major: true },
        "Agi":       { text: "AGILITY!", kind: "nice" },
        "Brill":     { text: "BRILLIANCE!", kind: "magic" },
        "Resist":    { text: "RESIST!", kind: "nice" },
        "Swift":     { text: "SWIFT!", kind: "nice" },
        "Invis":     { text: "INVISIBLE", kind: "magic" },
        "Fly":       { text: "FLIGHT", kind: "magic" },
        "Regen":     { text: "REGENERATION", kind: "heal" },
        "DDoor":     { text: "DEATH'S DOOR!", kind: "epic", major: true },
        "Tele":      { text: "TELEPORTING", kind: "magic" },
        "Orb":       { text: "THE ORB OF ZOT",
                       psub: "Now flee", kind: "epic", major: true,
                       banner: "glory" },
        "Slow":      { text: "SLOWED!", kind: "nasty", major: true },
        "Exh":       { text: "EXHAUSTED", kind: "nasty" },
        "Pois":      { text: "POISONED!", kind: "poison", major: true },
        "Sick":      { text: "SICK!", kind: "poison" },
        "Corr":      { text: "CORRODED!", kind: "poison", major: true },
        "Conf":      { text: "CONFUSED!", kind: "mind", major: true },
        "Para":      { text: "PARALYSED!", kind: "nasty", major: true },
        "Petr":      { text: "PETRIFYING!", kind: "nasty", major: true },
        "Stone":     { text: "TURNED TO STONE",
                       kind: "nasty", major: true },
        "Fear":      { text: "FEAR!", kind: "mind", major: true },
        "Horr":      { text: "HORROR!", kind: "mind", major: true },
        "Mesm":      { text: "MESMERISED!", kind: "mind", major: true },
        "Vexed":     { text: "VEXED!", kind: "mind" },
        "Vertigo":   { text: "VERTIGO", kind: "mind" },
        "Will/2":    { text: "WILL BROKEN!", kind: "mind" },
        "Corona":    { text: "GLOWING!", kind: "nasty" },
        "-Tele":     { text: "TELEPORT SEALED",
                       kind: "nasty" },
        "-Move":     { text: "STUCK!", kind: "nasty" },
        "-Cast":     { text: "SPELLS SEALED",
                       kind: "nasty" },
        "Weak":      { text: "WEAKENED!", kind: "nasty", major: true },
        "Fragile":   { text: "FRAGILE!", kind: "nasty" },
        "Blind":     { text: "BLINDED!", kind: "nasty", major: true },
        "Drain":     { text: "DRAINED!", kind: "nasty", major: true },
        "Held":      { text: "SEIZED", kind: "nasty",
                       major: true },
        "Constr":    { text: "CONSTRICTED", kind: "nasty",
                       major: true },
        "Flay":      { text: "FLAYED!", kind: "damage", major: true },
        "Barbs":     { text: "BARBED!", kind: "damage" },
        "Fire":      { text: "BURNING!", kind: "damage", major: true },
        "Frozen":    { text: "FROZEN!", kind: "nasty", major: true },
        "Dim":       { text: "DIMMED!", kind: "nasty" },
        "Sil":       { text: "SILENCE!", kind: "magic" },
        "Toxic":     { text: "TOXIC!", kind: "poison" },
        "Sap":       { text: "SAPPED!", kind: "mind" },
        "rF-":       { text: "rF-", kind: "nasty" },
        "rP-":       { text: "rP-", kind: "poison" },
    };

    var LOSE = {
        "Pois":   { text: "CURED!", kind: "heal" },
        "Para":   { text: "FREED", kind: "nice", major: true },
        "Petr":   { text: "STONE RECEDES", kind: "nice",
                    major: true },
        "Conf":   { text: "CLARITY", kind: "nice" },
        "Held":   { text: "ESCAPED!", kind: "nice" },
        "Constr": { text: "ESCAPED!", kind: "nice" },
        "Mesm":   { text: "MIND CLEARED", kind: "nice" },
        "Fear":   { text: "COURAGE!", kind: "nice" },
        "Slow":   { text: "UNSLOWED", kind: "nice" },
    };

    // fallback by crawl colour for lights not in the table ("all" mode only)
    var NASTY_COLS = { 4: 1, 5: 1, 12: 1, 13: 1 };
    var NICE_COLS = { 1: 1, 2: 1, 3: 1, 9: 1, 10: 1, 11: 1 };

    function strip(s)
    {
        return String(s || "").replace(/<[^>]*>/g, "").trim();
    }

    function base_light(light)
    {
        return strip(light).split(/[\s(]/)[0];
    }

    function light_map(status)
    {
        var m = {};
        (status || []).forEach(function (st) {
            if (!st.light) return;
            var b = base_light(st.light);
            if (b) m[b] = st;
        });
        return m;
    }

    function pad2(n)
    {
        return (n < 10 ? "0" : "") + n;
    }

    // Event detection ---------------------------------------------------------

    function on_hud_update(pl, prev)
    {
        if (!prev)
        {
            have_state = false;
            return;
        }
        have_state = true;
        var m = mode();
        if (!m) return;

        var ev = [];
        function add(e)
        {
            if (!e) return;
            if (m === "major" && !e.major) return;
            ev.push(e);
        }

        // statuses
        var now_l = light_map(pl.status);
        var prev_l = light_map(prev.status);
        var lost_any = false;
        Object.keys(now_l).forEach(function (b) {
            if (prev_l[b]) return;
            var def = GAIN[b];
            if (!def)
            {
                // unknown light: cooldowns ("-Foo") are noise
                if (b.charAt(0) === "-") return;
                var col = now_l[b].col;
                if (!NASTY_COLS[col] && !NICE_COLS[col]) return;
                def = { text: b.toUpperCase() + "!",
                        kind: NASTY_COLS[col] ? "nasty" : "nice" };
            }
            add($.extend({ target: b, prio: def.major ? 6 : 3, size: 2 }, def));
        });
        Object.keys(prev_l).forEach(function (b) {
            if (now_l[b]) return;
            lost_any = true;
            var def = LOSE[b];
            if (def)
                add($.extend({ prio: def.major ? 5 : 2, size: 1.5 }, def));
        });

        var xl_up = pl.xl > prev.xl;

        // HP
        var max = pl.hp_max || 1;
        var dmg = prev.hp - pl.hp;
        if (pl.hp <= 0 && prev.hp > 0)
            add(death_event());
        else if (dmg > 0)
        {
            var f = dmg / max;
            var e = null;
            if (f >= 0.5)
                e = { text: "GRIEVOUS WOUND", size: 4 };
            else if (f >= 0.35)
                e = { text: "HEAVY BLOW", size: 3.2 };
            else if (f >= 0.25)
                e = { text: "WOUNDED", size: 2.6 };
            else if (f >= 0.15)
                e = { text: "STRUCK", size: 2.1 };
            else if (f >= 0.08)
                e = { text: "GRAZED", size: 1.5, minor: true };
            if (e)
                add($.extend({ kind: "damage", major: !e.minor,
                               prio: 4 + e.size, target: "vitals",
                               alt: { terminal: "HP -" + dmg } }, e));
        }
        else if (dmg < 0 && !xl_up && pl.hp_max === prev.hp_max
                 && -dmg / max >= 0.25)
        {
            add({ text: "RESTORED", alt: { terminal: "HP +" + (-dmg) },
                  kind: "heal", major: -dmg / max >= 0.4, size: 2.2, prio: 5,
                  target: "vitals" });
        }
        if (pl.hp > 0 && pl.hp / max <= 0.25
            && prev.hp / (prev.hp_max || 1) > 0.25)
        {
            add({ text: "DANGER", alt: { terminal: "WARNING: HP CRITICAL" },
                  kind: "nasty", major: true, size: 2.4, prio: 7,
                  target: "vitals" });
        }

        // MP
        if (pl.mp_max > 0 && pl.mp - prev.mp >= 5 && !xl_up
            && (pl.mp - prev.mp) / pl.mp_max >= 0.4)
        {
            add({ text: "MANA RESTORED",
                  alt: { terminal: "MP +" + (pl.mp - prev.mp) },
                  kind: "magic", size: 1.8, prio: 3, target: "vitals" });
        }

        // XL
        if (xl_up)
            add(level_event(pl.xl));

        // stats (skip when a status ended: Might/Brill/Agi expiring)
        if (!lost_any)
        {
            ["str", "int", "dex"].forEach(function (k) {
                var d = pl[k] - prev[k];
                if (typeof d !== "number" || !isFinite(d) || d === 0) return;
                if (d < 0)
                    add({ text: k.toUpperCase() + " " + d + "!", kind: "nasty",
                          major: true, size: 1.9, prio: 5 });
                else if (!(base_gain(now_l, prev_l)))
                    add({ text: k.toUpperCase() + " +" + d + "!", kind: "nice",
                          major: xl_up, size: 1.7, prio: 4 });
            });
        }

        // AC / EV (gear swaps, corrosion ...). A lone 1-point change is noise,
        // but when both move in the same update they share one splash, so
        // "AC +1" next to "EV -2" is not lost ("AC +1 / EV -2").
        var acev = [];
        ["ac", "ev"].forEach(function (k) {
            var d = pl[k] - prev[k];
            if (typeof d === "number" && isFinite(d) && d !== 0)
                acev.push({ k: k, d: d });
        });
        var acev_big = acev.some(function (c) { return Math.abs(c.d) >= 2; });
        if (acev.length === 2 || acev_big)
        {
            var net = acev.reduce(function (s, c) { return s + c.d; }, 0);
            add({ text: acev.map(function (c) {
                      return c.k.toUpperCase() + (c.d > 0 ? " +" : " ") + c.d;
                  }).join(" / "),
                  kind: net > 0 ? "nice" : "nasty", size: 1.4, prio: 1 });
        }

        // place
        if (pl.place && prev.place !== undefined
            && (pl.place !== prev.place || pl.depth !== prev.depth))
        {
            add(zone_event(pl.place, pl.depth, pl.place !== prev.place));
        }

        // god / piety
        // Uskayaw's piety moves constantly (it is fed by combat), so a
        // "blessed" splash on every rank change would be noise.
        if (pl.god && pl.god === prev.god && !/uskayaw/i.test(strip(pl.god))
            && pl.piety_rank > prev.piety_rank && prev.piety_rank >= 0)
        {
            add({ text: "BLESSED!", kind: "epic", major: true, size: 2.4,
                  prio: 6, sub: strip(pl.god).toUpperCase() + " "
                       + new Array(pl.piety_rank + 1).join("*") });
        }
        else if (pl.god && !prev.god)
        {
            add({ text: strip(pl.god).toUpperCase() + "!", kind: "epic",
                  major: true, size: 2.6, prio: 6, sub: "YOU JOIN",
                  psub: "Sworn to" });
        }

        ev.sort(function (a, b) { return b.prio - a.prio; });
        ev.slice(0, MAX_ACTIVE).forEach(enqueue);
    }

    function base_gain(now_l, prev_l)
    {
        return Object.keys(now_l).some(function (b) { return !prev_l[b]; });
    }

    function death_event()
    {
        return { text: "YOU DIED", kind: "damage",
                 major: true, size: 4, prio: 10, target: "vitals",
                 banner: "death",
                 alt: { terminal: { text: "YOU DIED", sub: "SIGNAL LOST" } } };
    }

    function level_event(xl)
    {
        return { text: "LEVEL ATTAINED", kind: "epic",
                 major: true, size: 3.2, prio: 9, target: "vitals",
                 sub: "XL " + xl, psub: "Experience Level " + xl,
                 banner: "glory",
                 alt: { terminal: { text: "LEVEL UP", sub: "XL " + pad2(xl) } } };
    }

    // Game messages -----------------------------------------------------------

    var MESSAGES = [
        { re: /^You die\.\.\./, death: true },
        { re: /rune of Zot/i, need: /^You pick up/,
          e: { text: "RUNE ACQUIRED", kind: "epic",
               major: true, size: 3.2, prio: 9, banner: "glory" } },
        { re: /^You pick up the Orb of Zot/,
          e: { text: "THE ORB OF ZOT",  psub: "Now flee",
               kind: "epic", major: true, size: 4, prio: 10,
               banner: "glory" } },
        { re: /^You fall through a shaft|^You fall through a trap ?door|^You fall into/,
          e: { text: "YOU FALL", kind: "nasty", major: true,
               size: 2.6, prio: 7 } },
        { re: /\b(explodes|blows up|is blown up)\b/,
          e: { text: "EXPLOSION", kind: "damage", size: 2.2,
               prio: 3 } },
        { re: /^You (kill|destroy) /, kill: true,
          e: { text: "ENEMY FELLED", kind: "rage", size: 1.6, prio: 2,
               alt: { terminal: "TARGET DESTROYED" } } },
    ];

    function on_message_nodes(records)
    {
        var m = mode();
        if (!m || !have_state || now() - init_time < MSG_GRACE) return;
        records.forEach(function (r) {
            Array.prototype.forEach.call(r.addedNodes, function (node) {
                if (node.nodeType !== 1
                    || !node.classList.contains("game_message"))
                {
                    return;
                }
                handle_message((node.textContent || "").trim(), m);
            });
        });
    }

    function handle_message(text, m)
    {
        for (var i = 0; i < MESSAGES.length; i++)
        {
            var d = MESSAGES[i];
            if (!d.re.test(text) || (d.need && !d.need.test(text)))
                continue;
            var e = d.death ? death_event() : $.extend({}, d.e);
            if (d.kill)
            {
                if (now() - last_kill < 1200) return;
                last_kill = now();
            }
            if (m === "major" && !e.major) return;
            enqueue(e);
            return;
        }
    }

    function watch_messages()
    {
        if (msg_observer)
            msg_observer.disconnect();
        var el = document.getElementById("messages");
        if (!el || !window.MutationObserver) return;
        msg_observer = new MutationObserver(on_message_nodes);
        msg_observer.observe(el, { childList: true });
    }

    // Queue -------------------------------------------------------------------

    function enqueue(e)
    {
        var t = now();
        var window_ms = e.banner ? DEDUPE * 4 : DEDUPE;
        if (recent[e.text] && t - recent[e.text] < window_ms) return;
        recent[e.text] = t;
        queue.push(e);
        queue.sort(function (a, b) { return (b.prio || 0) - (a.prio || 0); });
        if (queue.length > MAX_QUEUE)
            queue.length = MAX_QUEUE;
        pump();
    }

    function pump()
    {
        if (pump_timer || !queue.length || active.length >= MAX_ACTIVE)
            return;
        var wait = last_launch + STAGGER - now();
        if (wait > 0)
        {
            pump_timer = window.setTimeout(function () {
                pump_timer = null;
                pump();
            }, wait);
            return;
        }
        last_launch = now();
        launch(queue.shift());
        pump();
    }

    // Geometry ----------------------------------------------------------------

    function ensure_layer()
    {
        if (layer && document.body.contains(layer))
            return layer;
        layer = document.createElement("div");
        layer.id = "sdc_splash";
        layer.setAttribute("data-style", "terminal");
        var host = document.getElementById("normal") || document.body;
        host.appendChild(layer);
        return layer;
    }

    function view_rect()
    {
        var c = document.getElementById("dungeon");
        var r = c && c.getBoundingClientRect();
        if (!r || r.width < 50 || r.height < 50)
            r = { left: 0, top: 0, width: window.innerWidth,
                  height: window.innerHeight };
        // visible part only
        var left = Math.max(0, r.left), top = Math.max(0, r.top);
        var right = Math.min(window.innerWidth, r.left + r.width);
        var bottom = Math.min(window.innerHeight, r.top + r.height);
        if (right - left < 50 || bottom - top < 50)
        {
            left = 0; top = 0;
            right = window.innerWidth; bottom = window.innerHeight;
        }
        return { left: left, top: top, right: right, bottom: bottom,
                 width: right - left, height: bottom - top };
    }

    // Player tile centre in client px, plus the cell size; null if unknown.
    // Map coords are player-relative here, but player.pos is used anyway.
    function player_anchor()
    {
        var c = document.getElementById("dungeon");
        var dr = dungeon_renderer;
        if (!c || !dr || !dr.cols || !dr.rows || !dr.view || !player.pos)
            return null;
        if (dr.ui_state == enums.ui.VIEW_MAP)
            return null;
        var r = c.getBoundingClientRect();
        if (r.width < 50 || r.height < 50) return null;
        var fx = (player.pos.x - dr.view.x + 0.5) / dr.cols;
        var fy = (player.pos.y - dr.view.y + 0.5) / dr.rows;
        if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return null;
        var cw = r.width / dr.cols, ch = r.height / dr.rows;

        // The curved CRT shader samples texture uv = warp(screen uv); invert
        // it so the anchor sits on the tile as displayed.
        var b = document.body.classList;
        if (b.contains("sdc-gl") && b.contains("sdc-curved"))
        {
            var k = api.curve_k();
            var tx = fx * 2 - 1, ty = fy * 2 - 1;
            var sx = tx, sy = ty, g = 1;
            for (var i = 0; i < 6; i++)
            {
                g = (1 + k * (sx * sx + sy * sy)) / (1 + k);
                sx = tx / g;
                sy = ty / g;
            }
            fx = (sx + 1) / 2;
            fy = (sy + 1) / 2;
            cw /= g;
            ch /= g;
        }
        return { x: r.left + fx * r.width, y: r.top + fy * r.height,
                 cw: cw, ch: ch };
    }
    api.set_player_anchor(player_anchor);

    function box(x, y, w, h)
    {
        return { left: x - w / 2, right: x + w / 2,
                 top: y - h / 2, bottom: y + h / 2 };
    }

    function overlaps(a, b, m)
    {
        m = m || 0;
        return a.left < b.right + m && a.right > b.left - m
            && a.top < b.bottom + m && a.bottom > b.top - m;
    }

    function fits(r, vr)
    {
        return r.left >= vr.left && r.right <= vr.right
            && r.top >= vr.top && r.bottom <= vr.bottom;
    }

    function clamp_pos(p, w, h, vr)
    {
        var m = 6;
        var x = p.x, y = p.y;
        if (w + 2 * m >= vr.width) x = vr.left + vr.width / 2;
        else x = Math.max(vr.left + m + w / 2, Math.min(vr.right - m - w / 2, x));
        if (h + 2 * m >= vr.height) y = vr.top + vr.height / 2;
        else y = Math.max(vr.top + m + h / 2, Math.min(vr.bottom - m - h / 2, y));
        return { x: x, y: y };
    }

    // visual extent of a splash relative to its layout box (rules, sparks)
    var PAD = [1.06, 1.12];

    function others()
    {
        return active.filter(function (a) { return !a.banner && a.rect; });
    }

    // move p away from the player (dir "north" or "south") until it clears
    // the other splashes
    function push_clear(p, dir, w, h)
    {
        var list = others();
        var gap = 4;
        for (var n = 0; n < 8; n++)
        {
            var r = box(p.x, p.y, w, h);
            var hit = null;
            for (var i = 0; i < list.length; i++)
            {
                if (overlaps(r, list[i].rect, gap)) { hit = list[i].rect; break; }
            }
            if (!hit) break;
            if (dir === "north") p.y = hit.top - gap - h / 2;
            else p.y = hit.bottom + gap + h / 2;
        }
        return p;
    }

    function free_of_others(r)
    {
        return !others().some(function (a) { return overlaps(r, a.rect, 2); });
    }

    function place_splash(w0, h0)
    {
        var vr = view_rect();
        var w = w0 * PAD[0], h = h0 * PAD[1];
        var pa = player_anchor();

        if (!pa)
        {
            var c = { x: vr.left + vr.width / 2, y: vr.top + vr.height * 0.45 };
            c = clamp_pos(push_clear(c, "north", w, h), w, h, vr);
            if (!free_of_others(box(c.x, c.y, w, h)))
            {
                c = { x: vr.left + vr.width / 2,
                      y: vr.top + vr.height * 0.45 };
                c = clamp_pos(push_clear(c, "south", w, h), w, h, vr);
            }
            return { x: c.x, y: c.y, rect: box(c.x, c.y, w, h) };
        }

        var tile = box(pa.x, pa.y, pa.cw * 1.4, pa.ch * 1.4);
        function base(dir)
        {
            var gy = pa.ch * 1.0;
            if (dir === "north")
                return { x: pa.x, y: pa.y - pa.ch / 2 - gy - h / 2 };
            return { x: pa.x, y: pa.y + pa.ch / 2 + gy + h / 2 };
        }

        // candidates in order of preference: north of the player, then south
        var tries = ["north", "south"];

        var fallback = null;
        for (var i = 0; i < tries.length; i++)
        {
            var p = push_clear(base(tries[i]), tries[i], w, h);
            var r = box(p.x, p.y, w, h);
            if (fits(r, vr) && !overlaps(r, tile))
                return { x: p.x, y: p.y, rect: r };
            var q = clamp_pos(p, w, h, vr);
            var rq = box(q.x, q.y, w, h);
            if (!fallback && !overlaps(rq, tile))
                fallback = { x: q.x, y: q.y, rect: rq };
        }
        if (fallback) return fallback;
        var b = clamp_pos(base("north"), w, h, vr);
        return { x: b.x, y: b.y, rect: box(b.x, b.y, w, h) };
    }

    // banners: centred horizontally; zone titles in the upper third, death
    // in the middle. Never on top of the player (except death).
    function place_banner(kind, w, h)
    {
        var vr = view_rect();
        var x = vr.left + vr.width / 2;
        var y = vr.top + vr.height * (kind === "death" ? 0.45
                                      : kind === "zone" ? 0.22 : 0.3);
        var p = clamp_pos({ x: x, y: y }, w, h, vr);
        active.forEach(function (a) {
            if (a.banner && a.rect && overlaps(box(p.x, p.y, w, h), a.rect, 6))
                p.y = a.rect.bottom + 6 + h / 2;
        });
        if (kind !== "death")
        {
            var pa = player_anchor();
            if (pa)
            {
                var guard = box(pa.x, pa.y, pa.cw * 3, pa.ch * 3);
                if (overlaps(box(p.x, p.y, w, h), guard))
                {
                    p.y = guard.top - h / 2;
                    if (p.y - h / 2 < vr.top)
                        p.y = guard.bottom + h / 2;
                }
            }
        }
        return { x: p.x, y: p.y, rect: box(p.x, p.y, w, h) };
    }

    function find_target_el(target)
    {
        if (!target) return null;
        if (target === "vitals")
            return document.getElementById("sdc_vitals");
        var badges = document.querySelectorAll(
            "#sdc_statuses .sdc-status[data-light]");
        for (var i = 0; i < badges.length; i++)
        {
            if (base_light(badges[i].getAttribute("data-light")) === target)
                return badges[i];
        }
        return null;
    }

    function find_target(target)
    {
        var el = find_target_el(target);
        if (!el) return null;
        var r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return null;
        return r;
    }

    // a quick "landed" flash on the badge / vitals panel
    function flash_target(target)
    {
        var el = find_target_el(target);
        if (!el || !el.animate) return;
        el.animate([{ filter: "brightness(2.2)" }, { filter: "none" }],
                   { duration: 260, easing: "ease-out" });
    }

    // Building ----------------------------------------------------------------

    function div(cls, text)
    {
        var d = document.createElement("div");
        d.className = cls;
        if (text != null) d.textContent = text;
        return d;
    }

    function span(cls, text)
    {
        var s = document.createElement("span");
        s.className = cls;
        if (text != null) s.textContent = text;
        return s;
    }

    // text/sub (terminal wording)
    function words(e)
    {
        var alt = e.alt && e.alt.terminal;
        if (typeof alt === "string") alt = { text: alt };
        alt = alt || {};
        var text = alt.text || String(e.text).replace(/!+/g, "").trim();
        var sub = alt.sub !== undefined ? alt.sub
                  : (e.psub !== undefined ? e.psub : e.sub);
        text = text.toUpperCase();
        if (sub) sub = String(sub).toUpperCase();
        return { text: text, sub: sub || null };
    }

    var BUILD = {
        terminal: function (el, e, banner) {
            var wd = words(e);
            if (banner === "zone")
            {
                wd = { text: e.zone.title.toUpperCase(),
                       sub: e.zone.depth ? "DEPTH " + pad2(e.zone.depth)
                                         : "PORTAL" };
                if (e.zone.minor) el.classList.add("sdc-minor");
            }
            var prompt = banner === "zone" ? ">> "
                       : NASTY_KINDS[e.kind] ? "! " : "> ";
            var lines = [];
            function line(cls, text, pfx)
            {
                var l = div("tm-line " + cls);
                if (pfx) l.appendChild(span("tm-prompt", pfx));
                var typed = span("tm-typed", "");
                var ghost = span("tm-ghost", text);
                l.appendChild(typed);
                l.appendChild(ghost);
                el.appendChild(l);
                lines.push({ el: l, typed: typed, ghost: ghost, text: text });
            }
            line("tm-main", wd.text, prompt);
            if (wd.sub)
                line("tm-sub", wd.sub, "");
            var cursor = span("tm-cursor", "");
            lines[0].el.insertBefore(cursor, lines[0].ghost);
            return { lines: lines, cursor: cursor };
        },

    };

    // Animation ---------------------------------------------------------------

    function at(x, y)
    {
        return "translate(" + x + "px," + y + "px) translate(-50%,-50%) ";
    }

    // fly from the current spot into the target badge; false if no target
    function fly_to_target(el, e, x, y, from, rot, dur, done)
    {
        var tr = find_target(e.target);
        if (!tr) return false;
        var tx = tr.left + tr.width / 2;
        var ty = tr.top + tr.height / 2;
        var s = Math.max(0.08, Math.min(0.6,
            (tr.height * 1.6) / Math.max(1, el.offsetHeight)));
        var to = at(tx, ty) + "rotate(0deg) scale(" + s + ")";
        var mid = at((x + tx) / 2, (y + ty) / 2 - 30) + "rotate("
                  + (rot * 0.3) + "deg) scale(" + ((1 + s) / 2) + ")";
        el.animate([
            { transform: from, opacity: 1 },
            { transform: mid, opacity: 1, offset: 0.55 },
            { transform: to, opacity: 0.85, offset: 0.9 },
            { transform: to, opacity: 0 },
        ], { duration: dur, easing: "cubic-bezier(.5,0,.75,0)",
             fill: "forwards" }).onfinish = function () {
            flash_target(e.target);
            done();
        };
        return true;
    }

    function simple_fade(el, x, y, total, done)
    {
        el.style.transform = at(x, y);
        el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 },
                    { opacity: 1, offset: 0.75 }, { opacity: 0 }],
                   { duration: total, fill: "forwards" }).onfinish = done;
    }

    function later(el, ms, fn)
    {
        window.setTimeout(function () {
            if (el.parentNode) fn();
        }, ms);
    }

    var ANIM = {
        terminal: function (el, e, x, y, done, parts, banner) {
            var hold = banner === "death" ? 3600 : banner ? 2200
                     : 750 + Math.min(4, e.size || 2) * 120;
            var pos = at(x, y);
            el.style.transform = pos;
            var lines = parts.lines;
            if (reduced())
            {
                lines.forEach(function (l) {
                    l.typed.textContent = l.text;
                    l.ghost.textContent = "";
                });
                simple_fade(el, x, y, hold + 700, function () {
                    flash_target(e.target);
                    done();
                });
                return;
            }
            // power-on line, then type
            el.animate([
                { opacity: 0, transform: pos + "scale(0.6, 0.04)" },
                { opacity: 1, transform: pos + "scale(1, 0.04)", offset: 0.45 },
                { opacity: 1, transform: pos + "scale(1, 1)" },
            ], { duration: 150, easing: "ease-out", fill: "forwards" });

            var li = 0, ci = 0;
            function tick()
            {
                if (!el.parentNode) return;
                var l = lines[li];
                if (!l) return after_typing();
                var step = Math.max(1, Math.ceil(l.text.length / 16));
                ci = Math.min(l.text.length, ci + step);
                l.typed.textContent = l.text.slice(0, ci);
                l.ghost.textContent = l.text.slice(ci);
                if (ci >= l.text.length)
                {
                    li++;
                    ci = 0;
                    var nl = lines[li];
                    if (nl) nl.el.insertBefore(parts.cursor, nl.ghost);
                    else l.el.appendChild(parts.cursor);
                    window.setTimeout(tick, nl ? 120 : 0);
                    return;
                }
                window.setTimeout(tick, 24 + Math.random() * 18);
            }
            later(el, 150, tick);

            function after_typing()
            {
                later(el, hold, function () {
                    if (fly_to_target(el, e, x, y, pos + "scale(1)", 0, 420,
                                      done))
                        return;
                    // CRT power-off
                    el.animate([
                        { opacity: 1, transform: pos + "scale(1, 1)" },
                        { opacity: 1, transform: pos + "scale(1, 0.03)",
                          offset: 0.55 },
                        { opacity: 0, transform: pos + "scale(0, 0.03)" },
                    ], { duration: 260, easing: "ease-in",
                         fill: "forwards" }).onfinish = done;
                });
            }
        },

    };

    function launch(e)
    {
        if (!e) return;
        var host = ensure_layer();
        var banner = e.banner || null;
        var kind = e.kind || "nice";

        var el = document.createElement("div");
        el.className = "sdc-splash sdc-splash-" + kind;
        el.setAttribute("data-style", "terminal");
        el.setAttribute("data-tone", NASTY_KINDS[kind] ? "nasty" : "nice");
        if (banner) el.setAttribute("data-banner", banner);
        var sz = Math.min(4, e.size || 2);
        el.style.setProperty("--q", (0.7 + 0.3 * sz).toFixed(3));
        var parts = BUILD.terminal(el, e, banner) || {};
        host.appendChild(el);

        var vr = view_rect();
        if (banner === "death")
            el.style.width = vr.width + "px";
        else if (banner === "glory")
        {
            // ~40% of the dungeon view, at least 260px (never wider than
            // the view); long text wraps (see crt_splash.css)
            el.style.width = Math.min(vr.width,
                Math.max(260, Math.round(vr.width * 0.4))) + "px";
        }
        var w = el.offsetWidth, h = el.offsetHeight;
        var p = banner ? place_banner(banner, w, h) : place_splash(w, h);

        var entry = { el: el, rect: p.rect, banner: !!banner };
        active.push(entry);

        function done()
        {
            if (el.parentNode)
                el.parentNode.removeChild(el);
            var i = active.indexOf(entry);
            if (i >= 0)
            {
                active.splice(i, 1);
                pump();
            }
        }

        if (!el.animate)
        {
            el.style.transform = at(p.x, p.y);
            el.style.opacity = 1;
            window.setTimeout(done, 1200);
            return;
        }
        ANIM.terminal(el, e, p.x, p.y, done, parts, banner);
    }

    function clear_all()
    {
        if (pump_timer)
            window.clearTimeout(pump_timer);
        pump_timer = null;
        queue = [];
        active.forEach(function (a) {
            if (a.el.parentNode) a.el.parentNode.removeChild(a.el);
        });
        active = [];
    }

    // Lifecycle ---------------------------------------------------------------

    api.on("game_init", function () {
        clear_all();
        if (layer && layer.parentNode)
            layer.parentNode.removeChild(layer);
        layer = null;
        ensure_layer();
        init_time = now();
        have_state = false;
        recent = {};
        watch_messages();
    });

    api.on("game_cleanup", function () {
        clear_all();
        if (msg_observer)
            msg_observer.disconnect();
        msg_observer = null;
        if (layer && layer.parentNode)
            layer.parentNode.removeChild(layer);
        layer = null;
        have_state = false;
    });

    api.on("hud_update", on_hud_update);

    api.on("setting", function (key, value) {
        if (key === "splash" && !value)
            clear_all();
    });

    window.sdc_splash_test = function (text, kind, target)
    {
        var e = { text: String(text || "STRUCK"), kind: kind || "damage",
                  size: 2.4, prio: 10, target: target || null };
        delete recent[e.text];
        enqueue(e);
    };

    window.sdc_splash_zone_test = function (place, depth)
    {
        var e = zone_event(place || "Lair", depth === undefined ? 3 : depth,
                           true);
        delete recent[e.text];
        enqueue(e);
    };

    window.sdc_splash_banner_test = function (which)
    {
        var e = which === "glory" ? level_event(12) : death_event();
        delete recent[e.text];
        enqueue(e);
    };

    return {};
});
