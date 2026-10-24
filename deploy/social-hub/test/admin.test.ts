/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import hub, { type Env } from '../src/hub';
import { memoryD1 } from './d1';

describe('hub moderation', () => {
  let env: Env;
  let db: ReturnType<typeof memoryD1>['db'];
  let objects: Map<string, Uint8Array>;
  let ip = 0;

  beforeEach(() => {
    const memory = memoryD1();

    objects = new Map();
    env = {
      DB: memory.d1,
      MEDIA: {
        get: async () => null,
        put: async (key, value) => void objects.set(key, new Uint8Array(value)),
        delete: async (keys) => [keys].flat().forEach((key) => objects.delete(key))
      }
    };
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
          'CF-Connecting-IP': `192.0.2.${++ip}`
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
      name: `${username} name`,
      salt: 'ab'.repeat(16),
      key: '0'.repeat(64)
    });

    return body as { token: string; me: { id: string; code: string; role: string } };
  }

  /** blank (dev), aki (reported: name, picture, a cover, rows) and ren (a reporter) */
  async function setUp() {
    const blank = await signUp('blank');
    const aki = await signUp('aki');
    const ren = await signUp('ren');
    const time = Math.floor(Date.now() / 1000);

    db.prepare(`UPDATE users SET role = 'dev' WHERE username = 'blank'`).run();
    db.prepare('INSERT INTO pictures (user, version) VALUES (?, 7)').run(aki.me.id);
    objects.set(`avatar/${aki.me.id}/7`, new Uint8Array(1));
    db.prepare(
      `INSERT INTO status (user, slot, book_key, title, kind, pct, read_at) VALUES (?, 0, 'k1', '本', 'book', 0.5, ?)`
    ).run(aki.me.id, time);
    db.prepare(
      `INSERT INTO finished (user, book_key, title, kind, month, at) VALUES (?, 'k2', '古い本', 'book', '2026-09', ?)`
    ).run(aki.me.id, time);
    db.prepare(
      `INSERT INTO events (user, type, book_key, title, at) VALUES (?, 'finished', 'k2', '古い本', ?)`
    ).run(aki.me.id, time);
    db.prepare(
      `INSERT INTO covers (book_key, file, user, at) VALUES ('k1', 'aaaaaaaaaaaaaaaa', ?, ?)`
    ).run(aki.me.id, time);
    objects.set('cover/aaaaaaaaaaaaaaaa', new Uint8Array(1));
    for (const what of ['name', 'picture']) {
      await call('POST', '/v1/report', { username: 'aki', what }, ren.token);
    }
    await call('POST', '/v1/report', { what: 'cover', key: 'k1', username: 'aki' }, ren.token);
    await call('POST', '/v1/report', { username: 'aki', what: 'name' });
    return { blank, aki, ren };
  }

  it('shows the role in people: me, friends, feed and profiles', async () => {
    const { blank, ren } = await setUp();

    await call('POST', '/v1/friends/request', { code: ren.me.code }, blank.token);
    await call('POST', `/v1/friends/${blank.me.id}/accept`, undefined, ren.token);
    expect((await call('GET', '/v1/me', undefined, blank.token)).body.role).toBe('dev');
    expect((await call('GET', '/v1/me', undefined, ren.token)).body.role).toBe('');
    expect((await call('GET', '/v1/friends', undefined, ren.token)).body.friends[0].role).toBe(
      'dev'
    );
    expect((await call('GET', '/v1/profile/blank')).body.profile.role).toBe('dev');
  });

  it('refuses every admin route to readers without the dev role and to visitors', async () => {
    const { aki, ren } = await setUp();
    const routes: [string, string][] = [
      ['GET', '/v1/admin/reports'],
      ['DELETE', '/v1/admin/reports?what=name&target=x'],
      ['DELETE', `/v1/admin/cover?target=${aki.me.id}:k1`],
      ['GET', '/v1/admin/user/aki'],
      ['POST', `/v1/admin/user/${aki.me.id}/name`],
      ['DELETE', `/v1/admin/user/${aki.me.id}/picture`],
      ['DELETE', `/v1/admin/user/${aki.me.id}/status/0`],
      ['DELETE', `/v1/admin/user/${aki.me.id}/finished/k2`],
      ['DELETE', `/v1/admin/user/${aki.me.id}/events/1`]
    ];

    for (const [method, path] of routes) {
      expect((await call(method, path, undefined, ren.token)).status).toBe(403);
      expect((await call(method, path)).status).toBe(401);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM reports').get()).toEqual({ n: 4 });
    expect(objects.size).toBe(2);
  });

  it('lists reports grouped by target with what was reported', async () => {
    const { blank, aki } = await setUp();
    const { body } = await call('GET', '/v1/admin/reports', undefined, blank.token);

    expect(body.reports).toEqual([
      expect.objectContaining({
        what: 'name',
        target: aki.me.id,
        count: 2,
        user: expect.objectContaining({ username: 'aki', name: 'aki name', picture: 7 })
      }),
      expect.objectContaining({
        what: 'cover',
        target: `${aki.me.id}:k1`,
        count: 1,
        user: null,
        cover: 'aaaaaaaaaaaaaaaa',
        title: '本',
        uploader: 'aki'
      }),
      expect.objectContaining({ what: 'picture', count: 1 })
    ]);
  });

  it('resets a name, removes a picture and a cover, and dismisses reports', async () => {
    const { blank, aki } = await setUp();
    const as = (method: string, path: string) => call(method, path, undefined, blank.token);

    expect((await as('POST', `/v1/admin/user/${aki.me.id}/name`)).status).toBe(200);
    expect((await as('DELETE', `/v1/admin/user/${aki.me.id}/picture`)).status).toBe(200);
    expect((await as('DELETE', `/v1/admin/cover?target=${aki.me.id}:k1`)).status).toBe(200);
    expect(db.prepare(`SELECT name FROM users WHERE username = 'aki'`).get()).toEqual({
      name: 'aki'
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM pictures').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT removed FROM covers').get()).toEqual({ removed: 1 });
    expect(objects.size).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM reports').get()).toEqual({ n: 0 });

    await call('POST', '/v1/report', { username: 'aki', what: 'name' });
    expect((await as('DELETE', `/v1/admin/reports?what=name&target=${aki.me.id}`)).status).toBe(
      200
    );
    expect(db.prepare('SELECT COUNT(*) AS n FROM reports').get()).toEqual({ n: 0 });
    expect((await as('DELETE', '/v1/admin/reports?what=other&target=x')).status).toBe(400);
    expect((await as('DELETE', `/v1/admin/cover?target=${aki.me.id}:none`)).status).toBe(404);
    expect((await as('DELETE', '/v1/admin/cover?target=k1')).status).toBe(400);
  });

  it('looks up a reader and deletes single rows of theirs', async () => {
    const { blank, aki } = await setUp();
    const as = (method: string, path: string) => call(method, path, undefined, blank.token);
    const { body } = await as('GET', '/v1/admin/user/AKI');

    expect(body.user).toEqual(expect.objectContaining({ id: aki.me.id, username: 'aki' }));
    expect(body.books).toEqual([expect.objectContaining({ slot: 0, key: 'k1', title: '本' })]);
    expect(body.finished).toEqual([expect.objectContaining({ key: 'k2', title: '古い本' })]);
    expect(body.events).toHaveLength(1);
    expect((await as('GET', '/v1/admin/user/nobody')).status).toBe(404);

    expect((await as('DELETE', `/v1/admin/user/${aki.me.id}/finished/k2`)).status).toBe(200);
    expect((await as('DELETE', `/v1/admin/user/${aki.me.id}/finished/k2`)).status).toBe(404);
    expect((await as('DELETE', `/v1/admin/user/${aki.me.id}/status/0`)).status).toBe(200);
    expect(
      (await as('DELETE', `/v1/admin/user/${aki.me.id}/events/${body.events[0].id}`)).status
    ).toBe(200);
    expect((await as('DELETE', `/v1/admin/user/${aki.me.id}/status/x`)).status).toBe(404);
    expect((await as('DELETE', '/v1/admin/user/0000000000000000/status/0')).status).toBe(404);

    const after = (await as('GET', '/v1/admin/user/aki')).body;

    expect([after.books, after.finished, after.events]).toEqual([[], [], []]);
  });
});
