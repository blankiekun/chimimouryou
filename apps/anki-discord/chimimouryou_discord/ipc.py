# @license BSD-3-Clause
# Copyright (c) 2026, ッツ Reader Authors
# All rights reserved.

"""Discord's local IPC: the socket or named pipe the desktop client listens on.

A frame is a little-endian u32 opcode, a u32 length and that many bytes of JSON.
"""

import json
import os
import select
import socket
import struct
import sys
import uuid

OP_HANDSHAKE, OP_FRAME, OP_CLOSE, OP_PING, OP_PONG = range(5)
MAX_FRAME = 1 << 20
TIMEOUT = 5.0


class IPCError(Exception):
    pass


class Refused(IPCError):
    """Discord answered but rejected the command; the connection is fine."""


def encode(op, payload):
    data = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return struct.pack("<II", op, len(data)) + data


def decode_header(header):
    return struct.unpack("<II", header)


def candidate_paths(env=None, platform=None):
    """Every place discord-ipc-0..9 can be, in the order Discord's own SDK tries them."""
    env = os.environ if env is None else env
    platform = sys.platform if platform is None else platform
    if platform == "win32":
        return [r"\\?\pipe\discord-ipc-%d" % i for i in range(10)]
    bases = []
    for name in ("XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"):
        if env.get(name) and env[name] not in bases:
            bases.append(env[name])
    if "/tmp" not in bases:
        bases.append("/tmp")
    paths = []
    for base in bases:
        # Flatpak and snap builds of Discord put the socket in a subfolder.
        for sub in ("", "app/com.discordapp.Discord", "snap.discord"):
            for i in range(10):
                paths.append(os.path.join(base, sub, "discord-ipc-%d" % i))
    return paths


class _UnixTransport:
    def __init__(self, path):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(TIMEOUT)
        try:
            self.sock.connect(path)
        except OSError:
            self.sock.close()
            raise

    def write(self, data):
        self.sock.sendall(data)

    def read(self, n):
        return self.sock.recv(n)

    def readable(self):
        return bool(select.select([self.sock], [], [], 0)[0])

    def close(self):
        self.sock.close()


class _PipeTransport:
    def __init__(self, path):
        self.pipe = open(path, "r+b", buffering=0)

    def write(self, data):
        self.pipe.write(data)

    def read(self, n):
        return self.pipe.read(n)

    def readable(self):
        # shortcut: no peek on Windows pipes, so a Discord restart is noticed on the next update, not while idle.
        return False

    def close(self):
        self.pipe.close()


class Connection:
    def __init__(self, transport):
        self.transport = transport

    def send(self, op, payload):
        self.transport.write(encode(op, payload))

    def _read_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.transport.read(n - len(buf))
            if not chunk:
                raise IPCError("Discord closed the connection")
            buf += chunk
        return buf

    def read_frame(self):
        op, length = decode_header(self._read_exact(8))
        if length > MAX_FRAME:
            raise IPCError("frame too large")
        payload = json.loads(self._read_exact(length).decode("utf-8")) if length else None
        if op == OP_PING:
            self.send(OP_PONG, payload)
        elif op == OP_CLOSE:
            raise IPCError("Discord closed the connection")
        return op, payload

    def handshake(self, client_id):
        self.send(OP_HANDSHAKE, {"v": 1, "client_id": client_id})
        _, data = self.read_frame()
        if not isinstance(data, dict) or data.get("evt") != "READY":
            raise IPCError("no READY from Discord")

    def command(self, cmd, args):
        nonce = str(uuid.uuid4())
        self.send(OP_FRAME, {"cmd": cmd, "args": args, "nonce": nonce})
        while True:
            op, data = self.read_frame()
            if op == OP_FRAME and isinstance(data, dict) and data.get("nonce") == nonce:
                if data.get("evt") == "ERROR":
                    # Discord's message names the field, never our text; keep only the code.
                    raise Refused("Discord refused the activity (code %s)" % (data.get("data") or {}).get("code"))
                return data

    def set_activity(self, activity):
        """activity None clears the status."""
        return self.command("SET_ACTIVITY", {"pid": os.getpid(), "activity": activity})

    def alive(self):
        """False once Discord has closed its end; answers any ping waiting."""
        try:
            while self.transport.readable():
                self.read_frame()
        except (OSError, IPCError, ValueError):
            return False
        return True

    def close(self):
        try:
            self.send(OP_CLOSE, {})
        except OSError:
            pass
        try:
            self.transport.close()
        except OSError:
            pass


def connect(client_id, paths=None):
    transport_cls = _PipeTransport if sys.platform == "win32" else _UnixTransport
    for path in candidate_paths() if paths is None else paths:
        if sys.platform != "win32" and not os.path.exists(path):
            continue
        try:
            conn = Connection(transport_cls(path))
        except OSError:
            continue
        try:
            conn.handshake(client_id)
            return conn
        except (OSError, IPCError, ValueError):
            conn.close()
    raise IPCError("Discord is not running")
