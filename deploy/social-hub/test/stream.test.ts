/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import hub, { type Env } from '../src/hub';
import { MAX_STREAMS, PresenceStream, type StreamState } from '../src/stream';
import { memoryD1 } from './d1';

const key = (n: number) => n.toString(16).padStart(64, '0');
const activity = { name: 'chimimouryou', details: 'Reading 吾輩は猫である', state: '42%' };

/** A hibernatable WebSocket as the Durable Object sees it */
class FakeSocket {
  sent: string[] = [];
  closed: [number, string] | null = null;
  private attachment: unknown = null;

  send(message: string) {
    if (this.closed) throw new Error('closed');
    this.sent.push(message);
  }
  close(code: number, reason: string) {
    this.closed = [code, reason];
  }
  serializeAttachment(value: unknown) {
    this.attachment = value;
  }
  deserializeAttachment() {
    return this.attachment;
  }
  get last() {
    return JSON.parse(this.sent.at(-1)!);
  }
}

/** DurableObjectState's WebSocket part, plus the namespace that makes one object per name */
function fakeNamespace() {
  const objects = new Map<string, { object: PresenceStream; auto: unknown[] }>();
  const sockets: { socket: FakeSocket; tags: string[] }[] = [];
  const namespace = {
    calls: 0,
    idFromName: (name: string) => name,
    get(id: unknown) {
      const name = id as string;

      if (!objects.has(name)) {
        const auto: unknown[] = [];
        const own: typeof sockets = [];
        const state: StreamState = {
          acceptWebSocket(socket, tags = []) {
            own.push({ socket: socket as FakeSocket, tags });
            sockets.push({ socket: socket as FakeSocket, tags });
          },
          getWebSockets: (tag) =>
            own
              .filter((one) => !one.socket.closed && (!tag || one.tags.includes(tag)))
              .map((one) => one.socket),
          setWebSocketAutoResponse: (pair) => void auto.push(pair)
        };

        objects.set(name, { object: new PresenceStream(state), auto });
      }
      return {
        fetch: (input: string, init?: RequestInit) => {
          namespace.calls++;
          return objects.get(name)!.object.fetch(new Request(input, init));
        }
      };
    }
  };

  return { namespace, sockets, objects };
}

describe('Discord status push (PresenceStream)', () => {
  let env: Env;
  let fake: ReturnType<typeof fakeNamespace>;
  let ip = 0;

  beforeEach(() => {
    fake = fakeNamespace();
    env = { DB: memoryD1().d1, PRESENCE: fake.namespace };
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
    vi.stubGlobal(
      'WebSocketPair',
      class {
        0 = new FakeSocket();
        1 = new FakeSocket();
      }
    );
    vi.stubGlobal(
      'WebSocketRequestResponsePair',
      class {
        constructor(
          public request: string,
          public response: string
        ) {}
      }
    );
    // Node's Response refuses 101; workerd's takes it with the client end of the pair.
    vi.stubGlobal(
      'Response',
      class extends Response {
        webSocket: unknown;
        constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
          super(body, init?.status === 101 ? { ...init, status: 200 } : init);
          if (init?.status === 101) Object.defineProperty(this, 'status', { value: 101 });
          this.webSocket = init?.webSocket;
        }
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const call = (method: string, path: string, body?: unknown, token = '', extra = {}) =>
    hub.fetch(
      new Request(`https://hub.example${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'CF-Connecting-IP': `192.0.2.${++ip}`,
          ...extra
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      }),
      env
    );

  async function signUp(username: string, n = 1) {
    const response = await call('POST', '/v1/signup', {
      username,
      name: username,
      salt: 'ab'.repeat(16),
      key: key(n)
    });

    return (await response.json()) as { token: string; me: { id: string } };
  }

  const newKey = async (token: string) =>
    (await (await call('POST', '/v1/presence/keys', { name: 'Anki' }, token)).json()) as {
      id: string;
      key: string;
    };

  /** Opens a stream; returns the response and the server end the object accepted */
  async function connect(pk: string) {
    const before = fake.sockets.length;
    const response = await call('GET', '/v1/presence/stream', undefined, pk, {
      Upgrade: 'websocket'
    });

    return { response, socket: fake.sockets.length > before ? fake.sockets.at(-1)!.socket : null };
  }

  it('checks the key, then pushes the current status and each change', async () => {
    const aki = await signUp('aki');
    const { key: pk, id } = await newKey(aki.token);

    expect((await connect('pk_' + 'A'.repeat(43))).response.status).toBe(401);
    expect(
      (await call('GET', '/v1/presence/stream', undefined, pk)).status // no Upgrade header
    ).toBe(426);
    expect(fake.namespace.calls).toBe(0);

    const { response, socket } = await connect(pk);

    expect(response.status).toBe(101);
    expect(fake.sockets.at(-1)!.tags).toEqual([id]);
    expect(socket!.last).toEqual({ activity: null }); // nothing current yet
    expect(fake.objects.get(aki.me.id)!.auto).toEqual([{ request: 'ping', response: 'pong' }]);

    await call('PUT', '/v1/presence', { activity, kind: 'book', ttl: 10 }, aki.token);
    const now = Date.now() / 1000;

    expect(socket!.last).toEqual({
      activity,
      kind: 'book',
      updatedAt: now,
      expiresAt: now + 600,
      next: 30
    });

    // The no-change PUT writes nothing and sends nothing.
    vi.advanceTimersByTime(30_000);
    await call('PUT', '/v1/presence', { activity, kind: 'book', ttl: 10 }, aki.token);
    expect(socket!.sent).toHaveLength(2);

    // A second connection starts with the current status, then both get the clear.
    const second = (await connect(pk)).socket!;

    expect(second.last.activity).toEqual(activity);
    await call('DELETE', '/v1/presence', undefined, aki.token);
    expect(socket!.last).toEqual({ activity: null });
    expect(second.last).toEqual({ activity: null });
    await call('DELETE', '/v1/presence', undefined, aki.token); // already ended: nothing sent
    expect(socket!.sent).toHaveLength(3);
  });

  it('expires on its own: the message carries expiresAt and a late connect gets the clear', async () => {
    const aki = await signUp('aki');
    const { key: pk } = await newKey(aki.token);

    await call('PUT', '/v1/presence', { activity, kind: 'book', ttl: 5 }, aki.token);
    expect((await connect(pk)).socket!.last.expiresAt).toBe(Date.now() / 1000 + 300);
    vi.advanceTimersByTime(301_000);
    expect((await connect(pk)).socket!.last).toEqual({ activity: null });
  });

  it('costs no Durable Object request for a reader without a paired add-on', async () => {
    const aki = await signUp('aki');

    await call('PUT', '/v1/presence', { activity, kind: 'book' }, aki.token);
    await call('DELETE', '/v1/presence', undefined, aki.token);
    expect(fake.namespace.calls).toBe(0);
  });

  it('closes the oldest connection past the cap', async () => {
    const aki = await signUp('aki');
    const { key: pk } = await newKey(aki.token);
    const sockets = [];

    for (let i = 0; i <= MAX_STREAMS; i++) {
      vi.advanceTimersByTime(1000);
      sockets.push((await connect(pk)).socket!);
    }
    expect(sockets[0].closed).toEqual([4008, 'too many']);
    expect(sockets.slice(1).every((socket) => !socket.closed)).toBe(true);
  });

  it('closes a revoked key’s connections, and all of them on sign-out everywhere', async () => {
    const aki = await signUp('aki');
    const mio = await signUp('mio', 2);
    const one = await newKey(aki.token);
    const two = await newKey(aki.token);
    const theirs = await newKey(mio.token);
    const first = (await connect(one.key)).socket!;
    const second = (await connect(two.key)).socket!;
    const other = (await connect(theirs.key)).socket!;

    await call('DELETE', `/v1/presence/keys/${one.id}`, undefined, mio.token); // not mio's key
    expect(first.closed).toBeNull();
    await call('DELETE', `/v1/presence/keys/${one.id}`, undefined, aki.token);
    expect(first.closed).toEqual([4001, 'key']);
    expect(second.closed).toBeNull();
    expect((await connect(one.key)).response.status).toBe(401);

    await call('POST', '/v1/logout-all', undefined, aki.token);
    expect(second.closed).toEqual([4001, 'key']);
    expect(other.closed).toBeNull();

    await call('DELETE', '/v1/me', undefined, mio.token);
    expect(other.closed).toEqual([4001, 'key']);
  });

  it('closes the connections on a password change and a recovery', async () => {
    const aki = await signUp('aki');
    const signup = await call('POST', '/v1/signup', {
      username: 'mio',
      name: 'mio',
      salt: 'ab'.repeat(16),
      key: key(2)
    });
    const mio = (await signup.json()) as { token: string; recovery: string };
    const a = (await connect((await newKey(aki.token)).key)).socket!;
    const b = (await connect((await newKey(mio.token)).key)).socket!;

    await call('POST', '/v1/password', { key: key(1), next: key(3) }, aki.token);
    expect(a.closed).toEqual([4001, 'key']);
    await call('POST', '/v1/recover', { username: 'mio', recovery: mio.recovery, key: key(4) });
    expect(b.closed).toEqual([4001, 'key']);
  });

  it('answers 404 without the binding (polling only), like an older hub', async () => {
    const aki = await signUp('aki');
    const { key: pk } = await newKey(aki.token);

    delete env.PRESENCE;
    expect((await connect(pk)).response.status).toBe(404);
  });
});
