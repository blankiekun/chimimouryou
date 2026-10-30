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
const { StorageKey, StorageSourceDefault } = await import('./storage-types');

describe('StorageOAuthManager.getToken', () => {
  it('never opens sign-in without a click', async () => {
    Object.defineProperty(window.navigator, 'userActivation', {
      value: { isActive: false },
      configurable: true
    });
    const open = vi.spyOn(window, 'open');

    await expect(
      new StorageOAuthManager(StorageKey.GDRIVE, '').getToken(
        window,
        StorageSourceDefault.GDRIVE_DEFAULT,
        false
      )
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
      new StorageOAuthManager(StorageKey.GDRIVE, '').getToken(
        window,
        StorageSourceDefault.GDRIVE_DEFAULT,
        true
      )
    ).resolves.toBe('native');
    expect(open).not.toHaveBeenCalled();
    expect(storedRefreshToken(StorageSourceDefault.GDRIVE_DEFAULT)).toBe('android-authorization');

    // Consent withdrawn: a silent renewal fails and forgets the grant.
    storageOAuthTokens.clear();
    android.token.mockRejectedValueOnce(
      Object.assign(new Error('Sign in to Drive again'), { code: 'needsConsent' })
    );
    await expect(
      new StorageOAuthManager(StorageKey.GDRIVE, '').getToken(
        window,
        StorageSourceDefault.GDRIVE_DEFAULT,
        false
      )
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
      new StorageOAuthManager(StorageKey.GDRIVE, 'https://oauth.test/token').getToken(
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
});
