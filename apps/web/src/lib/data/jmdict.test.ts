/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const importDictionary = vi.hoisted(() => vi.fn());

vi.mock('$lib/data/dictionary', () => ({ importDictionary }));

const response = (body: BodyInit | null, init: ResponseInit) => new Response(body, init);

describe('jmdict', () => {
  beforeEach(() => {
    vi.resetModules();
    importDictionary.mockReset();
  });

  it('reads the bundled size from a HEAD request', async () => {
    const fetch = vi.fn(async () =>
      response(null, {
        headers: { 'content-type': 'application/zip', 'content-length': '15615645' }
      })
    );
    vi.stubGlobal('fetch', fetch);
    const { bundledJmdictSize } = await import('./jmdict');

    expect(await bundledJmdictSize()).toBe(15615645);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/dictionaries\/JMdict_english\.zip$/),
      {
        method: 'HEAD'
      }
    );
  });

  it('has no bundled copy on a 404 or an HTML fallback page', async () => {
    vi.stubGlobal('fetch', async () => response(null, { status: 404 }));
    expect(await (await import('./jmdict')).bundledJmdictSize()).toBeUndefined();

    vi.resetModules();
    vi.stubGlobal('fetch', async () =>
      response('<html></html>', { headers: { 'content-type': 'text/html' } })
    );
    expect(await (await import('./jmdict')).bundledJmdictSize()).toBeUndefined();
  });

  it('fails without importing when the download fails', async () => {
    vi.stubGlobal('fetch', async () => response(null, { status: 404 }));
    const { installJmdict } = await import('./jmdict');

    await expect(installJmdict()).rejects.toThrow('404');
    expect(importDictionary).not.toHaveBeenCalled();
  });

  it('knows an installed JMdict by its title', async () => {
    const { hasJmdict } = await import('./jmdict');

    expect(hasJmdict([{ title: 'JMdict [2026-10-25]' }])).toBe(true);
    expect(hasJmdict([{ title: 'Jitendex' }])).toBe(false);
  });
});
