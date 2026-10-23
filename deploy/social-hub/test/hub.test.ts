/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import hub, { STATUS_GAP, cleanUp, type Env } from '../src/hub';
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

  const heat = '0123401234'.repeat(8) + '0000';
  const stats = (streak: number, wordsKnown?: number) => ({
    streak,
    weekChars: 12400,
    weekMinutes: 100,
    finishedYear: 9,
    heat,
    wordsKnown
  });

  async function befriend(x: { token: string; me: { id: string } }, y: { token: string }) {
    const code = (await call('GET', '/v1/me', undefined, y.token)).body.code;

    await call('POST', '/v1/friends/request', { code }, x.token);
    await call('POST', `/v1/friends/${x.me.id}/accept`, undefined, y.token);
  }

  /** A status push 5 minutes after the last one */
  async function push(who: { token: string }, body: object) {
    vi.advanceTimersByTime(STATUS_GAP * 1000);
    const response = await call('PUT', '/v1/status', { books: [], ...body }, who.token);

    expect(response.status).toBe(200);
  }

  it('shows public profiles to anyone, private ones to friends, and neither when blocked', async () => {
    const aki = await signUp('aki_reads');
    const ren = await signUp('ren');
    const mio = await signUp('mio');

    await befriend(aki, ren);
    await push(aki, {
      books: [{ key: 'kusuriya1', title: '薬屋のひとりごと 1', kind: 'book', pct: 0.1 }],
      finished: { key: 'honzuki1', title: '本好きの下剋上 1', kind: 'book' },
      stats: stats(14)
    });

    const visitor = await call('GET', '/v1/profile/AKI_READS');
    expect(visitor.status).toBe(200);
    expect(visitor.body).toMatchObject({
      relation: 'visitor',
      profile: { username: 'aki_reads' },
      books: [{ key: 'kusuriya1' }],
      finished: [{ key: 'honzuki1', month: '2026-10' }],
      stats: { streak: 14, heat },
      events: []
    });
    const friend = await call('GET', '/v1/profile/aki_reads', undefined, ren.token);
    expect(friend.body.relation).toBe('friend');
    expect(friend.body.events.map((e: { type: string }) => e.type).sort()).toEqual([
      'finished',
      'started',
      'streak'
    ]);

    await call('PUT', '/v1/me', { share: { public: false } }, aki.token);
    expect((await call('GET', '/v1/profile/aki_reads')).status).toBe(404);
    expect((await call('GET', '/v1/profile/aki_reads', undefined, mio.token)).status).toBe(404);
    expect((await call('GET', '/v1/profile/aki_reads', undefined, ren.token)).status).toBe(200);
    // Add friend by username works for public profiles only.
    expect(
      (await call('POST', '/v1/friends/request', { username: 'aki_reads' }, mio.token)).status
    ).toBe(404);
    await call('PUT', '/v1/me', { share: { public: true } }, aki.token);
    const added = await call('POST', '/v1/friends/request', { username: 'aki_reads' }, mio.token);
    expect(added.body.outgoing).toEqual([
      { id: aki.me.id, code: '@aki_reads', at: expect.any(Number) }
    ]);

    await call('POST', `/v1/block/${ren.me.id}`, undefined, aki.token);
    expect((await call('GET', '/v1/profile/aki_reads', undefined, ren.token)).status).toBe(404);
    expect((await call('GET', '/v1/profile/ren', undefined, aki.token)).status).toBe(404);
    expect((await call('GET', '/v1/profile/nobody')).status).toBe(404);
  });

  it('deletes what a share toggle turns off at once', async () => {
    const aki = await signUp('aki');

    await call('PUT', '/v1/me', { share: { wordsKnown: true } }, aki.token);
    await push(aki, {
      books: [
        { key: 'k1', title: 'Book', kind: 'book', pct: 0.1 },
        { key: 'm1', title: 'Manga', kind: 'manga', pct: 0.1 }
      ],
      finished: { key: 'm0', title: 'Manga 0', kind: 'manga' },
      stats: stats(3, 3210)
    });
    expect(rows('status')).toHaveLength(2);
    expect(JSON.parse(rows('stats')[0].data as string).wordsKnown).toBe(3210);

    const share = (patch: object) => call('PUT', '/v1/me', { share: patch }, aki.token);

    await share({ hideManga: true });
    expect(rows('status').map((r) => r.kind)).toEqual(['book']);
    expect(rows('finished')).toHaveLength(0);
    expect(rows('events').map((r) => r.kind)).toEqual(['book']);
    await share({ wordsKnown: false });
    expect(JSON.parse(rows('stats')[0].data as string)).not.toHaveProperty('wordsKnown');
    await share({ activity: false });
    expect(rows('events')).toHaveLength(0);
    await share({ stats: false });
    expect(rows('stats')).toHaveLength(0);
    await share({ current: false });
    expect(rows('status')).toHaveLength(0);

    // Pushes keep only what is shared.
    await push(aki, {
      books: [{ key: 'k2', title: 'Book 2', kind: 'book', pct: 0.1 }],
      stats: stats(7)
    });
    expect([rows('status'), rows('stats'), rows('events')]).toEqual([[], [], []]);
  });

  it('feeds only friends’ events, once each, for 90 days', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');
    const mio = await signUp('mio');

    await befriend(aki, ren);
    const book = { key: 'k1', title: '魔女の旅々 3', kind: 'book', pct: 0.05 };

    await push(aki, { books: [book], stats: stats(6) });
    await push(aki, { books: [], stats: stats(7) });
    // Back among the current books: no second "started".
    await push(aki, { books: [book], stats: stats(7) });
    // Hidden: only the share, no event.
    await push(aki, { books: [{ kind: 'hidden', pct: 0.4 }] });
    await push(mio, { books: [{ key: 'k9', title: 'x', kind: 'book', pct: 0 }] });

    const feed = await call('GET', '/v1/feed?since=0', undefined, ren.token);
    expect(feed.body.events.map((e: { type: string; value: number }) => [e.type, e.value])).toEqual(
      [
        ['streak', 7],
        ['started', 0]
      ]
    );
    expect(feed.body.events[0].user).toMatchObject({ id: aki.me.id, name: 'aki' });
    expect((await call('GET', '/v1/feed?since=0', undefined, ren.token)).status).toBe(429);

    const friends = (await call('GET', '/v1/friends', undefined, ren.token)).body.friends;
    expect(friends[0].books).toEqual([
      expect.objectContaining({ key: '', title: '', kind: 'hidden', pct: 0.4 })
    ]);
    expect(friends[0].stats).toMatchObject({ weekChars: 12400 });

    vi.advanceTimersByTime(60_000);
    const since = (
      await call('GET', `/v1/feed?since=${Math.floor(Date.now() / 1000)}`, undefined, ren.token)
    ).body;
    expect(since.events).toEqual([]);

    vi.advanceTimersByTime(91 * 86400_000);
    await call('GET', '/v1/me', undefined, ren.token);
    await cleanUp(env);
    expect(rows('events')).toHaveLength(0);
  });

  it('keeps the last 50 finished books', async () => {
    const aki = await signUp('aki');

    for (let i = 0; i < 52; i += 1) {
      await push(aki, { finished: { key: `k${i}`, title: `Book ${i}`, kind: 'book' } });
    }
    const keys = rows('finished').map((r) => r.book_key);
    expect(keys).toHaveLength(50);
    expect(keys).not.toContain('k0');
    expect(
      (
        await call(
          'PUT',
          '/v1/status',
          { books: [], stats: { ...stats(1), heat: 'x' }, leaving: true },
          aki.token
        )
      ).status
    ).toBe(400);
  });

  it('answers 429 with CORS headers when the edge limit refuses, before any D1 access', async () => {
    const keys: string[] = [];
    const prepare = vi.spyOn(env.DB, 'prepare');

    env.EDGE_LIMIT = {
      limit: async ({ key }) => {
        keys.push(key);
        return { success: false };
      }
    };
    const response = await hub.fetch(
      new Request('https://hub.example/v1/me', { headers: { 'CF-Connecting-IP': '203.0.113.9' } }),
      env
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await response.json()).toEqual({ error: 'busy' });
    expect(keys).toEqual(['203.0.113.9']);
    expect(prepare).not.toHaveBeenCalled();
    // Preflights skip it.
    const preflight = await hub.fetch(
      new Request('https://hub.example/v1/me', { method: 'OPTIONS' }),
      env
    );
    expect(preflight.status).toBe(204);
    expect(keys).toHaveLength(1);
  });

  it('has migrations that apply twice over the schema without changing it', () => {
    const tables = () => db.prepare(`SELECT sql FROM sqlite_master ORDER BY name`).all();
    const before = tables();
    const migration = readFileSync(
      new URL('../migrations/0002_profiles.sql', import.meta.url),
      'utf8'
    );

    db.exec(migration);
    db.exec(migration);
    expect(tables()).toEqual(before);
  });

  it('records reports once per reporter, 5 a day', async () => {
    const aki = await signUp('aki');

    for (const name of ['aki', 'aki', 'nobody']) {
      await call('POST', '/v1/report', { username: name }, '', '198.51.100.1');
    }
    expect(rows('reports')).toHaveLength(1);
    expect((await call('POST', '/v1/report', { username: 'aki' }, aki.token)).status).toBe(400);
    for (let i = 0; i < 2; i += 1) {
      await call('POST', '/v1/report', { username: 'aki', what: 'picture' }, '', '198.51.100.1');
    }
    expect((await call('POST', '/v1/report', { username: 'aki' }, '', '198.51.100.1')).status).toBe(
      429
    );
    expect(rows('reports')).toHaveLength(2);
  });
});
