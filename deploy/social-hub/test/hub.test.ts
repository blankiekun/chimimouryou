/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import hub, { STATUS_GAP, cleanUp, type Env } from '../src/index';
import { memoryD1 } from './d1';

const key = (n: number) => n.toString(16).padStart(64, '0');
const salt = 'ab'.repeat(16);

describe('social hub', () => {
  let env: Env;
  let db: ReturnType<typeof memoryD1>['db'];
  let ip = 0;

  beforeEach(() => {
    const memory = memoryD1();

    env = { DB: memory.d1 };
    db = memory.db;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  async function call(method: string, path: string, body?: unknown, token = '', address = '') {
    const response = await hub.fetch(
      new Request(`https://hub.example${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'CF-Connecting-IP': address || `192.0.2.${++ip}`
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      }),
      env
    );

    return { status: response.status, body: await response.json() };
  }

  async function signUp(username: string, n = 1) {
    const { status, body } = await call('POST', '/v1/signup', {
      username,
      name: username,
      salt,
      key: key(n)
    });

    expect(status).toBe(200);
    return body as { token: string; recovery: string; me: { id: string; code: string } };
  }

  const rows = (table: string) => db.prepare(`SELECT * FROM ${table}`).all();

  it('signs up, logs in and out, and keeps only hashes of tokens and codes', async () => {
    const aki = await signUp('aki_reads');

    expect(aki.recovery).toMatch(/^[0-9A-Z]{20}$/);
    expect(aki.me.code).toMatch(/^[0-9A-Z]{8}$/);
    expect((await call('GET', '/v1/me', undefined, aki.token)).body.username).toBe('aki_reads');

    const salted = await call('POST', '/v1/salt', { username: 'AKI_READS' });
    expect(salted.body.salt).toBe(salt);
    // Unknown names get a stable made-up salt.
    const unknown = (await call('POST', '/v1/salt', { username: 'nobody' })).body.salt;
    expect((await call('POST', '/v1/salt', { username: 'nobody' })).body.salt).toBe(unknown);

    expect((await call('POST', '/v1/login', { username: 'aki_reads', key: key(2) })).status).toBe(
      401
    );
    const login = await call('POST', '/v1/login', { username: 'Aki_Reads', key: key(1) });
    expect(login.status).toBe(200);

    const stored = JSON.stringify([rows('users'), rows('sessions')]);
    [aki.token, login.body.token, aki.recovery, key(1)].forEach((secret) =>
      expect(stored).not.toContain(secret)
    );

    expect((await call('POST', '/v1/logout', undefined, aki.token)).status).toBe(200);
    expect((await call('GET', '/v1/me', undefined, aki.token)).status).toBe(401);
    expect((await call('GET', '/v1/me', undefined, login.body.token)).status).toBe(200);
    expect(
      (await call('POST', '/v1/signup', { username: 'AKI_reads', name: 'x', salt, key: key(3) }))
        .status
    ).toBe(409);
  });

  it('locks a username after 10 failed logins in an hour', async () => {
    await signUp('ren');
    for (let i = 0; i < 10; i += 1) {
      expect((await call('POST', '/v1/login', { username: 'ren', key: key(9) })).status).toBe(401);
    }
    expect((await call('POST', '/v1/login', { username: 'ren', key: key(1) })).status).toBe(429);
    vi.advanceTimersByTime(3600_000);
    expect((await call('POST', '/v1/login', { username: 'ren', key: key(1) })).status).toBe(200);
  });

  it('resets the password with the recovery code once, ending other sessions', async () => {
    const mio = await signUp('mio');
    const dashed = mio.recovery.replace(/(.{5})(?=.)/g, '$1-').toLowerCase();
    const reset = await call('POST', '/v1/recover', {
      username: 'mio',
      recovery: dashed,
      key: key(5)
    });

    expect(reset.status).toBe(200);
    expect(reset.body.recovery).not.toBe(mio.recovery);
    expect((await call('GET', '/v1/me', undefined, mio.token)).status).toBe(401);
    expect((await call('POST', '/v1/login', { username: 'mio', key: key(5) })).status).toBe(200);
    expect(
      (await call('POST', '/v1/recover', { username: 'mio', recovery: mio.recovery, key: key(6) }))
        .status
    ).toBe(401);
  });

  it('allows 3 sign-ups per address a day', async () => {
    const address = '198.51.100.7';
    for (const name of ['a_1', 'a_2', 'a_3']) {
      expect(
        (await call('POST', '/v1/signup', { username: name, name, salt, key: key(1) }, '', address))
          .status
      ).toBe(200);
    }
    expect(
      (
        await call(
          'POST',
          '/v1/signup',
          { username: 'a_4', name: 'x', salt, key: key(1) },
          '',
          address
        )
      ).status
    ).toBe(429);
  });

  it('friends by code, shows their books, and limits requests to 20 a day', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');
    const sent = await call(
      'POST',
      '/v1/friends/request',
      { code: ren.me.code.toLowerCase().replace(/(.{4})/, '$1-') },
      aki.token
    );

    expect(sent.body.outgoing).toEqual([
      { id: ren.me.id, code: ren.me.code, at: expect.any(Number) }
    ]);

    const incoming = await call('GET', '/v1/friends', undefined, ren.token);
    expect(incoming.body.incoming[0]).toMatchObject({ id: aki.me.id, name: 'aki' });
    // Once a minute.
    expect((await call('GET', '/v1/friends', undefined, ren.token)).status).toBe(429);

    const accepted = await call('POST', `/v1/friends/${aki.me.id}/accept`, undefined, ren.token);
    expect(accepted.body.friends.map((f: { id: string }) => f.id)).toEqual([aki.me.id]);

    const book = { key: 'kusuriya1', title: '薬屋のひとりごと 1', kind: 'book', pct: 0.62 };
    expect((await call('PUT', '/v1/status', { books: [book] }, aki.token)).status).toBe(200);
    vi.advanceTimersByTime(60_000);
    const list = await call('GET', '/v1/friends', undefined, ren.token);
    expect(list.body.friends[0].books[0]).toMatchObject({ key: 'kusuriya1', pct: 0.62 });

    expect(
      (await call('POST', '/v1/friends/request', { code: 'ZZZZZZZZ' }, aki.token)).status
    ).toBe(404);
    for (let i = 0; i < 18; i += 1)
      await call('POST', '/v1/friends/request', { code: 'ZZZZZZZZ' }, aki.token);
    expect(
      (await call('POST', '/v1/friends/request', { code: ren.me.code }, aki.token)).status
    ).toBe(429);
  });

  it('accepts at once when both entered each other’s code', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');

    await call('POST', '/v1/friends/request', { code: ren.me.code }, aki.token);
    const mutual = await call('POST', '/v1/friends/request', { code: aki.me.code }, ren.token);
    expect(mutual.body.friends).toHaveLength(1);
  });

  it('takes one status push per 5 minutes, plus one on leaving a book', async () => {
    const aki = await signUp('aki');
    const push = (leaving = false) =>
      call('PUT', '/v1/status', { books: [], leaving }, aki.token).then((r) => r.status);

    expect(await push()).toBe(200);
    vi.advanceTimersByTime((STATUS_GAP - 1) * 1000);
    expect(await push()).toBe(429);
    expect(await push(true)).toBe(200);
    vi.advanceTimersByTime(1000);
    expect(await push()).toBe(200);
    expect(
      (
        await call(
          'PUT',
          '/v1/status',
          { books: [{ key: 'k', title: 't', kind: 'x', pct: 2 }] },
          aki.token
        )
      ).status
    ).toBe(400);
  });

  it('blocks: removes the friend and ignores their requests', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');

    await call('POST', '/v1/friends/request', { code: ren.me.code }, aki.token);
    await call('POST', `/v1/friends/${aki.me.id}/accept`, undefined, ren.token);
    const blocked = await call('POST', `/v1/block/${aki.me.id}`, undefined, ren.token);
    expect(blocked.body).toEqual({ friends: [], incoming: [], outgoing: [] });

    const again = await call('POST', '/v1/friends/request', { code: ren.me.code }, aki.token);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ friends: [], incoming: [], outgoing: [] });
    // Aki can't lift Ren's block.
    await call('DELETE', `/v1/friends/${ren.me.id}`, undefined, aki.token);
    expect(rows('links')).toMatchObject([{ state: 'blocked', by_user: ren.me.id }]);
  });

  it('deletes every row of an account', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');

    await call('POST', '/v1/friends/request', { code: ren.me.code }, aki.token);
    await call(
      'PUT',
      '/v1/status',
      { books: [{ key: 'k', title: 't', kind: 'book', pct: 0.5 }] },
      aki.token
    );
    await call('PUT', '/v1/me', { name: 'Aki', avatar: 3 }, aki.token);
    expect((await call('DELETE', '/v1/me', undefined, aki.token)).status).toBe(200);

    const all = JSON.stringify(['users', 'sessions', 'links', 'status', 'limits'].map(rows));
    expect(all).not.toContain(aki.me.id);
    expect(rows('users')).toHaveLength(1);
  });

  it('forgets sessions unused for 90 days and accounts unused for a year', async () => {
    const aki = await signUp('aki');

    vi.advanceTimersByTime(91 * 86400_000);
    await cleanUp(env);
    expect(rows('sessions')).toHaveLength(0);
    expect((await call('GET', '/v1/me', undefined, aki.token)).status).toBe(401);
    vi.advanceTimersByTime(275 * 86400_000);
    await cleanUp(env);
    expect(rows('users')).toHaveLength(0);
  });
});
