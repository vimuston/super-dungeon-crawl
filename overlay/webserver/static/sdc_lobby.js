// Super Dungeon Crawl lobby: saved characters and new-game cards.
//
// Every host (the webtiles server, the Windows exe, the Android app) sends
// the same "set_game_links" content: a hidden #sdc-lobby-data element whose
// data-lobby attribute holds JSON. client.js (patched by patch_client.py)
// calls window.sdc_lobby.render() on #play_now before binding its links.
//
//   {
//     "user":  "player",
//     "chars": [{"name", "mode", "game", "desc", "playing"}],
//     "modes": [{"game", "mode", "label", "rc"}],
//     "error": "optional message",
//     "local": true for the Windows / Android apps (no accounts)
//   }
//
// A character plays as "#play-<game>~<name>"; the server splits it. "mode" is
// crawl's game type (normal, seeded, tutorial, hints, sprint, descent).
// Normal, seeded, tutorial and hints share one save slot per name; sprint and
// descent have their own.
(function () {
    "use strict";

    var NAME_RE = /^[A-Za-z0-9_-]{1,20}$/;
    var MODE_LABELS = {
        normal: "Dungeon", seeded: "Seeded", tutorial: "Tutorial",
        hints: "Hints", sprint: "Sprint", descent: "Descent"
    };
    var MODE_DESCS = {
        normal: "The full dungeon",
        seeded: "Choose the dungeon's seed",
        tutorial: "Learn the basics",
        hints: "A normal game with hints",
        sprint: "A short, fast dungeon",
        descent: "Down only, no going back"
    };

    function slot(mode)
    {
        return mode === "sprint" || mode === "descent" ? mode : "main";
    }

    function el(tag, cls, text)
    {
        var e = document.createElement(tag);
        if (cls)
            e.className = cls;
        if (text != null)
            e.textContent = text;
        return e;
    }

    function play(game, name)
    {
        location.hash = "#play-" + game + (name ? "~" + name : "");
    }

    function cap(s)
    {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    }

    function char_card(c)
    {
        var card = el("div", "sdc-game " + (c.playing ? "sdc-game-playing"
                                                      : "sdc-game-continue"));
        var a = el("a", "sdc-game-play");
        a.href = "#play-" + c.game + "~" + c.name;
        var head = el("span", "sdc-game-head");
        head.appendChild(el("span", "sdc-game-name", c.name));
        head.appendChild(el("span", "sdc-game-tag",
                            c.playing ? "Playing" : "Continue"));
        a.appendChild(head);
        // crawl's short_desc is "Name, a level 3 Gnoll Fighter"
        var desc = c.desc || "";
        if (desc.toLowerCase().indexOf(c.name.toLowerCase() + ", ") === 0)
            desc = desc.slice(c.name.length + 2);
        a.appendChild(el("span", "sdc-game-desc",
                         c.playing ? "Game in progress" : cap(desc)));
        if (c.mode !== "normal")
            a.appendChild(el("span", "sdc-game-mode",
                             MODE_LABELS[c.mode] || c.mode));
        card.appendChild(a);
        return card;
    }

    function mode_card(m, data, taken)
    {
        var card = el("div", "sdc-game sdc-game-new");
        var a = el("a", "sdc-game-play");
        a.href = "javascript:";
        var head = el("span", "sdc-game-head");
        head.appendChild(el("span", "sdc-game-name", m.label));
        head.appendChild(el("span", "sdc-game-tag", "New"));
        a.appendChild(head);
        a.appendChild(el("span", "sdc-game-desc", MODE_DESCS[m.mode] || ""));
        card.appendChild(a);

        var form = el("form", "sdc-newchar");
        form.hidden = true;
        var input = el("input", "text");
        input.type = "text";
        input.maxLength = 20;
        input.placeholder = "Character name";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.setAttribute("autocapitalize", "words");
        input.setAttribute("aria-label", "Character name for " + m.label);
        var go = el("button", "button", "Start");
        go.type = "submit";
        var msg = el("div", "sdc-newchar-msg");
        var row = el("div", "sdc-newchar-row");
        row.appendChild(input);
        row.appendChild(go);
        form.appendChild(row);
        form.appendChild(msg);
        card.appendChild(form);

        function taken_here(name)
        {
            var used = taken[slot(m.mode)] || {};
            return used[name.toLowerCase()];
        }

        a.addEventListener("click", function (ev) {
            ev.preventDefault();
            var open = !form.hidden;
            document.querySelectorAll("#play_now .sdc-newchar").forEach(
                function (f) { f.hidden = true; });
            if (open)
                return;
            form.hidden = false;
            msg.textContent = "";
            if (!input.value && data.user && NAME_RE.test(data.user)
                && !taken_here(data.user))
            {
                input.value = data.user;
            }
            input.focus();
            input.select();
        });
        form.addEventListener("submit", function (ev) {
            ev.preventDefault();
            var name = input.value.trim();
            if (!NAME_RE.test(name))
            {
                msg.textContent = "1-20 letters, digits, - or _";
                return;
            }
            var other = taken_here(name);
            if (other)
            {
                msg.textContent = name + " already has a "
                    + (MODE_LABELS[other] || other).toLowerCase()
                    + " game saved: continue it above, or pick another name";
                return;
            }
            play(m.game, name);
        });
        return card;
    }

    function rc_link(m)
    {
        var a = el("a", "edit_rc_link sdc-rc-link", "Edit options (RC)");
        a.href = "javascript:";
        a.setAttribute("data-game_id", m.game);
        return a;
    }

    function render(root)
    {
        root = root && root.jquery ? root[0] : root;
        if (!root)
            return;
        var holder = root.querySelector("#sdc-lobby-data");
        if (!holder)
            return;
        var data;
        try
        {
            data = JSON.parse(holder.getAttribute("data-lobby"));
        }
        catch (e)
        {
            return;
        }
        // "Edit RC" links the server sent: client.js may have bound them
        // already (an unpatched, cached client.js binds before we run)
        var sent_rc = {};
        root.querySelectorAll(".edit_rc_link").forEach(function (a) {
            sent_rc[a.getAttribute("data-game_id")] = a;
        });
        root.textContent = "";
        // the Windows and Android apps have no accounts: no login bar
        document.body.classList.toggle("sdc-local", !!data.local);

        // names already used per save slot (lowercase: Windows saves are
        // case-insensitive files)
        var taken = {};
        (data.chars || []).forEach(function (c) {
            var s = slot(c.mode);
            (taken[s] = taken[s] || {})[c.name.toLowerCase()] = c.mode;
        });

        if (data.error)
            root.appendChild(el("div", "sdc-lobby-error", data.error));

        var chars = data.chars || [];
        if (chars.length)
        {
            root.appendChild(el("h2", "sdc-section-title", "Continue"));
            var grid = el("div", "sdc-games");
            chars.forEach(function (c) { grid.appendChild(char_card(c)); });
            root.appendChild(grid);
        }

        root.appendChild(el("h2", "sdc-section-title", "New game"));
        var modes = el("div", "sdc-games");
        (data.modes || []).forEach(function (m) {
            modes.appendChild(mode_card(m, data, taken));
        });
        root.appendChild(modes);

        var rc = (data.modes || []).filter(function (m) { return m.rc; });
        if (rc.length)
        {
            var links = el("div", "sdc-rc-links");
            rc.forEach(function (m) {
                var a = sent_rc[m.game];
                if (a)
                {
                    a.className = "edit_rc_link sdc-rc-link";
                    a.textContent = "Edit options (RC)";
                }
                links.appendChild(a || rc_link(m));
            });
            root.appendChild(links);
        }
    }

    window.sdc_lobby = { render: render };

    // Also render whenever new lobby data lands in #play_now, so the lobby
    // works even with a cached client.js from before patch_client.py hooked
    // it (require.js loads client.js unversioned). Rendering removes the
    // data element, so a hooked client.js and this never render twice.
    function watch()
    {
        var root = document.getElementById("play_now");
        if (!root || !window.MutationObserver)
            return;
        new MutationObserver(function () {
            if (root.querySelector("#sdc-lobby-data"))
                render(root);
        }).observe(root, { childList: true });
        render(root);
    }
    if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", watch);
    else
        watch();
})();
