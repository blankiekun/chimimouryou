/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { socialSession$ } from '$lib/data/social-account';

vi.mock('$lib/components/app-header/app-header.svelte', async () => ({
  default: (await import('$lib/components/section-head.svelte')).default
}));
vi.mock('$lib/components/community/community-reports.svelte', async () => ({
  default: (await import('$lib/components/section-head.svelte')).default
}));

const { default: Moderation } = await import('./+page.svelte');

describe('/moderation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    socialSession$.next(null);
    document.body.innerHTML = '';
  });

  async function mount(role: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ reports: [], me: {} }), { status: 200 }))
    );
    socialSession$.next({ token: 't', me: { id: 'a', role, share: {} } as never });
    const target = document.createElement('div');

    document.body.append(target);
    new Moderation({ target, props: {} });
    await tick();
    return target;
  }

  it('shows the library cover upload to devs only', async () => {
    expect((await mount('')).textContent).not.toContain('Upload library covers');
    document.body.innerHTML = '';
    expect((await mount('dev')).textContent).toContain('Upload library covers');
  });
});
