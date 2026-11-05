// Mobile menus: touch-first versions of crawl's popups for phones. Styles
// live in mobilemenus.css, everything is scoped to body.sdc-mm (set while
// the "mobile_menus" option is active), so desktop is untouched.
//
// Watches #ui-stack and re-dresses what the server shows; all input still
// goes to the game as the same keys, so nothing here changes game logic.
//
//   - every popup: full screen, big rows, a close button (Esc) and the
//     "[key] action" hints of the menu footer turned into buttons.
//   - skills (m): the 80-column CRT text is parsed into one tappable column.
//     Tap a skill = cycle off / on / focused (the menu is put in focus mode),
//     Target = a number picker (sets the training target), i = description.
//     Mode (auto/manual), shown skills and the value column are segmented
//     buttons.
//   - spells (z / I): one card per spell (name, schools, failure, level or
//     power / damage / range / noise). Tap = cast, i = spell description.
//   - character selection: a single scrolling list grouped by the stock
//     column headings. First tap previews (description + Choose button),
//     a second tap or Choose picks it.
//   - character overview (%): its side-by-side text columns are stacked.
//   - text prompts: OK / Cancel / Keyboard buttons; numeric prompts (skill
//     targets) get an on-screen number pad instead of the keyboard.
//
// Option "mobile_menus": auto (with the mobile UI) / on / off.
define(["jquery", "comm", "./sdc_api"], function ($, comm, api) {
    "use strict";

    api.register_option({ key: "mobile_menus", label: "Mobile menus",
                          default: "auto",
                          choices: [["auto", "With mobile UI"], ["on", "On"],
                                    ["off", "Off"]] });

    function active()
    {
        var m = api.get("mobile_menus");
        if (m === "off" || !document.body) return false;
        if (m === "on") return true;
        return document.body.classList.contains("sdc-mobile");
    }

    function apply_mode()
    {
        if (!document.body) return;
        var on = active();
        document.body.classList.toggle("sdc-mm", on);
        if (on) schedule();
    }

    // Keys --------------------------------------------------------------------

    var NAMED = { esc: 27, escape: 27, enter: 13, ret: 13, return: 13,
                  tab: 9, space: 32, spc: 32, bksp: 8, backspace: 8 };

    function send_code(code) { comm.send_message("key", { keycode: code }); }
    function send_text(s)
    {
        for (var i = 0; i < s.length; i++)
            comm.send_message("input", { text: s.charAt(i) });
    }

    // a "[key]" token from a hint -> a send function (null: not tappable)
    function key_action(tok)
    {
        var alts = String(tok).split("/");
        for (var i = 0; i < alts.length; i++)
        {
            var k = alts[i].trim();
            if (!k) continue;
            var named = NAMED[k.toLowerCase()];
            if (named) return send_code.bind(null, named);
            if (k.length === 1) return send_text.bind(null, k);
        }
        return null;
    }

    function buzz()
    {
        try { if (navigator.vibrate) navigator.vibrate(10); }
        catch (e) { /* unsupported */ }
    }

    function btn(label, cls, fn)
    {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "sdc-m-btn" + (cls ? " " + cls : "");
        b.textContent = label;
        b.addEventListener("click", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            buzz();
            fn(ev);
        });
        return b;
    }

    function el(tag, cls, text)
    {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    // Text with colours ---------------------------------------------------------
    // Flattens a node to its text plus the fgN colour of every character.

    function runs(node)
    {
        var text = "", cols = [];
        (function walk(n, fg) {
            if (n.nodeType === 3)
            {
                text += n.nodeValue;
                for (var i = 0; i < n.nodeValue.length; i++) cols.push(fg);
                return;
            }
            if (n.nodeType !== 1) return;
            if (n.tagName === "BR")
            {
                text += "\n";
                cols.push(fg);
                return;
            }
            var m = /(?:^|\s)fg(\d+)(?:\s|$)/.exec(n.getAttribute("class") || "");
            if (m) fg = Number(m[1]);
            for (var c = n.firstChild; c; c = c.nextSibling) walk(c, fg);
        })(node, 7);
        return { text: text, cols: cols };
    }

    function esc_html(s)
    {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
    }

    // runs slice -> html with one span per colour run
    function runs_html(r, a, b)
    {
        var out = "", i = a, end = Math.min(b, r.text.length);
        while (i < end)
        {
            var j = i, fg = r.cols[i];
            while (j < end && r.cols[j] === fg) j++;
            out += "<span class='fg" + fg + "'>"
                + esc_html(r.text.slice(i, j)) + "</span>";
            i = j;
        }
        return out;
    }

    // Generic popup chrome --------------------------------------------------------

    function top_popup()
    {
        var kids = $("#ui-stack").children(".ui-popup");
        return kids.length ? kids.last()[0] : null;
    }

    function add_close(popup)
    {
        var outer = popup.querySelector(".ui-popup-outer");
        if (!outer || outer.querySelector(":scope > .sdc-mm-x")) return;
        var x = btn("×", "sdc-mm-x", function () { send_code(27); });
        x.setAttribute("aria-label", "Close");
        outer.appendChild(x);
    }

    // "[?] help  [!]/[I] toggle  [Esc] cancel" -> buttons. Plain text that is
    // not a hint (e.g. "Select a spell to cast") stays as a caption.
    var HINT_RE = /\[([^\]\n]{1,8})\]((?:\/\[[^\]\n]{1,8}\])*)\s*([^\[\n]*)/g;

    function hint_bar(src, cls)
    {
        var text = src.textContent.replace(/\s+/g, " ").trim();
        var bar = src.nextElementSibling;
        if (!bar || !bar.classList.contains("sdc-mm-keys"))
        {
            bar = el("div", "sdc-mm-keys " + (cls || ""));
            src.parentNode.insertBefore(bar, src.nextSibling);
        }
        if (bar.getAttribute("data-src") === text) return;
        bar.setAttribute("data-src", text);
        bar.innerHTML = "";
        var m, caption = text, found = false;
        HINT_RE.lastIndex = 0;
        while ((m = HINT_RE.exec(text)))
        {
            var keys = [m[1]].concat((m[2].match(/\[([^\]]+)\]/g) || [])
                .map(function (s) { return s.slice(1, -1); }));
            var fn = null;
            for (var i = 0; i < keys.length && !fn; i++) fn = key_action(keys[i]);
            if (!fn) continue;
            var label = m[3].trim().replace(/[,;:.]+$/, "") || keys[0];
            if (label.length > 26) label = label.slice(0, 25) + "…";
            bar.appendChild(btn(label, "", fn));
            caption = caption.replace(m[0].trim(), "");
            found = true;
        }
        caption = caption.replace(/\s+/g, " ").trim();
        if (caption && !/^[-\s]*$/.test(caption))
            bar.insertBefore(el("div", "sdc-mm-caption", caption), bar.firstChild);
        src.classList.toggle("sdc-mm-hidden", found);
    }

    // Skills (CRT menu "skills") ------------------------------------------------

    // Columns of one entry (skill-menu.cc): name " %c %c %-15s" (20),
    // level (5), progress / view column (6), aptitude (5).
    var SW_RE = /\[(.)\] ((?:new level|[a-z]+)(?:\|(?:new level|[a-z]+))+)(?: ([a-z]+))?/g;
    var SW_LABEL = { mode: "Training", skill: "Tap", skills: "Show",
                     level: "Levels", "": "Column" };
    var sk_state = new WeakMap();   // menu element -> per-open state
    var pending_target = null;      // {value} to type into the next prompt

    function parse_skills(menu)
    {
        var lines = Array.prototype.filter.call(menu.children, function (c) {
            return c.tagName === "SPAN" && !c.classList.contains("sdc-mm-panel");
        }).map(function (span) { var r = runs(span); r.el = span; return r; });
        var res = { skills: [], switches: [], buttons: {}, notes: [],
                    view: "", help: false, setting: false, xp: false };
        var hdr = -1, xs = [];
        lines.forEach(function (r, i) {
            if (hdr >= 0) return;
            var re = /     Skill/g, m;
            while ((m = re.exec(r.text)) && r.text.indexOf("Level", m.index) > 0)
                xs.push(m.index);
            if (xs.length) hdr = i;
        });
        if (hdr < 0) return null;
        var vm = /Level\s+(\S+)/.exec(lines[hdr].text.slice(xs[0]));
        res.view = vm ? vm[1] : "";

        var used = {};
        used[hdr] = true;
        xs.forEach(function (x) {
            for (var i = hdr + 1; i < lines.length; i++)
            {
                var r = lines[i], f = r.text.slice(x, x + 36);
                if (f.length < 25 || f[0] !== " " || f[2] !== " "
                    || f[4] !== " " || !/[-+* ]/.test(f[3]))
                    continue;
                var name = f.slice(5, 20).trim();
                var level = f.slice(20, 25).trim();
                if (!/^[A-Z]/.test(name) || !/^\d+(\.\d)?$/.test(level))
                    continue;
                used[i] = true;
                var prog = f.slice(25, 31);
                var pi = prog.search(/\S/);
                res.skills.push({
                    key: f[1] === " " ? "" : f[1],
                    sign: f[3], name: name, level: level,
                    prog: prog.trim(),
                    prog_fg: pi >= 0 ? r.cols[x + 25 + pi] : 7,
                    apt: f.slice(31, 36).trim(),
                    fg: r.cols[x + 5],
                });
            }
        });

        lines.forEach(function (r, i) {
            if (used[i] || i < hdr) return;
            var t = r.text, m, any = false;
            SW_RE.lastIndex = 0;
            while ((m = SW_RE.exec(t)))
            {
                any = true;
                var opts = m[2].split("|"), pos = m.index + m[0].indexOf(m[2]);
                var sw = { key: m[1], name: m[3] || "", opts: [], cur: -1 };
                var fgs = [];
                opts.forEach(function (o) {
                    fgs.push(r.cols[pos]);
                    sw.opts.push(o);
                    pos += o.length + 1;
                });
                // current state is white, the rest darkgrey (skill-menu.cc);
                // otherwise take the one option not drawn in darkgrey
                sw.cur = fgs.indexOf(15);
                if (sw.cur < 0)
                {
                    var lit = fgs.filter(function (c) { return c !== 8; });
                    if (lit.length === 1) sw.cur = fgs.indexOf(lit[0]);
                }
                res.switches.push(sw);
            }
            var bt = /\[([?=\-]|a-z)\] ([^\[]*)/g;
            while ((m = bt.exec(t)))
            {
                any = true;
                res.buttons[m[1]] = m[2].trim();
            }
            if (!any && t.trim())
                res.notes.push(r.el.innerHTML);
        });
        var az = res.buttons["a-z"] || "";
        res.help = /descriptions/.test(az);
        res.setting = /set skill target/.test(az);
        res.xp = /great experience/.test(menu.textContent);
        return res;
    }

    function sign_state(s)
    {
        return s === "*" ? "focus" : s === "+" ? "on" : s === "-" ? "off" : "na";
    }

    function render_skills(menu)
    {
        var data = parse_skills(menu);
        if (!data) return;
        var st = sk_state.get(menu);
        if (!st) { st = { focus_tried: false, help_exit: false }; sk_state.set(menu, st); }

        // tap should cycle off / on / focused: put the menu in focus mode
        var dosw = data.switches.filter(function (s) { return s.name === "skill"; })[0];
        if (dosw && !st.focus_tried)
        {
            st.focus_tried = true;
            var fi = dosw.opts.indexOf("focus");
            if (fi >= 0 && dosw.cur >= 0 && dosw.cur !== fi)
            {
                send_text(dosw.key);
                return;     // the redraw comes back with the new state
            }
        }
        // leave the description mode we entered for an "i" tap
        if (data.help && st.help_exit && top_popup() === $(menu).closest(".ui-popup")[0])
        {
            st.help_exit = false;
            send_code(27);      // Esc cancels the description mode
            return;
        }

        var panel = menu.querySelector(":scope > .sdc-mm-panel");
        var scroll = panel ? panel.scrollTop : 0;
        if (!panel)
        {
            panel = el("div", "sdc-mm-panel sdc-mm-skills");
            menu.insertBefore(panel, menu.firstChild);
        }
        panel.innerHTML = "";
        menu.classList.add("sdc-mm-on");

        panel.appendChild(el("div", "sdc-mm-title",
                             data.xp ? "Choose skills to train" : "Skills"));

        // switches
        var sws = el("div", "sdc-mm-switches");
        data.switches.forEach(function (sw) {
            if (sw.name === "skill") return;   // handled: always focus mode
            var seg = el("div", "sdc-mm-seg");
            seg.appendChild(el("span", "sdc-mm-seg-l",
                               SW_LABEL[sw.name] || sw.name));
            sw.opts.forEach(function (o, k) {
                var b = btn(o, k === sw.cur ? "on" : "", function () {
                    if (k === sw.cur) return;
                    var n = sw.cur < 0 ? 1
                        : (k - sw.cur + sw.opts.length) % sw.opts.length;
                    send_text(new Array(n + 1).join(sw.key));
                });
                seg.appendChild(b);
            });
            sws.appendChild(seg);
        });
        panel.appendChild(sws);

        if (data.help)
            panel.appendChild(el("div", "sdc-mm-banner",
                                 "Tap a skill to read its description."));
        else if (data.setting)
            panel.appendChild(el("div", "sdc-mm-banner",
                                 "Tap a skill to set its target."));

        var can_target = "=" in data.buttons || data.setting;
        var targets_view = /^Target/.test(data.view);
        var list = el("div", "sdc-mm-sklist");
        data.skills.forEach(function (sk) {
            var row = el("div", "sdc-mm-sk st-" + sign_state(sk.sign)
                         + " fg" + sk.fg + (sk.key ? "" : " sdc-mm-dis"));
            row.appendChild(el("span", "sdc-mm-st"));
            var nm = el("span", "sdc-mm-nm", sk.name);
            row.appendChild(nm);
            row.appendChild(el("span", "sdc-mm-lv", sk.level));
            var pg = el("span", "sdc-mm-pg fg" + sk.prog_fg, sk.prog);
            pg.setAttribute("data-col", data.view);
            row.appendChild(pg);
            row.appendChild(el("span", "sdc-mm-ap", sk.apt));
            if (sk.key)
            {
                row.addEventListener("click", function (ev) {
                    ev.preventDefault();
                    buzz();
                    send_text(sk.key);
                });
                if (can_target && !data.help)
                {
                    row.appendChild(btn("◎", "sdc-mm-tg", function () {
                        target_picker(menu, sk, data);
                    }));
                }
                if (!data.help && !data.setting)
                {
                    row.appendChild(btn("i", "sdc-mm-info", function () {
                        st.help_exit = true;
                        send_text("?" + sk.key);
                    }));
                }
            }
            list.appendChild(row);
        });
        panel.appendChild(list);

        // focus exists unless the train|focus switch is shown without it
        // (skill_focus = true, the default, cycles off/on/focus with no
        // switch; skill_focus = false has none either, but rarely set)
        var focus_ok = !dosw || dosw.opts.indexOf("focus") >= 0
            || data.skills.some(function (s) { return s.sign === "*"; });
        var legend = el("div", "sdc-mm-legend" + (focus_ok ? "" : " no-focus"));
        legend.innerHTML = "<span class='st-off'><i></i>off</span>"
            + "<span class='st-on'><i></i>on</span>"
            + "<span class='st-focus'><i></i>focus</span>"
            + "<span>Lv = level, " + esc_html(data.view || "") + ", Apt</span>";
        panel.appendChild(legend);

        var foot = el("div", "sdc-mm-foot");
        if (data.help || data.setting)
            foot.appendChild(btn("Back", "", function () { send_code(27); }));
        else
            foot.appendChild(btn("Help", "", function () { send_text("??"); }));
        if (targets_view && "-" in data.buttons && !data.setting)
            foot.appendChild(btn("Clear targets", "", function () { send_text("-"); }));
        if (data.xp)
            foot.appendChild(btn("Done", "on", function () { send_code(13); }));
        else
            foot.appendChild(btn("Close", "", function () { send_code(27); }));
        panel.appendChild(foot);

        if (data.notes.length)
        {
            var notes = el("div", "sdc-mm-notes");
            notes.innerHTML = data.notes.join("<br>");
            panel.appendChild(notes);
        }
        panel.scrollTop = scroll;
    }

    // number picker for a skill target; the value is typed into the
    // "Enter a skill target" prompt the game opens after "=" + letter
    function target_picker(menu, sk, data)
    {
        var old = document.getElementById("sdc_mm_picker");
        if (old) old.remove();
        var lvl = Number(sk.level) || 0;
        var cur = /^Target/.test(data.view) ? parseFloat(sk.prog) : NaN;
        var val = isFinite(cur) ? cur : Math.min(27, Math.floor(lvl) + 1);

        var wrap = el("div", "sdc-mm-picker");
        wrap.id = "sdc_mm_picker";
        var box = el("div", "sdc-mm-pickbox");
        wrap.appendChild(box);
        box.appendChild(el("div", "sdc-mm-title", sk.name + " target"));
        box.appendChild(el("div", "sdc-mm-sub", "Level " + sk.level));
        var out = el("div", "sdc-mm-val");
        box.appendChild(out);
        function show()
        {
            val = Math.round(Math.max(0, Math.min(27, val)) * 10) / 10;
            out.textContent = val ? val.toFixed(1) : "none";
        }
        var steps = el("div", "sdc-mm-row");
        [[-1, "−1"], [-0.1, "−0.1"], [0.1, "+0.1"], [1, "+1"]]
            .forEach(function (s) {
                steps.appendChild(btn(s[1], "", function () { val += s[0]; show(); }));
            });
        box.appendChild(steps);
        var quick = el("div", "sdc-mm-row");
        var marks = [Math.ceil(lvl + 0.01), 5, 8, 10, 12, 14, 15, 18, 20, 27]
            .filter(function (v, i, a) { return v > lvl && v <= 27 && a.indexOf(v) === i; })
            .sort(function (a, b) { return a - b; }).slice(0, 8);
        marks.forEach(function (v) {
            quick.appendChild(btn(String(v), "sdc-mm-chip", function () { val = v; show(); }));
        });
        box.appendChild(quick);
        var act = el("div", "sdc-mm-row sdc-mm-acts");
        function submit(v)
        {
            wrap.remove();
            pending_target = { value: v };
            send_text(data.setting ? sk.key : "=" + sk.key);
            // safety: forget it if no prompt shows up
            setTimeout(function () { pending_target = null; }, 3000);
        }
        act.appendChild(btn("Cancel", "", function () { wrap.remove(); }));
        act.appendChild(btn("Clear", "", function () { submit("0"); }));
        act.appendChild(btn("Set", "on", function () { submit(val ? val.toFixed(1) : "0"); }));
        box.appendChild(act);
        wrap.addEventListener("click", function (ev) {
            if (ev.target === wrap) wrap.remove();
        });
        show();
        document.body.appendChild(wrap);
    }

    // Spells (menu tag "spell") and abilities (tag "ability") -------------------

    function spell_fields(text, extra)
    {
        var m = /^\s*(\S+) ([-+]) (.*)$/.exec(text);
        if (!m) return null;
        var rest = m[3];
        var f = { key: m[1], name: rest.slice(0, 32).trim(), chips: [] };
        if (extra)
        {
            var pw = rest.slice(32, 42).trim(), dm = rest.slice(42, 52).trim(),
                rg = rest.slice(52, 60).trim(), ns = rest.slice(60).trim();
            if (pw) f.chips.push(["Power", pw]);
            if (dm && dm !== "N/A") f.chips.push(["Dmg", dm]);
            if (rg) f.chips.push(["Range", rg]);
            if (ns) f.chips.push(["Noise", ns]);
        }
        else
        {
            var sch = rest.slice(32, 58).trim(), tail = rest.slice(58).trim();
            var lv = /(\d+)\s*$/.exec(tail);
            var fail = lv ? tail.slice(0, lv.index).trim() : tail;
            if (sch) f.chips.push(["", sch]);
            if (fail) f.chips.push(["Fail", fail]);
            if (lv) f.chips.push(["Lv", lv[1]]);
        }
        return f;
    }

    function ability_fields(text)
    {
        var m = /^\s*(\S+) ([-+]) (.*)$/.exec(text);
        if (!m) return null;
        var parts = m[3].split(/\s{2,}/).map(function (s) { return s.trim(); })
            .filter(Boolean);
        return { key: m[1], name: parts.shift() || "",
                 chips: parts.map(function (p) { return ["", p]; }) };
    }

    function dress_rows(popup, kind)
    {
        var menu = popup.querySelector(".menu");
        if (!menu) return;
        var title = menu.querySelector(".menu_title");
        var mine = title && title.querySelector(":scope > .sdc-mm-title");
        // extra (power) columns: read from the stock title, or remembered
        // from it once we have replaced it with our own header
        var extra = mine ? title.getAttribute("data-sdc-extra") === "1"
                         : !!(title && /Power/.test(title.textContent));
        menu.classList.add("sdc-mm-cards");
        if (title && kind === "spell" && !mine)
        {
            var full = title.textContent.replace(/\s+/g, " ").trim();
            var t = (/^.*?\)/.exec(full) || [full.split(" Type")[0]])[0];
            title.setAttribute("data-sdc-extra", extra ? "1" : "0");
            title.innerHTML = "";
            title.appendChild(el("span", "sdc-mm-title", t));
            title.appendChild(btn(extra ? "Show failure" : "Show power",
                                  "sdc-mm-tog", function () { send_text("!"); }));
        }
        menu.querySelectorAll("li.selectable").forEach(function (li) {
            var item = $(li).data("item");
            var src = item ? item.text : "";
            if (!src || li.getAttribute("data-sdc") === src + extra) return;
            var canvas = li.querySelector("canvas");
            var text = li.textContent;
            var f = kind === "spell" ? spell_fields(text, extra) : ability_fields(text);
            if (!f) return;
            li.setAttribute("data-sdc", src + extra);
            li.innerHTML = "";
            if (canvas) li.appendChild(canvas);
            var main = el("div", "sdc-mm-main");
            main.appendChild(el("div", "sdc-mm-nm", f.name));
            var meta = el("div", "sdc-mm-meta");
            f.chips.forEach(function (c) {
                var chip = el("span", "sdc-mm-chiplet");
                if (c[0]) chip.appendChild(el("b", "", c[0] + " "));
                chip.appendChild(document.createTextNode(c[1]));
                meta.appendChild(chip);
            });
            main.appendChild(meta);
            li.appendChild(main);
            if (kind === "spell")
            {
                li.appendChild(btn("i", "sdc-mm-info", function () {
                    // stock right-click on a row: describe it
                    $(li).trigger($.Event("contextmenu", { which: 3 }));
                }));
            }
        });
    }

    // Character selection (newgame-choice) ---------------------------------------

    function dress_newgame(popup)
    {
        var root = popup.querySelector(".newgame-choice");
        if (!root) return;
        root.classList.add("sdc-mm-ng");
        root.querySelectorAll(".grid > .button, .grid > .label").forEach(function (b) {
            if (b.hasAttribute("data-sdc-o")) return;
            var s = b.getAttribute("style") || "";
            var r = /grid-row:\s*(\d+)/.exec(s), c = /grid-column:\s*(\d+)/.exec(s);
            var o = (c ? Number(c[1]) : 0) * 1000 + (r ? Number(r[1]) : 0);
            b.setAttribute("data-sdc-o", o);
            b.style.order = o;
        });
        if (!root.querySelector(".sdc-mm-choose"))
        {
            var bar = el("div", "sdc-mm-choose");
            var pick = btn("Choose", "on", function () {
                var armed = root.querySelector(".main-items .button.sdc-mm-armed");
                if (armed) click_native(armed);
            });
            bar.appendChild(pick);
            var desc = root.querySelector(".descriptions");
            if (desc) desc.parentNode.insertBefore(bar, desc.nextSibling);
            else root.appendChild(bar);
        }
        update_choose(root);
    }

    function update_choose(root)
    {
        var armed = root.querySelector(".main-items .button.sdc-mm-armed");
        var b = root.querySelector(".sdc-mm-choose button");
        root.classList.toggle("sdc-mm-has-armed", !!armed);
        // long names (sprint maps, ...) get one choice per row
        var all = root.querySelectorAll(".main-items .button"), long = 0;
        all.forEach(function (o) {
            if (o.textContent.trim().length > 20) long++;
        });
        root.classList.toggle("sdc-mm-1col", long > all.length * 0.3);
        var panes = root.querySelectorAll(".descriptions > .pane");
        var pane = armed && panes[Number(armed.getAttribute("data-description-index"))];
        root.classList.toggle("sdc-mm-nodesc", !pane || !pane.textContent.trim());
        if (b && armed)
            b.textContent = "Choose " + armed.textContent.replace(/^\s*\S+\s+-\s+/, "").trim();
    }

    var passing = false;
    function click_native(target)
    {
        passing = true;
        try
        {
            target.dispatchEvent(new MouseEvent("click", { bubbles: true,
                                                           cancelable: true,
                                                           view: window }));
        }
        finally { passing = false; }
    }

    // first tap previews, second tap (or Choose) picks
    window.addEventListener("click", function (ev) {
        if (passing || !active()) return;
        var b = ev.target.closest && ev.target.closest(".newgame-choice .main-items .button");
        if (!b) return;
        if (b.classList.contains("sdc-mm-armed")) return;   // second tap: pick
        ev.preventDefault();
        ev.stopPropagation();
        var root = b.closest(".newgame-choice");
        root.querySelectorAll(".sdc-mm-armed").forEach(function (o) {
            o.classList.remove("sdc-mm-armed");
        });
        b.classList.add("sdc-mm-armed");
        $(b).trigger("hover");   // stock focus: highlight + description pane
        update_choose(root);
        buzz();
    }, true);

    // Character overview (formatted-scroller "resists") ---------------------------

    // Splits each block of lines at gutters (2+ columns that are blank in
    // every line) and stacks the pieces, so 80-column text fits a phone.
    function stack_columns(r)
    {
        var lines = [], start = 0;
        for (var i = 0; i <= r.text.length; i++)
        {
            if (i === r.text.length || r.text[i] === "\n")
            {
                lines.push([start, i]);
                start = i + 1;
            }
        }
        var html = [], block = [];
        function line_text(l) { return r.text.slice(l[0], l[1]); }
        function flush()
        {
            if (!block.length) return;
            var width = 0;
            block.forEach(function (l) { width = Math.max(width, l[1] - l[0]); });
            function filled(l, c)
            {
                return l[0] + c < l[1] && r.text[l[0] + c] !== " ";
            }
            // a gutter column may be crossed by one line of a longer block,
            // which is then kept whole after the columns. Only when that
            // leaves most lines in columns (else the block stays as it is).
            var tol = block.length >= 6 ? 1 : 0;
            var blank = [];
            for (var c = 0; c < width; c++)
            {
                blank[c] = block.filter(function (l) { return filled(l, c); })
                    .length <= tol;
            }
            var cuts = [0], gutters = [], c2 = 0;
            while (c2 < width)
            {
                if (blank[c2])
                {
                    var e = c2;
                    while (e < width && blank[e]) e++;
                    if (e - c2 >= 2 && c2 > 0 && e < width)
                    {
                        cuts.push(e);
                        gutters.push([c2, e]);
                    }
                    c2 = e;
                }
                else c2++;
            }
            cuts.push(width);
            if (block.length < 2) { cuts = [0, width]; gutters = []; }
            var spanning = block.filter(function (l) {
                return gutters.some(function (g) {
                    for (var c = g[0]; c < g[1]; c++)
                        if (filled(l, c)) return true;
                    return false;
                });
            });
            if (spanning.length > 1)
            {
                cuts = [0, width];
                spanning = [];
            }
            var rows = block.filter(function (l) { return spanning.indexOf(l) < 0; });
            function eq_line(html, plain)
            {
                // equipment rows ("a - +0 robe"): tap to describe the item
                var m = /^([a-zA-Z]) - /.exec(plain.trim());
                return m ? "<span class='sdc-mm-eq' data-k='" + m[1] + "'>"
                    + html + "</span>" : html;
            }
            var tail = spanning.map(function (l) {
                var t = r.text.slice(l[0], l[1]);
                var lead = t.length - t.replace(/^ +/, "").length;
                return eq_line(runs_html(r, l[0] + lead, l[1]), t);
            });
            for (var k = 0; k + 1 < cuts.length; k++)
            {
                var seg = [];
                rows.forEach(function (l) {
                    var a = l[0] + cuts[k], b = Math.min(l[1], l[0] + cuts[k + 1]);
                    if (a >= b) return seg.push("");
                    var t = r.text.slice(a, b);
                    var lead = t.length - t.replace(/^ +/, "").length;
                    var trail = t.length - t.replace(/ +$/, "").length;
                    if (!t.trim()) return seg.push("");
                    seg.push(eq_line(runs_html(r, a + (k ? lead : 0), b - trail), t));
                });
                while (seg.length && !seg[seg.length - 1]) seg.pop();
                while (seg.length && !seg[0]) seg.shift();
                if (seg.length)
                    html.push("<div class='sdc-mm-col'>" + seg.join("\n") + "</div>");
            }
            if (tail.length)
                html.push("<div class='sdc-mm-col'>" + tail.join("\n") + "</div>");
            block = [];
        }
        lines.forEach(function (l) {
            if (!line_text(l).trim()) { flush(); html.push("<div class='sdc-mm-gap'></div>"); }
            else block.push(l);
        });
        flush();
        return html.join("");
    }

    function dress_overview(popup)
    {
        var fs = popup.querySelector(".formatted-scroller[data-tag='resists']");
        if (!fs) return;
        var body = fs.querySelector(".simplebar-content") || fs.querySelector(".body");
        if (!body || body.querySelector(".sdc-mm-stack")) return;
        var r = runs(body);
        var stack = el("div", "sdc-mm-stack");
        stack.innerHTML = stack_columns(r);
        stack.addEventListener("click", function (ev) {
            var t = ev.target.closest(".sdc-mm-eq");
            if (!t) return;
            ev.preventDefault();
            ev.stopPropagation();
            send_text(t.getAttribute("data-k"));
        });
        Array.prototype.forEach.call(body.childNodes, function (n) {
            if (n.nodeType === 1) n.classList.add("sdc-mm-hidden");
            else if (n.nodeType === 3)
            {
                var s = document.createElement("span");
                s.className = "sdc-mm-hidden";
                n.parentNode.replaceChild(s, n);
                s.appendChild(n);
            }
        });
        body.appendChild(stack);
        fs.classList.add("sdc-mm-stacked");
    }

    // Text prompts ----------------------------------------------------------------

    var NUMERIC_TAGS = { skill_target: true, travel_depth: true };

    function dress_input(popup)
    {
        var box = popup.querySelector("#input_text, .msgwin-get-line");
        if (!box) return;
        var input = box.querySelector("input");
        if (!input) return;
        var tag = (/(?:^|\s)input_(\S+)/.exec(box.className) || [])[1] || "";

        if (pending_target && tag === "skill_target")
        {
            var v = pending_target.value;
            pending_target = null;
            input.value = v;
            submit_input(box, input);
            return;
        }
        if (box.querySelector(".sdc-mm-inbar")) return;
        var numeric = !!NUMERIC_TAGS[tag];
        var bar = el("div", "sdc-mm-inbar");
        if (numeric)
        {
            input.setAttribute("inputmode", "none");
            input.blur();
            var pad = el("div", "sdc-mm-pad");
            "789456123.0".split("").forEach(function (d) {
                pad.appendChild(btn(d, "", function () { input.value += d; }));
            });
            pad.appendChild(btn("⌫", "", function () {
                input.value = input.value.slice(0, -1);
            }));
            bar.appendChild(pad);
        }
        var row = el("div", "sdc-mm-row sdc-mm-acts");
        if (!numeric)
            row.appendChild(btn("Keyboard", "", function () { input.focus(); }));
        row.appendChild(btn("Cancel", "", function () { send_code(27); }));
        row.appendChild(btn("OK", "on", function () { submit_input(box, input); }));
        bar.appendChild(row);
        box.appendChild(bar);
    }

    function submit_input(box, input)
    {
        if (box.classList.contains("msgwin-get-line"))
        {
            var enter = box.querySelector("[data-hotkey='Enter']");
            if (enter) { click_native(enter); return; }
        }
        $(input).trigger($.Event("keydown", { which: 13, keyCode: 13 }));
    }

    // "(Left/Right/Tab to switch category)" in a menu title (inventory, ...):
    // a button for it, since arrows and Tab need a keyboard
    function category_button(menu)
    {
        var title = menu.querySelector(".menu_title");
        var has = !!title && /Tab to switch/.test(title.textContent);
        var b = menu.querySelector(":scope > .sdc-mm-keys.sdc-mm-cat");
        if (!has) { if (b) b.remove(); return; }
        if (b) return;
        b = el("div", "sdc-mm-keys sdc-mm-cat");
        b.appendChild(btn("Next category ⇥", "", function () { send_code(9); }));
        title.parentNode.insertBefore(b, title.nextSibling);
    }

    // Scan ------------------------------------------------------------------------

    function dress(popup)
    {
        add_close(popup);
        var skills = popup.querySelector(".menu_txt.menu_skills");
        if (skills) { render_skills(skills); return; }
        var menu = popup.querySelector(".menu");
        if (menu)
        {
            if (menu.classList.contains("menu_spell")) dress_rows(popup, "spell");
            else if (menu.classList.contains("menu_ability")) dress_rows(popup, "ability");
            var more = menu.querySelector(".menu_more");
            if (more) hint_bar(more);
            category_button(menu);
            return;
        }
        if (popup.querySelector(".newgame-choice")) { dress_newgame(popup); return; }
        dress_overview(popup);
        dress_input(popup);
        var fmore = popup.querySelector(".formatted-scroller > .more");
        if (fmore) hint_bar(fmore);
    }

    var queued = false;
    function schedule()
    {
        if (queued) return;
        queued = true;
        window.requestAnimationFrame(function () {
            queued = false;
            if (!active()) return;
            $("#ui-stack").children(".ui-popup").each(function () {
                try { dress(this); }
                catch (e) { api.warn("mobilemenus", e); }
            });
        });
    }

    function ours(node)
    {
        return node.nodeType === 1 && node.closest
            && !!node.closest(".sdc-mm-panel, .sdc-mm-keys, .sdc-mm-x,"
                              + " .sdc-mm-inbar, .sdc-mm-stack, .sdc-mm-choose");
    }

    var observer = null, observed = null;
    function watch()
    {
        var stack = document.getElementById("ui-stack");
        if (!stack || stack === observed) return;
        if (observer) observer.disconnect();
        observed = stack;
        observer = new MutationObserver(function (records) {
            if (!active()) return;
            for (var i = 0; i < records.length; i++)
            {
                if (!ours(records[i].target)) { schedule(); return; }
            }
        });
        observer.observe(stack, { childList: true, subtree: true,
                                  characterData: true });
        schedule();
    }

    // the skills text arrives as "txt" updates (text.js triggers this)
    $(document).on("text_update", ".menu_skills", function () {
        if (active()) schedule();
    });

    api.on("game_init", function () { apply_mode(); watch(); });
    api.on("setting", function (key) {
        if (key === "mobile_menus" || key === "mobile") apply_mode();
    });
    // #ui-stack exists before the HUD (character selection runs first)
    var tries = 0;
    var poll = setInterval(function () {
        apply_mode();
        watch();
        if (observed || ++tries > 120) clearInterval(poll);
    }, 500);

    return { active: active };
});
