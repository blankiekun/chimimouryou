/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  changeSocialPassword,
  logOutEverywhere,
  newRecoveryCode,
  socialSession$,
  stretchPassword
} from './social-account';

const me = {
  id: 'a'.repeat(16),
  username: 'aki',
  name: 'Aki',
  avatar: 0,
  code: 'K7QM2XPA',
  share: {},
  created: 1
};
const salt = 'ab'.repeat(16);

describe('social account', () => {
  let requests: { path: string; body: any; auth: string | null }[];

  beforeEach(() => {
    window.localStorage.clear();
    socialSession$.next({ token: 'hub-token', me });
    window.localStorage.setItem('socialBooks', '[]');
    requests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname;

        requests.push({
          path,
          body: init.body ? JSON.parse(String(init.body)) : undefined,
          auth: new Headers(init.headers).get('Authorization')
        });
        const answers: Record<string, unknown> = {
          '/v1/salt': { salt },
          '/v1/recovery': { recovery: 'ABCDE'.repeat(4) }
        };
        return new Response(JSON.stringify(answers[path] ?? { ok: true }));
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('signs out everywhere and forgets the session here', async () => {
    await logOutEverywhere();

    expect(requests.map((r) => [r.path, r.auth])).toEqual([['/v1/logout-all', 'Bearer hub-token']]);
    expect(socialSession$.getValue()).toBeNull();
    expect(window.localStorage.getItem('socialBooks')).toBeNull();
  });

  it('sends only stretched passwords with the account salt', async () => {
    await changeSocialPassword('old password', 'new password');
    const password = requests.find((r) => r.path === '/v1/password')!;

    expect(requests[0].body).toEqual({ username: 'aki' });
    expect(password.body).toEqual({
      key: await stretchPassword('old password', salt),
      next: await stretchPassword('new password', salt)
    });
    expect(JSON.stringify(requests)).not.toMatch(/old password|new password/);
    expect(socialSession$.getValue()?.token).toBe('hub-token');

    expect(await newRecoveryCode('new password')).toBe('ABCDE'.repeat(4));
    expect(requests.at(-1)?.body).toEqual({ key: await stretchPassword('new password', salt) });
  });
});
