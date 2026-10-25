# @license BSD-3-Clause
# Copyright (c) 2026, ッツ Reader Authors
# All rights reserved.

"""chimimouryou Discord companion: passes the status chimimouryou pages send to Discord.

Starts when a profile opens and stops when it closes (also on quit). Nothing here blocks Anki's
UI thread: binding, connecting, clearing and the hub requests happen on background threads.
Tools → "Pair chimimouryou Discord…" pairs it with the hub relay (status from your other devices).
"""

import os
import threading

from . import relay as relay_mod
from .presence import Presence
from .server import DEFAULT_PORT, make_server, serve_in_thread

# The "Chimi Reader" application in the Discord developer portal (public, not a secret).
CLIENT_ID = "1564044085365309470"

# user_files survives add-on updates (Anki keeps that folder).
PAIRING_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "user_files", "pairing.json")

_lock = threading.Lock()
_running = {}


def config_hub(config):
    return relay_mod.valid_hub(config.get("hub")) or relay_mod.DEFAULT_HUB


def _start(config):
    with _lock:
        _stop_locked()
        presence = Presence(CLIENT_ID)
        relay = relay_mod.Relay(presence, relay_mod.Store(PAIRING_FILE))
        try:
            server = make_server(presence, int(config.get("port") or DEFAULT_PORT),
                                 config.get("extraOrigins") or (), relay)
        except (OSError, ValueError) as err:  # port taken (another Anki, another program) or not a number
            print("chimimouryou Discord companion: can't listen:", err)
            return
        presence.start()
        relay.start()
        serve_in_thread(server)
        _running.update(presence=presence, server=server, relay=relay)


def _stop_locked():
    if _running:
        _running.pop("relay").stop()
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

    from aqt.qt import QAction, QDialog, QHBoxLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout

    class _PairDialog(QDialog):
        """Code field, Pair, status text; Unpair when paired. The hub requests run in the background."""

        def __init__(self):
            super().__init__(mw)
            self.setWindowTitle("Pair chimimouryou Discord")
            self.info = QLabel()
            self.info.setWordWrap(True)
            self.code = QLineEdit()
            self.code.setPlaceholderText("XXX-XXX-XXX")
            self.code.returnPressed.connect(self._pair)
            self.pair_button = QPushButton("Pair")
            self.pair_button.clicked.connect(self._pair)
            self.unpair_button = QPushButton("Unpair")
            self.unpair_button.clicked.connect(self._unpair)
            self.status = QLabel()
            self.status.setWordWrap(True)
            row = QHBoxLayout()
            row.addWidget(self.code)
            row.addWidget(self.pair_button)
            row.addWidget(self.unpair_button)
            layout = QVBoxLayout(self)
            layout.addWidget(self.info)
            layout.addLayout(row)
            layout.addWidget(self.status)
            self.setMinimumWidth(420)

        def refresh(self, status=""):
            relay = _running.get("relay")
            paired = bool(relay and relay.paired)
            self.info.setText(
                "Paired: this computer's Discord also shows the status your other devices (a phone) send "
                "to chimimouryou. A page open on this computer wins." if paired else
                "Show the status your other devices (a phone) send to chimimouryou in this computer's "
                "Discord. In chimimouryou: Settings → Discord → Pair with a code, then type the code here.")
            self.code.setVisible(not paired)
            self.pair_button.setVisible(not paired)
            self.unpair_button.setVisible(paired)
            self.status.setText(status)

        def _pair(self):
            relay = _running.get("relay")
            code = self.code.text().strip()
            if not relay:
                return self.refresh("The companion isn't running: another program may be using its port "
                                    "(Tools → Add-ons → Config).")
            if not code or not self.pair_button.isEnabled():
                return
            hub = config_hub(mw.addonManager.getConfig(__name__) or {})

            def task():
                relay.pair(hub, relay_mod.pair_with_code(hub, code))

            def done(future):
                self.pair_button.setEnabled(True)
                try:
                    future.result()
                except relay_mod.RelayError as err:
                    return self.refresh(str(err))
                except OSError:
                    return self.refresh("The hub paired, but the key couldn't be saved in the add-on's folder.")
                self.code.clear()
                self.refresh("Paired.")

            self.pair_button.setEnabled(False)
            self.status.setText("Pairing…")
            mw.taskman.run_in_background(task, done)

        def _unpair(self):
            relay = _running.get("relay")
            if relay:
                mw.taskman.run_in_background(relay.unpair, lambda _future: self.refresh(
                    "Unpaired. Also remove this computer under Settings → Discord in chimimouryou."))

    _dialog = []

    def _open_dialog():
        if not _dialog:
            _dialog.append(_PairDialog())
        _dialog[0].refresh()
        _dialog[0].show()
        _dialog[0].raise_()

    _action = QAction("Pair chimimouryou Discord…", mw)
    _action.triggered.connect(_open_dialog)
    mw.form.menuTools.addAction(_action)
