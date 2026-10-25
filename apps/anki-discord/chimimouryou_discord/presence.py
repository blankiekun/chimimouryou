# @license BSD-3-Clause
# Copyright (c) 2026, ッツ Reader Authors
# All rights reserved.

"""A worker thread that keeps Discord showing the newest activity.

Discord rate-limits SET_ACTIVITY (about one per 15 s), so updates are coalesced: only the newest
waiting one is sent. It reconnects when Discord restarts and clears the status when stopped.
"""

import threading
import time

from . import ipc

MIN_INTERVAL = 15.0
RETRY_INTERVAL = 15.0
IDLE_CHECK = 5.0


class Presence:
    def __init__(self, client_id, connect=ipc.connect, min_interval=MIN_INTERVAL,
                 retry_interval=RETRY_INTERVAL, idle_check=IDLE_CHECK):
        self.client_id = client_id
        self._connect = connect
        self.min_interval = min_interval
        self.retry_interval = retry_interval
        self.idle_check = idle_check
        self._cond = threading.Condition()
        self._want = None  # the activity Discord should show; None = nothing
        self._dirty = False
        self._stopping = False
        self._conn = None
        self.last_sent = None  # epoch ms of the last update Discord accepted
        self._thread = threading.Thread(target=self._run, name="chimimouryou-discord", daemon=True)

    def start(self):
        self._thread.start()

    def set(self, activity):
        with self._cond:
            self._want, self._dirty = activity, True
            self._cond.notify()

    def clear(self):
        self.set(None)

    def stop(self):
        """Clears the status and ends the thread; doesn't wait for it."""
        with self._cond:
            self._stopping, self._want, self._dirty = True, None, True
            self._cond.notify()

    def join(self, timeout=None):
        self._thread.join(timeout)

    @property
    def status(self):
        return "connected" if self._conn else "closed"

    def _drop(self):
        if self._conn:
            self._conn.close()
            self._conn = None

    def _try_connect(self):
        try:
            self._conn = self._connect(self.client_id)
            return True
        except (OSError, ipc.IPCError, ValueError):
            return False

    def _run(self):
        next_send = 0.0
        next_connect = time.monotonic() + self.retry_interval
        self._try_connect()
        while True:
            with self._cond:
                while not self._dirty:
                    self._cond.wait(self.idle_check)
                    if self._dirty:
                        break
                    # Idle: notice Discord going away or coming back, and resend what it should show.
                    if self._conn and not self._conn.alive():
                        self._drop()
                        self._dirty = self._want is not None
                    elif not self._conn and time.monotonic() >= next_connect:
                        next_connect = time.monotonic() + self.retry_interval
                        if self._try_connect():
                            self._dirty = self._want is not None
                stopping = self._stopping
                wait = next_send - time.monotonic()
                if wait > 0 and not stopping:
                    self._cond.wait(wait)
                    continue
                activity, self._dirty = self._want, False
            if stopping and not self._conn:
                return
            if not self._conn and not self._try_connect():
                next_send = next_connect = time.monotonic() + self.retry_interval
                with self._cond:
                    self._dirty = self._dirty or activity is not None
                continue
            try:
                self._conn.set_activity(activity)
                self.last_sent = int(time.time() * 1000)
            except ipc.Refused:
                pass  # sending it again won't help; wait for the next update
            except (OSError, ipc.IPCError, ValueError):
                self._drop()
                if not stopping:
                    with self._cond:
                        self._dirty = self._dirty or activity is not None
            next_send = time.monotonic() + self.min_interval
            if stopping:
                self._drop()
                return
