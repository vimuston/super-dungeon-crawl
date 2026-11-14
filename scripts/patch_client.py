"""Hook the crt.js core module into the stock webtiles client.

Small, asserted string edits so an upstream change fails loudly instead of
silently producing a broken client. Run on pristine files (apply.sh restores
them from git first).
"""
import re
import sys
from pathlib import Path

game_data = Path(sys.argv[1])


def patch(path, edits):
    text = path.read_text(encoding="utf-8")
    for old, new in edits:
        if text.count(old) != 1:
            sys.exit(f"patch_client: expected exactly one match in {path.name}:\n{old}")
        text = text.replace(old, new)
    path.write_text(text, encoding="utf-8")


# loading screen: our title + a progress bar instead of the random stock art
# (client.js shows one random "#loader img"; with a single one it is ours)
client_html = game_data.parent / "templates" / "client.html"
text = client_html.read_text(encoding="utf-8")
loader_re = re.compile(
    r'<span id="loader_text">Loading\.\.\.</span><br>\n'
    r'(?:\s*<img [^>]*static_url\("title_[^"]+\.png"\) \}\}">\n)+')
if len(loader_re.findall(text)) != 1:
    sys.exit("patch_client: expected exactly one loader image list in client.html")
text = loader_re.sub(
    '<div class="sdc-loader">\n'
    '          <img class="sdc-loader-title" alt="Super Dungeon Crawl: Stone Soup"\n'
    '               src="{{ static_url("sdc_title.png") }}">\n'
    '          <div class="sdc-loader-bar" role="progressbar" aria-label="Loading">'
    + "<i></i>" * 12 + '</div>\n'
    '          <span id="loader_text">Loading...</span>\n'
    '        </div>\n', text)
client_html.write_text(text, encoding="utf-8")
patch(client_html, [
    ('<link rel="stylesheet" type="text/css" href="{{ static_url("style.css") }}">',
     '<link rel="stylesheet" type="text/css" href="{{ static_url("style.css") }}">\n'
     '    <link rel="stylesheet" type="text/css" href="{{ static_url("sdc_loader.css") }}">\n'
     '    <link rel="stylesheet" type="text/css" href="{{ static_url("sdc_lobby.css") }}">'),
    # responsive lobby: lay out at the device's width (mobile.js still sets
    # its own viewport once a game is running)
    ('<meta name="viewport" content="width=860, initial-scale=1.0">',
     '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'),
])

patch(game_data / "templates" / "game.html", [
    ('href="/gamedata/{{ version }}/simplebar.css"\n/>',
     'href="/gamedata/{{ version }}/simplebar.css"\n/>\n'
     '<link rel="stylesheet" type="text/css" href="/gamedata/{{ version }}/crt.css" />'),
])

patch(game_data / "static" / "game.js", [
    # load the module
    ('"./mouse_control", "./text"', '"./mouse_control", "./crt", "./text"'),
    ("minimap, enums, messages, options, mouse_control) {",
     "minimap, enums, messages, options, mouse_control, crt) {"),
    # HUD mode: the dungeon gets the full width, stats float over it
    ("var remaining_width = window_width - stat_width_px;",
     "var hud = crt.hud_active();\n"
     "        var remaining_width = hud ? window_width : window_width - stat_width_px;"),
    # mobile UI: messages float over the view, the dungeon gets the height
    ("var remaining_height = window_height - msg_height_px;",
     "var remaining_height = window_height\n"
     "            - (crt.messages_overlay() ? 0 : msg_height_px);"),
    ("minimap.fit_to(stat_width_px, layout_parameters);",
     "minimap.fit_to(hud ? crt.minimap_width(window_width, window_height)\n"
     "                               : stat_width_px, layout_parameters);"),
    ('$("#stats").width(stat_width_px);\n        $("#monster_list").width(stat_width_px);',
     'if (!hud)\n        {\n'
     '            $("#stats").width(stat_width_px);\n'
     '            $("#monster_list").width(stat_width_px);\n'
     '        }\n'
     '        else\n'
     '            $("#stats, #monster_list").css("width", "");'),
    ("        minimap.update_overlay();\n\n        var possible_input",
     "        minimap.update_overlay();\n        crt.after_layout();\n\n        var possible_input"),
    # let the crt.js module request a relayout when the HUD is toggled
    ("    // ugly circular reference breaking",
     "    crt.set_relayout(function () {\n"
     "        if (layout_parameters)\n"
     "            layout($.extend({}, layout_parameters), true);\n"
     "    });\n\n"
     "    // ugly circular reference breaking"),
])
