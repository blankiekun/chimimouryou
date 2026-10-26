/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * PresenceStream: one SQLite-backed Durable Object per user (`idFromName(user id)`, stores
 * nothing) holding the paired add-ons' WebSockets with the hibernation API, so an idle connection
 * costs nothing: keep-alive pings are answered by the runtime without waking it. Only the Worker
 * reaches it (presence.ts checks the key first): /connect, /send (a status change), /close.
 */

/** The parts of a hibernatable server WebSocket used here */
interface Socket {
  send(message: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

/** The parts of workerd's DurableObjectState used here */
export interface StreamState {
  acceptWebSocket(socket: Socket, tags?: string[]): void;
  getWebSockets(tag?: string): Socket[];
  setWebSocketAutoResponse(pair?: unknown): void;
}

declare const WebSocketPair: new () => { 0: Socket; 1: Socket };
declare const WebSocketRequestResponsePair: new (request: string, response: string) => unknown;

/** Connections per user, like presence keys; a new one closes the oldest */
export const MAX_STREAMS = 10;

function close(socket: Socket, code: number, reason: string) {
  try {
    socket.close(code, reason);
  } catch {
    // Already closing.
  }
}

export class PresenceStream {
  constructor(private ctx: StreamState) {
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const key = url.searchParams.get('key') ?? '';
    const sockets = key ? this.ctx.getWebSockets(key) : this.ctx.getWebSockets();

    if (url.pathname === '/connect') {
      const pair = new WebSocketPair();
      const oldest = sockets
        .map((socket) => ({ socket, at: Number(socket.deserializeAttachment()) || 0 }))
        .sort((a, b) => a.at - b.at);

      oldest
        .slice(0, Math.max(0, oldest.length - MAX_STREAMS + 1))
        .forEach(({ socket }) => close(socket, 4008, 'too many'));
      this.ctx.acceptWebSocket(pair[1], [key]);
      pair[1].serializeAttachment(Date.now());
      pair[1].send(decodeURIComponent(request.headers.get('X-Message') ?? ''));
      return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
    }
    if (url.pathname === '/send') {
      const message = await request.text();

      for (const socket of sockets) {
        try {
          socket.send(message);
        } catch {
          // Closing; the add-on reconnects or polls.
        }
      }
    } else if (url.pathname === '/close') {
      sockets.forEach((socket) => close(socket, 4001, 'key'));
    } else {
      return new Response(null, { status: 404 });
    }
    return new Response(null, { status: 204 });
  }

  // The add-on only sends "ping", answered by the runtime; anything else is ignored.
  webSocketMessage() {}

  webSocketClose(socket: Socket, code: number) {
    close(socket, code === 1005 || code === 1006 ? 1000 : code, '');
  }
}
