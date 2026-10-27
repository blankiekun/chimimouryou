# @license BSD-3-Clause
# Copyright (c) 2026, ッツ Reader Authors
# All rights reserved.

import http.client
import json
import os
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from chimimouryou_discord import activity, ipc, presence, server  # noqa: E402


def wait_for(cond, timeout=5.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


class FakeDiscord:
    """A Unix socket that answers like Discord's IPC and records every SET_ACTIVITY."""

    def __init__(self, path):
        self.path = path
        self.activities = []
        self.handshakes = []
        self.conns = []
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.bind(path)
        self.sock.listen()
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            self.conns.append(conn)
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()

    @staticmethod
    def _read(conn, n):
        buf = b""
        while len(buf) < n:
            chunk = conn.recv(n - len(buf))
            if not chunk:
                raise OSError("closed")
            buf += chunk
        return buf

    def _serve(self, conn):
        try:
            while True:
                op, length = struct.unpack("<II", self._read(conn, 8))
                data = json.loads(self._read(conn, length))
                if op == ipc.OP_HANDSHAKE:
                    self.handshakes.append(data)
                    conn.sendall(ipc.encode(ipc.OP_FRAME, {"cmd": "DISPATCH", "evt": "READY", "data": {}}))
                elif op == ipc.OP_FRAME:
                    self.activities.append(data["args"]["activity"])
                    conn.sendall(ipc.encode(ipc.OP_FRAME, {"cmd": data["cmd"], "nonce": data["nonce"], "data": {}}))
                elif op == ipc.OP_CLOSE:
                    return
        except OSError:
            pass
        finally:
            conn.close()

    def close(self):
        self.sock.close()
        for conn in self.conns:
            try:
                conn.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            conn.close()
        os.unlink(self.path)


class FramesTest(unittest.TestCase):
    def test_round_trip(self):
        frame = ipc.encode(ipc.OP_FRAME, {"cmd": "SET_ACTIVITY", "x": "読書"})
        op, length = ipc.decode_header(frame[:8])
        self.assertEqual(op, 1)
        self.assertEqual(length, len(frame) - 8)
        self.assertEqual(json.loads(frame[8:]), {"cmd": "SET_ACTIVITY", "x": "読書"})
        self.assertEqual(frame[:4], b"\x01\x00\x00\x00")  # little-endian


class PathsTest(unittest.TestCase):
    def test_unix_order_and_subfolders(self):
        paths = ipc.candidate_paths({"XDG_RUNTIME_DIR": "/run/user/1000", "TMPDIR": "/tmp", "TEMP": ""}, "linux")
        self.assertEqual(paths[0], "/run/user/1000/discord-ipc-0")
        self.assertIn("/run/user/1000/app/com.discordapp.Discord/discord-ipc-0", paths)
        self.assertIn("/run/user/1000/snap.discord/discord-ipc-9", paths)
        self.assertIn("/tmp/discord-ipc-3", paths)
        self.assertEqual(len(paths), 2 * 3 * 10)  # /tmp listed once

    def test_windows_pipes(self):
        paths = ipc.candidate_paths({}, "win32")
        self.assertEqual(paths[0], r"\\?\pipe\discord-ipc-0")
        self.assertEqual(len(paths), 10)


class CleanTest(unittest.TestCase):
    def test_keeps_known_fields_and_fixes_type(self):
        out = activity.clean({
            "name": "Reading 本", "details": "Chapter 3", "state": "42%", "type": 3, "secret": "x",
            "details_url": "https://example.com/b", "state_url": "http://example.com",
            "assets": {"large_image": "https://example.com/c.png", "large_text": "Cover",
                       "small_image": "logo", "small_text": "x", "other": 1},
            "timestamps": {"start": 1700000000000, "end": "soon"},
            "party": {"size": [2, 5]},
            "buttons": [{"label": "Open", "url": "https://example.com"},
                        {"label": "Bad", "url": "javascript:alert(1)"},
                        {"label": "Two", "url": "https://example.org"},
                        {"label": "Three", "url": "https://example.net"}],
        })
        self.assertEqual(out, {
            "type": 0, "name": "Reading 本", "details": "Chapter 3", "state": "42%",
            "details_url": "https://example.com/b",
            "assets": {"large_image": "https://example.com/c.png", "large_text": "Cover", "small_image": "logo"},
            "timestamps": {"start": 1700000000000},
            "party": {"size": [2, 5]},
            "buttons": [{"label": "Open", "url": "https://example.com"}],
        })

    def test_clamps_lengths(self):
        out = activity.clean({"details": "あ" * 300, "state": "x",
                              "buttons": [{"label": "L" * 40, "url": "https://e.com"}]})
        self.assertEqual(len(out["details"]), 128)
        self.assertTrue(out["details"].endswith("\u2026"))
        self.assertNotIn("state", out)  # under Discord's 2-character minimum
        self.assertEqual(len(out["buttons"][0]["label"]), 32)

    def test_rejects(self):
        for raw in ([], "x", {}, {"state": "a"}, {"name": 5}):
            with self.assertRaises(activity.InvalidActivity):
                activity.clean(raw)

    def test_bad_numbers_dropped(self):
        out = activity.clean({"name": "ok", "party": {"size": [6, 5]},
                              "timestamps": {"start": True, "end": -1}})
        self.assertEqual(out, {"type": 0, "name": "ok"})


class FakeConn:
    def __init__(self, sent):
        self.sent = sent

    def set_activity(self, a):
        self.sent.append(a)

    def alive(self):
        return True

    def close(self):
        pass


class CoalesceTest(unittest.TestCase):
    def test_sends_first_then_only_newest(self):
        sent = []
        p = presence.Presence("1", connect=lambda _id: FakeConn(sent), min_interval=0.5, idle_check=0.05)
        p.start()
        p.set({"name": "one"})
        self.assertTrue(wait_for(lambda: len(sent) == 1))
        for i in range(2, 6):
            p.set({"name": str(i)})
        self.assertTrue(wait_for(lambda: len(sent) == 2))
        time.sleep(0.7)
        self.assertEqual(sent, [{"name": "one"}, {"name": "5"}])
        p.stop()
        p.join(2)
        self.assertEqual(sent[-1], None)  # cleared on stop, without waiting for the rate limit

    def test_retries_while_discord_is_away(self):
        sent, up = [], []

        def connect(_id):
            if not up:
                raise ipc.IPCError("not running")
            return FakeConn(sent)

        p = presence.Presence("1", connect=connect, min_interval=0.05, retry_interval=0.1, idle_check=0.05)
        p.start()
        p.set({"name": "a"})
        time.sleep(0.2)
        self.assertEqual(p.status, "closed")
        up.append(1)
        self.assertTrue(wait_for(lambda: sent == [{"name": "a"}]))
        self.assertEqual(p.status, "connected")
        p.stop()


class HttpTest(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.p = presence.Presence("1", connect=lambda _id: FakeConn(self.sent), min_interval=0, idle_check=0.05)
        self.p.start()
        self.srv = server.make_server(self.p, 0, ["https://books.example.net/"])
        self.port = self.srv.server_address[1]
        server.serve_in_thread(self.srv)

    def tearDown(self):
        self.p.stop()
        self.srv.shutdown()
        self.srv.server_close()

    def request(self, method, path, body=None, host=None, origin=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        h = {"Host": host or "127.0.0.1:%d" % self.port}
        if origin:
            h["Origin"] = origin
        h.update(headers or {})
        conn.request(method, path, body=body, headers=h)
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        return resp, data

    def test_status(self):
        resp, data = self.request("GET", "/v1/status", origin="https://chimireader.github.io")
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.getheader("Access-Control-Allow-Origin"), "https://chimireader.github.io")
        body = json.loads(data)
        self.assertEqual(body["version"], server.VERSION)
        self.assertIn(body["discord"], ("connected", "closed"))
        resp, _ = self.request("GET", "/v1/status", origin="https://chimireader.blank.moe")
        self.assertEqual(resp.getheader("Access-Control-Allow-Origin"), "https://chimireader.blank.moe")

    def test_preflight(self):
        resp, _ = self.request("OPTIONS", "/v1/activity", origin="https://books.example.net",
                               headers={"Access-Control-Request-Method": "PUT",
                                        "Access-Control-Request-Private-Network": "true"})
        self.assertEqual(resp.status, 204)
        self.assertEqual(resp.getheader("Access-Control-Allow-Private-Network"), "true")
        self.assertIn("PUT", resp.getheader("Access-Control-Allow-Methods"))

    def test_rejects_other_origins_and_hosts(self):
        resp, _ = self.request("PUT", "/v1/activity", b'{"name":"x1"}', origin="https://evil.example")
        self.assertEqual(resp.status, 403)
        resp, _ = self.request("OPTIONS", "/v1/activity", origin="https://evil.example")
        self.assertEqual(resp.status, 403)
        resp, _ = self.request("GET", "/v1/status", host="evil.example:%d" % self.port)
        self.assertEqual(resp.status, 403)
        resp, _ = self.request("GET", "/v1/status", host="127.0.0.1:1")
        self.assertEqual(resp.status, 403)
        resp, _ = self.request("GET", "/v1/status", host="localhost:%d" % self.port)
        self.assertEqual(resp.status, 200)

    def test_put_and_delete(self):
        o = "http://127.0.0.1:41917"
        resp, _ = self.request("PUT", "/v1/activity", b'{"name":"Chimi","details":"Reading"}', origin=o)
        self.assertEqual(resp.status, 204)
        self.assertTrue(wait_for(lambda: self.sent == [{"type": 0, "name": "Chimi", "details": "Reading"}]))
        resp, _ = self.request("DELETE", "/v1/activity", origin=o)
        self.assertEqual(resp.status, 204)
        self.assertTrue(wait_for(lambda: self.sent[-1:] == [None]))

    def test_bad_bodies(self):
        o = "https://chimireader.github.io"
        resp, _ = self.request("PUT", "/v1/activity", b"{nope", origin=o)
        self.assertEqual(resp.status, 400)
        resp, _ = self.request("PUT", "/v1/activity", b'{"state":"a"}', origin=o)
        self.assertEqual(resp.status, 400)
        resp, _ = self.request("PUT", "/v1/activity", b"x" * (server.MAX_BODY + 1), origin=o)
        self.assertEqual(resp.status, 413)
        self.assertEqual(self.sent, [])


@unittest.skipIf(sys.platform == "win32", "Unix sockets")
class EndToEndTest(unittest.TestCase):
    def test_http_to_fake_discord_with_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "discord-ipc-0")
            fake = FakeDiscord(path)
            connect = lambda cid: ipc.connect(cid, [os.path.join(tmp, "discord-ipc-%d" % i) for i in range(10)])  # noqa: E731
            p = presence.Presence("123", connect=connect, min_interval=0.1, retry_interval=0.1, idle_check=0.05)
            p.start()
            srv = server.make_server(p, 0)
            port = srv.server_address[1]
            server.serve_in_thread(srv)
            try:
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                conn.request("PUT", "/v1/activity", body=json.dumps({"name": "Chimi Reader", "state": "p. 12"}),
                             headers={"Origin": "https://chimireader.github.io"})
                self.assertEqual(conn.getresponse().status, 204)
                conn.close()
                self.assertTrue(wait_for(lambda: fake.activities == [{"type": 0, "name": "Chimi Reader", "state": "p. 12"}]))
                self.assertEqual(fake.handshakes[0], {"v": 1, "client_id": "123"})

                # Discord restarts: the companion notices while idle and sends the status again.
                fake.close()
                self.assertTrue(wait_for(lambda: p.status == "closed"))
                fake2 = FakeDiscord(path)
                self.assertTrue(wait_for(lambda: fake2.activities == [{"type": 0, "name": "Chimi Reader", "state": "p. 12"}]))

                p.stop()
                p.join(2)
                self.assertEqual(fake2.activities[-1], None)
                fake2.close()
            finally:
                srv.shutdown()
                srv.server_close()


class BuildTest(unittest.TestCase):
    def test_package(self):
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        import build
        with tempfile.TemporaryDirectory() as tmp:
            out = build.build(os.path.join(tmp, "a.ankiaddon"))
            names = zipfile.ZipFile(out).namelist()
        self.assertIn("__init__.py", names)
        self.assertIn("config.json", names)
        self.assertIn("manifest.json", names)
        self.assertFalse([n for n in names if "__pycache__" in n or n.startswith("tests")])


if __name__ == "__main__":
    unittest.main()
