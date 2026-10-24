/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import hub, { STATUS_GAP, capRank, cleanUp, clientAddress, type Env } from '../src/hub';
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

  it('locks an address after 10 failed logins in an hour, a username only after 50', async () => {
    await signUp('ren');
    const login = (n: number, address = '') =>
      call('POST', '/v1/login', { username: 'ren', key: key(n) }, '', address).then(
        (r) => r.status
      );

    for (let i = 0; i < 10; i += 1) expect(await login(9, '198.51.100.1')).toBe(401);
    expect(await login(1, '198.51.100.1')).toBe(429);
    // One address can't lock Ren out: he still signs in from his own.
    expect(await login(1)).toBe(200);
    for (let i = 0; i < 39; i += 1) expect(await login(9)).toBe(401);
    expect(await login(1)).toBe(200);
    expect(await login(9)).toBe(401);
    expect(await login(1)).toBe(429);
    vi.advanceTimersByTime(3600_000);
    expect(await login(1)).toBe(200);
  });

  it('limits IPv6 addresses by their /64', async () => {
    expect(
      clientAddress(
        new Request('https://hub.example', { headers: { 'CF-Connecting-IP': '2001:DB8:0:1::5' } })
      )
    ).toBe('2001:db8:0:1::/64');
    expect(
      clientAddress(
        new Request('https://hub.example', { headers: { 'CF-Connecting-IP': '2001:db8::' } })
      )
    ).toBe('2001:db8:0:0::/64');
    expect(
      clientAddress(
        new Request('https://hub.example', { headers: { 'CF-Connecting-IP': '203.0.113.9' } })
      )
    ).toBe('203.0.113.9');

    const signUpFrom = (username: string, address: string) =>
      call('POST', '/v1/signup', { username, name: username, salt, key: key(1) }, '', address).then(
        (r) => r.status
      );

    expect(await signUpFrom('aki', '2001:db8:1:2::1')).toBe(200);
    expect(await signUpFrom('ren', '2001:db8:1:2::2')).toBe(200);
    expect(await signUpFrom('mio', '2001:db8:1:2:abcd::9')).toBe(200);
    expect(await signUpFrom('sora', '2001:0db8:0001:0002:ffff:1:2:3')).toBe(429);
    expect(await signUpFrom('sora', '2001:db8:1:3::1')).toBe(200);

    const keys: string[] = [];

    env.EDGE_LIMIT = { limit: async ({ key }) => (keys.push(key), { success: true }) };
    await call('GET', '/v1/me', undefined, '', '2001:db8:1:2:aaaa::1');
    expect(keys).toEqual(['2001:db8:1:2::/64']);
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

  it('changes the password and the recovery code with the current password', async () => {
    const sora = await signUp('sora', 1);
    const other = (await call('POST', '/v1/login', { username: 'sora', key: key(1) })).body.token;

    expect(
      (await call('POST', '/v1/password', { key: key(9), next: key(2) }, sora.token)).status
    ).toBe(401);
    // A wrong password is a failed sign-in, not an ended session.
    expect((await call('GET', '/v1/me', undefined, sora.token)).status).toBe(200);
    expect(
      (await call('POST', '/v1/password', { key: key(1), next: key(2) }, sora.token)).status
    ).toBe(200);
    expect((await call('GET', '/v1/me', undefined, sora.token)).status).toBe(200);
    expect((await call('GET', '/v1/me', undefined, other)).status).toBe(401);
    expect((await call('POST', '/v1/login', { username: 'sora', key: key(1) })).status).toBe(401);
    expect((await call('POST', '/v1/login', { username: 'sora', key: key(2) })).status).toBe(200);

    expect((await call('POST', '/v1/recovery', { key: key(1) }, sora.token)).status).toBe(401);
    const fresh = await call('POST', '/v1/recovery', { key: key(2) }, sora.token);
    expect(fresh.body.recovery).toMatch(/^[0-9A-Z]{20}$/);
    expect(JSON.stringify(rows('users'))).not.toContain(fresh.body.recovery);
    const old = { username: 'sora', recovery: sora.recovery, key: key(3) };
    expect((await call('POST', '/v1/recover', old)).status).toBe(401);
    const reset = { username: 'sora', recovery: fresh.body.recovery, key: key(3) };
    expect((await call('POST', '/v1/recover', reset)).status).toBe(200);
  });

  it('signs out everywhere', async () => {
    const kai = await signUp('kai', 1);
    const other = (await call('POST', '/v1/login', { username: 'kai', key: key(1) })).body.token;
    await signUp('someone_else', 1);

    expect((await call('POST', '/v1/logout-all', undefined, kai.token)).status).toBe(200);
    expect((await call('GET', '/v1/me', undefined, kai.token)).status).toBe(401);
    expect((await call('GET', '/v1/me', undefined, other)).status).toBe(401);
    expect(rows('sessions')).toHaveLength(1);
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

  it('refuses a request whose sender reached 200 friends meanwhile', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');
    const mio = await signUp('mio');
    const time = Math.floor(Date.now() / 1000);
    const insert = db.prepare(
      `INSERT INTO links (a, b, state, by_user, created) VALUES (?, ?, 'accepted', ?, ?)`
    );

    for (let i = 0; i < 199; i += 1) insert.run(aki.me.id, `z${i}`, aki.me.id, time);
    await call('POST', '/v1/friends/request', { code: ren.me.code }, aki.token);
    await call('POST', '/v1/friends/request', { code: mio.me.code }, aki.token);
    expect(
      (await call('POST', `/v1/friends/${aki.me.id}/accept`, undefined, ren.token)).status
    ).toBe(200);
    expect(
      (await call('POST', `/v1/friends/${aki.me.id}/accept`, undefined, mio.token)).status
    ).toBe(409);
  });

  it('accepts at once when both entered each other’s code', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');

    await call('POST', '/v1/friends/request', { code: ren.me.code }, aki.token);
    const mutual = await call('POST', '/v1/friends/request', { code: aki.me.code }, ren.token);
    expect(mutual.body.friends).toHaveLength(1);
  });

  it('takes one status push per minute, plus one on leaving a book', async () => {
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

  /** A status push a minute after the last one */
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

  it('caps a shared rank by the characters it has seen and one tier a week', async () => {
    const aki = await signUp('aki');
    const stored = () => JSON.parse(rows('stats')[0].data as string);

    // A new account can't claim the top rank: characters grow 300,000 a day from its creation.
    await push(aki, { stats: { ...stats(1), rank: 7, chars: 10_000_000 } });
    expect(stored()).toMatchObject({ rank: 1 });
    expect(stored().chars).toBeLessThan(1000);

    const claim = () => push(aki, { stats: { ...stats(1), rank: 7, chars: 10_000_000 } });

    // 300k characters support rank 3, but a rank rises one tier a week.
    vi.advanceTimersByTime(86400_000);
    await claim();
    expect(stored()).toMatchObject({ rank: 1 });
    vi.advanceTimersByTime(6 * 86400_000);
    await claim();
    expect(stored()).toMatchObject({ rank: 2 });
    vi.advanceTimersByTime(86400_000);
    await claim();
    expect(stored()).toMatchObject({ rank: 2 });
    vi.advanceTimersByTime(6 * 86400_000);
    await claim();
    expect(stored()).toMatchObject({ rank: 3 });
    expect((await call('GET', '/v1/profile/aki')).body.stats).toMatchObject({ rank: 3 });
  });

  it('caps ranks without a request', () => {
    const day = 86400;
    const base = { rank: 4, chars: 700_000 };

    // Three days since the last push at 100k: 1M allowed, rank 3 + 1 after a week.
    expect(capRank(base, { rank: 3, chars: 100_000, rankAt: 0 }, 0, 0, 8 * day)).toEqual({
      ...base,
      rankAt: 8 * day
    });
    expect(capRank(base, { rank: 3, chars: 100_000, rankAt: 0 }, 7 * day, 0, 8 * day)).toEqual({
      chars: 400_000,
      rank: 3,
      rankAt: 0
    });
    expect(capRank(base, { rank: 2, chars: 1e6, rankAt: day }, day, 0, 2 * day)).toMatchObject({
      rank: 2,
      rankAt: day
    });
    // A lower claim is taken as it is; stats without a rank pass through.
    expect(capRank({ rank: 1, chars: 0 }, { rank: 5, chars: 9e6, rankAt: 0 }, 0, 0, day)).toEqual({
      rank: 1,
      chars: 0,
      rankAt: 0
    });
    expect(capRank({ streak: 1 } as { rank?: number }, null, 0, 0, day)).toEqual({ streak: 1 });
    // A first rank from an old account rises from 1, whatever its characters allow.
    expect(capRank({ rank: 7, chars: 1e7 }, { streak: 1 }, 0, 0, 40 * day)).toMatchObject({
      rank: 2,
      rankAt: 40 * day
    });
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

  it('keeps a reader’s newest 100 events', async () => {
    const aki = await signUp('aki');
    const book = (key: string) => ({ key, title: key, kind: 'book', pct: 0.1 });

    for (let i = 0; i < 35; i += 1) {
      await push(aki, { books: [book(`a${i}`), book(`b${i}`), book(`c${i}`)] });
    }
    const keys = rows('events').map((r) => r.book_key);
    expect(keys).toHaveLength(100);
    expect(keys).not.toContain('a0');
    expect(keys).toContain('c34');
  });

  it('drops a finished book and its events for its reader only', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');
    const done = { key: 'k1', title: '魔女の旅々 3', kind: 'book' };

    await push(aki, { finished: done });
    await push(ren, { finished: done });
    expect(rows('events')).toHaveLength(2);

    expect((await call('DELETE', '/v1/finished/k1', undefined, aki.token)).status).toBe(200);
    expect(rows('finished').map((r) => r.user)).toEqual([ren.me.id]);
    expect(rows('events').map((r) => r.user)).toEqual([ren.me.id]);
    expect((await call('DELETE', '/v1/finished/k1')).status).toBe(401);
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
    for (const file of ['0002_profiles.sql', '0003_images.sql']) {
      const migration = readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');

      db.exec(migration);
      db.exec(migration);
    }
    expect(tables()).toEqual(before);
  });

  it('moves covers and their reports to one per reader, twice without harm', () => {
    const migration = readFileSync(
      new URL('../migrations/0006_covers_per_reader.sql', import.meta.url),
      'utf8'
    );
    const aki = '0123456789abcdef';

    db.exec(`DROP TABLE covers;
      CREATE TABLE covers (book_key TEXT PRIMARY KEY, file TEXT NOT NULL, user TEXT NOT NULL,
        at INTEGER NOT NULL, removed INTEGER NOT NULL DEFAULT 0);
      INSERT INTO covers VALUES ('k1', 'aaaaaaaaaaaaaaaa', '${aki}', 1, 0);
      INSERT INTO reports VALUES ('k1', 'r1', 'cover', 1), ('gone', 'r1', 'cover', 1),
        ('${aki}', 'r1', 'name', 1);`);
    db.exec(migration);
    db.exec(migration);
    expect(rows('covers')).toEqual([
      { user: aki, book_key: 'k1', file: 'aaaaaaaaaaaaaaaa', at: 1, removed: 0 }
    ]);
    expect(db.prepare('SELECT target, what FROM reports ORDER BY what').all()).toEqual([
      { target: `${aki}:k1`, what: 'cover' },
      { target: aki, what: 'name' }
    ]);
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE tbl_name = 'covers' ORDER BY name`).all()
    ).toEqual([{ name: 'covers' }, { name: 'covers_file' }, { name: 'sqlite_autoindex_covers_1' }]);
  });

  it('records reports once per reporter, 5 a day', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');

    for (const name of ['aki', 'aki', 'nobody']) {
      await call('POST', '/v1/report', { username: name }, ren.token);
    }
    expect(rows('reports')).toHaveLength(1);
    expect((await call('POST', '/v1/report', { username: 'aki' }, aki.token)).status).toBe(400);
    for (let i = 0; i < 2; i += 1) {
      await call('POST', '/v1/report', { username: 'aki', what: 'picture' }, ren.token);
    }
    expect((await call('POST', '/v1/report', { username: 'aki' }, ren.token)).status).toBe(429);
    expect(rows('reports')).toHaveLength(2);
  });

  it('refuses reports from visitors without a session', async () => {
    await signUp('aki');

    expect((await call('POST', '/v1/report', { username: 'aki' }, '', '198.51.100.1')).status).toBe(
      401
    );
    expect(rows('reports')).toHaveLength(0);
  });
});
