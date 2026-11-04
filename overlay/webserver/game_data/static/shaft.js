// Shaft / trapdoor plunge: "the floor gives way".
//   beat 1  (0-560 ms)   iris collapses to black from the edges, stomach lurch,
//                        cracks, speed streaks and gravel streaming up, red tint
//   beat 2  (560-900)    held black, caption, impact flash + jitter on arrival
//   beat 3  (900-1700)   iris re-opens, dust motes settle, bruise-red pulse
// Triggers: game messages (traps.cc / stairs.cc, see MSG_RE). The layer is a
// child of #normal, so it survives the level change that follows the message.
// Emits api "shaft" ("start" | "land") for alive's quake.
// Debug: window.sdc_shaft_test()
define(["jquery", "./sdc_api"], function ($, api) {
    "use strict";

    var MSG_GRACE = 1500;
    var DEDUPE = 2500;
    var TOTAL = 1700;
    // stairs.cc:671 "You fall/are sucked into a shaft and drop N floor(s)!"
    // plus generic involuntary-fall wordings (trapdoor / collapsing floor).
    var MSG_RE = /\bYou (?:fall|are sucked|plunge|drop) (?:down )?(?:into|through) (?:a|the) (?:shaft|trap ?door|hole|pit)\b|\bthe floor (?:gives way|collapses)\b|\bYou fall through\b/i;
    var DROP_RE = /drop (\d+) floors?/i;

    var layer = null, msg_observer = null, init_time = 0, last_fire = -1e9;
    var running = [];
    var reduce_motion = window.matchMedia
        && window.matchMedia("(prefers-reduced-motion: reduce)");

    function now()
    {
        return window.performance ? window.performance.now() : Date.now();
    }

    function rnd(a, b)
    {
        return a + Math.random() * (b - a);
    }

    function reduced()
    {
        return !!(reduce_motion && reduce_motion.matches);
    }

    function ensure_layer()
    {
        if (layer && document.body.contains(layer))
            return layer;
        layer = document.createElement("div");
        layer.id = "sdc_shaft";
        (document.getElementById("normal") || document.body).appendChild(layer);
        return layer;
    }

    function mk(parent, cls, tag)
    {
        var e = document.createElement(tag || "div");
        e.className = cls;
        parent.appendChild(e);
        return e;
    }

    function anim(el, frames, opts)
    {
        if (!el.animate)
            return null;
        opts.fill = "both";
        var a = el.animate(frames, opts);
        running.push(a);
        return a;
    }

    function clear_running()
    {
        running.forEach(function (a) {
            try { a.cancel(); } catch (e) { /* ignore */ }
        });
        running = [];
    }

    var play_token = 0;

    // Everything that was drawn is removed when the plunge is over, so no
    // fill:"both" end state (or leftover element) can linger on screen.
    function schedule_cleanup(L, ms)
    {
        var token = ++play_token;
        window.setTimeout(function () {
            if (token !== play_token) return;    // a newer plunge took over
            clear_running();
            L.innerHTML = "";
        }, ms + 250);
    }

    function play(floors)
    {
        var L = ensure_layer();
        if (!L.animate)
            return;
        clear_running();
        L.innerHTML = "";
        var W = window.innerWidth, H = window.innerHeight;
        var caption = ">> FLOOR GIVES WAY // DEPTH +" + (floors || 1);
        var i;

        if (reduced())
        {
            var b = mk(L, "sh_black");
            var c = mk(L, "sh_cap");
            c.textContent = caption;
            anim(b, [{opacity: 0}, {opacity: 0.85, offset: 0.3},
                     {opacity: 0.85, offset: 0.7}, {opacity: 0}],
                 {duration: 1200});
            anim(c, [{opacity: 0}, {opacity: 1, offset: 0.25},
                     {opacity: 1, offset: 0.7}, {opacity: 0}],
                 {duration: 1200});
            schedule_cleanup(L, 1200);
            return;
        }

        var wrap = mk(L, "sh_wrap");
        var tint = mk(wrap, "sh_tint");
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "sh_cracks");
        svg.setAttribute("viewBox", "0 0 100 100");
        svg.setAttribute("preserveAspectRatio", "none");
        wrap.appendChild(svg);
        for (i = 0; i < 7; i++)
        {
            var a0 = i / 7 * Math.PI * 2 + rnd(-0.3, 0.3);
            var x = 50, y = 58, pts = [];
            for (var s = 0; s < 6; s++)
            {
                pts.push(x.toFixed(1) + "," + y.toFixed(1));
                var r = rnd(6, 13), an = a0 + rnd(-0.5, 0.5);
                x += Math.cos(an) * r;
                y += Math.sin(an) * r * 0.8;
            }
            var pl = document.createElementNS("http://www.w3.org/2000/svg",
                                              "polyline");
            pl.setAttribute("points", pts.join(" "));
            pl.setAttribute("pathLength", "1");
            pl.style.strokeDasharray = "1";
            svg.appendChild(pl);
            anim(pl, [{opacity: 0, strokeDashoffset: 1},
                      {opacity: 1, strokeDashoffset: 0, offset: 0.35},
                      {opacity: 1, offset: 0.7}, {opacity: 0}],
                 {duration: 520, delay: 20 + i * 15});
        }

        // streaks: the world rushes upward as we fall
        for (i = 0; i < 16; i++)
        {
            var st = mk(wrap, "sh_streak");
            var h = rnd(0.2, 0.5) * H;
            st.style.left = rnd(0, W) + "px";
            st.style.height = h + "px";
            st.style.top = "0";
            anim(st, [{opacity: 0,
                       transform: "translateY(" + (H + 40) + "px)"},
                      {opacity: 1, offset: 0.2},
                      {opacity: 0.9, offset: 0.8},
                      {opacity: 0,
                       transform: "translateY(" + (-h - 40) + "px)"}],
                 {duration: rnd(260, 380), delay: rnd(80, 280),
                  easing: "ease-in"});
        }
        // gravel / dust streaming up
        for (i = 0; i < 34; i++)
        {
            var g = mk(wrap, "sh_dust");
            var sz = rnd(2, 6);
            g.style.width = sz + "px";
            g.style.height = sz + "px";
            g.style.left = rnd(0, W) + "px";
            g.style.top = "0";
            anim(g, [{opacity: 0, transform: "translate(0,"
                                  + (H * rnd(0.6, 1.05)) + "px)"},
                     {opacity: 0.95, offset: 0.25},
                     {opacity: 0, transform: "translate(" + rnd(-40, 40)
                                  + "px,-30px) rotate(" + rnd(-200, 200)
                                  + "deg)"}],
                 {duration: rnd(380, 620), delay: rnd(40, 340),
                  easing: "ease-in"});
        }

        // iris + hold
        var iris = mk(wrap, "sh_iris");
        var black = mk(wrap, "sh_black");
        // "open" = big enough that the dark ring is far outside the screen
        // (at scale 1 the ring still darkens the corners, and fill:"both"
        // used to leave that on screen for good)
        anim(iris, [{transform: "scale(4)"},
                    {transform: "scale(0.02)", offset: 0.33},
                    {transform: "scale(0.02)", offset: 0.53},
                    {transform: "scale(4)"}],
             {duration: TOTAL, easing: "cubic-bezier(.6,0,.3,1)"});
        anim(black, [{opacity: 0}, {opacity: 0, offset: 0.30},
                     {opacity: 1, offset: 0.36}, {opacity: 1, offset: 0.50},
                     {opacity: 0, offset: 0.58}, {opacity: 0}],
             {duration: TOTAL});
        anim(tint, [{opacity: 0}, {opacity: 1, offset: 0.2},
                    {opacity: 0.8, offset: 0.55}, {opacity: 0}],
             {duration: TOTAL});

        // stomach lurch (beat 1) and arrival jitter (beat 2 -> 3)
        anim(wrap, [
            {transform: "translateY(0) scaleY(1)"},
            {transform: "translateY(-16px) scaleY(1.05)", offset: 0.07},
            {transform: "translateY(12px) scaleY(0.97)", offset: 0.15},
            {transform: "translateY(0) scaleY(1.02)", offset: 0.3},
            {transform: "translate(0,0)", offset: 0.52},
            {transform: "translate(7px,9px)", offset: 0.54},
            {transform: "translate(-6px,-7px)", offset: 0.57},
            {transform: "translate(5px,4px)", offset: 0.60},
            {transform: "translate(-3px,-3px)", offset: 0.64},
            {transform: "translate(2px,1px)", offset: 0.70},
            {transform: "translate(0,0)", offset: 0.78}
        ], {duration: TOTAL});

        // impact flash + bruise pulse
        var fl = mk(wrap, "sh_flash");
        anim(fl, [{opacity: 0}, {opacity: 0, offset: 0.51},
                  {opacity: 0.9, offset: 0.535}, {opacity: 0, offset: 0.62},
                  {opacity: 0}], {duration: TOTAL});
        var br = mk(wrap, "sh_bruise");
        anim(br, [{opacity: 0}, {opacity: 0, offset: 0.5},
                  {opacity: 1, offset: 0.6}, {opacity: 0.35, offset: 0.72},
                  {opacity: 0.7, offset: 0.8}, {opacity: 0}],
             {duration: TOTAL});

        // dust motes drifting down and settling
        for (i = 0; i < 26; i++)
        {
            var m = mk(wrap, "sh_dust");
            var ms = rnd(1.5, 3.5);
            m.style.width = ms + "px";
            m.style.height = ms + "px";
            m.style.left = rnd(0, W) + "px";
            m.style.top = rnd(0, H * 0.4) + "px";
            m.style.background = "#a8957a";
            var t0 = rnd(0.52, 0.66);
            anim(m, [{opacity: 0, transform: "translate(0,0)"},
                     {opacity: 0, offset: t0},
                     {opacity: 0.75, offset: t0 + 0.06},
                     {opacity: 0, transform: "translate(" + rnd(-20, 20)
                                  + "px," + rnd(H * 0.2, H * 0.5) + "px)"}],
                 {duration: TOTAL, easing: "linear"});
        }

        // caption, phosphor green -> red
        var cap = mk(L, "sh_cap");
        cap.textContent = caption;
        anim(cap, [{opacity: 0, color: "#7dffb0", transform: "translateY(-6px)"},
                   {opacity: 1, color: "#7dffb0", offset: 0.12},
                   {opacity: 1, color: "#ff4030", offset: 0.4,
                    transform: "translateY(0)"},
                   {opacity: 1, color: "#ff2a1a", offset: 0.62},
                   {opacity: 0, color: "#ff2a1a",
                    transform: "translateY(10px)"}],
             {duration: TOTAL});

        schedule_cleanup(L, TOTAL);

        // living-tiles quake: heavy now, settle on arrival
        api.emit("shaft", "start");
        window.setTimeout(function () { api.emit("shaft", "land"); },
                          TOTAL * 0.53);
    }

    function fire(floors)
    {
        var t = now();
        if (t - last_fire < DEDUPE)
            return;
        last_fire = t;
        play(floors);
    }

    // Messages (same pattern as blink.js) ---------------------------------
    var seen_msg = window.WeakMap ? new WeakMap() : null;
    var in_grace = false;

    function node_text(node)
    {
        var c = node.cloneNode(true);
        var g = c.querySelectorAll(".prefix_glyph");
        for (var i = 0; i < g.length; i++)
            g[i].parentNode.removeChild(g[i]);
        return (c.textContent || "").trim();
    }

    function handle_text(text)
    {
        var parts = text.split(/[.!?]\s+/);
        for (var i = 0; i < parts.length; i++)
        {
            if (MSG_RE.test(parts[i]))
            {
                var m = DROP_RE.exec(parts[i]);
                fire(m ? parseInt(m[1], 10) : 1);
                return;
            }
        }
    }

    function process_msg(el, quiet)
    {
        var text = node_text(el);
        var old = seen_msg ? seen_msg.get(el) : undefined;
        if (old === text)
            return;
        if (seen_msg)
            seen_msg.set(el, text);
        if (quiet || in_grace)
            return;
        var fresh = (old !== undefined && text.indexOf(old) === 0)
                    ? text.slice(old.length) : text;
        handle_text(fresh);
    }

    function seed_all(root)
    {
        var all = root.querySelectorAll
                  ? root.querySelectorAll(".game_message") : [];
        for (var i = 0; i < all.length; i++)
            process_msg(all[i], true);
    }

    function owner_msg(n)
    {
        var el = n.nodeType === 1 ? n : n.parentElement;
        return el && el.closest ? el.closest(".game_message") : null;
    }

    function on_nodes(records)
    {
        in_grace = now() - init_time < MSG_GRACE;
        records.forEach(function (r) {
            var own = owner_msg(r.target);
            if (own)
                process_msg(own);
            Array.prototype.forEach.call(r.addedNodes, function (node) {
                if (node.nodeType === 1)
                {
                    if (node.classList.contains("game_message"))
                        process_msg(node);
                    else if (node.id === "messages"
                             || node.querySelector(".game_message"))
                        seed_all(node);    // bulk re-insert (stock layout())
                    else if (own)
                        process_msg(own);
                }
                else if (own)
                    process_msg(own);
            });
        });
    }

    // Stable ancestor: stock layout() swaps #messages with a clone.
    function watch()
    {
        if (msg_observer)
            msg_observer.disconnect();
        var el = document.getElementById("message_pane")
                 || document.getElementById("messages_container")
                 || document.getElementById("normal");
        if (!el || !window.MutationObserver)
            return;
        seed_all(el);
        msg_observer = new MutationObserver(on_nodes);
        msg_observer.observe(el, { childList: true, subtree: true });
    }

    api.on("game_init", function () {
        init_time = now();
        if (layer && layer.parentNode)
            layer.parentNode.removeChild(layer);
        layer = null;
        clear_running();
        ensure_layer();
        watch();
    });

    api.on("game_cleanup", function () {
        clear_running();
        if (msg_observer)
            msg_observer.disconnect();
        msg_observer = null;
        if (layer && layer.parentNode)
            layer.parentNode.removeChild(layer);
        layer = null;
    });

    window.sdc_shaft_test = function (floors) {
        last_fire = -1e9;
        fire(floors || 1);
    };

    return {};
});
