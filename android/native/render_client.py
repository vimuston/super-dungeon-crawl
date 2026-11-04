#!/usr/bin/env python3
"""Render webserver/templates/client.html for the app's local server.

The app serves the page itself, so render it once at build time the way
ws_handler's MainHandler would, with the socket address left as a
placeholder (@SOCKET_SERVER@) that the app fills in with its port.
"""
import sys

import tornado.template


class Config:
    allow_password_reset = False
    admin_password_reset = False


def main():
    loader = tornado.template.Loader(sys.argv[1])
    html = loader.load("client.html").generate(
        socket_server="@SOCKET_SERVER@",
        static_url=lambda path: "/static/" + path,
        config=Config(),
        reset_token=None,
        reset_token_error=None,
        game_version="",
        username=None,
    )
    sys.stdout.write(html.decode("utf-8"))


if __name__ == "__main__":
    main()
