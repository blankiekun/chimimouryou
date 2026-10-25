# @license BSD-3-Clause
# Copyright (c) 2026, ッツ Reader Authors
# All rights reserved.

import http.client
import json
import os
import stat
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from chimimouryou_discord import relay, server  # noqa: E402

KEY = "pk_" + "A" * 43


def wait_for(cond, timeout=5.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


class FakeHub:
    """The hub's add-on endpoints as SPEC.md describes them: pair a code, read the current presence."""

    def __init__(self):
        self.current = (204, None)  # what GET /v1/presence/current answers
        self.codes = {"ABC-DEF-GHJ": KEY}
        self.requests = []
        hub = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, code, body=None, headers=None):
                data = b"" if body is None else json.dumps(body).encode()
                self.send_response(code)
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                hub.requests.append(("GET", self.path, self.headers.get("Authorization")))
                if self.path == "/v1/presence/current":
                    code, body = hub.current
                    if code == 302:
                        return self._send(302, headers={"Location": "/elsewhere"})
                    if self.headers.get("Authorization") != "Bearer " + KEY:
                        return self._send(401, {"error": "key"})
                    return self._send(code, body)
                self._send(200 if self.path == "/elsewhere" else 404, {})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                hub.requests.append(("POST", self.path, body))
                key = hub.codes.pop(body.get("code"), None)  # single use
                if self.path != "/v1/presence/pair" or not key:
                    return self._send(404, {"error": "code"})
                self._send(200, {"id": "k1", "key": key})

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:%d" % self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()

    def polls(self):
        return [r for r in self.requests if r[1] == "/v1/presence/current"]


class FakePresence:
    status = "connected"
    last_sent = None

    def __init__(self):
        self.shown = []

    def set(self, activity):
        self.shown.append(activity)

    def clear(self):
        self.set(None)

    @property
    def now(self):
        return self.shown[-1] if self.shown else None


class ChecksTest(unittest.TestCase):
    def test_hub_urls(self):
        self.assertEqual(relay.valid_hub("https://hub.example.dev/"), "https://hub.example.dev")
        self.assertEqual(relay.valid_hub("https://hub.example.dev:8443/api"), "https://hub.example.dev:8443/api")
        for bad in ("http://hub.example.dev", "https://", "https://u:p@hub.example.dev", "https://h.dev/?x=1",
                    "https://h.dev:99999", "javascript:alert(1)", None, 5):
            self.assertIsNone(relay.valid_hub(bad), bad)

    def test_keys_and_codes(self):
        self.assertTrue(relay.valid_key(KEY))
        for bad in ("pk_short", "sk_" + "A" * 43, "pk_" + "A" * 40 + "!", None):
            self.assertFalse(relay.valid_key(bad))
        self.assertEqual(relay.normalise_code(" abc def ghj "), "ABC-DEF-GHJ")
        self.assertEqual(relay.normalise_code("abc-def-ghj"), "ABC-DEF-GHJ")
        self.assertTrue(relay.device_name().startswith("Anki on "))
        self.assertLessEqual(len(relay.device_name()), 40)


class StoreTest(unittest.TestCase):
    def test_save_load_forget(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = relay.Store(os.path.join(tmp, "user_files", "pairing.json"))
            self.assertIsNone(store.load())
            store.save("https://hub.example.dev", KEY)
            self.assertEqual(store.load(), ("https://hub.example.dev", KEY))
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE(os.stat(store.path).st_mode), 0o600)
            store.forget()
            store.forget()
            self.assertIsNone(store.load())
            with open(store.path, "w") as f:
                f.write('{"hub": "http://hub.example.dev", "key": "%s"}' % KEY)
            self.assertIsNone(store.load())  # a tampered file isn't used


class RelayTest(unittest.TestCase):
    def setUp(self):
        self.hub = FakeHub()
        self.tmp = tempfile.TemporaryDirectory()
        self.store = relay.Store(os.path.join(self.tmp.name, "pairing.json"))
        self.p = FakePresence()
        self.r = relay.Relay(self.p, self.store, poll_interval=0.1, local_wins=0.4, max_backoff=0.4)
        self.r.start()

    def tearDown(self):
        self.r.stop()
        self.r.join(2)
        self.hub.close()
        self.tmp.cleanup()

    def test_pair_with_code(self):
        self.assertEqual(relay.pair_with_code(self.hub.url, "abc def ghj", "Anki on test"), KEY)
        self.assertEqual(self.hub.requests[-1][2], {"code": "ABC-DEF-GHJ", "name": "Anki on test"})
        with self.assertRaisesRegex(relay.RelayError, "expired"):
            relay.pair_with_code(self.hub.url, "ABC-DEF-GHJ")  # used once
        with self.assertRaisesRegex(relay.RelayError, "reach"):
            relay.pair_with_code("http://127.0.0.1:1", "ABC-DEF-GHJ")

    def test_polls_only_while_paired(self):
        time.sleep(0.3)
        self.assertEqual(self.hub.polls(), [])
        self.hub.current = (200, {"activity": {"name": "Reading on my phone", "secret": 1}, "kind": "book"})
        self.r.pair(self.hub.url, KEY)
        self.assertTrue(wait_for(lambda: self.p.now == {"type": 0, "name": "Reading on my phone"}))
        self.assertEqual(self.hub.polls()[0][2], "Bearer " + KEY)
        self.assertEqual(self.store.load(), None)  # http test hub: saved, but a load would refuse it
        self.hub.current = (204, None)
        self.assertTrue(wait_for(lambda: self.p.now is None))
        self.r.unpair()
        n = len(self.hub.polls())
        time.sleep(0.3)
        self.assertEqual(len(self.hub.polls()), n)
        self.assertFalse(self.r.paired)

    def test_local_wins_for_a_while(self):
        self.hub.current = (200, {"activity": {"name": "Phone"}, "kind": "book"})
        self.r.set({"name": "Desk"})
        self.r.pair(self.hub.url, KEY)
        self.assertTrue(wait_for(lambda: len(self.hub.polls()) >= 2))
        self.assertEqual(self.p.now, {"name": "Desk"})  # fresh local wins
        self.assertTrue(wait_for(lambda: self.p.now == {"type": 0, "name": "Phone"}))  # stale local loses
        self.r.set({"name": "Desk again"})
        self.hub.current = (204, None)
        n = len(self.hub.polls())
        self.assertTrue(wait_for(lambda: len(self.hub.polls()) > n + 1))
        self.assertEqual(self.p.now, {"name": "Desk again"})  # 204 doesn't clear a local status
        self.hub.current = (200, {"activity": {"name": "Phone"}, "kind": "book"})
        self.assertTrue(wait_for(lambda: self.p.now == {"type": 0, "name": "Phone"}))
        self.r.set({"name": "Desk"})
        self.r.clear()  # the page stopped: the hub's shows again
        self.assertEqual(self.p.now, {"type": 0, "name": "Phone"})

    def test_revoked_key_unpairs(self):
        self.r.pair(self.hub.url, "pk_" + "B" * 43)
        self.assertTrue(wait_for(lambda: not self.r.paired))
        self.assertFalse(os.path.exists(self.store.path))

    def test_backoff_and_no_redirects(self):
        self.hub.current = (302, None)
        self.r.pair(self.hub.url, KEY)
        time.sleep(1.2)
        polls = len(self.hub.polls())
        self.assertGreaterEqual(polls, 2)
        self.assertLessEqual(polls, 6)  # 0.1, 0.2, 0.4, 0.4…: not every 0.1 s
        self.assertFalse([r for r in self.hub.requests if r[1] == "/elsewhere"])
        self.assertTrue(self.r.paired)
        self.hub.current = (200, {"activity": {"name": "Phone"}, "kind": "book"})
        self.assertTrue(wait_for(lambda: self.p.now == {"type": 0, "name": "Phone"}))
        self.hub.current = (200, {"activity": {"state": "x"}, "kind": "book"})  # invalid: nothing to show
        self.assertTrue(wait_for(lambda: self.p.now is None))


class PairEndpointTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.p = FakePresence()
        self.r = relay.Relay(self.p, relay.Store(os.path.join(self.tmp.name, "pairing.json")), poll_interval=60)
        self.srv = server.make_server(self.p, 0, relay=self.r)
        self.port = self.srv.server_address[1]
        server.serve_in_thread(self.srv)

    def tearDown(self):
        self.r.stop()
        self.srv.shutdown()
        self.srv.server_close()
        self.tmp.cleanup()

    def request(self, method, path, body=None, origin="https://chimireader.github.io"):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request(method, path, body=body, headers={"Origin": origin, "Content-Type": "application/json"})
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        return resp.status, data

    def paired(self):
        return json.loads(self.request("GET", "/v1/status")[1])["paired"]

    def test_pair_and_unpair(self):
        self.assertFalse(self.paired())
        for bad in ({"hub": "http://hub.example.dev", "key": KEY}, {"hub": "https://hub.example.dev", "key": "x"},
                    [], {"hub": "https://hub.example.dev"}):
            self.assertEqual(self.request("PUT", "/v1/pair", json.dumps(bad))[0], 400)
        good = json.dumps({"hub": "https://hub.example.dev/", "key": KEY})
        self.assertEqual(self.request("PUT", "/v1/pair", good, origin="https://evil.example")[0], 403)
        self.assertFalse(self.paired())
        self.assertEqual(self.request("PUT", "/v1/pair", good)[0], 204)
        self.assertTrue(self.paired())
        self.assertEqual(self.r.store.load(), ("https://hub.example.dev", KEY))
        self.assertEqual(self.request("DELETE", "/v1/pair")[0], 204)
        self.assertFalse(self.paired())
        self.assertIsNone(self.r.store.load())

    def test_local_activity_goes_through_the_relay(self):
        self.assertEqual(self.request("PUT", "/v1/activity", b'{"name":"Desk"}')[0], 204)
        self.assertEqual(self.p.now, {"type": 0, "name": "Desk"})
        self.assertEqual(self.r._showing, "local")


if __name__ == "__main__":
    unittest.main()
