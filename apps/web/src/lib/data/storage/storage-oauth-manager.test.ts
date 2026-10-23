/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

await import('$lib/data/storage/storage-handler-factory');
const { StorageOAuthManager } = await import('./storage-oauth-manager');
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
});
