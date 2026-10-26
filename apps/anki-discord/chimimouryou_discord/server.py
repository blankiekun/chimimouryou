# @license BSD-3-Clause
# Copyright (c) 2026, ッツ Reader Authors
# All rights reserved.

"""The local HTTP API pages call: 127.0.0.1 only, listed origins only.

GET /v1/status, PUT /v1/activity (the finished activity JSON), DELETE /v1/activity,
PUT /v1/pair {hub, key} (automatic pairing with the hub relay), DELETE /v1/pair.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import activity as activity_mod
from . import relay as relay_mod

VERSION = "0.3.0"
DEFAULT_PORT = 41918
DEFAULT_ORIGINS = ("https://chimireader.github.io", "http://127.0.0.1:41917")
MAX_BODY = 16 * 1024


def make_server(presence, port=DEFAULT_PORT, extra_origins=(), relay=None):
    """relay (relay.Relay) decides between local and hub activities; without one, /v1/pair is 404."""
    sink = relay or presence
    origins = {o.rstrip("/").lower() for o in (*DEFAULT_ORIGINS, *extra_origins) if isinstance(o, str) and o}

    class Handler(BaseHTTPRequestHandler):
        server_version = "chimimouryou-discord/" + VERSION
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass  # never log requests: nothing about what someone reads leaves this process

        def _host_ok(self):
            # DNS rebinding: a hostile name resolving to 127.0.0.1 still sends its own Host.
            port_now = self.server.server_address[1]
            host = (self.headers.get("Host") or "").lower()
            return host in ("127.0.0.1:%d" % port_now, "localhost:%d" % port_now)

        def _origin(self):
            """(allowed, origin) — a request without Origin isn't from a web page."""
            origin = self.headers.get("Origin")
            if origin is None:
                return True, None
            return origin.rstrip("/").lower() in origins, origin

        def _reply(self, code, body=None, origin=None, extra=None):
            data = b"" if body is None else json.dumps(body).encode("utf-8")
            self.send_response(code)
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            for name, value in (extra or {}).items():
                self.send_header(name, value)
            if body is not None:
                self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _guard(self):
            if not self._host_ok():
                self.close_connection = True
                self._reply(403, {"error": "host"})
                return None
            ok, origin = self._origin()
            if not ok:
                self.close_connection = True
                self._reply(403, {"error": "origin"})
                return None
            return origin or ""

        def do_OPTIONS(self):
            origin = self._guard()
            if origin is None:
                return
            self._reply(204, origin=origin or None, extra={
                "Access-Control-Allow-Methods": "GET, PUT, DELETE",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Private-Network": "true",
                "Access-Control-Max-Age": "600",
            })

        def do_GET(self):
            origin = self._guard()
            if origin is None:
                return
            if self.path != "/v1/status":
                return self._reply(404, {"error": "not found"}, origin)
            self._reply(200, {"version": VERSION, "discord": presence.status,
                              "lastSent": presence.last_sent, "paired": bool(relay and relay.paired)}, origin)

        def _known(self, origin):
            if self.path == "/v1/activity" or (relay and self.path == "/v1/pair"):
                return True
            self._reply(404, {"error": "not found"}, origin)
            return False

        def do_PUT(self):
            origin = self._guard()
            if origin is None or not self._known(origin):
                return
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                self.close_connection = True
                return self._reply(411, {"error": "length required"}, origin)
            if length < 0 or length > MAX_BODY:
                self.close_connection = True
                return self._reply(413, {"error": "too large"}, origin)
            try:
                raw = json.loads(self.rfile.read(length).decode("utf-8"))
                if self.path == "/v1/pair":
                    hub = relay_mod.valid_hub(raw.get("hub")) if isinstance(raw, dict) else None
                    if not hub or not relay_mod.valid_key(raw.get("key")):
                        return self._reply(400, {"error": "hub must be https and key a pk_ key"}, origin)
                    relay.pair(hub, raw["key"])
                    return self._reply(204, origin=origin)
                clean = activity_mod.clean(raw)
            except (ValueError, UnicodeDecodeError) as err:
                message = str(err) if isinstance(err, activity_mod.InvalidActivity) else "invalid JSON"
                return self._reply(400, {"error": message}, origin)
            except OSError:  # user_files not writable
                return self._reply(500, {"error": "can't save the pairing"}, origin)
            sink.set(clean)
            self._reply(204, origin=origin)

        def do_DELETE(self):
            origin = self._guard()
            if origin is None or not self._known(origin):
                return
            if self.path == "/v1/pair":
                relay.unpair()
            else:
                sink.clear()
            self._reply(204, origin=origin)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server


def serve_in_thread(server):
    thread = threading.Thread(target=server.serve_forever, name="chimimouryou-discord-http", daemon=True)
    thread.start()
    return thread
