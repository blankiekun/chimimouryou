/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({
  native: true,
  pick: vi.fn(async () => {}),
  write: vi.fn(async () => {}),
  close: vi.fn(async () => {})
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => plugin.native },
  registerPlugin: () => plugin
}));

const { catchDownloads } = await import('./native-save');

const originalClick = HTMLAnchorElement.prototype.click;

afterEach(() => {
  HTMLAnchorElement.prototype.click = originalClick;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('catchDownloads', () => {
  it('saves download links through the plugin in the Android app', async () => {
    vi.stubGlobal('fetch', async () => ({
      blob: async () => new Blob(['backup'], { type: 'text/plain;charset=utf-8' })
    }));
    catchDownloads(window);

    const link = document.createElement('a');
    link.href = 'blob:https://chimimouryou.localhost/1';
    link.download = 'export.zip';
    link.click();

    await vi.waitFor(() => expect(plugin.close).toHaveBeenCalledWith({ ok: true }));
    expect(plugin.pick).toHaveBeenCalledWith({ name: 'export.zip', mimeType: 'text/plain' });
    expect(plugin.write).toHaveBeenCalledWith({ data: btoa('backup') });

    // Other links keep their click.
    const other = document.createElement('a');
    other.href = 'https://example.com/';
    const navigate = vi.fn((event: Event) => event.preventDefault());
    other.addEventListener('click', navigate);
    other.click();
    expect(navigate).toHaveBeenCalled();
    expect(plugin.pick).toHaveBeenCalledTimes(1);
  });

  it('leaves the web build alone', () => {
    plugin.native = false;
    catchDownloads(window);
    expect(HTMLAnchorElement.prototype.click).toBe(originalClick);
    plugin.native = true;
  });
});
