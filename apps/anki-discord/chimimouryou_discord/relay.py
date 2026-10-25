# @license BSD-3-Clause
# Copyright (c) 2026, ッツ Reader Authors
# All rights reserved.

"""The hub relay: shows the status your other devices (a phone) send to the social hub.

Paired with a presence key (`pk_…`), the add-on asks the hub for the current activity, only while
Discord is connected: every 30 s, every 2 min after 10 min without a status, every 5 min after an
hour, or later when the hub says so (`next`).
A status a page on this computer sent in the last 2 minutes, and didn't clear, wins over the hub's.
The key and hub address live in the add-on's user_files (kept across add-on updates), never in logs.
"""

import json
import os
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import activity as activity_mod

DEFAULT_HUB = "https://chimi-hub.blankiekun.workers.dev"
# Cloudflare's free plan counts every request: (seconds without a hub status, poll every N seconds).
TIERS = ((0, 30.0), (600, 120.0), (3600, 300.0))
MAX_HINT = 3600.0
DISCORD_CHECK = 30.0  # how often to look (locally) whether Discord came back
MAX_BACKOFF = 600.0
LOCAL_WINS = 120.0
TIMEOUT = 10.0
MAX_RESPONSE = 64 * 1024
KEY = re.compile(r"^pk_[A-Za-z0-9_-]{20,128}$")
CODE_CHARS = re.compile(r"[^0-9A-Z]")


class RelayError(Exception):
    pass


def valid_hub(value):
    """The hub's base URL, normalised, or None unless it is a plain https://host[:port][/path]."""
    if not isinstance(value, str) or len(value) > 256:
        return None
    try:
        url = urllib.parse.urlsplit(value.strip())
        url.port  # noqa: B018 - raises on a bad port
    except ValueError:
        return None
    if url.scheme != "https" or not url.hostname or "@" in url.netloc or url.query or url.fragment:
        return None
    return "https://" + url.netloc + url.path.rstrip("/")


def valid_key(value):
    return isinstance(value, str) and bool(KEY.match(value))


def normalise_code(value):
    """'abc def ghj' → 'ABC-DEF-GHJ'; anything that isn't 9 letters/digits is sent as typed (uppercased)."""
    raw = CODE_CHARS.sub("", (value or "").upper())
    return "-".join((raw[0:3], raw[3:6], raw[6:9])) if len(raw) == 9 else raw


def device_name():
    return ("Anki on " + (socket.gethostname() or "this computer"))[:40]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # a redirect must never carry the key to another address


_opener = urllib.request.build_opener(_NoRedirect)


def request(method, url, key=None, body=None, timeout=TIMEOUT):
    """(status, parsed JSON or None, headers). Raises RelayError when the hub can't be reached."""
    headers = {"Accept": "application/json", "User-Agent": "chimimouryou-discord"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if key:
        headers["Authorization"] = "Bearer " + key
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp = _opener.open(req, timeout=timeout)
    except urllib.error.HTTPError as err:
        err.close()
        return err.code, None, err.headers  # callers only need the status of an error
    except (OSError, ValueError) as err:  # URLError, timeouts, refused connections
        raise RelayError(type(err).__name__) from None
    with resp:
        status = resp.status
        try:
            raw = resp.read(MAX_RESPONSE + 1)
        except OSError:
            raise RelayError("read") from None
    if not raw or len(raw) > MAX_RESPONSE:
        return status, None, resp.headers
    try:
        return status, json.loads(raw.decode("utf-8")), resp.headers
    except (ValueError, UnicodeDecodeError):
        return status, None, resp.headers


def _hint(value):
    """The hub's `next` (seconds to wait), or 0 when missing or not a sane number."""
    try:
        value = float(value)
    except (TypeError, ValueError):
        return 0.0
    return min(value, MAX_HINT) if value > 0 else 0.0


def poll_delay(idle, hint=0.0, tiers=TIERS):
    """Seconds until the next poll: by how long the hub has had no status (`idle`), or the hub's hint if longer."""
    for after, delay in reversed(tiers):
        if idle >= after:
            return max(delay, hint)
    return max(tiers[0][1], hint)


def pair_with_code(hub, code, name=None):
    """Trades a pairing code from chimimouryou's settings for a presence key. Returns the key."""
    try:
        status, body, _headers = request("POST", hub + "/v1/presence/pair", body={"code": normalise_code(code),
                                                                       "name": name or device_name()})
    except RelayError:
        raise RelayError("Can't reach the hub. Check the internet connection and try again.") from None
    if status == 404:
        raise RelayError("That code is wrong or has expired. Make a new one in chimimouryou.")
    if status == 429:
        raise RelayError("Too many tries. Wait a few minutes and try again.")
    if status != 200 or not isinstance(body, dict) or not valid_key(body.get("key")):
        raise RelayError("The hub didn't accept the code (HTTP %d)." % status)
    return body["key"]


class Store:
    """{hub, key} in a JSON file only this user can read (mode 600 where the OS has modes)."""

    def __init__(self, path):
        self.path = path

    def load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return None
        if isinstance(data, dict) and valid_key(data.get("key")) and valid_hub(data.get("hub")):
            return valid_hub(data["hub"]), data["key"]
        return None

    def save(self, hub, key):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"hub": hub, "key": key}, f)
        os.chmod(tmp, 0o600)  # the file may have existed with a wider mode
        os.replace(tmp, self.path)

    def forget(self):
        try:
            os.remove(self.path)
        except FileNotFoundError:
            pass


class Relay:
    """Decides what Discord shows (this computer's pages or the hub) and polls the hub while paired.

    The local API calls set()/clear() in place of Presence's, so it has the same names.
    """

    def __init__(self, presence, store, tiers=TIERS, local_wins=LOCAL_WINS, max_backoff=MAX_BACKOFF,
                 discord_check=DISCORD_CHECK):
        self.presence = presence
        self.store = store
        self.tiers = tiers
        self.discord_check = discord_check
        self._seen = time.monotonic()  # when the hub last had a status (pairing counts as one)
        self.local_wins = local_wins
        self.max_backoff = max_backoff
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stopping = False
        self._pairing = store.load()
        self._local = None  # (activity, monotonic time) from this computer's pages
        self._hub = None  # the hub's current activity
        self._showing = None  # "local", "hub" or None
        self._thread = threading.Thread(target=self._run, name="chimimouryou-discord-relay", daemon=True)

    # --- what Discord shows ---

    def _local_fresh(self):
        return self._local is not None and time.monotonic() - self._local[1] < self.local_wins

    def _show(self, source, activity):
        self._showing = source if activity is not None else None
        self.presence.set(activity)

    def set(self, activity):
        with self._lock:
            self._local = (activity, time.monotonic())
            self._show("local", activity)

    def clear(self):
        with self._lock:
            self._local = None
            self._show("hub", self._hub)

    def _from_hub(self, activity):
        with self._lock:
            self._hub = activity
            if activity is not None:
                if not self._local_fresh():
                    self._show("hub", activity)
            elif self._showing == "hub":
                self._show(None, None)

    # --- pairing ---

    @property
    def paired(self):
        return self._pairing is not None

    def pair(self, hub, key):
        self.store.save(hub, key)
        with self._lock:
            self._pairing = (hub, key)
            self._seen = time.monotonic()
        self._wake.set()

    def unpair(self):
        self.store.forget()
        with self._lock:
            self._pairing = None
        self._from_hub(None)
        self._wake.set()

    # --- polling ---

    def start(self):
        self._thread.start()

    def stop(self):
        self._stopping = True
        self._wake.set()

    def join(self, timeout=None):
        self._thread.join(timeout)

    def poll_once(self):
        """One GET /v1/presence/current: (answered as expected, the hub's `next` hint in seconds)."""
        pairing = self._pairing
        if pairing is None:
            return True, 0.0
        hub, key = pairing
        try:
            status, body, headers = request("GET", hub + "/v1/presence/current", key=key)
        except RelayError:
            return False, 0.0
        hint = _hint(body.get("next") if isinstance(body, dict) else headers.get("X-Next"))
        if status == 401:  # revoked in chimimouryou's settings
            with self._lock:
                if self._pairing == pairing:
                    self.store.forget()
                    self._pairing = None
            self._from_hub(None)
            return True, hint
        if status == 204:
            self._from_hub(None)
            return True, hint
        if status == 200 and isinstance(body, dict):
            try:
                activity = activity_mod.clean(body.get("activity"))
            except activity_mod.InvalidActivity:
                activity = None
            if activity is not None:
                self._seen = time.monotonic()
            self._from_hub(activity)
            return True, hint
        return False, hint

    def _run(self):
        failures = 0
        while not self._stopping:
            if self._pairing is None:
                self._wake.wait()
                self._wake.clear()
                continue
            if self.presence.status != "connected":  # nobody would see it: don't spend hub requests
                self._wake.wait(self.discord_check)
                self._wake.clear()
                continue
            ok, hint = self.poll_once()
            failures = 0 if ok else failures + 1
            delay = poll_delay(time.monotonic() - self._seen, hint, self.tiers)
            if failures:
                delay = max(delay, min(delay * (2 ** failures), self.max_backoff))
            self._wake.wait(delay)
            self._wake.clear()

