"""Super Dungeon Crawl: several saved characters per account.

Crawl keeps one save per character name in each save slot (normal, seeded,
tutorial and hints share a slot; sprint and descent have their own), and the
stock webtiles server always runs crawl with -name <account name>, so an
account gets one character per slot. This module, installed by server.py,
lets a player name a new character in the lobby and continue any of them:

- The lobby (templates/game_links.html, rendered by static/sdc_lobby.js)
  lists the account's saved characters and a "new game" card per mode.
- "#play-<game id>~<name>" plays that character: crawl runs with -name
  <name>; the account name still owns the process, rc file and morgue dir.
- Names an account has used are kept in <rcfile_path>/<account>.sdc-chars;
  a name belongs to one account (and never to another account's own name),
  so players on a public server can't load each other's saves.
"""
import json
import logging
import os
import re

from tornado.escape import json_decode, to_unicode

from webtiles import checkoutput, config, process_handler, userdb, ws_handler

NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,20}$")
SEP = "~"
OWN_SUFFIX = ".sdc-chars"


def slot(mode):
    return mode if mode in ("sprint", "descent") else "main"


# ---- who owns which names ---------------------------------------------------

def _owner_dir(game_id, username):
    return config.game_param(game_id, "rcfile_path", username=username)


def _owned_file(username):
    return os.path.join(_owner_dir(next(iter(config.games)), username),
                        username + OWN_SUFFIX)


def owned_names(username):
    """The account's characters: its own name first, then the ones it made."""
    names = [username]
    try:
        with open(_owned_file(username), encoding="utf-8") as f:
            for line in f:
                n = line.strip()
                if NAME_RE.match(n) and n.lower() not in (x.lower() for x in names):
                    names.append(n)
    except OSError:
        pass
    return names


def _owns(username, name):
    return name.lower() in (n.lower() for n in owned_names(username))


def _taken_elsewhere(username, name):
    """Another account's name, or a character another account made."""
    low = name.lower()
    try:
        info = userdb.get_user_info(name)
    except Exception:
        info = None
    if info and info.username.lower() != username.lower():
        return True
    d = os.path.dirname(_owned_file(username))
    try:
        files = os.listdir(d)
    except OSError:
        return False
    for fn in files:
        if not fn.endswith(OWN_SUFFIX) or fn == username + OWN_SUFFIX:
            continue
        try:
            with open(os.path.join(d, fn), encoding="utf-8") as f:
                if any(line.strip().lower() == low for line in f):
                    return True
        except OSError:
            pass
    return False


def _claim(username, name):
    if _owns(username, name):
        return
    path = _owned_file(username)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(name + "\n")


# ---- lobby data -------------------------------------------------------------

def _mode_games(sock):
    """game id per crawl mode (first allowed game of each), and the modes list
    for the "new game" cards."""
    by_mode = {}
    modes = []
    rc_paths = set()
    for g in config.games:
        if not sock.game_id_allowed(g):
            continue
        mode = config.game_modes.get(g) or "normal"
        by_mode.setdefault(mode, g)
        rc = config.game_param(g, "rcfile_path", username=sock.username)
        modes.append({
            "game": g,
            "mode": mode,
            "label": config.games[g].templated("name", username=sock.username),
            "rc": rc not in rc_paths,
        })
        rc_paths.add(rc)
    return by_mode, modes


def _chars_from_json(name, data, by_mode):
    """Characters in one -save-json reply (a dict of mode -> save info; modes
    sharing a slot all report the same save)."""
    out = []
    seen_slots = set()
    for mode, info in (data or {}).items():
        if not isinstance(info, dict):
            continue
        if info.get("loadable"):
            if info.get("game_type") != mode:
                continue  # the slot's save belongs to another mode
            playing = False
        else:
            if slot(mode) in seen_slots:
                continue
            mode = mode if slot(mode) != "main" else "normal"
            playing = True
        if slot(mode) in seen_slots:
            continue
        seen_slots.add(slot(mode))
        game = by_mode.get(mode) or by_mode.get("normal")
        if not game:
            continue
        out.append({
            "name": info.get("name") or name,
            "mode": mode,
            "game": game,
            "desc": info.get("short_desc") or "",
            "playing": playing,
        })
    return out


def collect(sock, done):
    """Call done(lobby_dict) once every owned name has been checked."""
    by_mode, modes = _mode_games(sock)
    names = owned_names(sock.username)
    chars = []
    base = None
    for g in by_mode.values():
        base = config.games[g].get_call_base()
        break

    def step(i):
        if i >= len(names) or base is None:
            done({"user": sock.username, "chars": chars, "modes": modes,
                  "error": getattr(sock, "sdc_error", None)})
            sock.sdc_error = None
            return

        def got(data, returncode):
            try:
                if returncode == 0 and data:
                    chars.extend(_chars_from_json(names[i], json_decode(data),
                                                  by_mode))
            except Exception:
                logging.warning("sdc_chars: bad save info for %s", names[i],
                                exc_info=True)
            step(i + 1)

        try:
            checkoutput.check_output(base + ["-save-json", names[i]], got)
        except Exception:
            logging.warning("sdc_chars: save info failed", exc_info=True)
            step(i + 1)

    step(0)


# ---- patches ----------------------------------------------------------------

def _send_lobby_html(self):
    if self.ui is None:
        return
    banner_html = to_unicode(self.render_string("banner.html",
                                                username=self.username))
    self.queue_message("html", id="banner", content=banner_html)
    if not self.username:
        return

    def send(data):
        if self not in ws_handler.sockets or self.ui is None:
            return
        try:
            games = {g: config.games[g].templated_dict(self.username)
                     for g in config.games if self.game_id_allowed(g)}
            html = to_unicode(self.render_string(
                "game_links.html", games=games, lobby_json=json.dumps(data)))
            self.send_message("set_game_links", content=html)
        except Exception:
            self.logger.warning("sdc_chars: lobby render failed", exc_info=True)

    collect(self, send)


_orig_start_crawl = ws_handler.CrawlWebSocket.start_crawl


def _refuse(sock, message):
    sock.sdc_error = message
    sock.go_lobby()
    sock.send_lobby_html()


def _start_crawl(self, game_id):
    name = None
    if game_id and SEP in game_id:
        game_id, name = game_id.split(SEP, 1)
    if self.process or not config.get("dgl_mode") or not self.username:
        return _orig_start_crawl(self, game_id)
    if name is None:
        name = self.username
    if not NAME_RE.match(name) and name != self.username:
        return _refuse(self, "Character names are 1-20 letters, digits, - or _.")
    if not _owns(self.username, name):
        if _taken_elsewhere(self.username, name):
            return _refuse(self, "The name %s is taken. Pick another one." % name)
        try:
            _claim(self.username, name)
        except OSError:
            self.logger.warning("sdc_chars: can't record %s", name, exc_info=True)
            return _refuse(self, "Couldn't create the character.")
    self.sdc_char = name
    return _orig_start_crawl(self, game_id)


_orig_base_call = process_handler.CrawlProcessHandlerBase._base_call


def _base_call(self):
    call = _orig_base_call(self)
    if not hasattr(self, "sdc_char"):
        r = self.get_primary_receiver()
        self.sdc_char = getattr(r, "sdc_char", None) if r else None
    if self.sdc_char and "-name" in call:
        call[call.index("-name") + 1] = self.sdc_char
    return call


def install():
    ws_handler.CrawlWebSocket.send_lobby_html = _send_lobby_html
    ws_handler.CrawlWebSocket.start_crawl = _start_crawl
    process_handler.CrawlProcessHandlerBase._base_call = _base_call
