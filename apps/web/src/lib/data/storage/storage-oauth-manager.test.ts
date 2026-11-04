/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

const android = vi.hoisted(() => ({ native: false, token: vi.fn() }));
vi.mock('$lib/data/standalone/android-drive', () => ({
  nativeDrive: () => android.native,
  nativeDriveToken: android.token,
  nativeGrant: 'android-authorization'
}));

// The built-in Drive client only renews with a client id and secret, read when env.ts loads.
vi.stubEnv('VITE_GDRIVE_CLIENT_ID', 'client-id');
vi.stubEnv('VITE_GDRIVE_CLIENT_SECRET', 'client-secret');

const { StorageOAuthManager, storageOAuthTokens, storedRefreshToken, storeRefreshToken } =
  await import('./storage-oauth-manager');
const { StorageSourceDefault } = await import('./storage-types');

describe('StorageOAuthManager.getToken', () => {
  it('never opens sign-in without a click', async () => {
    Object.defineProperty(window.navigator, 'userActivation', {
      value: { isActive: false },
      configurable: true
    });
    const open = vi.spyOn(window, 'open');

    await expect(
      new StorageOAuthManager('').getToken(window, StorageSourceDefault.GDRIVE_DEFAULT, false)
    ).rejects.toThrow('Sign in to Drive again');
    expect(open).not.toHaveBeenCalled();

    open.mockRestore();
    delete (window.navigator as any).userActivation;
  });

  it('asks Play services instead of opening the pop-up in the Android app', async () => {
    android.native = true;
    android.token.mockResolvedValueOnce({
      accessToken: 'native',
      scope: 'drive.file',
      expiration: Date.now() + 3e6
    });
    const open = vi.spyOn(window, 'open');

    await expect(
      new StorageOAuthManager('').getToken(window, StorageSourceDefault.GDRIVE_DEFAULT, true)
    ).resolves.toBe('native');
    expect(open).not.toHaveBeenCalled();
    expect(storedRefreshToken(StorageSourceDefault.GDRIVE_DEFAULT)).toBe('android-authorization');

    // Consent withdrawn: a silent renewal fails and forgets the grant.
    storageOAuthTokens.clear();
    android.token.mockRejectedValueOnce(
      Object.assign(new Error('Sign in to Drive again'), { code: 'needsConsent' })
    );
    await expect(
      new StorageOAuthManager('').getToken(window, StorageSourceDefault.GDRIVE_DEFAULT, false)
    ).rejects.toThrow('Sign in to Drive again');
    expect(storedRefreshToken(StorageSourceDefault.GDRIVE_DEFAULT)).toBeUndefined();

    open.mockRestore();
    android.native = false;
  });

  // Bug: an expired Drive token makes a background sync ask for sign-in although the stored refresh token still works.
  it('renews an expired token from the stored refresh token without a click', async () => {
    Object.defineProperty(window.navigator, 'userActivation', {
      value: { isActive: false },
      configurable: true
    });
    const open = vi.spyOn(window, 'open');
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({ access_token: 'renewed', expires_in: 3600, scope: 'drive.file' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    vi.stubGlobal('fetch', fetch);

    storageOAuthTokens.set(StorageSourceDefault.GDRIVE_DEFAULT, {
      accessToken: 'expired',
      scope: 'drive.file',
      expiration: Date.now() - 1000
    });
    storeRefreshToken(StorageSourceDefault.GDRIVE_DEFAULT, 'refresh-1');

    await expect(
      new StorageOAuthManager('https://oauth.test/token').getToken(
        window,
        StorageSourceDefault.GDRIVE_DEFAULT,
        false
      )
    ).resolves.toBe('renewed');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0][1].body as FormData).get('refresh_token')).toBe('refresh-1');
    expect(open).not.toHaveBeenCalled();
    expect(storageOAuthTokens.get(StorageSourceDefault.GDRIVE_DEFAULT)?.accessToken).toBe(
      'renewed'
    );

    open.mockRestore();
    vi.unstubAllGlobals();
    delete (window.navigator as any).userActivation;
  });

  // Ways a renewal can fail. Only Google's "this token is dead" may cost the reader their sign-in:
  // bad Wi-Fi, an outage or a captive portal must keep it, with no prompt and no pop-up.
  describe.each([
    ['no network', async () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a 503', async () => new Response('<html>down</html>', { status: 503 })],
    ['a captive portal', async () => new Response('<html>log in</html>', { status: 200 })],
    [
      'a 200 without a token',
      async () =>
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    ]
  ])('when a renewal meets %s', (_name, answer) => {
    it('keeps the refresh token and neither asks for sign-in nor opens a window', async () => {
      const open = vi.spyOn(window, 'open');

      vi.stubGlobal('fetch', vi.fn(answer));
      storageOAuthTokens.clear();
      storeRefreshToken(StorageSourceDefault.GDRIVE_DEFAULT, 'refresh-1');

      // `userActivation` absent counts as a click: the worst case for a pop-up.
      const error = await new StorageOAuthManager('https://oauth.test/token')
        .getToken(window, StorageSourceDefault.GDRIVE_DEFAULT, false)
        .catch((failure) => failure);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).not.toMatch(/Sign in to \w+ again/);
      expect(storedRefreshToken(StorageSourceDefault.GDRIVE_DEFAULT)).toBe('refresh-1');
      expect(open).not.toHaveBeenCalled();

      open.mockRestore();
      vi.unstubAllGlobals();
    });
  });

  // Bug: a dead refresh token kept forever would fail every sync without ever offering sign-in.
  it('forgets the refresh token and asks for sign-in on invalid_grant', async () => {
    Object.defineProperty(window.navigator, 'userActivation', {
      value: { isActive: false },
      configurable: true
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been revoked' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          )
      )
    );
    storageOAuthTokens.clear();
    storeRefreshToken(StorageSourceDefault.GDRIVE_DEFAULT, 'refresh-1');

    await expect(
      new StorageOAuthManager('https://oauth.test/token').getToken(
        window,
        StorageSourceDefault.GDRIVE_DEFAULT,
        false
      )
    ).rejects.toThrow('Sign in to Drive again');
    expect(storedRefreshToken(StorageSourceDefault.GDRIVE_DEFAULT)).toBeUndefined();

    vi.unstubAllGlobals();
    delete (window.navigator as any).userActivation;
  });
});
