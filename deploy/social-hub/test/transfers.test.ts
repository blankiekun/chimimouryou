/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import hub, {
  TRANSFERS_PER_DAY,
  TRANSFER_BYTES,
  TRANSFER_CRON,
  TRANSFER_TTL,
  cleanUp,
  type Env
} from '../src/hub';
import { memoryD1 } from './d1';

const key = (n: number) => n.toString(16).padStart(64, '0');
const salt = 'ab'.repeat(16);
const offer = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';
const answer = 'v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\n';

describe('book transfers', () => {
  let env: Env;
  let db: ReturnType<typeof memoryD1>['db'];
  let ip = 0;
  let n = 0;

  beforeEach(() => {
    const memory = memoryD1();

    env = { DB: memory.d1 };
    db = memory.db;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  async function call(method: string, path: string, body?: unknown, token = '') {
    const response = await hub.fetch(
      new Request(`https://hub.example${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'CF-Connecting-IP': `192.0.2.${++ip % 250}`
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      }),
      env
    );

    return { status: response.status, body: await response.json() };
  }

  async function signUp(username: string) {
    const { body } = await call('POST', '/v1/signup', {
      username,
      name: username,
      salt,
      key: key(++n)
    });

    return body as { token: string; me: { id: string; code: string } };
  }

  async function friends() {
    const aki = await signUp('aki_reads');
    const ren = await signUp('ren_reads');

    await call('POST', '/v1/friends/request', { code: ren.me.code }, aki.token);
    await call('POST', `/v1/friends/${aki.me.id}/accept`, undefined, ren.token);
    return { aki, ren };
  }

  const book = (to: string, extra = {}) => ({
    to,
    title: '坊っちゃん',
    kind: 'book',
    size: 1000,
    ...extra
  });
  const rows = () => db.prepare('SELECT * FROM transfers').all();

  it('signals between friends: create, incoming, accept with offer, answer, delete', async () => {
    const { aki, ren } = await friends();
    const created = await call('POST', '/v1/transfers', book(ren.me.id), aki.token);

    expect(created.status).toBe(200);
    const { id } = created.body;

    const incoming = await call('GET', '/v1/transfers', undefined, ren.token);
    expect(incoming.body.incoming).toMatchObject([
      { id, title: '坊っちゃん', kind: 'book', size: 1000, from: { username: 'aki_reads' } }
    ]);
    // Only the receiver sees it as incoming.
    expect((await call('GET', '/v1/transfers', undefined, aki.token)).body.incoming).toEqual([]);

    expect((await call('GET', `/v1/transfers/${id}`, undefined, aki.token)).body).toEqual({
      state: 'pending',
      offer: null
    });
    // The sender can't accept, the receiver can't answer.
    expect((await call('POST', `/v1/transfers/${id}/accept`, { offer }, aki.token)).status).toBe(
      404
    );
    expect((await call('POST', `/v1/transfers/${id}/answer`, { answer }, ren.token)).status).toBe(
      404
    );
    expect(
      (await call('POST', `/v1/transfers/${id}/accept`, { offer: 'x' }, ren.token)).status
    ).toBe(400);

    expect((await call('POST', `/v1/transfers/${id}/accept`, { offer }, ren.token)).status).toBe(
      200
    );
    expect((await call('POST', `/v1/transfers/${id}/accept`, { offer }, ren.token)).status).toBe(
      409
    );
    expect((await call('GET', `/v1/transfers/${id}`, undefined, aki.token)).body).toEqual({
      state: 'accepted',
      offer
    });
    expect((await call('POST', `/v1/transfers/${id}/answer`, { answer }, aki.token)).status).toBe(
      200
    );
    expect((await call('GET', `/v1/transfers/${id}`, undefined, ren.token)).body).toEqual({
      state: 'answered',
      answer
    });

    // Connected: the sender deletes it, and nothing is left.
    expect((await call('DELETE', `/v1/transfers/${id}`, undefined, aki.token)).status).toBe(200);
    expect(rows()).toEqual([]);
    expect((await call('GET', `/v1/transfers/${id}`, undefined, ren.token)).status).toBe(404);
  });

  it('refuses non-friends, blocked friends and signed-out calls', async () => {
    const { aki, ren } = await friends();
    const sora = await signUp('sora_reads');

    expect((await call('POST', '/v1/transfers', book(sora.me.id), aki.token)).body.error).toBe(
      'friend'
    );
    expect((await call('POST', '/v1/transfers', book(ren.me.id))).status).toBe(401);
    expect((await call('GET', '/v1/transfers')).status).toBe(401);

    const { id } = (await call('POST', '/v1/transfers', book(ren.me.id), aki.token)).body;

    // A stranger can't see or touch it.
    expect((await call('GET', `/v1/transfers/${id}`, undefined, sora.token)).status).toBe(404);
    expect((await call('DELETE', `/v1/transfers/${id}`, undefined, sora.token)).status).toBe(404);
    expect((await call('GET', `/v1/transfers/${id}`)).status).toBe(401);

    // Blocking ends it at the next signaling call, both ways.
    await call('POST', `/v1/block/${aki.me.id}`, undefined, ren.token);
    expect((await call('GET', `/v1/transfers/${id}`, undefined, aki.token)).status).toBe(404);
    expect((await call('GET', '/v1/transfers', undefined, ren.token)).body.incoming).toEqual([]);
    expect((await call('POST', `/v1/transfers/${id}/accept`, { offer }, ren.token)).status).toBe(
      404
    );
    expect((await call('POST', '/v1/transfers', book(ren.me.id), aki.token)).status).toBe(403);
  });

  it('declines: the sender sees it once, then it is gone', async () => {
    const { aki, ren } = await friends();
    const { id } = (await call('POST', '/v1/transfers', book(ren.me.id), aki.token)).body;

    expect((await call('DELETE', `/v1/transfers/${id}`, undefined, ren.token)).status).toBe(200);
    expect((await call('GET', '/v1/transfers', undefined, ren.token)).body.incoming).toEqual([]);
    expect((await call('GET', `/v1/transfers/${id}`, undefined, aki.token)).body.state).toBe(
      'declined'
    );
    expect(rows()).toEqual([]);
  });

  it('checks kind and size, one live transfer per pair, 20 a day', async () => {
    const { aki, ren } = await friends();

    expect(
      (await call('POST', '/v1/transfers', book(ren.me.id, { kind: 'vn' }), aki.token)).status
    ).toBe(400);
    expect(
      (
        await call(
          'POST',
          '/v1/transfers',
          book(ren.me.id, { size: TRANSFER_BYTES + 1 }),
          aki.token
        )
      ).body.error
    ).toBe('too-big');

    const first = await call('POST', '/v1/transfers', book(ren.me.id), aki.token);
    // Either way round.
    expect((await call('POST', '/v1/transfers', book(aki.me.id), ren.token)).body.error).toBe(
      'busy-pair'
    );

    await call('DELETE', `/v1/transfers/${first.body.id}`, undefined, aki.token);
    for (let i = 1; i < TRANSFERS_PER_DAY; i += 1) {
      const { id } = (await call('POST', '/v1/transfers', book(ren.me.id), aki.token)).body;

      await call('DELETE', `/v1/transfers/${id}`, undefined, aki.token);
    }
    expect((await call('POST', '/v1/transfers', book(ren.me.id), aki.token)).body.error).toBe(
      'limit'
    );
  });

  it('expires after 10 minutes and the cron deletes it', async () => {
    const { aki, ren } = await friends();
    const { id } = (await call('POST', '/v1/transfers', book(ren.me.id), aki.token)).body;

    vi.setSystemTime(Date.now() + TRANSFER_TTL * 1000);
    expect((await call('GET', `/v1/transfers/${id}`, undefined, aki.token)).status).toBe(404);
    expect((await call('GET', '/v1/transfers', undefined, ren.token)).body.incoming).toEqual([]);
    expect(rows()).toHaveLength(1);

    await hub.scheduled({ cron: TRANSFER_CRON }, env);
    expect(rows()).toEqual([]);

    // A new one is allowed, and the daily cleanup also expires them.
    await call('POST', '/v1/transfers', book(ren.me.id), aki.token);
    vi.setSystemTime(Date.now() + TRANSFER_TTL * 1000);
    await cleanUp(env);
    expect(rows()).toEqual([]);
  });

  it('goes with a deleted account', async () => {
    const { aki, ren } = await friends();

    await call('POST', '/v1/transfers', book(ren.me.id), aki.token);
    await call('DELETE', '/v1/me', undefined, aki.token);
    expect(rows()).toEqual([]);
  });
});
