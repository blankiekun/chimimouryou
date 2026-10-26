/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import hub, { SETTINGS_BYTES, type Env } from '../src/hub';
import { memoryD1 } from './d1';

const salt = 'ab'.repeat(16);

describe('settings sync', () => {
  let env: Env;
  let db: ReturnType<typeof memoryD1>['db'];
  let ip = 0;
  let n = 0;

  beforeEach(() => {
    const memory = memoryD1();

    env = { DB: memory.d1 };
    db = memory.db;
  });

  async function call(method: string, path: string, body?: unknown, token = '') {
    const response = await hub.fetch(
      new Request(`https://hub.example${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'CF-Connecting-IP': `192.0.2.${++ip % 250}`
        },
        body:
          body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
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
      key: (++n).toString(16).padStart(64, '0')
    });

    return body.token as string;
  }

  const doc = { version: 1, values: { placementResults: [{ cutoff: 5000 }] }, modified: {} };

  it('keeps one document per reader, checked by version', async () => {
    const aki = await signUp('aki_reads');
    const ren = await signUp('ren_reads');

    expect((await call('GET', '/v1/settings', undefined, aki)).body).toEqual({
      doc: null,
      version: 0
    });
    expect((await call('PUT', '/v1/settings', { doc, version: 0 }, aki)).body).toEqual({
      ok: true,
      version: 1
    });
    // Another device wrote first: it reads and merges again.
    expect((await call('PUT', '/v1/settings', { doc, version: 0 }, aki)).status).toBe(409);
    expect((await call('PUT', '/v1/settings', { doc: {}, version: 2 }, aki)).status).toBe(409);
    expect((await call('PUT', '/v1/settings', { doc: { a: 1 }, version: 1 }, aki)).body).toEqual({
      ok: true,
      version: 2
    });
    expect((await call('GET', '/v1/settings', undefined, aki)).body).toEqual({
      doc: { a: 1 },
      version: 2
    });
    expect((await call('GET', '/v1/settings', undefined, ren)).body.doc).toBeNull();
    expect((await call('GET', '/v1/settings')).status).toBe(401);
  });

  it('refuses oversized or malformed bodies', async () => {
    const aki = await signUp('aki_reads');
    const big = { values: { note: 'x'.repeat(SETTINGS_BYTES) } };
    // Under the character cap, over the byte cap.
    const wide = { values: { note: '読'.repeat(SETTINGS_BYTES / 2) } };

    expect((await call('PUT', '/v1/settings', { doc: big, version: 0 }, aki)).status).toBe(413);
    expect((await call('PUT', '/v1/settings', { doc: wide, version: 0 }, aki)).status).toBe(413);
    expect((await call('PUT', '/v1/settings', { doc: [], version: 0 }, aki)).status).toBe(400);
    expect((await call('PUT', '/v1/settings', { doc, version: -1 }, aki)).status).toBe(400);
    expect((await call('PUT', '/v1/settings', '{', aki)).status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 0 });
  });

  it('goes with the account', async () => {
    const aki = await signUp('aki_reads');

    await call('PUT', '/v1/settings', { doc, version: 0 }, aki);
    expect((await call('DELETE', '/v1/me', undefined, aki)).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 0 });
  });
});
