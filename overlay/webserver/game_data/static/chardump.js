// Character dump to the clipboard. Styles live in chardump.css.
//
// Command "char_dump" (the Dump # button on the mobile % sheet's identity
// card, mobilemenus.js): closes that sheet, opens crawl's game menu and
// picks "Generate and view character dump" (~ then #). Like #, that writes the
// morgue file; it also pushes the dump text in a formatted scroller (tag
// "dump"). The menu and the scroller stay hidden while that happens: the text
// is read from the scroller, both popups are closed with Esc and the text goes
// to the clipboard, and the % sheet is opened again. No binary or server change, so it works the same on the
// local server, the Pi, Android and Windows.
//
// The clipboard wants a recent user gesture: the round trip is a few hundred
// ms, well inside the browser's activation window. Should the copy still be
// refused (an older WebView, say), a panel shows the text with a Copy button,
// which is a fresh gesture.
//
// Debug: sdc_chardump_test(text) runs the copy step on the given text.
define(["jquery", "comm", "./sdc_api", "./enums"], function ($, comm, api, enums) {
    "use strict";

    var TIMEOUT_MS = 5000;
    var pending = null;     // {timer, observer, menu_seen, reopen}
    var closing = false;    // waiting for the % sheet to close first

    function command_mode()
    {
        var g = window.game;    // global set by game.js (circular import)
        return !!g && typeof g.get_input_mode === "function"
            && g.get_input_mode() === enums.mouse_mode.COMMAND;
    }

    function popups()
    {
        return $("#ui-stack").children(".ui-popup");
    }

    function esc()
    {
        comm.send_message("key", { keycode: 27 });
    }

    // Toast -----------------------------------------------------------------

    var toast_timer = null;
    function toast(text, bad)
    {
        var el = $("#sdc_dump_toast");
        if (!el.length)
            el = $("<div id='sdc_dump_toast' role='status'>").appendTo(document.body);
        el.text(text).toggleClass("sdc-dump-bad", !!bad).addClass("sdc-dump-show");
        clearTimeout(toast_timer);
        toast_timer = setTimeout(function () {
            el.removeClass("sdc-dump-show");
        }, 2500);
    }

    // Clipboard -------------------------------------------------------------

    function exec_copy(text)
    {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
        document.body.appendChild(ta);
        var prev = document.activeElement;
        ta.select();
        ta.setSelectionRange(0, text.length);
        var ok = false;
        try { ok = document.execCommand("copy"); }
        catch (e) { ok = false; }
        document.body.removeChild(ta);
        if (prev && prev.focus) try { prev.focus(); } catch (e) { }
        return ok;
    }

    // resolves true / false
    function copy(text)
    {
        var d = $.Deferred();
        if (navigator.clipboard && navigator.clipboard.writeText)
        {
            navigator.clipboard.writeText(text).then(function () {
                d.resolve(true);
            }, function () {
                d.resolve(exec_copy(text));
            });
        }
        else
            d.resolve(exec_copy(text));
        return d.promise();
    }

    // Fallback panel: the text, selectable, plus a Copy button.
    function show_panel(text)
    {
        $("#sdc_dump_panel").remove();
        var panel = $("<div id='sdc_dump_panel' class='sdc-panel'>");
        var head = $("<div class='sdc-dump-head'>").appendTo(panel);
        head.append($("<span>").text("Character dump"));
        var area = $("<textarea readonly spellcheck='false'>").val(text);
        function close()
        {
            panel.remove();
        }
        $("<button type='button' class='sdc-dump-btn'>").text("Copy")
            .on("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                copy(text).then(function (ok) {
                    if (ok)
                    {
                        close();
                        toast("Character dump copied");
                    }
                    else
                    {
                        area[0].select();
                        toast("Copy blocked: select the text and copy it", true);
                    }
                });
            }).appendTo(head);
        $("<button type='button' class='sdc-dump-btn' aria-label='Close'>")
            .html("&times;")
            .on("click", function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                close();
            }).appendTo(head);
        panel.append(area);
        // keep taps and keys out of the game underneath
        panel.on("mousedown mouseup click touchstart touchend keydown keypress"
                 + " keyup wheel", function (ev) { ev.stopPropagation(); });
        panel.appendTo(document.body);
    }

    function deliver(text)
    {
        copy(text).then(function (ok) {
            if (ok)
                toast("Character dump copied");
            else
                show_panel(text);
        });
    }

    // Grabbing the dump -----------------------------------------------------

    function finish(text)
    {
        if (!pending) return;
        clearTimeout(pending.timer);
        if (pending.observer) pending.observer.disconnect();
        var reopen = pending.reopen;
        pending = null;
        // leave the class on until crawl has popped both popups, so the game
        // menu does not flash back in between
        var wait = setInterval(function () {
            if (!popups().length) done();
        }, 50);
        var give_up = setTimeout(done, 1500);
        function done()
        {
            clearInterval(wait);
            clearTimeout(give_up);
            document.body.classList.remove("sdc-dumping");
            if (reopen && !popups().length && command_mode())
                comm.send_message("input", { text: "%" });
        }
        if (text === null)
            toast("Character dump failed", true);
        else
            deliver(text);
    }

    function check_stack()
    {
        if (!pending) return;
        var top = popups().last();
        if (!top.length) return;
        var scr = top.find(".formatted-scroller[data-tag='dump']");
        if (scr.length)
        {
            var body = scr.find(".simplebar-content");
            if (!body.length) body = scr.children(".body");
            var text = (body.length ? body[0] : scr[0]).textContent || "";
            text = text.replace(/\s+$/, "") + "\n";
            esc();  // the scroller
            esc();  // the game menu it was opened from
            finish(text);
        }
        else if (top.find(".menu_game_menu").length)
            pending.menu_seen = true;
    }

    // the % sheet (mobilemenus.js) is the one popup it may start from
    function on_sheet()
    {
        var p = popups();
        return p.length === 1 && p.find(".sdc-mm-sheet").length > 0;
    }

    function char_dump()
    {
        if (pending || closing) return;
        var stack = document.getElementById("ui-stack");
        if (!stack || !window.MutationObserver)
        {
            toast("Character dump unavailable", true);
            return;
        }
        if (on_sheet())
        {
            // Esc it, wait for crawl to pop it, dump, then show it again
            closing = true;
            document.body.classList.add("sdc-dumping");
            esc();
            var t0 = Date.now();
            var wait = setInterval(function () {
                if (!popups().length && command_mode())
                {
                    clearInterval(wait);
                    closing = false;
                    start(stack, true);
                }
                else if (Date.now() - t0 > 2000)
                {
                    clearInterval(wait);
                    closing = false;
                    document.body.classList.remove("sdc-dumping");
                    toast("Character dump failed", true);
                }
            }, 30);
            return;
        }
        if (!command_mode() || popups().length)
        {
            toast("Close the open menu first", true);
            return;
        }
        start(stack, false);
    }

    function start(stack, reopen)
    {
        document.body.classList.add("sdc-dumping");
        pending = { menu_seen: false, reopen: reopen };
        pending.observer = new MutationObserver(check_stack);
        pending.observer.observe(stack, { childList: true, subtree: true });
        pending.timer = setTimeout(function () {
            // got stuck in the game menu: back out of it
            if (pending && pending.menu_seen
                && popups().last().find(".menu_game_menu").length)
                esc();
            finish(null);
        }, TIMEOUT_MS);
        comm.send_message("input", { text: "~" });
        comm.send_message("input", { text: "#" });
    }

    api.register_command("char_dump", char_dump);

    api.on("game_cleanup", function () {
        if (pending) finish(null);
        $("#sdc_dump_panel").remove();
    });

    window.sdc_chardump_test = function (text) {
        deliver(String(text === undefined ? "sdc chardump test\n" : text));
    };

    return { char_dump: char_dump };
});
