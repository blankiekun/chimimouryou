/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import hub, { TRANSFER_CRON, sameHash, type Env } from '../src/hub';
import { cleanActivity } from '../src/presence';
import { memoryD1 } from './d1';

const key = (n: number) => n.toString(16).padStart(64, '0');
const salt = 'ab'.repeat(16);
const activity = { name: 'chimimouryou', details: 'Reading 吾輩は猫である', state: '42%' };

describe('Discord status relay', () => {
  let env: Env;
  let db: ReturnType<typeof memoryD1>['db'];
  let ip = 0;

  beforeEach(() => {
    const memory = memoryD1();

    env = { DB: memory.d1 };
    db = memory.db;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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
    const text = await response.text();

    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      headers: response.headers
    };
  }

  async function signUp(username: string, n = 1) {
    const { body } = await call('POST', '/v1/signup', {
      username,
      name: username,
      salt,
      key: key(n)
    });

    return body as { token: string; recovery: string; me: { id: string; code: string } };
  }

  const current = (pk: string) => call('GET', '/v1/presence/current', undefined, pk);
  const rows = (table: string) => db.prepare(`SELECT * FROM ${table}`).all();

  it('relays a clamped status to a paired key until it expires', async () => {
    const aki = await signUp('aki');
    const code = await call('POST', '/v1/presence/codes', undefined, aki.token);

    expect(code.body.code).toMatch(/^[0-9A-Z]{3}-[0-9A-Z]{3}-[0-9A-Z]{3}$/);
    expect(code.body.expiresAt).toBe(Date.now() / 1000 + 600);

    const paired = await call('POST', '/v1/presence/pair', {
      code: code.body.code.toLowerCase(),
      name: 'Desk PC'
    });

    expect(paired.status).toBe(200);
    expect(paired.body.key).toMatch(/^pk_[A-Za-z0-9_-]{43}$/);
    const pk = paired.body.key;

    expect((await current(pk)).status).toBe(204);
    expect(
      (
        await call(
          'PUT',
          '/v1/presence',
          {
            kind: 'book',
            activity: { ...activity, extra: 'x', buttons: [{ label: 'Open', url: 'http://x' }] }
          },
          aki.token
        )
      ).status
    ).toBe(204);

    const now = await current(pk);

    expect(now.status).toBe(200);
    expect(now.headers.get('Cache-Control')).toBe('no-store');
    expect(now.body).toEqual({
      activity,
      kind: 'book',
      updatedAt: Date.now() / 1000,
      expiresAt: Date.now() / 1000 + 300,
      next: 30
    });
    // One update per 20 s.
    expect((await call('PUT', '/v1/presence', { kind: 'manga', activity }, aki.token)).status).toBe(
      429
    );
    vi.advanceTimersByTime(20_000);
    expect((await call('PUT', '/v1/presence', { kind: 'idle', activity }, aki.token)).status).toBe(
      204
    );
    expect((await call('PUT', '/v1/presence', { kind: 'x', activity }, aki.token)).status).toBe(
      400
    );
    vi.advanceTimersByTime(300_000);
    expect((await current(pk)).status).toBe(204);

    vi.advanceTimersByTime(20_000);
    await call('PUT', '/v1/presence', { kind: 'vn', activity }, aki.token);
    expect((await call('DELETE', '/v1/presence', undefined, aki.token)).status).toBe(204);
    expect((await current(pk)).status).toBe(204);

    // The key is listed by name, never shown again; a revoked one is 401.
    const keys = await call('GET', '/v1/presence/keys', undefined, aki.token);

    expect(keys.body).toEqual([
      {
        id: paired.body.id,
        name: 'Desk PC',
        createdAt: expect.any(Number),
        lastSeen: expect.any(Number)
      }
    ]);
    expect(
      (await call('DELETE', `/v1/presence/keys/${paired.body.id}`, undefined, aki.token)).status
    ).toBe(204);
    expect((await current(pk)).status).toBe(401);
  });

  it('keeps keys and codes only as hashes', async () => {
    const aki = await signUp('aki');
    const code = (await call('POST', '/v1/presence/codes', undefined, aki.token)).body.code;
    const auto = (await call('POST', '/v1/presence/keys', { name: 'Laptop' }, aki.token)).body;
    const stored = JSON.stringify([rows('presence_keys'), rows('presence_codes')]);

    expect(auto.key).toMatch(/^pk_/);
    [auto.key, auto.key.slice(3), code, code.replace(/-/g, '')].forEach((secret) =>
      expect(stored).not.toContain(secret)
    );
    expect(
      JSON.stringify((await call('GET', '/v1/presence/keys', undefined, aki.token)).body)
    ).not.toContain(auto.key);
  });

  it('lets a presence key read GET presence/current and nothing else', async () => {
    const aki = await signUp('aki');
    const pk = (await call('POST', '/v1/presence/keys', { name: 'PC' }, aki.token)).body.key;
    const routes: [string, string, unknown?][] = [
      ['GET', '/v1/me'],
      ['PUT', '/v1/me', { presenceProfile: true }],
      ['DELETE', '/v1/me'],
      ['PUT', '/v1/presence', { kind: 'book', activity }],
      ['DELETE', '/v1/presence'],
      ['GET', '/v1/presence/keys'],
      ['POST', '/v1/presence/keys', { name: 'x' }],
      ['DELETE', '/v1/presence/keys/0000000000000000'],
      ['POST', '/v1/presence/codes'],
      ['GET', '/v1/friends'],
      ['POST', '/v1/logout-all'],
      ['GET', '/v1/profile/aki'],
      ['GET', '/v1/community/feed'],
      ['GET', '/v1/admin/reports']
    ];

    for (const [method, path, body] of routes) {
      expect([method, path, (await call(method, path, body, pk)).status]).toEqual([
        method,
        path,
        401
      ]);
    }
    expect(rows('users')).toHaveLength(1);
    // And a session token isn't a presence key.
    expect((await current(aki.token)).status).toBe(401);
    expect((await current(pk)).status).toBe(204);
  });

  it('pairs a code once, refuses expired ones and locks an address after 10 failures', async () => {
    const aki = await signUp('aki');
    const code = (await call('POST', '/v1/presence/codes', undefined, aki.token)).body.code;
    const tryCode = (value: string, address = '198.51.100.7') =>
      call('POST', '/v1/presence/pair', { code: value, name: 'PC' }, '', address);

    expect((await tryCode(code)).status).toBe(200);
    expect((await tryCode(code)).body).toEqual({ error: 'code' });

    const late = (await call('POST', '/v1/presence/codes', undefined, aki.token)).body.code;

    vi.advanceTimersByTime(600_000);
    expect((await tryCode(late)).status).toBe(404);
    for (let i = 0; i < 8; i += 1) expect((await tryCode('AAA-AAA-AAA')).status).toBe(404);

    const good = (await call('POST', '/v1/presence/codes', undefined, aki.token)).body.code;

    // 10 failures (1 reuse, 1 expired, 8 wrong): locked even with a good code; others still pair.
    expect((await tryCode(good)).status).toBe(429);
    expect((await tryCode(good, '203.0.113.9')).status).toBe(200);
    // No session needed, and none is made.
    expect(rows('sessions')).toHaveLength(1);
  });

  it('caps keys at 10 and open codes at 5', async () => {
    const aki = await signUp('aki');

    for (let i = 0; i < 10; i += 1) {
      expect((await call('POST', '/v1/presence/keys', { name: `PC ${i}` }, aki.token)).status).toBe(
        200
      );
    }
    expect((await call('POST', '/v1/presence/keys', { name: 'one more' }, aki.token)).status).toBe(
      409
    );
    expect((await call('POST', '/v1/presence/keys', { name: '' }, aki.token)).status).toBe(400);
    for (let i = 0; i < 5; i += 1) {
      expect((await call('POST', '/v1/presence/codes', undefined, aki.token)).status).toBe(200);
    }
    expect((await call('POST', '/v1/presence/codes', undefined, aki.token)).status).toBe(429);
    vi.advanceTimersByTime(600_000);
    expect((await call('POST', '/v1/presence/codes', undefined, aki.token)).status).toBe(200);
  });

  it('shows the status on the profile to friends and self only, never through the edge cache', async () => {
    const aki = await signUp('aki');
    const ren = await signUp('ren');
    const mio = await signUp('mio');
    const stored = new Map<string, Response>();

    vi.stubGlobal('caches', {
      default: {
        match: async (k: string) => stored.get(k)?.clone(),
        put: async (k: string, response: Response) => void stored.set(k, response),
        delete: async (k: string) => stored.delete(k)
      }
    });
    await call('POST', '/v1/friends/request', { code: ren.me.code }, aki.token);
    await call('POST', `/v1/friends/${aki.me.id}/accept`, undefined, ren.token);
    await call('PUT', '/v1/presence', { kind: 'book', activity }, aki.token);

    const seen = async (token: string) =>
      (await call('GET', '/v1/profile/aki', undefined, token)).body.presence;

    // Off by default.
    expect(await seen(ren.token)).toBeUndefined();
    const on = await call('PUT', '/v1/me', { presenceProfile: true }, aki.token);

    expect(on.body.presenceProfile).toBe(true);
    expect((await call('PUT', '/v1/me', { presenceProfile: 'yes' }, aki.token)).status).toBe(400);
    expect(await seen(ren.token)).toEqual({ activity, updatedAt: Date.now() / 1000 });
    expect(await seen(aki.token)).toEqual({ activity, updatedAt: Date.now() / 1000 });
    expect(await seen(mio.token)).toBeUndefined();
    expect(await seen('')).toBeUndefined();
    expect(stored.size).toBe(1);
    expect(await stored.values().next().value!.clone().text()).not.toContain('presence');
    vi.advanceTimersByTime(300_000);
    expect(await seen(ren.token)).toBeUndefined();
  });

  it('revokes keys, codes and the status on logout-all, password change, recovery and deletion', async () => {
    const setUp = async (username: string) => {
      const user = await signUp(username);
      const pk = (await call('POST', '/v1/presence/keys', { name: 'PC' }, user.token)).body.key;

      await call('POST', '/v1/presence/codes', undefined, user.token);
      await call('PUT', '/v1/presence', { kind: 'book', activity }, user.token);
      expect((await current(pk)).status).toBe(200);
      return { ...user, pk };
    };
    const gone = async (user: { me: { id: string }; pk: string }) => {
      expect((await current(user.pk)).status).toBe(401);
      for (const table of ['presence', 'presence_keys', 'presence_codes']) {
        expect(db.prepare(`SELECT 1 FROM ${table} WHERE user = ?`).all(user.me.id)).toEqual([]);
      }
    };
    const a = await setUp('a_all');
    const b = await setUp('b_pass');
    const c = await setUp('c_recover');
    const d = await setUp('d_delete');
    const keep = await setUp('e_keep');

    await call('POST', '/v1/logout-all', undefined, a.token);
    await call('POST', '/v1/password', { key: key(1), next: key(2) }, b.token);
    await call('POST', '/v1/recover', { username: 'c_recover', recovery: c.recovery, key: key(3) });
    await call('DELETE', '/v1/me', undefined, d.token);
    for (const user of [a, b, c, d]) await gone(user);
    expect((await current(keep.pk)).status).toBe(200);
  });

  it('drops expired statuses and codes on the 10-minute cron', async () => {
    const aki = await signUp('aki');

    await call('POST', '/v1/presence/codes', undefined, aki.token);
    await call('PUT', '/v1/presence', { kind: 'book', activity }, aki.token);
    vi.advanceTimersByTime(299_000);
    await hub.scheduled({ cron: TRANSFER_CRON }, env);
    expect(rows('presence')).toHaveLength(1);
    vi.advanceTimersByTime(301_000);
    await hub.scheduled({ cron: TRANSFER_CRON }, env);
    // The activity goes at once; the times (for the wait hint) after an hour.
    expect(rows('presence')).toEqual([expect.objectContaining({ activity: '{}', kind: '' })]);
    expect(rows('presence_codes')).toEqual([]);
    vi.advanceTimersByTime(3600_000);
    await hub.scheduled({ cron: TRANSFER_CRON }, env);
    expect(rows('presence')).toEqual([]);
  });

  it('hints how long the add-on waits, and writes last_seen once a day', async () => {
    const aki = await signUp('aki');
    const pk = (await call('POST', '/v1/presence/keys', { name: 'PC' }, aki.token)).body.key;
    const seen = () => db.prepare('SELECT last_seen FROM presence_keys').get()!.last_seen;
    const next = async () => {
      const answer = await current(pk);

      return answer.status === 200 ? answer.body.next : Number(answer.headers.get('X-Next'));
    };

    // Never had a status: 5 minutes.
    expect(await next()).toBe(300);
    expect(seen()).toBe(Date.now() / 1000);
    await call('PUT', '/v1/presence', { kind: 'book', activity }, aki.token);
    vi.advanceTimersByTime(60_000);
    expect(await next()).toBe(30);
    // No write on later polls the same day.
    expect(seen()).toBe(Date.now() / 1000 - 60);
    await call('DELETE', '/v1/presence', undefined, aki.token);
    expect((await current(pk)).status).toBe(204);
    expect(await next()).toBe(30);
    vi.advanceTimersByTime(600_000);
    expect(await next()).toBe(120);
    vi.advanceTimersByTime(3600_000);
    await hub.scheduled({ cron: TRANSFER_CRON }, env);
    expect(await next()).toBe(300);
    vi.advanceTimersByTime(86_400_000);
    await next();
    expect(seen()).toBe(Date.now() / 1000);
    // A revoked key is told to wait too.
    await call('DELETE', '/v1/presence/keys/' + rows('presence_keys')[0].id, undefined, aki.token);
    const revoked = await current(pk);

    expect([revoked.status, revoked.headers.get('X-Next')]).toEqual([401, '300']);
  });

  it('skips the write for an unchanged status with more than 2 minutes left', async () => {
    const aki = await signUp('aki');
    const put = (body: unknown) => call('PUT', '/v1/presence', body, aki.token);
    const updated = () => db.prepare('SELECT updated_at FROM presence').get()!.updated_at;
    const start = Date.now() / 1000;

    await put({ kind: 'book', activity });
    vi.advanceTimersByTime(60_000);
    // 4 minutes left: skipped (unknown fields are dropped first, so this is unchanged too).
    expect((await put({ kind: 'book', activity: { ...activity, extra: 1 } })).status).toBe(204);
    expect(updated()).toBe(start);
    vi.advanceTimersByTime(121_000);
    // Under 2 minutes left: written.
    expect((await put({ kind: 'book', activity })).status).toBe(204);
    expect(updated()).toBe(start + 181);
    vi.advanceTimersByTime(60_000);
    expect((await put({ kind: 'book', activity })).status).toBe(204);
    expect(updated()).toBe(start + 181);
    // A change is written (past the 20 s gap).
    expect((await put({ kind: 'book', activity: { ...activity, state: '43%' } })).status).toBe(204);
    expect(updated()).toBe(start + 241);
  });

  it('clamps an activity like the add-on', () => {
    const long = 'あ'.repeat(200);

    expect(
      cleanActivity({
        name: '  a\n b ',
        details: long,
        state: 'x',
        details_url: 'https://example.com/a',
        state_url: 'javascript:alert(1)',
        assets: { large_image: 'logo', large_text: 'Hi', small_text: 'no image' },
        timestamps: { start: 2000, end: 1000 },
        party: { size: [3, 2] },
        buttons: [
          { label: 'One', url: 'https://a.example' },
          { label: 'Two' },
          { label: 'Three', url: 'https://c' }
        ]
      })
    ).toEqual({
      name: 'a b',
      details: `${'あ'.repeat(127)}…`,
      details_url: 'https://example.com/a',
      assets: { large_image: 'logo', large_text: 'Hi' },
      timestamps: { start: 2000 },
      buttons: [{ label: 'One', url: 'https://a.example' }]
    });
    expect(() => cleanActivity({ state: 'x' })).toThrow('activity');
    expect(() => cleanActivity([])).toThrow('activity');
  });

  it('compares hashes in constant time', () => {
    expect(sameHash('ab', 'ab')).toBe(true);
    expect(sameHash('ab', 'ac')).toBe(false);
    expect(sameHash('ab', 'abc')).toBe(false);
  });

  it('migrates an older hub and leaves it unchanged on a second run', () => {
    const old = new DatabaseSync(':memory:');
    const migration = readFileSync(
      new URL('../migrations/0009_presence.sql', import.meta.url),
      'utf8'
    );

    old.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT '');
      INSERT INTO users (id) VALUES ('a');`);
    old.exec(migration);
    expect(old.prepare('SELECT presence_profile FROM users').get()).toEqual({
      presence_profile: 0
    });
    expect(() => old.exec(migration)).toThrow('duplicate column name');
    expect(old.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
  });
});
