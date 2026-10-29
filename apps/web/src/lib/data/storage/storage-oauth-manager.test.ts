/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

const android = vi.hoisted(() => ({ native: false, token: vi.fn() }));
vi.mock('$lib/data/android-drive', () => ({
  nativeDrive: () => android.native,
  nativeDriveToken: android.token,
  nativeGrant: 'android-authorization'
}));

await import('$lib/data/storage/storage-handler-factory');
const { StorageOAuthManager, storageOAuthTokens, storedRefreshToken } = await import(
  './storage-oauth-manager'
);
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
});
