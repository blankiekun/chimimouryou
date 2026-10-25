# @license BSD-3-Clause
# Copyright (c) 2026, ッツ Reader Authors
# All rights reserved.

"""chimimouryou Discord companion: passes the status chimimouryou pages send to Discord.

Starts when a profile opens and stops when it closes (also on quit). Nothing here blocks Anki's
UI thread: binding, connecting and clearing happen on background threads.
"""

import threading

from .presence import Presence
from .server import DEFAULT_PORT, make_server, serve_in_thread

# placeholder: replace with the "Chimi Reader" application id from the Discord developer portal.
CLIENT_ID = "000000000000000000"

_lock = threading.Lock()
_running = {}


def _start(config):
    with _lock:
        _stop_locked()
        presence = Presence(CLIENT_ID)
        try:
            server = make_server(presence, int(config.get("port") or DEFAULT_PORT),
                                 config.get("extraOrigins") or ())
        except (OSError, ValueError) as err:  # port taken (another Anki, another program) or not a number
            print("chimimouryou Discord companion: can't listen:", err)
            return
        presence.start()
        serve_in_thread(server)
        _running.update(presence=presence, server=server)


def _stop_locked():
    if _running:
        _running.pop("presence").stop()
        server = _running.pop("server")
        server.shutdown()
        server.server_close()


def _stop():
    with _lock:
        _stop_locked()


try:
    from aqt import gui_hooks, mw
except ImportError:  # outside Anki (the tests)
    gui_hooks = None

if gui_hooks:
    def _on_open():
        config = mw.addonManager.getConfig(__name__) or {}
        threading.Thread(target=_start, args=(config,), daemon=True).start()

    def _on_close():
        threading.Thread(target=_stop, daemon=True).start()

    gui_hooks.profile_did_open.append(_on_open)
    gui_hooks.profile_will_close.append(_on_close)
