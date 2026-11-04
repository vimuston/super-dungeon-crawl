"""Create the local autologin account if it doesn't exist yet.

Run from crawl-ref/source. The password is random and never needed: the
server's `autologin` setting logs this user in without it.
"""
import os
import secrets
import sys

sys.path.insert(0, os.path.abspath("webserver"))

import webtiles.config  # noqa: E402
import webtiles.userdb as userdb  # noqa: E402
import config as server_config  # noqa: E402

webtiles.config.init_config_from_module(server_config)
webtiles.config.server_path = os.path.abspath("webserver")

name = webtiles.config.get("autologin")
if name:
    userdb.user_db = userdb.ensure_user_db_exists(quiet=True)
    if not userdb.get_user_info(name):
        err = userdb.register_user(name, secrets.token_urlsafe(24), "")
        if err:
            sys.exit("ensure_user: " + err)
        print("Created local user '%s'" % name)
