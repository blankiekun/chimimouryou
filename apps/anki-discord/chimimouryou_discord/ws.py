# @license BSD-3-Clause
# Copyright (c) 2026, ッツ Reader Authors
# All rights reserved.

"""A minimal RFC 6455 WebSocket client (standard library only) for the hub's push connection.

Text messages (fragmented ones joined), ping/pong and close; at most MAX_MESSAGE bytes a message.
Binary messages, extensions and redirects are refused. TLS for https:// (the relay accepts no
other hub; plain http:// only reaches the tests' fake hub).
"""

import base64
import hashlib
import os
import socket
import ssl
import struct
import urllib.parse

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_MESSAGE = 16 * 1024
MAX_HEAD = 8 * 1024


class WsError(Exception):
    pass


class HandshakeError(WsError):
    """The server answered the upgrade with this HTTP status instead of 101."""

    def __init__(self, status):
        super().__init__("HTTP %d" % status)
        self.status = status


class Closed(WsError):
    def __init__(self, code):
        super().__init__("closed %s" % code)
        self.code = code


def accept_for(key):
    return base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()


def connect(url, headers=None, timeout=10.0):
    """Opens url (https://… or, for tests, http://…) as a WebSocket. Raises HandshakeError or WsError/OSError."""
    u = urllib.parse.urlsplit(url)
    if u.scheme not in ("https", "http") or not u.hostname:
        raise WsError("url")
    sock = socket.create_connection((u.hostname, u.port or (443 if u.scheme == "https" else 80)), timeout=timeout)
    try:
        if u.scheme == "https":
            sock = ssl.create_default_context().wrap_socket(sock, server_hostname=u.hostname)
        key = base64.b64encode(os.urandom(16)).decode()
        lines = ["GET %s HTTP/1.1" % (u.path or "/"), "Host: " + u.netloc, "Upgrade: websocket",
                 "Connection: Upgrade", "Sec-WebSocket-Key: " + key, "Sec-WebSocket-Version: 13"]
        lines += ["%s: %s" % item for item in (headers or {}).items()]
        sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("utf-8"))
        conn = WebSocket(sock)
        status, fields = conn._read_head()
        if status != 101:
            raise HandshakeError(status)  # also a 3xx: redirects are never followed
        if (fields.get("upgrade", "").lower() != "websocket"
                or "upgrade" not in fields.get("connection", "").lower()
                or fields.get("sec-websocket-accept") != accept_for(key)
                or fields.get("sec-websocket-extensions")):
            raise WsError("handshake")
        return conn
    except BaseException:
        sock.close()
        raise


class WebSocket:
    def __init__(self, sock):
        self.sock = sock
        self._buf = b""
        self._parts = None  # a fragmented text message being joined

    def _fill(self, n):
        # A timeout here leaves the partial frame in the buffer, so the next recv() goes on with it.
        while len(self._buf) < n:
            chunk = self.sock.recv(max(4096, n - len(self._buf)))
            if not chunk:
                raise Closed(1006)
            self._buf += chunk

    def _read_head(self):
        while b"\r\n\r\n" not in self._buf:
            if len(self._buf) > MAX_HEAD:
                raise WsError("head")
            self._fill(len(self._buf) + 1)
        head, self._buf = self._buf.split(b"\r\n\r\n", 1)
        lines = head.decode("latin-1").split("\r\n")
        try:
            status = int(lines[0].split(" ")[1])
        except (IndexError, ValueError):
            raise WsError("status") from None
        fields = {}
        for line in lines[1:]:
            name, _, value = line.partition(":")
            fields[name.strip().lower()] = value.strip()
        return status, fields

    def _frame(self):
        self._fill(2)
        b0, b1 = self._buf[0], self._buf[1]
        size, at = b1 & 0x7F, 2
        if size == 126:
            self._fill(4)
            size, at = struct.unpack(">H", self._buf[2:4])[0], 4
        elif size == 127:
            self._fill(10)
            size, at = struct.unpack(">Q", self._buf[2:10])[0], 10
        if b1 & 0x80 or b0 & 0x70:
            raise WsError("frame")  # servers never mask; no extensions were agreed
        if size > MAX_MESSAGE:
            raise WsError("too large")
        self._fill(at + size)
        payload, self._buf = self._buf[at:at + size], self._buf[at + size:]
        return b0, payload

    def recv(self):
        """The next text message, or None after a control frame. Raises Closed, WsError, socket.timeout."""
        b0, payload = self._frame()
        fin, opcode = b0 & 0x80, b0 & 0x0F
        if opcode >= 8:
            if not fin or len(payload) > 125:
                raise WsError("control frame")
            if opcode == 0x9:
                self._send(0xA, payload)
            elif opcode == 0x8:
                code = struct.unpack(">H", payload[:2])[0] if len(payload) >= 2 else 1005
                try:
                    self._send(0x8, payload[:2])
                except OSError:
                    pass
                raise Closed(code)
            elif opcode != 0xA:
                raise WsError("opcode")
            return None
        if opcode == 0x1 and self._parts is None:
            self._parts = payload
        elif opcode == 0x0 and self._parts is not None:
            self._parts += payload
        else:
            raise WsError("binary or out-of-order frame")
        if len(self._parts) > MAX_MESSAGE:
            raise WsError("too large")
        if not fin:
            return None
        message, self._parts = self._parts, None
        try:
            return message.decode("utf-8")
        except UnicodeDecodeError:
            raise WsError("utf-8") from None

    def _send(self, opcode, payload):
        mask = os.urandom(4)
        n = len(payload)
        head = bytes([0x80 | opcode])
        if n < 126:
            head += bytes([0x80 | n])
        elif n < 65536:
            head += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            head += bytes([0x80 | 127]) + struct.pack(">Q", n)
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def send_text(self, text):
        self._send(0x1, text.encode("utf-8"))

    def close(self, code=1000):
        try:
            self._send(0x8, struct.pack(">H", code))
        except OSError:
            pass
        self.sock.close()
