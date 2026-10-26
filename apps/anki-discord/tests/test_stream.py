# @license BSD-3-Clause
# Copyright (c) 2026, ッツ Reader Authors
# All rights reserved.

import json
import os
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from chimimouryou_discord import relay, ws  # noqa: E402
from test_relay import KEY, FakeHub, FakePresence, wait_for  # noqa: E402

PHONE = {"activity": {"name": "Phone"}, "kind": "book"}


def frame(opcode, payload, fin=True):
    """An unmasked server frame."""
    n = len(payload)
    head = bytes([(0x80 if fin else 0) | opcode])
    head += bytes([n]) if n < 126 else bytes([126]) + struct.pack(">H", n) if n < 65536 else \
        bytes([127]) + struct.pack(">Q", n)
    return head + payload


def read_client_frame(conn):
    """(opcode, payload) of a masked client frame, or None at EOF."""
    def exact(n):
        data = b""
        while len(data) < n:
            chunk = conn.recv(n - len(data))
            if not chunk:
                raise EOFError
            data += chunk
        return data
    try:
        b0, b1 = exact(2)
        assert b1 & 0x80, "client frames must be masked"
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack(">H", exact(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", exact(8))[0]
        mask = exact(4)
        return b0 & 0x0F, bytes(b ^ mask[i % 4] for i, b in enumerate(exact(n)))
    except (EOFError, OSError):
        return None


class FakeStream:
    """GET /v1/presence/stream on the fake hub: the handshake, then frames both ways."""

    def __init__(self, first=None, status=101, pong=True, accept=True):
        self.first = [json.dumps(first or {"activity": None}).encode()]
        self.status = status
        self.pong = pong
        self.accept = accept
        self.conns = []
        self.received = []
        self.lock = threading.Lock()

    def handle(self, h):
        if h.headers.get("Authorization") != "Bearer " + KEY:
            return h._send(401, {"error": "key"})
        if self.status != 101:
            return h._send(self.status, {"error": "upgrade"})
        assert h.headers["Upgrade"] == "websocket" and h.headers["Sec-WebSocket-Version"] == "13"
        h.send_response(101)
        h.send_header("Upgrade", "websocket")
        h.send_header("Connection", "Upgrade")
        h.send_header("Sec-WebSocket-Accept", ws.accept_for(h.headers["Sec-WebSocket-Key"]) if self.accept else "x")
        h.end_headers()
        h.wfile.flush()
        conn = h.connection
        with self.lock:
            self.conns.append(conn)
            for raw in self.first:
                conn.sendall(frame(0x1, raw))
        while True:
            got = read_client_frame(conn)
            if got is None or got[0] == 0x8:
                break
            self.received.append(got)
            if got == (0x1, b"ping") and self.pong:
                with self.lock:
                    conn.sendall(frame(0x1, b"pong"))
        h.close_connection = True

    def send(self, raw):
        with self.lock:
            for conn in self.conns:
                try:
                    conn.sendall(raw)
                except OSError:
                    pass

    def push(self, body):
        self.send(frame(0x1, json.dumps(body).encode()))

    def close_all(self, code=1001):
        self.send(frame(0x8, struct.pack(">H", code)))


class StreamTest(unittest.TestCase):
    def setUp(self):
        self.hub = FakeHub()
        self.tmp = tempfile.TemporaryDirectory()
        self.store = relay.Store(os.path.join(self.tmp.name, "pairing.json"))
        self.p = FakePresence()
        self.r = relay.Relay(self.p, self.store, tiers=((0, 0.1),), max_backoff=0.4, discord_check=0.05,
                             stream_ping=0.3, stream_tick=0.05, stream_retry=0.4, stream_retry_max=0.8)

    def tearDown(self):
        self.r.stop()
        self.r.join(2)
        self.hub.close()
        self.tmp.cleanup()

    def start(self, stream, key=KEY):
        self.hub.stream = stream
        self.r.start()
        self.r.pair(self.hub.url, key)

    def streams(self):
        return [r for r in self.hub.requests if r[1] == "/v1/presence/stream"]

    def test_push_is_applied_without_polling(self):
        stream = FakeStream(first=PHONE)
        self.start(stream)
        self.assertTrue(wait_for(lambda: self.p.now == {"type": 0, "name": "Phone"}))
        self.assertEqual(self.streams()[0][2], "Bearer " + KEY)
        stream.push({"activity": {"name": "Phone, page 2"}, "kind": "book", "expiresAt": time.time() + 60})
        self.assertTrue(wait_for(lambda: self.p.now == {"type": 0, "name": "Phone, page 2"}))
        self.r.set({"name": "Desk"})  # the local-wins rule is unchanged
        stream.push(PHONE)
        time.sleep(0.2)
        self.assertEqual(self.p.now, {"name": "Desk"})
        stream.push({"activity": None})
        time.sleep(0.2)
        self.assertEqual(self.p.now, {"name": "Desk"})  # a clear leaves a local status alone
        self.r.clear()
        self.assertIsNone(self.p.now)
        self.assertEqual(self.hub.polls(), [])
        self.assertTrue(self.r.streaming)

    def test_clears_at_expires_at_itself(self):
        self.start(FakeStream(first=dict(PHONE, expiresAt=time.time() + 0.4)))
        self.assertTrue(wait_for(lambda: self.p.now == {"type": 0, "name": "Phone"}))
        self.assertTrue(wait_for(lambda: self.p.now is None))
        self.assertTrue(self.r.streaming)

    def test_keep_alive_pings(self):
        stream = FakeStream()
        self.start(stream)
        self.assertTrue(wait_for(lambda: stream.received.count((0x1, b"ping")) >= 3))
        self.assertEqual(len(stream.conns), 1)  # the pongs keep it open
        self.assertEqual(self.hub.polls(), [])

    def test_no_pong_drops_to_polling(self):
        stream = FakeStream(pong=False)
        self.start(stream)
        self.assertTrue(wait_for(lambda: self.hub.polls()))
        self.assertTrue(wait_for(lambda: len(self.streams()) >= 2))  # tried again after the backoff

    def test_close_falls_back_to_polling_then_retries(self):
        stream = FakeStream()
        self.start(stream)
        self.assertTrue(wait_for(lambda: self.r.streaming))
        self.hub.current = (200, PHONE)
        stream.close_all()
        self.assertTrue(wait_for(lambda: self.p.now == {"type": 0, "name": "Phone"}))  # a poll at once
        self.assertTrue(self.hub.polls())
        self.assertTrue(wait_for(lambda: len(stream.conns) == 2))
        self.assertTrue(wait_for(lambda: self.r.streaming))
        n = len(self.hub.polls())
        time.sleep(0.3)
        self.assertEqual(len(self.hub.polls()), n)  # connected again: no polling

    def test_backoff_doubles_to_its_cap(self):
        self.start(FakeStream(accept=False))  # a bad Sec-WebSocket-Accept fails every try
        time.sleep(2.2)
        # Tries at 0, 0.4, 1.2, 2.0 (0.4 doubling, capped at 0.8): not every poll.
        self.assertGreaterEqual(len(self.streams()), 3)
        self.assertLessEqual(len(self.streams()), 5)
        self.assertGreater(len(self.hub.polls()), len(self.streams()))
        self.assertTrue(self.r.paired)

    def test_older_hub_polls_only(self):
        self.start(FakeStream(status=426))
        self.assertTrue(wait_for(lambda: len(self.hub.polls()) >= 5))
        self.assertEqual(len(self.streams()), 1)
        self.hub.stream = None  # 404 too
        r = relay.Relay(self.p, self.store, tiers=((0, 0.05),))
        r._pairing = (self.hub.url, KEY)
        self.assertEqual(r.stream_once(), "old")

    def test_revoked_key_unpairs(self):
        self.start(FakeStream(), key="pk_" + "B" * 43)
        self.assertTrue(wait_for(lambda: not self.r.paired))
        self.assertFalse(os.path.exists(self.store.path))
        self.assertEqual(self.hub.polls(), [])

    def test_stops_when_discord_closes_or_unpaired(self):
        stream = FakeStream()
        self.start(stream)
        self.assertTrue(wait_for(lambda: self.r.streaming))
        self.p.status = "closed"
        self.assertTrue(wait_for(lambda: not self.r.streaming))
        time.sleep(0.2)
        self.assertEqual(len(stream.conns), 1)
        self.assertEqual(self.hub.polls(), [])
        self.p.status = "connected"
        self.assertTrue(wait_for(lambda: len(stream.conns) == 2))
        self.r.unpair()
        self.assertTrue(wait_for(lambda: not self.r.streaming))


class ClientTest(unittest.TestCase):
    """ws.WebSocket against raw frames: fragments, limits, refusals."""

    def pair(self, *frames):
        a, b = socket.socketpair()
        self.addCleanup(a.close)
        self.addCleanup(b.close)
        b.sendall(b"".join(frames))
        a.settimeout(1)
        return ws.WebSocket(a), b

    def test_fragments_ping_and_close(self):
        conn, server = self.pair(frame(0x1, "吾輩".encode(), fin=False), frame(0x9, b"hi"),
                                 frame(0x0, "は猫".encode()), frame(0x8, struct.pack(">H", 4001)))
        self.assertIsNone(conn.recv())
        self.assertIsNone(conn.recv())  # the ping, answered
        self.assertEqual(read_client_frame(server), (0xA, b"hi"))
        self.assertEqual(conn.recv(), "吾輩は猫")
        with self.assertRaises(ws.Closed) as caught:
            conn.recv()
        self.assertEqual(caught.exception.code, 4001)
        self.assertEqual(read_client_frame(server)[0], 0x8)

    def test_refusals(self):
        for raw in (frame(0x2, b"bin"), frame(0x1, b"x" * (ws.MAX_MESSAGE + 1)),
                    frame(0x0, b"orphan"), bytes([0x81, 0x81]) + b"mask" + b"x"):
            conn, _server = self.pair(raw)
            with self.assertRaises(ws.WsError, msg=raw[:4]):
                conn.recv()
        conn, _server = self.pair(frame(0x1, b"x" * 10000, fin=False), frame(0x0, b"x" * 10000))
        conn.recv()
        with self.assertRaises(ws.WsError):
            conn.recv()  # the joined message is over 16 KB

    def test_partial_frame_survives_a_timeout(self):
        conn, server = self.pair(frame(0x1, b"hello")[:4])
        conn.sock.settimeout(0.05)
        with self.assertRaises(socket.timeout):
            conn.recv()
        server.sendall(frame(0x1, b"hello")[4:])
        self.assertEqual(conn.recv(), "hello")


if __name__ == "__main__":
    unittest.main()
